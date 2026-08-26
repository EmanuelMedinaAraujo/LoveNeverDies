import { render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthKontextProvider, type AuthZustand } from '../../src/core/auth/authProvider.ts'
import { ansichtSchreiben, ansichtZuruecksetzen } from '../../src/core/storage/ansicht.ts'
import { authWert } from '../screens/harness.tsx'

/**
 * Der Anmeldezustand und das Routing aus DESIGN.md §7.
 *
 * Alle Screens sind ersetzt: Was sie zeigen, steht in ihren eigenen Tests. Hier
 * geht es um die Weiche davor, ob angemeldet oder nicht, um die Routen und
 * darum, dass §7 nach der Anmeldung `navigator.storage.persist()` still
 * mitlaufen lässt.
 *
 * Die Fallsperre steht in `Start.test.tsx`. Sie gehört zu dem Screen, der
 * sie zeigt: Ohne Fall ist die App gesperrt, und das ist der Startbildschirm
 * mit seiner Fallweiche (§7).
 *
 * Dazu die Ansichtswahl: Sie steht vor der Fallweiche, und danach entscheidet
 * sie, welcher der beiden Screen-Bäume die Routen füllt (§7).
 */

const useGeraeteanmeldung = vi.fn()
const useProfilAbgleich = vi.fn()
const speicherDauerhaftAnfordern = vi.fn().mockResolvedValue('gewaehrt')

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
vi.mock('../../src/screens/erweitert/Start/Start.tsx', () => ({ Start: () => <p>Startseite</p> }))
vi.mock('../../src/screens/erweitert/Alle/Alle.tsx', () => ({ Alle: () => <p>Aufgabenliste</p> }))
vi.mock('../../src/screens/erweitert/Aufgabe/Aufgabe.tsx', () => ({
  Aufgabe: () => <p>Aufgabendetail</p>,
}))
vi.mock('../../src/screens/einfach/Start/Start.tsx', () => ({
  Start: () => <p>Startseite einfach</p>,
}))
vi.mock('../../src/screens/einfach/Alle/Alle.tsx', () => ({
  Alle: () => <p>Aufgabenliste einfach</p>,
}))
vi.mock('../../src/screens/einfach/Aufgabe/Aufgabe.tsx', () => ({
  Aufgabe: () => <p>Aufgabendetail einfach</p>,
}))
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

/*
 * Die untere Leiste steht unter den vier Hauptscreens (§7). Was sie zeigt,
 * hängt am Fallzustand, und den holt sie sich über `useCase`. Hier ist er
 * ersetzt: Welche Route zu welchem Screen führt, hat mit Fällen nichts zu tun.
 * Was der Rahmen aus dem Zustand liest, steht in `Rahmen.test.tsx`.
 */
vi.mock('../../src/hooks/useCase.ts', () => ({
  useCase: () => ({
    zustand: { status: 'laedt' },
    legeTrauerfallAn: vi.fn(),
    legeVorsorgefallAn: vi.fn(),
    loescheVorsorgefall: vi.fn(),
    verlasseFall: vi.fn(),
    aktualisiere: vi.fn(),
  }),
}))

const { App } = await import('../../src/app/App.tsx')

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
  useGeraeteanmeldung.mockReturnValue({ status: 'laedt' })
  useProfilAbgleich.mockReturnValue({ status: 'bereit' })

  localStorage.clear()
  ansichtZuruecksetzen()
  delete document.documentElement.dataset.dichte
  delete document.documentElement.dataset.farbschema
  delete document.documentElement.dataset.textgroesse

  /*
   * Die Routentests unten prüfen die Wege, nicht die Ansichtswahl. Sie ist
   * deshalb getroffen; ohne sie stünde vor jeder Route das Onboarding.
   */
  ansichtSchreiben({ modus: 'erweitert' })
})

