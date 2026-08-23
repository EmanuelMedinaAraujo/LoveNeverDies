import { describe, expect, it } from 'vitest'
import { alsBytea } from '../../src/core/db/bytea'
import {
  GeraeteschluesselFehler,
  supabaseGeraeteschluessel,
} from '../../src/core/db/supabaseGeraeteschluessel'
import { alsHex, fehler, stubClient } from './supabaseAdapter'

/**
 * `device_keys` über Supabase (DESIGN.md §4), die lesenden und anlegenden Wege.
 *
 * `benenneUm` steht schon in `supabaseGeraeteschluessel.test.ts` — dort geht es
 * um den einen Fall, in dem PostgREST Erfolg meldet, ohne etwas getan zu haben.
 */

const ZEILE = {
  id: 'geraet-1',
  user_id: 'user_1',
  public_key: alsHex([0x01, 0x02]),
  sig_public_key: alsHex([0x03, 0x04]),
  label: 'iPhone von Anna',
  created_at: '2026-08-23T10:00:00Z',
}

const ERWARTET = {
  id: 'geraet-1',
  userId: 'user_1',
  pkKem: new Uint8Array([0x01, 0x02]),
  pkSig: new Uint8Array([0x03, 0x04]),
  label: 'iPhone von Anna',
  angelegtAm: '2026-08-23T10:00:00Z',
}

describe('finde', () => {
  it('sucht ueber Benutzer und oeffentlichen Schluessel', async () => {
    const pkKem = new Uint8Array([0x01, 0x02])
    const { client, gesehen } = stubClient({ data: ZEILE, error: null })

    const gefunden = await supabaseGeraeteschluessel(client).finde('user_1', pkKem)

    expect(gesehen.tabelle).toBe('device_keys')
    expect(gesehen.filter).toEqual({ user_id: 'user_1', public_key: alsBytea(pkKem) })
    expect(gefunden).toEqual(ERWARTET)
  })

  it('liefert null, wenn es die Zeile nicht gibt', async () => {
    const { client } = stubClient({ data: null, error: null })

    await expect(
      supabaseGeraeteschluessel(client).finde('user_1', new Uint8Array([0x09])),
    ).resolves.toBeNull()
  })

  it('macht aus einem PostgREST-Fehler einen GeraeteschluesselFehler', async () => {
    const { client } = stubClient({ data: null, error: fehler('permission denied') })

    await expect(
      supabaseGeraeteschluessel(client).finde('user_1', new Uint8Array([0x09])),
    ).rejects.toThrow(/Der Geräteschlüssel war nicht abzurufen: permission denied/)
  })
})

describe('legeAn', () => {
  it('kodiert beide Schluessel als bytea', async () => {
    const { client, gesehen } = stubClient({ data: ZEILE, error: null })
    const neu = {
      userId: 'user_1',
      pkKem: new Uint8Array([0x01, 0x02]),
      pkSig: new Uint8Array([0x03, 0x04]),
      label: 'iPhone von Anna',
    }

    const angelegt = await supabaseGeraeteschluessel(client).legeAn(neu)

    expect(gesehen.eingefuegt).toEqual({
      user_id: 'user_1',
      public_key: alsBytea(neu.pkKem),
      sig_public_key: alsBytea(neu.pkSig),
      label: 'iPhone von Anna',
    })
    expect(angelegt).toEqual(ERWARTET)
  })

  it('liefert null, wenn ein anderer Tab schneller war', async () => {
    /*
     * 23505 ist der eindeutige Index auf (user_id, public_key). Kein Fehler,
     * sondern der Beweis, dass er seine Arbeit getan hat: Der Service holt
     * sich die Zeile des anderen Tabs, es ist dieselbe Identitaet.
     */
    const { client } = stubClient({ data: null, error: fehler('duplicate key', '23505') })

    await expect(
      supabaseGeraeteschluessel(client).legeAn({
        userId: 'user_1',
        pkKem: new Uint8Array([0x01]),
        pkSig: new Uint8Array([0x02]),
        label: 'iPhone',
      }),
    ).resolves.toBeNull()
  })

  it('wirft bei jedem anderen Fehler', async () => {
    const { client } = stubClient({ data: null, error: fehler('permission denied') })

    await expect(
      supabaseGeraeteschluessel(client).legeAn({
        userId: 'user_1',
        pkKem: new Uint8Array([0x01]),
        pkSig: new Uint8Array([0x02]),
        label: 'iPhone',
      }),
    ).rejects.toThrow(/Der Geräteschlüssel war nicht anzulegen/)
  })
})

describe('nachId', () => {
  it('loest wrapped_by auf', async () => {
    const { client, gesehen } = stubClient({ data: ZEILE, error: null })

    const gefunden = await supabaseGeraeteschluessel(client).nachId('geraet-1')

    expect(gesehen.filter).toEqual({ id: 'geraet-1' })
    expect(gefunden).toEqual(ERWARTET)
  })

  it('liefert null fuer ein Geraet, das es nicht mehr gibt', async () => {
    // fallService macht daraus einen gesperrten Fall, keinen Wurf (§3.6).
    const { client } = stubClient({ data: null, error: null })

    await expect(supabaseGeraeteschluessel(client).nachId('weg')).resolves.toBeNull()
  })

  it('macht aus einem PostgREST-Fehler einen GeraeteschluesselFehler', async () => {
    const { client } = stubClient({ data: null, error: fehler('permission denied') })

    await expect(supabaseGeraeteschluessel(client).nachId('geraet-1')).rejects.toThrow(
      GeraeteschluesselFehler,
    )
  })
})

describe('fuerBenutzer', () => {
  it('sortiert nach Alter und uebersetzt die Zeilen', async () => {
    const { client, gesehen } = stubClient({ data: [ZEILE], error: null })

    const zeilen = await supabaseGeraeteschluessel(client).fuerBenutzer('user_1')

    expect(gesehen.filter).toEqual({ user_id: 'user_1' })
    expect(gesehen.sortierung).toEqual({ spalte: 'created_at', optionen: { ascending: true } })
    expect(zeilen).toEqual([ERWARTET])
  })

  it('vertraegt ein Geraet ohne Label', async () => {
    const { client } = stubClient({ data: [{ ...ZEILE, label: null }], error: null })

    const [zeile] = await supabaseGeraeteschluessel(client).fuerBenutzer('user_1')

    expect(zeile?.label).toBeNull()
  })

  it('macht aus einem PostgREST-Fehler einen GeraeteschluesselFehler', async () => {
    const { client } = stubClient({ data: null, error: fehler('permission denied') })

    await expect(supabaseGeraeteschluessel(client).fuerBenutzer('user_1')).rejects.toThrow(
      /Die Geräteliste war nicht abzurufen/,
    )
  })
})
