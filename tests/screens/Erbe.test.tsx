import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { FallZustand } from '../../src/hooks/useCase.ts'
import type { Todesfalldaten } from '../../src/hooks/useTodesfall.ts'
import type { Tresordaten } from '../../src/hooks/useTresor.ts'
import { Erbe } from '../../src/screens/shared/Erbe/Erbe.tsx'
import type { Fragebaumergebnis } from '../../src/services/aufgabenService.ts'
import type { LesbarerFall } from '../../src/services/fallService.ts'
import type { TresorItem } from '../../src/services/tresorService.ts'
import { rendereMitProvidern } from './harness.tsx'

const navigiere = vi.fn()
const mockLoescheVorsorgefall = vi.fn()
const mockLegeItemAn = vi.fn()
const mockLoescheItem = vi.fn()
const mockVerteileShares = vi.fn()
const mockBestaetigeTodesfall = vi.fn()
const mockOeffneTresor = vi.fn()

let mockFallZustand: FallZustand
let mockTresor: Tresordaten
let mockTodesfall: Todesfalldaten
let mockAufgabenZustand: { status: 'laedt' } | { status: 'bereit' }

/** Das eigene Fragebaum-Ergebnis, privat unter `K_p` (ERBE_DESIGN.md §6). */
const mockFragebaum = vi.fn<() => Fragebaumergebnis | null>(() => null)
/** Ob Bestand, `K_p` und Anmeldung durch sind (ERBE_DESIGN.md §6). */
const mockGeladen = vi.fn<() => boolean>(() => true)

vi.mock('react-router-dom', async () => {
  const echt = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return {
    ...echt,
    useNavigate: () => navigiere,
  }
})

vi.mock('../../src/hooks/useCase.ts', () => ({
  useCase: () => ({
    zustand: mockFallZustand,
    loescheVorsorgefall: mockLoescheVorsorgefall,
    legeVorsorgefallAn: vi.fn(),
    legeTrauerfallAn: vi.fn(),
    verlasseFall: vi.fn(),
    aktualisiere: vi.fn(),
  }),
}))

vi.mock('../../src/hooks/useAufgaben.ts', () => ({
  useAufgaben: () => ({
    zustand:
      mockAufgabenZustand.status === 'laedt'
        ? { status: 'laedt' }
        : { status: 'bereit', laedtNetz: false, netzfehler: null, aufgaben: [], baum: [], uebersprungen: 0 },
    fragebaum: mockFragebaum(),
    fragebaumGeladen: mockGeladen(),
    zeilen: [],
    mutiere: vi.fn(),
    bestaetige: vi.fn(),
    aktualisiere: vi.fn(),
    setzeZuweisung: vi.fn(),
    schliesseAufgabe: vi.fn(),
    oeffneAufgabe: vi.fn(),
    legeAufgabeAn: vi.fn(),
    aendereAufgabe: vi.fn(),
    loescheAufgabe: vi.fn(),
  }),
}))

vi.mock('../../src/hooks/useTresor.ts', () => ({
  useTresor: () => mockTresor,
}))

vi.mock('../../src/hooks/useTodesfall.ts', () => ({
  useTodesfall: () => mockTodesfall,
}))

function standardFall(ueberschreibung: Partial<LesbarerFall> = {}): LesbarerFall {
  return {
    zustand: 'lesbar',
    id: 'fall-1',
    status: 'vorsorge',
    personName: 'Anna Müller',
    sterbedatum: null,
    kid: 'case_fall-1:1',
    keyGeneration: 1,
    rotationPending: false,
    kc: new Uint8Array(32),
    kcat: new Uint8Array(32),
    kv: new Uint8Array(32),
    preparerId: 'user_1',
    vaultCommitment: new Uint8Array(32),
    vaultResplitPending: false,
    vaultK: null,
    vaultN: 0,
    katalogVersion: null,
    ...ueberschreibung,
  }
}

