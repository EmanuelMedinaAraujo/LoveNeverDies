import { describe, expect, it } from 'vitest'
import { entschluessele, erzeugeAesSchluessel, verschluessele } from '../../src/core/crypto/aead'
import { DOMAIN_SEPARATION } from '../../src/core/crypto/domain'
import { wrapNachricht } from '../../src/core/crypto/commitment'
import { leseChiffretext, leseSignatur } from '../../src/core/crypto/envelope'
import { entkapsele, erzeugeKemSchluesselpaar, kapsele } from '../../src/core/crypto/kem'
import { erzeugeSignaturSchluesselpaar, signiere, verifiziere } from '../../src/core/crypto/sign'

/**
 * Nahtstelle: die vier Envelope-Formen aus §3.2 zusammen: verschlüsseln,
 * serialisieren, parsen, entschlüsseln.
 *
 * Die Einzelteile stehen in den anderen Dateien. Hier läuft die
 * Schlüsselhierarchie aus §3.1 einmal ganz durch, so wie sie in einer Zeile der
 * Datenbank nebeneinander liegt:
 *
 * ```
 * sk_u --KEM--> geteiltes Geheimnis --entpackt--> K_c --entpackt--> DEK --entschlüsselt--> payload
 * ```
 */

const KLARTEXT = new TextEncoder().encode(
  JSON.stringify({ titel: 'Erbschein beantragen', fristTage: 42 }),
)

const hex = (b: Uint8Array) => Buffer.from(b).toString('hex')

async function packeFallEin() {
  const geraet = erzeugeKemSchluesselpaar()
  const kC = erzeugeAesSchluessel()
  const dek = erzeugeAesSchluessel()

  const { kemCt, geteiltesGeheimnis } = kapsele(geraet.oeffentlich)

  return {
    geraet,
    kC,
    dek,
    kemCt,
    /** `payload` (§3.2) */
    payload: await verschluessele(dek, KLARTEXT),
    /** `wrapped_dek` (§3.2) */
    wrappedDek: await verschluessele(kC, dek),
    /** `wrapped_key` (§3.2) */
    wrappedKey: await verschluessele(geteiltesGeheimnis, kC),
  }
}

describe('Alle vier Envelope-Formen', () => {
  it('führen vom Gerät bis zum Klartext und zurück', async () => {
    const zeile = await packeFallEin()

    // Das Empfängergerät kennt nur sk_u und die Blobs aus der Zeile.
    const geteiltesGeheimnis = entkapsele(zeile.kemCt, zeile.geraet.geheim)
    const kC = await entschluessele(geteiltesGeheimnis, zeile.wrappedKey)
    const dek = await entschluessele(kC, zeile.wrappedDek)
    const klartext = await entschluessele(dek, zeile.payload)

    expect(hex(kC)).toBe(hex(zeile.kC))
    expect(hex(dek)).toBe(hex(zeile.dek))
    expect(hex(klartext)).toBe(hex(KLARTEXT))
  })

  it('tragen alle drei Chiffretext-Formen denselben Kopf', async () => {
    const zeile = await packeFallEin()

    for (const blob of [zeile.payload, zeile.wrappedDek, zeile.wrappedKey]) {
      const envelope = leseChiffretext(blob)

      expect(envelope.v).toBe(1)
      expect(envelope.aead).toBe(1)
      expect(envelope.nonce).toHaveLength(12)
    }

    // Der wrapped_dek trägt die 48 Byte Nutzlast aus §3.2: 32 Byte DEK plus Tag.
    expect(leseChiffretext(zeile.wrappedDek).ciphertext).toHaveLength(48)
  })

  it('schließen den kem_ct mit ein, ohne ihm einen Kopf zu geben', async () => {
    const zeile = await packeFallEin()

    // §3.2: Welches KEM den kem_ct erzeugt hat, sagt das `v` des wrapped_key
    // daneben, hier nachgestellt, indem beide zusammen gelesen werden.
    expect(leseChiffretext(zeile.wrappedKey).v).toBe(1)
    expect(zeile.kemCt).toHaveLength(1120)
  })

  it('signieren den Wrap und prüfen ihn beim Empfänger', async () => {
    // §3.6: Jeder Wrap in `key_wraps` trägt die Signatur des wrappenden Geräts;
    // das Empfängergerät verifiziert sie, bevor es entpackt.
    const zeile = await packeFallEin()
    const wrappendesGeraet = erzeugeSignaturSchluesselpaar()

    const nachricht = await wrapNachricht({
      caseId: '5f0f6f7a-0000-4000-8000-000000000001',
      kid: 'case_5f0f6f7a-0000-4000-8000-000000000001:1',
      deviceId: 'device_7',
      kemCt: zeile.kemCt,
      wrappedKey: zeile.wrappedKey,
    })

    const signatur = signiere(DOMAIN_SEPARATION.keyWrap, nachricht, wrappendesGeraet.geheim)
    const gelesen = leseSignatur(signatur)

    expect(gelesen.mldsa).toHaveLength(3309)
    expect(gelesen.ed25519).toHaveLength(64)
    expect(
      verifiziere(signatur, DOMAIN_SEPARATION.keyWrap, nachricht, wrappendesGeraet.oeffentlich),
    ).toBe(true)
  })

  it('rotieren K_c, ohne den payload neu zu verschlüsseln', async () => {
    // §3.1: Rotation wrappt nur die 32-Byte-DEKs neu. Ein Fall mit 40 Aufgaben
    // und 10 Scans kostet damit wenige Kilobyte statt hunderte Megabyte.
    const zeile = await packeFallEin()

    const payloadVorher = hex(zeile.payload)

    const neuesKC = erzeugeAesSchluessel()
    const neuerWrappedDek = await verschluessele(neuesKC, zeile.dek)

    // Der DEK ändert sich nie (§3.1), also bleibt der payload unangetastet.
    const dekNachRotation = await entschluessele(neuesKC, neuerWrappedDek)
    expect(hex(dekNachRotation)).toBe(hex(zeile.dek))
    expect(hex(zeile.payload)).toBe(payloadVorher)
    expect(hex(await entschluessele(dekNachRotation, zeile.payload))).toBe(hex(KLARTEXT))

    // Der wrapped_dek der alten Generation öffnet unter dem neuen K_c nicht mehr.
    await expect(entschluessele(neuesKC, zeile.wrappedDek)).rejects.toThrow()
  })
})
