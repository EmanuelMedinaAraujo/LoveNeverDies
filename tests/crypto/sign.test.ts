import { describe, expect, it } from 'vitest'
import { DOMAIN_SEPARATION } from '../../src/core/crypto/domain'
import { EnvelopeFehler, leseSignatur, serialisiereSignatur } from '../../src/core/crypto/envelope'
import {
  ED25519_OEFFENTLICH_LAENGE,
  MLDSA_OEFFENTLICH_LAENGE,
  SIGNATUR_SEED_LAENGE,
  SignFehler,
  erzeugeSignaturSchluesselpaar,
  pkSigBytes,
  signiere,
  verifiziere,
} from '../../src/core/crypto/sign'

/**
 * Nahtstelle: die zusammengesetzte Signatur aus ML-DSA-65 und Ed25519
 * (DESIGN.md §3.2, §3.6).
 *
 * Sie ist gültig, wenn **beide** Hälften verifizieren, und sonst nie. Sie hängt
 * an einem Domain-Präfix, damit eine Freigabesignatur nicht als Wrap-Signatur
 * durchgeht.
 */

const NACHRICHT = new TextEncoder().encode('fall-42|gerät-7')

describe('Signatur-Schlüsselpaar', () => {
  it('hat die Längen aus §3.1', () => {
    const paar = erzeugeSignaturSchluesselpaar()

    expect(paar.oeffentlich.mldsa).toHaveLength(1952)
    expect(paar.oeffentlich.ed25519).toHaveLength(32)
    expect(MLDSA_OEFFENTLICH_LAENGE).toBe(1952)
    expect(ED25519_OEFFENTLICH_LAENGE).toBe(32)
  })

  it('setzt pk_sig aus beiden Hälften in dieser Reihenfolge zusammen', () => {
    const paar = erzeugeSignaturSchluesselpaar()

    expect([...pkSigBytes(paar.oeffentlich)]).toEqual([
      ...paar.oeffentlich.mldsa,
      ...paar.oeffentlich.ed25519,
    ])
  })
})

describe('Signieren und Verifizieren', () => {
  it('verifiziert die eigene Signatur', () => {
    const paar = erzeugeSignaturSchluesselpaar()

    const signatur = signiere(DOMAIN_SEPARATION.keyWrap, NACHRICHT, paar.geheim)

    expect(signatur).toHaveLength(4 + 3309 + 64)
    expect(verifiziere(signatur, DOMAIN_SEPARATION.keyWrap, NACHRICHT, paar.oeffentlich)).toBe(true)
  })

  it('scheitert, wenn die ML-DSA-Hälfte verändert ist', () => {
    const paar = erzeugeSignaturSchluesselpaar()
    const signatur = signiere(DOMAIN_SEPARATION.keyWrap, NACHRICHT, paar.geheim)

    const zerlegt = leseSignatur(signatur)
    zerlegt.mldsa[100] ^= 0x01

    expect(
      verifiziere(
        serialisiereSignatur(zerlegt.mldsa, zerlegt.ed25519),
        DOMAIN_SEPARATION.keyWrap,
        NACHRICHT,
        paar.oeffentlich,
      ),
    ).toBe(false)
  })

  it('scheitert, wenn die Ed25519-Hälfte verändert ist', () => {
    const paar = erzeugeSignaturSchluesselpaar()
    const signatur = signiere(DOMAIN_SEPARATION.keyWrap, NACHRICHT, paar.geheim)

    const zerlegt = leseSignatur(signatur)
    zerlegt.ed25519[10] ^= 0x01

    expect(
      verifiziere(
        serialisiereSignatur(zerlegt.mldsa, zerlegt.ed25519),
        DOMAIN_SEPARATION.keyWrap,
        NACHRICHT,
        paar.oeffentlich,
      ),
    ).toBe(false)
  })

  it('scheitert, wenn die beiden Hälften von verschiedenen Geräten stammen', () => {
    // Beide Hälften sind für sich gültig. Genau das ist der Fall, gegen den
    // „beide müssen verifizieren“ steht: Ein Angreifer, der eine der beiden
    // Signaturen fälschen kann, kommt mit der anderen nicht durch.
    const einesGeraet = erzeugeSignaturSchluesselpaar()
    const anderesGeraet = erzeugeSignaturSchluesselpaar()

    const eine = leseSignatur(signiere(DOMAIN_SEPARATION.keyWrap, NACHRICHT, einesGeraet.geheim))
    const andere = leseSignatur(
      signiere(DOMAIN_SEPARATION.keyWrap, NACHRICHT, anderesGeraet.geheim),
    )

    const gemischt = serialisiereSignatur(eine.mldsa, andere.ed25519)

    expect(verifiziere(gemischt, DOMAIN_SEPARATION.keyWrap, NACHRICHT, einesGeraet.oeffentlich)).toBe(
      false,
    )
    expect(
      verifiziere(gemischt, DOMAIN_SEPARATION.keyWrap, NACHRICHT, anderesGeraet.oeffentlich),
    ).toBe(false)
  })

  it('scheitert an einer anderen Nachricht', () => {
    const paar = erzeugeSignaturSchluesselpaar()
    const signatur = signiere(DOMAIN_SEPARATION.keyWrap, NACHRICHT, paar.geheim)

    const andere = new TextEncoder().encode('fall-42|gerät-8')

    expect(verifiziere(signatur, DOMAIN_SEPARATION.keyWrap, andere, paar.oeffentlich)).toBe(false)
  })

  it('scheitert unter einem anderen Domain-Präfix', () => {
    const paar = erzeugeSignaturSchluesselpaar()

    const signatur = signiere(DOMAIN_SEPARATION.vaultRelease, NACHRICHT, paar.geheim)

    expect(verifiziere(signatur, DOMAIN_SEPARATION.keyWrap, NACHRICHT, paar.oeffentlich)).toBe(false)
  })

  it('scheitert am öffentlichen Schlüssel eines fremden Geräts', () => {
    const paar = erzeugeSignaturSchluesselpaar()
    const signatur = signiere(DOMAIN_SEPARATION.keyWrap, NACHRICHT, paar.geheim)

    const fremd = erzeugeSignaturSchluesselpaar()

    expect(verifiziere(signatur, DOMAIN_SEPARATION.keyWrap, NACHRICHT, fremd.oeffentlich)).toBe(
      false,
    )
  })

  it('weist einen Signatur-Blob unbekannter Version ab, statt ihn zu prüfen', () => {
    const paar = erzeugeSignaturSchluesselpaar()
    const signatur = signiere(DOMAIN_SEPARATION.keyWrap, NACHRICHT, paar.geheim)
    signatur[2] = 4

    expect(() =>
      verifiziere(signatur, DOMAIN_SEPARATION.keyWrap, NACHRICHT, paar.oeffentlich),
    ).toThrow(EnvelopeFehler)
  })

  it('weist öffentliche Schlüssel falscher Länge ab', () => {
    const paar = erzeugeSignaturSchluesselpaar()
    const signatur = signiere(DOMAIN_SEPARATION.keyWrap, NACHRICHT, paar.geheim)

    expect(() =>
      verifiziere(signatur, DOMAIN_SEPARATION.keyWrap, NACHRICHT, {
        mldsa: paar.oeffentlich.mldsa.slice(0, 1951),
        ed25519: paar.oeffentlich.ed25519,
      }),
    ).toThrow(SignFehler)
  })
})

