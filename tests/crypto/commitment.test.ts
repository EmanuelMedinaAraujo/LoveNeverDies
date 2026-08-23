import { createHash, createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { erzeugeAesSchluessel } from '../../src/core/crypto/aead'
import {
  freigabeNachricht,
  katalogItemId,
  stimmtTresorCommitment,
  tresorCommitment,
  wrapNachricht,
} from '../../src/core/crypto/commitment'

/**
 * Nahtstelle: Commitment, Freigabe- und Wrap-Nachricht, Katalog-Item-ID
 * (DESIGN.md §3.2, §3.5, §8).
 *
 * Die erwarteten Werte kommen aus `node:crypto`, nicht aus demselben WebCrypto,
 * das der Code benutzt. Ein Test, der die Erwartung so ausrechnet wie der Code,
 * kann dem Code nie widersprechen.
 */

const bytes = (text: string) => new TextEncoder().encode(text)
const hex = (b: Uint8Array) => Buffer.from(b).toString('hex')

const sha256 = (...teile: Uint8Array[]) => {
  const hash = createHash('sha256')
  for (const teil of teile) hash.update(teil)
  return hash.digest('hex')
}

const CASE_ID = '5f0f6f7a-0000-4000-8000-000000000001'
const USER_ID = 'user_2abcDEF'
const KID = 'case_5f0f6f7a-0000-4000-8000-000000000001:3'
const DEVICE_ID = 'device_7'

describe('Tresor-Commitment', () => {
  it('ist SHA-256("LN-open-v1" ‖ K_v)', async () => {
    const kv = erzeugeAesSchluessel()

    expect(hex(await tresorCommitment(kv))).toBe(sha256(bytes('LN-open-v1'), kv))
  })

  it('ändert sich mit K_v', async () => {
    const eines = await tresorCommitment(erzeugeAesSchluessel())
    const anderes = await tresorCommitment(erzeugeAesSchluessel())

    expect(hex(eines)).not.toBe(hex(anderes))
  })

  it('erkennt den richtigen und den falschen K_v', async () => {
    const kv = erzeugeAesSchluessel()
    const commitment = await tresorCommitment(kv)

    expect(await stimmtTresorCommitment(kv, commitment)).toBe(true)
    expect(await stimmtTresorCommitment(erzeugeAesSchluessel(), commitment)).toBe(false)
  })

  it('gilt unter keinem anderen Präfix', async () => {
    // Derselbe Schlüssel unter "LN-fp-v1" ergäbe einen anderen Wert. Ein
    // Commitment aus einem Kontext darf in keinem anderen gelten (§3.2).
    const kv = erzeugeAesSchluessel()

    expect(hex(await tresorCommitment(kv))).not.toBe(sha256(bytes('LN-fp-v1'), kv))
    expect(hex(await tresorCommitment(kv))).not.toBe(sha256(kv))
  })
})

describe('Freigabe-Nachricht', () => {
  it('ist case_id ‖ user_id ‖ kid ‖ SHA-256(released_share)', async () => {
    const releasedShare = new Uint8Array(64).fill(0x11)

    const nachricht = await freigabeNachricht({
      caseId: CASE_ID,
      userId: USER_ID,
      kid: KID,
      releasedShare,
    })

    expect(hex(nachricht)).toBe(
      Buffer.concat([
        Buffer.from(CASE_ID, 'utf8'),
        Buffer.from(USER_ID, 'utf8'),
        Buffer.from(KID, 'utf8'),
        Buffer.from(sha256(releasedShare), 'hex'),
      ]).toString('hex'),
    )
  })

  it('ändert sich, wenn sich der Share ändert', async () => {
    const gemeinsam = { caseId: CASE_ID, userId: USER_ID, kid: KID }

    const eine = await freigabeNachricht({ ...gemeinsam, releasedShare: new Uint8Array([1]) })
    const andere = await freigabeNachricht({ ...gemeinsam, releasedShare: new Uint8Array([2]) })

    expect(hex(eine)).not.toBe(hex(andere))
  })
})

describe('Wrap-Nachricht', () => {
  it('ist case_id ‖ kid ‖ device_id ‖ SHA-256(kem_ct ‖ wrapped_key)', async () => {
    const kemCt = new Uint8Array(1120).fill(0x22)
    const wrappedKey = new Uint8Array(64).fill(0x33)

    const nachricht = await wrapNachricht({ caseId: CASE_ID, kid: KID, deviceId: DEVICE_ID, kemCt, wrappedKey })

    expect(hex(nachricht)).toBe(
      Buffer.concat([
        Buffer.from(CASE_ID, 'utf8'),
        Buffer.from(KID, 'utf8'),
        Buffer.from(DEVICE_ID, 'utf8'),
        Buffer.from(sha256(kemCt, wrappedKey), 'hex'),
      ]).toString('hex'),
    )
  })

  it('bindet den kem_ct an den wrapped_key', async () => {
    // Beide gehen in denselben Hash: Ein ausgetauschter kem_ct neben einem
    // unveränderten wrapped_key bricht die Signatur (§3.6).
    const gemeinsam = { caseId: CASE_ID, kid: KID, deviceId: DEVICE_ID }
    const wrappedKey = new Uint8Array(64).fill(0x33)

    const eine = await wrapNachricht({ ...gemeinsam, kemCt: new Uint8Array([1]), wrappedKey })
    const andere = await wrapNachricht({ ...gemeinsam, kemCt: new Uint8Array([2]), wrappedKey })

    expect(hex(eine)).not.toBe(hex(andere))
  })
})

describe('Katalog-Item-ID', () => {
  it('ist HMAC-SHA256(K_cat, "LN-cat-v1" ‖ pfad)', async () => {
    const kCat = erzeugeAesSchluessel()
    const pfad = 'erbschein/antrag'

    const erwartet = createHmac('sha256', kCat)
      .update(Buffer.from('LN-cat-v1', 'utf8'))
      .update(Buffer.from(pfad, 'utf8'))
      .digest('hex')

    expect(hex(await katalogItemId(kCat, pfad))).toBe(erwartet)
  })

  it('ist für denselben Pfad stabil', async () => {
    // Zwei Geräte instanziieren denselben Katalogeintrag und müssen auf
    // dieselbe ID kommen, sonst entstehen Duplikate (§8).
    const kCat = erzeugeAesSchluessel()

    expect(hex(await katalogItemId(kCat, 'erbschein/antrag'))).toBe(
      hex(await katalogItemId(kCat, 'erbschein/antrag')),
    )
  })

  it('verrät dem Server nichts über den Pfad', async () => {
    // Derselbe Pfad unter zwei Fallschlüsseln ergibt zwei verschiedene IDs.
    // Sonst könnte der Server Fälle über gleiche Katalogeinträge verknüpfen.
    const pfad = 'erbschein/antrag'

    expect(hex(await katalogItemId(erzeugeAesSchluessel(), pfad))).not.toBe(
      hex(await katalogItemId(erzeugeAesSchluessel(), pfad)),
    )
  })

  it('trennt zwei Pfade', async () => {
    const kCat = erzeugeAesSchluessel()

    expect(hex(await katalogItemId(kCat, 'erbschein/antrag'))).not.toBe(
      hex(await katalogItemId(kCat, 'erbschein/frist')),
    )
  })
})
