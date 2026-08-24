import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AufgabenZustand, Aufgabendaten } from '../../src/hooks/useAufgaben.ts'
import type { Falldaten } from '../../src/hooks/useCase.ts'
import type { Erinnerungsdaten } from '../../src/hooks/useErinnerungen.ts'
import type { Aufgabe } from '../../src/services/aufgabenService.ts'
import { baueBaum } from '../../src/services/aufgabenbaum.ts'
import type { LesbarerFall } from '../../src/services/fallService.ts'
import { ALLE, NIEMAND, personen } from '../../src/services/zuweisung.ts'
import { BENUTZER, rendereMitProvidern } from './harness.tsx'

const useCase = vi.fn<() => Falldaten>()
const useAufgaben = vi.fn<() => Aufgabendaten>()

vi.mock('../../src/hooks/useCase.ts', () => ({ useCase: () => useCase() }))
vi.mock('../../src/hooks/useAufgaben.ts', () => ({ useAufgaben: () => useAufgaben() }))
vi.mock('../../src/screens/shared/KeinFall/KeinFall.tsx', () => ({
  KeinFall: () => <p>Fallweiche</p>,
}))

const { Start } = await import('../../src/screens/shared/Start/Start.tsx')

/**
 * Der Tab „Start": H1 „Meine Aufgaben" (DESIGN.md §7).
 *
 * Geprüft wird, was §7 von diesem Screen verlangt: die Überschrift, und
 * darunter ausschließlich, was der angemeldeten Person zugewiesen ist —
 * gefiltert clientseitig, nach dem Entschlüsseln (§3.3). Dazu die Fallsperre,
 * die hier sitzt: Ohne Fall ist die App gesperrt und zeigt die Fallweiche.
 *
 * Der Sync und die Krypto liegen darunter und sind ersetzt; was sie tun, steht
 * in ihren eigenen Tests.
 */

const BERT = { userId: 'user_bert', name: 'Bert Müller' }
const ICH = { userId: BENUTZER.id, name: BENUTZER.anzeigename }

const LESBAR: LesbarerFall = {
  zustand: 'lesbar',
  id: 'fall-1',
  status: 'trauerfall',
  personName: 'Hans Weber',
  sterbedatum: '2024-03-15',
  kid: 'case_fall-1:1',
  kc: new Uint8Array([1]),
  kcat: new Uint8Array([2]),
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
    assignee: personen([ICH]),
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
    ...ueberschreibung,
  }
}

const NETZ = { laedtNetz: false, netzfehler: null }

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
    ...rest,
  }
}

/** Setzt die Liste und gibt zurück, was der Screen zum Schreiben bekommt. */
function mitAufgaben(aufgaben: Aufgabe[], rest: Partial<Aufgabendaten> = {}): Aufgabendaten {
  const daten = aufgabendaten({
    zustand: { status: 'bereit', aufgaben, uebersprungen: 0, ...NETZ },
    ...rest,
  })

  useAufgaben.mockReturnValue(daten)

  return daten
}

beforeEach(() => {
  vi.clearAllMocks()
  useCase.mockReturnValue(falldaten())
  useAufgaben.mockReturnValue(aufgabendaten())
})

