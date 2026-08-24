import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js'

/**
 * Ein Supabase-Client-Doppel für die Adaptertests.
 *
 * Nur so viel PostgREST-Kette, wie die Adapter tatsächlich anfassen: `from`,
 * `select`/`insert`/`update`, die Filter und die drei Abschlüsse
 * (`maybeSingle`, `single`, `returns`). Jedes Glied gibt dieselbe Kette
 * zurück, damit die Reihenfolge der Aufrufe keine Rolle spielt: Geprüft wird,
 * was der Adapter verlangt hat, nicht in welcher Reihenfolge.
 *
 * Absichtlich kein echtes Postgres: Das steht daneben in `faelle.test.ts` und
 * `geraeteschluessel.test.ts` gegen PGlite. Hier geht es um die Übersetzung
 * zwischen PostgREST-Antwort und Port, insbesondere darum, was der Adapter
 * aus einem `error` macht.
 */

export type Antwort = { data: unknown; error: PostgrestError | null }

export type Aufzeichnung = {
  tabelle?: string
  rpc?: string
  rpcArgumente?: Record<string, unknown>
  eingefuegt?: unknown
  hochgeladen?: { werte: unknown; optionen: unknown }
  aktualisiert?: unknown
  geloescht?: boolean
  filter: Record<string, unknown>
  groesserAls?: Record<string, unknown>
  spalten?: string
  sortierung?: { spalte: string; optionen: unknown }
  hineingeschickt?: Record<string, unknown>
  funktion?: { name: string; optionen: unknown }
}

/** Was `functions.invoke` zurückgibt: kein PostgREST-Fehler, sondern ein Error. */
export type Funktionsantwort = { data: unknown; error: Error | null }

export function stubClient(
  antwort: Antwort,
  funktionsantwort: Funktionsantwort = { data: null, error: null },
) {
  const gesehen: Aufzeichnung = { filter: {} }

  const kette = {
    select(spalten?: string) {
      if (spalten !== undefined) {
        gesehen.spalten = spalten
      }
      return kette
    },
    insert(werte: unknown) {
      gesehen.eingefuegt = werte
      return kette
    },
    upsert(werte: unknown, optionen?: unknown) {
      gesehen.hochgeladen = { werte, optionen }
      return kette
    },
    update(werte: unknown) {
      gesehen.aktualisiert = werte
      return kette
    },
    delete() {
      gesehen.geloescht = true
      return kette
    },
    eq(spalte: string, wert: unknown) {
      gesehen.filter[spalte] = wert
      return kette
    },
    gt(spalte: string, wert: unknown) {
      gesehen.groesserAls = { ...gesehen.groesserAls, [spalte]: wert }
      return kette
    },
    order(spalte: string, optionen: unknown) {
      gesehen.sortierung = { spalte, optionen }
      return kette
    },
    maybeSingle: () => Promise.resolve(antwort),
    single: () => Promise.resolve(antwort),
    returns: () => Promise.resolve(antwort),

    /*
     * PostgREST-Builder sind selbst awaitbar: Ein `insert`, dessen Ergebnis
     * niemand braucht, wird ohne Abschluss direkt awaitet. Ohne dieses `then`
     * ergäbe so ein `await` das Kettenobjekt statt der Antwort, und der Adapter
     * läse aus ihm ein `error: undefined` heraus.
     */
    then(...args: Parameters<Promise<Antwort>['then']>) {
      return Promise.resolve(antwort).then(...args)
    },
  }

  const client = {
    from(tabelle: string) {
      gesehen.tabelle = tabelle
      return kette
    },
    /*
     * `rpc` gibt dieselbe Kette zurück wie `from` und nicht bloß ein Promise:
     * PostgREST-RPCs sind Filter-Builder, an die sich Filter und Abschlüsse
     * hängen lassen. Ein blankes Promise ließe einen Adapter, der das tut, an
     * einer Stelle scheitern, die mit dem Adapter nichts zu tun hat.
     */
    rpc(name: string, argumente: Record<string, unknown>) {
      gesehen.rpc = name
      gesehen.rpcArgumente = argumente
      return kette
    },
    functions: {
      invoke(name: string, optionen: unknown) {
        gesehen.funktion = { name, optionen }
        return Promise.resolve(funktionsantwort)
      },
    },
  } as unknown as SupabaseClient

  return { client, gesehen }
}

/** Ein PostgREST-Fehler, wie ihn `supabase-js` durchreicht. */
export function fehler(nachricht: string, code = '42501'): PostgrestError {
  return {
    message: nachricht,
    details: '',
    hint: '',
    code,
    name: 'PostgrestError',
    toJSON: () => ({
      name: 'PostgrestError',
      message: nachricht,
      details: '',
      hint: '',
      code,
    }),
  }
}

/** Hex-Kodierung, wie PostgREST sie für `bytea` liefert. */
export function alsHex(bytes: number[]): string {
  return `\\x${bytes.map((byte) => byte.toString(16).padStart(2, '0')).join('')}`
}