describe('Erbe Screen (§3.5, §7)', () => {
  beforeEach(() => {
    navigiere.mockClear()
    mockLoescheVorsorgefall.mockClear()
    mockLegeItemAn.mockClear()
    mockLoescheItem.mockClear()

    mockVerteileShares.mockReset()
    mockBestaetigeTodesfall.mockReset()
    mockOeffneTresor.mockReset()

    const fall = standardFall()
    mockFallZustand = { status: 'bereit', faelle: [fall], aktiver: fall }
    mockAufgabenZustand = { status: 'bereit' }
    mockFragebaum.mockReturnValue(null)
    mockGeladen.mockReturnValue(true)
    mockTresor = {
      items: [],
      schwelle: { n: 0, k: null },
      istPreparer: true,
      resplitPending: false,
      legeItemAn: mockLegeItemAn,
      loescheItem: mockLoescheItem,
      verteileShares: mockVerteileShares,
      resplitLaeuft: false,
      resplitFehler: null,
    }
    mockTodesfall = {
      freigaben: [],
      k: null,
      kannFreigeben: false,
      eigeneFreigabe: false,
      schwelleErreicht: false,
      laedt: false,
      laeuft: false,
      fehler: null,
      unbrauchbare: [],
      bestaetigeTodesfall: mockBestaetigeTodesfall,
      oeffneTresor: mockOeffneTresor,
      aktualisiere: vi.fn(),
    }
  })

  it('zeigt bei n = 0 den Hinweis zur Einladung von Angehörigen', () => {
    rendereMitProvidern(<Erbe />)

    expect(screen.getByRole('heading', { name: 'Erbe & Tresor' })).toBeVisible()
    expect(screen.getByText('Versiegelt')).toBeVisible()
    expect(
      screen.getByText(/Der Tresor ist versiegelt, kann aber noch von niemandem geöffnet werden/),
    ).toBeVisible()
    expect(screen.getByRole('button', { name: 'Angehörige einladen' })).toBeVisible()
  })

  it('zeigt bei n = 1 den Hinweis auf Alleinöffnung', () => {
    mockTresor.schwelle = { n: 1, k: 1 }
    rendereMitProvidern(<Erbe />)

    expect(
      screen.getByText(/Solange nur 1 Angehörige:r hinterlegt ist, kann diese Person den Tresor allein öffnen/),
    ).toBeVisible()
  })

  it('zeigt bei n >= 2 die nötigen Freigaben k von n', () => {
    mockTresor.schwelle = { n: 3, k: 2 }
    rendereMitProvidern(<Erbe />)

    expect(screen.getByText(/Zur Öffnung sind 2 von 3 Freigaben erforderlich/)).toBeVisible()
  })

  it('ermöglicht dem Preparer das Anlegen eines Tresor-Inhalts', async () => {
    mockLegeItemAn.mockResolvedValue(undefined)
    rendereMitProvidern(<Erbe />)

    await userEvent.click(screen.getByRole('button', { name: 'Inhalt in Tresor legen' }))

    const titelFeld = screen.getByLabelText('Titel')
    const inhaltFeld = screen.getByLabelText('Inhalt / Notiz')

    await userEvent.type(titelFeld, 'Wichtiges Bankkonto')
    await userEvent.type(inhaltFeld, 'DE123456789 bei Sparkasse')

    await userEvent.click(screen.getByRole('button', { name: 'Im Tresor speichern' }))

    expect(mockLegeItemAn).toHaveBeenCalledWith('Wichtiges Bankkonto', 'DE123456789 bei Sparkasse')
  })

  it('zeigt vorhandene Tresor-Inhalte an und erlaubt das Löschen', async () => {
    const item: TresorItem = {
      id: 'item-1',
      titel: 'Testament',
      inhalt: 'Liegt im Bankschließfach.',
      dek: new Uint8Array(32),
      geaendertAm: '2026-08-24T12:00:00Z',
    }
    mockTresor.items = [item]

    rendereMitProvidern(<Erbe />)

    expect(screen.getByText('Testament')).toBeVisible()
    expect(screen.getByText('Liegt im Bankschließfach.')).toBeVisible()

    await userEvent.click(screen.getByRole('button', { name: '"Testament" löschen' }))
    expect(mockLoescheItem).toHaveBeenCalledWith(item)
  })

  it('bietet dem Preparer das Löschen der gesamten Vorsorge mit Bestätigung', async () => {
    mockLoescheVorsorgefall.mockResolvedValue(undefined)
    rendereMitProvidern(<Erbe />)

    await userEvent.click(screen.getByRole('button', { name: 'Vorsorge löschen' }))

    expect(
      screen.getByText(/Möchten Sie diesen Vorsorgefall samt Tresor wirklich unwiderruflich löschen/),
    ).toBeVisible()

    await userEvent.click(screen.getByRole('button', { name: 'Ja, Vorsorge löschen' }))

    expect(mockLoescheVorsorgefall).toHaveBeenCalledWith('fall-1')
    expect(navigiere).toHaveBeenCalledWith('/', { replace: true })
  })

  it('wartet auf den Sync-Stream, bevor der Tresor angezeigt wird', () => {
    mockAufgabenZustand = { status: 'laedt' }
    rendereMitProvidern(<Erbe />)

    expect(screen.getByRole('status')).toHaveTextContent('Tresor wird geladen...')
    expect(screen.queryByText('Versiegelt')).toBeNull()
  })

  it('benennt einen fehlgeschlagenen Re-Split und bietet den zweiten Versuch an', async () => {
    mockVerteileShares.mockResolvedValue({ n: 2, k: 2 })
    mockTresor.resplitFehler = 'Netz weg'
    mockTresor.resplitPending = true

    rendereMitProvidern(<Erbe />)

    expect(screen.getByRole('alert')).toHaveTextContent(/Die Schlüssel konnten nicht neu verteilt werden: Netz weg/)

    await userEvent.click(screen.getByRole('button', { name: 'Erneut versuchen' }))
    expect(mockVerteileShares).toHaveBeenCalledTimes(1)
  })

  it('bietet den zweiten Versuch nicht an, während er schon läuft', () => {
    mockTresor.resplitFehler = 'Netz weg'
    mockTresor.resplitLaeuft = true

    rendereMitProvidern(<Erbe />)

    expect(screen.getByText('Schlüssel werden neu verteilt...')).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Erneut versuchen' })).toBeNull()
  })

  it('zeigt Nicht-Preparern den geschützten Modus ohne Schreibzugriff', () => {
    mockTresor.istPreparer = false
    rendereMitProvidern(<Erbe />)

    expect(screen.getByRole('heading', { name: 'Geschützter Tresor' })).toBeVisible()
    expect(
      screen.getByText(/Dies ist der Vorsorgefall von Anna Müller. Der Tresor ist versiegelt/),
    ).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Inhalt in Tresor legen' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Vorsorge löschen' })).toBeNull()
  })
  it('zeigt den Freigabestand des Falls', () => {
    mockTodesfall.k = 2
    mockTodesfall.freigaben = [
      {
        userId: 'user_2',
        name: 'Bernd Weber',
        freigegebenAm: '2026-08-24T09:00:00Z',
        eigene: false,
      },
    ]

    rendereMitProvidern(<Erbe />)

    expect(screen.getByRole('heading', { name: 'Todesfall bestätigen' })).toBeVisible()
    expect(screen.getByText('1 von 2 Freigaben')).toBeVisible()
    expect(screen.getByText('Bernd Weber')).toBeVisible()
  })

  it('bestätigt den Todesfall erst nach dem Bestätigungsdialog', async () => {
    mockTodesfall.k = 1
    mockTodesfall.kannFreigeben = true
    mockBestaetigeTodesfall.mockResolvedValue(undefined)

    rendereMitProvidern(<Erbe />)

    await userEvent.click(screen.getByRole('button', { name: 'Todesfall bestätigen' }))
    expect(mockBestaetigeTodesfall).not.toHaveBeenCalled()

    expect(
      screen.getByText(/Bestätigen Sie, dass Anna Müller verstorben ist\?/),
    ).toBeVisible()

    await userEvent.click(screen.getByRole('button', { name: 'Ja, Todesfall bestätigen' }))
    expect(mockBestaetigeTodesfall).toHaveBeenCalledTimes(1)
  })

  it('bietet die Bestätigung nicht an, wenn dieses Gerät keinen Schlüsselanteil hält', () => {
    mockTodesfall.kannFreigeben = false

    rendereMitProvidern(<Erbe />)

    expect(screen.queryByRole('button', { name: 'Todesfall bestätigen' })).toBeNull()
  })

  it('sagt es, wenn die eigene Bestätigung schon steht', () => {
    mockTodesfall.k = 1
    mockTodesfall.kannFreigeben = true
    mockTodesfall.eigeneFreigabe = true
    mockTodesfall.freigaben = [
      { userId: 'user_1', name: 'Anna Müller', freigegebenAm: '2026-08-24T09:00:00Z', eigene: true },
    ]

    rendereMitProvidern(<Erbe />)

    expect(screen.getByText('Sie haben den Todesfall bereits bestätigt.')).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Todesfall bestätigen' })).toBeNull()
  })

  it('öffnet den Tresor mit Sterbedatum, sobald die Schwelle erreicht ist', async () => {
    mockTodesfall.k = 1
    mockTodesfall.schwelleErreicht = true
    mockOeffneTresor.mockResolvedValue(undefined)

    rendereMitProvidern(<Erbe />)

    await userEvent.click(screen.getByRole('button', { name: 'Tresor öffnen' }))
    await userEvent.type(screen.getByLabelText('Sterbedatum'), '2026-05-12')
    await userEvent.click(screen.getByRole('button', { name: 'Tresor jetzt öffnen' }))

    expect(mockOeffneTresor).toHaveBeenCalledWith('2026-05-12')
  })

  it('benennt die Person, deren Schlüsselanteil scheitert, und bittet um einen zweiten Versuch', () => {
    mockTodesfall.k = 2
    mockTodesfall.schwelleErreicht = true
    mockTodesfall.fehler = 'Es liegen 1 brauchbare Freigaben vor, nötig sind 2.'
    mockTodesfall.unbrauchbare = ['Clara Weber']

    rendereMitProvidern(<Erbe />)

    expect(screen.getByRole('alert')).toHaveTextContent(
      /Der Schlüsselanteil von Clara Weber ist unbrauchbar/,
    )
    expect(screen.getByRole('alert')).toHaveTextContent(/erneut zu bestätigen/)
  })
})

