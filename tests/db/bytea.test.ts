import { describe, expect, it } from 'vitest'
import { ByteaFehler, alsBytea, ausBytea } from '../../src/core/db/bytea'

/**
 * Nahtstelle: `bytea` über PostgREST.
 *
 * Alles, was dieses Projekt an den Server schickt, ist ein Byte-Feld — Envelope,
 * Wrap, Signatur, öffentlicher Schlüssel. PostgREST reicht `bytea` als
 * Hex-Zeichenkette mit `\x` davor durch. Eine stillschweigend falsch gelesene
 * Kodierung wäre hier besonders teuer: Ein um ein Byte verschobener
 * öffentlicher Schlüssel ergibt einen anderen Prüfcode, und der Abgleich am
 * Telefon scheiterte, ohne dass jemand wüsste, warum.
 */

describe('bytea hin und zurück', () => {
  it('überlebt den Weg', () => {
    const bytes = Uint8Array.from({ length: 256 }, (_, i) => i)

    expect([...ausBytea(alsBytea(bytes))]).toEqual([...bytes])
  })

  it('schreibt die Kodierung, die Postgres erwartet', () => {
    expect(alsBytea(Uint8Array.of(0x00, 0x0f, 0xff))).toBe('\\x000fff')
  })

  it('kommt mit leeren Feldern zurecht', () => {
    expect(alsBytea(new Uint8Array())).toBe('\\x')
    expect(ausBytea('\\x')).toHaveLength(0)
  })

  it('nimmt auch, was schon Bytes sind', () => {
    // Supabase gibt `bytea` je nach Client als Zeichenkette oder als Feld
    // zurück. Beides ist dieselbe Zeile, und der Aufrufer soll nicht raten.
    expect([...ausBytea(Uint8Array.of(1, 2, 3))]).toEqual([1, 2, 3])
  })

  it('weist zurück, was keine Hex-Kodierung ist', () => {
    expect(() => ausBytea('000fff')).toThrow(ByteaFehler)
    expect(() => ausBytea('\\x0f0')).toThrow(ByteaFehler)
    expect(() => ausBytea('\\xzz')).toThrow(ByteaFehler)
    expect(() => ausBytea(null)).toThrow(ByteaFehler)
  })
})