describe('Anmeldezustand', () => {
  it('zeigt einen Hinweis, solange die Sitzung geladen wird', () => {
    rendere({ status: 'laedt' })

    expect(screen.getByRole('status')).toHaveTextContent('Einen Moment bitte')
  })

  it('zeigt ausschliesslich die Anmeldung, wer nicht angemeldet ist', () => {
    rendere({ status: 'abgemeldet' })

    expect(screen.getByText('Anmeldeformular')).toBeVisible()
    expect(screen.queryByText('Startseite')).toBeNull()
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

  it('fragt die Ansicht vor der Fallweiche, mit "Einfach" vorausgewaehlt', () => {
    // §7: Ohne getroffene Wahl kommt niemand an dieser Frage vorbei.
    localStorage.clear()
    ansichtZuruecksetzen()

    rendere(ANGEMELDET, '/alle')

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      'Wie möchten Sie die App nutzen?',
    )
    expect(screen.queryByText('Aufgabenliste')).toBeNull()
    expect(screen.getByRole('radio', { name: /Einfach/ })).toBeChecked()
  })

  it('rendert bis zur Wahl in der einfachen Dichte', async () => {
    localStorage.clear()
    ansichtZuruecksetzen()

    rendere(ANGEMELDET)

    await waitFor(() => {
      expect(document.documentElement.dataset.dichte).toBe('einfach')
    })
  })

  it('setzt die Overrides aus Profil an die Wurzel, "system" gar nicht', async () => {
    /*
     * §7: "ein Override, der auf 'Systemeinstellung folgen' steht". Steht er
     * dort, steht an der Wurzel nichts, und `prefers-color-scheme` entscheidet
     * weiter allein.
     */
    rendere(ANGEMELDET)

    await waitFor(() => expect(document.documentElement.dataset.dichte).toBe('erweitert'))
    expect(document.documentElement.dataset.farbschema).toBeUndefined()
    expect(document.documentElement.dataset.textgroesse).toBeUndefined()

    ansichtSchreiben({ darstellung: 'dunkel', textgroesse: 'sehr-gross' })

    await waitFor(() => {
      expect(document.documentElement.dataset.farbschema).toBe('dunkel')
      expect(document.documentElement.dataset.textgroesse).toBe('sehr-gross')
    })
  })
})

describe('Routen', () => {
  it('fuehrt / zu "Meine Aufgaben"', () => {
    rendere(ANGEMELDET)

    expect(screen.getByText('Startseite')).toBeVisible()
  })

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

  it('fuehrt /aufgabe/:id zum Aufgabendetail mit unterer Leiste', () => {
    rendere(ANGEMELDET, '/aufgabe/item-1')

    expect(screen.getByText('Aufgabendetail')).toBeVisible()
    expect(screen.getByRole('navigation', { name: 'Hauptbereiche' })).toBeVisible()
  })

  it('leitet unbekannte Pfade auf die Startseite', () => {
    rendere(ANGEMELDET, '/gibt-es-nicht')

    expect(screen.getByText('Startseite')).toBeVisible()
  })
})

/**
 * §7: "Getrennte Screen-Bäume für Start, Aufgabe und Alle." Dieselben Pfade,
 * dieselbe Reihenfolge, andere Screens — damit Angehörige einander am Telefon
 * helfen können.
 */
describe('Zwei Ansichten', () => {
  const WEGE = [
    { pfad: '/', erweitert: 'Startseite', einfach: 'Startseite einfach' },
    { pfad: '/alle', erweitert: 'Aufgabenliste', einfach: 'Aufgabenliste einfach' },
    { pfad: '/aufgabe/item-1', erweitert: 'Aufgabendetail', einfach: 'Aufgabendetail einfach' },
  ]

  for (const weg of WEGE) {
    it(`zeigt unter ${weg.pfad} je nach Modus den passenden Screen`, () => {
      const erweitert = rendere(ANGEMELDET, weg.pfad)
      expect(screen.getByText(weg.erweitert)).toBeVisible()
      erweitert.unmount()

      ansichtSchreiben({ modus: 'einfach' })

      rendere(ANGEMELDET, weg.pfad)
      expect(screen.getByText(weg.einfach)).toBeVisible()
      expect(screen.queryByText(weg.erweitert)).toBeNull()
    })
  }

  it('laesst Erbe und Profil genau einmal stehen', () => {
    // §7: Dort liegen die unumkehrbaren Abläufe; ein zweiter
    // Bestätigungsdialog wäre ein Risiko ohne Gegenwert.
    ansichtSchreiben({ modus: 'einfach' })

    rendere(ANGEMELDET, '/profil')

    expect(screen.getByText('Profilseite')).toBeVisible()
  })
})
