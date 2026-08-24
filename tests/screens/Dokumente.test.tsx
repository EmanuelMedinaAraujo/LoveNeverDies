import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Dokumentdaten } from '../../src/hooks/useDokumente.ts'
import type { Fallschluessel } from '../../src/services/aufgabenService.ts'
import type { Dokument } from '../../src/services/dokumentService.ts'
import { rendereMitProvidern } from './harness.tsx'

const useDokumente = vi.fn<() => Dokumentdaten>()

vi.mock('../../src/hooks/useDokumente.ts', () => ({
  useDokumente: () => useDokumente(),
}))

const { Dokumente } = await import('../../src/screens/shared/Aufgabe/Dokumente.tsx')

/**
 * Die Dokumente einer Aufgabe (DESIGN.md §7).
 *
 * Geprüft wird, was §7 der Oberfläche zusagt: Die Aktion heißt "Dokument
 * einfach abfotografieren" und öffnet die Kamera; ohne Verbindung ist sie zu
 * und sagt, warum; wer die Aufgabe nicht hat, sieht die Dokumente trotzdem und
 * löscht keines; vor dem Löschen wird gefragt; und ein Fehlschlag steht als
 * Meldung da statt still zu verschwinden.
 */

const FALL: Fallschluessel = { id: 'fall-1', kid: 'case_fall-1:1', kc: new Uint8Array([1]) }

function dokument(ueberschreibung: Partial<Dokument> = {}): Dokument {
  return {
    id: 'dok-1',
    name: 'sterbeurkunde.jpg',
    mimetyp: 'image/jpeg',
    groesse: 2 * 1024 * 1024,
    aufgabeId: 'item-1',
    aufgenommenAm: '2026-08-24T10:00:00Z',
    pfad: 'fall-1/dok-1',
    dek: new Uint8Array([9]),
    kid: FALL.kid,
    ...ueberschreibung,
  }
}

function daten(ueberschreibung: Partial<Dokumentdaten> = {}): Dokumentdaten {
  return {
    dokumente: [],
    uebersprungen: 0,
    online: true,
    nimmAuf: vi.fn().mockResolvedValue(dokument()),
    oeffne: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
    loesche: vi.fn().mockResolvedValue(undefined),
    ...ueberschreibung,
  }
}

function rendere(ueberschreibung: Partial<Dokumentdaten> = {}, darfAendern = true) {
  const wert = daten(ueberschreibung)
  useDokumente.mockReturnValue(wert)

  rendereMitProvidern(
    <Dokumente
      fall={FALL}
      aufgabeId="item-1"
      zeilen={[]}
      aktualisiere={vi.fn()}
      darfAendern={darfAendern}
    />,
  )

  return wert
}

/** Eine Datei, wie ein `<input type="file">` sie liefert. */
function datei(name = 'sterbeurkunde.jpg'): File {
  return new File([new Uint8Array([1, 2, 3])], name, { type: 'image/jpeg' })
}

beforeEach(() => {
  useDokumente.mockReset()

  // jsdom kennt keine Objekt-URLs. Der Screen erzeugt beim Ansehen eine und
  // widerruft sie wieder: Beides soll hier stattfinden können.
  globalThis.URL.createObjectURL = vi.fn(() => 'blob:dokument')
  globalThis.URL.revokeObjectURL = vi.fn()
})

