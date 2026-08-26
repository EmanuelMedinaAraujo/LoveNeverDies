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
vi.mock('../../src/screens/shared/Nachlassbereich/Nachlassbereich.tsx', () => ({
  Nachlassbereich: () => <p>Nachlassbereich</p>,
}))
vi.mock('../../src/screens/shared/Nachlassbereich/Checkliste.tsx', () => ({
  Checkliste: () => <p>Checklistenerklaerung</p>,
}))
vi.mock('../../src/screens/shared/Nachlassbereich/Checklistenfragen.tsx', () => ({
  Checklistenfragen: () => <p>Checklistenformular</p>,
}))
vi.mock('../../src/screens/shared/Nachlassbereich/Testament.tsx', () => ({
  Testament: () => <p>Testamenttext</p>,
}))
vi.mock('../../src/screens/shared/Nachlassbereich/Antwortuebersicht.tsx', () => ({
  Antwortuebersicht: () => <p>Antwortuebersicht</p>,
}))
vi.mock('../../src/screens/shared/Erbe/Erbe.tsx', () => ({ Erbe: () => <p>Erbeseite</p> }))
vi.mock('../../src/screens/shared/Konto/Konto.tsx', () => ({
  Konto: () => <p>Kontoeinstellungen</p>,
}))

/*
 * Die untere Leiste steht unter den vier Hauptscreens (§7). Was sie zeigt,
 * hängt am Fallzustand, und den holt sie sich über `useCase`. Hier ist er
 * ersetzt: Welche Route zu welchem Screen führt, hat mit Fällen nichts zu tun.
 * Was der Rahmen aus dem Zustand liest, steht in `Rahmen.test.tsx`.
 */
let fallZustand: { status: string; faelle?: unknown[]; aktiver?: unknown } = { status: 'laedt' }

vi.mock('../../src/hooks/useCase.ts', () => ({
  useCase: () => ({
    zustand: fallZustand,
    legeTrauerfallAn: vi.fn(),
    legeVorsorgefallAn: vi.fn(),
    loescheVorsorgefall: vi.fn(),
    verlasseFall: vi.fn(),
    aktualisiere: vi.fn(),
  }),
}))

/*
 * §3.5: Der eigene Vorsorgefall. Er hat `K_v`, und daran erkennt die App die
 * vorsorgende Person — die Einzige, die eine andere untere Leiste und einen
 * anderen ersten Screen bekommt.
 */
const VORSORGEFALL = {
  zustand: 'lesbar',
  id: 'fall-1',
  status: 'vorsorge',
  kv: new Uint8Array([1]),
}

function alsVorsorgende() {
  fallZustand = { status: 'bereit', faelle: [VORSORGEFALL], aktiver: VORSORGEFALL }
}

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
  fallZustand = { status: 'laedt' }
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

    await waitFor(() => {
      expect(speicherDauerhaftAnfordern).toHaveBeenCalledTimes(1)
    })
  })
})

describe('Routen fuer angemeldete Nutzer (§7)', () => {
  it('fuehrt / zur Startseite, mit unterer Leiste', () => {
    rendere(ANGEMELDET, '/')

    expect(screen.getByText('Startseite')).toBeVisible()
    expect(screen.getByRole('navigation', { name: 'Hauptbereiche' })).toBeVisible()
  })

  it('fuehrt /alle zur Aufgabenliste, mit unterer Leiste', () => {
    rendere(ANGEMELDET, '/alle')

    expect(screen.getByText('Aufgabenliste')).toBeVisible()
    expect(screen.getByRole('navigation', { name: 'Hauptbereiche' })).toBeVisible()
  })

  it('fuehrt /profil zur Profilseite, mit unterer Leiste', () => {
    rendere(ANGEMELDET, '/profil')

    expect(screen.getByText('Profilseite')).toBeVisible()
    expect(screen.getByRole('navigation', { name: 'Hauptbereiche' })).toBeVisible()
  })

  it('fuehrt /todesfall zur Fallanlage, ohne untere Leiste', () => {
    rendere(ANGEMELDET, '/todesfall')

    expect(screen.getByText('Fallanlage')).toBeVisible()
    expect(screen.queryByRole('navigation', { name: 'Hauptbereiche' })).toBeNull()
  })

  it('fuehrt /beitreten und /geraet-freischalten auf denselben Screen, mit dem jeweiligen Zweck', () => {
    /*
     * Zwei Einstiege, zwei Zwecke (§6), ein Screen. Einladungen kommen von
     * ausserhalb des Falls („Ich wurde eingeladen"); Freischaltungen von
     * innerhalb („Dieses Gerät freischalten").
     */
    const beitreten = rendere(ANGEMELDET, '/beitreten')
    expect(screen.getByText('Kopplungscode fuer join')).toBeVisible()
    expect(screen.queryByRole('navigation', { name: 'Hauptbereiche' })).toBeNull()
    beitreten.unmount()

    const freischalten = rendere(ANGEMELDET, '/geraet-freischalten')
    expect(screen.getByText('Kopplungscode fuer device')).toBeVisible()
    expect(screen.queryByRole('navigation', { name: 'Hauptbereiche' })).toBeNull()
    freischalten.unmount()
  })

  it('fuehrt /koppeln zur Codeeingabe, ohne untere Leiste', () => {
    rendere(ANGEMELDET, '/koppeln')

    expect(screen.getByText('Codeeingabe')).toBeVisible()
    expect(screen.queryByRole('navigation', { name: 'Hauptbereiche' })).toBeNull()
  })

  it('fuehrt /aufgabe/:id zum Detail, mit unterer Leiste', () => {
    rendere(ANGEMELDET, '/aufgabe/item-1')

    expect(screen.getByText('Aufgabendetail')).toBeVisible()
    expect(screen.getByRole('navigation', { name: 'Hauptbereiche' })).toBeVisible()
  })

  it('fuehrt /konto zu den Kontoeinstellungen, ohne untere Leiste', () => {
    /*
     * Clerks Oberflaeche bringt eine eigene Navigation mit. Zwei Navigationen
     * auf einem Bildschirm geben auf dieselbe Frage zwei Antworten (§7).
     */
    rendere(ANGEMELDET, '/konto')

    expect(screen.getByText('Kontoeinstellungen')).toBeVisible()
    expect(screen.queryByRole('navigation', { name: 'Hauptbereiche' })).toBeNull()
  })

  it('leitet unbekannte Pfade auf die Startseite', () => {
    rendere(ANGEMELDET, '/gibt-es-nicht')

    expect(screen.getByText('Startseite')).toBeVisible()
  })
})

