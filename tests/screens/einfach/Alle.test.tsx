import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Aufgabendaten } from '../../../src/hooks/useAufgaben.ts'
import type { Falldaten } from '../../../src/hooks/useCase.ts'
import type { Katalogherkunft } from '../../../src/services/aufgabenService.ts'
import { NIEMAND, personen } from '../../../src/services/zuweisung.ts'
import { rendereMitProvidern } from '../harness.tsx'
import { BERT, aufgabe, aufgabendaten, falldaten, mitAufgaben } from './fixtures.tsx'

const useCase = vi.fn<() => Falldaten>()
const useAufgaben = vi.fn<() => Aufgabendaten>()

vi.mock('../../../src/hooks/useCase.ts', () => ({ useCase: () => useCase() }))
vi.mock('../../../src/hooks/useAufgaben.ts', () => ({ useAufgaben: () => useAufgaben() }))

const { Alle } = await import('../../../src/screens/einfach/Alle/Alle.tsx')

/**
 * "Alle" in der einfachen Ansicht (DESIGN.md §7).
 *
 * Was §7 dieser Ansicht abverlangt, steht hier als Test: weniger Elemente pro
 * Screen, Verben statt Substantive, keine verschachtelte Navigation — und die
 * privaten Aufgaben, die es in beiden Ansichten gibt (§3.7).
 */

beforeEach(() => {
  vi.clearAllMocks()
  useCase.mockReturnValue(falldaten())
  useAufgaben.mockReturnValue(aufgabendaten())
})

describe('Alle (einfach)', () => {
  it('trägt dieselbe Überschrift wie die erweiterte Ansicht (§7)', () => {
    rendereMitProvidern(<Alle />)

    expect(screen.getByRole('heading', { level: 1, name: 'Alle Aufgaben' })).toBeVisible()
  })

  it('zeigt kein Sortierfeld (§7)', () => {
    // Die empfohlene Reihenfolge der Juristinnen (§8) beginnt mit dem, was in
    // den ersten Tagen ansteht. Ein zweites Ranking daneben ist eine Frage,
    // die niemand stellt, während eine Frist läuft.
    rendereMitProvidern(<Alle />)

    expect(screen.queryByLabelText('Sortierung')).toBeNull()
  })

  it('trägt keine Zeilenaktionen zum Ändern oder Löschen (§7)', () => {
    /*
     * Vier Wörter unter jedem Titel, von denen eines löscht: In der
     * erweiterten Ansicht ist das richtig, hier nicht. Geändert und gelöscht
     * wird in der Aufgabe selbst.
     */
    rendereMitProvidern(<Alle />)

    expect(screen.queryByRole('button', { name: /Ändern/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /Löschen/ })).toBeNull()
  })

  it('hält das Formular zu, bis jemand etwas hinzufügen will', async () => {
    rendereMitProvidern(<Alle />)

    expect(screen.queryByLabelText('Was ist zu tun?')).toBeNull()

    await userEvent.click(screen.getByRole('button', { name: 'Aufgabe hinzufügen' }))

    expect(screen.getByLabelText('Was ist zu tun?')).toBeVisible()
  })

  it('öffnet das Formular direkt beim Laden, wenn ?neu=1 übergeben wird', () => {
    rendereMitProvidern(<Alle />, { pfad: '/alle?neu=1' })

    expect(screen.getByLabelText('Was ist zu tun?')).toBeVisible()
  })

  it('legt eine Aufgabe an und schließt danach wieder zu', async () => {
    const daten = mitAufgaben(useAufgaben, [aufgabe()])

    rendereMitProvidern(<Alle />)

    await userEvent.click(screen.getByRole('button', { name: 'Aufgabe hinzufügen' }))
    await userEvent.type(screen.getByLabelText('Was ist zu tun?'), 'Bank anrufen')
    await userEvent.click(screen.getByRole('button', { name: 'Aufgabe speichern' }))

    expect(daten.legeAn).toHaveBeenCalledWith('Bank anrufen', null, false)
    expect(screen.queryByLabelText('Was ist zu tun?')).toBeNull()
  })

  it('legt über "Nur für mich" eine private Aufgabe an (§3.7)', async () => {
    /*
     * "Private Aufgaben sind in beiden Ansichten verfügbar. Der Anlass, eine
     * Erbausschlagung zu erwägen, ohne dass die Geschwister es erfahren,
     * trifft die 78-jährige Witwe mindestens so hart wie den 40-jährigen Sohn."
     */
    const daten = mitAufgaben(useAufgaben, [aufgabe()])

    rendereMitProvidern(<Alle />)

    await userEvent.click(screen.getByRole('button', { name: 'Aufgabe hinzufügen' }))
    await userEvent.type(screen.getByLabelText('Was ist zu tun?'), 'Erbausschlagung prüfen')
    await userEvent.click(screen.getByRole('checkbox', { name: 'Nur für mich' }))
    await userEvent.click(screen.getByRole('button', { name: 'Aufgabe speichern' }))

    expect(daten.legeAn).toHaveBeenCalledWith('Erbausschlagung prüfen', null, true)
  })

  it('markiert eine private Aufgabe in der Liste (§3.7)', () => {
    mitAufgaben(useAufgaben, [aufgabe({ titel: 'Erbausschlagung prüfen', privat: true })])

    rendereMitProvidern(<Alle />)

    expect(screen.getByText('Nur für mich')).toBeVisible()
  })

  it('hakt eine Aufgabe ab, die mir gehört', async () => {
    const daten = mitAufgaben(useAufgaben, [aufgabe({ titel: 'Sterbeurkunde beantragen' })])

    rendereMitProvidern(<Alle />)

    await userEvent.click(screen.getByRole('checkbox', { name: 'Sterbeurkunde beantragen' }))

    expect(daten.hakeAb).toHaveBeenCalledWith(expect.objectContaining({ id: 'item-1' }), true)
  })

  it('zeigt bei einer fremden Aufgabe kein Kästchen und sagt, wem sie gehört (§7)', () => {
    // "Bearbeiten darf nur, wem sie zugewiesen ist." Ein graues Kästchen wäre
    // eine Einladung, die nicht gilt; der Titel allein sagt dasselbe.
    mitAufgaben(useAufgaben, [aufgabe({ titel: 'Berts Aufgabe', assignee: personen([BERT]) })])

    rendereMitProvidern(<Alle />)

    expect(screen.queryByRole('checkbox', { name: 'Berts Aufgabe' })).toBeNull()
    expect(screen.getByText('Berts Aufgabe')).toBeVisible()
    expect(screen.getByText('Zuständig: Bert Müller')).toBeVisible()
  })

  it('weist bei einer freien Aufgabe den Weg zum Übernehmen', () => {
    mitAufgaben(useAufgaben, [aufgabe({ titel: 'Noch offen', assignee: NIEMAND })])

    rendereMitProvidern(<Alle />)

    expect(screen.getByText(/Öffnen Sie die Aufgabe, um sie zu übernehmen/)).toBeVisible()
  })

  it('führt mit einem Verb ins Aufgabendetail (§7)', () => {
    rendereMitProvidern(<Alle />)

    expect(screen.getByRole('link', { name: /Öffnen/ })).toHaveAttribute(
      'href',
      '/aufgabe/item-1',
    )
  })
})

