import { describe, expect, it } from 'vitest'
import { DUNKEL, HELL, type Farbpalette } from '../../src/ui/farben.ts'

/**
 * Die Palette aus DESIGN.md §12 als JavaScript, für Clerks `appearance`.
 *
 * Geprüft wird die Form, nicht der Geschmack: Beide Paletten tragen dieselben
 * Schlüssel, und jeder Wert ist eine Farbe, die ein Browser versteht. Fehlte
 * ein Schlüssel in einer der beiden, fiele das Anmeldeformular im
 * betroffenen Schema auf Clerks Vorgabefarbe zurück, sichtbar erst dort.
 */

const SCHLUESSEL: (keyof Farbpalette)[] = [
  'hintergrund',
  'karte',
  'kartenrand',
  'akzent',
  'aufAkzent',
  'text',
  'textSekundaer',
  'iconInaktiv',
]

const HEXFARBE = /^#[0-9A-F]{6}$/

describe.each([
  ['HELL', HELL],
  ['DUNKEL', DUNKEL],
])('%s', (_name, palette) => {
  it('traegt genau die vereinbarten Schluessel', () => {
    expect(Object.keys(palette).sort()).toEqual([...SCHLUESSEL].sort())
  })

  it.each(SCHLUESSEL)('%s ist ein Hexwert', (schluessel) => {
    expect(palette[schluessel]).toMatch(HEXFARBE)
  })
})

it('hell und dunkel sind nicht dieselbe Palette', () => {
  expect(HELL).not.toEqual(DUNKEL)
})
