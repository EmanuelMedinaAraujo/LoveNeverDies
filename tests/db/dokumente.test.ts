import type { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { uuidv7 } from '../../src/core/uuidv7'
import { alsBenutzer, fallMitMitgliedern, frischeDatenbank } from './postgres'

/**
 * Nahtstelle: Dokumente im Storage (DESIGN.md §7, §4).
 *
 * Vier Zusagen dieses Slices trägt die Datenbank und nicht der Client:
 *
 *   1. Der Pfad eines Dokuments ist `{case_id}/{item_id}` — nichts sonst, und
 *      ein Item ohne `kind = 'file'` trägt gar keinen.
 *   2. Wer im Fall ist, liest und schreibt seinen Ordner im Bucket.
 *   3. Wer nicht im Fall ist, sieht ihn nicht — weder lesend noch löschend.
 *   4. Der Aufräumjob benennt nach der Karenz die Dateien getombsteter Items
 *      und lässt jüngere in Ruhe. Entfernt werden sie über die Storage-API —
 *      ein DELETE per SQL nähme die Zeile und liesse die Bytes liegen, und
 *      die Plattform weist es deshalb ab.
 *
 * Deshalb laufen sie hier gegen echtes Postgres.
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

/** Legt ein Dokument-Item an, an der RLS vorbei, und gibt seinen Pfad zurück. */
async function dokumentItem(fallId: string, id: string = uuidv7()): Promise<string> {
  const pfad = `${fallId}/${id}`

  await db.query(
    `insert into items (id, case_id, kind, kid, wrapped_dek, payload, storage_path)
     values ($1, $2, 'file', 'case_test:1', '\\x01', '\\x02', $3)`,
    [id, fallId, pfad],
  )

  return pfad
}

/** Legt ein Storage-Objekt an, an der RLS vorbei. */
async function objekt(pfad: string, alter_: string = '0 seconds'): Promise<void> {
  await db.query(
    `insert into storage.objects (bucket_id, name, created_at)
     values ('documents', $1, now() - $2::interval)`,
    [pfad, alter_],
  )
}

/**
 * Setzt den Tombstone und datiert ihn zurück.
 *
 * `items_assign_seq` stempelt bei jedem UPDATE `updated_at := now()` (§4) —
 * ein alter Tombstone lässt sich deshalb nicht schreiben, sondern nur am
 * Trigger vorbei herstellen. Genau das tut hier die Zeitmaschine: Geprüft wird
 * der Aufräumjob, nicht der Sequenzzähler.
 */
async function altenTombstone(pfad: string, alter_: string): Promise<void> {
  await db.exec('alter table items disable trigger items_seq')

  await db.query(
    `update items set deleted = true, updated_at = now() - $2::interval
      where storage_path = $1`,
    [pfad, alter_],
  )

  await db.exec('alter table items enable trigger items_seq')
}

async function objekte(): Promise<string[]> {
  const { rows } = await db.query<{ name: string }>(
    `select name from storage.objects where bucket_id = 'documents' order by name`,
  )

  return rows.map((zeile) => zeile.name)
}

/**
 * Löscht so, wie die Storage-API es tut: in der Rolle der angemeldeten Person,
 * also unter RLS, aber mit der Erlaubnis, die Zeile überhaupt anzufassen.
 *
 * Beides gehört zusammen. Die Sperre `protect_objects_delete` verhindert, dass
 * jemand die Zeile nimmt und die Bytes liegen lässt; die Policy entscheidet,
 * *wessen* Datei überhaupt verschwinden darf. Nur die zweite Frage steht hier
 * zur Prüfung.
 */
async function alsStorageApi(userId: string, pfad: string): Promise<void> {
  await alsBenutzer(db, userId)(async (fuehreAus) => {
    await fuehreAus(`select set_config('storage.allow_delete_query', 'true', true)`)
    await fuehreAus(`delete from storage.objects where bucket_id = 'documents' and name = $1`, [
      pfad,
    ])
  })
}

/** Was der Aufräumjob als Rückstand meldet. */
async function aufzuraeumen(): Promise<string[]> {
  const { rows } = await db.query<{ dokumente_zum_aufraeumen: string }>(
    'select public.dokumente_zum_aufraeumen()',
  )

  return rows.map((zeile) => zeile.dokumente_zum_aufraeumen)
}

describe('Der Bucket', () => {
  it('ist privat und begrenzt auf 15 MB', async () => {
    const { rows } = await db.query<{ public: boolean; file_size_limit: number }>(
      `select public, file_size_limit from storage.buckets where id = 'documents'`,
    )

    expect(rows[0]?.public).toBe(false)
    expect(Number(rows[0]?.file_size_limit)).toBe(15 * 1024 * 1024)
  })
})

describe('Der Pfad eines Dokuments', () => {
  it('gehört zu genau diesem Item in genau diesem Fall', async () => {
    const fallId = await fallMitMitgliedern(db, ANNA)
    const pfad = await dokumentItem(fallId)

    expect(pfad).toBe(`${fallId}/${pfad.split('/')[1]}`)
  })

  it('lässt sich nicht auf ein fremdes Objekt richten', async () => {
    const fallId = await fallMitMitgliedern(db, ANNA)
    const fremderFall = await fallMitMitgliedern(db, FREMDE)
    const id = uuidv7()

    await expect(
      db.query(
        `insert into items (id, case_id, kind, kid, wrapped_dek, payload, storage_path)
         values ($1, $2, 'file', 'case_test:1', '\\x01', '\\x02', $3)`,
        [id, fallId, `${fremderFall}/${id}`],
      ),
    ).rejects.toThrow(/items_storage_path_gehoert_zum_item/)
  })

  it('fehlt bei einem Dokument nicht', async () => {
    const fallId = await fallMitMitgliedern(db, ANNA)

    await expect(
      db.query(
        `insert into items (id, case_id, kind, kid, wrapped_dek, payload)
         values ($1, $2, 'file', 'case_test:1', '\\x01', '\\x02')`,
        [uuidv7(), fallId],
      ),
    ).rejects.toThrow(/items_storage_path_gehoert_zum_item/)
  })

  it('steht bei einer Aufgabe gar nicht erst da', async () => {
    const fallId = await fallMitMitgliedern(db, ANNA)
    const id = uuidv7()

    await expect(
      db.query(
        `insert into items (id, case_id, kind, kid, wrapped_dek, payload, storage_path)
         values ($1, $2, 'item', 'case_test:1', '\\x01', '\\x02', $3)`,
        [id, fallId, `${fallId}/${id}`],
      ),
    ).rejects.toThrow(/items_storage_path_gehoert_zum_item/)
  })
})

describe('Der Zugriff auf den Ordner eines Falls', () => {
  it('steht jedem Mitglied offen — auch dem, das die Datei nicht hochgeladen hat', async () => {
    const fallId = await fallMitMitgliedern(db, ANNA, BERND)
    const pfad = await dokumentItem(fallId)

    await alsBenutzer(db, ANNA)(async (fuehreAus) => {
      await fuehreAus(
        `insert into storage.objects (bucket_id, name) values ('documents', $1)`,
        [pfad],
      )
    })

    const gesehen = await alsBenutzer(db, BERND)(async (fuehreAus) => {
      const { rows } = await fuehreAus(
        `select name from storage.objects where bucket_id = 'documents' and name = $1`,
        [pfad],
      )

      return rows
    })

    expect(gesehen).toHaveLength(1)
  })

  it('bleibt einem Nichtmitglied verschlossen', async () => {
    const fallId = await fallMitMitgliedern(db, ANNA)
    const pfad = await dokumentItem(fallId)

    await objekt(pfad)

    const gesehen = await alsBenutzer(db, FREMDE)(async (fuehreAus) => {
      const { rows } = await fuehreAus(
        `select name from storage.objects where bucket_id = 'documents' and name = $1`,
        [pfad],
      )

      return rows
    })

    // Kein Fehler, sondern eine leere Menge: Genau so verhält sich RLS, und
    // genau deshalb steht hier eine Zählung und kein `rejects`.
    expect(gesehen).toHaveLength(0)
  })

  it('nimmt von einem Nichtmitglied keine Datei an', async () => {
    const fallId = await fallMitMitgliedern(db, ANNA)
    const pfad = await dokumentItem(fallId)

    await expect(
      alsBenutzer(db, FREMDE)((fuehreAus) =>
        fuehreAus(`insert into storage.objects (bucket_id, name) values ('documents', $1)`, [
          pfad,
        ]),
      ),
    ).rejects.toThrow(/row-level security/)
  })

  it('lässt ein Mitglied seine eigene Datei löschen', async () => {
    const fallId = await fallMitMitgliedern(db, ANNA)
    const pfad = await dokumentItem(fallId)

    await objekt(pfad)
    await alsStorageApi(ANNA, pfad)

    expect(await objekte()).not.toContain(pfad)
  })

  it('lässt ein Nichtmitglied nichts löschen', async () => {
    const fallId = await fallMitMitgliedern(db, ANNA)
    const pfad = await dokumentItem(fallId)

    await objekt(pfad)
    await alsStorageApi(FREMDE, pfad)

    // Kein Fehler, sondern null betroffene Zeilen: So verhält sich RLS.
    expect(await objekte()).toContain(pfad)
  })

  it('lässt niemanden per SQL löschen — auch kein Mitglied', async () => {
    const fallId = await fallMitMitgliedern(db, ANNA)
    const pfad = await dokumentItem(fallId)

    await objekt(pfad)

    // Die Zeile ist der Katalogeintrag, die Bytes liegen im Objektspeicher.
    // Wer nur die Zeile nähme, hinterliesse die Datei — genau das Gegenteil
    // dessen, was §7 verlangt.
    await expect(
      alsBenutzer(db, ANNA)((fuehreAus) =>
        fuehreAus(`delete from storage.objects where name = $1`, [pfad]),
      ),
    ).rejects.toThrow(/Direct deletion from storage tables is not allowed/)

    expect(await objekte()).toContain(pfad)
  })

  it('gilt nur für den eigenen Ordner, nicht für den ganzen Bucket', async () => {
    const meiner = await fallMitMitgliedern(db, ANNA)
    const fremder = await fallMitMitgliedern(db, FREMDE)
    const fremderPfad = await dokumentItem(fremder)

    await objekt(fremderPfad)
    await dokumentItem(meiner)

    const gesehen = await alsBenutzer(db, ANNA)(async (fuehreAus) => {
      const { rows } = await fuehreAus(
        `select name from storage.objects where bucket_id = 'documents' and name = $1`,
        [fremderPfad],
      )

      return rows
    })

    expect(gesehen).toHaveLength(0)
  })
})

describe('Der Aufräumjob', () => {
  it('benennt die Datei eines Items, dessen Tombstone die Karenz überdauert hat', async () => {
    const fallId = await fallMitMitgliedern(db, ANNA)
    const pfad = await dokumentItem(fallId)

    await objekt(pfad, '30 days')
    await altenTombstone(pfad, '8 days')

    expect(await aufzuraeumen()).toContain(pfad)
  })

  it('lässt einen frischen Tombstone in Ruhe — er könnte gerade heruntergeladen werden', async () => {
    const fallId = await fallMitMitgliedern(db, ANNA)
    const pfad = await dokumentItem(fallId)

    await objekt(pfad, '30 days')
    await db.query(`update items set deleted = true where storage_path = $1`, [pfad])

    expect(await aufzuraeumen()).not.toContain(pfad)
  })

  it('rührt ein lebendes Dokument nicht an, so alt es auch ist', async () => {
    const fallId = await fallMitMitgliedern(db, ANNA)
    const pfad = await dokumentItem(fallId)

    await objekt(pfad, '400 days')

    expect(await aufzuraeumen()).not.toContain(pfad)
  })

  it('benennt auch eine Datei, zu der nie ein Item entstanden ist', async () => {
    const fallId = await fallMitMitgliedern(db, ANNA)
    const verwaist = `${fallId}/${uuidv7()}`

    await objekt(verwaist, '8 days')

    expect(await aufzuraeumen()).toContain(verwaist)
  })

  it('lässt einen Upload in Ruhe, dessen Item-Zeile noch unterwegs ist', async () => {
    const fallId = await fallMitMitgliedern(db, ANNA)
    const frisch = `${fallId}/${uuidv7()}`

    await objekt(frisch)

    expect(await aufzuraeumen()).not.toContain(frisch)
  })

  it('nimmt die Karenz als Angabe entgegen, statt sie zu erfinden', async () => {
    const fallId = await fallMitMitgliedern(db, ANNA)
    const pfad = await dokumentItem(fallId)

    await objekt(pfad, '30 days')
    await altenTombstone(pfad, '2 days')

    const { rows } = await db.query<{ dokumente_zum_aufraeumen: string }>(
      `select public.dokumente_zum_aufraeumen('1 day')`,
    )

    expect(rows.map((zeile) => zeile.dokumente_zum_aufraeumen)).toContain(pfad)
    expect(await aufzuraeumen()).not.toContain(pfad)
  })

  it('steht einer angemeldeten Person nicht offen', async () => {
    // Sie läuft an den Policies vorbei und listet die Pfade *aller* Fälle.
    await expect(
      alsBenutzer(db, ANNA)((fuehreAus) => fuehreAus('select public.dokumente_zum_aufraeumen()')),
    ).rejects.toThrow(/permission denied/)
  })
})
