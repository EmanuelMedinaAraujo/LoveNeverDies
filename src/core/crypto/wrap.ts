/**
 * Fallschlüssel an ein Gerät wrappen und wieder entpacken (DESIGN.md §3.2, §3.6).
 *
 * Ein Wrap ist die einzige Form, in der `K_c` und `K_cat` den Server je zu
 * sehen bekommen: an den öffentlichen Schlüssel eines Geräts gekapselt, unter
 * dem geteilten Geheimnis verschlüsselt, vom wrappenden Gerät signiert.
 *
 * ```
 * kem_ct       = KEM-encapsulate(pk_u des Empfängers)
 * wrapped_key  = AES-256-GCM(geteiltes Geheimnis, K)
 * signature    = "LN-wrap-v1" ‖ case_id ‖ kid ‖ device_id ‖ SHA-256(kem_ct ‖ wrapped_key)
 * ```
 *
 * Die Signatur wird vor dem Entpacken geprüft: Sie wehrt genau einen
 * Angriff ab: ein Mitglied, das einen formal gültigen Wrap eines falschen
 * `K_c` einstellt und das Empfängergerät damit dauerhaft aussperrt. Der
 * GCM-Tag erkennt nur Beschädigung, nicht die falsche Absicht (§3.6). Deshalb
 * verifiziert diese Datei zuerst und entkapselt danach: nicht umgekehrt und
 * nicht beides nebeneinander.
 *
 * Warum Fall, `kid` und Gerät mitsigniert werden: Ohne sie wäre eine
 * Signatur über einen Ciphertext von einer Zeile in jede andere übertragbar:
 * derselbe Wrap unter einem anderen `kid` (§3.4) oder für ein anderes Gerät.
 * `case_id` und `device_id` sind UUIDs fester Länge und `kid` steht zwischen
 * ihnen. Die Verkettung ist deshalb eindeutig zu lesen, obwohl sie keine
 * Trennzeichen trägt.
 */

import { SCHLUESSEL_LAENGE, entschluessele, verschluessele } from './aead.ts'
import { sha256, textBytes, verkette } from './bytes.ts'
import { DOMAIN_SEPARATION } from './domain.ts'
import { entkapsele, kapsele } from './kem.ts'
import {
  signiere,
  verifiziere,
  type GeheimerSignaturSchluessel,
  type OeffentlicherSignaturSchluessel,
} from './sign.ts'

/** Die drei Byte-Felder, die eine Zeile in `key_wraps` trägt (§4). */
export type Wrap = {
  kemCt: Uint8Array
  wrappedKey: Uint8Array
  signatur: Uint8Array
}

/** Woran ein Wrap gebunden ist: an genau eine Zeile in `key_wraps`. */
export type WrapKontext = {
  fallId: string
  kid: string
  /** Das Empfängergerät, nicht das wrappende. */
  geraeteId: string
}

/** Ein Wrap war nicht zu erzeugen oder nicht anzunehmen. */
export class WrapFehler extends Error {
  constructor(nachricht: string, options?: ErrorOptions) {
    super(nachricht, options)
    this.name = 'WrapFehler'
  }
}

/** Die Bytes, über die signiert wird (§3.2). */
async function signierteNachricht(kontext: WrapKontext, wrap: Omit<Wrap, 'signatur'>) {
  return verkette(
    textBytes(kontext.fallId),
    textBytes(kontext.kid),
    textBytes(kontext.geraeteId),
    await sha256(wrap.kemCt, wrap.wrappedKey),
  )
}

/**
 * Wrappt `schluessel` an das Gerät des Empfängers und signiert das Ergebnis.
 *
 * @param schluessel `K_c` oder `K_cat`, 32 Byte.
 * @param signiererGeheim der Signaturschlüssel dieses Geräts. Es steht
 * danach als `wrapped_by` in der Zeile, und das Empfängergerät verifiziert
 * gegen dessen `sig_public_key`.
 */
export async function wrappeSchluessel(
  schluessel: Uint8Array,
  empfaenger: { geraeteId: string; pkKem: Uint8Array },
  fall: { fallId: string; kid: string },
  signiererGeheim: GeheimerSignaturSchluessel,
): Promise<Wrap> {
  if (schluessel.length !== SCHLUESSEL_LAENGE) {
    throw new WrapFehler(
      `Ein gewrappter Schlüssel muss ${SCHLUESSEL_LAENGE} Byte lang sein, war ${schluessel.length}.`,
    )
  }

  const kontext: WrapKontext = { ...fall, geraeteId: empfaenger.geraeteId }

  let kapselung
  try {
    kapselung = kapsele(empfaenger.pkKem)
  } catch (ursache) {
    throw new WrapFehler('Der öffentliche Schlüssel des Empfängergeräts taugt nicht zum Wrappen.', {
      cause: ursache,
    })
  }

  const wrappedKey = await verschluessele(kapselung.geteiltesGeheimnis, schluessel)
  const ohneSignatur = { kemCt: kapselung.kemCt, wrappedKey }

  return {
    ...ohneSignatur,
    signatur: signiere(
      DOMAIN_SEPARATION.keyWrap,
      await signierteNachricht(kontext, ohneSignatur),
      signiererGeheim,
    ),
  }
}

/**
 * Prüft die Signatur und entpackt danach.
 *
 * @param absenderPkSig der öffentliche Signaturschlüssel des Geräts, das in
 * `wrapped_by` steht.
 * @throws {WrapFehler} wenn die Signatur nicht verifiziert. Dann wird nichts
 * entkapselt und nichts entschlüsselt: Der Wrap ist abgewiesen, nicht kaputt.
 * @throws {AeadFehler} wenn die Signatur zwar gilt, der Wrap aber nicht an
 * dieses Gerät gerichtet war. ML-KEM verwirft implizit (§3.1); bemerkt wird
 * das erst am GCM-Tag.
 */
export async function entpackeSchluessel(
  wrap: Wrap,
  kontext: WrapKontext,
  eigenerKemGeheim: Uint8Array,
  absenderPkSig: OeffentlicherSignaturSchluessel,
): Promise<Uint8Array> {
  if (!(await pruefeSignatur(wrap, kontext, absenderPkSig))) {
    throw new WrapFehler(
      `Die Signatur dieses Wraps (${kontext.kid}) stimmt nicht. Er wird nicht entpackt.`,
    )
  }

  const geteiltesGeheimnis = entkapsele(wrap.kemCt, eigenerKemGeheim)
  const schluessel = await entschluessele(geteiltesGeheimnis, wrap.wrappedKey)

  if (schluessel.length !== SCHLUESSEL_LAENGE) {
    throw new WrapFehler(
      `Im Wrap steckten ${schluessel.length} Byte statt ${SCHLUESSEL_LAENGE}. Das ist kein Fallschlüssel.`,
    )
  }

  return schluessel
}

async function pruefeSignatur(
  wrap: Wrap,
  kontext: WrapKontext,
  absenderPkSig: OeffentlicherSignaturSchluessel,
): Promise<boolean> {
  try {
    return verifiziere(
      wrap.signatur,
      DOMAIN_SEPARATION.keyWrap,
      await signierteNachricht(kontext, wrap),
      absenderPkSig,
    )
  } catch (ursache) {
    // Ein Signatur-Envelope aus einer fremden Version, eine abgeschnittene
    // Spalte: beides ist "verifiziert nicht" und darf hier nicht als Ausnahme
    // an einer Stelle landen, die nur "gültig oder nicht" wissen will.
    throw new WrapFehler('Die Signatur dieses Wraps war nicht zu lesen.', { cause: ursache })
  }
}
