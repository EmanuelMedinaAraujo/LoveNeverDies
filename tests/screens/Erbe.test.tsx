import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { FallZustand } from '../../src/hooks/useCase.ts'
import type { Tresordaten } from '../../src/hooks/useTresor.ts'
import { Erbe } from '../../src/screens/shared/Erbe/Erbe.tsx'
import type { LesbarerFall } from '../../src/services/fallService.ts'
import type { TresorItem } from '../../src/services/tresorService.ts'
import { rendereMitProvidern } from './harness.tsx'

const navigiere = vi.fn()
const mockLoescheVorsorgefall = vi.fn()
const mockLegeItemAn = vi.fn()
const mockLoescheItem = vi.fn()
const mockVerteileShares = vi.fn()

let mockFallZustand: FallZustand
let mockTresor: Tresordaten
let mockAufgabenZustand: { status: 'laedt' } | { status: 'bereit' }

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
    aktualisiere: vi.fn(),
  }),
}))

vi.mock('../../src/hooks/useAufgaben.ts', () => ({
  useAufgaben: () => ({
    zustand:
      mockAufgabenZustand.status === 'laedt'
        ? { status: 'laedt' }
        : { status: 'bereit', laedtNetz: false, netzfehler: null, aufgaben: [], baum: [], uebersprungen: 0 },
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

function standardFall(ueberschreibung: Partial<LesbarerFall> = {}): LesbarerFall {
  return {
    zustand: 'lesbar',
    id: 'fall-1',
    status: 'vorsorge',
    personName: 'Anna Müller',
    sterbedatum: null,
    kid: 'case_fall-1:1',
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

    const fall = standardFall()
    mockFallZustand = { status: 'bereit', faelle: [fall], aktiver: fall }
    mockAufgabenZustand = { status: 'bereit' }
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
})
