import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Aufgabendaten } from '../../../src/hooks/useAufgaben.ts'
import type { Falldaten } from '../../../src/hooks/useCase.ts'
import { ALLE, NIEMAND, personen } from '../../../src/services/zuweisung.ts'
import { rendereMitProvidern } from '../harness.tsx'
import { BERT, ICH, aufgabe, aufgabendaten, falldaten, mitAufgaben } from './fixtures.tsx'

const useCase = vi.fn<() => Falldaten>()
const useAufgaben = vi.fn<() => Aufgabendaten>()

vi.mock('../../../src/hooks/useCase.ts', () => ({ useCase: () => useCase() }))
vi.mock('../../../src/hooks/useAufgaben.ts', () => ({ useAufgaben: () => useAufgaben() }))
vi.mock('../../../src/screens/shared/KeinFall/KeinFall.tsx', () => ({
  KeinFall: () => <p>Fallweiche</p>,
}))

const { Start } = await import('../../../src/screens/einfach/Start/Start.tsx')

/**
 * "Start" in der einfachen Ansicht (DESIGN.md §7).
 *
 * Geprüft wird der Unterschied zur erweiterten Fassung, nicht das, was beide
 * teilen: Der Filter auf die eigenen Aufgaben steht in
 * `tests/screens/Start.test.tsx` und gilt hier wie dort. Hier geht es darum,
 * dass weniger auf dem Bildschirm steht, dass die Aktionen Verben tragen und
 * dass der Weg ins Detail derselbe bleibt.
 */

beforeEach(() => {
  vi.clearAllMocks()
  useCase.mockReturnValue(falldaten())
  useAufgaben.mockReturnValue(aufgabendaten())
})

describe('Start (einfach)', () => {
  it('trägt dieselbe Überschrift wie die erweiterte Ansicht (§7)', () => {
    // Die Navigationsstruktur bleibt in beiden Modi identisch, damit
    // Angehörige einander am Telefon helfen können.
    rendereMitProvidern(<Start />)

    expect(screen.getByRole('heading', { level: 1, name: 'Meine Aufgaben' })).toBeVisible()
    expect(screen.getByText('Hans Weber · Trauerfall seit 15. März 2024')).toBeVisible()
  })

  it('zeigt ausschließlich die eigenen Aufgaben (§7)', () => {
    mitAufgaben(useAufgaben, [
      aufgabe({ id: 'item-1', titel: 'Meine Aufgabe' }),
      aufgabe({ id: 'item-2', titel: 'Berts Aufgabe', assignee: personen([BERT]) }),
      aufgabe({ id: 'item-3', titel: 'Noch offen', assignee: NIEMAND }),
    ])

    rendereMitProvidern(<Start />)

    expect(screen.getByText('Meine Aufgabe')).toBeVisible()
    expect(screen.queryByText('Berts Aufgabe')).toBeNull()
    expect(screen.queryByText('Noch offen')).toBeNull()
  })

  it('schweigt über die Zuständigkeit (§7)', () => {
    /*
     * Weniger Elemente pro Screen: Dieser Screen zeigt, was mir zugewiesen
     * ist, und "Alle" oder "Bert Müller und Sie" unter jeder Zeile ist eine
     * Auskunft, die hier niemand gesucht hat. In der erweiterten Ansicht steht
     * sie.
     */
    mitAufgaben(useAufgaben, [
      aufgabe({ id: 'item-1', titel: 'Trauerfeier planen', assignee: ALLE }),
      aufgabe({ id: 'item-2', titel: 'Konto kündigen', assignee: personen([BERT, ICH]) }),
    ])

    rendereMitProvidern(<Start />)

    expect(screen.queryByText('Alle')).toBeNull()
    expect(screen.queryByText('Bert Müller und Sie')).toBeNull()
  })

  it('nennt bei einer Unteraufgabe, wozu sie gehört', () => {
    mitAufgaben(useAufgaben, [
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
    expect(screen.getByText('Gehört zu „Sterbefall anzeigen“')).toBeVisible()
  })

  it('hakt eine Aufgabe von hier aus ab', async () => {
    const daten = mitAufgaben(useAufgaben, [aufgabe({ titel: 'Sterbeurkunde beantragen' })])

    rendereMitProvidern(<Start />)

    await userEvent.click(screen.getByRole('checkbox', { name: 'Sterbeurkunde beantragen' }))

    expect(daten.hakeAb).toHaveBeenCalledWith(expect.objectContaining({ id: 'item-1' }), true)
  })

  it('führt mit einem Verb ins ganzseitige Aufgabendetail (§7)', () => {
    /*
     * §7: "benennt Aktionen mit Verben statt Substantiven". Drüben ist es ein
     * Winkel mit dem Vorlesenamen "Details"; hier steht das Verb auch da.
     */
    rendereMitProvidern(<Start />)

    expect(screen.getByRole('link', { name: /Aufgabe öffnen/ })).toHaveAttribute(
      'href',
      '/aufgabe/item-1',
    )
  })

  it('sagt es, wenn gerade nichts eingetragen ist', () => {
    mitAufgaben(useAufgaben, [aufgabe({ assignee: personen([BERT]) })])

    rendereMitProvidern(<Start />)

    expect(screen.getByText(/Für Sie ist gerade nichts eingetragen/)).toBeVisible()
  })

  it('zeigt ohne Fall die Fallweiche (§7)', () => {
    useCase.mockReturnValue(falldaten({ zustand: { status: 'kein-fall' } }))

    rendereMitProvidern(<Start />)

    expect(screen.getByText('Fallweiche')).toBeVisible()
  })
})
