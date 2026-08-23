import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useFarbschema } from '../../src/hooks/useFarbschema.ts'
import { DUNKEL, HELL } from '../../src/ui/farben.ts'

/**
 * jsdom kennt `matchMedia` nicht. Der Stub gibt zusätzlich einen Auslöser
 * heraus, mit dem der Test den Schemawechsel des Systems nachstellt — genau
 * das, was der Hook mit `addEventListener('change')` abonniert.
 */
function stubMatchMedia(startetDunkel: boolean) {
  const hoerer = new Set<(ereignis: MediaQueryListEvent) => void>()

  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({
      matches: startetDunkel,
      addEventListener: (_typ: string, hoerender: (ereignis: MediaQueryListEvent) => void) => {
        hoerer.add(hoerender)
      },
      removeEventListener: (_typ: string, hoerender: (ereignis: MediaQueryListEvent) => void) => {
        hoerer.delete(hoerender)
      },
    })),
  )

  return {
    wechsleZu(dunkel: boolean) {
      for (const hoerender of hoerer) {
        hoerender({ matches: dunkel } as MediaQueryListEvent)
      }
    },
    get anzahlHoerer() {
      return hoerer.size
    },
  }
}

describe('useFarbschema', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('liefert Hell, wenn das System hell steht', () => {
    stubMatchMedia(false)

    const { result } = renderHook(() => useFarbschema())

    expect(result.current.schema).toBe('hell')
    expect(result.current.palette).toBe(HELL)
  })

  it('liefert Dunkel, wenn das System dunkel steht', () => {
    stubMatchMedia(true)

    const { result } = renderHook(() => useFarbschema())

    expect(result.current.schema).toBe('dunkel')
    expect(result.current.palette).toBe(DUNKEL)
  })

  it('folgt einem Wechsel des Systems', () => {
    const medien = stubMatchMedia(false)

    const { result } = renderHook(() => useFarbschema())
    expect(result.current.schema).toBe('hell')

    act(() => medien.wechsleZu(true))

    expect(result.current.schema).toBe('dunkel')
    expect(result.current.palette).toBe(DUNKEL)
  })

  it('haengt den Hoerer beim Abbau wieder aus', () => {
    // Sonst sammelten sich ueber eine lange Sitzung Hoerer auf einer
    // MediaQueryList, die niemand mehr liest.
    const medien = stubMatchMedia(false)

    const { unmount } = renderHook(() => useFarbschema())
    expect(medien.anzahlHoerer).toBe(1)

    unmount()

    expect(medien.anzahlHoerer).toBe(0)
  })
})
