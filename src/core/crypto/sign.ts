/**
 * Zusammengesetzte Signatur: ML-DSA-65 **und** Ed25519 (DESIGN.md §3.2, §3.6).
 *
 * Ein KEM beweist, dass jemand lesen darf, nie wer etwas geschrieben hat.
 * Sobald eine einzelne hochgeladene Zeile darüber entscheidet, ob ein Fall in
 * den Trauerfall kippt, reicht das nicht — also bekommt jedes Gerät ein
 * Signaturpaar dazu.
 *
 * Zusammengesetzt heißt: Beide Verfahren signieren dieselbe Nachricht, und
 * beide müssen verifizieren. Wer nur eines der beiden brechen kann, kommt nicht
 * durch. Die Kosten dafür sind 3373 Byte pro Signatur; sie fallen ausschließlich
 * bei Wraps und Tresorfreigaben an, nicht bei gewöhnlichen Items.
 *
 * Jede Signatur trägt ein Domain-Präfix aus §3.2. Es geht in die signierten
 * Bytes ein, damit eine Freigabesignatur nicht als Wrap-Signatur durchgeht —
 * dieselbe Nachricht unter einem anderen Präfix ist eine andere Nachricht.
 *
 * Dieselbe Prüfung läuft in der Edge Function `vault-release` (§9), deshalb
 * kommt dieses Modul ohne Browser-Abhängigkeiten aus.
 */

import { ed25519 } from '@noble/curves/ed25519.js'
import { ml_dsa65 } from '@noble/post-quantum/ml-dsa.js'
import { textBytes, verkette } from './bytes'
import type { DomainSeparationPrefix } from './domain'
import { leseSignatur, serialisiereSignatur } from './envelope'

export const MLDSA_OEFFENTLICH_LAENGE = 1952
export const MLDSA_GEHEIM_LAENGE = 4032
export const ED25519_OEFFENTLICH_LAENGE = 32
export const ED25519_GEHEIM_LAENGE = 32

/**
 * Der Seed, aus dem beide Signaturschlüssel eines Geräts fallen: 32 Byte für
 * ML-DSA-65, 32 Byte für Ed25519.
 *
 * Getrennte Hälften statt eines gemeinsamen Seeds, weil derselbe Wert sonst
 * zwei Verfahren gleichzeitig trüge. Der Keystore (§3.1) bewahrt genau diese
 * Bytes auf und nichts weiter; die 4032 Byte des geheimen ML-DSA-Schlüssels
 * entstehen bei jedem Start neu.
 */
export const SIGNATUR_SEED_LAENGE = 64

const MLDSA_SEED_LAENGE = 32

/** Ein Signaturschlüssel passte nicht zu ML-DSA-65 + Ed25519. */
export class SignFehler extends Error {
  constructor(nachricht: string) {
    super(nachricht)
    this.name = 'SignFehler'
  }
}

export type OeffentlicherSignaturSchluessel = {
  mldsa: Uint8Array
  ed25519: Uint8Array
}

export type GeheimerSignaturSchluessel = {
  mldsa: Uint8Array
  ed25519: Uint8Array
}

export type SignaturSchluesselpaar = {
  geheim: GeheimerSignaturSchluessel
  oeffentlich: OeffentlicherSignaturSchluessel
}

function pruefeLaenge(name: string, bytes: Uint8Array, erwartet: number): void {
  if (bytes.length !== erwartet) {
    throw new SignFehler(`${name} muss ${erwartet} Byte lang sein, war ${bytes.length}.`)
  }
}

/**
 * @param seed {@link SIGNATUR_SEED_LAENGE} Byte. Ohne Angabe ziehen beide
 * Bibliotheken frischen Zufall. Mit Angabe ist das Paar reproduzierbar — genau
 * so hält der Keystore es, ohne die langen geheimen Schlüssel abzulegen.
 */
export function erzeugeSignaturSchluesselpaar(seed?: Uint8Array): SignaturSchluesselpaar {
  if (seed !== undefined) {
    pruefeLaenge('Signatur-Seed', seed, SIGNATUR_SEED_LAENGE)
  }

  const dsa = ml_dsa65.keygen(seed?.subarray(0, MLDSA_SEED_LAENGE))
  const ed = ed25519.keygen(seed?.subarray(MLDSA_SEED_LAENGE))

  return {
    geheim: { mldsa: dsa.secretKey, ed25519: ed.secretKey },
    oeffentlich: { mldsa: dsa.publicKey, ed25519: ed.publicKey },
  }
}

