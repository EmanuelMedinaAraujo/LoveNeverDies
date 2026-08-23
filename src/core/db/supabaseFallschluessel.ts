/**
 * `key_wraps` über Supabase (DESIGN.md §3.6, §4).
 *
 * Die Umsetzung des Ports aus `fallschluessel.ts`. Gelesen wird ausschließlich
 * `fuerGeraet` — was die RLS für ein fremdes Gerät zurückgibt, ist ohnehin
 * leer (§4), und geschrieben wird an dieser Stelle gar nicht: Das läuft über
 * die RPC in `supabaseFaelle.ts`.
 */

import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js'
import { ausBytea } from './bytea'
import type { SchluesselwrapTabelle, SchluesselwrapZeile } from './fallschluessel'

const TABELLE = 'key_wraps'

const SPALTEN = 'case_id, kid, device_id, kem_ct, wrapped_key, wrapped_by, signature'

type RohZeile = {
  case_id: string
  kid: string
  device_id: string
  kem_ct: unknown
  wrapped_key: unknown
  wrapped_by: string
  signature: unknown
}

export class FallschluesselFehler extends Error {
  constructor(was: string, ursache?: PostgrestError) {
    super(ursache === undefined ? was : `${was}: ${ursache.message}`)
    this.name = 'FallschluesselFehler'
    this.cause = ursache
  }
}

function alsZeile(roh: RohZeile): SchluesselwrapZeile {
  return {
    fallId: roh.case_id,
    kid: roh.kid,
    geraeteId: roh.device_id,
    kemCt: ausBytea(roh.kem_ct),
    wrappedKey: ausBytea(roh.wrapped_key),
    wrappedBy: roh.wrapped_by,
    signatur: ausBytea(roh.signature),
  }
}

export function supabaseFallschluessel(client: SupabaseClient): SchluesselwrapTabelle {
  return {
    async fuerGeraet(fallId, geraeteId) {
      const { data, error } = await client
        .from(TABELLE)
        .select(SPALTEN)
        .eq('case_id', fallId)
        .eq('device_id', geraeteId)
        .returns<RohZeile[]>()

      if (error !== null) {
        throw new FallschluesselFehler('Die Schlüsselwraps waren nicht abzurufen', error)
      }

      return data.map(alsZeile)
    },
  }
}
