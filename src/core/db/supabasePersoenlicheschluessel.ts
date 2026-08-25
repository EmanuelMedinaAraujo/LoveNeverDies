/**
 * `personal_key_wraps` über Supabase (DESIGN.md §3.7, §4).
 *
 * Die Umsetzung des Ports aus `persoenlicheschluessel.ts`. Sie übersetzt
 * zwischen Byte-Feldern und der Hex-Kodierung, die PostgREST für `bytea`
 * benutzt, und sonst nichts. Wer lesen und schreiben darf, entscheidet die RLS.
 */

import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js'
import { alsBytea, ausBytea } from './bytea'
import type {
  PersoenlicheSchluesselTabelle,
  PersoenlicherSchluesselwrapZeile,
} from './persoenlicheschluessel'

const TABELLE = 'personal_key_wraps'

const SPALTEN = 'case_id, user_id, kid, device_id, kem_ct, wrapped_key'

type RohZeile = {
  case_id: string
  user_id: string
  kid: string
  device_id: string
  kem_ct: unknown
  wrapped_key: unknown
}

export class PersoenlicherSchluesselFehler extends Error {
  constructor(was: string, ursache?: PostgrestError) {
    super(ursache === undefined ? was : `${was}: ${ursache.message}`)
    this.name = 'PersoenlicherSchluesselFehler'
    this.cause = ursache
  }
}

function alsZeile(roh: RohZeile): PersoenlicherSchluesselwrapZeile {
  return {
    fallId: roh.case_id,
    userId: roh.user_id,
    kid: roh.kid,
    geraeteId: roh.device_id,
    kemCt: ausBytea(roh.kem_ct),
    wrappedKey: ausBytea(roh.wrapped_key),
  }
}

export function supabasePersoenlicheSchluessel(
  client: SupabaseClient,
): PersoenlicheSchluesselTabelle {
  return {
    async fuerGeraet(fallId, geraeteId) {
      const { data, error } = await client
        .from(TABELLE)
        .select(SPALTEN)
        .eq('case_id', fallId)
        .eq('device_id', geraeteId)
        .returns<RohZeile[]>()

      if (error !== null) {
        throw new PersoenlicherSchluesselFehler(
          'Ihr persönlicher Schlüssel konnte nicht abgerufen werden',
          error,
        )
      }

      return data.map(alsZeile)
    },

    async schreibeWraps(wraps) {
      if (wraps.length === 0) {
        return
      }

      /*
       * `ignoreDuplicates`: Der Primärschlüssel ist `(case_id, kid, device_id)`,
       * und dieser Aufruf läuft auch bei jeder Gerätefreigabe. Ein bereits
       * vorhandener Wrap ist dort der Normalfall und kein Fehlschlag; ersetzt
       * werden darf er nicht (§3.6).
       */
      const { error } = await client.from(TABELLE).upsert(
        wraps.map((wrap) => ({
          case_id: wrap.fallId,
          user_id: wrap.userId,
          kid: wrap.kid,
          device_id: wrap.geraeteId,
          kem_ct: alsBytea(wrap.kemCt),
          wrapped_key: alsBytea(wrap.wrappedKey),
        })),
        { ignoreDuplicates: true },
      )

      if (error !== null) {
        throw new PersoenlicherSchluesselFehler(
          'Ihr persönlicher Schlüssel konnte nicht gespeichert werden',
          error,
        )
      }
    },
  }
}
