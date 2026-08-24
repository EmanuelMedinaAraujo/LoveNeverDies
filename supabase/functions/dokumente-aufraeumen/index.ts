/**
 * Der Aufräumjob für Dokumente (DESIGN.md §7).
 *
 * §7: „Ein serverseitiger Aufräumjob entfernt nach 7 Tagen alles, was zu einem
 * `deleted = true`-Item noch liegt."
 *
 * **Warum eine Edge Function und kein `delete` in SQL.** Eine Zeile in
 * `storage.objects` ist der Katalogeintrag, nicht die Datei; die Bytes liegen
 * im Objektspeicher. Ein SQL-DELETE nähme den Eintrag und liesse die Datei
 * liegen — genau das Gegenteil dessen, was §7 verlangt —, und die Plattform
 * weist es deshalb ausdrücklich ab. Entfernt wird über die Storage-API, und
 * die spricht niemand aus Postgres heraus.
 *
 * Die Arbeit teilt sich in zwei Hälften. Welche Pfade fällig sind, entscheidet
 * `public.dokumente_zum_aufraeumen()` in der Datenbank — dort steht die Regel,
 * dort ist sie geprüft (`tests/db/dokumente.test.ts`). Diese Funktion holt die
 * Liste und arbeitet sie ab, mehr nicht.
 *
 * **Die Karenz ist kein Papierkorb.** Löschen gewinnt weiterhin endgültig
 * (§5); die sieben Tage existieren allein, damit der Job kein Objekt unter
 * einem Client wegzieht, der gerade mitten im Download ist.
 *
 * Aufgerufen wird sie von einem Zeitplan — täglich reicht bei einer Frist von
 * sieben Tagen. Wie er eingerichtet wird, steht in `supabase/README.md`.
 */

import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2'

const BUCKET = 'documents'

/**
 * Wie viele Pfade in einem `remove` zusammen hinausgehen.
 *
 * Die Storage-API nimmt eine Liste entgegen; unbegrenzt lang sollte sie
 * trotzdem nicht sein. Bei einem Rückstand von Tausenden gehen so mehrere
 * kleine Anfragen hinaus statt einer, die unterwegs abbricht.
 */
const BUENDEL = 100

export type Aufraeumergebnis = {
  faellig: number
  entfernt: number
  /** Was nicht wegging. Der nächste Lauf nimmt es erneut mit. */
  fehler: string[]
}

/**
 * Holt die fälligen Pfade und entfernt sie.
 *
 * @param client ein Client mit dem Service-Key: `dokumente_zum_aufraeumen`
 * steht ausschliesslich `service_role` offen, und die Storage-Policies prüfen
 * gegen eine Anmeldung, die dieser Job nicht hat.
 * @param karenz die Frist als Postgres-Intervall. Der Vorgabewert steht in der
 * Datenbank — hier steht er ausdrücklich nicht ein zweites Mal.
 */
export async function raeumeAuf(
  client: SupabaseClient,
  karenz?: string,
): Promise<Aufraeumergebnis> {
  const { data, error } = await client.rpc(
    'dokumente_zum_aufraeumen',
    karenz === undefined ? {} : { p_karenz: karenz },
  )

  if (error !== null) {
    throw new Error(`Die fälligen Dokumente waren nicht abzurufen: ${error.message}`)
  }

  const pfade = (data ?? []) as string[]
  const fehler: string[] = []
  let entfernt = 0

  for (let stelle = 0; stelle < pfade.length; stelle += BUENDEL) {
    const buendel = pfade.slice(stelle, stelle + BUENDEL)
    const { data: weg, error: wegError } = await client.storage.from(BUCKET).remove(buendel)

    if (wegError === null) {
      // Gezählt wird, was die API als entfernt zurückmeldet, und nicht, was
      // hinausging: Ein Pfad, unter dem nichts mehr liegt, ist für `remove`
      // kein Fehler — und eine Zahl, die ihn mitzählt, behauptete Arbeit, die
      // niemand getan hat.
      entfernt += weg?.length ?? 0
    } else {
      // Kein Abbruch: Ein Bündel, das hängen bleibt, soll die übrigen nicht
      // aufhalten. Was heute nicht wegging, ist morgen wieder fällig.
      fehler.push(wegError.message)
    }
  }

  return { faellig: pfade.length, entfernt, fehler }
}

Deno.serve(async (anfrage: Request) => {
  const url = Deno.env.get('SUPABASE_URL')
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

  if (url === undefined || key === undefined) {
    return Response.json(
      { fehler: 'SUPABASE_URL oder SUPABASE_SERVICE_ROLE_KEY fehlt.' },
      { status: 500 },
    )
  }

  // Die Karenz lässt sich überschreiben — für einen Lauf von Hand, wenn jemand
  // wissen will, was in drei Tagen fällig wäre. Ohne Angabe gilt, was in der
  // Datenbank steht.
  const karenz = new URL(anfrage.url).searchParams.get('karenz') ?? undefined

  try {
    return Response.json(await raeumeAuf(createClient(url, key), karenz))
  } catch (ursache) {
    return Response.json(
      { fehler: ursache instanceof Error ? ursache.message : String(ursache) },
      { status: 500 },
    )
  }
})
