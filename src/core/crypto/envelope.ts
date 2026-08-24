/**
 * Envelope-Format (DESIGN.md §3.2).
 *
 * ```
 * payload      := "LN" | v:u8 | aead:u8 | nonce:12B | ciphertext+tag
 * wrapped_dek  := "LN" | v:u8 | aead:u8 | nonce:12B | ciphertext+tag   (48B Nutzlast)
 * wrapped_key  := "LN" | v:u8 | aead:u8 | nonce:12B | ciphertext+tag
 * signature    := "LN" | v:u8 | sig:u8  | mldsa:3309B | ed25519:64B
 * ```
 *
 * Jeder Blob ist selbstbeschreibend, damit alte und neue nebeneinander gelesen
 * werden können: Migration läuft lazy, ein Blob wird erst beim nächsten
 * Schreibzugriff migriert, und es lässt sich nie beweisen, dass jede Zeile
 * angefasst wurde.
 *
 * Die drei Chiffretext-Formen sind rein symmetrisch und tragen deshalb nur ein
 * AEAD-Byte. Welches KEM einen `kem_ct` erzeugt hat, sagt das `v` des
 * `wrapped_key`, der neben ihm in derselben Zeile steht; `kem_ct` selbst hat
 * keinen eigenen Kopf.
 *
 * Der Kopf geht nicht als AAD in die Verschlüsselung ein. Er ist es wert, das
 * ausdrücklich zu sagen: Ein umgebogenes `aead`-Byte führt hier nicht zu einer
 * stillen Fehlentschlüsselung, sondern zu einem Abbruch in {@link leseChiffretext},
 * weil es nur ein einziges bekanntes Verfahren gibt. Kommt je ein zweites dazu,
 * gehört der Kopf unter den Tag. Das ist dann ein neues `v`, kein
 * stillschweigender Wechsel.
 */

/** `"LN"`: jeder Envelope beginnt damit. */
export const ENVELOPE_MAGIC = Uint8Array.of(0x4c, 0x4e)

/** `v = 1` → Suite: ml-kem-768 + x25519 als KEM, aes-256-gcm als AEAD. */
export const ENVELOPE_VERSION = 1

/** `aead = 1` → aes-256-gcm. */
export const AEAD_AES_256_GCM = 1

/** `sig = 1` → ml-dsa-65 + ed25519, beide müssen verifizieren. */
export const SIG_MLDSA65_ED25519 = 1

export const NONCE_LAENGE = 12
export const GCM_TAG_LAENGE = 16
export const MLDSA_SIGNATUR_LAENGE = 3309
export const ED25519_SIGNATUR_LAENGE = 64

const KOPF_LAENGE = ENVELOPE_MAGIC.length + 2
const NONCE_ENDE = KOPF_LAENGE + NONCE_LAENGE
const MLDSA_ENDE = KOPF_LAENGE + MLDSA_SIGNATUR_LAENGE
const SIGNATUR_LAENGE = MLDSA_ENDE + ED25519_SIGNATUR_LAENGE

/**
 * Ein Blob liess sich nicht als Envelope lesen oder nicht als einer schreiben.
 *
 * Ein eigener Fehlertyp, damit der Aufrufer "stammt aus einer anderen Version"
 * von "ist kaputt" und beides von einem fehlgeschlagenen AEAD-Tag unterscheiden
 * kann, ohne in Fehlertexten zu suchen.
 */
export class EnvelopeFehler extends Error {
  constructor(nachricht: string) {
    super(nachricht)
    this.name = 'EnvelopeFehler'
  }
}

export type ChiffretextEnvelope = {
  v: number
  aead: number
  nonce: Uint8Array
  /** Ciphertext samt angehängtem GCM-Tag. */
  ciphertext: Uint8Array
}

export type SignaturEnvelope = {
  v: number
  sig: number
  mldsa: Uint8Array
  ed25519: Uint8Array
}

function pruefeLaenge(name: string, bytes: Uint8Array, erwartet: number): void {
  if (bytes.length !== erwartet) {
    throw new EnvelopeFehler(`${name} muss ${erwartet} Byte lang sein, war ${bytes.length}.`)
  }
}

function pruefeKopf(blob: Uint8Array): void {
  if (blob.length < KOPF_LAENGE) {
    throw new EnvelopeFehler(
      `Blob ist mit ${blob.length} Byte zu kurz für einen Envelope-Kopf (${KOPF_LAENGE} Byte).`,
    )
  }

  if (blob[0] !== ENVELOPE_MAGIC[0] || blob[1] !== ENVELOPE_MAGIC[1]) {
    throw new EnvelopeFehler('Blob beginnt nicht mit "LN" und ist kein Envelope.')
  }

  if (blob[2] !== ENVELOPE_VERSION) {
    throw new EnvelopeFehler(
      `Unbekannte Envelope-Version ${blob[2]}. Diese App liest ausschließlich v${ENVELOPE_VERSION}.`,
    )
  }
}

