import type { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { uuidv7 } from '../../src/core/uuidv7'
import { fallMitMitgliedern, frischeDatenbank } from './postgres'

/**
 * Nahtstelle: der Delta-Sync gegen echtes Postgres (DESIGN.md §5).
 *
 * Das ganze Protokoll aus §5 sind zwei Abfragen — `select version from cases`
 * und `select * from items where seq > watermark`. Ob sie tragen, entscheidet
 * nicht der Client, sondern die Datenbank: Sie vergibt `seq` unter Zeilensperre
 * und hebt `cases.version` im selben Zug. Deshalb laufen die Zusagen hier gegen
 * Postgres und nicht gegen einen Adapter.
 *
 * Geprüft wird die eine Eigenschaft, an der alles hängt: **Das Delta überspringt
 * keine Zeile.** Ein Client, der Wasserzeichen `w` gesehen hat, bekommt jede
 * Änderung mit `seq > w` — genau einmal und ohne Lücke, auch wenn zwischen
 * seinen beiden Abfragen weitergeschrieben wird.
 */

const ANNA = 'user_anna'

let db: PGlite

beforeAll(async () => {
  db = await frischeDatenbank()
})

afterAll(async () => {
  await db?.close()
})

async function item(fallId: string, id: string = uuidv7()): Promise<string> {
  await db.query(
    `insert into items (id, case_id, kind, kid, wrapped_dek, payload)
     values ($2, $1, 'item', 'case_test:1', '\\x01', '\\x02')`,
    [fallId, id],
  )

  return id
}

type Deltazeile = { id: string; seq: number; deleted: boolean }

/** Das Delta aus §5, Wort für Wort. */
async function delta(fallId: string, wasserzeichen: number): Promise<Deltazeile[]> {
  const { rows } = await db.query<Deltazeile>(
    'select id, seq, deleted from items where case_id = $1 and seq > $2 order by seq',
    [fallId, wasserzeichen],
  )

  return rows.map((zeile) => ({ ...zeile, seq: Number(zeile.seq) }))
}

async function version(fallId: string): Promise<number> {
  const { rows } = await db.query<{ version: number }>('select version from cases where id = $1', [
    fallId,
  ])

  return Number(rows[0]?.version)
}

describe('Delta über seq (§5)', () => {
  it('liefert bei Wasserzeichen 0 den vollständigen Stand', async () => {
    // §5: „Vollständige Resynchronisation ist `seq > 0`." Ein eigener Weg für
    // den Kaltstart existiert deshalb nicht — er ist derselbe Weg mit 0.
    const fall = await fallMitMitgliedern(db, ANNA)
    const erstes = await item(fall)
    const zweites = await item(fall)

    expect((await delta(fall, 0)).map((zeile) => zeile.id)).toEqual([erstes, zweites])
  })

  it('lässt bei gleichem Wasserzeichen nichts übrig', async () => {
    const fall = await fallMitMitgliedern(db, ANNA)
    await item(fall)

    expect(await delta(fall, await version(fall))).toEqual([])
  })

  it('trägt ein Edit und einen Soft-Delete ins Delta des anderen Geräts', async () => {
    const fall = await fallMitMitgliedern(db, ANNA)
    const geaendert = await item(fall)
    const geloescht = await item(fall)

    // Das zweite Gerät steht auf dem Stand nach dem Anlegen.
    const wasserzeichen = await version(fall)

    await db.query('update items set payload = $2 where id = $1', [geaendert, new Uint8Array([9])])
    await db.query('update items set deleted = true where id = $1', [geloescht])

    expect(await delta(fall, wasserzeichen)).toEqual([
      { id: geaendert, seq: wasserzeichen + 1, deleted: false },
      { id: geloescht, seq: wasserzeichen + 2, deleted: true },
    ])
  })

  it('überspringt keine Zeile, wenn zwischen zwei Abrufen weitergeschrieben wird', async () => {
    /*
     * Der Fall, für den §4 `bigserial` verwirft. Ein Gerät ruft ab, jemand
     * schreibt, es ruft erneut ab: Die Vereinigung beider Deltas muss jede
     * Zeile genau einmal enthalten. Trüge eine Zeile eine Nummer unterhalb des
     * bereits gesetzten Wasserzeichens, fiele sie zwischen die beiden Abrufe
     * und käme nie wieder.
     */
    const fall = await fallMitMitgliedern(db, ANNA)
    const angelegt = [await item(fall), await item(fall)]

    const ersterAbruf = await delta(fall, 0)
    const wasserzeichen = Math.max(...ersterAbruf.map((zeile) => zeile.seq))

    angelegt.push(await item(fall), await item(fall))
    await db.query('update items set deleted = true where id = $1', [angelegt[0]])

    const zweiterAbruf = await delta(fall, wasserzeichen)

    const gesehen = [...ersterAbruf, ...zweiterAbruf].map((zeile) => zeile.id)
    expect(new Set(gesehen)).toEqual(new Set(angelegt))
    // Genau einmal je Änderung, nicht je Zeile: Das erste Item steht zweimal
    // drin — einmal als Anlage, einmal als Tombstone.
    expect(gesehen).toHaveLength(angelegt.length + 1)
  })

  it('hält cases.version und das höchste seq zusammen', async () => {
    // Der billige Check aus §5 fragt `cases.version` und vergleicht ihn mit dem
    // Wasserzeichen, das aus `seq` stammt. Liefen die beiden auseinander, fragte
    // ein Gerät entweder ewig oder nie nach.
    const fall = await fallMitMitgliedern(db, ANNA)
    await item(fall)
    const id = await item(fall)
    await db.query('update items set deleted = true where id = $1', [id])

    const { rows } = await db.query<{ hoechstes: number }>(
      'select max(seq) as hoechstes from items where case_id = $1',
      [fall],
    )

    expect(Number(rows[0]?.hoechstes)).toBe(await version(fall))
  })
})

describe('Türklingel (§5)', () => {
  it('veröffentlicht cases für Realtime', async () => {
    /*
     * §5: Die Türklingel ist eine Subscription auf die `cases`-Zeile. Ohne die
     * Tabelle in der Publikation `supabase_realtime` feuert sie nie — die
     * Subscription meldete `SUBSCRIBED`, und nichts käme je an. Der Fallback
     * aus §5 greift dann ausdrücklich nicht, weil er nur bei einer
     * *gescheiterten* Subscription läuft.
     */
    const { rows } = await db.query<{ tablename: string }>(
      `select tablename from pg_publication_tables where pubname = 'supabase_realtime'`,
    )

    expect(rows.map((zeile) => zeile.tablename)).toContain('cases')
  })

  it('lässt items aus der Publikation heraus', async () => {
    // Die Türklingel trägt keine Nutzlast. Was sich geändert hat, holt der
    // Delta-Sync — verschlüsselt, über PostgREST und durch die RLS. Stünde
    // `items` in der Publikation, liefe daneben ein zweiter Weg für dieselben
    // Daten.
    const { rows } = await db.query<{ tablename: string }>(
      `select tablename from pg_publication_tables where pubname = 'supabase_realtime'`,
    )

    expect(rows.map((zeile) => zeile.tablename)).not.toContain('items')
  })
})
