/**
 * Deterministische Item-IDs für den Rechtskatalog (DESIGN.md §8).
 *
 * ```
 * item_id = UUIDv5(fall_id, HMAC-SHA256(K_cat, "LN-cat-v1" ‖ catalog_task_id))
 * ```
 *
 * Zwei Mitglieder können gleichzeitig instanziieren. Koordinieren kann der
 * Server das nicht — die Aufgaben sind Ende-zu-Ende-verschlüsselt, er sieht nur
 * Ciphertext. Statt eines Mandats mit Ablauf und Aufräumlogik rechnen alle
 * dieselbe ID aus, und ein `insert … on conflict do nothing` macht aus dem
 * zweiten Anlauf einen Nulleffekt.
 *
 * **Warum der HMAC und nicht `UUIDv5(fall_id, catalog_task_id)`.** Das schlichte
 * v5 könnte der Server nachrechnen: Der Katalog ist öffentlich, die `case_id`
 * steht in seiner Tabelle. Er ordnete jede Zeile ihrer Katalogaufgabe zu und
 * wüsste, wer eine Erbausschlagung offen hat — aus einer Tabelle, die außer
 * Ciphertext nichts enthält. Der HMAC nimmt ihm das: Ohne `K_cat` ist keine ID
 * vorberechenbar, und `K_cat` hat er nie gesehen.
 *
 * **Warum `K_cat` und nicht `K_c`.** `K_c` rotiert (§3.4). Zwei Mitglieder auf
 * verschiedenen Seiten einer Rotationsgrenze rechneten verschiedene IDs für
 * dieselbe Aufgabe aus, `on conflict` liefe ins Leere und der Katalog stünde
 * doppelt da — genau der Fehler, den die Konstruktion verhindern soll. `K_cat`
 * entsteht bei der Fallanlage, wird über dieselben `key_wraps` verteilt und nie
 * rotiert.
 *
 * Die `case_id` ist der Namensraum und nicht bloß Beiwerk: Sie trennt zwei
 * Fälle auch dann, wenn zwei Schlüssel je dasselbe wären — eine Zusage, die
 * nicht am Zufallsgenerator hängen muss, wenn sie umsonst zu haben ist.
 */

import { alsBufferSource, hexText, hmacSha256, textBytes, verkette, webcrypto } from './bytes'
import { DOMAIN_SEPARATION } from './domain'

/** Ein UUID-Textwert, wie ihn Postgres und `crypto.randomUUID` schreiben. */
const UUID_FORM = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const UUID_BYTES = 16

/** Eine Katalog-ID war nicht zu berechnen. */
export class KatalogIdFehler extends Error {
  constructor(nachricht: string) {
    super(nachricht)
    this.name = 'KatalogIdFehler'
  }
}

/** Die 16 Bytes hinter einem UUID-Text. */
function uuidBytes(uuid: string): Uint8Array {
  if (!UUID_FORM.test(uuid)) {
    throw new KatalogIdFehler(`"${uuid}" ist keine UUID und taugt nicht als Namensraum.`)
  }

  const hex = uuid.replaceAll('-', '')
  const bytes = new Uint8Array(UUID_BYTES)

  for (let i = 0; i < UUID_BYTES; i++) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  }

  return bytes
}

function alsUuidText(bytes: Uint8Array): string {
  const text = hexText(bytes)

  return `${text.slice(0, 8)}-${text.slice(8, 12)}-${text.slice(12, 16)}-${text.slice(16, 20)}-${text.slice(20, 32)}`
}

/**
 * UUIDv5 nach RFC 9562 §5.5: SHA-1 über Namensraum und Namen, davon die ersten
 * 16 Byte, Version und Variante hineingeschrieben.
 *
 * SHA-1 ist hier kein Versehen. Die Version legt ihn fest, und gebraucht wird
 * keine Kollisionsresistenz gegen einen Angreifer: Der Name ist bereits ein
 * HMAC, den ohne `K_cat` niemand bilden kann.
 */
async function uuidv5(namensraum: Uint8Array, name: Uint8Array): Promise<string> {
  const digest = await webcrypto().subtle.digest(
    'SHA-1',
    alsBufferSource(verkette(namensraum, name)),
  )

  const bytes = new Uint8Array(digest).slice(0, UUID_BYTES)

  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80

  return alsUuidText(bytes)
}

/**
 * Die Item-ID, die eine Katalogaufgabe in einem bestimmten Fall bekommt.
 *
 * Bitgleich auf jedem Gerät, das `K_cat` hat — und auf keinem anderen.
 *
 * @param kcat der Katalogschlüssel des Falls, 32 Byte.
 * @param fallId die `case_id` als Namensraum.
 * @param katalogAufgabeId die stabile Kennung aus der Quelltabelle (§8).
 */
export async function katalogItemId(
  kcat: Uint8Array,
  fallId: string,
  katalogAufgabeId: string,
): Promise<string> {
  const namensraum = uuidBytes(fallId)

  const mac = await hmacSha256(
    kcat,
    textBytes(DOMAIN_SEPARATION.catalogItemId),
    textBytes(katalogAufgabeId),
  )

  return uuidv5(namensraum, mac)
}
