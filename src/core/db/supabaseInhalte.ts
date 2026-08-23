/**
 * `items` über Supabase (DESIGN.md §4).
 *
 * Die Umsetzung des Ports aus `inhalte.ts`. Sie übersetzt zwischen Byte-Feldern
 * und der Hex-Kodierung, die PostgREST für `bytea` benutzt, und sonst nichts.
 * Wer schreiben darf, entscheidet die RLS; was in den Payload gehört, der
 * `aufgabenService`.
 */

import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js'
import { alsBytea, ausBytea } from './bytea'
import type { Inhaltsart, InhalteTabelle, InhaltZeile, NeuerInhalt } from './inhalte'

const TABELLE = 'items'

const SPALTEN =
  'id, case_id, seq, kind, deleted, in_vault, kid, wrapped_dek, payload, updated_at'

type RohZeile = {
  id: string
  case_id: string
  seq: number | string
  kind: Inhaltsart
  deleted: boolean
  in_vault: boolean
  kid: string
  wrapped_dek: unknown
  payload: unknown
  updated_at: string
}

export class InhalteFehler extends Error {
  constructor(was: string, ursache?: PostgrestError) {
    super(ursache === undefined ? was : `${was}: ${ursache.message}`)
    this.name = 'InhalteFehler'
    this.cause = ursache
  }
}

/**
 * `seq` ist `bigint`. PostgREST liefert es als Zeichenkette, sobald es die
 * sichere Ganzzahlgrenze überschreiten könnte — bei einem Zähler, der pro
 * Schreibvorgang um eins steigt, passiert das nie, aber die Konvertierung hier
 * ist billiger als ein Vergleich, der eines Tages Zeichenketten sortiert.
 */
function alsZeile(roh: RohZeile): InhaltZeile {
  return {
    id: roh.id,
    fallId: roh.case_id,
    seq: Number(roh.seq),
    art: roh.kind,
    geloescht: roh.deleted,
    imTresor: roh.in_vault,
    kid: roh.kid,
    wrappedDek: ausBytea(roh.wrapped_dek),
    payload: ausBytea(roh.payload),
    geaendertAm: roh.updated_at,
  }
}

export function supabaseInhalte(client: SupabaseClient): InhalteTabelle {
  /**
   * Ein UPDATE, das die RLS auf null Zeilen einschränkt, ist für PostgREST kein
   * Fehler. Ohne die zurückgegebenen Zeilen meldete jede Änderung Erfolg, und
   * der neue Titel verschwände beim nächsten Laden wieder — ohne dass irgendwo
   * gestanden hätte, dass er nie angekommen ist.
   */
  async function aendere(id: string, werte: Record<string, unknown>, was: string) {
    const { data, error } = await client
      .from(TABELLE)
      .update(werte)
      .eq('id', id)
      .select('id')
      .returns<{ id: string }[]>()

    if (error !== null) {
      throw new InhalteFehler(was, error)
    }

    if (data.length === 0) {
      throw new InhalteFehler(
        `${was}. Sie gehört zu keinem Ihrer Fälle oder ist nicht mehr da.`,
      )
    }
  }

  return {
    async imFall(fallId) {
      /*
       * Sortiert über die `id`, nicht über `seq`.
       *
       * `seq` steigt bei **jedem** Schreibvorgang, auch bei einem Häkchen
       * (§4). Danach sortiert stünde die gerade abgehakte Aufgabe am Ende der
       * Liste, und wer bei zwanzig Aufgaben die erste abhakt, sucht sie
       * anschließend unten wieder. Die `id` ist eine UUIDv7: Ihre führenden 48
       * Bit tragen den Anlagezeitpunkt, sie sortiert byteweise chronologisch
       * und ändert sich nie.
       */
      const { data, error } = await client
        .from(TABELLE)
        .select(SPALTEN)
        .eq('case_id', fallId)
        .order('id', { ascending: true })
        .returns<RohZeile[]>()

      if (error !== null) {
        throw new InhalteFehler('Die Aufgaben waren nicht abzurufen', error)
      }

      return data.map(alsZeile)
    },

    async lege(neu: NeuerInhalt) {
      // Weder `seq` noch `updated_at`: Beides setzt der Trigger (§4). Stünden
      // sie hier, überschriebe er sie stillschweigend, und der Code hier
      // behauptete eine Zuständigkeit, die er nicht hat.
      const { error } = await client.from(TABELLE).insert({
        id: neu.id,
        case_id: neu.fallId,
        kind: neu.art,
        kid: neu.kid,
        wrapped_dek: alsBytea(neu.wrappedDek),
        payload: alsBytea(neu.payload),
      })

      if (error !== null) {
        throw new InhalteFehler('Die Aufgabe war nicht anzulegen', error)
      }
    },

    schreibePayload(id, payload) {
      return aendere(id, { payload: alsBytea(payload) }, 'Die Aufgabe war nicht zu ändern')
    },

    loesche(id) {
      return aendere(
        id,
        { deleted: true, payload: alsBytea(new Uint8Array()), wrapped_dek: alsBytea(new Uint8Array()) },
        'Die Aufgabe war nicht zu löschen',
      )
    },
  }
}
