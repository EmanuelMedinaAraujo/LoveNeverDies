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

  const bytes = new Uint8Array(hex.length / 2)

  for (let i = 0; i < bytes.length; i++) {
    const byte = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16)

    if (Number.isNaN(byte)) {
      throw new ByteaFehler(`Die Hex-Kodierung enthält an Position ${i * 2} keine Hex-Ziffern.`)
    }

    bytes[i] = byte
  }

  return bytes
}
