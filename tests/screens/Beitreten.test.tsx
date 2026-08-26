import { act, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { rendereMitProvidern } from './harness.tsx'

/**
 * Die beitretende Seite (DESIGN.md §6, Schritt 1 bis 3 und 7).
 *
 * Zwei Dinge stehen hier groß, und beide werden am Telefon vorgelesen: der
 * Kopplungscode und der eigene Prüfcode. Der Test prüft, dass sie da sind, dass
 * ein Screenreader sie Zeichen für Zeichen bekommt und dass die App
 * weiterspringt, sobald die Wache freigibt.
 */

const useKopplungscode = vi.fn()
const useKopplungswache = vi.fn()
const navigiere = vi.fn()
const neuAnfordern = vi.fn()
const qrToString = vi.fn()

vi.mock('../../src/hooks/useKopplung.ts', () => ({
  useKopplungscode: (...a: unknown[]) => useKopplungscode(...a),
  useKopplungswache: (...a: unknown[]) => useKopplungswache(...a),
}))
vi.mock('react-router-dom', async () => {
  const echt = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return { ...echt, useNavigate: () => navigiere }
})

// `qrcode` baut ein PNG nur über ein `<canvas>`, das jsdom nicht kennt. Der
// SVG-Pfad bräuchte das nicht, aber ersetzt wird die Bibliothek trotzdem: So
// prüft der Test, was `Beitreten` selbst tut (auf- und zuklappen, den
// richtigen Code weiterreichen), nicht, wie `qrcode` einen String encodiert --
// das steht in dessen eigenen Tests.
vi.mock('qrcode', () => ({
  default: { toString: (...a: unknown[]) => qrToString(...a) },
}))

const { Beitreten } = await import('../../src/screens/shared/Beitreten/Beitreten.tsx')

/** 15 Minuten in der Zukunft, so wie `erzeuge_kopplungscode` es liefert. */
function inKuerze(): string {
  return new Date(Date.now() + 15 * 60_000).toISOString()
}

const BEREIT = {
  status: 'bereit',
  code: 'K4M7QP2X',
  laeuftAbAm: inKuerze(),
  pruefcode: '481253',
}

beforeEach(() => {
  vi.clearAllMocks()
  useKopplungscode.mockReturnValue({ zustand: BEREIT, neuAnfordern })
  useKopplungswache.mockReturnValue({ status: 'wartet' })
  qrToString.mockResolvedValue('<svg>mock</svg>')
})

describe('Beitreten (§6)', () => {
  it('zeigt den Code in zwei Vierergruppen und Zeichen für Zeichen zum Vorlesen', () => {
    rendereMitProvidern(<Beitreten zweck="join" />)

    expect(screen.getByText('K4M7-QP2X')).toBeVisible()
    expect(screen.getByText('Ihr Kopplungscode lautet K 4 M 7 Q P 2 X')).toBeInTheDocument()
  })

  it('sagt, welche Zeichen im Code nicht vorkommen', () => {
    // Wer sich verhört hat, soll es hier sehen und nicht am Rate-Limit (§6).
    rendereMitProvidern(<Beitreten zweck="join" />)

    expect(screen.getByText(/kein O, keine 0, kein I und keine 1/)).toBeVisible()
  })

  it('zeigt den Prüfcode und sagt, wozu er da ist', () => {
    rendereMitProvidern(<Beitreten zweck="join" />)

    expect(screen.getByText('481 253')).toBeVisible()
    expect(screen.getByText('4 8 1 2 5 3')).toBeInTheDocument()
    expect(screen.getByText(/Stimmen sie nicht überein, brechen Sie ab/)).toBeVisible()
  })

  it('nennt beide Zwecke bei ihrem Namen', () => {
    rendereMitProvidern(<Beitreten zweck="join" />)
    expect(screen.getByRole('heading', { name: 'Ich wurde eingeladen' })).toBeVisible()

    rendereMitProvidern(<Beitreten zweck="device" />)
    expect(screen.getByRole('heading', { name: 'Dieses Gerät freischalten' })).toBeVisible()
  })

  it('holt die Wache erst, wenn ein Code dasteht', () => {
    useKopplungscode.mockReturnValue({ zustand: { status: 'laedt' }, neuAnfordern })

    rendereMitProvidern(<Beitreten zweck="join" />)

    expect(useKopplungswache).toHaveBeenCalledWith(false)
  })

  it('lässt einen neuen Code anfordern', async () => {
    rendereMitProvidern(<Beitreten zweck="join" />)

    await userEvent.click(screen.getByRole('button', { name: 'Neuen Code anfordern' }))

    expect(neuAnfordern).toHaveBeenCalled()
  })

  it('sagt, bis wann der Code gilt', () => {
    rendereMitProvidern(<Beitreten zweck="join" />)

    expect(screen.getByText(/^Er gilt bis \d{2}:\d{2} Uhr\.$/)).toBeVisible()
  })

  it('sagt es, sobald der Code abgelaufen ist', async () => {
    // Ohne diese Uhr stünde der tote Code weiter groß auf dem Screen, und
    // jemand läse ihn vor, während die andere Seite "abgelaufen" zurückbekommt.
    vi.useFakeTimers()

    try {
      useKopplungscode.mockReturnValue({
        zustand: { ...BEREIT, laeuftAbAm: new Date(Date.now() + 60_000).toISOString() },
        neuAnfordern,
      })

      rendereMitProvidern(<Beitreten zweck="join" />)
      expect(screen.queryByText(/abgelaufen/)).toBeNull()

      await act(async () => {
        await vi.advanceTimersByTimeAsync(61_000)
      })

      expect(screen.getByText(/Dieser Code ist abgelaufen/)).toBeVisible()
    } finally {
      vi.useRealTimers()
    }
  })

  it('kommt mit einem unlesbaren Zeitstempel aus, ohne ihn für abgelaufen zu halten', () => {
    useKopplungscode.mockReturnValue({
      zustand: { ...BEREIT, laeuftAbAm: 'irgendwann' },
      neuAnfordern,
    })

    rendereMitProvidern(<Beitreten zweck="join" />)

    expect(screen.getByText('Er gilt 15 Minuten.')).toBeVisible()
    expect(screen.queryByText(/abgelaufen/)).toBeNull()
  })

  it('nennt den Grund, wenn kein Code zu bekommen war', async () => {
    useKopplungscode.mockReturnValue({
      zustand: { status: 'fehler', nachricht: 'Ohne hinterlegten Namen.' },
      neuAnfordern,
    })

    rendereMitProvidern(<Beitreten zweck="join" />)

    expect(screen.getByRole('alert')).toHaveTextContent('Ohne hinterlegten Namen.')
    await userEvent.click(screen.getByRole('button', { name: 'Noch einmal versuchen' }))
    expect(neuAnfordern).toHaveBeenCalled()
  })

  describe('sobald die Wache freigibt', () => {
    beforeEach(() => {
      vi.useFakeTimers({ shouldAdvanceTime: true })
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('meldet den Erfolg und geht danach zum Startscreen', async () => {
      useKopplungswache.mockReturnValue({ status: 'freigeschaltet', lesbar: 1 })

      rendereMitProvidern(<Beitreten zweck="join" />)

      expect(screen.getByText('Sie gehören jetzt zum Fall.')).toBeVisible()
      expect(navigiere).not.toHaveBeenCalled()

      await act(async () => {
        await vi.advanceTimersByTimeAsync(2_000)
      })

      expect(navigiere).toHaveBeenCalledWith('/', { replace: true })
    })
  })

  it('nennt den Grund, wenn der Stand nicht abrufbar ist', () => {
    useKopplungswache.mockReturnValue({ status: 'fehler', nachricht: 'Kein Netz.' })

    rendereMitProvidern(<Beitreten zweck="join" />)

    expect(screen.getByText(/Kein Netz\./)).toBeVisible()
  })

  describe('QR-Code (Alternative zum Vorlesen)', () => {
    it('zeigt den QR-Code erst nach einem Klick auf den Knopf', async () => {
      const { container } = rendereMitProvidern(<Beitreten zweck="join" />)

      const knopf = screen.getByRole('button', { name: 'QR-Code anzeigen' })
      expect(knopf).toHaveAttribute('aria-expanded', 'false')
      expect(container.querySelector('img')).toBeNull()
      expect(qrToString).not.toHaveBeenCalled()

      await userEvent.click(knopf)

      expect(screen.getByRole('button', { name: 'QR-Code verbergen' })).toHaveAttribute(
        'aria-expanded',
        'true',
      )
      expect(await screen.findByText(/Lassen Sie die andere Seite diesen QR-Code scannen/)).toBeVisible()
      expect(container.querySelector('img')).not.toBeNull()
    })

    it('kodiert genau den Kopplungscode, ohne Bindestrich', async () => {
      rendereMitProvidern(<Beitreten zweck="join" />)

      await userEvent.click(screen.getByRole('button', { name: 'QR-Code anzeigen' }))

      await screen.findByRole('button', { name: 'QR-Code verbergen' })
      expect(qrToString).toHaveBeenCalledWith('K4M7QP2X', expect.objectContaining({ type: 'svg' }))
    })

    it('klappt wieder zu, wenn man ein zweites Mal klickt', async () => {
      const { container } = rendereMitProvidern(<Beitreten zweck="join" />)

      const knopf = screen.getByRole('button', { name: 'QR-Code anzeigen' })
      await userEvent.click(knopf)
      await screen.findByRole('button', { name: 'QR-Code verbergen' })

      await userEvent.click(screen.getByRole('button', { name: 'QR-Code verbergen' }))

      expect(screen.getByRole('button', { name: 'QR-Code anzeigen' })).toHaveAttribute(
        'aria-expanded',
        'false',
      )
      expect(container.querySelector('img')).toBeNull()
    })
  })
})
