import { afterEach, describe, expect, it, vi } from 'vitest'
import { speicherDauerhaftAnfordern } from '../../../src/core/storage/persist.ts'

describe('speicherDauerhaftAnfordern', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('meldet "nicht-unterstuetzt" ohne navigator.storage.persist', async () => {
    vi.stubGlobal('navigator', {})

    expect(await speicherDauerhaftAnfordern()).toBe('nicht-unterstuetzt')
  })

  it('meldet "gewaehrt", wenn der Speicher schon dauerhaft ist', async () => {
    vi.stubGlobal('navigator', {
      storage: {
        persisted: vi.fn().mockResolvedValue(true),
        persist: vi.fn(),
      },
    })

    expect(await speicherDauerhaftAnfordern()).toBe('gewaehrt')
    expect(navigator.storage.persist).not.toHaveBeenCalled()
  })

  it('fragt nur, wenn noch nicht dauerhaft, und meldet die Antwort', async () => {
    vi.stubGlobal('navigator', {
      storage: {
        persisted: vi.fn().mockResolvedValue(false),
        persist: vi.fn().mockResolvedValue(true),
      },
    })

    expect(await speicherDauerhaftAnfordern()).toBe('gewaehrt')
  })

  it('meldet "abgelehnt", wenn der Browser die Bitte ablehnt', async () => {
    vi.stubGlobal('navigator', {
      storage: {
        persisted: vi.fn().mockResolvedValue(false),
        persist: vi.fn().mockResolvedValue(false),
      },
    })

    expect(await speicherDauerhaftAnfordern()).toBe('abgelehnt')
  })

  it('meldet "nicht-unterstuetzt", wenn die Anfrage wirft', async () => {
    vi.stubGlobal('navigator', {
      storage: {
        persisted: vi.fn().mockRejectedValue(new Error('kaputt')),
        persist: vi.fn(),
      },
    })

    expect(await speicherDauerhaftAnfordern()).toBe('nicht-unterstuetzt')
  })
})
