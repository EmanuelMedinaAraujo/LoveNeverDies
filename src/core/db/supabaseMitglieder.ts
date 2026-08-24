/**
 * `memberships` über Supabase (DESIGN.md §4).
 *
 * Die Umsetzung des Ports aus `mitglieder.ts`. Ein `select`, mehr gibt die
 * Policy `memberships_read` her, und mehr braucht es nicht: Wer den Fall nicht
 * sieht, bekommt eine leere Menge statt eines Fehlers.
 */

import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js'
import type { MitgliederTabelle, MitgliedZeile } from './mitglieder'

const TABELLE = 'memberships'

type RohZeile = {
  user_id: string
  joined_at: string
}

export class MitgliederFehler extends Error {
  constructor(was: string, ursache?: PostgrestError) {
    super(ursache === undefined ? was : `${was}: ${ursache.message}`)
    this.name = 'MitgliederFehler'
    this.cause = ursache
  }
}

export function supabaseMitglieder(client: SupabaseClient): MitgliederTabelle {
  return {
    async imFall(fallId) {
      const { data, error } = await client
        .from(TABELLE)
        .select('user_id, joined_at')
        .eq('case_id', fallId)
        // Die anlegende Person zuerst, danach in der Reihenfolge der Beitritte:
        // dieselbe Reihenfolge auf jedem Gerät, ohne dass jemand sortieren muss.
        .order('joined_at', { ascending: true })
        .returns<RohZeile[]>()

      if (error !== null) {
        throw new MitgliederFehler('Die Mitglieder dieses Falls konnten nicht abgerufen werden', error)
      }

      return data.map(
        (roh): MitgliedZeile => ({ userId: roh.user_id, beigetretenAm: roh.joined_at }),
      )
    },

    async verlasseFall(fallId) {
      const { error } = await client.from(TABELLE).delete().eq('case_id', fallId)

      if (error !== null) {
        throw new MitgliederFehler('Der Fall konnte nicht verlassen werden', error)
      }
    },
  }
}
