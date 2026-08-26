import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { VORSORGEFRAGEN } from '../../src/content/vorsorgefragen.ts'
import type { Falldaten } from '../../src/hooks/useCase.ts'
import type { Tresordaten } from '../../src/hooks/useTresor.ts'
import type { LesbarerFall } from '../../src/services/fallService.ts'
import type { TresorItem } from '../../src/services/tresorService.ts'
import { rendereMitProvidern } from './harness.tsx'

/**
 * Der Nachlass-Bereich der vorsorgenden Person (DESIGN.md §3.5, §7).
 *
 * Fünf Screens: der Tab „Nachlass", die Erklärung zur Checkliste, das Formular,
 * der Testament-Text und die Übersicht. Geprüft wird, was jeder Screen aus einem
 * Zustand macht — dass die Fragen wörtlich dastehen, dass eine Antwort beim
 * Verlassen des Feldes mit ihrer Kennung gespeichert wird, dass eine
 * gespeicherte Antwort im Feld steht, und dass all das ausschliesslich der
 * vorsorgenden Person begegnet.
 *
 * Verschlüsselt wird eine Ebene tiefer, in `tresorService`; was dort passiert,
 * steht in `tests/services/tresorService.test.ts`.
 */

const navigiere = vi.fn()
const speichereAntwort = vi.fn<Tresordaten['speichereAntwort']>()
const legeItemAn = vi.fn<Tresordaten['legeItemAn']>()
const loescheItem = vi.fn<Tresordaten['loescheItem']>()
const verteileShares = vi.fn()
const legeAn = vi.fn<
  (titel: string, katalog?: string | null, nurFuerMich?: boolean, angaben?: unknown) => Promise<string>
>()

let falldaten: Falldaten
let tresordaten: Tresordaten
let aufgabenZustand: 'laedt' | 'bereit'

vi.mock('react-router-dom', async () => {
  const echt = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return { ...echt, useNavigate: () => navigiere }
})

vi.mock('../../src/hooks/useCase.ts', () => ({ useCase: () => falldaten }))
vi.mock('../../src/hooks/useTresor.ts', () => ({ useTresor: () => tresordaten }))
vi.mock('../../src/hooks/useAufgaben.ts', () => ({
  useAufgaben: () => ({
    zustand:
      aufgabenZustand === 'laedt'
        ? { status: 'laedt' }
        : {
            status: 'bereit',
            aufgaben: [],
            baum: [],
            uebersprungen: 0,
            laedtNetz: false,
            netzfehler: null,
          },
    zeilen: [],
    mutiere: vi.fn(),
    bestaetige: vi.fn(),
    aktualisiere: vi.fn(),
    legeAn,
  }),
}))

const { Antwortuebersicht } = await import(
  '../../src/screens/shared/Nachlassbereich/Antwortuebersicht.tsx'
)
const { Checkliste } = await import('../../src/screens/shared/Nachlassbereich/Checkliste.tsx')
const { Checklistenfragen } = await import(
  '../../src/screens/shared/Nachlassbereich/Checklistenfragen.tsx'
)
const { Nachlassbereich } = await import(
  '../../src/screens/shared/Nachlassbereich/Nachlassbereich.tsx'
)
const { Testament } = await import('../../src/screens/shared/Nachlassbereich/Testament.tsx')

function fall(ueberschreibung: Partial<LesbarerFall> = {}): LesbarerFall {
  return {
    zustand: 'lesbar',
    id: 'fall-1',
    status: 'vorsorge',
    personName: 'Anna Müller',
    sterbedatum: null,
    kid: 'case_fall-1:1',
    keyGeneration: 1,
    rotationPending: false,
    kc: new Uint8Array([1]),
    kcat: new Uint8Array([2]),
    kv: new Uint8Array([3]),
    preparerId: 'user_1',
    vaultCommitment: new Uint8Array([4]),
    vaultResplitPending: false,
    vaultK: null,
    vaultN: 0,
    katalogVersion: null,
    ...ueberschreibung,
  }
}

function setzeFall(eintrag: LesbarerFall) {
  falldaten = {
    zustand: { status: 'bereit', faelle: [eintrag], aktiver: eintrag },
    legeTrauerfallAn: vi.fn(),
    legeVorsorgefallAn: vi.fn(),
    loescheVorsorgefall: vi.fn(),
    verlasseFall: vi.fn(),
    aktualisiere: vi.fn(),
  } as unknown as Falldaten
}

