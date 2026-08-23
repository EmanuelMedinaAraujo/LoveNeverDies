/**
 * UUIDv7 für Item-IDs (DESIGN.md §5, RFC 9562 §5.7).
 *
 * `crypto.randomUUID()` liefert v4 und wäre für Fälle und Geräte richtig — für
 * Items nicht. §5 verlangt v7, und zwar aus einem Grund, der nichts mit Mode zu
 * tun hat: Die ID wird **auf dem Gerät** vergeben, damit Anlegen offline
 * funktioniert und die Offline-Queue eine Aufgabe benennen kann, die der Server
 * noch nie gesehen hat. Eine Zufalls-ID täte das auch; was v7 zusätzlich bringt,
 * ist die Zeit im Präfix — Items sortieren sich in Anlagereihenfolge, ohne dass
 * ein zweites Feld dafür da sein muss.
 *
 * ```
 * 48 Bit  unix_ts_ms   Millisekunden seit Epoche, big-endian
 *  4 Bit  version      0111
 * 12 Bit  rand_a       hier: Zähler innerhalb derselben Millisekunde
 *  2 Bit  variant      10
 * 62 Bit  rand_b       Zufall
 * ```
 *
 * **Warum `rand_a` ein Zähler ist und kein Zufall.** RFC 9562 §6.2 lässt beides
 * zu. Mit Zufall stünden zwei in derselben Millisekunde angelegte Aufgaben in
 * zufälliger Reihenfolge — und genau das passiert, wenn jemand zwei Häkchen
 * schnell hintereinander setzt oder ein Katalog auf einen Schlag instanziiert
 * (§8). Der Zähler startet in der unteren Hälfte seines Bereichs, damit er
 * Platz zum Hochzählen hat, ohne sofort überzulaufen.
 *
 * Die Uhr des Geräts darf dabei springen, ohne dass eine ID kleiner wird als
 * die davor: Zurückgesetzt wird der Zeitstempel nie, er wandert nur vorwärts.
 * Das ist kein Ersatz für eine richtige Uhr — die Sortierung *zwischen* Geräten
 * entscheidet ohnehin `seq` vom Server (§4), nicht die ID.
 */

import { zufallsBytes } from './crypto/bytes'

const ZAEHLER_MAXIMUM = 0xfff
const HEX = '0123456789abcdef'

/** Der zuletzt vergebene Zeitstempel. Er wandert ausschließlich vorwärts. */
let letzteZeit = -1

let zaehler = 0

/**
 * Ein Startwert aus der unteren Hälfte: Bis zum Überlauf bleiben mindestens
 * 2048 IDs in derselben Millisekunde, und der Anfangswert verrät trotzdem
 * nicht, die wievielte ID des Geräts dies ist.
 */
function frischerZaehler(): number {
  const [hoch = 0, niedrig = 0] = zufallsBytes(2)

  return (((hoch << 8) | niedrig) & ZAEHLER_MAXIMUM) >> 1
}

function hex(bytes: Uint8Array): string {
  let text = ''

  for (const byte of bytes) {
    text += HEX[byte >> 4]
    text += HEX[byte & 0x0f]
  }

  return text
}

/** Eine neue Item-ID. Streng steigend über alle Aufrufe dieses Tabs hinweg. */
export function uuidv7(): string {
  const jetzt = Date.now()

  if (jetzt > letzteZeit) {
    letzteZeit = jetzt
    zaehler = frischerZaehler()
  } else if (zaehler < ZAEHLER_MAXIMUM) {
    zaehler += 1
  } else {
    // 4096 IDs in einer Millisekunde. Statt von vorn zu zählen und eine
    // kleinere ID zu liefern als die davor, borgt sich die nächste eine
    // Millisekunde aus der Zukunft. Die Uhr holt sie im nächsten Tick wieder ein.
    letzteZeit += 1
    zaehler = frischerZaehler()
  }

  const bytes = new Uint8Array(16)

  // 48 Bit Zeit, big-endian. `Number` trägt 53 Bit ganzzahlig genau, also geht
  // das ohne BigInt — aber nicht mit `>>`, das bei 32 Bit abschneidet.
  bytes[0] = Math.floor(letzteZeit / 2 ** 40) & 0xff
  bytes[1] = Math.floor(letzteZeit / 2 ** 32) & 0xff
  bytes[2] = Math.floor(letzteZeit / 2 ** 24) & 0xff
  bytes[3] = Math.floor(letzteZeit / 2 ** 16) & 0xff
  bytes[4] = Math.floor(letzteZeit / 2 ** 8) & 0xff
  bytes[5] = letzteZeit & 0xff

  bytes[6] = 0x70 | (zaehler >> 8)
  bytes[7] = zaehler & 0xff

  bytes.set(zufallsBytes(8), 8)
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80

  const text = hex(bytes)

  return `${text.slice(0, 8)}-${text.slice(8, 12)}-${text.slice(12, 16)}-${text.slice(16, 20)}-${text.slice(20)}`
}
