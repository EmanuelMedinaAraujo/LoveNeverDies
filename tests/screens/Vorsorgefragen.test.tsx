import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { VORSORGEFRAGEN } from '../../src/content/vorsorgefragen.ts'
import type { Falldaten } from '../../src/hooks/useCase.ts'
import type { Tresordaten } from '../../src/hooks/useTresor.ts'
import type { LesbarerFall } from '../../src/services/fallService.ts'
import type { TresorItem } from '../../src/services/tresorService.ts'
import { rendereMitProvidern } from './harness.tsx'

/**
 * Die Vorsorgefragen auf dem ersten Screen (DESIGN.md §2, §3.5, §7).
 *
 * Ein Vorsorgefall hat keine Aufgaben. Was "Meine Aufgaben" in diesem Fall
 * zeigt, sind die acht Fragen aus `content/vorsorgefragen.ts`: eine Frage, ein
 * Feld, eine Schaltfläche. Geprüft wird, was der Screen aus einem Zustand
 * macht — dass die Fragen wörtlich dastehen, dass eine Antwort mit ihrer
 * Kennung gespeichert wird, dass eine gespeicherte Antwort im Feld steht und
 * dass all das ausschliesslich der vorsorgenden Person begegnet.
 *
 * Verschlüsselt wird eine Ebene tiefer, in `tresorService`; was dort passiert,
 * steht in `tests/services/tresorService.test.ts`.
 */

const speichereAntwort = vi.fn<Tresordaten['speichereAntwort']>()

let falldaten: Falldaten
let tresordaten: Tresordaten
let aufgabenZustand: 'laedt' | 'bereit'

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
    abgelehnt: [],
    uebernahmen: [],
    bestaetigeUebernahmen: vi.fn(),
    ich: { userId: 'user_1', name: 'Anna Müller' },
    fristbezug: { sterbedatum: null, kenntnisAm: null },
    hakeAb: vi.fn(),
    erinnerungen: { zustand: { status: 'aus' }, schalte: vi.fn() },
  }),
}))

const { Start } = await import('../../src/screens/erweitert/Start/Start.tsx')
const { Start: StartEinfach } = await import('../../src/screens/einfach/Start/Start.tsx')

