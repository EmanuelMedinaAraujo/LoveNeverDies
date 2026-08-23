import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { erzeugeKemSchluesselpaar } from '../../src/core/crypto/kem'
import { erzeugeSignaturSchluesselpaar, pkSigBytes } from '../../src/core/crypto/sign'
import {
  FingerprintFehler,
  fingerabdruck,
  geraetePruefcode,
  pruefcode,
} from '../../src/core/crypto/fingerprint'

/**
 * Nahtstelle: Geräte-Fingerprint und der 6-stellige Prüfcode (DESIGN.md §3.6).
 *
 * ```
 * fp   = SHA-256("LN-fp-v1" ‖ pk_kem ‖ pk_sig)
 * code = (fp[0] << 16 | fp[1] << 8 | fp[2]) mod 1_000_000, auf 6 Stellen nullgefüllt
 * ```
 *
 * Der mündliche Abgleich ist bei dieser Zielgruppe die verletzlichste Stelle
 * des Protokolls. Deckte der Fingerprint nur den KEM-Schlüssel, könnte ein
 * bösartiger Server den Signaturschlüssel austauschen, ohne dass der Abgleich
 * es bemerkt — deshalb steht hier zu **jedem** der beiden Schlüssel ein Test.
 */

const hex = (b: Uint8Array) => Buffer.from(b).toString('hex')

function geraet() {
  const kem = erzeugeKemSchluesselpaar()
  const sig = erzeugeSignaturSchluesselpaar()

  return { pkKem: kem.oeffentlich, pkSig: pkSigBytes(sig.oeffentlich) }
}

describe('Fingerprint', () => {
  it('ist SHA-256("LN-fp-v1" ‖ pk_kem ‖ pk_sig)', async () => {
    const { pkKem, pkSig } = geraet()

    const erwartet = createHash('sha256')
      .update(Buffer.from('LN-fp-v1', 'utf8'))
      .update(pkKem)
      .update(pkSig)
      .digest('hex')

    expect(hex(await fingerabdruck(pkKem, pkSig))).toBe(erwartet)
  })

  it('ist deterministisch', async () => {
    const { pkKem, pkSig } = geraet()

    expect(hex(await fingerabdruck(pkKem, pkSig))).toBe(hex(await fingerabdruck(pkKem, pkSig)))
  })

  it('ändert sich, wenn der KEM-Schlüssel wechselt', async () => {
    const { pkKem, pkSig } = geraet()

    const andererKem = erzeugeKemSchluesselpaar().oeffentlich

    expect(hex(await fingerabdruck(pkKem, pkSig))).not.toBe(
      hex(await fingerabdruck(andererKem, pkSig)),
    )
  })

  it('ändert sich, wenn der Signaturschlüssel wechselt', async () => {
    const { pkKem, pkSig } = geraet()

    const andererSig = pkSigBytes(erzeugeSignaturSchluesselpaar().oeffentlich)

    expect(hex(await fingerabdruck(pkKem, pkSig))).not.toBe(
      hex(await fingerabdruck(pkKem, andererSig)),
    )
  })

  it('gilt unter keinem anderen Präfix', async () => {
    const { pkKem, pkSig } = geraet()

    const ohnePraefix = createHash('sha256').update(pkKem).update(pkSig).digest('hex')

    expect(hex(await fingerabdruck(pkKem, pkSig))).not.toBe(ohnePraefix)
  })
})

describe('Prüfcode', () => {
  it('rechnet die ersten drei Bytes um', () => {
    // Von Hand nachgerechnet: 0x0f4240 = 1_000_000 -> 0, 0x0f4241 -> 1,
    // 0xffffff = 16_777_215 -> 777_215.
    expect(pruefcode(Uint8Array.of(0x00, 0x00, 0x00))).toBe('000000')
    expect(pruefcode(Uint8Array.of(0x00, 0x00, 0x2a))).toBe('000042')
    expect(pruefcode(Uint8Array.of(0x0f, 0x42, 0x40))).toBe('000000')
    expect(pruefcode(Uint8Array.of(0x0f, 0x42, 0x41))).toBe('000001')
    expect(pruefcode(Uint8Array.of(0xff, 0xff, 0xff))).toBe('777215')
  })

  it('sieht nur auf die ersten drei Bytes', () => {
    expect(pruefcode(Uint8Array.of(0x00, 0x00, 0x2a, 0xff, 0xff))).toBe('000042')
  })

  it('ist immer sechsstellig', async () => {
    const { pkKem, pkSig } = geraet()

    const code = await geraetePruefcode(pkKem, pkSig)

    expect(code).toMatch(/^\d{6}$/)
  })

  it('gehört zum Fingerprint desselben Geräts', async () => {
    const { pkKem, pkSig } = geraet()

    expect(await geraetePruefcode(pkKem, pkSig)).toBe(pruefcode(await fingerabdruck(pkKem, pkSig)))
  })

  it('weist zu wenige Bytes ab, statt eine Null zu erfinden', () => {
    expect(() => pruefcode(Uint8Array.of(0x01, 0x02))).toThrow(FingerprintFehler)
  })
})
