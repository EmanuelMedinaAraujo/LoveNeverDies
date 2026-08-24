import { render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthKontextProvider, type AuthZustand } from '../../src/core/auth/authProvider.ts'
import type { Falldaten } from '../../src/hooks/useCase.ts'
import { authWert } from '../screens/harness.tsx'

/**
 * Die Fallsperre und das Routing aus DESIGN.md §7.
 *
 * Alle Screens sind ersetzt: Was sie zeigen, steht in ihren eigenen Tests.
 * Hier geht es um die Weichen davor — angemeldet oder nicht, Fall oder kein
 * Fall, lesbar oder gesperrt — und darum, dass §7 nach der Anmeldung
 * `navigator.storage.persist()` still mitlaufen lässt.
 */

const useCase = vi.fn<() => Falldaten>()
const useGeraeteanmeldung = vi.fn()
const useProfilAbgleich = vi.fn()
const speicherDauerhaftAnfordern = vi.fn().mockResolvedValue('gewaehrt')

vi.mock('../../src/hooks/useCase.ts', () => ({ useCase: () => useCase() }))
vi.mock('../../src/hooks/useGeraete.ts', () => ({
  useGeraeteanmeldung: () => useGeraeteanmeldung(),
}))
vi.mock('../../src/hooks/useProfil.ts', () => ({
  useProfilAbgleich: () => useProfilAbgleich(),
}))
vi.mock('../../src/core/storage/persist.ts', () => ({
  speicherDauerhaftAnfordern: () => speicherDauerhaftAnfordern(),
}))
vi.mock('../../src/screens/shared/Anmelden/Anmelden.tsx', () => ({
  Anmelden: () => <p>Anmeldeformular</p>,
}))
vi.mock('../../src/screens/shared/KeinFall/KeinFall.tsx', () => ({
  KeinFall: () => <p>Fallweiche</p>,
}))
vi.mock('../../src/screens/shared/Alle/Alle.tsx', () => ({ Alle: () => <p>Aufgabenliste</p> }))
vi.mock('../../src/screens/shared/Profil/Profil.tsx', () => ({ Profil: () => <p>Profilseite</p> }))
vi.mock('../../src/screens/shared/Todesfall/Todesfall.tsx', () => ({
  Todesfall: () => <p>Fallanlage</p>,
}))
vi.mock('../../src/screens/shared/Beitreten/Beitreten.tsx', () => ({
  Beitreten: ({ zweck }: { zweck: string }) => <p>Kopplungscode fuer {zweck}</p>,
}))
vi.mock('../../src/screens/shared/Koppeln/Koppeln.tsx', () => ({
  Koppeln: () => <p>Codeeingabe</p>,
}))

const { App } = await import('../../src/app/App.tsx')

const LESBAR = {
  zustand: 'lesbar' as const,
  id: 'fall-1',
  status: 'trauerfall' as const,
  personName: 'Hans Weber',
  sterbedatum: '2024-03-15',
  kid: 'case_fall-1:1',
  kc: new Uint8Array([1]),
  kcat: new Uint8Array([2]),
  katalogVersion: '2026-08+testtest',
}

function rendere(zustand: AuthZustand, pfad = '/') {
  function Huelle({ children }: { children: ReactNode }) {
    return (
      <AuthKontextProvider value={authWert(zustand)}>
        <MemoryRouter initialEntries={[pfad]}>{children}</MemoryRouter>
      </AuthKontextProvider>
    )
  }

  return render(<App />, { wrapper: Huelle })
}

const ANGEMELDET: AuthZustand = {
  status: 'angemeldet',
  benutzer: { id: 'user_1', anzeigename: 'Anna', email: null },
}

beforeEach(() => {
  vi.clearAllMocks()
  useCase.mockReturnValue({ zustand: { status: 'kein-fall' }, legeTrauerfallAn: vi.fn() })
  useGeraeteanmeldung.mockReturnValue({ status: 'laedt' })
  useProfilAbgleich.mockReturnValue({ status: 'bereit' })
})