describe('Dokumente (§7)', () => {
  it('benennt die Aufnahme so, wie §7 sie benennt, und öffnet die Kamera', () => {
    rendere()

    const feld = screen.getByLabelText('Dokument einfach abfotografieren')

    expect(feld).toHaveAttribute('type', 'file')
    expect(feld).toHaveAttribute('capture', 'environment')
  })

  it('reicht die gewählte Datei mit ihrer Aufgabe weiter', async () => {
    const wert = rendere()

    await userEvent.upload(screen.getByLabelText('Dokument einfach abfotografieren'), datei())

    await waitFor(() => expect(wert.nimmAuf).toHaveBeenCalledTimes(1))
    expect(vi.mocked(wert.nimmAuf).mock.calls[0]?.[1]).toBe('item-1')
  })

  it('sperrt die Aufnahme ohne Verbindung und sagt, warum', () => {
    rendere({ online: false })

    expect(screen.getByLabelText('Dokument einfach abfotografieren')).toBeDisabled()
    expect(screen.getByText(/Ohne Verbindung lässt sich kein Dokument aufnehmen/)).toBeVisible()
  })

  it('zeigt eine Fehlermeldung, statt sie zu verschlucken', async () => {
    const wert = rendere({
      nimmAuf: vi.fn().mockRejectedValue(new Error('Mehr als 15 MB nimmt die App nicht an.')),
    })

    await userEvent.upload(screen.getByLabelText('Dokument einfach abfotografieren'), datei())

    expect(await screen.findByRole('alert')).toHaveTextContent(/Mehr als 15 MB/)
    expect(wert.nimmAuf).toHaveBeenCalled()
  })

  it('listet nur die Dokumente dieser Aufgabe', () => {
    rendere({
      dokumente: [
        dokument(),
        dokument({ id: 'dok-2', name: 'erbschein.pdf', aufgabeId: 'item-9' }),
      ],
    })

    expect(screen.getByText('sterbeurkunde.jpg')).toBeVisible()
    expect(screen.queryByText('erbschein.pdf')).not.toBeInTheDocument()
  })

  it('zeigt ein Bild erst nach dem Entschlüsseln — nie als Link auf den Server', async () => {
    const wert = rendere({ dokumente: [dokument()] })

    await userEvent.click(screen.getByRole('button', { name: /Ansehen/ }))

    const bild = await screen.findByRole('img', { name: 'sterbeurkunde.jpg' })

    expect(wert.oeffne).toHaveBeenCalledWith(expect.objectContaining({ id: 'dok-1' }))
    expect(bild).toHaveAttribute('src', 'blob:dokument')
  })

  it('bietet ein PDF zum Speichern an, statt es als Bild auszugeben', async () => {
    rendere({ dokumente: [dokument({ name: 'erbschein.pdf', mimetyp: 'application/pdf' })] })

    await userEvent.click(screen.getByRole('button', { name: /Ansehen/ }))

    const link = await screen.findByRole('link', { name: /erbschein.pdf/ })

    expect(link).toHaveAttribute('download', 'erbschein.pdf')
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })

  it('gibt die Objekt-URL wieder frei, sobald niemand mehr hinsieht', async () => {
    rendere({ dokumente: [dokument()] })

    await userEvent.click(screen.getByRole('button', { name: /Ansehen/ }))
    await screen.findByRole('img', { name: 'sterbeurkunde.jpg' })
    await userEvent.click(screen.getByRole('button', { name: 'Schließen' }))

    expect(globalThis.URL.revokeObjectURL).toHaveBeenCalledWith('blob:dokument')
  })

  it('fragt, bevor es ein Dokument löscht', async () => {
    const wert = rendere({ dokumente: [dokument()] })

    await userEvent.click(screen.getByRole('button', { name: /^Löschen/ }))

    expect(screen.getByText(/wirklich löschen/)).toBeVisible()
    expect(wert.loesche).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole('button', { name: 'Endgültig löschen' }))

    await waitFor(() =>
      expect(wert.loesche).toHaveBeenCalledWith(expect.objectContaining({ id: 'dok-1' })),
    )
  })

  it('lässt eine fremde Aufgabe ansehen, aber nicht aufnehmen oder löschen', () => {
    rendere({ dokumente: [dokument()] }, false)

    expect(screen.getByLabelText('Dokument einfach abfotografieren')).toBeDisabled()
    expect(screen.getByRole('button', { name: /Ansehen/ })).toBeEnabled()
    expect(screen.queryByRole('button', { name: /^Löschen/ })).not.toBeInTheDocument()
  })
})
