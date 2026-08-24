import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AufgabenZustand, Aufgabendaten } from '../../src/hooks/useAufgaben.ts'
import type { Falldaten } from '../../src/hooks/useCase.ts'
import type { Erinnerungsdaten } from '../../src/hooks/useErinnerungen.ts'
import type { Aufgabe, Katalogherkunft } from '../../src/services/aufgabenService.ts'
import { baueBaum } from '../../src/services/aufgabenbaum.ts'
import type { LesbarerFall } from '../../src/services/fallService.ts'
import { BENUTZER, Huelle, rendereMitProvidern } from './harness.tsx'
import { NIEMAND, personen } from '../../src/services/zuweisung.ts'

const useCase = vi.fn<() => Falldaten>()
const useAufgaben = vi.fn<() => Aufgabendaten>()

vi.mock('../../src/hooks/useCase.ts', () => ({ useCase: () => useCase() }))
vi.mock('../../src/hooks/useAufgaben.ts', () => ({ useAufgaben: () => useAufgaben() }))

const { Alle } = await import('../../src/screens/shared/Alle/Alle.tsx')

/**
 * Der Tab "Alle" (DESIGN.md §7).
 *
 * Der Screen verschlüsselt nichts — das tut `aufgabenService`, geprüft in
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
    katalog: null,
    dek: new Uint8Array([9]),
    kid: LESBAR.kid,
    ...ueberschreibung,
  }
}

function falldaten(ueberschreibung: Partial<Falldaten> = {}): Falldaten {
  return {
    zustand: { status: 'bereit', faelle: [LESBAR], aktiver: LESBAR },
    legeTrauerfallAn: vi.fn().mockResolvedValue(undefined),
    legeVorsorgefallAn: vi.fn().mockResolvedValue(undefined),
    loescheVorsorgefall: vi.fn().mockResolvedValue(undefined),
    ...ueberschreibung,
  }
}

/**
 * Der Ruhezustand des Netzes: kein Abruf unterwegs, nichts schiefgegangen.
 *
 * Steht als eigene Konstante da, weil §5 beides zur „bereit"-Form gehören
 * lässt — die Liste steht, und daneben steht, was das Netz gerade tut.
 */
const NETZ = { laedtNetz: false, netzfehler: null }