describe('Start', () => {
  it('trägt die Überschrift "Meine Aufgaben" (§7)', () => {
    rendereMitProvidern(<Start />)

    expect(screen.getByRole('heading', { level: 1, name: 'Meine Aufgaben' })).toBeVisible()
  })

  it('nennt darunter, um wessen Fall es geht (§2)', () => {
    rendereMitProvidern(<Start />)

    expect(screen.getByText('Hans Weber · Trauerfall seit 15. März 2024')).toBeVisible()
  })

  it('führt zu allen Aufgaben und zum Profil', () => {
    rendereMitProvidern(<Start />)

    expect(screen.getByRole('link', { name: 'Alle Aufgaben' })).toHaveAttribute('href', '/alle')
    expect(screen.getByRole('link', { name: 'Profil und Geräte' })).toHaveAttribute(
      'href',
      '/profil',
    )
  })

  it('zeigt ausschließlich die eigenen Aufgaben (§7)', () => {
    /*
     * Der Kern des Screens: Gefiltert wird clientseitig, nach dem
     * Entschlüsseln — der Server kann es nicht, weil `assignee` verschlüsselt
     * ist (§3.3).
     */
    mitAufgaben([
      aufgabe({ id: 'item-1', titel: 'Meine Aufgabe' }),
      aufgabe({ id: 'item-2', titel: 'Berts Aufgabe', assignee: personen([BERT]) }),
      aufgabe({ id: 'item-3', titel: 'Noch offen', assignee: NIEMAND }),
    ])

    rendereMitProvidern(<Start />)

    expect(screen.getByText('Meine Aufgabe')).toBeVisible()
    expect(screen.queryByText('Berts Aufgabe')).toBeNull()
    expect(screen.queryByText('Noch offen')).toBeNull()
  })

  it('zeigt eine "Alle" zugewiesene Aufgabe bei jedem Mitglied (§7)', () => {
    mitAufgaben([aufgabe({ id: 'item-1', titel: 'Trauerfeier planen', assignee: ALLE })])

    rendereMitProvidern(<Start />)

    expect(screen.getByText('Trauerfeier planen')).toBeVisible()
    expect(screen.getByText('Zuständig: Alle')).toBeVisible()
  })

  it('zeigt auch eine Aufgabe, die neben anderen mir gehört', () => {
    mitAufgaben([aufgabe({ titel: 'Konto kündigen', assignee: personen([BERT, ICH]) })])

    rendereMitProvidern(<Start />)

    expect(screen.getByText('Konto kündigen')).toBeVisible()
    expect(screen.getByText(`Zuständig: Bert Müller und Sie`)).toBeVisible()
  })

  it('zeigt eine mir zugewiesene Unteraufgabe mit ihrer Elternaufgabe', () => {
    // Eine Familie teilt eine Aufgabe auf; wessen Name an der Unteraufgabe
    // steht, muss sie auf seinem Start-Screen finden (§7).
    mitAufgaben([
      aufgabe({ id: 'item-1', titel: 'Sterbefall anzeigen', assignee: personen([BERT]) }),
      aufgabe({
        id: 'item-2',
        titel: 'Urkunden bestellen',
        parentId: 'item-1',
        assignee: personen([ICH]),
      }),
    ])

    rendereMitProvidern(<Start />)

    expect(screen.getByText('Urkunden bestellen')).toBeVisible()
    expect(screen.getByText('Unteraufgabe von „Sterbefall anzeigen“')).toBeVisible()
  })

  it('sagt es, wenn gerade nichts zugewiesen ist', () => {
    mitAufgaben([aufgabe({ assignee: personen([BERT]) })])

    rendereMitProvidern(<Start />)

    expect(screen.getByText(/Ihnen ist gerade nichts zugewiesen/)).toBeVisible()
  })

  it('hakt eine Aufgabe von hier aus ab', async () => {
    const daten = mitAufgaben([aufgabe({ titel: 'Sterbeurkunde beantragen' })])

    rendereMitProvidern(<Start />)

    await userEvent.click(screen.getByRole('checkbox', { name: 'Sterbeurkunde beantragen' }))

    expect(daten.hakeAb).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'item-1' }),
      true,
    )
  })

  it('führt ins ganzseitige Aufgabendetail', () => {
    rendereMitProvidern(<Start />)

    expect(screen.getByRole('link', { name: /Details/ })).toHaveAttribute('href', '/aufgabe/item-1')
  })

  it('meldet, wer eine Aufgabe stattdessen übernommen hat (§7)', async () => {
    const bestaetigeUebernahmen = vi.fn()

    mitAufgaben([aufgabe()], {
      uebernahmen: [{ itemId: 'item-9', titel: 'Konto kündigen', name: 'Bert Müller' }],
      bestaetigeUebernahmen,
    })

    rendereMitProvidern(<Start />)

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Bert Müller hat diese Aufgabe übernommen: „Konto kündigen“',
    )

    await userEvent.click(screen.getByRole('button', { name: 'Verstanden' }))

    expect(bestaetigeUebernahmen).toHaveBeenCalled()
  })
})

describe('Fallsperre (§7)', () => {
  it('zeigt einen Hinweis, solange die Fälle geladen werden', () => {
    useCase.mockReturnValue(falldaten({ zustand: { status: 'laedt' } }))

    rendereMitProvidern(<Start />)

    expect(screen.getByRole('status')).toHaveTextContent('Ihre Daten werden geladen')
  })

  it('zeigt ohne Fall die Fallweiche', () => {
    useCase.mockReturnValue(falldaten({ zustand: { status: 'kein-fall' } }))

    rendereMitProvidern(<Start />)

    expect(screen.getByText('Fallweiche')).toBeVisible()
  })

  it('nennt den Grund, wenn die Fälle nicht abrufbar sind', () => {
    useCase.mockReturnValue(falldaten({ zustand: { status: 'fehler', nachricht: 'Kein Netz.' } }))

    rendereMitProvidern(<Start />)

    expect(screen.getByRole('alert')).toHaveTextContent('Kein Netz.')
  })

  it('zeigt den blossen Namen, wenn kein Sterbedatum bekannt ist', () => {
    const ohneDatum = { ...LESBAR, sterbedatum: null }
    useCase.mockReturnValue(
      falldaten({ zustand: { status: 'bereit', faelle: [ohneDatum], aktiver: ohneDatum } }),
    )

    rendereMitProvidern(<Start />)

    expect(screen.getByText('Hans Weber')).toBeVisible()
  })

  it('sagt bei einem gesperrten Fall, dass er gesperrt ist', () => {
    const gesperrt = {
      zustand: 'gesperrt' as const,
      id: 'fall-1',
      grund: 'Für dieses Gerät liegt noch kein Schlüssel vor.',
    }
    useCase.mockReturnValue(
      falldaten({ zustand: { status: 'bereit', faelle: [gesperrt], aktiver: gesperrt } }),
    )

    rendereMitProvidern(<Start />)

    expect(screen.getByRole('alert')).toHaveTextContent('kein Schlüssel')
  })
})