describe('Signatur-Schlüsselpaar aus einem Seed (§3.1)', () => {
  it('ist reproduzierbar', () => {
    const seed = new Uint8Array(SIGNATUR_SEED_LAENGE).fill(9)

    const erstes = erzeugeSignaturSchluesselpaar(seed)
    const zweites = erzeugeSignaturSchluesselpaar(seed)

    expect([...pkSigBytes(erstes.oeffentlich)]).toEqual([...pkSigBytes(zweites.oeffentlich)])
    expect([...erstes.geheim.mldsa]).toEqual([...zweites.geheim.mldsa])
    expect([...erstes.geheim.ed25519]).toEqual([...zweites.geheim.ed25519])
  })

  it('trennt die beiden Hälften des Seeds', () => {
    // Derselbe Seed für ML-DSA und Ed25519 wäre eine Schlüsselwiederverwendung
    // über zwei Verfahren hinweg. Die hintere Hälfte darf die vordere nicht
    // berühren: Wer nur sie ändert, bekommt denselben ML-DSA-Schlüssel.
    const seed = new Uint8Array(SIGNATUR_SEED_LAENGE).fill(9)
    const andereHaelfte = Uint8Array.from(seed)
    andereHaelfte[SIGNATUR_SEED_LAENGE - 1] ^= 0xff

    const erstes = erzeugeSignaturSchluesselpaar(seed)
    const zweites = erzeugeSignaturSchluesselpaar(andereHaelfte)

    expect([...erstes.oeffentlich.mldsa]).toEqual([...zweites.oeffentlich.mldsa])
    expect([...erstes.oeffentlich.ed25519]).not.toEqual([...zweites.oeffentlich.ed25519])
  })

  it('signiert und verifiziert wie ein zufälliges Paar', () => {
    const paar = erzeugeSignaturSchluesselpaar(new Uint8Array(SIGNATUR_SEED_LAENGE).fill(3))
    const signatur = signiere(DOMAIN_SEPARATION.keyWrap, NACHRICHT, paar.geheim)

    expect(verifiziere(signatur, DOMAIN_SEPARATION.keyWrap, NACHRICHT, paar.oeffentlich)).toBe(true)
  })

  it('weist einen Seed falscher Länge ab', () => {
    expect(() => erzeugeSignaturSchluesselpaar(new Uint8Array(31))).toThrow(SignFehler)
  })
})
