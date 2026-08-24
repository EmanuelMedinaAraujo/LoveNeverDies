import { describe, expect, it, vi } from 'vitest'
import { uuidv7 } from '../../src/core/uuidv7'

/**
 * Clientseitige Item-IDs (DESIGN.md §5).
 *
 * Zwei Zusagen hängen daran. Die erste: Die ID entsteht auf dem Gerät, damit
 * Anlegen später offline funktioniert und die Offline-Queue eine Aufgabe
 * benennen kann, die der Server noch nie gesehen hat. Die zweite: Sie steigt
 * mit der Zeit, damit eine Liste in Anlagereihenfolge ohne zweites Feld
 * auskommt.
 */

const UUID_FORM = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/** Die 48 Bit `unix_ts_ms` aus dem Praefix, RFC 9562 §5.7. */
function zeitstempelAus(id: string): number {
  return Number.parseInt(id.slice(0, 8) + id.slice(9, 13), 16)
}

describe('uuidv7', () => {
  it('hat die Form einer UUID', () => {
    expect(uuidv7()).toMatch(UUID_FORM)
  })

  it('traegt Version 7 und die RFC-Variante', () => {
    for (let i = 0; i < 200; i++) {
      const id = uuidv7()

      expect(id[14]).toBe('7')
      expect('89ab').toContain(id[19])
    }
  })

  it('traegt die aktuelle Zeit in den ersten 48 Bit', () => {
    const vorher = Date.now()
    const id = uuidv7()
    const nachher = Date.now()

    expect(zeitstempelAus(id)).toBeGreaterThanOrEqual(vorher)
    expect(zeitstempelAus(id)).toBeLessThanOrEqual(nachher)
  })

  it('steigt streng, auch innerhalb derselben Millisekunde', () => {
    // Ohne den Zaehler in `rand_a` waeren zwei IDs derselben Millisekunde in
    // zufaelliger Reihenfolge. Eine Liste, die nach ID sortiert, zeigte
    // zwei gleichzeitig angelegte Aufgaben mal so und mal so herum.
    vi.spyOn(Date, 'now').mockReturnValue(1_800_000_000_000)

    try {
      const ids = Array.from({ length: 1000 }, () => uuidv7())

      expect(new Set(ids).size).toBe(ids.length)
      expect([...ids].sort()).toEqual(ids)
    } finally {
      vi.restoreAllMocks()
    }
  })

  it('geht auch ueber 4096 IDs in derselben Millisekunde hinaus nicht zurueck', () => {
    // Der Zaehler ist 12 Bit breit. Laeuft er ueber, borgt sich die naechste ID
    // eine Millisekunde aus der Zukunft, statt still wieder von vorn zu
    // zaehlen und eine kleinere ID zu liefern als die davor.
    vi.spyOn(Date, 'now').mockReturnValue(1_800_000_000_000)

    try {
      const ids = Array.from({ length: 9000 }, () => uuidv7())

      expect(new Set(ids).size).toBe(ids.length)
      expect([...ids].sort()).toEqual(ids)
    } finally {
      vi.restoreAllMocks()
    }
  })

  it('steigt ueber Millisekunden hinweg', () => {
    const zeit = vi.spyOn(Date, 'now')

    try {
      zeit.mockReturnValue(1_800_000_000_000)
      const frueher = uuidv7()

      zeit.mockReturnValue(1_800_000_000_005)
      const spaeter = uuidv7()

      expect(spaeter > frueher).toBe(true)
    } finally {
      vi.restoreAllMocks()
    }
  })

  it('faellt nicht zurueck, wenn die Uhr zurueckspringt', () => {
    // Sommerzeit, NTP-Korrektur, ein Nutzer, der die Systemzeit stellt: Die ID
    // darf davon nicht kleiner werden, sonst sortierte eine spaeter angelegte
    // Aufgabe vor eine frueher angelegte.
    const zeit = vi.spyOn(Date, 'now')

    try {
      zeit.mockReturnValue(1_800_000_000_000)
      const frueher = uuidv7()

      zeit.mockReturnValue(1_700_000_000_000)
      const spaeter = uuidv7()

      expect(spaeter > frueher).toBe(true)
    } finally {
      vi.restoreAllMocks()
    }
  })
})
