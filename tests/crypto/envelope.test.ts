import { describe, expect, it } from 'vitest'
import {
  AEAD_AES_256_GCM,
  ENVELOPE_VERSION,
  EnvelopeFehler,
  SIG_MLDSA65_ED25519,
  leseChiffretext,
  leseSignatur,
  serialisiereChiffretext,
  serialisiereSignatur,
} from '../../src/core/crypto/envelope'

/**
 * Nahtstelle: das Envelope-Format aus DESIGN.md §3.2.
 *
 * ```
 * payload | wrapped_dek | wrapped_key := "LN" | v:u8 | aead:u8 | nonce:12B | ciphertext+tag
 * signature                           := "LN" | v:u8 | sig:u8  | mldsa:3309B | ed25519:64B
 * ```
 *
 * Die erwarteten Bytes stehen hier als Literale aus dem Dokument, nicht als
 * Aufruf derselben Konstanten, die der Code benutzt: Ein Envelope, dessen
 * Bytes sich mit dem Code mitverschieben, koennte alte Blobs nicht mehr lesen,
 * ohne dass ein Test etwas dagegen haette.
 */

const NONCE = new Uint8Array(12).fill(0xa1)
const CIPHERTEXT = new Uint8Array(48).fill(0xb2)
const MLDSA = new Uint8Array(3309).fill(0xc3)
const ED25519 = new Uint8Array(64).fill(0xd4)

describe('Chiffretext-Envelope', () => {
  it('traegt Magic, Version und AEAD-Byte an den Stellen aus §3.2', () => {
    const blob = serialisiereChiffretext(NONCE, CIPHERTEXT)

    expect([...blob.slice(0, 4)]).toEqual([0x4c, 0x4e, 1, 1])
    expect([...blob.slice(4, 16)]).toEqual([...NONCE])
    expect(blob).toHaveLength(4 + 12 + 48)
  })

  it('liest zurueck, was es geschrieben hat', () => {
    const gelesen = leseChiffretext(serialisiereChiffretext(NONCE, CIPHERTEXT))

    expect(gelesen.v).toBe(ENVELOPE_VERSION)
    expect(gelesen.aead).toBe(AEAD_AES_256_GCM)
    expect([...gelesen.nonce]).toEqual([...NONCE])
    expect([...gelesen.ciphertext]).toEqual([...CIPHERTEXT])
  })

  it('weist eine unbekannte Version ab und nennt sie', () => {
    const blob = serialisiereChiffretext(NONCE, CIPHERTEXT)
    blob[2] = 2

    expect(() => leseChiffretext(blob)).toThrow(EnvelopeFehler)
    expect(() => leseChiffretext(blob)).toThrow(/Version 2/)
  })

  it('weist ein unbekanntes AEAD-Byte ab und nennt es', () => {
    const blob = serialisiereChiffretext(NONCE, CIPHERTEXT)
    blob[3] = 7

    expect(() => leseChiffretext(blob)).toThrow(/AEAD-Verfahren 7/)
  })

  it('weist einen fremden Blob ohne "LN" ab', () => {
    const blob = serialisiereChiffretext(NONCE, CIPHERTEXT)
    blob[0] = 0x58

    expect(() => leseChiffretext(blob)).toThrow(EnvelopeFehler)
  })

  it('weist einen abgeschnittenen Blob ab, statt ihn halb zu lesen', () => {
    const blob = serialisiereChiffretext(NONCE, CIPHERTEXT)

    // Die kuerzeste ehrliche Nutzlast ist der blanke GCM-Tag ueber leerem
    // Klartext: 4 B Kopf + 12 B Nonce + 16 B Tag.
    expect(() => leseChiffretext(blob.slice(0, 32))).not.toThrow()
    expect(() => leseChiffretext(blob.slice(0, 31))).toThrow(EnvelopeFehler)
    expect(() => leseChiffretext(blob.slice(0, 3))).toThrow(EnvelopeFehler)
  })

  it('weist eine Nonce falscher Laenge schon beim Schreiben ab', () => {
    expect(() => serialisiereChiffretext(new Uint8Array(11), CIPHERTEXT)).toThrow(EnvelopeFehler)
  })
})

describe('Signatur-Envelope', () => {
  it('traegt Magic, Version und sig-Byte an den Stellen aus §3.2', () => {
    const blob = serialisiereSignatur(MLDSA, ED25519)

    expect([...blob.slice(0, 4)]).toEqual([0x4c, 0x4e, 1, 1])
    expect(blob).toHaveLength(4 + 3309 + 64)
  })

  it('liest beide Haelften getrennt zurueck', () => {
    const gelesen = leseSignatur(serialisiereSignatur(MLDSA, ED25519))

    expect(gelesen.v).toBe(ENVELOPE_VERSION)
    expect(gelesen.sig).toBe(SIG_MLDSA65_ED25519)
    expect([...gelesen.mldsa]).toEqual([...MLDSA])
    expect([...gelesen.ed25519]).toEqual([...ED25519])
  })

  it('weist ein unbekanntes sig-Byte ab und nennt es', () => {
    const blob = serialisiereSignatur(MLDSA, ED25519)
    blob[3] = 3

    expect(() => leseSignatur(blob)).toThrow(/Signaturverfahren 3/)
  })

  it('weist eine Signatur falscher Laenge ab', () => {
    const blob = serialisiereSignatur(MLDSA, ED25519)

    expect(() => leseSignatur(blob.slice(0, blob.length - 1))).toThrow(EnvelopeFehler)
    expect(() => serialisiereSignatur(MLDSA.slice(0, 3308), ED25519)).toThrow(EnvelopeFehler)
    expect(() => serialisiereSignatur(MLDSA, ED25519.slice(0, 63))).toThrow(EnvelopeFehler)
  })
})
