import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AufgabenZustand, Aufgabendaten } from '../../src/hooks/useAufgaben.ts'
import type { Falldaten } from '../../src/hooks/useCase.ts'
import type { Erinnerungsdaten } from '../../src/hooks/useErinnerungen.ts'
import type { Aufgabe, Katalogherkunft } from '../../src/services/aufgabenService.ts'
import { baueBaum } from '../../src/services/aufgabenbaum.ts'
import type { LesbarerFall } from '../../src/services/fallService.ts'
import { BENUTZER, Huelle, rendereMitProvidern } from './harness.tsx'
import { personen } from '../../src/services/zuweisung.ts'

const useCase = vi.fn<() => Falldaten>()
const useAufgaben = vi.fn<() => Aufgabendaten>()

vi.mock('../../src/hooks/useCase.ts', () => ({ useCase: () => useCase() }))
vi.mock('../../src/hooks/useAufgaben.ts', () => ({ useAufgaben: () => useAufgaben() }))

const { Alle } = await import('../../src/screens/erweitert/Alle/Alle.tsx')

/**
 * Der Tab "Alle" (DESIGN.md §7).
 *
 * Der Screen verschlüsselt nichts. Das tut `aufgabenService`, geprüft in
 * `tests/services/aufgabenService.test.ts`. Hier geht es darum, was er aus
 * einem Zustand macht: welche Schaltflächen es gibt, was vor dem Löschen
 * gefragt wird und was passiert, wenn eine Änderung abgelehnt wird.
 */

const LESBAR: LesbarerFall = {
  zustand: 'lesbar',
  id: 'fall-1',
  status: 'trauerfall',
  personName: 'Hans Weber',
  sterbedatum: '2024-03-15',
  kid: 'case_fall-1:1',
  keyGeneration: 1,
  rotationPending: false,
  kc: new Uint8Array([1]),
  kcat: new Uint8Array([2]),
  kv: null,
  preparerId: null,
  vaultCommitment: null,
  vaultResplitPending: false,
  vaultK: null,
  vaultN: null,
  katalogVersion: '2026-08+testtest',
}

function aufgabe(ueberschreibung: Partial<Aufgabe> = {}): Aufgabe {
  return {
    id: 'item-1',
    titel: 'Sterbeurkunde beantragen',
    beschreibung: '',
    erledigt: false,
    notizen: '',
    parentId: null,
    dependsOn: [],
    assignee: personen([{ userId: BENUTZER.id, name: BENUTZER.anzeigename }]),
    fristAm: null,
    katalog: null,
    dek: new Uint8Array([9]),
    kid: LESBAR.kid,
    privat: false,
    ...ueberschreibung,
  }
}

function falldaten(ueberschreibung: Partial<Falldaten> = {}): Falldaten {
  return {
    zustand: { status: 'bereit', faelle: [LESBAR], aktiver: LESBAR },
    legeTrauerfallAn: vi.fn().mockResolvedValue(undefined),
    legeVorsorgefallAn: vi.fn().mockResolvedValue(undefined),
    loescheVorsorgefall: vi.fn().mockResolvedValue(undefined),
    verlasseFall: vi.fn().mockResolvedValue(undefined),
    aktualisiere: vi.fn(),
    ...ueberschreibung,
  }
}

/**
 * Der Ruhezustand des Netzes: kein Abruf unterwegs, nichts schiefgegangen.
 *
 * Steht als eigene Konstante da, weil §5 beides zur "bereit"-Form gehören
 * lässt: Die Liste steht, und daneben steht, was das Netz gerade tut.
 */
const NETZ = { laedtNetz: false, netzfehler: null }

/**
 * Der Zustand, wie ein Test ihn hinschreibt: ohne `baum`.
 *
 * Den rechnet {@link aufgabendaten} daraus aus, denn er ist keine zweite
 * Angabe: `useAufgaben` leitet ihn aus derselben Liste ab (§7). Ein von Hand
 * gepflegter Baum könnte der Liste widersprechen, und dann prüfte der Test
 * einen Zustand, den es nie gibt.
 */
type RohZustand =
  | { status: 'laedt' }
  | Omit<Extract<AufgabenZustand, { status: 'bereit' }>, 'baum'>

const ERINNERUNGEN: Erinnerungsdaten = {
  erlaubnis: 'nicht-verfuegbar',
  frage: vi.fn().mockResolvedValue(undefined),
  geplant: 0,
}

function aufgabendaten(
  ueberschreibung: Partial<Omit<Aufgabendaten, 'zustand'>> & { zustand?: RohZustand } = {},
): Aufgabendaten {
  const { zustand = { status: 'bereit', aufgaben: [aufgabe()], uebersprungen: 0, ...NETZ }, ...rest } =
    ueberschreibung

  return {
    zustand:
      zustand.status === 'laedt' ? zustand : { ...zustand, baum: baueBaum(zustand.aufgaben) },
    zeilen: [],
    mutiere: vi.fn(),
    aktualisiere: vi.fn(),
    erinnerungen: ERINNERUNGEN,
    abgelehnt: [],
    bestaetige: vi.fn(),
    legeAn: vi.fn().mockResolvedValue(undefined),
    schreibe: vi.fn().mockResolvedValue(undefined),
    hakeAb: vi.fn().mockResolvedValue(undefined),
    loesche: vi.fn().mockResolvedValue(undefined),
    ich: { userId: BENUTZER.id, name: BENUTZER.anzeigename },
    uebernimm: vi.fn().mockResolvedValue(undefined),
    gibFrei: vi.fn().mockResolvedValue(undefined),
    weiseZu: vi.fn().mockResolvedValue(undefined),
    uebernahmen: [],
    bestaetigeUebernahmen: vi.fn(),
    gibFuerAlleFrei: vi.fn().mockResolvedValue(undefined),
    fristbezug: { sterbedatum: LESBAR.sterbedatum, kenntnisAm: null, anfechtungKenntnisAm: null },
    nachlass: [],
    setzeKenntnisAm: vi.fn().mockResolvedValue(undefined),
    setzeAnfechtungKenntnisAm: vi.fn().mockResolvedValue(undefined),
    fragebaum: null,
    fragebaumGeladen: true,
    speichereFragebaum: vi.fn().mockResolvedValue(undefined),
    fragebaumAufgabe: () => null,
    legeFragebaumAufgabeAn: vi.fn().mockResolvedValue(undefined),
    ...rest,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  useCase.mockReturnValue(falldaten())
  useAufgaben.mockReturnValue(aufgabendaten())
})

