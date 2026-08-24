/**
 * Geräte-Fingerprint und Prüfcode (DESIGN.md §3.6).
 *
 * ```
 * fp   = SHA-256("LN-fp-v1" ‖ pk_kem ‖ pk_sig)
 * code = (fp[0] << 16 | fp[1] << 8 | fp[2]) mod 1_000_000, auf 6 Stellen nullgefüllt
 * ```
 *
 * Ein neues Gerät sieht den Fall, kann synchronisieren und liest nichts, bis
 * ein anderes Mitglied `K_c` an seinen öffentlichen Schlüssel wrappt. Bevor das
 * geschieht, vergleichen beide Seiten mündlich sechs Ziffern.
 *
 * Der Fingerprint deckt beide Schlüssel ab. Deckte er nur den
 * KEM-Schlüssel, könnte ein bösartiger Server den Signaturschlüssel
 * austauschen, ohne dass der mündliche Abgleich es bemerkt. Der Abgleich ist
 * bei dieser Zielgruppe die verletzlichste Stelle des Protokolls, also darf er
 * nicht die Hälfte übersehen.
 *
 * Sechs Ziffern sind rund 20 Bit. Das ist keine Kollisionsresistenz, sondern
 * die Grenze dessen, was zwei Menschen am Telefon zuverlässig vergleichen.
 * Der Angreifer müsste das passende Schlüsselpaar vorab finden, nicht
 * nachträglich.
 */

import { sha256, textBytes } from './bytes'
import { DOMAIN_SEPARATION } from './domain'

/** So viele Bytes des Fingerprints gehen in den Prüfcode. */
const PRUEFCODE_BYTES = 3

const PRUEFCODE_STELLEN = 6

const PRUEFCODE_MODUL = 1_000_000

/** Der Fingerprint reichte für einen Prüfcode nicht aus. */
export class FingerprintFehler extends Error {
  constructor(nachricht: string) {
    super(nachricht)
    this.name = 'FingerprintFehler'
  }
}

/**
 * @param pkKem `pk_u`, 1216 Byte.
 * @param pkSig beide öffentlichen Signaturschlüssel hintereinander, so wie
 * {@link pkSigBytes} sie zusammensetzt.
 */
export async function fingerabdruck(pkKem: Uint8Array, pkSig: Uint8Array): Promise<Uint8Array> {
  return sha256(textBytes(DOMAIN_SEPARATION.fingerprint), pkKem, pkSig)
}

/** Die sechs Ziffern aus den ersten drei Fingerprint-Bytes. */
export function pruefcode(fingerabdruckBytes: Uint8Array): string {
  if (fingerabdruckBytes.length < PRUEFCODE_BYTES) {
    throw new FingerprintFehler(
      `Der Prüfcode braucht die ersten ${PRUEFCODE_BYTES} Byte des Fingerprints, bekam ${fingerabdruckBytes.length}.`,
    )
  }

  const [erstes = 0, zweites = 0, drittes = 0] = fingerabdruckBytes

  const zahl = ((erstes << 16) | (zweites << 8) | drittes) % PRUEFCODE_MODUL

  return String(zahl).padStart(PRUEFCODE_STELLEN, '0')
}

/** Der Prüfcode eines Geräts aus seinen beiden öffentlichen Schlüsseln. */
export async function geraetePruefcode(pkKem: Uint8Array, pkSig: Uint8Array): Promise<string> {
  return pruefcode(await fingerabdruck(pkKem, pkSig))
}
