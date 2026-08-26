import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { alsJsonText, leseQuelltabelle } from '../../build/katalogQuelle.ts'
import { katalog } from '../../src/content/katalog.ts'

/**
 * Der eingecheckte Katalog (DESIGN.md §8).
 *
 * `catalog.de.json` ist erzeugt und eingecheckt zugleich: zwei Eigenschaften,
 * die auseinanderlaufen, sobald jemand die Datei von Hand anfasst oder den
 * Import nach einer Aenderung der Quelltabelle vergisst. Dann behauptete
 * `catalog_version` in jedem Fall eine Herkunft, die es nicht gibt.
 *
 * Deshalb laeuft der Import hier noch einmal und vergleicht Byte fuer Byte.
 */

const QUELLE = fileURLToPath(new URL('../../src/content/rechtskatalog.de.csv', import.meta.url))
const ZIEL = fileURLToPath(new URL('../../src/content/catalog.de.json', import.meta.url))

describe('catalog.de.json (§8)', () => {
  it('ist genau das, was der Import aus der Quelltabelle erzeugt', () => {
    const erzeugt = alsJsonText(leseQuelltabelle(readFileSync(QUELLE, 'utf8')))

    expect(readFileSync(ZIEL, 'utf8')).toBe(erzeugt)
  })

  it('traegt einen Stand, eine Version und Aufgaben', () => {
    const stand = katalog()

    expect(stand.sprache).toBe('de')
    expect(stand.version.startsWith(`${stand.stand}+`)).toBe(true)
    expect(stand.aufgaben.length).toBeGreaterThan(0)
  })

  it('nennt zu jeder Frist ihren Anker (§8)', () => {
    for (const aufgabe of katalog().aufgaben) {
      if (aufgabe.fristTage !== null) {
        expect(aufgabe.fristAb, aufgabe.id).not.toBeNull()
      }
    }
  })

  it('führt in keinem Feld einen Paragraphen (ADR-0003)', () => {
    for (const aufgabe of katalog().aufgaben) {
      const text = Object.values(aufgabe)
        .map((wert) => (Array.isArray(wert) ? wert.join(' ') : String(wert)))
        .join(' ')

      expect(text, aufgabe.id).not.toContain('§')
    }
  })

  it('enthält die automatisch zu erstellenden Aufgaben für den Todesfall', () => {
    const aufgaben = katalog().aufgaben
    expect(aufgaben.map((a) => a.id)).toEqual([
      'totenschein-erstellen',
      'sterbeurkunde-beantragen',
      'bestattungsunternehmen-kontaktieren',
      'tresor-des-vorsorgenden-oeffnen',
      'erbenstellung-klaeren',
    ])

    const totenschein = aufgaben.find((a) => a.id === 'totenschein-erstellen')
    expect(totenschein?.titel).toBe('Totenschein erstellen')
    expect(totenschein?.unteraufgaben).toEqual(['Arzt kontaktieren'])

    const sterbeurkunde = aufgaben.find((a) => a.id === 'sterbeurkunde-beantragen')
    expect(sterbeurkunde?.titel).toBe('Sterbeurkunde beantragen')
    expect(sterbeurkunde?.hinweis).toBe('Übernimmt oft das Bestattungsunternehmen')
    expect(sterbeurkunde?.benoetigteDokumente).toEqual([
      'Totenschein',
      'Personalausweis des Verstorbenen',
      'Geburtsurkunde des Verstorbenen',
      'Heiratsurkunde (Familienbuch/Stammbuch)',
      'Ggf. Sterbeurkunde des Partners/Scheidungsurteil mit Rechtskraftvermerk',
    ])
    expect(sterbeurkunde?.unteraufgaben).toEqual(['Beim Standesamt einreichen'])

    const bestattung = aufgaben.find((a) => a.id === 'bestattungsunternehmen-kontaktieren')
    expect(bestattung?.titel).toBe('Bestattungsunternehmen kontaktieren')

    const tresor = aufgaben.find((a) => a.id === 'tresor-des-vorsorgenden-oeffnen')
    expect(tresor?.titel).toBe('Tresor des Vorsorgenden öffnen und die Fragen')

    const erbe = aufgaben.find((a) => a.id === 'erbenstellung-klaeren')
    expect(erbe?.titel).toBe('Klären ob Sie Erbe sind')
  })
})