/**
 * `pk_sig` als zusammenhängende Bytes: ML-DSA zuerst, dann Ed25519.
 *
 * Diese Reihenfolge ist die einzige, die es gibt, weil der Geräte-Fingerprint
 * aus §3.6 über genau diese Bytes läuft. Wer sie tauscht, ändert jeden
 * Prüfcode.
 */
export function pkSigBytes(oeffentlich: OeffentlicherSignaturSchluessel): Uint8Array {
  pruefeLaenge('Öffentlicher ML-DSA-Schlüssel', oeffentlich.mldsa, MLDSA_OEFFENTLICH_LAENGE)
  pruefeLaenge('Öffentlicher Ed25519-Schlüssel', oeffentlich.ed25519, ED25519_OEFFENTLICH_LAENGE)

  return verkette(oeffentlich.mldsa, oeffentlich.ed25519)
}

/**
 * Die Gegenrichtung zu {@link pkSigBytes}.
 *
 * `device_keys.sig_public_key` ist eine einzige Spalte; wer daraus verifizieren
 * will, braucht die beiden Hälften wieder getrennt. Die Länge wird geprüft,
 * statt blind zu schneiden: Eine zu kurze Zeile ergäbe sonst zwei
 * abgeschnittene Schlüssel, und die Signaturprüfung schlüge fehl, ohne dass
 * jemand wüsste, warum.
 */
export function signaturSchluesselAusBytes(pkSig: Uint8Array): OeffentlicherSignaturSchluessel {
  pruefeLaenge(
    'pk_sig',
    pkSig,
    MLDSA_OEFFENTLICH_LAENGE + ED25519_OEFFENTLICH_LAENGE,
  )

  return {
    mldsa: pkSig.slice(0, MLDSA_OEFFENTLICH_LAENGE),
    ed25519: pkSig.slice(MLDSA_OEFFENTLICH_LAENGE),
  }
}

function signierteBytes(praefix: DomainSeparationPrefix, nachricht: Uint8Array): Uint8Array {
  return verkette(textBytes(praefix), nachricht)
}

/**
 * Signiert `nachricht` unter `praefix` mit beiden Verfahren.
 *
 * @returns den `signature`-Envelope aus §3.2.
 */
export function signiere(
  praefix: DomainSeparationPrefix,
  nachricht: Uint8Array,
  geheim: GeheimerSignaturSchluessel,
): Uint8Array {
  pruefeLaenge('Geheimer ML-DSA-Schlüssel', geheim.mldsa, MLDSA_GEHEIM_LAENGE)
  pruefeLaenge('Geheimer Ed25519-Schlüssel', geheim.ed25519, ED25519_GEHEIM_LAENGE)

  const bytes = signierteBytes(praefix, nachricht)

  return serialisiereSignatur(ml_dsa65.sign(bytes, geheim.mldsa), ed25519.sign(bytes, geheim.ed25519))
}

/**
 * Prüft beide Hälften.
 *
 * @returns `true` nur, wenn ML-DSA-65 **und** Ed25519 verifizieren. Eine
 * kaputte Kodierung zählt als „verifiziert nicht“, nicht als Ausnahme: Eine
 * Signatur, die niemand lesen kann, ist keine gültige Signatur.
 * @throws {EnvelopeFehler} wenn der Blob aus einer Version stammt, die diese
 * App nicht kennt. Das ist etwas anderes als eine ungültige Signatur und darf
 * nicht als solche erscheinen.
 * @throws {SignFehler} bei öffentlichen Schlüsseln falscher Länge.
 */
export function verifiziere(
  signaturBlob: Uint8Array,
  praefix: DomainSeparationPrefix,
  nachricht: Uint8Array,
  oeffentlich: OeffentlicherSignaturSchluessel,
): boolean {
  const envelope = leseSignatur(signaturBlob)

  pruefeLaenge('Öffentlicher ML-DSA-Schlüssel', oeffentlich.mldsa, MLDSA_OEFFENTLICH_LAENGE)
  pruefeLaenge('Öffentlicher Ed25519-Schlüssel', oeffentlich.ed25519, ED25519_OEFFENTLICH_LAENGE)

  const bytes = signierteBytes(praefix, nachricht)

  // Kein früher Ausstieg zwischen den beiden Prüfungen: Beide laufen immer, und
  // erst die Verknüpfung entscheidet. Welche der beiden gescheitert ist, geht
  // niemanden etwas an.
  const mldsaGilt = pruefeStill(() => ml_dsa65.verify(envelope.mldsa, bytes, oeffentlich.mldsa))
  const edGilt = pruefeStill(() => ed25519.verify(envelope.ed25519, bytes, oeffentlich.ed25519))

  return mldsaGilt && edGilt
}

function pruefeStill(pruefung: () => boolean): boolean {
  try {
    return pruefung()
  } catch {
    return false
  }
}
