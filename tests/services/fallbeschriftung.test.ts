import { describe, expect, it } from 'vitest'
import { fallBeschriftung } from '../../src/services/fallbeschriftung'

/**
 * Nahtstelle: wie ein Trauerfall in der Oberfläche heißt (DESIGN.md §2).
 *
 * §2 verlangt den Namen der Person, keinen Sammelbegriff: Dieser Test hält
 * genau den Satz fest, der auf dem Bildschirm stehen soll.
 */

describe('Die Fallbeschriftung', () => {
  it('nennt Name und Sterbedatum, so wie §2 es zeigt', () => {
    expect(fallBeschriftung('Hans Weber', '2026-05-12')).toBe('Hans Weber · Trauerfall seit 12. Mai 2026')
  })

  it('formatiert einen Tag ohne führende Null im Monat richtig', () => {
    expect(fallBeschriftung('Anna Müller', '2026-01-03')).toBe('Anna Müller · Trauerfall seit 3. Januar 2026')
  })
})
