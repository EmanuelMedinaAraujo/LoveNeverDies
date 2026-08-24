/**
 * Commitment und die Nachrichten, die signiert werden (DESIGN.md §3.2, §3.5, §8).
 *
 * Jeder Wert hier trägt sein Domain-Präfix aus {@link DOMAIN_SEPARATION}, damit
 * er in keinem anderen Kontext gilt. Die Präfixe teilt der Client mit der Edge
 * Function `vault-release` (§9); deshalb steht hier nichts, was einen Browser
 * bräuchte.
 *
 * Eine Grenze, die im Format liegt: `freigabeNachricht` und `wrapNachricht`
 * hängen ihre Bezeichner aneinander, wie §3.2 es vorschreibt, und ohne Trenner
 * ist eine solche Verkettung mehrdeutig: `user_id="ab" ‖ kid="c"` ergibt
 * dieselben Bytes wie `user_id="a" ‖ kid="bc"`. Ausgenutzt werden könnte das
 * nur von jemandem, der den Signaturschlüssel des Geräts ohnehin besitzt, denn
 * die Signatur bindet alle vier Felder zusammen. Geändert wird es hier nicht
 * einseitig: Das Format steht im Dokument und die Edge Function baut dieselben
 * Bytes.
 */

import { hmacSha256, sha256, textBytes, verkette, gleichZeitkonstant } from './bytes.ts'
import { DOMAIN_SEPARATION } from './domain.ts'

/**
 * `vault_commitment = SHA-256("LN-open-v1" ‖ K_v)`, Klartextspalte auf `cases`.
 *
 * Der Zähler der Freigaben entscheidet nichts, er zeigt nur an (§3.5). Die
 * Entscheidung hängt an diesem Wert: Nur wer `K_v` wirklich rekonstruiert hat,
 * kann ihn treffen.
 */
export async function tresorCommitment(kv: Uint8Array): Promise<Uint8Array> {
  return sha256(textBytes(DOMAIN_SEPARATION.vaultCommitment), kv)
}

/** Prüft einen rekonstruierten `K_v` gegen das abgelegte Commitment. */
export async function stimmtTresorCommitment(
  kv: Uint8Array,
  commitment: Uint8Array,
): Promise<boolean> {
  return gleichZeitkonstant(await tresorCommitment(kv), commitment)
}

export type Freigabe = {
  caseId: string
  userId: string
  kid: string
  /** Der unter dem aktuellen `K_c` neu verschlüsselte Share. */
  releasedShare: Uint8Array
}

/**
 * `case_id ‖ user_id ‖ kid ‖ SHA-256(released_share)`.
 *
 * Signiert wird das unter {@link DOMAIN_SEPARATION.vaultRelease}. Der Share
 * selbst geht nicht in die Signatur ein, nur sein Hash. Die Edge Function
 * prüft die Herkunft, den Inhalt kann sie prinzipiell nicht prüfen, weil der
 * Share unter `K_c` liegt.
 */
export async function freigabeNachricht(freigabe: Freigabe): Promise<Uint8Array> {
  return verkette(
    textBytes(freigabe.caseId),
    textBytes(freigabe.userId),
    textBytes(freigabe.kid),
    await sha256(freigabe.releasedShare),
  )
}

export type Wrap = {
  caseId: string
  kid: string
  deviceId: string
  kemCt: Uint8Array
  wrappedKey: Uint8Array
}

/**
 * `case_id ‖ kid ‖ device_id ‖ SHA-256(kem_ct ‖ wrapped_key)`.
 *
 * Signiert wird das unter {@link DOMAIN_SEPARATION.keyWrap}. Die Signatur wehrt
 * genau einen Angriff ab (§3.6): ein Mitglied, das einen formal gültigen Wrap
 * eines falschen `K_c` einstellt und das Empfängergerät damit dauerhaft
 * aussperrt. Der AES-GCM-Tag erkennt nur Beschädigung, nicht die falsche
 * Absicht. `kem_ct` und `wrapped_key` gehen zusammen in einen Hash, weil nur
 * das Paar etwas bedeutet.
 */
export async function wrapNachricht(wrap: Wrap): Promise<Uint8Array> {
  return verkette(
    textBytes(wrap.caseId),
    textBytes(wrap.kid),
    textBytes(wrap.deviceId),
    await sha256(wrap.kemCt, wrap.wrappedKey),
  )
}

/**
 * `HMAC-SHA256(K_cat, "LN-cat-v1" ‖ catalog_item_path)` (§3.2, §8).
 *
 * Zwei Geräte, die denselben Katalogeintrag instanziieren, kommen auf dieselbe
 * ID und erzeugen kein Duplikat. Das gilt auch dann, wenn sie auf verschiedenen
 * `K_c`-Generationen stehen, denn `K_cat` rotiert nie. Der Server sieht eine
 * Zufallszahl: Derselbe Pfad ergibt in einem anderen Fall eine andere ID.
 */
export async function katalogItemId(kCat: Uint8Array, pfad: string): Promise<Uint8Array> {
  return hmacSha256(kCat, textBytes(DOMAIN_SEPARATION.catalogItemId), textBytes(pfad))
}
