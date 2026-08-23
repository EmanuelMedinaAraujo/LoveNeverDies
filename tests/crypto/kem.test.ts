import { describe, expect, it } from 'vitest'
import {
  GETEILTES_GEHEIMNIS_LAENGE,
  KEM_CIPHERTEXT_LAENGE,
  KEM_GEHEIM_LAENGE,
  KEM_OEFFENTLICH_LAENGE,
  KemFehler,
  entkapsele,
  erzeugeKemSchluesselpaar,
  kapsele,
  oeffentlicherKemSchluessel,
} from '../../src/core/crypto/kem'

/**
 * Nahtstelle: ML-KEM-768 + X25519 als KEM (DESIGN.md §3.1).
 *
 * Das Identitäts-Keypair jedes Geräts. Damit wird `K_c` an ein Gerät gewrappt,
 * und nur damit kommt ein Gerät wieder an einen Fallschlüssel heran.
 */

describe('KEM-Schlüsselpaar', () => {
  it('hat die Längen aus §3.1', () => {
    const paar = erzeugeKemSchluesselpaar()

    expect(paar.oeffentlich).toHaveLength(1216)
    expect(paar.geheim).toHaveLength(32)
    expect(KEM_OEFFENTLICH_LAENGE).toBe(1216)
    expect(KEM_GEHEIM_LAENGE).toBe(32)
  })

  it('ist aus demselben Seed reproduzierbar', () => {
    // `sk_u` ist ein 32-Byte-Seed (§3.1). Was aus dem Seed folgt, muss aus dem
    // Seed folgen — sonst wäre der Seed allein kein vollständiges Backup des
    // Schlüssels, und der Keystore müsste 1216 Byte mehr aufbewahren.
    const seed = new Uint8Array(32).fill(0x2b)

    expect([...erzeugeKemSchluesselpaar(seed).oeffentlich]).toEqual([
      ...erzeugeKemSchluesselpaar(seed).oeffentlich,
    ])
  })

  it('leitet den öffentlichen Schlüssel aus dem geheimen ab', () => {
    const paar = erzeugeKemSchluesselpaar()

    expect([...oeffentlicherKemSchluessel(paar.geheim)]).toEqual([...paar.oeffentlich])
  })

  it('weist einen Seed falscher Länge ab', () => {
    expect(() => erzeugeKemSchluesselpaar(new Uint8Array(31))).toThrow(KemFehler)
  })
})

describe('Kapseln und Entkapseln', () => {
  it('liefert auf beiden Seiten dasselbe geteilte Geheimnis', () => {
    const empfaenger = erzeugeKemSchluesselpaar()

    const { kemCt, geteiltesGeheimnis } = kapsele(empfaenger.oeffentlich)

    expect(geteiltesGeheimnis).toHaveLength(GETEILTES_GEHEIMNIS_LAENGE)
    expect([...entkapsele(kemCt, empfaenger.geheim)]).toEqual([...geteiltesGeheimnis])
  })

  it('gibt einen kem_ct ohne eigenen Kopf aus', () => {
    // §3.2: `kem_ct` trägt bewusst kein "LN"-Präfix. Welches KEM ihn erzeugt
    // hat, sagt das `v` des `wrapped_key`, der neben ihm in derselben Zeile
    // steht.
    const { kemCt } = kapsele(erzeugeKemSchluesselpaar().oeffentlich)

    expect(kemCt).toHaveLength(KEM_CIPHERTEXT_LAENGE)
    expect(KEM_CIPHERTEXT_LAENGE).toBe(1120)
  })

  it('liefert einem fremden Schlüssel ein anderes Geheimnis', () => {
    const { kemCt, geteiltesGeheimnis } = kapsele(erzeugeKemSchluesselpaar().oeffentlich)

    const fremd = entkapsele(kemCt, erzeugeKemSchluesselpaar().geheim)

    expect([...fremd]).not.toEqual([...geteiltesGeheimnis])
  })

  it('zieht für jede Kapselung frische Zufallswerte', () => {
    const empfaenger = erzeugeKemSchluesselpaar()

    const einmal = kapsele(empfaenger.oeffentlich)
    const nocheinmal = kapsele(empfaenger.oeffentlich)

    expect([...einmal.kemCt]).not.toEqual([...nocheinmal.kemCt])
    expect([...einmal.geteiltesGeheimnis]).not.toEqual([...nocheinmal.geteiltesGeheimnis])
  })

  it('weist Schlüssel und Ciphertext falscher Länge ab', () => {
    const empfaenger = erzeugeKemSchluesselpaar()
    const { kemCt } = kapsele(empfaenger.oeffentlich)

    expect(() => kapsele(empfaenger.oeffentlich.slice(0, 1215))).toThrow(KemFehler)
    expect(() => entkapsele(kemCt.slice(0, 1119), empfaenger.geheim)).toThrow(KemFehler)
    expect(() => entkapsele(kemCt, empfaenger.geheim.slice(0, 31))).toThrow(KemFehler)
  })
})
