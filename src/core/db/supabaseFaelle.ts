/**
 * `cases` über Supabase (DESIGN.md §4).
 *
 * Die Umsetzung des Ports aus `faelle.ts`. Angelegt wird ausschließlich über
 * die RPC `lege_trauerfall_an` — sie legt Fall, Mitgliedschaft und beide Wraps
 * in einer Transaktion an, damit keine der drei Zeilen ohne die anderen
 * entsteht.
 */

import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js'
import { alsBytea, ausBytea } from './bytea'
import type { FaelleTabelle, Fallstatus, FallZeile, NeuerTrauerfall } from './faelle'

const TABELLE = 'cases'

const SPALTEN = 'id, status, current_kid, key_generation, version, payload, created_at'

type RohZeile = {
  id: string
  status: Fallstatus
  current_kid: string
  key_generation: number
  version: number
  payload: unknown
  created_at: string
}

export class FaelleFehler extends Error {
  constructor(was: string, ursache?: PostgrestError) {
    super(ursache === undefined ? was : `${was}: ${ursache.message}`)
    this.name = 'FaelleFehler'
    this.cause = ursache
  }
}

function alsZeile(roh: RohZeile): FallZeile {
  return {
    id: roh.id,
    status: roh.status,
    currentKid: roh.current_kid,
    keyGeneration: roh.key_generation,
    version: roh.version,
    payload: ausBytea(roh.payload),
    angelegtAm: roh.created_at,
  }
}

export function supabaseFaelle(client: SupabaseClient): FaelleTabelle {
  return {
    async legeTrauerfallAn(neu: NeuerTrauerfall) {
      const { error } = await client.rpc('lege_trauerfall_an', {
        p_fall_id: neu.id,
        p_kid_fall: neu.kidFall,
        p_kid_katalog: neu.kidKatalog,
        p_payload: alsBytea(neu.payload),
        p_geraet: neu.geraeteId,
        p_fall_kem_ct: alsBytea(neu.wrapFall.kemCt),
        p_fall_wrapped_key: alsBytea(neu.wrapFall.wrappedKey),
        p_fall_signatur: alsBytea(neu.wrapFall.signatur),
        p_kat_kem_ct: alsBytea(neu.wrapKatalog.kemCt),
        p_kat_wrapped_key: alsBytea(neu.wrapKatalog.wrappedKey),
        p_kat_signatur: alsBytea(neu.wrapKatalog.signatur),
      })

      if (error !== null) {
        throw new FaelleFehler('Der Trauerfall war nicht anzulegen', error)
      }
    },

    async eigene() {
      const { data, error } = await client
        .from(TABELLE)
        .select(SPALTEN)
        .order('created_at', { ascending: true })
        .returns<RohZeile[]>()

      if (error !== null) {
        throw new FaelleFehler('Die eigenen Fälle waren nicht abzurufen', error)
      }

      return data.map(alsZeile)
    },
  }
}