describe('Alle', () => {
  it('zeigt die Aufgaben des Falls', () => {
    rendereMitProvidern(<Alle />)

    expect(screen.getByRole('heading', { name: 'Alle Aufgaben' })).toBeVisible()
    expect(screen.getByRole('checkbox', { name: 'Sterbeurkunde beantragen' })).toBeVisible()
  })

  it('sagt es, solange noch nichts da ist', () => {
    useAufgaben.mockReturnValue(
      aufgabendaten({ zustand: { status: 'bereit', aufgaben: [], uebersprungen: 0, ...NETZ } }),
    )

    rendereMitProvidern(<Alle />)

    expect(screen.getByText(/Hier ist noch nichts/)).toBeVisible()
  })

  it('legt eine Aufgabe an und leert danach das Feld', async () => {
    const legeAn = vi.fn().mockResolvedValue(undefined)
    useAufgaben.mockReturnValue(aufgabendaten({ legeAn }))

    rendereMitProvidern(<Alle />)

    const feld = screen.getByLabelText('Neue Aufgabe')
    await userEvent.type(feld, 'Konten kündigen')
    await userEvent.click(screen.getByRole('button', { name: 'Aufgabe hinzufügen' }))

    await waitFor(() => expect(legeAn).toHaveBeenCalledWith('Konten kündigen', null, false))
    expect(feld).toHaveValue('')
  })

  it('hakt eine Aufgabe ab', async () => {
    const hakeAb = vi.fn().mockResolvedValue(undefined)
    useAufgaben.mockReturnValue(aufgabendaten({ hakeAb }))

    rendereMitProvidern(<Alle />)

    await userEvent.click(screen.getByRole('checkbox', { name: 'Sterbeurkunde beantragen' }))

    await waitFor(() => expect(hakeAb).toHaveBeenCalledWith(aufgabe(), true))
  })

  it('laesst das Haekchen stehen, bis der Bestand nachgezogen hat', async () => {
    /*
     * §5: Jede Mutation wird optimistisch lokal angewandt, nur passiert das
     * eine Ebene tiefer, in der Queue, und der Weg dorthin kostet ein paar
     * Millisekunden. Eine Checkbox, die in dieser Zeit auf `erledigt: false`
     * zurückfällt, ist genau das sichtbare Zurückspringen, das §5 ausschliesst.
     */
    let gibFrei = () => {}
    const hakeAb = vi.fn(
      () =>
        new Promise<void>((aufloesen) => {
          gibFrei = aufloesen
        }),
    )
    useAufgaben.mockReturnValue(aufgabendaten({ hakeAb }))

    rendereMitProvidern(<Alle />)

    const kaestchen = screen.getByRole('checkbox', { name: 'Sterbeurkunde beantragen' })
    await userEvent.click(kaestchen)

    // Der Zustand sagt weiterhin `erledigt: false`; die Zeile hält den Wunsch.
    expect(kaestchen).toBeChecked()

    gibFrei()
  })

  it('nimmt das Haekchen zurueck, wenn die Mutation gar nicht erst angehaengt wurde', async () => {
    /*
     * Der Bestand zieht nur nach, wenn etwas in der Queue gelandet ist. Kommt
     * es nicht so weit, etwa wegen fehlendem Platz in IndexedDB, bleibt
     * `erledigt: false` stehen, und ein Abgleich gegen den Bestand fände nie
     * einen Unterschied. Ohne die Ruecknahme hier stuende das Haekchen fuer den
     * Rest der Sitzung auf einem Wert, den niemand gespeichert hat: die Meldung
     * darueber sagte "ging nicht", das Kaestchen daneben sagte "erledigt".
     */
    const hakeAb = vi
      .fn()
      .mockRejectedValue(new Error('Die Änderung war nicht zwischenzuspeichern.'))
    useAufgaben.mockReturnValue(aufgabendaten({ hakeAb }))

    rendereMitProvidern(<Alle />)

    const kaestchen = screen.getByRole('checkbox', { name: 'Sterbeurkunde beantragen' })
    await userEvent.click(kaestchen)

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Die Änderung war nicht zwischenzuspeichern.',
      ),
    )

    expect(kaestchen).not.toBeChecked()
  })

  it('nimmt das Haekchen zurueck, sobald der Bestand es zurueckweist', async () => {
    // Und die Führung gibt die Zeile wieder ab: Bleibt das Häkchen stehen,
    // obwohl der Server die Änderung verworfen hat, sieht jemand ein Häkchen,
    // das nirgends gespeichert ist.
    const { rerender } = rendereMitProvidern(<Alle />)

    const kaestchen = screen.getByRole('checkbox', { name: 'Sterbeurkunde beantragen' })
    await userEvent.click(kaestchen)
    expect(kaestchen).toBeChecked()

    // Der Bestand zieht nach: erst mit der Änderung, dann ohne sie.
    useAufgaben.mockReturnValue(
      aufgabendaten({
        zustand: {
          status: 'bereit',
          aufgaben: [aufgabe({ erledigt: true })],
          uebersprungen: 0,
          ...NETZ,
        },
      }),
    )
    rerender(
      <Huelle>
        <Alle />
      </Huelle>,
    )
    // §7: Erledigt wandert ans Ende und ist zu Anfang eingeklappt; erst
    // aufklappen, um das Häkchen wiederzufinden.
    await userEvent.click(screen.getByRole('button', { name: '1 erledigte Aufgabe anzeigen' }))
    expect(screen.getByRole('checkbox', { name: 'Sterbeurkunde beantragen' })).toBeChecked()

    useAufgaben.mockReturnValue(aufgabendaten())
    rerender(
      <Huelle>
        <Alle />
      </Huelle>,
    )
    expect(screen.getByRole('checkbox', { name: 'Sterbeurkunde beantragen' })).not.toBeChecked()
  })

  it('nimmt das Haekchen wieder zurueck', async () => {
    const hakeAb = vi.fn().mockResolvedValue(undefined)
    useAufgaben.mockReturnValue(
      aufgabendaten({
        hakeAb,
        zustand: {
          status: 'bereit',
          aufgaben: [aufgabe({ erledigt: true })],
          uebersprungen: 0,
          ...NETZ,
        },
      }),
    )

    rendereMitProvidern(<Alle />)

    // §7: Erledigt steht zu Anfang eingeklappt.
    await userEvent.click(screen.getByRole('button', { name: '1 erledigte Aufgabe anzeigen' }))
    await userEvent.click(screen.getByRole('checkbox', { name: 'Sterbeurkunde beantragen' }))

    await waitFor(() => expect(hakeAb).toHaveBeenCalledWith(aufgabe({ erledigt: true }), false))
  })

  it('haelt die Beschreibung aus der Liste heraus', () => {
    useAufgaben.mockReturnValue(
      aufgabendaten({
        zustand: {
          status: 'bereit',
          aufgaben: [aufgabe({ beschreibung: 'Beim Standesamt Freiburg' })],
          uebersprungen: 0,
          ...NETZ,
        },
      }),
    )

    rendereMitProvidern(<Alle />)

    /*
     * Die Beschreibung ist ein ganzer Absatz Fliesstext. In einer Liste von
     * zwanzig Aufgaben macht sie aus jeder Zeile einen Block, durch den man
     * scrollt, statt ihn zu lesen. Sie steht im Detail, einen Fingertipp
     * weiter; die Liste zeigt den Titel und den Stand.
     */
    expect(screen.queryByText('Beim Standesamt Freiburg')).toBeNull()
    expect(screen.getByRole('link', { name: 'Details: „Sterbeurkunde beantragen“' })).toBeVisible()
  })

  it('zeigt den Grund, wenn eine Aenderung abgelehnt wird', async () => {
    // §5: Abgelehnte Mutationen werden nie stillschweigend verworfen.
    const legeAn = vi.fn().mockRejectedValue(new Error('Die Aufgabe war nicht anzulegen.'))
    useAufgaben.mockReturnValue(aufgabendaten({ legeAn }))

    rendereMitProvidern(<Alle />)

    await userEvent.type(screen.getByLabelText('Neue Aufgabe'), 'Etwas')
    await userEvent.click(screen.getByRole('button', { name: 'Aufgabe hinzufügen' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Die Aufgabe war nicht anzulegen.')
    // Der eingetippte Titel bleibt stehen: Er ist nirgends gespeichert, und ein
    // geleertes Feld wäre der stille Verlust, den §5 ausschließt.
    expect(screen.getByLabelText('Neue Aufgabe')).toHaveValue('Etwas')
  })

  it('laesst einen Titel aus lauter Leerzeichen gar nicht erst abschicken', async () => {
    // `required` allein liesse ihn durch; der Dienst wiese ihn dann ab, und die
    // Meldung landete weit weg von der Zeile.
    const legeAn = vi.fn().mockResolvedValue(undefined)
    useAufgaben.mockReturnValue(aufgabendaten({ legeAn }))

    rendereMitProvidern(<Alle />)

    const hinzufuegen = screen.getByRole('button', { name: 'Aufgabe hinzufügen' })
    expect(hinzufuegen).toBeDisabled()

    await userEvent.type(screen.getByLabelText('Neue Aufgabe'), '   ')
    expect(hinzufuegen).toBeDisabled()

    await userEvent.type(screen.getByLabelText('Neue Aufgabe'), 'Etwas')
    expect(hinzufuegen).toBeEnabled()
  })

  it('bietet in der Liste keine Aktion an, sondern nur den Weg ins Detail (§7)', () => {
    /*
     * Ändern, Löschen, Übernehmen und Freigeben stehen im Aufgabendetail. Vier
     * Schaltflächen unter jeder von zwanzig Zeilen sind vier Gelegenheiten, in
     * einer Liste etwas zu löschen, das man nur ansehen wollte.
     */
    useAufgaben.mockReturnValue(aufgabendaten())

    rendereMitProvidern(<Alle />)

    for (const name of [/^Ändern/, /^Löschen/, /^Übernehmen/, /^Freigeben/]) {
      expect(screen.queryByRole('button', { name })).toBeNull()
    }

    expect(screen.getByRole('link', { name: 'Details: „Sterbeurkunde beantragen“' })).toBeVisible()
  })

  it('zeigt den Zaehler der uebersprungenen Eintraege nur im Dev-Modus', () => {
    // §3.7: In Produktion gibt es diesen Zähler nirgends zu sehen.
    useAufgaben.mockReturnValue(
      aufgabendaten({ zustand: { status: 'bereit', aufgaben: [], uebersprungen: 3, ...NETZ } }),
    )

    const { unmount } = rendereMitProvidern(<Alle />)
    expect(screen.getByText(/3 Einträge übersprungen/)).toBeVisible()
    unmount()

    vi.stubEnv('DEV', false)
    try {
      rendereMitProvidern(<Alle />)
      expect(screen.queryByText(/übersprungen/)).toBeNull()
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('meldet einen gesperrten Fall, statt eine leere Liste zu zeigen', () => {
    // Ohne `K_c` gibt es keine Aufgaben zu entschlüsseln. "Keine Aufgaben"
    // wäre an dieser Stelle eine Lüge (§3.6).
    useCase.mockReturnValue(
      falldaten({
        zustand: {
          status: 'bereit',
          faelle: [],
          aktiver: { zustand: 'gesperrt', id: 'fall-1', grund: 'Kein Schlüssel.' },
        },
      }),
    )

    rendereMitProvidern(<Alle />)

    expect(screen.getByRole('alert')).toHaveTextContent('Kein Schlüssel.')
    expect(screen.queryByLabelText('Neue Aufgabe')).toBeNull()
  })

  it('zeigt an, solange der Fall selbst noch geladen wird', () => {
    useCase.mockReturnValue(falldaten({ zustand: { status: 'laedt' } }))

    rendereMitProvidern(<Alle />)

    expect(screen.getByRole('status')).toHaveTextContent('Ihre Daten werden geladen')
    expect(screen.queryByRole('heading', { name: 'Alle Aufgaben' })).toBeNull()
  })

  it('schickt zur Startseite, wer ohne Fall hereinkommt', () => {
    // §7: Ohne Fall ist die App gesperrt, und die Fallweiche steht dort.
    useCase.mockReturnValue(falldaten({ zustand: { status: 'kein-fall' } }))

    rendereMitProvidern(<Alle />)

    expect(screen.queryByRole('heading', { name: 'Alle Aufgaben' })).toBeNull()
    expect(screen.queryByLabelText('Neue Aufgabe')).toBeNull()
  })

  it('zeigt an, solange die Aufgaben geladen werden', () => {
    useAufgaben.mockReturnValue(aufgabendaten({ zustand: { status: 'laedt' } }))

    rendereMitProvidern(<Alle />)

    expect(screen.getByRole('status')).toHaveTextContent('Ihre Aufgaben werden geladen')
  })

  it('nennt den Netzfehler, laesst die Liste aber stehen', () => {
    // §5: Gecachte Inhalte werden sofort gerendert. Ein Abruf, der scheitert,
    // nimmt den zuletzt gecachten Stand nicht mit. Sonst sieht jemand im Zug
    // einen leeren Fall und legt alles neu an.
    useAufgaben.mockReturnValue(
      aufgabendaten({
        zustand: {
          status: 'bereit',
          aufgaben: [aufgabe()],
          uebersprungen: 0,
          laedtNetz: false,
          netzfehler: 'Kein Netz.',
        },
      }),
    )

    rendereMitProvidern(<Alle />)

    expect(screen.getByRole('alert')).toHaveTextContent('Kein Netz.')
    expect(screen.getByRole('checkbox', { name: 'Sterbeurkunde beantragen' })).toBeVisible()
  })

  it('laesst die Liste beim Nachladen in Ruhe stehen', () => {
    /*
     * §5: Die Türklingel läutet im geteilten Fall im Sekundentakt. Eine Zeile,
     * die dabei erscheint und wieder verschwindet, verschöbe die Liste unter
     * dem Finger, der gerade ein Häkchen setzen will, und eine Vorlesestimme
     * sagte alle paar Sekunden "wird aktualisiert".
     */
    useAufgaben.mockReturnValue(
      aufgabendaten({
        zustand: {
          status: 'bereit',
          aufgaben: [aufgabe()],
          uebersprungen: 0,
          laedtNetz: true,
          netzfehler: null,
        },
      }),
    )

    rendereMitProvidern(<Alle />)

    expect(screen.getByRole('checkbox', { name: 'Sterbeurkunde beantragen' })).toBeVisible()
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('behauptet waehrend des ersten Abrufs nicht, es gebe nichts', () => {
    // Ein leerer Cache und ein laufender erster Abruf sind nicht dasselbe wie
    // ein leerer Fall. §5: Die Ladeanzeige gehört dem Netzwerk-Fetch.
    useAufgaben.mockReturnValue(
      aufgabendaten({
        zustand: {
          status: 'bereit',
          aufgaben: [],
          uebersprungen: 0,
          laedtNetz: true,
          netzfehler: null,
        },
      }),
    )

    rendereMitProvidern(<Alle />)

    expect(screen.getByRole('status')).toHaveTextContent('Ihre Aufgaben werden geladen')
    expect(screen.queryByText(/Hier ist noch nichts/)).toBeNull()
  })

  it('meldet verworfene Aenderungen mit Zahl, Titel und Grund', async () => {
    // §5: "Abgelehnte Mutationen werden nie stillschweigend verworfen, sondern
    // mit ihrem entschlüsselten Inhalt als Mitteilung angezeigt."
    const bestaetige = vi.fn()
    useAufgaben.mockReturnValue(
      aufgabendaten({
        bestaetige,
        abgelehnt: [
          {
            itemId: 'item-1',
            was: 'aendern',
            titel: 'Sterbeurkunde beantragen',
            grund: 'Der Fall ist versiegelt.',
          },
          { itemId: 'item-2', was: 'anlegen', titel: 'Konten kündigen', grund: 'Kein Zugriff.' },
        ],
      }),
    )

    rendereMitProvidern(<Alle />)

    expect(screen.getByRole('alert')).toHaveTextContent(
      '2 Änderungen konnten nicht gespeichert werden.',
    )
    expect(
      screen.getByText('Ändern von „Sterbeurkunde beantragen“: Der Fall ist versiegelt.'),
    ).toBeVisible()
    expect(
      screen.getByText('Anlegen von „Konten kündigen“: Kein Zugriff.'),
    ).toBeVisible()

    // Weg geht die Mitteilung nur, wenn jemand sie zur Kenntnis nimmt.
    await userEvent.click(screen.getByRole('button', { name: 'Verstanden' }))
    expect(bestaetige).toHaveBeenCalled()
  })

  it('zaehlt eine einzelne verworfene Aenderung nicht als „1 Änderungen"', () => {
    useAufgaben.mockReturnValue(
      aufgabendaten({
        abgelehnt: [{ itemId: 'item-1', was: 'loeschen', titel: 'Konten kündigen', grund: 'Nein.' }],
      }),
    )

    rendereMitProvidern(<Alle />)

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Eine Änderung konnte nicht gespeichert werden.',
    )
  })

  it('nennt den Vorgang, wenn sich der Titel nicht mehr herstellen laesst', () => {
    // Ohne DEK gibt es keinen Titel, da die Zeile inzwischen ein Tombstone ist.
    // Das ist immer noch mehr als Schweigen.
    useAufgaben.mockReturnValue(
      aufgabendaten({
        abgelehnt: [{ itemId: 'item-1', was: 'aendern', titel: '', grund: 'Zu spät.' }],
      }),
    )

    rendereMitProvidern(<Alle />)

    expect(screen.getByText('Ändern einer Aufgabe: Zu spät.')).toBeVisible()
  })

  it('traegt keine eigene Navigationsreihe mehr (§7)', () => {
    /*
     * Der Weg zurück ist der Start-Tab in der unteren Leiste, und der steht
     * auf jedem Hauptscreen an derselben Stelle. Ein zusätzliches „Zurück" im
     * Kopf wäre ein zweiter Weg mit einem dritten Namen.
     */
    rendereMitProvidern(<Alle />)

    for (const name of ['Zurück', 'Erbe & Tresor', 'Profil']) {
      expect(screen.queryByRole('link', { name })).toBeNull()
    }
  })
})

/**
 * Fristen, Unteraufgaben und Abhängigkeiten in der Liste (DESIGN.md §7, §8).
 *
 * Was hier geprüft wird, ist nicht die Rechnung aus
 * `tests/services/fristen.test.ts`, sondern was davon auf dem Bildschirm
 * ankommt: ein Badge mit der Restzeit, eine ausgegraute Zeile mit "Zuerst: ...",
 * eine Elternaufgabe ohne eigenes Häkchen und der Weg in das Detail.
 */
describe('Alle: Fristen, Unteraufgaben, Abhängigkeiten (§7)', () => {
  /** Heute, als ISO-Kalendertag, damit die Fristen nicht mit dem Jahr altern. */
  function heute(): string {
    const jetzt = new Date()
    const monat = `${jetzt.getMonth() + 1}`.padStart(2, '0')
    const tag = `${jetzt.getDate()}`.padStart(2, '0')

    return `${jetzt.getFullYear()}-${monat}-${tag}`
  }

  function herkunft(ueberschreibung: Partial<Katalogherkunft> = {}): Katalogherkunft {
    return {
      aufgabeId: 'sterbefall-anzeigen',
      version: '2026-08+testtest',
      fristTage: 3,
      fristAb: 'sterbedatum',
      zustaendigeStelle: 'Standesamt des Sterbeortes',
      benoetigteDokumente: [],
      unteraufgaben: [],
      haengtAbVon: [],
      hinweis: '',
      kategorie: 'Sofort',
      reihenfolge: 10,
      ...ueberschreibung,
    }
  }

  /** Ein Fall, dessen Sterbedatum heute ist: die Fristen laufen also noch. */
  function frischerFall() {
    const fall: LesbarerFall = { ...LESBAR, sterbedatum: heute() }

    useCase.mockReturnValue(
      falldaten({ zustand: { status: 'bereit', faelle: [fall], aktiver: fall } }),
    )
  }

  function zeige(aufgaben: Aufgabe[], ueberschreibung: Partial<Omit<Aufgabendaten, 'zustand'>> = {}) {
    frischerFall()
    useAufgaben.mockReturnValue(
      aufgabendaten({
        zustand: { status: 'bereit', aufgaben, uebersprungen: 0, ...NETZ },
        // Derselbe frische Fall, nur so, wie die Fristen ihn sehen (§8): Das
        // Sterbedatum kommt aus dem Fall, das Kenntnisdatum aus dem privaten
        // Konfigurations-Item, und hier hat niemand eines eingetragen (#12).
        fristbezug: { sterbedatum: heute(), kenntnisAm: null, anfechtungKenntnisAm: null },
        ...ueberschreibung,
      }),
    )

    return rendereMitProvidern(<Alle />)
  }

  it('zeigt die Restzeit als Badge', () => {
    zeige([aufgabe({ katalog: herkunft() })])

    expect(screen.getByText('noch 3 Tage')).toBeVisible()
  })

  it('erfindet keine Frist, wo der Katalog keine nennt', () => {
    zeige([aufgabe()])

    expect(screen.queryByText(/noch \d+ Tage/)).toBeNull()
    expect(screen.queryByText(/überfällig/)).toBeNull()
  })

  it('benennt bei einer blockierten Aufgabe, worauf sie wartet', () => {
    zeige([
      aufgabe({ id: 'zuerst', titel: 'Sterbefall anzeigen' }),
      aufgabe({ id: 'danach', titel: 'Erbschein beantragen', dependsOn: ['zuerst'] }),
    ])

    expect(screen.getByText('Zuerst: Sterbefall anzeigen')).toBeVisible()
  })

  it('gibt die blockierte Aufgabe frei, sobald die Abhängigkeit erledigt ist', () => {
    zeige([
      aufgabe({ id: 'zuerst', titel: 'Sterbefall anzeigen', erledigt: true }),
      aufgabe({ id: 'danach', titel: 'Erbschein beantragen', dependsOn: ['zuerst'] }),
    ])

    expect(screen.queryByText(/^Zuerst:/)).toBeNull()
  })

  it('gibt einer Aufgabe mit Unteraufgaben kein eigenes Häkchen', () => {
    zeige([
      aufgabe({ id: 'eltern', titel: 'Sterbefall anzeigen' }),
      aufgabe({ id: 'kind-1', titel: 'Urkunden bestellen', parentId: 'eltern' }),
      aufgabe({ id: 'kind-2', titel: 'Termin machen', parentId: 'eltern', erledigt: true }),
    ])

    expect(screen.queryByRole('checkbox', { name: 'Sterbefall anzeigen' })).toBeNull()
    expect(screen.getByText('1/2 erledigt')).toBeVisible()
  })

  it('nennt eine Aufgabe erledigt, sobald alle Unteraufgaben es sind', async () => {
    zeige([
      aufgabe({ id: 'eltern', titel: 'Sterbefall anzeigen', erledigt: false }),
      aufgabe({ id: 'kind-1', titel: 'Urkunden bestellen', parentId: 'eltern', erledigt: true }),
    ])

    // §7: Eine Wurzel, deren Kinder alle erledigt sind, gilt selbst als
    // erledigt und steht deshalb zu Anfang eingeklappt.
    await userEvent.click(screen.getByRole('button', { name: '1 erledigte Aufgabe anzeigen' }))

    expect(screen.getByText('1/1 erledigt')).toBeVisible()
  })

  it('zeigt Unteraufgaben nicht als eigene Zeilen in der Liste', () => {
    // §7: Sie stehen im Aufgabendetail, unter ihrer Elternaufgabe.
    zeige([
      aufgabe({ id: 'eltern', titel: 'Sterbefall anzeigen' }),
      aufgabe({ id: 'kind-1', titel: 'Urkunden bestellen', parentId: 'eltern' }),
    ])

    expect(screen.queryByRole('checkbox', { name: 'Urkunden bestellen' })).toBeNull()
  })

  it('verlinkt in das ganzseitige Aufgabendetail', () => {
    zeige([aufgabe({ id: 'item-1', titel: 'Sterbeurkunde beantragen' })])

    expect(screen.getByRole('link', { name: 'Details: „Sterbeurkunde beantragen“' })).toHaveAttribute(
      'href',
      '/aufgabe/item-1',
    )
  })

  it('sortiert auf Wunsch nach Frist', async () => {
    zeige([
      aufgabe({ id: 'spaet', titel: 'Spät', katalog: herkunft({ fristTage: 40 }) }),
      aufgabe({ id: 'ohne', titel: 'Ohne Frist' }),
      aufgabe({ id: 'frueh', titel: 'Früh', katalog: herkunft({ fristTage: 3 }) }),
    ])

    const titel = () =>
      screen.getAllByRole('link', { name: /^Details/ }).map((link) => link.getAttribute('href'))

    // Voreingestellt bleibt die Reihenfolge der Juristinnen (§8).
    expect(titel()).toEqual(['/aufgabe/spaet', '/aufgabe/ohne', '/aufgabe/frueh'])

    await userEvent.selectOptions(screen.getByLabelText('Sortierung'), 'frist')

    expect(titel()).toEqual(['/aufgabe/frueh', '/aufgabe/spaet', '/aufgabe/ohne'])
  })

  it('bietet im Vorsorgefall gar keine Sortierung an (§2, §3.5)', () => {
    /*
     * Ein Vorsorgefall hat kein Sterbedatum und damit keine einzige Frist.
     * "Nach Frist" sortierte dort eine Liste, in der jede Zeile denselben
     * leeren Wert trägt — eine Wahl, die sichtbar nichts tut.
     */
    const vorsorge: LesbarerFall = { ...LESBAR, status: 'vorsorge', sterbedatum: null }
    useCase.mockReturnValue(
      falldaten({ zustand: { status: 'bereit', faelle: [vorsorge], aktiver: vorsorge } }),
    )
    useAufgaben.mockReturnValue(
      aufgabendaten({
        zustand: { status: 'bereit', aufgaben: [aufgabe()], uebersprungen: 0, ...NETZ },
        fristbezug: { sterbedatum: null, kenntnisAm: null, anfechtungKenntnisAm: null },
      }),
    )

    rendereMitProvidern(<Alle />)

    expect(screen.queryByLabelText('Sortierung')).toBeNull()
    expect(screen.queryByRole('option', { name: 'Nach Frist' })).toBeNull()
  })

  it('bietet Erinnerungen an, sobald es welche zu planen gibt', async () => {
    const frage = vi.fn().mockResolvedValue(undefined)

    zeige([aufgabe({ katalog: herkunft() })], {
      erinnerungen: { erlaubnis: 'ungefragt', frage, geplant: 4 },
    })

    await userEvent.click(screen.getByRole('button', { name: 'Erinnerungen einschalten' }))

    expect(frage).toHaveBeenCalledTimes(1)
  })

  it('fragt nicht nach Erinnerungen, wo es keine Frist gibt', () => {
    zeige([aufgabe()], {
      erinnerungen: { erlaubnis: 'ungefragt', frage: vi.fn(), geplant: 0 },
    })

    expect(screen.queryByRole('button', { name: 'Erinnerungen einschalten' })).toBeNull()
  })
})

/**
 * Zuweisung in der Liste (DESIGN.md §7).
 *
 * "Bearbeiten darf nur, wem sie zugewiesen ist." In der Liste heißt das: Wer
 * nicht zugewiesen ist, sieht die Aufgabe vollständig und findet statt der
 * Schaltflächen den einen Weg, der ihm offensteht.
 */
describe('Zuweisung', () => {
  const BERT = { userId: 'user_bert', name: 'Bert Müller' }

  function mitAufgabe(ueberschreibung: Partial<Aufgabe>) {
    const daten = aufgabendaten({
      zustand: {
        status: 'bereit',
        aufgaben: [aufgabe(ueberschreibung)],
        uebersprungen: 0,
        ...NETZ,
      },
    })

    useAufgaben.mockReturnValue(daten)

    return daten
  }

  it('nennt bei jeder Aufgabe, wer zuständig ist', () => {
    mitAufgabe({ assignee: personen([BERT]) })

    rendereMitProvidern(<Alle />)

    expect(screen.getByText('Bert Müller')).toBeVisible()
  })

  it('lässt eine fremde Aufgabe sehen, aber nicht bearbeiten', () => {
    mitAufgabe({ assignee: personen([BERT]) })

    rendereMitProvidern(<Alle />)

    /*
     * Kein graues Kästchen, sondern gar keines: Der Titel steht als Text da.
     * Alles Weitere — übernehmen, freigeben, ändern — steht im Detail (§7);
     * dass die Liste gar keine Aktion mehr trägt, prüft der Test oben.
     */
    expect(screen.queryByRole('checkbox', { name: /Sterbeurkunde beantragen/ })).toBeNull()
    expect(screen.getByText('Sterbeurkunde beantragen')).toBeVisible()
  })

  it('meldet, wer eine Aufgabe stattdessen übernommen hat', () => {
    useAufgaben.mockReturnValue(
      aufgabendaten({
        uebernahmen: [{ itemId: 'item-1', titel: 'Konto kündigen', name: 'Bert Müller' }],
      }),
    )

    rendereMitProvidern(<Alle />)

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Bert Müller hat diese Aufgabe übernommen: „Konto kündigen“',
    )
  })
})

/**
 * Der Schalter "Nur für mich" und die eine Aktion daneben (DESIGN.md §3.7, §7).
 *
 * "In der einfachen Ansicht so knapp wie möglich: ein Schalter 'Nur für mich'
 * auf der Aufgabe und genau eine Aktion 'Für alle sichtbar machen'."
 */
describe('Private Aufgaben (§3.7)', () => {
  it('legt die Aufgabe unter K_p ab, wenn der Schalter gesetzt ist', async () => {
    const legeAn = vi.fn().mockResolvedValue(undefined)
    useAufgaben.mockReturnValue(aufgabendaten({ legeAn }))

    rendereMitProvidern(<Alle />)

    await userEvent.type(screen.getByLabelText('Neue Aufgabe'), 'Erbausschlagung erwägen')
    await userEvent.click(screen.getByRole('checkbox', { name: 'Nur für mich' }))
    await userEvent.click(screen.getByRole('button', { name: 'Aufgabe hinzufügen' }))

    await waitFor(() =>
      expect(legeAn).toHaveBeenCalledWith('Erbausschlagung erwägen', null, true),
    )
  })

  it('setzt den Schalter nach dem Anlegen zurück', async () => {
    /*
     * Er ist eine Angabe zu dieser einen Aufgabe und keine Einstellung. Bliebe
     * er stehen, wäre die nächste Aufgabe unbemerkt ebenfalls privat, und
     * niemand sähe sie: die eine Verwechslung, die §3.7 teuer bezahlt.
     */
    useAufgaben.mockReturnValue(aufgabendaten({ legeAn: vi.fn().mockResolvedValue(undefined) }))

    rendereMitProvidern(<Alle />)

    const schalter = screen.getByRole('checkbox', { name: 'Nur für mich' })

    await userEvent.type(screen.getByLabelText('Neue Aufgabe'), 'Erbausschlagung erwägen')
    await userEvent.click(schalter)
    await userEvent.click(screen.getByRole('button', { name: 'Aufgabe hinzufügen' }))

    await waitFor(() => expect(schalter).not.toBeChecked())
  })

  it('sagt, wer die Aufgabe sehen wird', async () => {
    useAufgaben.mockReturnValue(aufgabendaten())

    rendereMitProvidern(<Alle />)

    expect(screen.getByText(/sehen alle Mitglieder des Falls/)).toBeVisible()

    await userEvent.click(screen.getByRole('checkbox', { name: 'Nur für mich' }))

    expect(screen.getByText(/sehen nur Sie, auf Ihren eigenen Geräten/)).toBeVisible()
  })

  it('kennzeichnet eine private Aufgabe in der Liste', () => {
    useAufgaben.mockReturnValue(
      aufgabendaten({
        zustand: {
          status: 'bereit',
          aufgaben: [aufgabe({ titel: 'Erbausschlagung erwägen', privat: true })],
          uebersprungen: 0,
          ...NETZ,
        },
      }),
    )

    rendereMitProvidern(<Alle />)

    // Der Hinweis steht im Titel und nicht bei den Schaltflächen: Wer nicht
    // sieht, dass die Geschwister sie nicht sehen, schreibt dort etwas hinein,
    // das er für geteilt hält.
    expect(within(screen.getByRole('listitem')).getByText('Nur für mich')).toBeVisible()
  })

  it('hält "Für alle sichtbar machen" aus der Liste heraus (§7)', () => {
    /*
     * Die eine Aktion aus §3.7 gibt es weiterhin, aber im Aufgabendetail: Sie
     * wrappt den DEK von `K_p` auf `K_c` und lässt sich nicht zurücknehmen —
     * nichts, was in einer Liste unter jeder Zeile stehen sollte.
     */
    useAufgaben.mockReturnValue(
      aufgabendaten({
        zustand: {
          status: 'bereit',
          aufgaben: [aufgabe({ titel: 'Erbausschlagung erwägen', privat: true })],
          uebersprungen: 0,
          ...NETZ,
        },
      }),
    )

    rendereMitProvidern(<Alle />)

    expect(screen.queryByRole('button', { name: /Für alle sichtbar machen/ })).toBeNull()
  })
})

/**
 * Die Fragebaum-Standardaufgabe in "Alle" (ERBE_DESIGN.md §9).
 *
 * Sie hat keine eigene Detailseite: Ihr Ergebnis steht im Fragebaum. Der Weg
 * ins Detail führt deshalb direkt dorthin statt zur Aufgaben-Detailseite.
 */
describe('Seed-Aufgabe in "Alle" (ERBE_DESIGN.md §9)', () => {
  it('führt direkt in den Fragebaum statt in eine Detailseite', () => {
    const seed = aufgabe({
      id: 'seed-1',
      titel: 'Klären ob Sie Erbe sind',
      katalog: { aufgabeId: 'erbenstellung-klaeren', fristTage: null, fristAb: null } as Katalogherkunft,
    })
    useAufgaben.mockReturnValue(
      aufgabendaten({ zustand: { status: 'bereit', aufgaben: [seed], uebersprungen: 0, ...NETZ } }),
    )

    rendereMitProvidern(<Alle />)

    expect(screen.getByRole('link', { name: 'Details: „Klären ob Sie Erbe sind“' })).toHaveAttribute(
      'href',
      '/erbe/fragebaum',
    )
  })
})

/** Erledigte Aufgaben in "Alle" (§7): ans Ende, zu Anfang eingeklappt. */
describe('Erledigte Aufgaben in "Alle" (§7)', () => {
  it('stehen hinter den offenen und sind zu Anfang eingeklappt', () => {
    useAufgaben.mockReturnValue(
      aufgabendaten({
        zustand: {
          status: 'bereit',
          aufgaben: [
            aufgabe({ id: 'item-1', titel: 'Offene Aufgabe' }),
            aufgabe({ id: 'item-2', titel: 'Erledigte Aufgabe', erledigt: true }),
          ],
          uebersprungen: 0,
          ...NETZ,
        },
      }),
    )

    rendereMitProvidern(<Alle />)

    expect(screen.getByText('Offene Aufgabe')).toBeVisible()
    expect(screen.queryByText('Erledigte Aufgabe')).toBeNull()
    expect(screen.getByRole('button', { name: '1 erledigte Aufgabe anzeigen' })).toBeVisible()
  })

  it('zeigt sie nach einem Klick auf den Schalter, auch bei "Nach Frist" sortiert', async () => {
    useAufgaben.mockReturnValue(
      aufgabendaten({
        zustand: {
          status: 'bereit',
          aufgaben: [
            aufgabe({ id: 'item-1', titel: 'Offene Aufgabe' }),
            aufgabe({ id: 'item-2', titel: 'Erledigte Aufgabe', erledigt: true }),
          ],
          uebersprungen: 0,
          ...NETZ,
        },
      }),
    )

    rendereMitProvidern(<Alle />)

    await userEvent.selectOptions(screen.getByLabelText('Sortierung'), 'frist')
    await userEvent.click(screen.getByRole('button', { name: '1 erledigte Aufgabe anzeigen' }))

    expect(screen.getByText('Erledigte Aufgabe')).toBeVisible()
  })

  it('lässt den Schalter ganz weg, wenn nichts erledigt ist', () => {
    rendereMitProvidern(<Alle />)

    expect(screen.queryByRole('button', { name: /erledigte Aufgabe/ })).toBeNull()
  })
})