const VORSORGEFALL: LesbarerFall = {
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

/** Die Frage nach dem Testament: kurz genug, um sie in einem Test auszuschreiben. */
const TESTAMENT = VORSORGEFRAGEN.find((frage) => frage.id === 'testament')

function antwort(ueberschreibung: Partial<TresorItem> = {}): TresorItem {
  return {
    id: 'item-1',
    titel: 'Haben Sie ein Testament? Wenn ja, wo befindet es sich?',
    inhalt: 'Im Bankschließfach.',
    frageId: 'testament',
    dek: new Uint8Array([9]),
    geaendertAm: '2026-08-24T12:00:00Z',
    ...ueberschreibung,
  }
}

describe('Vorsorgefragen auf dem ersten Screen (§3.5, §7)', () => {
  beforeEach(() => {
    speichereAntwort.mockReset()
    speichereAntwort.mockResolvedValue(undefined)
    aufgabenZustand = 'bereit'

    falldaten = {
      zustand: { status: 'bereit', faelle: [VORSORGEFALL], aktiver: VORSORGEFALL },
      legeTrauerfallAn: vi.fn(),
      legeVorsorgefallAn: vi.fn(),
      loescheVorsorgefall: vi.fn(),
      verlasseFall: vi.fn(),
      aktualisiere: vi.fn(),
    } as unknown as Falldaten

    tresordaten = {
      items: [],
      schwelle: { n: 0, k: null },
      istPreparer: true,
      resplitPending: false,
      legeItemAn: vi.fn(),
      aendereItem: vi.fn(),
      speichereAntwort,
      loescheItem: vi.fn(),
      verteileShares: vi.fn(),
      resplitLaeuft: false,
      resplitFehler: null,
    }
  })

  it('stellt alle Fragen unter "Meine Aufgaben", jede mit einem Feld', () => {
    rendereMitProvidern(<Start />)

    expect(screen.getByRole('heading', { name: 'Meine Aufgaben' })).toBeVisible()

    for (const frage of VORSORGEFRAGEN) {
      expect(screen.getByLabelText(beschriftung(frage.frage))).toBeVisible()
    }

    expect(screen.getAllByRole('button', { name: 'Speichern' })).toHaveLength(
      VORSORGEFRAGEN.length,
    )
  })

  it('gibt den Wortlaut der Juristinnen unverändert wieder, samt Zeilenumbruch', () => {
    rendereMitProvidern(<Start />)

    expect(
      screen.getByLabelText(
        'Wo befinden sich die folgenden Dokumente: Personalausweis und/oder Reisepass; Nachweis über den letzten Wohnsitz, Rentennummer (falls vorhanden); Geburtsurkunde, Heiratsurkunde, Scheidungsurteil',
      ),
    ).toBeVisible()

    // Der Zusatz steht auf einer eigenen Zeile, so wie er geliefert wurde (§8).
    const vertraege = document.querySelector('label[for="vorsorgefrage-vertraege"]')
    expect(vertraege?.textContent).toBe(
      'Haben Sie Verträge, die noch laufen? Wenn ja, welche? Wo befinden sie sich (wenn sie schriftlich verfasst worden sind)\nBeispiel: Mietvertrag, Wasser, Strom, Kfz usw.',
    )
  })

  it('speichert eine Antwort unter der Kennung ihrer Frage', async () => {
    if (TESTAMENT === undefined) throw new Error('Die Frage nach dem Testament fehlt.')

    rendereMitProvidern(<Start />)

    const feld = screen.getByLabelText(beschriftung(TESTAMENT.frage))
    await userEvent.type(feld, 'Im Bankschließfach.')

    // Die Schaltfläche neben genau diesem Feld: eine Frage, ein Formular.
    const formular = feld.closest('form')
    if (formular === null) throw new Error('Das Formular der Frage fehlt.')

    await userEvent.click(within(formular).getByRole('button', { name: 'Speichern' }))

    expect(speichereAntwort).toHaveBeenCalledWith(
      'testament',
      TESTAMENT.frage,
      'Im Bankschließfach.',
    )
  })

  it('speichert nicht, solange nichts Neues im Feld steht', () => {
    rendereMitProvidern(<Start />)

    for (const knopf of screen.getAllByRole('button', { name: 'Speichern' })) {
      expect(knopf).toBeDisabled()
    }
  })

  it('zeigt eine gespeicherte Antwort im Feld und sagt, dass sie im Tresor liegt', () => {
    if (TESTAMENT === undefined) throw new Error('Die Frage nach dem Testament fehlt.')

    tresordaten.items = [antwort()]
    rendereMitProvidern(<Start />)

    expect(screen.getByLabelText(beschriftung(TESTAMENT.frage))).toHaveValue('Im Bankschließfach.')
    expect(screen.getByText('Ihre Antwort ist im Tresor gespeichert.')).toBeVisible()
  })

  it('zeigt bei mehreren Antworten auf dieselbe Frage die jüngere', () => {
    if (TESTAMENT === undefined) throw new Error('Die Frage nach dem Testament fehlt.')

    tresordaten.items = [
      antwort({ id: 'item-1', inhalt: 'Im Schrank.', geaendertAm: '2026-08-24T12:00:00Z' }),
      antwort({ id: 'item-2', inhalt: 'Im Bankschließfach.', geaendertAm: '2026-08-25T09:00:00Z' }),
    ]

    rendereMitProvidern(<Start />)

    expect(screen.getByLabelText(beschriftung(TESTAMENT.frage))).toHaveValue('Im Bankschließfach.')
  })

  it('stellt Angehörigen die Fragen nicht — ohne K_v gibt es nichts zu beantworten', () => {
    tresordaten.istPreparer = false
    tresordaten.items = []

    rendereMitProvidern(<Start />)

    expect(screen.queryAllByRole('button', { name: 'Speichern' })).toHaveLength(0)
    expect(screen.getByText(/Dies ist der Vorsorgefall von Anna Müller/)).toBeVisible()
  })

  it('stellt dieselben Fragen in der einfachen Ansicht', () => {
    rendereMitProvidern(<StartEinfach />)

    for (const frage of VORSORGEFRAGEN) {
      expect(screen.getByLabelText(beschriftung(frage.frage))).toBeVisible()
    }
  })

  it('wartet auf den Sync-Stream, bevor die Fragen dastehen', () => {
    aufgabenZustand = 'laedt'
    rendereMitProvidern(<Start />)

    expect(screen.getByRole('status')).toHaveTextContent('Ihre Vorsorgefragen werden geladen')
    expect(screen.queryAllByRole('button', { name: 'Speichern' })).toHaveLength(0)
  })
})