function item(ueberschreibung: Partial<TresorItem> = {}): TresorItem {
  return {
    id: 'item-1',
    titel: 'Haben Sie ein Testament? Wenn ja, wo ist es?',
    inhalt: 'Im Bankschließfach.',
    frageId: 'testament',
    dek: new Uint8Array([9]),
    geaendertAm: '2026-08-24T12:00:00Z',
    ...ueberschreibung,
  }
}

/**
 * Der Wortlaut, wie ihn das DOM zurückgibt.
 *
 * Zwei der Fragen sind mehrzeilig, und Testing Library legt Zeilenumbrüche in
 * Beschriftungen zu Leerzeichen zusammen. Dass die Umbrüche im Dokument
 * wirklich stehen, prüft der Test zum Wortlaut weiter unten.
 */
function beschriftung(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

beforeEach(() => {
  navigiere.mockReset()
  speichereAntwort.mockReset()
  speichereAntwort.mockResolvedValue(undefined)
  legeItemAn.mockReset()
  legeItemAn.mockResolvedValue(undefined)
  loescheItem.mockReset()
  loescheItem.mockResolvedValue(undefined)
  legeAn.mockReset()
  legeAn.mockResolvedValue('aufgabe-7')
  aufgabenZustand = 'bereit'

  setzeFall(fall())

  tresordaten = {
    items: [],
    schwelle: { n: 0, k: null },
    istPreparer: true,
    resplitPending: false,
    legeItemAn,
    aendereItem: vi.fn(),
    speichereAntwort,
    loescheItem,
    verteileShares,
    resplitLaeuft: false,
    resplitFehler: null,
  } as unknown as Tresordaten
})

describe('Der Tab „Nachlass" (§3.5, §7)', () => {
  it('nennt den Tresor-Status und bittet ohne Angehörige um die Einladung', () => {
    rendereMitProvidern(<Nachlassbereich />)

    expect(screen.getByRole('heading', { name: 'Nachlass', level: 1 })).toBeVisible()
    expect(screen.getByText('Versiegelt')).toBeVisible()
    expect(screen.getByText(/Der Tresor ist versiegelt/)).toBeVisible()
    expect(screen.getByRole('button', { name: 'Angehörige einladen' })).toBeVisible()
  })

  it('sagt bei einer angehörigen Person, dass diese allein öffnen kann', () => {
    tresordaten.schwelle = { n: 1, k: 1 }
    rendereMitProvidern(<Nachlassbereich />)

    expect(screen.getByText(/kann diese den Tresor allein öffnen/)).toBeVisible()
  })

  it('nennt bei mehreren Angehörigen die nötigen Freigaben', () => {
    tresordaten.schwelle = { n: 3, k: 2 }
    rendereMitProvidern(<Nachlassbereich />)

    expect(screen.getByText(/Zur Öffnung sind 2 von 3 Freigaben erforderlich/)).toBeVisible()
  })

  it('führt zu den beiden Wegen und trägt den Stand der Checkliste am Weg', () => {
    tresordaten.items = [item()]
    rendereMitProvidern(<Nachlassbereich />)

    expect(screen.getByRole('button', { name: /Aufgabe erstellen/ })).toBeVisible()
    expect(screen.getByRole('link', { name: /Nachlass-Checkliste/ })).toHaveAttribute(
      'href',
      '/nachlass/checkliste',
    )
    expect(screen.getByText(`1 von ${VORSORGEFRAGEN.length}`)).toBeVisible()
  })

  it('öffnet bei Klick auf „Aufgabe erstellen“ den Dialog und legt eine Aufgabe an', async () => {
    rendereMitProvidern(<Nachlassbereich />)

    await userEvent.click(screen.getByRole('button', { name: /Aufgabe erstellen/ }))

    expect(screen.getByRole('dialog')).toBeVisible()
    expect(screen.getByLabelText('Was ist zu tun?')).toBeVisible()

    await userEvent.type(screen.getByLabelText('Was ist zu tun?'), 'Kater füttern')
    await userEvent.click(screen.getByRole('button', { name: 'Aufgabe speichern' }))

    expect(legeAn).toHaveBeenCalledWith('Kater füttern', null, false, {
      fristAm: null,
      beschreibung: '',
    })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('nennt keinen Stand, solange die Zeilen noch laden', () => {
    // „0 von 8" wäre eine Auskunft, die gleich widerrufen wird (§5).
    aufgabenZustand = 'laedt'
    rendereMitProvidern(<Nachlassbereich />)

    expect(screen.queryByText(`0 von ${VORSORGEFRAGEN.length}`)).toBeNull()
  })

  it('bietet den zweiten Versuch an, wenn das Neuverteilen scheitert', async () => {
    tresordaten.resplitFehler = 'Netzwerk weg.'
    verteileShares.mockResolvedValue({ n: 1, k: 1 })
    rendereMitProvidern(<Nachlassbereich />)

    expect(screen.getByRole('alert')).toHaveTextContent(/nicht neu verteilt/)
    await userEvent.click(screen.getByRole('button', { name: 'Erneut versuchen' }))
    expect(verteileShares).toHaveBeenCalled()
  })

  it('lässt Angehörige nicht herein', () => {
    // Ohne `K_v` gibt es hier nichts zu füllen (§3.5). Sie haben ihren eigenen
    // Weg über den Tab „Erbe".
    setzeFall(fall({ kv: null, preparerId: 'user_2' }))
    rendereMitProvidern(<Nachlassbereich />)

    expect(screen.queryByRole('heading', { name: 'Nachlass' })).toBeNull()
  })
})

describe('Die Erklärung zur Nachlass-Checkliste (§3.5)', () => {
  it('sagt, was eine Nachlass-Checkliste ist, und führt zu den Fragen', async () => {
    rendereMitProvidern(<Checkliste />)

    expect(screen.getByRole('heading', { name: 'Was bedeutet das?' })).toBeVisible()
    expect(screen.getByText(/Eine Nachlass-Checkliste ist eine digitale Übersicht/)).toBeVisible()

    await userEvent.click(screen.getByRole('button', { name: 'Weiter zu den Fragen' }))
    expect(navigiere).toHaveBeenCalledWith('/nachlass/checkliste/fragen')
  })
})

describe('Das Formular der Nachlass-Checkliste (§3.5, §7)', () => {
  it('stellt alle Fragen als Beschriftung ihres Feldes', () => {
    rendereMitProvidern(<Checklistenfragen />)

    for (const frage of VORSORGEFRAGEN) {
      expect(screen.getByLabelText(beschriftung(frage.frage))).toBeVisible()
    }
  })

  it('gibt den Wortlaut der Juristinnen unverändert wieder, samt Zeilenumbruch', () => {
    rendereMitProvidern(<Checklistenfragen />)

    const vertraege = VORSORGEFRAGEN.find((frage) => frage.id === 'vertraege')
    if (vertraege === undefined) throw new Error('Die Frage nach den Verträgen fehlt.')

    // `white-space: pre-wrap` setzt "Beispiel: …" auf eine eigene Zeile (§8).
    expect(vertraege.frage).toContain('\nBeispiel: Mietvertrag, Strom, Kfz usw.')

    /*
     * Am `textContent` und nicht über `getByText`: Testing Library legt
     * Zeilenumbrüche beim Suchen zu Leerzeichen zusammen und könnte den
     * Unterschied, um den es hier geht, gar nicht sehen.
     */
    const feld = screen.getByLabelText(beschriftung(vertraege.frage))
    const etikett = document.querySelector(`label[for="${feld.id}"]`)
    expect(etikett?.textContent).toBe(vertraege.frage)
  })

  it('erklärt die Vorsorgevollmacht vor dem Feld und hängt die Erklärung ans Feld', () => {
    rendereMitProvidern(<Checklistenfragen />)

    const erklaerung = screen.getByText(
      'Eine Vorsorgevollmacht bedeutet die Bestimmung einer Vertrauensperson für rechtliche, finanzielle und organisatorische Entscheidungen.',
    )
    const feld = screen.getByLabelText('Haben Sie eine Vorsorgevollmacht? Wenn ja, wo ist sie?')

    expect(erklaerung).toBeVisible()
    expect(feld).toHaveAttribute('aria-describedby', erklaerung.id)
  })

  it('gibt bei der Bestattung Orientierung statt eines leeren Feldes', () => {
    rendereMitProvidern(<Checklistenfragen />)

    expect(screen.getByLabelText('Wünsche für Ihre Bestattung')).toBeVisible()
    expect(screen.getByText(/Wie stellen Sie sich Ihren Abschied vor\?/)).toBeVisible()
  })

  it('zeigt eine gespeicherte Antwort im Feld ihrer Frage', () => {
    tresordaten.items = [item({ inhalt: 'Im Bankschließfach.' })]
    rendereMitProvidern(<Checklistenfragen />)

    expect(screen.getByLabelText('Haben Sie ein Testament? Wenn ja, wo ist es?')).toHaveValue(
      'Im Bankschließfach.',
    )
  })

  it('speichert die Antwort mit ihrer Kennung, sobald das Feld verlassen wird', async () => {
    rendereMitProvidern(<Checklistenfragen />)

    const feld = screen.getByLabelText('Haben Sie Abonnements oder Mitgliedschaften?')
    await userEvent.type(feld, 'Zeitung und Fitnessstudio')
    expect(speichereAntwort).not.toHaveBeenCalled()

    await userEvent.tab()

    expect(speichereAntwort).toHaveBeenCalledWith(
      'abos',
      'Haben Sie Abonnements oder Mitgliedschaften?',
      'Zeitung und Fitnessstudio',
    )
    expect(await screen.findByText('Gespeichert')).toBeVisible()
  })

  it('sagt, dass etwas noch offen ist, solange nicht gespeichert wurde', async () => {
    rendereMitProvidern(<Checklistenfragen />)

    await userEvent.type(
      screen.getByLabelText('Haben Sie Abonnements oder Mitgliedschaften?'),
      'Zeitung',
    )

    expect(screen.getByText('Noch nicht gespeichert')).toBeVisible()
  })

  it('schreibt nichts, wenn ein Feld unverändert verlassen wird', async () => {
    tresordaten.items = [item({ inhalt: 'Im Bankschließfach.' })]
    rendereMitProvidern(<Checklistenfragen />)

    await userEvent.click(screen.getByLabelText('Haben Sie ein Testament? Wenn ja, wo ist es?'))
    await userEvent.tab()

    expect(speichereAntwort).not.toHaveBeenCalled()
  })

  it('behält die Antwort und bietet den zweiten Versuch an, wenn es schiefgeht', async () => {
    speichereAntwort.mockRejectedValue(new Error('Keine Verbindung.'))
    rendereMitProvidern(<Checklistenfragen />)

    const feld = screen.getByLabelText('Haben Sie Abonnements oder Mitgliedschaften?')
    await userEvent.type(feld, 'Zeitung')
    await userEvent.tab()

    expect(await screen.findByText(/Nicht gespeichert: Keine Verbindung/)).toBeVisible()
    expect(feld).toHaveValue('Zeitung')

    speichereAntwort.mockResolvedValue(undefined)
    await userEvent.click(screen.getByRole('button', { name: 'Erneut speichern' }))
    expect(speichereAntwort).toHaveBeenCalledTimes(2)
  })

  it('führt unter der Testamentfrage zum Erklärtext', async () => {
    rendereMitProvidern(<Checklistenfragen />)

    expect(
      screen.getByText('Sie haben kein Testament? Möchten Sie eines verfassen?'),
    ).toBeVisible()

    await userEvent.click(screen.getByRole('button', { name: 'Ja – wie geht das?' }))
    expect(navigiere).toHaveBeenCalledWith('/nachlass/checkliste/testament')
  })

  it('nennt den Stand und führt ganz unten in die Übersicht', async () => {
    tresordaten.items = [item()]
    rendereMitProvidern(<Checklistenfragen />)

    expect(screen.getByText(new RegExp(`1 von ${VORSORGEFRAGEN.length} beantwortet`))).toBeVisible()

    await userEvent.click(
      screen.getByRole('button', { name: 'Übersicht aller Antworten anzeigen' }),
    )
    expect(navigiere).toHaveBeenCalledWith('/nachlass/checkliste/uebersicht')
  })

  it('legt einen freien Eintrag unter „Weitere Einträge" an', async () => {
    rendereMitProvidern(<Checklistenfragen />)

    await userEvent.click(screen.getByRole('button', { name: 'Eintrag hinzufügen' }))
    await userEvent.type(screen.getByLabelText('Titel'), 'Bankverbindung')
    await userEvent.type(screen.getByLabelText('Inhalt'), 'DE12 3456')
    await userEvent.click(screen.getByRole('button', { name: 'Im Tresor speichern' }))

    expect(legeItemAn).toHaveBeenCalledWith('Bankverbindung', 'DE12 3456')
  })

  it('hält die Antworten auf Fragen aus den freien Einträgen heraus', () => {
    tresordaten.items = [item()]
    rendereMitProvidern(<Checklistenfragen />)

    // Die Antwort steht oben bei ihrer Frage und nicht ein zweites Mal darunter.
    expect(screen.queryByText('1 Eintrag')).toBeNull()
  })

  it('löscht einen freien Eintrag erst nach der Rückfrage', async () => {
    tresordaten.items = [item({ id: 'item-2', titel: 'Bankverbindung', frageId: null })]
    rendereMitProvidern(<Checklistenfragen />)

    await userEvent.click(screen.getByRole('button', { name: '„Bankverbindung“ löschen' }))
    expect(loescheItem).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole('button', { name: 'Ja, Eintrag löschen' }))
    expect(loescheItem).toHaveBeenCalled()
  })

  it('wartet auf den Sync-Stream, bevor das Formular dasteht', () => {
    aufgabenZustand = 'laedt'
    rendereMitProvidern(<Checklistenfragen />)

    expect(screen.getByRole('status')).toHaveTextContent('Ihre Checkliste wird geladen')
    expect(screen.queryByLabelText('Haben Sie Abonnements oder Mitgliedschaften?')).toBeNull()
  })
})

describe('Der Testament-Erklärtext (§3.5, §8)', () => {
  it('gibt den Wortlaut der Juristinnen wieder und führt zurück ins Formular', async () => {
    rendereMitProvidern(<Testament />)

    expect(
      screen.getByRole('heading', { name: 'So verfassen Sie ein Testament', level: 1 }),
    ).toBeVisible()
    expect(screen.getByRole('heading', { name: 'Was zu beachten ist' })).toBeVisible()
    expect(
      screen.getByText('handschriftlich von der verstorbenen Person geschrieben'),
    ).toBeVisible()

    // Die Aufzählung ist eine Liste und keine Zeichen im Text (§7).
    expect(screen.getAllByRole('listitem').length).toBeGreaterThanOrEqual(4)

    await userEvent.click(screen.getByRole('button', { name: 'Zurück zum Formular' }))
    expect(navigiere).toHaveBeenCalledWith('/nachlass/checkliste/fragen')
  })
})

describe('Die Übersicht aller Antworten (§3.5)', () => {
  it('zeigt jede Frage mit ihrer Antwort und benennt die offenen', () => {
    tresordaten.items = [item()]
    rendereMitProvidern(<Antwortuebersicht />)

    expect(screen.getByRole('heading', { name: 'Ihre Antworten', level: 1 })).toBeVisible()
    expect(screen.getByText('Im Bankschließfach.')).toBeVisible()

    // Eine Übersicht, aus der die Lücken verschwinden, ist keine Übersicht.
    expect(screen.getAllByText('Noch nicht beantwortet')).toHaveLength(
      VORSORGEFRAGEN.length - 1,
    )
  })

  it('nimmt die freien Einträge mit auf', () => {
    tresordaten.items = [
      item({ id: 'item-2', titel: 'Bankverbindung', inhalt: 'DE12 3456', frageId: null }),
    ]
    rendereMitProvidern(<Antwortuebersicht />)

    expect(screen.getByRole('heading', { name: 'Weitere Einträge' })).toBeVisible()
    expect(screen.getByText('DE12 3456')).toBeVisible()
  })

  it('ändert nichts, sondern führt zum Bearbeiten zurück ins Formular', async () => {
    rendereMitProvidern(<Antwortuebersicht />)

    expect(screen.queryByRole('textbox')).toBeNull()

    await userEvent.click(screen.getByRole('button', { name: 'Antworten bearbeiten' }))
    expect(navigiere).toHaveBeenCalledWith('/nachlass/checkliste/fragen')
  })
})
