import { createHash, createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { KatalogIdFehler, katalogItemId } from '../../src/core/crypto/katalogId'

/**
 * Deterministische Katalog-IDs (DESIGN.md §8).
 *
 * Zwei Zusagen hängen an diesem Modul, und beide sind hier prüfbar:
 *
 *   1. Alle Mitglieder rechnen bitgleiche IDs aus — sonst stünde der Katalog
 *      nach zwei gleichzeitigen Instanziierungen doppelt da.
 *   2. Ohne `K_cat` ist keine ID vorberechenbar — sonst ordnete der Server
 *      jede Zeile ihrer Katalogaufgabe zu und wüsste, wer eine Erbausschlagung
 *      offen hat.
 */

const FALL = '11111111-2222-4333-8444-555555555555'
const ANDERER_FALL = '99999999-2222-4333-8444-555555555555'

const KCAT = new Uint8Array(32).fill(0x2a)
const ANDERER_KCAT = new Uint8Array(32).fill(0x2b)

/**
 * Dieselbe Rechnung noch einmal, mit `node:crypto` statt WebCrypto.
 *
 * Ein Erwartungswert, den dasselbe Modul erzeugt hat, prüfte nur sich selbst.
 * Diese Fassung steht unabhängig daneben: Ändert sich am Ablauf etwas —
 * Präfix, Reihenfolge, Namensraum, Versionsbits —, gehen die beiden
 * auseinander.
 */
function nachgerechnet(kcat: Uint8Array, fallId: string, aufgabeId: string): string {
  const mac = createHmac('sha256', kcat).update(`LN-cat-v1${aufgabeId}`).digest()
  const namensraum = Buffer.from(fallId.replaceAll('-', ''), 'hex')
  const bytes = createHash('sha1').update(Buffer.concat([namensraum, mac])).digest().subarray(0, 16)

  bytes[6] = (bytes[6] & 0x0f) | 0x50
  bytes[8] = (bytes[8] & 0x3f) | 0x80

  const hex = bytes.toString('hex')

  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

describe('katalogItemId (§8)', () => {
  it('rechnet dieselbe ID, sooft man sie rechnet', async () => {
    const eine = await katalogItemId(KCAT, FALL, 'erbausschlagung-pruefen')
    const wieder = await katalogItemId(KCAT, FALL, 'erbausschlagung-pruefen')

    expect(wieder).toBe(eine)
  })

  it('stimmt mit einer unabhängigen Nachrechnung überein', async () => {
    const id = await katalogItemId(KCAT, FALL, 'erbausschlagung-pruefen')

    expect(id).toBe(nachgerechnet(KCAT, FALL, 'erbausschlagung-pruefen'))
  })

  it('ist eine UUID der Version 5', async () => {
    const id = await katalogItemId(KCAT, FALL, 'sterbefall-anzeigen')

    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  })

  it('hängt am Katalogschlüssel — ohne K_cat ist sie nicht vorberechenbar', async () => {
    const mit = await katalogItemId(KCAT, FALL, 'sterbefall-anzeigen')
    const ohne = await katalogItemId(ANDERER_KCAT, FALL, 'sterbefall-anzeigen')

    expect(ohne).not.toBe(mit)
  })

  it('trennt zwei Fälle, auch wenn sie denselben Katalogschlüssel hätten', async () => {
    const hier = await katalogItemId(KCAT, FALL, 'sterbefall-anzeigen')
    const dort = await katalogItemId(KCAT, ANDERER_FALL, 'sterbefall-anzeigen')

    expect(dort).not.toBe(hier)
  })

  it('trennt zwei Aufgaben desselben Falls', async () => {
    const eine = await katalogItemId(KCAT, FALL, 'sterbefall-anzeigen')
    const andere = await katalogItemId(KCAT, FALL, 'testament-abliefern')

    expect(andere).not.toBe(eine)
  })

  it('weist einen Namensraum ab, der keine UUID ist', async () => {
    await expect(katalogItemId(KCAT, 'kein-fall', 'sterbefall-anzeigen')).rejects.toThrow(
      KatalogIdFehler,
    )
  })
})