/**
 * Die Fragebaum-Standardaufgabe in "Alle" (ERBE_DESIGN.md §9).
 *
 * Sie hat keine eigene Detailseite: Ihr Ergebnis steht im Fragebaum. Der Weg
 * hinein führt deshalb direkt dorthin statt zur Aufgaben-Detailseite.
 */
describe('Seed-Aufgabe in "Alle" (ERBE_DESIGN.md §9)', () => {
  it('führt direkt in den Fragebaum statt in eine Detailseite', () => {
    mitAufgaben(useAufgaben, [
      aufgabe({
        id: 'seed-1',
        titel: 'Klären ob Sie Erbe sind',
        katalog: { aufgabeId: 'erbenstellung-klaeren', fristTage: null, fristAb: null } as Katalogherkunft,
      }),
    ])

    rendereMitProvidern(<Alle />)

    expect(screen.getByRole('link', { name: /Fragebaum starten/ })).toHaveAttribute(
      'href',
      '/erbe/fragebaum',
    )
  })
})

/** Erledigte Aufgaben in "Alle" (§7): ans Ende, zu Anfang eingeklappt. */
describe('Erledigte Aufgaben in "Alle" (§7)', () => {
  it('stehen hinter den offenen und sind zu Anfang eingeklappt', () => {
    mitAufgaben(useAufgaben, [
      aufgabe({ id: 'item-1', titel: 'Offene Aufgabe' }),
      aufgabe({ id: 'item-2', titel: 'Erledigte Aufgabe', erledigt: true }),
    ])

    rendereMitProvidern(<Alle />)

    expect(screen.getByText('Offene Aufgabe')).toBeVisible()
    expect(screen.queryByText('Erledigte Aufgabe')).toBeNull()
    expect(screen.getByRole('button', { name: '1 erledigte Aufgabe anzeigen' })).toBeVisible()
  })

  it('zeigt sie nach einem Klick auf den Schalter', async () => {
    mitAufgaben(useAufgaben, [
      aufgabe({ id: 'item-1', titel: 'Offene Aufgabe' }),
      aufgabe({ id: 'item-2', titel: 'Erledigte Aufgabe', erledigt: true }),
    ])

    rendereMitProvidern(<Alle />)

    await userEvent.click(screen.getByRole('button', { name: '1 erledigte Aufgabe anzeigen' }))

    expect(screen.getByText('Erledigte Aufgabe')).toBeVisible()
  })

  it('lässt den Schalter ganz weg, wenn nichts erledigt ist', () => {
    mitAufgaben(useAufgaben, [aufgabe({ id: 'item-1', titel: 'Offene Aufgabe' })])

    rendereMitProvidern(<Alle />)

    expect(screen.queryByRole('button', { name: /erledigte Aufgabe/ })).toBeNull()
  })
})