describe('Anmeldezustand', () => {
  it('zeigt einen Hinweis, solange die Sitzung geladen wird', () => {
    rendere({ status: 'laedt' })

    expect(screen.getByRole('status')).toHaveTextContent('Einen Moment bitte')
  })

  it('zeigt ausschliesslich die Anmeldung, wer nicht angemeldet ist', () => {
    rendere({ status: 'abgemeldet' })

    expect(screen.getByText('Anmeldeformular')).toBeVisible()
    expect(screen.queryByText('Fallweiche')).toBeNull()
  })

  it('bittet erst nach der Anmeldung um dauerhaften Speicher', async () => {
    /*
     * Die Bitte steht hinter der Anmeldung, weil Browser sie eher gewaehren,
     * wenn jemand die Seite tatsaechlich benutzt (§7).
     */
    rendere({ status: 'abgemeldet' })
    expect(speicherDauerhaftAnfordern).not.toHaveBeenCalled()

    rendere(ANGEMELDET)
    await waitFor(() => expect(speicherDauerhaftAnfordern).toHaveBeenCalled())
  })

  it('setzt den Ansichtsmodus als data-dichte auf die Wurzel', async () => {
    rendere(ANGEMELDET)

    await waitFor(() => {
      expect(document.documentElement.dataset.dichte).toBe('erweitert')
    })
  })
})

describe('Fallsperre', () => {
  it('zeigt einen Hinweis, solange die Faelle geladen werden', () => {
    useCase.mockReturnValue({ zustand: { status: 'laedt' }, legeTrauerfallAn: vi.fn() })

    rendere(ANGEMELDET)

    expect(screen.getByRole('status')).toHaveTextContent('Ihre Daten werden geladen')
  })

  it('nennt den Grund, wenn die Faelle nicht abrufbar sind', () => {
    useCase.mockReturnValue({
      zustand: { status: 'fehler', nachricht: 'Kein Netz.' },
      legeTrauerfallAn: vi.fn(),
    })

    rendere(ANGEMELDET)

    expect(screen.getByRole('status')).toHaveTextContent('Kein Netz.')
  })

  it('zeigt ohne Fall die Fallweiche', () => {
    rendere(ANGEMELDET)

    expect(screen.getByText('Fallweiche')).toBeVisible()
  })

  it('zeigt den Namen samt Sterbedatum, sobald ein Fall lesbar ist', () => {
    // §2 verlangt den Namen der Person, keinen Sammelbegriff.
    useCase.mockReturnValue({
      zustand: { status: 'bereit', faelle: [LESBAR], aktiver: LESBAR },
      legeTrauerfallAn: vi.fn(),
    })

    rendere(ANGEMELDET)

    expect(
      screen.getByRole('heading', { name: 'Hans Weber · Trauerfall seit 15. März 2024' }),
    ).toBeVisible()
  })

  it('fuehrt von dort zu den Aufgaben und zum Profil', () => {
    // Die untere Leiste aus §7 gibt es noch nicht; die beiden Screens, die es
    // schon gibt, muessen trotzdem erreichbar sein.
    useCase.mockReturnValue({
      zustand: { status: 'bereit', faelle: [LESBAR], aktiver: LESBAR },
      legeTrauerfallAn: vi.fn(),
    })

    rendere(ANGEMELDET)

    expect(screen.getByRole('link', { name: 'Alle Aufgaben' })).toHaveAttribute('href', '/alle')
    expect(screen.getByRole('link', { name: 'Profil und Geräte' })).toHaveAttribute(
      'href',
      '/profil',
    )
  })

  it('zeigt den blossen Namen, wenn kein Sterbedatum bekannt ist', () => {
    const ohneDatum = { ...LESBAR, sterbedatum: null }
    useCase.mockReturnValue({
      zustand: { status: 'bereit', faelle: [ohneDatum], aktiver: ohneDatum },
      legeTrauerfallAn: vi.fn(),
    })

    rendere(ANGEMELDET)

    expect(screen.getByRole('heading', { name: 'Hans Weber' })).toBeVisible()
  })

  it('zeigt bei einem gesperrten Fall den Grund statt des Namens', () => {
    const gesperrt = {
      zustand: 'gesperrt' as const,
      id: 'fall-1',
      grund: 'Für dieses Gerät liegt noch kein Schlüssel vor.',
    }
    useCase.mockReturnValue({
      zustand: { status: 'bereit', faelle: [gesperrt], aktiver: gesperrt },
      legeTrauerfallAn: vi.fn(),
    })

    rendere(ANGEMELDET)

    expect(screen.getByRole('heading', { name: 'Fall gesperrt' })).toBeVisible()
    expect(screen.getByRole('alert')).toHaveTextContent('kein Schlüssel')
    // §3.6: Der Weg zur Freigabe gehoert an diese Stelle und nicht drei Klicks
    // entfernt.
    expect(
      screen.getByRole('link', { name: 'Dieses Gerät freischalten lassen' }),
    ).toHaveAttribute('href', '/geraet-freischalten')
  })

  it('zeigt den Freigabe-Badge, sobald ein Fall gesperrt ist', () => {
    /*
     * §3.6 verlangt den Badge in der unteren Leiste. Die gibt es noch nicht;
     * er steht deshalb am Profil-Weg, der ihren Platz haelt. Ablesbar ist er
     * nur auf dem wartenden Geraet — die Wraps fremder Geraete verbirgt die
     * RLS (§4).
     */
    const gesperrt = { zustand: 'gesperrt' as const, id: 'fall-2', grund: 'Kein Schlüssel.' }
    useCase.mockReturnValue({
      zustand: { status: 'bereit', faelle: [LESBAR, gesperrt], aktiver: LESBAR },
      legeTrauerfallAn: vi.fn(),
    })

    rendere(ANGEMELDET)

    expect(screen.getByText('Freigabe nötig')).toBeVisible()
  })

  it('zeigt keinen Badge, solange jeder Fall lesbar ist', () => {
    useCase.mockReturnValue({
      zustand: { status: 'bereit', faelle: [LESBAR], aktiver: LESBAR },
      legeTrauerfallAn: vi.fn(),
    })

    rendere(ANGEMELDET)

    expect(screen.queryByText('Freigabe nötig')).toBeNull()
  })
})

