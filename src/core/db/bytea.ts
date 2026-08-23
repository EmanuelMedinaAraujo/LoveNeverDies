/**
 * `bytea` über PostgREST (DESIGN.md §4).
 *
 * Fast jede Spalte, die in diesem Projekt etwas trägt, ist ein Byte-Feld. Die
 * REST-Schicht kennt kein Binärformat und reicht `bytea` als Hex-Zeichenkette
 * mit `\x` davor durch, in beide Richtungen.
 *
 * Der Umweg über Hex kostet die doppelte Größe auf der Leitung — hinnehmbar bei
 * 1216 Byte Schlüssel und 3373 Byte Signatur, und der Preis dafür, dass die
 * Tabellen mit gewöhnlichen Werkzeugen lesbar bleiben. Dateien gehen ohnehin
 * nicht diesen Weg, sondern binär in den Storage-Bucket (§4).
 */

const HEX_ZIFFERN = '0123456789abcdef'

/**
 * Was `Number.parseInt` als Hex durchgehen ließe, aber keines ist.
 *
 * `parseInt` liest so weit, wie es kann, und gibt zurück, was es bis dahin
 * hatte: `parseInt('1g', 16)` ist 1, `parseInt('-1', 16)` ist -1 und landete
 * als 255 im Feld. Nur ein Paar ganz ohne führende Hex-Ziffer ergäbe `NaN` —
 * ein Test darauf prüft also den einen Fall, der ohnehin auffiele. Deshalb
 * wird hier die ganze Zeichenkette geprüft, bevor irgendein Byte entsteht.
 */
const NUR_HEX = /^[0-9a-fA-F]*$/

/** Ein Feld kam nicht in der Kodierung an, die `bytea` über PostgREST hat. */
export class ByteaFehler extends Error {
  constructor(nachricht: string) {
    super(nachricht)
    this.name = 'ByteaFehler'
  }
}

export function alsBytea(bytes: Uint8Array): string {
  let hex = ''

  for (const byte of bytes) {
    hex += HEX_ZIFFERN[byte >> 4]
    hex += HEX_ZIFFERN[byte & 0x0f]
  }

  return `\\x${hex}`
}

/**
 * @param wert die Hex-Zeichenkette aus PostgREST, oder bereits die Bytes.
 * @throws {ByteaFehler} bei allem anderen. Ein falsch gelesener Schlüssel ist
 * schlimmer als ein abgebrochener Aufruf: Er ergäbe einen anderen Prüfcode, und
 * der Abgleich am Telefon scheiterte ohne erkennbaren Grund.
 */
export function ausBytea(wert: unknown): Uint8Array {
  if (wert instanceof Uint8Array) {
    return wert
  }

  if (typeof wert !== 'string' || !wert.startsWith('\\x')) {
    throw new ByteaFehler(
      `Ein bytea-Feld kam weder als Bytes noch als "\\x"-Hex an, sondern als ${typeof wert}.`,
    )
  }

  const hex = wert.slice(2)

  if (hex.length % 2 !== 0) {
    throw new ByteaFehler(`Die Hex-Kodierung hat eine ungerade Länge: ${hex.length}.`)
  }

  if (!NUR_HEX.test(hex)) {
    throw new ByteaFehler('Die Hex-Kodierung enthält Zeichen, die keine Hex-Ziffern sind.')
  }

  const bytes = new Uint8Array(hex.length / 2)

  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  }

  return bytes
}