/**
 * Der Zustand, wie ein Test ihn hinschreibt — ohne `baum`.
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

    await waitFor(() => expect(legeAn).toHaveBeenCalledWith('Konten kündigen'))
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
     * §5: Jede Mutation wird optimistisch lokal angewandt — nur passiert das
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

    // Der Zustand sagt weiterhin `erledigt: false` — die Zeile hält den Wunsch.
    expect(kaestchen).toBeChecked()

    gibFrei()
  })

  it('nimmt das Haekchen zurueck, wenn die Mutation gar nicht erst angehaengt wurde', async () => {
    /*
     * Der Bestand zieht nur nach, wenn etwas in der Queue gelandet ist. Kommt
     * es nicht so weit — kein Platz in IndexedDB, kein IndexedDB —, bleibt
     * `erledigt: false` stehen, und ein Abgleich gegen den Bestand fände nie
     * einen Unterschied. Ohne die Ruecknahme hier stuende das Haekchen fuer den
     * Rest der Sitzung auf einem Wert, den niemand gespeichert hat: die Meldung
     * darueber sagte „ging nicht", das Kaestchen daneben sagte „erledigt".
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

    await userEvent.click(screen.getByRole('checkbox', { name: 'Sterbeurkunde beantragen' }))

    await waitFor(() => expect(hakeAb).toHaveBeenCalledWith(aufgabe({ erledigt: true }), false))
  })

  it('benennt eine Aufgabe um und nimmt die Beschreibung mit', async () => {
    const schreibe = vi.fn().mockResolvedValue(undefined)
    useAufgaben.mockReturnValue(aufgabendaten({ schreibe }))

    rendereMitProvidern(<Alle />)

    await userEvent.click(screen.getByRole('button', { name: /Ändern/ }))

    await userEvent.clear(screen.getByLabelText('Titel'))
    await userEvent.type(screen.getByLabelText('Titel'), 'Sterbeurkunde abholen')
    await userEvent.type(screen.getByLabelText('Beschreibung'), 'Sechs Ausfertigungen')
    await userEvent.click(screen.getByRole('button', { name: 'Speichern' }))

    await waitFor(() =>
      expect(schreibe).toHaveBeenCalledWith(aufgabe(), {
        titel: 'Sterbeurkunde abholen',
        beschreibung: 'Sechs Ausfertigungen',
      }),
    )
  })

  it('laesst das Umbenennen abbrechen, ohne etwas zu schreiben', async () => {
    const schreibe = vi.fn().mockResolvedValue(undefined)
    useAufgaben.mockReturnValue(aufgabendaten({ schreibe }))

    rendereMitProvidern(<Alle />)

    await userEvent.click(screen.getByRole('button', { name: /Ändern/ }))
    await userEvent.type(screen.getByLabelText('Titel'), 'verworfen')
    await userEvent.click(screen.getByRole('button', { name: 'Abbrechen' }))

    expect(schreibe).not.toHaveBeenCalled()
    expect(screen.getByRole('checkbox', { name: 'Sterbeurkunde beantragen' })).toBeVisible()
  })

  it('fragt vor dem Loeschen und nennt die Endgueltigkeit', async () => {
    // §5: Löschen gewinnt endgültig, die Datenbank weist eine Auferstehung ab.
    // Das gehört vor die Aktion gesagt.
    const loesche = vi.fn().mockResolvedValue(undefined)
    useAufgaben.mockReturnValue(aufgabendaten({ loesche }))

    rendereMitProvidern(<Alle />)

    await userEvent.click(screen.getByRole('button', { name: /Löschen/ }))

    expect(screen.getByText(/kommen nicht zurück/)).toBeVisible()
    expect(loesche).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole('button', { name: 'Endgültig löschen' }))

    await waitFor(() => expect(loesche).toHaveBeenCalledWith(aufgabe()))
  })

  it('laesst das Loeschen abbrechen', async () => {
    const loesche = vi.fn().mockResolvedValue(undefined)
    useAufgaben.mockReturnValue(aufgabendaten({ loesche }))

    rendereMitProvidern(<Alle />)

    await userEvent.click(screen.getByRole('button', { name: /Löschen/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Abbrechen' }))

    expect(loesche).not.toHaveBeenCalled()
    expect(screen.getByRole('checkbox', { name: 'Sterbeurkunde beantragen' })).toBeVisible()
  })

  it('nennt jede Schaltflaeche mit ihrer Aufgabe', async () => {
    // Ohne den Titel zum Vorlesen hoerte eine blinde Person in einer Liste von
    // zwanzig Aufgaben zwanzigmal „Ändern" (§7).
    useAufgaben.mockReturnValue(
      aufgabendaten({
        zustand: {
          status: 'bereit',
          aufgaben: [aufgabe(), aufgabe({ id: 'item-2', titel: 'Konten kündigen' })],
          uebersprungen: 0,
          ...NETZ,
        },
      }),
    )

    rendereMitProvidern(<Alle />)

    // Der zugaengliche Name wird als regulaerer Ausdruck geprueft: Wie das
    // Trennzeichen zwischen sichtbarem und vorgelesenem Teil aussieht,
    // normalisiert jede Umgebung anders. Die Zusage ist, dass der Titel darin
    // vorkommt, nicht wie er angeklebt wird.
    expect(screen.getByRole('button', { name: /^Ändern.*Konten kündigen/ })).toBeVisible()
    expect(screen.getByRole('button', { name: /^Löschen.*Konten kündigen/ })).toBeVisible()
  })

  it('zeigt die Beschreibung, sobald es eine gibt', () => {
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

    expect(screen.getByText('Beim Standesamt Freiburg')).toBeVisible()
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

    await userEvent.click(screen.getByRole('button', { name: /^Ändern/ }))
    await userEvent.clear(screen.getByLabelText('Titel'))
    expect(screen.getByRole('button', { name: 'Speichern' })).toBeDisabled()
  })

  it('haelt das Aenderungsformular offen, wenn das Speichern scheitert', async () => {
    const schreibe = vi.fn().mockRejectedValue(new Error('Die Aufgabe war nicht zu ändern.'))
    useAufgaben.mockReturnValue(aufgabendaten({ schreibe }))

    rendereMitProvidern(<Alle />)

    await userEvent.click(screen.getByRole('button', { name: /Ändern/ }))
    await userEvent.clear(screen.getByLabelText('Titel'))
    await userEvent.type(screen.getByLabelText('Titel'), 'Sterbeurkunde abholen')
    await userEvent.click(screen.getByRole('button', { name: 'Speichern' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('nicht zu ändern')
    expect(screen.getByLabelText('Titel')).toHaveValue('Sterbeurkunde abholen')
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
    // Ohne `K_c` gibt es keine Aufgaben zu entschlüsseln. „Keine Aufgaben"
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
    // nimmt den zuletzt gecachten Stand nicht mit — sonst sieht jemand im Zug
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
     * dem Finger, der gerade ein Häkchen setzen will — und eine Vorlesestimme
     * sagte alle paar Sekunden „wird aktualisiert".
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
    // §5: „Abgelehnte Mutationen werden nie stillschweigend verworfen, sondern
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
    // Ohne DEK gibt es keinen Titel — die Zeile ist inzwischen ein Tombstone.
    // Das ist immer noch mehr als Schweigen.
    useAufgaben.mockReturnValue(
      aufgabendaten({
        abgelehnt: [{ itemId: 'item-1', was: 'aendern', titel: '', grund: 'Zu spät.' }],
      }),
    )

    rendereMitProvidern(<Alle />)

    expect(screen.getByText('Ändern einer Aufgabe: Zu spät.')).toBeVisible()
  })

  it('fuehrt zurueck zur Startseite', () => {
    rendereMitProvidern(<Alle />)

    expect(screen.getByRole('link', { name: 'Zurück' })).toHaveAttribute('href', '/')
  })

  it('aendert genau die Aufgabe, deren Schaltflaeche gedrueckt wurde', async () => {
    const schreibe = vi.fn().mockResolvedValue(undefined)
    const zweite = aufgabe({ id: 'item-2', titel: 'Konten kündigen' })
    useAufgaben.mockReturnValue(
      aufgabendaten({
        schreibe,
        zustand: { status: 'bereit', aufgaben: [aufgabe(), zweite], uebersprungen: 0, ...NETZ },
      }),
    )

    rendereMitProvidern(<Alle />)

    await userEvent.click(screen.getByRole('button', { name: /^Ändern.*Konten kündigen/ }))

    // Nur eine Zeile steht im Änderungsmodus, also gibt es genau ein
    // „Speichern" — und der vorbelegte Titel verrät, welche Zeile es ist.
    expect(screen.getByLabelText('Titel')).toHaveValue('Konten kündigen')
    await userEvent.click(screen.getByRole('button', { name: 'Speichern' }))

    await waitFor(() =>
      expect(schreibe).toHaveBeenCalledWith(zweite, {
        titel: 'Konten kündigen',
        beschreibung: '',
      }),
    )
  })
})

/**
 * Fristen, Unteraufgaben und Abhängigkeiten in der Liste (DESIGN.md §7, §8).
 *
 * Was hier geprüft wird, ist nicht die Rechnung — die steht in
 * `tests/services/fristen.test.ts` — sondern was davon auf dem Bildschirm
 * ankommt: ein Badge mit der Restzeit, eine ausgegraute Zeile mit „Zuerst: …",
 * eine Elternaufgabe ohne eigenes Häkchen und der Weg in das Detail.
 */
