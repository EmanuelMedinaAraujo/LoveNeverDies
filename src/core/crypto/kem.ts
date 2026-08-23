/**
 * KEM: ML-KEM-768 zusammen mit X25519 (DESIGN.md §3.1).
 *
 * **Zum Namen.** §3.1 nennt das Verfahren „X-Wing“. Benutzt wird
 * `ml_kem768_x25519` aus `@noble/post-quantum`, und das ist nicht dasselbe:
 * Dieselben zwei Bausteine, dieselbe Bezeichnung `\.//^\`, aber der Combiner
 * hängt sie in einer anderen Reihenfolge zusammen als
 * draft-connolly-cfrg-xwing-kem — `SHA3-256(ss_M ‖ ss_X ‖ ct_X ‖ pk_X ‖ label)`
 * statt der Bezeichnung voran —, und die Ableitung des Schlüsselpaars aus dem
 * Seed geht ebenfalls einen eigenen Weg. Kryptographisch ist beides in Ordnung;
 * byteweise sind sie unvereinbar.
 *
 * Das ist keine Kleinigkeit für §9: Die Edge Function und jede zweite
 * Implementierung müssen dieselbe `@noble/post-quantum`-Version benutzen, nicht
 * „irgendein X-Wing“. Ein Wechsel der Konstruktion — auch der zur echten
 * Spezifikation hin — macht jeden gespeicherten `wrapped_key` unlesbar und ist
 * damit ein neues `v` (§3.2), keine Aktualisierung einer Abhängigkeit.
 *
 * Das Identitäts-Keypair jedes Geräts. Es beweist, dass jemand lesen darf, und
 * sonst nichts — wer etwas geschrieben hat, sagt erst die Signatur in
 * `sign.ts`.
 *
 * X-Wing statt ML-KEM allein: Bricht eines der beiden Verfahren, hält das
 * andere. Der geheime Schlüssel ist ein 32-Byte-Seed; er verlässt das Gerät
 * nie und liegt at-rest unter einem nicht-extrahierbaren AES-GCM-Schlüssel.
 * Der öffentliche mit seinen 1216 Byte liegt im Klartext auf dem Server.
 *
 * `kem_ct` trägt bewusst keinen eigenen Kopf (§3.2). Welches KEM ihn erzeugt
 * hat, sagt das `v` des `wrapped_key`, der neben ihm in derselben Zeile steht.
 */

import { ml_kem768_x25519 } from '@noble/post-quantum/hybrid.js'

/** `pk_u`: 1216 Byte, öffentlich. */
export const KEM_OEFFENTLICH_LAENGE = 1216

/** `sk_u`: 32-Byte-Seed, verlässt das Gerät nie. */
export const KEM_GEHEIM_LAENGE = 32

export const KEM_CIPHERTEXT_LAENGE = 1120

/** Der Wrapping-Schlüssel für AES-256-GCM, der aus einer Kapselung fällt. */
export const GETEILTES_GEHEIMNIS_LAENGE = 32

/** Ein Schlüssel oder ein Ciphertext passte nicht zu X-Wing. */
export class KemFehler extends Error {
  constructor(nachricht: string, options?: ErrorOptions) {
    super(nachricht, options)
    this.name = 'KemFehler'
  }
}

export type KemSchluesselpaar = {
  /** `sk_u` */
  geheim: Uint8Array
  /** `pk_u` */
  oeffentlich: Uint8Array
}

export type Kapselung = {
  /** `kem_ct`, ohne eigenen Kopf (§3.2). */
  kemCt: Uint8Array
  /** 32 Byte, taugt unmittelbar als AES-256-GCM-Schlüssel. */
  geteiltesGeheimnis: Uint8Array
}

function pruefeLaenge(name: string, bytes: Uint8Array, erwartet: number): void {
  if (bytes.length !== erwartet) {
    throw new KemFehler(`${name} muss ${erwartet} Byte lang sein, war ${bytes.length}.`)
  }
}

/**
 * Erzeugt ein Identitäts-Keypair.
 *
 * @param seed 32 Byte. Ohne Angabe zieht die Bibliothek frischen Zufall. Mit
 * Angabe ist das Paar reproduzierbar — der Seed **ist** der geheime Schlüssel,
 * und der Keystore muss nichts weiter aufbewahren.
 */
export function erzeugeKemSchluesselpaar(seed?: Uint8Array): KemSchluesselpaar {
  if (seed !== undefined) {
    pruefeLaenge('Seed', seed, KEM_GEHEIM_LAENGE)
  }

  const paar = ml_kem768_x25519.keygen(seed)

  return { geheim: paar.secretKey, oeffentlich: paar.publicKey }
}

export function oeffentlicherKemSchluessel(geheim: Uint8Array): Uint8Array {
  pruefeLaenge('Geheimer KEM-Schlüssel', geheim, KEM_GEHEIM_LAENGE)

  return ml_kem768_x25519.getPublicKey(geheim)
}

/** Kapselt ein frisches geteiltes Geheimnis an `pk_u` eines Empfängergeräts. */
export function kapsele(oeffentlich: Uint8Array): Kapselung {
  pruefeLaenge('Öffentlicher KEM-Schlüssel', oeffentlich, KEM_OEFFENTLICH_LAENGE)

  const { cipherText, sharedSecret } = ml_kem768_x25519.encapsulate(oeffentlich)

  return { kemCt: cipherText, geteiltesGeheimnis: sharedSecret }
}

/**
 * Holt das geteilte Geheimnis aus einem `kem_ct` zurück.
 *
 * Ein Ciphertext, der nicht zu diesem Schlüssel gehört, liefert kein Scheitern,
 * sondern ein anderes Geheimnis: ML-KEM verwirft implizit. Bemerkt wird der
 * Irrtum erst am GCM-Tag des `wrapped_key` daneben, und das genügt — beides
 * steht ohnehin in derselben Zeile.
 */
export function entkapsele(kemCt: Uint8Array, geheim: Uint8Array): Uint8Array {
  pruefeLaenge('kem_ct', kemCt, KEM_CIPHERTEXT_LAENGE)
  pruefeLaenge('Geheimer KEM-Schlüssel', geheim, KEM_GEHEIM_LAENGE)

  return ml_kem768_x25519.decapsulate(kemCt, geheim)
}
