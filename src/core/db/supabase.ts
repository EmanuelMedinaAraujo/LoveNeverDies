/**
 * Der Supabase-Client (DESIGN.md §1, §4).
 *
 * Er trägt kein eigenes Anmeldeverfahren. Das Token kommt von Clerk und wird
 * hier nur durchgereicht: `accessToken` ruft bei jeder Anfrage den übergebenen
 * Geber auf, Supabase prüft die Signatur gegen die eingetragene
 * Drittanbieter-Auth, und `auth.jwt() ->> 'sub'` in den Policies (§4) ist
 * derselbe Clerk-`sub`, der in `memberships.user_id` steht (§3.3).
 *
 * Dass dieses Modul den Geber übergeben bekommt, statt Clerk zu importieren,
 * ist keine Ordnungsliebe: §1 verlangt, dass der Anbietername in genau zwei
 * Dateien vorkommt. Hier steht er nicht.
 *
 * Das Token sagt, wer jemand ist, nie, was jemand lesen darf. Das
 * entscheiden RLS und die Schlüsselhierarchie. Ein gestohlenes Clerk-Passwort
 * reicht deshalb nicht zum Entschlüsseln (§3.6).
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js'

/** Liefert das aktuelle Clerk-Token, oder `null`, solange niemand angemeldet ist. */
export type Zugangstoken = () => Promise<string | null>

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export function erzeugeSupabaseClient(zugangstoken: Zugangstoken): SupabaseClient {
  if (!url || !anonKey) {
    throw new Error(
      'VITE_SUPABASE_URL oder VITE_SUPABASE_ANON_KEY fehlt. Siehe .env.example und supabase/README.md.',
    )
  }

  return createClient(url, anonKey, {
    accessToken: zugangstoken,
    auth: {
      // Die Sitzung führt Clerk. Würde Supabase daneben eine eigene halten,
      // gäbe es zwei Wahrheiten darüber, wer angemeldet ist, und sie liefen
      // beim Abmelden auseinander.
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  })
}