describe('Routen', () => {
  it('fuehrt /todesfall zur Fallanlage', () => {
    rendere(ANGEMELDET, '/todesfall')

    expect(screen.getByText('Fallanlage')).toBeVisible()
  })

  it('fuehrt /alle zur Aufgabenliste', () => {
    rendere(ANGEMELDET, '/alle')

    expect(screen.getByText('Aufgabenliste')).toBeVisible()
  })

  it('fuehrt /beitreten zum Kopplungscode fuer eine Einladung', () => {
    rendere(ANGEMELDET, '/beitreten')

    expect(screen.getByText('Kopplungscode fuer join')).toBeVisible()
  })

  it('fuehrt /geraet-freischalten zum Kopplungscode fuer ein zweites Geraet', () => {
    // §6: derselbe Ablauf, nur mit `purpose = device` und Einstieg ueber Profil.
    rendere(ANGEMELDET, '/geraet-freischalten')

    expect(screen.getByText('Kopplungscode fuer device')).toBeVisible()
  })

  it('fuehrt /koppeln zur Codeeingabe', () => {
    rendere(ANGEMELDET, '/koppeln')

    expect(screen.getByText('Codeeingabe')).toBeVisible()
  })

  it('fuehrt /profil zum Profil', () => {
    rendere(ANGEMELDET, '/profil')

    expect(screen.getByText('Profilseite')).toBeVisible()
  })

  it('leitet unbekannte Pfade auf die Startseite', () => {
    rendere(ANGEMELDET, '/gibt-es-nicht')

    expect(screen.getByText('Fallweiche')).toBeVisible()
  })
})