describe('Erbstatus im Trauerfall (ERBE_DESIGN.md §10)', () => {
  beforeEach(() => {
    // Eigenes Setup: Das `beforeEach` des ersten Blocks gilt hier nicht, und
    // ohne dieses trüge der Vorsorgetest den Trauerfall des vorigen Tests.
    const fall = standardFall()

    mockFallZustand = { status: 'bereit', faelle: [fall], aktiver: fall }
    mockAufgabenZustand = { status: 'bereit' }
    mockFragebaum.mockReturnValue(null)
    mockGeladen.mockReturnValue(true)
    navigiere.mockClear()
  })

  function trauerfall() {
    const fall = standardFall({ status: 'trauerfall', sterbedatum: '2026-03-15' })

    mockFallZustand = { status: 'bereit', faelle: [fall], aktiver: fall }
  }

  it('führt vom Nachlass-Tresor in den geöffneten Tresor (§3.5)', () => {
    /*
     * Vorher stand hier ein Satz, der auf den Tab "Alle" verwies. Was die
     * vorsorgende Person hinterlegt hat, war damit nirgends zu sehen.
     */
    trauerfall()

    rendereMitProvidern(<Erbe />)

    const karte = screen.getByRole('link', { name: /Nachlass-Tresor/ })

    expect(karte).toHaveAttribute('href', '/erbe/tresor')
  })

  it('lädt in den Fragebaum ein, solange kein Ergebnis vorliegt', () => {
    trauerfall()

    rendereMitProvidern(<Erbe />)

    expect(screen.getByRole('button', { name: 'Fragebaum starten' })).toBeInTheDocument()
  })

  it('lädt nicht in den Fragebaum ein, solange K_p noch unterwegs ist', () => {
    /*
     * Der Fehler, den dieser Test festhält: `fragebaum` ist `null`, solange
     * `K_p` fehlt — auch dann, wenn ein Ergebnis gespeichert ist, denn das Item
     * ist bis dahin unlesbar (§3.7). Ein „Fragebaum starten" an dieser Stelle
     * ist eine Einladung, den eigenen Rechtsstand noch einmal zu ermitteln,
     * obwohl er feststeht.
     */
    trauerfall()
    mockGeladen.mockReturnValue(false)

    rendereMitProvidern(<Erbe />)

    expect(screen.queryByRole('button', { name: 'Fragebaum starten' })).not.toBeInTheDocument()
    expect(screen.getByText('Ihr Ergebnis wird geladen...')).toBeInTheDocument()
  })

  it('zeigt das gespeicherte Ergebnis mit seinem Status', () => {
    trauerfall()
    mockFragebaum.mockReturnValue({
      knotenId: 'n6',
      pfad: ['n0', 'n1', 'n2', 'n3', 'n4', 'n6'],
      status: 'erbe',
      am: '2026-08-25T10:00:00.000Z',
    })

    rendereMitProvidern(<Erbe />)

    expect(screen.getByText('Erbe')).toBeInTheDocument()
    expect(screen.getByText('Sie sind Erbe.')).toBeInTheDocument()
    expect(screen.getByText(/Nur für Sie sichtbar/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Fragebaum starten' })).not.toBeInTheDocument()
  })

  it('bietet den erneuten Durchlauf ganz unten an', () => {
    trauerfall()

    rendereMitProvidern(<Erbe />)

    expect(
      screen.getByRole('button', { name: 'Fragebaum erneut durchlaufen' }),
    ).toBeInTheDocument()
  })

  it('zeigt im Vorsorgefall keinen Erbstatus', () => {
    // §2: Ein Vorsorgefall hat keine Erben, und der Fragebaum erscheint dort
    // gar nicht (ERBE_DESIGN.md §1).
    rendereMitProvidern(<Erbe />)

    expect(screen.queryByText('Ihr Erbstatus')).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Fragebaum erneut durchlaufen' }),
    ).not.toBeInTheDocument()
  })
})
