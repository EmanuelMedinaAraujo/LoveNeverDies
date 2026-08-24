import { describe, expect, it } from 'vitest'
import { alsBytea } from '../../src/core/db/bytea'
import { supabaseTresor, TresorFehler } from '../../src/core/db/supabaseTresor'
import { alsHex, fehler, stubClient } from './supabaseAdapter'

/**
 * Die drei Wege des Todesfall-Slices über Supabase (DESIGN.md §3.5, §4, §9).
 *
 * Eine Freigabe geht durch die Edge Function, der Übergang durch eine RPC, der
 * Gerätewechsel durch eine zweite. Geprüft wird hier die Übersetzung, was der
 * Adapter verlangt und was er aus einer Antwort macht, nicht die Regeln
 * dahinter: Die stehen in `tests/db/todesfall.test.ts` gegen echtes Postgres.
 */

const FALL = '11111111-1111-4111-8111-111111111111'
const GERAET = '22222222-2222-4222-8222-222222222222'

describe('freigabenFuerFall', () => {
  it('liest die Freigaben eines Falls samt kid', async () => {
    const { client, gesehen } = stubClient({
      data: [
        {
          case_id: FALL,
          user_id: 'user_bernd',
          signed_by_device: GERAET,
          kid: `case_${FALL}:1`,
          released_share: alsHex([0x01, 0x02]),
          signature: alsHex([0x03]),
          released_at: '2026-08-24T09:00:00Z',
        },
      ],
      error: null,
    })

    const zeilen = await supabaseTresor(client).freigabenFuerFall(FALL)

    expect(gesehen.tabelle).toBe('vault_releases')
    expect(gesehen.filter).toEqual({ case_id: FALL })
    expect(zeilen).toEqual([
      {
        fallId: FALL,
        userId: 'user_bernd',
        geraeteId: GERAET,
        kid: `case_${FALL}:1`,
        releasedShare: new Uint8Array([0x01, 0x02]),
        signatur: new Uint8Array([0x03]),
        freigegebenAm: '2026-08-24T09:00:00Z',
      },
    ])
  })

  it('meldet einen Fehlschlag als TresorFehler', async () => {
    const { client } = stubClient({ data: null, error: fehler('permission denied') })

    await expect(supabaseTresor(client).freigabenFuerFall(FALL)).rejects.toThrow(TresorFehler)
  })
})

describe('sendeFreigabe', () => {
  const freigabe = {
    caseId: FALL,
    userId: 'user_bernd',
    geraeteId: GERAET,
    kid: `case_${FALL}:1`,
    releasedShare: new Uint8Array([0xaa]),
    signatur: new Uint8Array([0xbb]),
  }

  it('ruft die Edge Function mit bytea-kodierten Feldern auf', async () => {
    const { client, gesehen } = stubClient({ data: null, error: null })

    await supabaseTresor(client).sendeFreigabe(freigabe)

    expect(gesehen.funktion?.name).toBe('vault-release')
    expect((gesehen.funktion?.optionen as { body: unknown }).body).toEqual({
      caseId: FALL,
      userId: 'user_bernd',
      deviceId: GERAET,
      kid: `case_${FALL}:1`,
      releasedShare: alsBytea(freigabe.releasedShare),
      signatur: alsBytea(freigabe.signatur),
    })
  })

  it('nennt den Grund, den die Function genannt hat', async () => {
    /*
     * `functions.invoke` meldet bei jedem Nicht-2xx dasselbe und legt die
     * Antwort nach `context`. Stünde der Satz von dort nicht in der Meldung,
     * läse die Familie "non-2xx status code" statt "Die Signatur dieser
     * Freigabe stimmt nicht".
     */
    const abgewiesen = Object.assign(new Error('Edge Function returned a non-2xx status code'), {
      context: new Response(JSON.stringify({ fehler: 'Die Signatur dieser Freigabe stimmt nicht.' }), {
        status: 403,
      }),
    })

    const { client } = stubClient({ data: null, error: null }, { data: null, error: abgewiesen })

    await expect(supabaseTresor(client).sendeFreigabe(freigabe)).rejects.toThrow(
      /Die Signatur dieser Freigabe stimmt nicht/,
    )
  })

  it('behält die eigene Meldung, wenn die Antwort kein JSON trägt', async () => {
    const abgewiesen = Object.assign(new Error('Failed to send a request'), {
      context: new Response('Bad Gateway', { status: 502 }),
    })

    const { client } = stubClient({ data: null, error: null }, { data: null, error: abgewiesen })

    await expect(supabaseTresor(client).sendeFreigabe(freigabe)).rejects.toThrow(
      /Failed to send a request/,
    )
  })
})

describe('oeffneTresor', () => {
  it('ruft open_vault mit Nachweis, Katalogstand und Payload auf', async () => {
    const { client, gesehen } = stubClient({ data: '2026-08+testtest', error: null })

    const version = await supabaseTresor(client).oeffneTresor(
      FALL,
      new Uint8Array([0x01]),
      '2026-08+testtest',
      new Uint8Array([0x02]),
    )

    expect(gesehen.rpc).toBe('open_vault')
    expect(gesehen.rpcArgumente).toEqual({
      p_fall_id: FALL,
      p_proof: alsBytea(new Uint8Array([0x01])),
      p_katalog_version: '2026-08+testtest',
      p_payload: alsBytea(new Uint8Array([0x02])),
    })
    expect(version).toBe('2026-08+testtest')
  })

  it('gibt null zurück, wenn keine Version zurückkommt', async () => {
    const { client } = stubClient({ data: null, error: null })

    expect(
      await supabaseTresor(client).oeffneTresor(FALL, new Uint8Array(), 'x', new Uint8Array()),
    ).toBeNull()
  })

  it('meldet einen abgewiesenen Nachweis als TresorFehler', async () => {
    const { client } = stubClient({
      data: null,
      error: fehler('Der Nachweis über den Tresorschlüssel stimmt nicht.'),
    })

    await expect(
      supabaseTresor(client).oeffneTresor(FALL, new Uint8Array(), 'x', new Uint8Array()),
    ).rejects.toThrow(/Nachweis/)
  })
})

describe('uebergibShare', () => {
  it('ruft uebergib_tresoranteil für das neue Gerät auf', async () => {
    const { client, gesehen } = stubClient({ data: null, error: null })

    await supabaseTresor(client).uebergibShare(
      FALL,
      GERAET,
      new Uint8Array([0x11]),
      new Uint8Array([0x22]),
    )

    expect(gesehen.rpc).toBe('uebergib_tresoranteil')
    expect(gesehen.rpcArgumente).toEqual({
      p_fall_id: FALL,
      p_geraet: GERAET,
      p_kem_ct: alsBytea(new Uint8Array([0x11])),
      p_wrapped_share: alsBytea(new Uint8Array([0x22])),
    })
  })
})
