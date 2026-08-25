import { vi } from 'vitest'
import type { AufgabenZustand, Aufgabendaten } from '../../../src/hooks/useAufgaben.ts'
import type { Falldaten } from '../../../src/hooks/useCase.ts'
import type { Erinnerungsdaten } from '../../../src/hooks/useErinnerungen.ts'
import type {
  Aufgabe,
  Katalogherkunft,
} from '../../../src/services/aufgabenService.ts'
import { baueBaum } from '../../../src/services/aufgabenbaum.ts'
import type { LesbarerFall } from '../../../src/services/fallService.ts'
import { personen } from '../../../src/services/zuweisung.ts'
import { BENUTZER } from '../harness.tsx'

/**
 * Die Attrappen für die drei Screens der einfachen Ansicht (DESIGN.md §7).
 *
 * Eine Datei für alle drei, weil sie dieselben drei Hooks ersetzen und
 * dieselbe Aufgabe im Fall brauchen. Dreimal derselbe Fixtureblock wären drei
 * Stellen, an denen ein neues Feld in `Aufgabendaten` nachgetragen werden muss.
 *
 * Der Sync und die Krypto liegen darunter und sind ersetzt; was sie tun, steht
 * in ihren eigenen Tests.
 */

export const BERT = { userId: 'user_bert', name: 'Bert Müller' }
export const ICH = { userId: BENUTZER.id, name: BENUTZER.anzeigename }

export const LESBAR: LesbarerFall = {
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

/** Was beim Instanziieren aus dem Katalog in die Aufgabe kopiert wurde (§8). */
export function herkunft(ueberschreibung: Partial<Katalogherkunft> = {}): Katalogherkunft {
  return {
    aufgabeId: 'sterbefall-anzeigen',
    version: '2026-08+testtest',
    fristTage: 3,
    fristAb: 'sterbedatum',
    zustaendigeStelle: 'Standesamt des Sterbeortes',
    benoetigteDokumente: ['Todesbescheinigung', 'Personalausweis'],
    unteraufgaben: [],
    haengtAbVon: [],
    hinweis: 'Werktage, keine Kalendertage.',
    kategorie: 'Sofort',
    reihenfolge: 10,
    ...ueberschreibung,
  }
}

export function aufgabe(ueberschreibung: Partial<Aufgabe> = {}): Aufgabe {
  return {
    id: 'item-1',
    titel: 'Sterbeurkunde beantragen',
    beschreibung: '',
    erledigt: false,
    notizen: '',
    parentId: null,
    dependsOn: [],
    assignee: personen([ICH]),
    katalog: null,
    dek: new Uint8Array([9]),
    kid: LESBAR.kid,
    privat: false,
    ...ueberschreibung,
  }
}

export function falldaten(ueberschreibung: Partial<Falldaten> = {}): Falldaten {
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

const NETZ = { laedtNetz: false, netzfehler: null }

export const ERINNERUNGEN: Erinnerungsdaten = {
  erlaubnis: 'nicht-verfuegbar',
  frage: vi.fn().mockResolvedValue(undefined),
  geplant: 0,
}

type RohZustand = { status: 'laedt' } | Omit<Extract<AufgabenZustand, { status: 'bereit' }>, 'baum'>

export function aufgabendaten(
  ueberschreibung: Partial<Omit<Aufgabendaten, 'zustand'>> & { zustand?: RohZustand } = {},
): Aufgabendaten {
  const {
    zustand = { status: 'bereit', aufgaben: [aufgabe()], uebersprungen: 0, ...NETZ },
    ...rest
  } = ueberschreibung

  return {
    zustand: zustand.status === 'laedt' ? zustand : { ...zustand, baum: baueBaum(zustand.aufgaben) },
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
    ich: ICH,
    uebernimm: vi.fn().mockResolvedValue(undefined),
    gibFrei: vi.fn().mockResolvedValue(undefined),
    weiseZu: vi.fn().mockResolvedValue(undefined),
    uebernahmen: [],
    bestaetigeUebernahmen: vi.fn(),
    gibFuerAlleFrei: vi.fn().mockResolvedValue(undefined),
    fristbezug: { sterbedatum: LESBAR.sterbedatum, kenntnisAm: null },
    setzeKenntnisAm: vi.fn().mockResolvedValue(undefined),
    fragebaum: null,
    fragebaumGeladen: true,
    speichereFragebaum: vi.fn().mockResolvedValue(undefined),
    fragebaumAufgabe: () => null,
    legeFragebaumAufgabeAn: vi.fn().mockResolvedValue(undefined),
    ...rest,
  }
}

/** Der Bestand für einen Screen, samt der Attrappen, die er zum Schreiben bekommt. */
export function mitAufgaben(
  useAufgaben: { mockReturnValue: (daten: Aufgabendaten) => unknown },
  aufgaben: Aufgabe[],
  rest: Partial<Aufgabendaten> = {},
): Aufgabendaten {
  const daten = aufgabendaten({
    zustand: { status: 'bereit', aufgaben, uebersprungen: 0, ...NETZ },
    ...rest,
  })

  useAufgaben.mockReturnValue(daten)

  return daten
}
