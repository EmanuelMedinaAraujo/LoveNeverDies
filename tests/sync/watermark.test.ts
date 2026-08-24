import { describe, expect, it } from 'vitest'
import type { InhaltZeile } from '../../src/core/db/inhalte'
import { brauchtDelta, geruecktesWasserzeichen } from '../../src/core/sync/watermark'

/**
 * Nahtstelle: das Wasserzeichen (DESIGN.md §5).
 *
 * Zwei Zeilen Rechnung, an denen der ganze Delta-Sync hängt — und beide sind
 * leicht falsch zu schreiben:
 *
 *   1. Der billige Check vergleicht `cases.version` mit dem Wasserzeichen.
 *      Gleich heisst kein Fetch.
 *   2. Nach einem Delta rückt das Wasserzeichen auf die höchste `seq`, die
 *      **im Delta stand** — nie auf die `version`, die der billige Check
 *      geliefert hat.
 */

function zeile(seq: number): InhaltZeile {
  return {
    id: `item-${seq}`,
    fallId: 'fall-1',
    seq,
    art: 'item',
    geloescht: false,
    imTresor: false,
    kid: 'case_fall-1:1',
    wrappedDek: new Uint8Array(),
    payload: new Uint8Array(),
    geaendertAm: '2026-08-24T10:00:00Z',
  }
}

describe('brauchtDelta', () => {
  it('spart den Abruf, wenn die version dem Wasserzeichen gleicht', () => {
    expect(brauchtDelta(7, 7)).toBe(false)
  })

  it('holt ab, wenn die version höher steht', () => {
    expect(brauchtDelta(9, 7)).toBe(true)
  })

  it('holt ab, wenn dieses Gerät den Fall noch nie gesehen hat', () => {
    expect(brauchtDelta(3, 0)).toBe(true)
  })

  it('spart den Abruf bei einem leeren Fall', () => {
    // Ein frisch angelegter Fall steht auf `version = 0` und hat noch kein
    // Item. Ein Abruf brächte eine leere Liste — und dieselbe leere Liste bei
    // jeder Türklingel danach.
    expect(brauchtDelta(0, 0)).toBe(false)
  })

  it('holt ab, wenn die version unter dem Wasserzeichen liegt', () => {
    /*
     * Kann nicht passieren, solange `cases.version` nur steigt. Wenn doch —
     * eine wiederhergestellte Datenbank, ein bösartiger Server (§11) —, ist
     * ein Abruf die einzige Antwort, die keinen Stand einfriert.
     */
    expect(brauchtDelta(2, 7)).toBe(true)
  })

  it('holt ab, wenn es zu diesem Fall keine version gibt', () => {
    // Die RLS gibt den Fall nicht her. Der Abruf scheitert dann sichtbar,
    // statt dass der Fall still auf dem Cache-Stand einfriert.
    expect(brauchtDelta(null, 7)).toBe(true)
  })
})

describe('geruecktesWasserzeichen', () => {
  it('rückt auf die höchste seq des Deltas', () => {
    expect(geruecktesWasserzeichen(2, [zeile(3), zeile(4)])).toBe(4)
  })

  it('bleibt stehen, wenn das Delta leer ist', () => {
    expect(geruecktesWasserzeichen(4, [])).toBe(4)
  })

  it('geht nie zurück', () => {
    // Ein Delta trägt ausschliesslich Zeilen oberhalb des Wasserzeichens. Käme
    // trotzdem eine niedrigere Nummer an, dürfte sie den Stand nicht
    // zurückdrehen — der nächste Abruf holte sonst Zeilen doppelt.
    expect(geruecktesWasserzeichen(9, [zeile(3)])).toBe(9)
  })

  it('übernimmt nicht die version, wenn nebenher weitergeschrieben wurde', () => {
    /*
     * Der Fehler, der jede Zeile zwischen zwei Abrufen verschluckt: Zwischen
     * `select version` (sagt 9) und `select … where seq > 2` (liefert 3 und 4)
     * committet ein anderes Gerät die Nummern 5 bis 9. Wer das Wasserzeichen
     * jetzt auf 9 setzt, sieht 5 bis 9 nie wieder. Deshalb rechnet diese
     * Funktion ausschliesslich mit dem, was wirklich angekommen ist, und
     * bekommt die `version` gar nicht erst zu sehen.
     */
    expect(geruecktesWasserzeichen(2, [zeile(3), zeile(4)])).toBe(4)
  })
})
