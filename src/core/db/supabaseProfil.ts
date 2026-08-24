/**
 * `profiles` über Supabase (DESIGN.md §3.3, §4).
 *
 * Die Umsetzung des Ports aus `profil.ts`. Ein `upsert` und sonst nichts. Die
 * Frage, wer welches Profil sehen darf, entscheidet die RLS, und die Frage,
 * wann geschrieben wird, der Hook.
 */

import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js'
import type { Profilangaben, ProfilTabelle } from './profil'

const TABELLE = 'profiles'

export class ProfilFehler extends Error {
  constructor(was: string, ursache?: PostgrestError) {
    super(ursache === undefined ? was : `${was}: ${ursache.message}`)
    this.name = 'ProfilFehler'
    this.cause = ursache
  }
}

export function supabaseProfil(client: SupabaseClient): ProfilTabelle {
  return {
    async speichere(angaben: Profilangaben) {
      /*
       * `upsert` statt `insert` mit Fehlerbehandlung: Die Zeile existiert nach
       * der ersten Anmeldung immer, und ein Name, der sich bei Clerk geändert
       * hat, soll ankommen. `updated_at` wird ausdrücklich mitgeschrieben,
       * da der Default nur beim Anlegen greift.
       */
      const { error } = await client.from(TABELLE).upsert(
        {
          user_id: angaben.userId,
          display_name: angaben.anzeigename,
          email: angaben.email,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id' },
      )

      if (error !== null) {
        throw new ProfilFehler('Ihr Name konnte nicht hinterlegt werden', error)
      }
    },
  }
}
