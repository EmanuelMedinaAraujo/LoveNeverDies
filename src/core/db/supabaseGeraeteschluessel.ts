/**
 * `device_keys` über Supabase (DESIGN.md §4).
 *
 * Die Umsetzung des Ports aus `geraeteschluessel.ts`. Sie übersetzt zwischen
 * Byte-Feldern und der Hex-Kodierung, die PostgREST für `bytea` benutzt, und
 * sonst nichts — die Regeln der Registrierung stehen im Service, die Regeln
 * darüber, wer was sehen darf, in der RLS.
 */

import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js'
import { alsBytea, ausBytea } from './bytea'
import type {
  GeraeteschluesselTabelle,
  GeraeteschluesselZeile,
  NeuerGeraeteschluessel,
} from './geraeteschluessel'

const TABELLE = 'device_keys'

const SPALTEN = 'id, user_id, public_key, sig_public_key, label, created_at'

/** Postgres meldet eine verletzte Eindeutigkeit als 23505. */
const EINDEUTIGKEIT_VERLETZT = '23505'

type RohZeile = {
  id: string
  user_id: string
  public_key: unknown
  sig_public_key: unknown
  label: string | null
  created_at: string
}

class GeraeteschluesselFehler extends Error {
  constructor(was: string, ursache: PostgrestError) {
    super(`${was}: ${ursache.message}`)
    this.name = 'GeraeteschluesselFehler'
    this.cause = ursache
  }
}

function alsZeile(roh: RohZeile): GeraeteschluesselZeile {
  return {
    id: roh.id,
    userId: roh.user_id,
    pkKem: ausBytea(roh.public_key),
    pkSig: ausBytea(roh.sig_public_key),
    label: roh.label,
    angelegtAm: roh.created_at,
  }
}

export function supabaseGeraeteschluessel(client: SupabaseClient): GeraeteschluesselTabelle {
  return {
    async finde(userId, pkKem) {
      const { data, error } = await client
        .from(TABELLE)
        .select(SPALTEN)
        .eq('user_id', userId)
        .eq('public_key', alsBytea(pkKem))
        .maybeSingle<RohZeile>()

      if (error !== null) {
        throw new GeraeteschluesselFehler('Der Geräteschlüssel war nicht abzurufen', error)
      }

      return data === null ? null : alsZeile(data)
    },

    async legeAn(neu: NeuerGeraeteschluessel) {
      const { data, error } = await client
        .from(TABELLE)
        .insert({
          user_id: neu.userId,
          public_key: alsBytea(neu.pkKem),
          sig_public_key: alsBytea(neu.pkSig),
          label: neu.label,
        })
        .select(SPALTEN)
        .single<RohZeile>()

      // Ein anderer Tab war schneller. Der Service holt sich dessen Zeile; es
      // ist dieselbe Identität, und der eindeutige Index hat genau dafür
      // gesorgt, dass es bei einer bleibt.
      if (error?.code === EINDEUTIGKEIT_VERLETZT) {
        return null
      }

      if (error !== null) {
        throw new GeraeteschluesselFehler('Der Geräteschlüssel war nicht anzulegen', error)
      }

      return alsZeile(data)
    },

    async fuerBenutzer(userId) {
      const { data, error } = await client
        .from(TABELLE)
        .select(SPALTEN)
        .eq('user_id', userId)
        .order('created_at', { ascending: true })
        .returns<RohZeile[]>()

      if (error !== null) {
        throw new GeraeteschluesselFehler('Die Geräteliste war nicht abzurufen', error)
      }

      return data.map(alsZeile)
    },

    async benenneUm(id, label) {
      const { error } = await client.from(TABELLE).update({ label }).eq('id', id)

      if (error !== null) {
        throw new GeraeteschluesselFehler('Das Gerät war nicht umzubenennen', error)
      }
    },
  }
}
