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

/**
 * Ein Schreib- oder Lesevorgang auf `items` ist gescheitert.
 *
 * `abgelehnt` trennt die beiden Sorten Fehlschlag, die die Offline-Queue
 * auseinanderhalten muss (§5): Eine abgelehnte Mutation hat der Server
 * gesehen und verworfen. Sie gehört aus der Queue heraus und als Mitteilung
 * auf den Bildschirm, denn ein zweiter Versuch brächte dasselbe Ergebnis. Eine
 * Mutation, die nie ankam, bleibt stehen und geht beim nächsten Reconnect
 * erneut hinaus.
 */
export class InhalteFehler extends Error {
  /** Hat der Server geantwortet und Nein gesagt? */
  readonly abgelehnt: boolean

  constructor(was: string, ursache?: PostgrestError, abgelehnt = true) {
    super(ursache === undefined ? was : `${was}: ${ursache.message}`)
    this.name = 'InhalteFehler'
    this.cause = ursache
    this.abgelehnt = abgelehnt
  }
}

/**
 * Ob dieser Fehler ein Urteil des Servers ist.
 *
 * `supabase-js` verpackt auch einen Netzwerkabbruch als `PostgrestError`, dann
 * allerdings ohne SQLSTATE. Der leere `code` ist damit das einzige verlässliche
 * Erkennungszeichen dafür, dass gar niemand geantwortet hat: Im Zweifel
 * bleibt eine Mutation lieber in der Queue stehen, als still zu verschwinden.
 */
function istUrteil(ursache: PostgrestError): boolean {
  return ursache.code !== '' && ursache.code !== undefined && ursache.code !== null
}

/**
 * `seq` ist `bigint`. PostgREST liefert es als Zeichenkette, sobald es die
 * sichere Ganzzahlgrenze überschreiten könnte. Bei einem Zähler, der pro
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
   * der neue Titel verschwände beim nächsten Laden wieder, ohne dass irgendwo
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
      throw new InhalteFehler(was, error, istUrteil(error))
    }

    if (data.length === 0) {
      // Null geänderte Zeilen ohne Fehler: Die RLS hat die Zeile nicht
      // hergegeben, oder es gibt sie nicht mehr. Beides bleibt beim zweiten
      // Versuch so, also ein Urteil.
      throw new InhalteFehler(
        `${was}. Sie gehört zu keinem Ihrer Fälle oder ist nicht mehr da.`,
      )
    }
  }

  return {
    async seit(fallId, wasserzeichen) {
      /*
       * `select * from items where case_id = ? and seq > watermark` (§5), in
       * `seq`-Reihenfolge.
       *
       * Sortiert wird über `seq` und nicht über die `id`, weil das
       * Wasserzeichen aus genau dieser Spalte kommt: Wer ein Delta halb
       * verarbeitet, hat dann trotzdem einen gültigen Stand. Für die Anzeige
       * taugt `seq` nicht: Sie steigt bei jedem Häkchen (§4) und schöbe eine
       * gerade abgehakte Aufgabe ans Ende der Liste. Diese Reihenfolge stellt
       * der Reconciler über die `id` her, die als UUIDv7 den Anlagezeitpunkt
       * trägt und sich nie ändert.
       */
      const { data, error } = await client
        .from(TABELLE)
        .select(SPALTEN)
        .eq('case_id', fallId)
        .gt('seq', wasserzeichen)
        .order('seq', { ascending: true })
        .returns<RohZeile[]>()

      if (error !== null) {
        // Abrufen ist keine Mutation und landet nie in der Queue. `abgelehnt`
        // bleibt deshalb falsch: Es beendete sonst eine Wiederholung, die es
        // hier gar nicht gibt.
        throw new InhalteFehler('Die Aufgaben konnten nicht abgerufen werden', error, false)
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
        in_vault: neu.imTresor ?? false,
        // `null` und nicht weggelassen: Bei einer Aufgabe *muss* die Spalte
        // leer bleiben (§7, CHECK auf `items`), und ein fehlendes Feld hiesse
        // in PostgREST "nimm den Default", der hier zufällig derselbe ist.
        // Ein Default, auf den sich eine Zusage stützt, ist eine Zusage, die
        // sich still ändern lässt.
        storage_path: neu.storagePfad ?? null,
      })

      if (error !== null) {
        throw new InhalteFehler('Die Aufgabe konnte nicht angelegt werden', error, istUrteil(error))
      }
    },

    async legeAlleNeuen(neue) {
      if (neue.length === 0) {
        // Kein Aufruf ohne Zeilen: PostgREST machte daraus ein leeres INSERT,
        // und der Normalfall (es ist längst alles da) kostete trotzdem einen
        // Rundlauf.
        return
      }

      /*
       * `ignoreDuplicates` ist PostgRESTs `Prefer: resolution=ignore-duplicates`
       * und damit das `on conflict do nothing` aus §8. Anders als bei einem
       * Upsert bleibt die vorhandene Zeile dabei unangetastet: Genau richtig
       * für den Katalog: Eine bereits instanziierte Aufgabe ist ein
       * gewöhnliches Item, das jemand geändert oder gelöscht haben kann, und
       * eine zweite Instanziierung darf das nicht überschreiben.
       */
      const { error } = await client.from(TABELLE).upsert(
        neue.map((neu) => ({
          id: neu.id,
          case_id: neu.fallId,
          kind: neu.art,
          kid: neu.kid,
          wrapped_dek: alsBytea(neu.wrappedDek),
          payload: alsBytea(neu.payload),
        })),
        { ignoreDuplicates: true },
      )

      if (error !== null) {
        throw new InhalteFehler(
          'Die Aufgaben aus dem Rechtskatalog konnten nicht angelegt werden',
          error,
          istUrteil(error),
        )
      }
    },

    schreibePayload(id, payload) {
      return aendere(id, { payload: alsBytea(payload) }, 'Die Aufgabe konnte nicht geändert werden')
    },

    umwrappe(id, kid, wrappedDek) {
      return aendere(
        id,
        { kid, wrapped_dek: alsBytea(wrappedDek), in_vault: false },
        'Der Tresor-Eintrag konnte nicht übernommen werden',
      )
    },

    loesche(id) {
      return aendere(
        id,
        { deleted: true, payload: alsBytea(new Uint8Array()), wrapped_dek: alsBytea(new Uint8Array()) },
        'Die Aufgabe konnte nicht gelöscht werden',
      )
    },
  }
}