/**
 * Der Nachlass-Bereich im eigenen Vorsorgefall (DESIGN.md §3.5, §7).
 *
 * Nur `/nachlass` steht im `Rahmen` und trägt die untere Leiste; alles
 * darunter ist ein linearer Ablauf mit genau einem nächsten Schritt und steht
 * ohne sie — wie Todesfall, Koppeln und der Fragebaum.
 */
describe('Der Nachlass-Bereich (§3.5)', () => {
  const WEGE = [
    { pfad: '/nachlass/checkliste', text: 'Checklistenerklaerung' },
    { pfad: '/nachlass/checkliste/fragen', text: 'Checklistenformular' },
    { pfad: '/nachlass/checkliste/testament', text: 'Testamenttext' },
    { pfad: '/nachlass/checkliste/uebersicht', text: 'Antwortuebersicht' },
  ]

  it('fuehrt /nachlass zum Bereich, mit unterer Leiste', () => {
    alsVorsorgende()
    rendere(ANGEMELDET, '/nachlass')

    expect(screen.getByText('Nachlassbereich')).toBeVisible()
    expect(screen.getByRole('navigation', { name: 'Hauptbereiche' })).toBeVisible()
  })

  for (const weg of WEGE) {
    it(`fuehrt ${weg.pfad} ohne untere Leiste zum passenden Screen`, () => {
      alsVorsorgende()
      rendere(ANGEMELDET, weg.pfad)

      expect(screen.getByText(weg.text)).toBeVisible()
      expect(screen.queryByRole('navigation', { name: 'Hauptbereiche' })).toBeNull()
    })
  }

  it('schickt die vorsorgende Person von / in den Nachlass-Bereich', () => {
    /*
     * „Start" wäre für sie auf Dauer der Satz "Für Sie ist gerade nichts
     * eingetragen". Die Adresse bleibt erreichbar — über ein Lesezeichen, über
     * eine installierte App, die dort neu startet —, führt aber weiter.
     */
    alsVorsorgende()
    rendere(ANGEMELDET, '/')

    expect(screen.getByText('Nachlassbereich')).toBeVisible()
    expect(screen.queryByText('Startseite')).toBeNull()
  })

  it('schickt die vorsorgende Person auch von /erbe dorthin', () => {
    alsVorsorgende()
    rendere(ANGEMELDET, '/erbe')

    expect(screen.getByText('Nachlassbereich')).toBeVisible()
    expect(screen.queryByText('Erbeseite')).toBeNull()
  })

  it('laesst alle anderen auf ihren gewohnten Screens', () => {
    // Ohne `K_v` ist es nicht der eigene Vorsorgefall (§3.5).
    const angehoerige = { ...VORSORGEFALL, kv: null }
    fallZustand = { status: 'bereit', faelle: [angehoerige], aktiver: angehoerige }

    rendere(ANGEMELDET, '/erbe')

    expect(screen.getByText('Erbeseite')).toBeVisible()
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
