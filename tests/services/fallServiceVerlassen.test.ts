import { describe, expect, it, vi } from 'vitest'
import type { Ciphertextcache } from '../../src/core/db/idb'
import type { MitgliederTabelle } from '../../src/core/db/mitglieder'
import { verlasseFall } from '../../src/services/fallService'

describe('verlasseFall (§3.4)', () => {
  it('löscht die Mitgliedschaft auf dem Server und bereinigt den lokalen Cache', async () => {
    const aufrufe: string[] = []

    const mitglieder: MitgliederTabelle = {
      imFall: () => Promise.resolve([]),
      verlasseFall: (fallId: string) => {
        aufrufe.push(`mitglieder.verlasseFall:${fallId}`)
        return Promise.resolve()
      },
    }

    const cache: Ciphertextcache = {
      lies: () => Promise.resolve({ zeilen: [], wasserzeichen: 0 }),
      schreibe: () => Promise.resolve(),
      loescheFall: (fallId: string) => {
        aufrufe.push(`cache.loescheFall:${fallId}`)
        return Promise.resolve()
      },
    }

    await verlasseFall(mitglieder, cache, 'fall-123')

    // Reihenfolge: Zuerst Server (Mitgliedschaft), dann lokaler Cache
    expect(aufrufe).toEqual(['mitglieder.verlasseFall:fall-123', 'cache.loescheFall:fall-123'])
  })

  it('toleriert Cache-Bereinigungsfehler nach erfolgreichem Austritt', async () => {
    const mitglieder: MitgliederTabelle = {
      imFall: () => Promise.resolve([]),
      verlasseFall: () => Promise.resolve(),
    }

    const cache: Ciphertextcache = {
      lies: () => Promise.resolve({ zeilen: [], wasserzeichen: 0 }),
      schreibe: () => Promise.resolve(),
      loescheFall: () => Promise.reject(new Error('IDB blockiert')),
    }

    await expect(verlasseFall(mitglieder, cache, 'fall-123')).resolves.toBeUndefined()
  })

  it('wirft, wenn das Löschen der Mitgliedschaft fehlschlägt', async () => {
    const mitglieder: MitgliederTabelle = {
      imFall: () => Promise.resolve([]),
      verlasseFall: () => Promise.reject(new Error('Netzwerkfehler')),
    }

    const loescheFallSpy = vi.fn()
    const cache: Ciphertextcache = {
      lies: () => Promise.resolve({ zeilen: [], wasserzeichen: 0 }),
      schreibe: () => Promise.resolve(),
      loescheFall: loescheFallSpy,
    }

    await expect(verlasseFall(mitglieder, cache, 'fall-123')).rejects.toThrow('Netzwerkfehler')
    expect(loescheFallSpy).not.toHaveBeenCalled()
  })
})
