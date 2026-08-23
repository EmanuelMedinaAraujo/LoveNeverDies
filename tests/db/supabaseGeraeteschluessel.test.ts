import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js'
import { describe, expect, it } from 'vitest'
import {
  GeraeteschluesselFehler,
  supabaseGeraeteschluessel,
} from '../../src/core/db/supabaseGeraeteschluessel'

/**
 * Nahtstelle: was PostgREST als Erfolg zurückgibt (DESIGN.md §4).
 *
 * Ein `UPDATE`, das die RLS auf null Zeilen einschränkt, ist für PostgREST kein
 * Fehler — `error` bleibt `null`, und der Aufrufer erführe nichts. Genau dieser
 * Fall steht in `geraeteschluessel.test.ts` gegen echtes Postgres: Anna darf
 * Bernds Zeile sehen, aber nicht ändern, und ihr `update` läuft ohne Fehler
 * durch. Hier wird geprüft, dass der Adapter daraus einen Fehler macht, statt
 * Erfolg zu melden und die Liste unverändert zurückkommen zu lassen.
 */

type Antwort = { data: unknown; error: PostgrestError | null }

/** Nur so viel Supabase-Client, wie `benenneUm` anfasst. */
function stubClient(antwort: Antwort) {
  const gesehen: { tabelle?: string; werte?: unknown; id?: unknown } = {}

  const kette = {
    update(werte: unknown) {
      gesehen.werte = werte
      return kette
    },
    eq(_spalte: string, wert: unknown) {
      gesehen.id = wert
      return kette
    },
    select() {
      return kette
    },
    returns() {
      return Promise.resolve(antwort)
    },
  }

  const client = {
    from(tabelle: string) {
      gesehen.tabelle = tabelle
      return kette
    },
  } as unknown as SupabaseClient

  return { client, gesehen }
}

describe('benenneUm', () => {
  it('schreibt das Label auf die genannte Zeile', async () => {
    const { client, gesehen } = stubClient({ data: [{ id: 'geraet-1' }], error: null })

    await supabaseGeraeteschluessel(client).benenneUm('geraet-1', 'iPad von Anna')

    expect(gesehen.tabelle).toBe('device_keys')
    expect(gesehen.werte).toEqual({ label: 'iPad von Anna' })
    expect(gesehen.id).toBe('geraet-1')
  })

  it('meldet keinen Erfolg, wenn keine Zeile betroffen war', async () => {
    // Fremde Zeile, gelöschte Zeile, oder eine, die die RLS wegfiltert: In
    // allen drei Fällen sagt PostgREST nichts. Ohne diesen Wurf bliebe der alte
    // Name stehen, und niemand erführe, warum.
    const { client } = stubClient({ data: [], error: null })

    await expect(
      supabaseGeraeteschluessel(client).benenneUm('fremdes-geraet', 'Meins jetzt'),
    ).rejects.toThrow(GeraeteschluesselFehler)
  })

  it('reicht einen echten Fehler von PostgREST weiter', async () => {
    const { client } = stubClient({
      data: null,
      error: {
        message: 'Verbindung abgebrochen',
        details: '',
        hint: '',
        code: '08006',
        name: 'PostgrestError',
      } as PostgrestError,
    })

    await expect(
      supabaseGeraeteschluessel(client).benenneUm('geraet-1', 'iPad von Anna'),
    ).rejects.toThrow(/Verbindung abgebrochen/)
  })
})
