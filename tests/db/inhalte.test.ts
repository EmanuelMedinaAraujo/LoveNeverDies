import type { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { uuidv7 } from '../../src/core/uuidv7'
import { alsBenutzer, fallMitMitgliedern, frischeDatenbank } from './postgres'

/**
 * Nahtstelle: `items`, der Sequenzzähler und die Tombstone-Sperre
 * (DESIGN.md §4, §5).
 *
 * Drei Zusagen dieses Slices sind Zusagen der Datenbank und keine des Clients:
 *
 *   1. `seq` vergibt ausschließlich der Trigger, und er hebt dabei
 *      `cases.version` — der Zähler, an dem der Delta-Sync hängt (§5).
 *   2. Ein `deleted → false` weist die Datenbank ab. Ohne Durchsetzung wäre
 *      „Löschen gewinnt endgültig" eine Hoffnung (§4).
 *   3. Auf `items` gibt es kein DELETE, für niemanden.
 *
 * Deshalb laufen sie hier gegen echtes Postgres.
 *
 * **Was hier nicht steht: echte Nebenläufigkeit.** PGlite hat genau eine
 * Verbindung, zwei Transaktionen laufen also nie wirklich gleichzeitig. Die
 * Monotonie hängt an der Zeilensperre, die `update cases … returning` nimmt —
 * geprüft wird stattdessen, was aus ihr folgt und einzeln beobachtbar ist:
 * jede Schreiboperation bekommt eine eigene, höhere Nummer, ein abgebrochener
 * Schreibvorgang lässt keine Lücke, und zwei Zeilen desselben Falls können
 * dieselbe Nummer nicht tragen.
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

/** Legt ein Item an, an der RLS vorbei, und gibt seine ID zurück. */
async function item(
  fallId: string,
  kid = 'case_test:1',
  id: string = crypto.randomUUID(),
): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `insert into items (id, case_id, kind, kid, wrapped_dek, payload)
     values ($3, $1, 'item', $2, '\\x01', '\\x02') returning id`,
    [fallId, kid, id],
  )

  const angelegt = rows[0]?.id
  if (angelegt === undefined) {
    throw new Error('Das Test-Item wurde nicht angelegt.')
  }

  return angelegt
}

async function seqVon(id: string): Promise<number> {
  const { rows } = await db.query<{ seq: number }>('select seq from items where id = $1', [id])

  return Number(rows[0]?.seq)
}

async function versionVon(fallId: string): Promise<number> {
  const { rows } = await db.query<{ version: number }>('select version from cases where id = $1', [
    fallId,
  ])

  return Number(rows[0]?.version)
}

