import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PGlite } from '@electric-sql/pglite'

/**
 * Ein Postgres für die Tests, so nah an Supabase wie nötig.
 *
 * Die Migrationskette muss aus einer leeren Datenbank durchlaufen (§4), und die
 * RLS-Policies müssen das tun, was §4 von ihnen behauptet. Beides lässt sich
 * nicht behaupten, sondern nur ausführen — deshalb PGlite: dasselbe Postgres,
 * nur als WASM, ohne Docker und ohne Projekt in der Cloud.
 *
 * Was hier steht und **nicht** in den Migrationen: alles, was die Plattform
 * mitbringt. Die Rollen `anon`, `authenticated` und `service_role`, das Schema
 * `auth` samt `auth.jwt()`, und die Default-Privilegien, mit denen Supabase
 * neue Tabellen in `public` ausstattet. Stünde es in einer Migration, liefe sie
 * gegen ein echtes Projekt entweder ins Leere oder in einen Konflikt.
 */

const MIGRATIONEN = fileURLToPath(new URL('../../supabase/migrations', import.meta.url))

/**
 * Was Supabase vor der ersten eigenen Migration bereits eingerichtet hat.
 *
 * `auth.jwt()` liest denselben GUC wie in der Cloud: PostgREST setzt
 * `request.jwt.claims` pro Anfrage aus dem verifizierten Token. Hier setzt ihn
 * {@link alsBenutzer} — die Signaturprüfung ist nicht Gegenstand dieser Tests,
 * die Policies dahinter schon.
 */
const PLATTFORM = `
  create schema if not exists auth;

  create or replace function auth.jwt() returns jsonb
    language sql stable as $fn$
    select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb);
  $fn$;

  create role anon nologin noinherit;
  create role authenticated nologin noinherit;
  create role service_role nologin noinherit bypassrls;

  grant usage on schema public to anon, authenticated, service_role;
  grant usage on schema auth to anon, authenticated, service_role;

  -- Genau die Voreinstellung eines heutigen Supabase-Projekts: Tabellen in
  -- public sind fuer anon und authenticated nicht lesbar, bis eine Migration
  -- es ausdruecklich erteilt. Stuende hier grant all, liefe jede Policy im
  -- Test gegen Rechte, die es in der Cloud nicht gibt, und ein fehlendes
  -- grant faenden wir erst im Browser.
  alter default privileges in schema public
    grant truncate, references, trigger on tables to anon, authenticated, service_role;
`

export function migrationsdateien(): string[] {
  return readdirSync(MIGRATIONEN)
    .filter((name) => name.endsWith('.sql'))
    .sort()
}

/**
 * Eine leere Datenbank, durch die die gesamte Migrationskette gelaufen ist.
 *
 * Nacheinander und in Dateinamenreihenfolge, so wie `supabase db push` es tut.
 * Scheitert eine Datei, nennt der Fehler sie beim Namen — sonst stünde nur
 * irgendein SQL-Fehler ohne Ort da.
 */
export async function frischeDatenbank(): Promise<PGlite> {
  const db = await PGlite.create()

  await db.exec(PLATTFORM)

  for (const datei of migrationsdateien()) {
    const sql = readFileSync(join(MIGRATIONEN, datei), 'utf8')

    try {
      await db.exec(sql)
    } catch (ursache) {
      throw new Error(`Migration ${datei} ist gescheitert: ${(ursache as Error).message}`, {
        cause: ursache,
      })
    }
  }

  return db
}

export type AlsBenutzer = <T>(arbeit: (fuehreAus: FuehreAus) => Promise<T>) => Promise<T>

export type FuehreAus = (sql: string, parameter?: unknown[]) => Promise<{ rows: unknown[] }>

/**
 * Führt Abfragen so aus, wie PostgREST sie für eine angemeldete Person ausführt:
 * in der Rolle `authenticated` und mit `sub` im JWT.
 *
 * `set local` statt `set`: Beides gilt nur bis zum Ende der Transaktion, damit
 * kein Test den nächsten mit einer fremden Identität erbt.
 */
export function alsBenutzer(db: PGlite, sub: string): AlsBenutzer {
  return (arbeit) =>
    db.transaction(async (tx) => {
      await tx.query('select set_config($1, $2, true)', [
        'request.jwt.claims',
        JSON.stringify({ sub }),
      ])
      await tx.exec('set local role authenticated')

      return arbeit((sql, parameter = []) => tx.query(sql, parameter))
    }) as Promise<never>
}

/** Legt einen Fall samt Mitgliedschaften an, an der RLS vorbei. */
export async function fallMitMitgliedern(
  db: PGlite,
  ...userIds: string[]
): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `insert into cases (status, current_kid, payload) values ('trauerfall', 'case_test:1', '\\x00')
     returning id`,
  )

  const fallId = rows[0]?.id
  if (fallId === undefined) {
    throw new Error('Der Testfall wurde nicht angelegt.')
  }

  for (const userId of userIds) {
    await db.query('insert into memberships (case_id, user_id) values ($1, $2)', [fallId, userId])
  }

  return fallId
}

let naechstesGeraet = 0

/**
 * Legt einen Geräteschlüssel an, an der RLS vorbei.
 *
 * @param pkKem der öffentliche Schlüssel. Ohne Angabe ein frischer, denn
 * `(user_id, public_key)` ist eindeutig — zwei Testgeräte derselben Person
 * dürfen nicht denselben tragen.
 */
export async function geraeteschluessel(
  db: PGlite,
  userId: string,
  label = 'Testgerät',
  pkKem: Uint8Array = new Uint8Array(8).fill(naechstesGeraet++ % 256),
): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `insert into device_keys (user_id, public_key, sig_public_key, label)
     values ($1, $2, $3, $4) returning id`,
    [userId, pkKem, new Uint8Array(8).fill(0xbb), label],
  )

  const id = rows[0]?.id
  if (id === undefined) {
    throw new Error('Der Testgeräteschlüssel wurde nicht angelegt.')
  }

  return id
}
