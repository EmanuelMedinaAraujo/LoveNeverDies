import { describe, expect, it } from 'vitest'
import {
  AeadFehler,
  entschluessele,
  erzeugeAesSchluessel,
  importiereAesSchluessel,
  verschluessele,
} from '../../src/core/crypto/aead'
import { alsBufferSource } from '../../src/core/crypto/bytes'
import { EnvelopeFehler, leseChiffretext } from '../../src/core/crypto/envelope'

/**
 * Nahtstelle: AES-256-GCM über WebCrypto (DESIGN.md §3.2).
 *
 * Alles, was verschlüsselt auf dem Server liegt, geht durch diese beiden
 * Funktionen: `payload`, `wrapped_dek` und `wrapped_key` unterscheiden sich
 * nur darin, was drinsteht.
 */

const KLARTEXT = new TextEncoder().encode('Sterbeurkunde beim Standesamt beantragen')

describe('AES-256-GCM', () => {
  it('entschlüsselt, was es verschlüsselt hat', async () => {
    const schluessel = erzeugeAesSchluessel()

    const blob = await verschluessele(schluessel, KLARTEXT)

    expect([...(await entschluessele(schluessel, blob))]).toEqual([...KLARTEXT])
  })

  it('wrappt einen 32-Byte-DEK in die 48 Byte Nutzlast aus §3.2', async () => {
    const dek = erzeugeAesSchluessel()

    const blob = await verschluessele(erzeugeAesSchluessel(), dek)

    expect(leseChiffretext(blob).ciphertext).toHaveLength(48)
    expect(blob).toHaveLength(4 + 12 + 48)
  })

  it('zieht für jeden Aufruf eine frische Nonce', async () => {
    const schluessel = erzeugeAesSchluessel()

    const einmal = await verschluessele(schluessel, KLARTEXT)
    const nocheinmal = await verschluessele(schluessel, KLARTEXT)

    expect([...leseChiffretext(einmal).nonce]).not.toEqual([...leseChiffretext(nocheinmal).nonce])
    expect([...einmal]).not.toEqual([...nocheinmal])
  })

  it('nimmt auch einen nicht-extrahierbaren CryptoKey', async () => {
    const schluessel = await importiereAesSchluessel(erzeugeAesSchluessel())

    const blob = await verschluessele(schluessel, KLARTEXT)

    expect([...(await entschluessele(schluessel, blob))]).toEqual([...KLARTEXT])
  })

  it('scheitert an einem veränderten Ciphertext', async () => {
    const schluessel = erzeugeAesSchluessel()
    const blob = await verschluessele(schluessel, KLARTEXT)
    blob[blob.length - 1] ^= 0x01

    await expect(entschluessele(schluessel, blob)).rejects.toThrow(AeadFehler)
  })

  it('scheitert am falschen Schlüssel', async () => {
    const blob = await verschluessele(erzeugeAesSchluessel(), KLARTEXT)

    await expect(entschluessele(erzeugeAesSchluessel(), blob)).rejects.toThrow(AeadFehler)
  })

  it('reicht den Versions-Dispatch des Envelopes durch, statt zu raten', async () => {
    const schluessel = erzeugeAesSchluessel()
    const blob = await verschluessele(schluessel, KLARTEXT)
    blob[2] = 9

    await expect(entschluessele(schluessel, blob)).rejects.toThrow(EnvelopeFehler)
  })

  it('reicht einen Schlüsselfehler durch, statt ihn als Tag-Fehler auszugeben', async () => {
    // §3.7 heißt „nicht entschlüsselbar → still verwerfen“, und genau deshalb
    // darf ein AeadFehler ausschließlich einen nicht passenden Tag bedeuten.
    // Ein CryptoKey ohne `decrypt`-Erlaubnis ist ein Defekt im eigenen Code;
    // käme er als AeadFehler an, verschluckte die App die eigenen Daten.
    const nurZumVerschluesseln = await globalThis.crypto.subtle.importKey(
      'raw',
      alsBufferSource(erzeugeAesSchluessel()),
      'AES-GCM',
      false,
      ['encrypt'],
    )
    const blob = await verschluessele(erzeugeAesSchluessel(), KLARTEXT)

    const fehler = await entschluessele(nurZumVerschluesseln, blob).catch((f: unknown) => f)

    expect(fehler).not.toBeInstanceOf(AeadFehler)
    expect((fehler as Error).name).toBe('InvalidAccessError')
  })

  it('weist einen Schlüssel falscher Länge ab', async () => {
    await expect(verschluessele(new Uint8Array(16), KLARTEXT)).rejects.toThrow(AeadFehler)
  })
})