describe('items_assign_seq (§4, §5)', () => {
  it('zählt je Fall von 1 an aufwärts und hebt cases.version mit', async () => {
    const fall = await fallMitMitgliedern(db, ANNA)

    const erstes = await item(fall)
    const zweites = await item(fall)

    expect(await seqVon(erstes)).toBe(1)
    expect(await seqVon(zweites)).toBe(2)
    expect(await versionVon(fall)).toBe(2)
  })

  it('zählt zwei Fälle unabhängig voneinander', async () => {
    const einer = await fallMitMitgliedern(db, ANNA)
    const anderer = await fallMitMitgliedern(db, ANNA)

    await item(einer)
    const dort = await item(anderer)

    expect(await seqVon(dort)).toBe(1)
  })

  it('hebt seq bei einem Edit', async () => {
    // §5: `seq > watermark` ist der ganze Delta-Sync. Ein Edit, das seq nicht
    // hebt, käme auf keinem zweiten Gerät je an.
    const fall = await fallMitMitgliedern(db, ANNA)
    const id = await item(fall)
    const vorher = await seqVon(id)

    await db.query('update items set payload = $2 where id = $1', [id, new Uint8Array([0xff])])

    expect(await seqVon(id)).toBeGreaterThan(vorher)
    expect(await versionVon(fall)).toBe(await seqVon(id))
  })

  it('hebt seq bei einem Soft-Delete', async () => {
    const fall = await fallMitMitgliedern(db, ANNA)
    const id = await item(fall)
    const vorher = await seqVon(id)

    await db.query('update items set deleted = true where id = $1', [id])

    expect(await seqVon(id)).toBeGreaterThan(vorher)
  })

  it('setzt updated_at bei jeder Änderung neu', async () => {
    const fall = await fallMitMitgliedern(db, ANNA)
    const id = await item(fall)

    const { rows } = await db.query<{ gleich: boolean }>(
      `with vorher as (select updated_at from items where id = $1),
            gesetzt as (update items set deleted = true where id = $1 returning updated_at)
       select (select updated_at from gesetzt) >= (select updated_at from vorher) as gleich`,
      [id],
    )

    expect(rows[0]?.gleich).toBe(true)
  })

  it('überschreibt ein seq, das der Client selbst mitbringt', async () => {
    // §4: „vom Trigger, nie vom Client". Ein Client, der seq setzen dürfte,
    // könnte sich an jedem Wasserzeichen vorbeischreiben.
    const fall = await fallMitMitgliedern(db, ANNA)

    const { rows } = await db.query<{ seq: number }>(
      `insert into items (id, case_id, seq, kind, kid, wrapped_dek, payload)
       values (gen_random_uuid(), $1, 9999, 'item', 'case_test:1', '\\x01', '\\x02')
       returning seq`,
      [fall],
    )

    expect(Number(rows[0]?.seq)).toBe(1)
  })

  it('lässt nach einem abgebrochenen Schreibvorgang keine Lücke', async () => {
    /*
     * Der Grund, aus dem §4 `bigserial` ausschließt: Eine Sequenz vergibt
     * Nummern vor dem Commit und behält sie auch dann, wenn die Transaktion
     * zurückrollt. Ein Client mit Wasserzeichen 1 wartete dann ewig auf die
     * verbrannte 2 — oder überspränge sie und mit ihr eine echte Zeile.
     * `cases.version` rollt mit zurück.
     */
    const fall = await fallMitMitgliedern(db, ANNA)
    await item(fall)

    await expect(
      db.transaction(async (tx) => {
        await tx.query(
          `insert into items (id, case_id, kind, kid, wrapped_dek, payload)
           values (gen_random_uuid(), $1, 'item', 'case_test:1', '\\x01', '\\x02')`,
          [fall],
        )
        throw new Error('Abbruch mitten im Schreiben')
      }),
    ).rejects.toThrow('Abbruch')

    const naechstes = await item(fall)
    expect(await seqVon(naechstes)).toBe(2)
  })

  it('lässt zwei Zeilen desselben Falls dieselbe Nummer nicht tragen', async () => {
    /*
     * Die Monotonie hängt an der Zeilensperre in `items_assign_seq`. Der
     * eindeutige Index ist das Netz darunter, und über den Trigger ist es
     * nicht zu erreichen — er überschreibt jede mitgebrachte Nummer. Also
     * wird der Trigger für diesen einen Fall abgeschaltet: Das ist genau der
     * Zustand, gegen den der Index steht, nämlich ein Schreibweg, der die
     * Nummer nicht mehr unter Sperre vergibt.
     */
    const fall = await fallMitMitgliedern(db, ANNA)
    await item(fall)

    await db.exec('alter table items disable trigger items_seq')

    try {
      await expect(
        db.query(
          `insert into items (id, case_id, seq, kind, kid, wrapped_dek, payload)
           values (gen_random_uuid(), $1, 1, 'item', 'case_test:1', '\\x01', '\\x02')`,
          [fall],
        ),
      ).rejects.toThrow(/unique|duplicate|eindeutig/i)
    } finally {
      await db.exec('alter table items enable trigger items_seq')
    }
  })

  it('weist ein Item ohne Fall ab', async () => {
    await expect(item('00000000-0000-0000-0000-000000000000')).rejects.toThrow(/Fall/i)
  })

  it('laesst die Anlagereihenfolge über die id auch nach einer Änderung stehen', async () => {
    /*
     * Die Kehrseite von „seq steigt bei jedem Schreibvorgang": Als
     * Anzeigereihenfolge taugt sie nicht, sonst wandert eine gerade abgehakte
     * Aufgabe ans Ende der Liste. Der Adapter sortiert deshalb über die `id`.
     *
     * Dass das trägt, hängt an Postgres: Der Typ `uuid` vergleicht byteweise,
     * und eine UUIDv7 trägt die Millisekunden in ihren führenden 48 Bit. Beides
     * zusammen ergibt die Anlagereihenfolge — geprüft hier, gegen echtes
     * Postgres statt gegen die Annahme.
     */
    const fall = await fallMitMitgliedern(db, ANNA)

    const erstes = await item(fall, 'case_test:1', uuidv7())
    const zweites = await item(fall, 'case_test:1', uuidv7())
    const drittes = await item(fall, 'case_test:1', uuidv7())

    await db.query('update items set deleted = true where id = $1', [erstes])

    const { rows } = await db.query<{ id: string }>(
      'select id from items where case_id = $1 order by id',
      [fall],
    )
    expect(rows.map((zeile) => zeile.id)).toEqual([erstes, zweites, drittes])

    const { rows: nachSeq } = await db.query<{ id: string }>(
      'select id from items where case_id = $1 order by seq',
      [fall],
    )
    expect(nachSeq.map((zeile) => zeile.id)).toEqual([zweites, drittes, erstes])
  })
})

