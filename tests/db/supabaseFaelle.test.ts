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
    katalogVersion: '2026-08+testtest',
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
      /Der Trauerfall konnte nicht angelegt werden: permission denied/,
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
          catalog_version: '2026-08-24.1',
          payload: alsHex([0xaa, 0xbb]),
          preparer_id: null,
          vault_commitment: null,
          vault_resplit_pending: false,
          vault_k: null,
          vault_n: null,
          rotation_pending: false,
          rotation_claimed_by: null,
          rotation_claim_expires_at: null,
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
        katalogVersion: '2026-08-24.1',
        payload: new Uint8Array([0xaa, 0xbb]),
        preparerId: null,
        vaultCommitment: null,
        vaultResplitPending: false,
        vaultK: null,
        vaultN: null,
        rotationPending: false,
        rotationClaimedBy: null,
        rotationClaimExpiresAt: null,
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
      /Die eigenen Fälle konnten nicht abgerufen werden: permission denied/,
    )
  })
})

describe('version', () => {
  /*
   * Der billige Check aus §5, Schritt 1: „`select version from cases where
   * id = ?`, ein Integer. Gleich dem Wasserzeichen → kein Fetch."
   *
   * Er ist der Grund, aus dem die Türklingel bei jedem Fokuswechsel läuten darf,
   * ohne dass ein Telefon im Zug seine Verbindung leerräumt. Deshalb steht hier
   * ausdrücklich, dass genau eine Spalte abgefragt wird und keine zweite.
   */

  it('fragt genau eine Spalte einer Zeile ab', async () => {
    const { client, gesehen } = stubClient({ data: { version: 7 }, error: null })

    expect(await supabaseFaelle(client).version('fall-1')).toBe(7)

    expect(gesehen.tabelle).toBe('cases')
    expect(gesehen.spalten).toBe('version')
    expect(gesehen.filter).toEqual({ id: 'fall-1' })
  })

  it('liest version auch als Zeichenkette', async () => {
    // `bigint`: PostgREST liefert es als Zeichenkette, sobald es die sichere
    // Ganzzahlgrenze überschreiten könnte.
    const { client } = stubClient({ data: { version: '12' }, error: null })

    expect(await supabaseFaelle(client).version('fall-1')).toBe(12)
  })

  it('gibt null zurück, wenn es den Fall für dieses Gerät nicht gibt', async () => {
    // Die RLS filtert einen fremden Fall weg, statt einen Fehler zu liefern.
    // Als `0` durchgehen darf das nicht: Das hiesse „alles neu holen" und
    // liefe gegen eine Zeile, die dieses Gerät nie sehen wird.
    const { client } = stubClient({ data: null, error: null })

    expect(await supabaseFaelle(client).version('fall-1')).toBeNull()
  })

  it('macht aus einem PostgREST-Fehler einen FaelleFehler', async () => {
    const { client } = stubClient({ data: null, error: fehler('permission denied') })

    await expect(supabaseFaelle(client).version('fall-1')).rejects.toThrow(FaelleFehler)
  })
})

describe('claimRotation', () => {
  it('ruft claim_rotation RPC mit Argumenten auf', async () => {
    const { client, gesehen } = stubClient({ data: true, error: null })

    const ergebnis = await supabaseFaelle(client).claimRotation('fall-1', 1, 'geraet-1')

    expect(ergebnis).toBe(true)
    expect(gesehen.rpc).toBe('claim_rotation')
    expect(gesehen.rpcArgumente).toEqual({
      p_case_id: 'fall-1',
      p_expected_generation: 1,
      p_device_id: 'geraet-1',
    })
  })

  it('wirft FaelleFehler bei PostgREST-Fehler', async () => {
    const { client } = stubClient({ data: null, error: fehler('forbidden') })

    await expect(supabaseFaelle(client).claimRotation('fall-1', 1, 'geraet-1')).rejects.toThrow(
      FaelleFehler,
    )
  })
})

describe('commitRotation', () => {
  it('ruft commit_rotation RPC mit Argumenten und bytea-Payload auf', async () => {
    const { client, gesehen } = stubClient({ data: true, error: null })

    const ergebnis = await supabaseFaelle(client).commitRotation(
      'fall-1',
      1,
      'case_fall-1:2',
      'geraet-1',
      new Uint8Array([0xaa, 0xbb]),
    )

    expect(ergebnis).toBe(true)
    expect(gesehen.rpc).toBe('commit_rotation')
    expect(gesehen.rpcArgumente).toEqual({
      p_case_id: 'fall-1',
      p_expected_generation: 1,
      p_new_kid: 'case_fall-1:2',
      p_device_id: 'geraet-1',
      p_payload: alsBytea(new Uint8Array([0xaa, 0xbb])),
    })
  })

  it('wirft FaelleFehler bei PostgREST-Fehler', async () => {
    const { client } = stubClient({ data: null, error: fehler('forbidden') })

    await expect(
      supabaseFaelle(client).commitRotation('fall-1', 1, 'case_fall-1:2', 'geraet-1'),
    ).rejects.toThrow(FaelleFehler)
  })
})

