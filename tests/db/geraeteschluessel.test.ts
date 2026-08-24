import type { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  alsBenutzer,
  fallMitMitgliedern,
  frischeDatenbank,
  geraeteschluessel,
  migrationsdateien,
} from './postgres'

/**
 * Nahtstelle: `device_keys` und seine RLS (DESIGN.md §4).
 *
 * Die Tabelle trägt ausschließlich öffentliche Schlüssel, trotzdem entscheidet
 * ihre RLS über die Sicherheit des Protokolls. Wer fremde Zeilen ändern könnte,
 * tauschte den Schlüssel aus, an den andere `K_c` wrappen, und läse ab dann mit.
 * Der Prüfcode aus §3.6 ist genau deshalb da, aber er wird nur beim Koppeln
 * verglichen; die Zeile selbst muss auch dazwischen unantastbar sein.
 */

const ANNA = 'user_anna'
const BERND = 'user_bernd'
const FREMDE = 'user_fremde'

let db: PGlite

beforeAll(async () => {
  db = await frischeDatenbank()
})

afterAll(async () => {
  await db?.close()
})

describe('Die Migrationskette', () => {
  it('läuft von einer leeren Datenbank aus durch', async () => {
    // `frischeDatenbank` wirft, sobald eine Datei scheitert. Bleibt zu zeigen,
    // dass danach steht, was §4 verlangt.
    expect(migrationsdateien().length).toBeGreaterThan(0)

    const { rows } = await db.query<{ table_name: string }>(
      `select table_name from information_schema.tables
       where table_schema = 'public' order by table_name`,
    )

    expect(rows.map((zeile) => zeile.table_name)).toEqual([
      'cases',
      'device_keys',
      'items',
      'key_wraps',
      'memberships',
      'pairing_attempts',
      'pairing_codes',
      'personal_key_wraps',
      'profiles',
      'vault_key_wraps',
      'vault_releases',
      'vault_shares',
    ])
  })

  it('schaltet auf jeder Tabelle RLS ein', async () => {
    // Eine Tabelle ohne RLS ist über PostgREST für jede angemeldete Person
    // lesbar. Das darf keiner Tabelle passieren, auch keiner, deren Policies
    // erst ein späterer Slice braucht.
    const { rows } = await db.query<{ relname: string }>(
      `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity`,
    )

    expect(rows).toEqual([])
  })

  it('lässt kein zweites Gerät mit demselben öffentlichen Schlüssel zu', async () => {
    // Ohne diese Zusage legte ein Neuladen, das zweimal gleichzeitig
    // registriert, zwei Zeilen für dasselbe Gerät an, und `key_wraps` zeigte
    // ab dann auf die falsche.
    const pkKem = new Uint8Array(8).fill(0xd0)
    await geraeteschluessel(db, 'user_doppelt', 'Erster Versuch', pkKem)

    await expect(
      geraeteschluessel(db, 'user_doppelt', 'Zweiter Versuch', pkKem),
    ).rejects.toThrow(/unique|eindeutig/i)
  })
})

describe('RLS auf device_keys (§4)', () => {
  it('zeigt der eigenen Person ihre Geräte', async () => {
    await geraeteschluessel(db, ANNA, 'iPhone von Anna')

    const zeilen = await alsBenutzer(db, ANNA)(async (fuehreAus) => {
      const { rows } = await fuehreAus('select label from device_keys')
      return rows as { label: string }[]
    })

    expect(zeilen.map((zeile) => zeile.label)).toContain('iPhone von Anna')
  })

  it('zeigt die Geräte derer, mit denen man einen Fall teilt', async () => {
    await fallMitMitgliedern(db, ANNA, BERND)
    await geraeteschluessel(db, BERND, 'Laptop von Bernd')

    const zeilen = await alsBenutzer(db, ANNA)(async (fuehreAus) => {
      const { rows } = await fuehreAus('select label from device_keys where user_id = $1', [BERND])
      return rows as { label: string }[]
    })

    expect(zeilen.map((zeile) => zeile.label)).toEqual(['Laptop von Bernd'])
  })

  it('verbirgt die Geräte einer Person, mit der man keinen Fall teilt', async () => {
    await geraeteschluessel(db, FREMDE, 'Fremdes Gerät')

    const zeilen = await alsBenutzer(db, ANNA)(async (fuehreAus) => {
      const { rows } = await fuehreAus('select label from device_keys where user_id = $1', [FREMDE])
      return rows
    })

    expect(zeilen).toEqual([])
  })

  it('lässt niemanden im Namen einer anderen Person schreiben', async () => {
    await expect(
      alsBenutzer(db, ANNA)((fuehreAus) =>
        fuehreAus(
          `insert into device_keys (user_id, public_key, sig_public_key)
           values ($1, $2, $2)`,
          [BERND, new Uint8Array(1)],
        ),
      ),
    ).rejects.toThrow(/row-level security/i)
  })

  it('lässt die eigene Person ihr Label ändern', async () => {
    const id = await geraeteschluessel(db, ANNA, 'Namenlos')

    await alsBenutzer(db, ANNA)((fuehreAus) =>
      fuehreAus('update device_keys set label = $1 where id = $2', ['iPad von Anna', id]),
    )

    const { rows } = await db.query<{ label: string }>(
      'select label from device_keys where id = $1',
      [id],
    )

    expect(rows[0]?.label).toBe('iPad von Anna')
  })

  it('lässt einen fremden Datensatz weder ändern noch löschen', async () => {
    // Der eigentliche Angriff: Bernds Gerät steht in Annas Fall, also sieht
    // Anna es. Sehen darf sie es, austauschen nicht. Sonst wrappten die
    // anderen ihren Fallschlüssel an einen Schlüssel, den Anna kontrolliert.
    await fallMitMitgliedern(db, ANNA, BERND)
    const pkKem = new Uint8Array(8).fill(0xbe)
    const berndsGeraet = await geraeteschluessel(db, BERND, 'Berndes Telefon', pkKem)

    await alsBenutzer(db, ANNA)(async (fuehreAus) => {
      await fuehreAus('update device_keys set public_key = $1 where id = $2', [
        new Uint8Array([0xde, 0xad]),
        berndsGeraet,
      ])
      await fuehreAus('delete from device_keys where id = $1', [berndsGeraet])
    })

    const { rows } = await db.query<{ public_key: string; label: string }>(
      'select label, encode(public_key, $1) as public_key from device_keys where id = $2',
      ['hex', berndsGeraet],
    )

    // Kein Fehler, sondern null Zeilen betroffen: Was die Policy nicht sichtbar
    // macht, existiert für UPDATE und DELETE nicht.
    expect(rows).toHaveLength(1)
    expect(rows[0]?.label).toBe('Berndes Telefon')
    expect(rows[0]?.public_key).toBe('be'.repeat(8))
  })
})