describe('items_forbid_undelete (§4, §5)', () => {
  it('weist ein deleted von true auf false ab', async () => {
    const fall = await fallMitMitgliedern(db, ANNA)
    const id = await item(fall)

    await db.query('update items set deleted = true where id = $1', [id])

    await expect(
      db.query('update items set deleted = false where id = $1', [id]),
    ).rejects.toThrow(/wiederbelebt/i)
  })

  it('lässt das Löschen selbst zu', async () => {
    const fall = await fallMitMitgliedern(db, ANNA)
    const id = await item(fall)

    await db.query('update items set deleted = true where id = $1', [id])

    const { rows } = await db.query<{ deleted: boolean }>(
      'select deleted from items where id = $1',
      [id],
    )
    expect(rows[0]?.deleted).toBe(true)
  })

  it('lässt ein Edit an einem gelöschten Item weiterlaufen', async () => {
    // Der Aufräumtrigger aus §4 leert Payload und DEK eines getombsteten
    // Items. Verböte die Sperre jedes UPDATE statt nur die Auferstehung, wäre
    // dieser Weg zu.
    const fall = await fallMitMitgliedern(db, ANNA)
    const id = await item(fall)

    await db.query('update items set deleted = true where id = $1', [id])

    await expect(
      db.query('update items set payload = $2 where id = $1', [id, new Uint8Array()]),
    ).resolves.toBeDefined()
  })
})

describe('RLS auf items (§4)', () => {
  it('lässt ein Mitglied lesen, anlegen und ändern', async () => {
    const fall = await fallMitMitgliedern(db, ANNA)

    const gelesen = await alsBenutzer(db, ANNA)(async (fuehreAus) => {
      await fuehreAus(
        `insert into items (id, case_id, kind, kid, wrapped_dek, payload)
         values (gen_random_uuid(), $1, 'item', 'case_test:1', '\\x01', '\\x02')`,
        [fall],
      )

      await fuehreAus('update items set payload = $2 where case_id = $1', [
        fall,
        new Uint8Array([0x03]),
      ])

      const { rows } = await fuehreAus('select payload from items where case_id = $1', [fall])
      return rows as { payload: Uint8Array }[]
    })

    expect(Array.from(gelesen[0]?.payload ?? [])).toEqual([0x03])
  })

  it('zeigt einer fremden Person die Items nicht', async () => {
    const fall = await fallMitMitgliedern(db, ANNA)
    await item(fall)

    const rows = await alsBenutzer(db, FREMDE)(async (fuehreAus) => {
      const { rows } = await fuehreAus('select id from items where case_id = $1', [fall])
      return rows
    })

    expect(rows).toEqual([])
  })

  it('lässt eine fremde Person nichts in den Fall schreiben', async () => {
    const fall = await fallMitMitgliedern(db, ANNA)

    await expect(
      alsBenutzer(db, FREMDE)((fuehreAus) =>
        fuehreAus(
          `insert into items (id, case_id, kind, kid, wrapped_dek, payload)
           values (gen_random_uuid(), $1, 'item', 'case_test:1', '\\x01', '\\x02')`,
          [fall],
        ),
      ),
    ).rejects.toThrow(/row-level security/i)
  })

  it('lässt eine fremde Person nichts ändern', async () => {
    const fall = await fallMitMitgliedern(db, ANNA)
    const id = await item(fall)

    const geaendert = await alsBenutzer(db, FREMDE)(async (fuehreAus) => {
      const { rows } = await fuehreAus(
        'update items set deleted = true where id = $1 returning id',
        [id],
      )
      return rows
    })

    expect(geaendert).toEqual([])

    const { rows } = await db.query<{ deleted: boolean }>(
      'select deleted from items where id = $1',
      [id],
    )
    expect(rows[0]?.deleted).toBe(false)
  })

  it('lässt ein Mitglied ein Item nicht in einen fremden Fall verschieben', async () => {
    // Die UPDATE-Policy trägt kein eigenes `with check`; Postgres nimmt dann
    // den `using`-Ausdruck auch für die neue Zeile. Genau das wird hier
    // geprüft, denn ohne diesen Zug schöbe ein Mitglied seine Items in einen
    // Fall, in dem es nichts zu suchen hat.
    const eigener = await fallMitMitgliedern(db, ANNA)
    const fremder = await fallMitMitgliedern(db, FREMDE)
    const id = await item(eigener)

    await expect(
      alsBenutzer(db, ANNA)((fuehreAus) =>
        fuehreAus('update items set case_id = $2 where id = $1', [id, fremder]),
      ),
    ).rejects.toThrow(/row-level security/i)
  })

  it('schließt DELETE für jedes Mitglied aus', async () => {
    // §4: „kein DELETE: Löschen erfolgt ausschließlich über deleted = true".
    // Die Zeilen liegen in den Ciphertext-Caches aller Geräte; ein hartes
    // Löschen käme dort nie an, weil der Delta-Sync nur Zuwachs trägt.
    const fall = await fallMitMitgliedern(db, ANNA, BERND)
    const id = await item(fall)

    await expect(
      alsBenutzer(db, ANNA)((fuehreAus) => fuehreAus('delete from items where id = $1', [id])),
    ).rejects.toThrow(/permission denied|row-level security/i)

    const { rows } = await db.query('select 1 from items where id = $1', [id])
    expect(rows).toHaveLength(1)
  })
})
