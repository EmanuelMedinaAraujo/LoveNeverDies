import { describe, expect, it } from 'vitest'
import { MitgliederFehler, supabaseMitglieder } from '../../src/core/db/supabaseMitglieder'
import { fehler, stubClient } from './supabaseAdapter'

/**
 * `memberships` über Supabase (DESIGN.md §4).
 *
 * Ein `select`, mehr gibt die Policy `memberships_read` her — und mehr braucht
 * die Zuweisung nicht: Kennungen im Klartext (§3.3), Namen kommen von
 * anderswoher. Geprüft wird die Übersetzung: Spaltennamen in camelCase, die
 * Reihenfolge der Beitritte, und aus einem PostgREST-`error` ein Wurf statt
 * einer stillen leeren Liste.
 */

describe('imFall', () => {
  it('liest die Mitglieder eines Falls in der Reihenfolge der Beitritte', async () => {
    const { client, gesehen } = stubClient({
      data: [
        { user_id: 'user_anna', joined_at: '2026-08-24T10:00:00Z' },
        { user_id: 'user_bert', joined_at: '2026-08-25T09:00:00Z' },
      ],
      error: null,
    })

    const zeilen = await supabaseMitglieder(client).imFall('fall-1')

    expect(gesehen.tabelle).toBe('memberships')
    expect(gesehen.filter).toEqual({ case_id: 'fall-1' })
    expect(gesehen.sortierung).toEqual({ spalte: 'joined_at', optionen: { ascending: true } })
    expect(zeilen).toEqual([
      { userId: 'user_anna', beigetretenAm: '2026-08-24T10:00:00Z' },
      { userId: 'user_bert', beigetretenAm: '2026-08-25T09:00:00Z' },
    ])
  })

  it('holt nur die beiden Spalten, die es gibt', async () => {
    const { client, gesehen } = stubClient({ data: [], error: null })

    await supabaseMitglieder(client).imFall('fall-1')

    expect(gesehen.spalten).toBe('user_id, joined_at')
  })

  it('wirft, statt eine leere Liste vorzutäuschen', async () => {
    const { client } = stubClient({ data: null, error: fehler('keine Verbindung') })

    await expect(supabaseMitglieder(client).imFall('fall-1')).rejects.toThrow(MitgliederFehler)
  })
})
