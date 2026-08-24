import { describe, expect, it } from 'vitest'
import {
  FallschluesselFehler,
  supabaseFallschluessel,
} from '../../src/core/db/supabaseFallschluessel'
import { alsHex, fehler, stubClient } from './supabaseAdapter'

/**
 * `key_wraps` über Supabase (DESIGN.md §3.6, §4).
 *
 * Gelesen wird ausschließlich `fuerGeraet`; geschrieben wird hier gar nicht,
 * das läuft über die RPC in `supabaseFaelle.ts`.
 */
describe('fuerGeraet', () => {
  it('filtert auf Fall und Geraet und uebersetzt die Zeilen', async () => {
    const { client, gesehen } = stubClient({
      data: [
        {
          case_id: 'fall-1',
          kid: 'case_fall-1:1',
          device_id: 'geraet-1',
          kem_ct: alsHex([0x01, 0x02]),
          wrapped_key: alsHex([0x03]),
          wrapped_by: 'geraet-9',
          signature: alsHex([0x04, 0x05]),
        },
      ],
      error: null,
    })

    const zeilen = await supabaseFallschluessel(client).fuerGeraet('fall-1', 'geraet-1')

    expect(gesehen.tabelle).toBe('key_wraps')
    expect(gesehen.filter).toEqual({ case_id: 'fall-1', device_id: 'geraet-1' })
    expect(zeilen).toEqual([
      {
        fallId: 'fall-1',
        kid: 'case_fall-1:1',
        geraeteId: 'geraet-1',
        kemCt: new Uint8Array([0x01, 0x02]),
        wrappedKey: new Uint8Array([0x03]),
        wrappedBy: 'geraet-9',
        signatur: new Uint8Array([0x04, 0x05]),
      },
    ])
  })

  it('liefert eine leere Liste fuer ein fremdes Geraet', async () => {
    // Was die RLS fuer ein fremdes Geraet zurueckgibt, ist ohnehin leer (§4).
    const { client } = stubClient({ data: [], error: null })

    await expect(
      supabaseFallschluessel(client).fuerGeraet('fall-1', 'fremdes-geraet'),
    ).resolves.toEqual([])
  })

  it('macht aus einem PostgREST-Fehler einen FallschluesselFehler', async () => {
    const { client } = stubClient({ data: null, error: fehler('permission denied') })

    await expect(supabaseFallschluessel(client).fuerGeraet('fall-1', 'geraet-1')).rejects.toThrow(
      FallschluesselFehler,
    )
  })

  it('weist ein bytea-Feld zurueck, das nicht als Hex ankam', async () => {
    /*
     * Ein falsch gelesener Wrap ist schlimmer als ein abgebrochener Aufruf: Er
     * ergaebe beim Entpacken einen anderen Schluessel, und der Fall waere
     * gesperrt, ohne dass irgendetwas kaputt aussaehe.
     */
    const { client } = stubClient({
      data: [
        {
          case_id: 'fall-1',
          kid: 'case_fall-1:1',
          device_id: 'geraet-1',
          kem_ct: 42,
          wrapped_key: alsHex([0x03]),
          wrapped_by: 'geraet-9',
          signature: alsHex([0x04]),
        },
      ],
      error: null,
    })

    await expect(supabaseFallschluessel(client).fuerGeraet('fall-1', 'geraet-1')).rejects.toThrow(
      /bytea-Feld/,
    )
  })
})

describe('schreibeWraps', () => {
  it('fügt Wraps mit bytea Feldern ein', async () => {
    const { client, gesehen } = stubClient({ data: null, error: null })

    const wraps = [
      {
        fallId: 'fall-1',
        kid: 'case_fall-1:2',
        geraeteId: 'geraet-1',
        kemCt: new Uint8Array([0x01]),
        wrappedKey: new Uint8Array([0x02]),
        wrappedBy: 'geraet-2',
        signatur: new Uint8Array([0x03]),
      },
    ]

    await supabaseFallschluessel(client).schreibeWraps(wraps)

    expect(gesehen.tabelle).toBe('key_wraps')
    expect(gesehen.eingefuegt).toEqual([
      {
        case_id: 'fall-1',
        kid: 'case_fall-1:2',
        device_id: 'geraet-1',
        kem_ct: '\\x01',
        wrapped_key: '\\x02',
        wrapped_by: 'geraet-2',
        signature: '\\x03',
      },
    ])
  })

  it('tut nichts bei leerer Liste', async () => {
    const { client, gesehen } = stubClient({ data: null, error: null })

    await supabaseFallschluessel(client).schreibeWraps([])

    expect(gesehen.tabelle).toBeUndefined()
  })

  it('macht aus einem PostgREST-Fehler einen FallschluesselFehler', async () => {
    const { client } = stubClient({ data: null, error: fehler('insert failed') })

    await expect(
      supabaseFallschluessel(client).schreibeWraps([
        {
          fallId: 'fall-1',
          kid: 'case_fall-1:2',
          geraeteId: 'geraet-1',
          kemCt: new Uint8Array([0x01]),
          wrappedKey: new Uint8Array([0x02]),
          wrappedBy: 'geraet-2',
          signatur: new Uint8Array([0x03]),
        },
      ]),
    ).rejects.toThrow(FallschluesselFehler)
  })
})