/** Schreibt `payload`, `wrapped_dek` oder `wrapped_key` in der aktuellen Version. */
export function serialisiereChiffretext(nonce: Uint8Array, ciphertext: Uint8Array): Uint8Array {
  pruefeLaenge('Nonce', nonce, NONCE_LAENGE)

  if (ciphertext.length < GCM_TAG_LAENGE) {
    throw new EnvelopeFehler(
      `Ciphertext ist mit ${ciphertext.length} Byte kürzer als der GCM-Tag (${GCM_TAG_LAENGE} Byte).`,
    )
  }

  const blob = new Uint8Array(NONCE_ENDE + ciphertext.length)
  blob.set(ENVELOPE_MAGIC, 0)
  blob[2] = ENVELOPE_VERSION
  blob[3] = AEAD_AES_256_GCM
  blob.set(nonce, KOPF_LAENGE)
  blob.set(ciphertext, NONCE_ENDE)

  return blob
}

/**
 * Liest `payload`, `wrapped_dek` oder `wrapped_key`.
 *
 * @throws {EnvelopeFehler} bei fremdem Magic, unbekanntem `v`, unbekanntem
 * `aead` oder zu kurzem Blob. Ein Blob, den diese Version nicht versteht, wird
 * abgewiesen und nie stillschweigend falsch gelesen.
 */
export function leseChiffretext(blob: Uint8Array): ChiffretextEnvelope {
  pruefeKopf(blob)

  if (blob[3] !== AEAD_AES_256_GCM) {
    throw new EnvelopeFehler(
      `Unbekanntes AEAD-Verfahren ${blob[3]}. Diese App kennt ausschließlich aes-256-gcm (${AEAD_AES_256_GCM}).`,
    )
  }

  if (blob.length < NONCE_ENDE + GCM_TAG_LAENGE) {
    throw new EnvelopeFehler(
      `Chiffretext-Envelope ist mit ${blob.length} Byte zu kurz: Kopf, Nonce und GCM-Tag brauchen ${NONCE_ENDE + GCM_TAG_LAENGE} Byte.`,
    )
  }

  // Die beiden Bytes sind gegen die Konstanten geprueft, also stehen hier die
  // Konstanten: Das ist derselbe Wert, nur ohne die Frage, ob der Blob lang
  // genug war.
  return {
    v: ENVELOPE_VERSION,
    aead: AEAD_AES_256_GCM,
    nonce: blob.slice(KOPF_LAENGE, NONCE_ENDE),
    ciphertext: blob.slice(NONCE_ENDE),
  }
}

/** Schreibt `signature` in der aktuellen Version. Beide Hälften sind Pflicht. */
export function serialisiereSignatur(mldsa: Uint8Array, ed25519: Uint8Array): Uint8Array {
  pruefeLaenge('ML-DSA-65-Signatur', mldsa, MLDSA_SIGNATUR_LAENGE)
  pruefeLaenge('Ed25519-Signatur', ed25519, ED25519_SIGNATUR_LAENGE)

  const blob = new Uint8Array(SIGNATUR_LAENGE)
  blob.set(ENVELOPE_MAGIC, 0)
  blob[2] = ENVELOPE_VERSION
  blob[3] = SIG_MLDSA65_ED25519
  blob.set(mldsa, KOPF_LAENGE)
  blob.set(ed25519, MLDSA_ENDE)

  return blob
}

/**
 * Liest `signature`.
 *
 * @throws {EnvelopeFehler} bei fremdem Magic, unbekanntem `v`, unbekanntem
 * `sig` oder falscher Gesamtlänge.
 */
export function leseSignatur(blob: Uint8Array): SignaturEnvelope {
  pruefeKopf(blob)

  if (blob[3] !== SIG_MLDSA65_ED25519) {
    throw new EnvelopeFehler(
      `Unbekanntes Signaturverfahren ${blob[3]}. Diese App kennt ausschließlich ml-dsa-65 + ed25519 (${SIG_MLDSA65_ED25519}).`,
    )
  }

  if (blob.length !== SIGNATUR_LAENGE) {
    throw new EnvelopeFehler(
      `Signatur-Envelope muss ${SIGNATUR_LAENGE} Byte lang sein, war ${blob.length}.`,
    )
  }

  return {
    v: ENVELOPE_VERSION,
    sig: SIG_MLDSA65_ED25519,
    mldsa: blob.slice(KOPF_LAENGE, MLDSA_ENDE),
    ed25519: blob.slice(MLDSA_ENDE),
  }
}
