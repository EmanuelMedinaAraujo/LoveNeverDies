/**
 * AEAD: AES-256-GCM über WebCrypto (DESIGN.md §3.2).
 *
 * Durch diese beiden Funktionen geht alles, was verschlüsselt auf dem Server
 * liegt. `payload`, `wrapped_dek` und `wrapped_key` unterscheiden sich nur
 * darin, was drinsteht, nicht in ihrer Behandlung. Deshalb gibt es hier auch
 * nur ein Paar Funktionen und nicht drei.
 *
 * Die Nonce ist 12 Byte Zufall und wird nie wiederverwendet, weil jeder Aufruf
 * eine frische zieht. Ein Zähler wäre bei einer App, die auf mehreren Geräten
 * offline schreibt (§5), nicht führbar: Zwei Geräte kämen bei demselben
 * Schlüssel unweigerlich auf denselben Zähler, und genau das bricht GCM.
 */

import { alsBufferSource, webcrypto, zufallsBytes } from './bytes.ts'
import {
  GCM_TAG_LAENGE,
  NONCE_LAENGE,
  leseChiffretext,
  serialisiereChiffretext,
} from './envelope.ts'

/** AES-256: 32 Byte. */
export const SCHLUESSEL_LAENGE = 32

/**
 * Der Schlüssel liegt entweder als rohe Bytes vor (frisch erzeugt, aus einem
 * Wrap entpackt) oder als `CryptoKey`, den WebCrypto nicht mehr herausgibt.
 * `sk_u` ist at-rest unter genau so einem nicht-extrahierbaren Schlüssel
 * verschlüsselt (§3.1), also muss beides durch dieselbe Tür passen.
 */
export type SchluesselMaterial = Uint8Array | CryptoKey

/** Ver- oder Entschlüsseln ist gescheitert. */
export class AeadFehler extends Error {
  constructor(nachricht: string, options?: ErrorOptions) {
    super(nachricht, options)
    this.name = 'AeadFehler'
  }
}

/** Ein frischer 32-Byte-Schlüssel: `K_c`, `K_cat`, `K_p`, `K_v` oder ein DEK (§3.1). */
export function erzeugeAesSchluessel(): Uint8Array {
  return zufallsBytes(SCHLUESSEL_LAENGE)
}

/**
 * Macht aus rohen Schlüsselbytes einen `CryptoKey`.
 *
 * `extractable = false`: Was einmal importiert ist, gibt WebCrypto nicht mehr
 * heraus. Für Schlüssel, die im Speicher liegen bleiben, ist das die günstigere
 * Voreinstellung; wer die Bytes noch braucht, behält sie selbst.
 */
export async function importiereAesSchluessel(rohbytes: Uint8Array): Promise<CryptoKey> {
  if (rohbytes.length !== SCHLUESSEL_LAENGE) {
    throw new AeadFehler(
      `AES-256 braucht ${SCHLUESSEL_LAENGE} Byte Schlüssel, bekam ${rohbytes.length}.`,
    )
  }

  return webcrypto().subtle.importKey('raw', alsBufferSource(rohbytes), 'AES-GCM', false, [
    'encrypt',
    'decrypt',
  ])
}

async function alsCryptoKey(schluessel: SchluesselMaterial): Promise<CryptoKey> {
  return schluessel instanceof Uint8Array ? importiereAesSchluessel(schluessel) : schluessel
}

/** Verschlüsselt `klartext` und gibt den fertigen Envelope aus §3.2 zurück. */
export async function verschluessele(
  schluessel: SchluesselMaterial,
  klartext: Uint8Array,
): Promise<Uint8Array> {
  const key = await alsCryptoKey(schluessel)
  const nonce = zufallsBytes(NONCE_LAENGE)

  const ciphertext = await webcrypto().subtle.encrypt(
    { name: 'AES-GCM', iv: alsBufferSource(nonce), tagLength: GCM_TAG_LAENGE * 8 },
    key,
    alsBufferSource(klartext),
  )

  return serialisiereChiffretext(nonce, new Uint8Array(ciphertext))
}

/**
 * Liest den Envelope, prüft seine Version und entschlüsselt.
 *
 * @throws {EnvelopeFehler} wenn der Blob aus einer Version stammt, die diese App
 * nicht kennt. Der Versions-Dispatch aus §3.2 läuft vor jeder Kryptographie.
 * @throws {AeadFehler} wenn der GCM-Tag nicht passt. Das ist der Normalfall bei
 * einem privaten Item einer anderen Person (§3.7): Der Aufrufer verwirft es
 * still, statt einen Defekt zu melden.
 */
export async function entschluessele(
  schluessel: SchluesselMaterial,
  blob: Uint8Array,
): Promise<Uint8Array> {
  const envelope = leseChiffretext(blob)
  const key = await alsCryptoKey(schluessel)

  try {
    const klartext = await webcrypto().subtle.decrypt(
      { name: 'AES-GCM', iv: alsBufferSource(envelope.nonce), tagLength: GCM_TAG_LAENGE * 8 },
      key,
      alsBufferSource(envelope.ciphertext),
    )

    return new Uint8Array(klartext)
  } catch (ursache) {
    if (!istTagFehler(ursache)) {
      throw ursache
    }

    throw new AeadFehler(
      'Der GCM-Tag passt nicht: falscher Schlüssel oder veränderter Ciphertext.',
      { cause: ursache },
    )
  }
}

/**
 * Unterscheidet den nicht passenden Tag von allem anderen.
 *
 * WebCrypto wirft bei einem fehlgeschlagenen Tag `OperationError` und bei einem
 * Schlüssel ohne `decrypt`-Erlaubnis `InvalidAccessError`. Das auseinander zu
 * halten ist keine Kosmetik: Ein `AeadFehler` heißt für den Aufrufer "das gehört
 * jemand anderem, still verwerfen" (§3.7). Ein Fehler im eigenen Code darf
 * niemals so aussehen, sonst verschluckt die App die Daten ihres eigenen
 * Benutzers.
 *
 * Geprüft wird der Name statt `instanceof DOMException`, weil derselbe Code in
 * der Edge Function unter Deno läuft (§9).
 */
function istTagFehler(ursache: unknown): boolean {
  return (
    typeof ursache === 'object' &&
    ursache !== null &&
    'name' in ursache &&
    ursache.name === 'OperationError'
  )
}
