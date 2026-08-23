import { describe, expect, it } from 'vitest'
import { alsBytea } from '../../src/core/db/bytea'
import { FaelleFehler, supabaseFaelle } from '../../src/core/db/supabaseFaelle'
import { alsHex, fehler, stubClient } from './supabaseAdapter'

/**
 * `cases` über Supabase (DESIGN.md §4).
 *
 * Was daneben gegen echtes Postgres läuft, steht in `tests/db/faelle.test.ts`:
 * die RLS und die Transaktion in `lege_trauerfall_an`. Hier geht es um die
 * Übersetzung — Byte-Felder als Hex, Spaltennamen in camelCase, und aus einem
 * PostgREST-`error` ein Wurf statt eines stillen Erfolgs.
 */

function neuerTrauerfall() {
  const wrap = {
    kemCt: new Uint8Array([0x01, 0x02]),
    wrappedKey: new Uint8Array([0x03]),
    signatur: new Uint8Array([0x04]),
  }

  return {
    id: 'fall-1',
    kidFall: 'case_fall-1:1',
    kidKatalog: 'cat_fall-1',
    payload: new Uint8Array([0xaa, 0xbb]),
    geraeteId: 'geraet-1',
    wrapFall: wrap,
    wrapKatalog: {
      kemCt: new Uint8Array([0x05]),
      wrappedKey: new Uint8Array([0x06]),
      signatur: new Uint8Array([0x07]),
    },
  }
}

describe('legeTrauerfallAn', () => {
  it('geht ueber die RPC, nicht ueber ein insert', async () => {
    /*
     * Fall, Mitgliedschaft und beide Wraps entstehen in einer Transaktion. Ein
     * Fall ohne Mitgliedschaft saehe niemand, einer ohne Wraps waere nach dem
     * naechsten Neuladen unlesbar.
     */
    const { client, gesehen } = stubClient({ data: null, error: null })

    await supabaseFaelle(client).legeTrauerfallAn(neuerTrauerfall())

    expect(gesehen.rpc).toBe('lege_trauerfall_an')
    expect(gesehen.eingefuegt).toBeUndefined()
  })

  it('kodiert alle Byte-Felder als bytea', async () => {
    const { client, gesehen } = stubClient({ data: null, error: null })
    const neu = neuerTrauerfall()

    await supabaseFaelle(client).legeTrauerfallAn(neu)

    expect(gesehen.rpcArgumente).toMatchObject({
      p_fall_id: 'fall-1',
      p_kid_fall: 'case_fall-1:1',
      p_kid_katalog: 'cat_fall-1',
      p_geraet: 'geraet-1',
      p_payload: alsBytea(neu.payload),
      p_fall_kem_ct: alsBytea(neu.wrapFall.kemCt),
      p_fall_wrapped_key: alsBytea(neu.wrapFall.wrappedKey),
      p_fall_signatur: alsBytea(neu.wrapFall.signatur),
      p_kat_kem_ct: alsBytea(neu.wrapKatalog.kemCt),
      p_kat_wrapped_key: alsBytea(neu.wrapKatalog.wrappedKey),
      p_kat_signatur: alsBytea(neu.wrapKatalog.signatur),
    })
  })

  it('macht aus einem PostgREST-Fehler einen FaelleFehler', async () => {
    const { client } = stubClient({ data: null, error: fehler('permission denied') })

    await expect(supabaseFaelle(client).legeTrauerfallAn(neuerTrauerfall())).rejects.toThrow(
      FaelleFehler,
    )
    await expect(supabaseFaelle(client).legeTrauerfallAn(neuerTrauerfall())).rejects.toThrow(
      /Der Trauerfall war nicht anzulegen: permission denied/,
    )
  })
})

describe('eigene', () => {
  it('uebersetzt die Zeilen und dekodiert den Payload', async () => {
    const { client, gesehen } = stubClient({
      data: [
        {
          id: 'fall-1',
          status: 'trauerfall',
          current_kid: 'case_fall-1:1',
          key_generation: 1,
          version: 3,
          payload: alsHex([0xaa, 0xbb]),
          created_at: '2026-08-23T10:00:00Z',
        },
      ],
      error: null,
    })

    const zeilen = await supabaseFaelle(client).eigene()

    expect(gesehen.tabelle).toBe('cases')
    expect(zeilen).toEqual([
      {
        id: 'fall-1',
        status: 'trauerfall',
        currentKid: 'case_fall-1:1',
        keyGeneration: 1,
        version: 3,
        payload: new Uint8Array([0xaa, 0xbb]),
        angelegtAm: '2026-08-23T10:00:00Z',
      },
    ])
  })

  it('sortiert nach Alter, damit die Reihenfolge stabil bleibt', async () => {
    const { client, gesehen } = stubClient({ data: [], error: null })

    await supabaseFaelle(client).eigene()

    expect(gesehen.sortierung).toEqual({
      spalte: 'created_at',
      optionen: { ascending: true },
    })
  })

  it('liefert eine leere Liste, wenn die RLS alles wegfiltert', async () => {
    // Keine Zeilen ist kein Fehler: Wer zu keinem Fall gehoert, hat keine.
    const { client } = stubClient({ data: [], error: null })

    await expect(supabaseFaelle(client).eigene()).resolves.toEqual([])
  })

  it('macht aus einem PostgREST-Fehler einen FaelleFehler', async () => {
    const { client } = stubClient({ data: null, error: fehler('permission denied') })

    await expect(supabaseFaelle(client).eigene()).rejects.toThrow(
      /Die eigenen Fälle waren nicht abzurufen: permission denied/,
    )
  })
})
