import type { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { katalogItemId } from '../../src/core/crypto/katalogId'
import { alsBenutzer, fallMitMitgliedern, frischeDatenbank } from './postgres'

/**
 * Nahtstelle: die Instanziierung des Rechtskatalogs (DESIGN.md §8).
 *
 * Die Zusage „zwei gleichzeitige Instanziierungen erzeugen keine Duplikate"
 * hängt an zwei Dingen, und das zweite ist Postgres: an bitgleichen IDs
 * (`katalogId.test.ts`) und an `insert … on conflict do nothing`. Genau das
 * schickt PostgREST, wenn der Adapter `ignoreDuplicates` setzt.
 *
 * Geprüft wird hier deshalb das SQL selbst — mitsamt dem Sequenztrigger, der
 * bei jedem Einfügeversuch mitläuft.
 */

const ANNA = 'user_anna'
const BERND = 'user_bernd'

const KCAT = new Uint8Array(32).fill(0x2a)

let db: PGlite

beforeAll(async () => {
  db = await frischeDatenbank()
})

afterAll(async () => {
  await db?.close()
})

/** Was der Adapter schickt: mehrere Zeilen, ein Statement, `do nothing`. */
function instanziiere(
  fuehreAus: (sql: string, parameter?: unknown[]) => Promise<{ rows: unknown[] }>,
  fallId: string,
  kid: string,
  ids: string[],
) {
  const werte = ids
    .map((_, i) => `($${i + 3}, $1, 'item', $2, '\\x01', '\\x02')`)
    .join(', ')

  return fuehreAus(
    `insert into items (id, case_id, kind, kid, wrapped_dek, payload)
     values ${werte}
     on conflict do nothing`,
    [fallId, kid, ...ids],
  )
}

async function itemIds(fallId: string): Promise<string[]> {
  const { rows } = await db.query<{ id: string }>(
    'select id from items where case_id = $1 order by seq',
    [fallId],
  )

  return rows.map((zeile) => zeile.id)
}

describe('Katalog-Instanziierung (§8)', () => {
  it('legt beim zweiten Anlauf keine zweite Zeile an', async () => {
    const fallId = await fallMitMitgliedern(db, ANNA, BERND)
    const ids = await Promise.all(
      ['sterbefall-anzeigen', 'erbausschlagung-pruefen'].map((aufgabe) =>
        katalogItemId(KCAT, fallId, aufgabe),
      ),
    )

    // Anna instanziiert. Bernd tut dasselbe — auf einer anderen
    // `K_c`-Generation, also mit einem anderen `kid`, aber mit denselben IDs.
    await alsBenutzer(db, ANNA)((fuehreAus) =>
      instanziiere(fuehreAus, fallId, `case_${fallId}:1`, ids),
    )
    await alsBenutzer(db, BERND)((fuehreAus) =>
      instanziiere(fuehreAus, fallId, `case_${fallId}:2`, ids),
    )

    expect(await itemIds(fallId)).toEqual(ids)
  })

  it('lässt die vorhandene Zeile unangetastet, statt sie zu überschreiben', async () => {
    // Eine instanziierte Aufgabe ist ein gewöhnliches Item: Jemand kann sie
    // längst geändert haben. Ein zweiter Anlauf darf das nicht zurücknehmen.
    const fallId = await fallMitMitgliedern(db, ANNA, BERND)
    const id = await katalogItemId(KCAT, fallId, 'sterbefall-anzeigen')

    await alsBenutzer(db, ANNA)((fuehreAus) =>
      instanziiere(fuehreAus, fallId, `case_${fallId}:1`, [id]),
    )

    await db.query('update items set payload = $2 where id = $1', [id, new Uint8Array([0xff])])

    await alsBenutzer(db, BERND)((fuehreAus) =>
      instanziiere(fuehreAus, fallId, `case_${fallId}:2`, [id]),
    )

    const { rows } = await db.query<{ payload: Uint8Array; kid: string }>(
      'select payload, kid from items where id = $1',
      [id],
    )

    expect([...(rows[0]?.payload ?? [])]).toEqual([0xff])
    expect(rows[0]?.kid).toBe(`case_${fallId}:1`)
  })

  it('gibt jeder instanziierten Zeile ihre eigene seq', async () => {
    // Der Trigger läuft je Zeile, auch innerhalb eines Statements. Zwei Zeilen
    // mit derselben Nummer wären für den Delta-Sync eine verlorene Zeile (§5).
    const fallId = await fallMitMitgliedern(db, ANNA)
    const ids = await Promise.all(
      ['a', 'b', 'c'].map((aufgabe) => katalogItemId(KCAT, fallId, aufgabe)),
    )

    await alsBenutzer(db, ANNA)((fuehreAus) =>
      instanziiere(fuehreAus, fallId, `case_${fallId}:1`, ids),
    )

    const { rows } = await db.query<{ seq: number }>(
      'select seq from items where case_id = $1',
      [fallId],
    )

    expect(new Set(rows.map((zeile) => Number(zeile.seq))).size).toBe(3)
  })

  it('lässt niemanden in einen fremden Fall instanziieren', async () => {
    const fallId = await fallMitMitgliedern(db, ANNA)
    const id = await katalogItemId(KCAT, fallId, 'sterbefall-anzeigen')

    await expect(
      alsBenutzer(db, 'user_fremde')((fuehreAus) =>
        instanziiere(fuehreAus, fallId, `case_${fallId}:1`, [id]),
      ),
    ).rejects.toThrow(/row-level security/)
  })
})