describe('Alle: Fristen, Unteraufgaben, Abhängigkeiten (§7)', () => {
  /** Heute, als ISO-Kalendertag — damit die Fristen nicht mit dem Jahr altern. */
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
      rechtsgrundlage: '§ 28 PStG',
      zustaendigeStelle: 'Standesamt des Sterbeortes',
      benoetigteDokumente: [],
      unteraufgaben: [],
      haengtAbVon: [],
      hinweis: '',
      quelleUrl: '',
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
    expect(screen.getByText('1 von 2 Unteraufgaben erledigt')).toBeVisible()
  })

  it('nennt eine Aufgabe erledigt, sobald alle Unteraufgaben es sind', () => {
    zeige([
      aufgabe({ id: 'eltern', titel: 'Sterbefall anzeigen', erledigt: false }),
      aufgabe({ id: 'kind-1', titel: 'Urkunden bestellen', parentId: 'eltern', erledigt: true }),
    ])

    expect(screen.getByText('Erledigt: alle 1 Unteraufgaben sind abgehakt.')).toBeVisible()
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

    expect(screen.getByRole('link', { name: 'Details: „Sterbeurkunde beantragen"' })).toHaveAttribute(
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
 * „Bearbeiten darf nur, wem sie zugewiesen ist." In der Liste heißt das: Wer
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

    expect(screen.getByText('Zuständig: Bert Müller')).toBeVisible()
  })

  it('lässt eine fremde Aufgabe sehen, aber nicht bearbeiten', () => {
    mitAufgabe({ assignee: personen([BERT]) })

    rendereMitProvidern(<Alle />)

    expect(screen.getByRole('checkbox', { name: /Sterbeurkunde beantragen/ })).toBeDisabled()
    expect(screen.queryByRole('button', { name: /^Ändern/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /^Löschen/ })).toBeNull()
  })

  it('lässt eine unzugewiesene Aufgabe übernehmen', async () => {
    const daten = mitAufgabe({ assignee: NIEMAND })

    rendereMitProvidern(<Alle />)

    await userEvent.click(screen.getByRole('button', { name: /Übernehmen/ }))

    expect(daten.uebernimm).toHaveBeenCalledWith(expect.objectContaining({ id: 'item-1' }))
  })

  it('bietet bei einer freien Aufgabe nichts zum Freigeben an', () => {
    mitAufgabe({ assignee: NIEMAND })

    rendereMitProvidern(<Alle />)

    expect(screen.queryByRole('button', { name: /Freigeben/ })).toBeNull()
  })

  it('lässt jedes Mitglied eine fremde Reservierung lösen (§7)', async () => {
    const daten = mitAufgabe({ assignee: personen([BERT]) })

    rendereMitProvidern(<Alle />)

    await userEvent.click(screen.getByRole('button', { name: /Freigeben/ }))

    expect(daten.gibFrei).toHaveBeenCalledWith(expect.objectContaining({ id: 'item-1' }))
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
