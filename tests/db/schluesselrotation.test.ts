import type { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  alsBenutzer,
  fallMitMitgliedern,
  frischeDatenbank,
  geraeteschluessel,
  vorsorgefall,
} from './postgres'

const ANNA = 'user_anna'
const BERND = 'user_bernd'
const CLARA = 'user_clara'

let db: PGlite

beforeAll(async () => {
  db = await frischeDatenbank()
})

afterAll(async () => {
  await db?.close()
})

describe('Schlüsselrotation und Fall verlassen (§3.4, §4, §7)', () => {
  it('tombstonet private Items, löscht Shares und setzt rotation_pending beim Austritt', async () => {
    const fallId = await fallMitMitgliedern(db, ANNA, BERND)
    const geraetBernd = await geraeteschluessel(db, BERND, 'Gerät Bernd')

    // Personal key wrap für Bernd anlegen
    const kidPrivatBernd = 'personal_bernd_1'
    await db.query(
      `insert into personal_key_wraps (case_id, user_id, kid, device_id, kem_ct, wrapped_key)
       values ($1, $2, $3, $4, '\\x01'::bytea, '\\x02'::bytea)`,
      [fallId, BERND, kidPrivatBernd, geraetBernd],
    )

    // Ein geteiltes Item und ein privates Item für Bernd anlegen
    const idGeteilt = crypto.randomUUID()
    const idPrivat = crypto.randomUUID()

    await db.query(
      `insert into items (id, case_id, kind, kid, wrapped_dek, payload)
       values ($1, $2, 'item', 'case_test:1', '\\x11'::bytea, '\\x22'::bytea)`,
      [idGeteilt, fallId],
    )

    await db.query(
      `insert into items (id, case_id, kind, kid, wrapped_dek, payload)
       values ($1, $2, 'item', $3, '\\x33'::bytea, '\\x44'::bytea)`,
      [idPrivat, fallId, kidPrivatBernd],
    )

    // Bernd verlässt den Fall
    await alsBenutzer(db, BERND)(async (fuehreAus) => {
      await fuehreAus('delete from memberships where case_id = $1', [fallId])
    })

    // 1. Fall steht auf rotation_pending
    const { rows: fallZeilen } = await db.query<{ rotation_pending: boolean }>(
      'select rotation_pending from cases where id = $1',
      [fallId],
    )
    expect(fallZeilen[0]?.rotation_pending).toBe(true)

    // 2. Bernds privates Item ist getombstonet (deleted = true, payload und dek leer)
    const { rows: privatZeilen } = await db.query<{
      deleted: boolean
      payload: Uint8Array
      wrapped_dek: Uint8Array
    }>('select deleted, payload, wrapped_dek from items where id = $1', [idPrivat])

    expect(privatZeilen[0]?.deleted).toBe(true)
    expect(privatZeilen[0]?.payload.length).toBe(0)
    expect(privatZeilen[0]?.wrapped_dek.length).toBe(0)

    // 3. Bernds personal_key_wraps sind gelöscht
    const { rows: wrapZeilen } = await db.query(
      'select 1 from personal_key_wraps where case_id = $1 and user_id = $2',
      [fallId, BERND],
    )
    expect(wrapZeilen.length).toBe(0)

    // 4. Das geteilte Item ist unberührt
    const { rows: geteiltZeilen } = await db.query<{
      deleted: boolean
      payload: Uint8Array
    }>('select deleted, payload from items where id = $1', [idGeteilt])
    expect(geteiltZeilen[0]?.deleted).toBe(false)
    expect(geteiltZeilen[0]?.payload.length).toBeGreaterThan(0)
  })

  it('setzt bei Vorsorgefällen zusätzlich vault_resplit_pending', async () => {
    const fallId = await vorsorgefall(db, ANNA, BERND)

    await alsBenutzer(db, BERND)(async (fuehreAus) => {
      await fuehreAus('delete from memberships where case_id = $1', [fallId])
    })

    const { rows } = await db.query<{ rotation_pending: boolean; vault_resplit_pending: boolean }>(
      'select rotation_pending, vault_resplit_pending from cases where id = $1',
      [fallId],
    )

    expect(rows[0]?.rotation_pending).toBe(true)
    expect(rows[0]?.vault_resplit_pending).toBe(true)
  })

  it('sperrt nach Austritt sofort jeden RLS-Zugriff der ausgetretenen Person', async () => {
    const fallId = await fallMitMitgliedern(db, ANNA, BERND)
    const geraetBernd = await geraeteschluessel(db, BERND, 'Gerät Bernd')

    await alsBenutzer(db, BERND)(async (fuehreAus) => {
      await fuehreAus('delete from memberships where case_id = $1', [fallId])
    })

    await alsBenutzer(db, BERND)(async (fuehreAus) => {
      const { rows: faelle } = await fuehreAus('select * from cases where id = $1', [fallId])
      expect(faelle.length).toBe(0)

      const { rows: items } = await fuehreAus('select * from items where case_id = $1', [fallId])
      expect(items.length).toBe(0)

      const { rows: wraps } = await fuehreAus(
        'select * from key_wraps where case_id = $1 and device_id = $2',
        [fallId, geraetBernd],
      )
      expect(wraps.length).toBe(0)
    })
  })

  it('vergibt Mandat für 2 Minuten und sperrt gleichzeitige Bewerber (claim_rotation)', async () => {
    const fallId = await fallMitMitgliedern(db, ANNA, BERND, CLARA)
    const geraetBernd = await geraeteschluessel(db, BERND, 'Gerät Bernd')
    const geraetClara = await geraeteschluessel(db, CLARA, 'Gerät Clara')

    // Austritt von Anna löst rotation_pending aus
    await alsBenutzer(db, ANNA)(async (fuehreAus) => {
      await fuehreAus('delete from memberships where case_id = $1', [fallId])
    })

    // Bernd holt sich das Mandat
    const mandatBernd = await alsBenutzer(db, BERND)(async (fuehreAus) => {
      const res = await fuehreAus(
        'select claim_rotation($1, 1, $2) as claim_rotation',
        [fallId, geraetBernd],
      )
      const rows = res.rows as { claim_rotation: boolean }[]
      return rows[0]?.claim_rotation
    })
    expect(mandatBernd).toBe(true)

    // Clara versucht gleichzeitig, sich das Mandat zu holen -> schlägt fehl
    const mandatClara = await alsBenutzer(db, CLARA)(async (fuehreAus) => {
      const res = await fuehreAus(
        'select claim_rotation($1, 1, $2) as claim_rotation',
        [fallId, geraetClara],
      )
      const rows = res.rows as { claim_rotation: boolean }[]
      return rows[0]?.claim_rotation
    })
    expect(mandatClara).toBe(false)
  })

  it('lässt nach Ablauf des Mandats ein anderes Mitglied übernehmen', async () => {
    const fallId = await fallMitMitgliedern(db, ANNA, BERND, CLARA)
    const geraetBernd = await geraeteschluessel(db, BERND, 'Gerät Bernd')
    const geraetClara = await geraeteschluessel(db, CLARA, 'Gerät Clara')

    await alsBenutzer(db, ANNA)(async (fuehreAus) => {
      await fuehreAus('delete from memberships where case_id = $1', [fallId])
    })

    // Bernd holt sich das Mandat
    await alsBenutzer(db, BERND)(async (fuehreAus) => {
      await fuehreAus('select claim_rotation($1, 1, $2)', [fallId, geraetBernd])
    })

    // Mandat läuft ab (Simulation über Zeitstempel in DB)
    await db.query(
      "update cases set rotation_claim_expires_at = now() - interval '1 second' where id = $1",
      [fallId],
    )

    // Clara kann nun das Mandat übernehmen
    const mandatClara = await alsBenutzer(db, CLARA)(async (fuehreAus) => {
      const res = await fuehreAus(
        'select claim_rotation($1, 1, $2) as claim_rotation',
        [fallId, geraetClara],
      )
      const rows = res.rows as { claim_rotation: boolean }[]
      return rows[0]?.claim_rotation
    })
    expect(mandatClara).toBe(true)
  })

  it('führt CAS bei commit_rotation durch und weist verspätete Aufrufe ab', async () => {
    const fallId = await fallMitMitgliedern(db, ANNA, BERND, CLARA)
    const geraetBernd = await geraeteschluessel(db, BERND, 'Gerät Bernd')
    const geraetClara = await geraeteschluessel(db, CLARA, 'Gerät Clara')

    await alsBenutzer(db, ANNA)(async (fuehreAus) => {
      await fuehreAus('delete from memberships where case_id = $1', [fallId])
    })

    await alsBenutzer(db, BERND)(async (fuehreAus) => {
      await fuehreAus('select claim_rotation($1, 1, $2)', [fallId, geraetBernd])
    })

    // Bernd committet erfolgreich
    const neuerKid = `case_${fallId}:2`
    const commitBernd = await alsBenutzer(db, BERND)(async (fuehreAus) => {
      const res = await fuehreAus(
        'select commit_rotation($1, 1, $2, $3, $4) as commit_rotation',
        [fallId, neuerKid, geraetBernd, new Uint8Array([0x99])],
      )
      const rows = res.rows as { commit_rotation: boolean }[]
      return rows[0]?.commit_rotation
    })
    expect(commitBernd).toBe(true)

    // Prüfen, dass Generation und Kid aktualisiert wurden und rotation_pending gelöscht ist
    const { rows: fallZeilen } = await db.query<{
      key_generation: number
      current_kid: string
      rotation_pending: boolean
      rotation_claimed_by: string | null
      rotation_claim_expires_at: string | null
      payload: Uint8Array
    }>(
      'select key_generation, current_kid, rotation_pending, rotation_claimed_by, rotation_claim_expires_at, payload from cases where id = $1',
      [fallId],
    )

    expect(fallZeilen[0]).toMatchObject({
      key_generation: 2,
      current_kid: neuerKid,
      rotation_pending: false,
      rotation_claimed_by: null,
      rotation_claim_expires_at: null,
    })
    expect(Array.from(fallZeilen[0]?.payload ?? [])).toEqual([0x99])

    // Verspäteter Commit von Clara für Generation 1 scheitert
    const commitClara = await alsBenutzer(db, CLARA)(async (fuehreAus) => {
      const res = await fuehreAus(
        'select commit_rotation($1, 1, $2, $3, $4) as commit_rotation',
        [fallId, `case_${fallId}:2_clara`, geraetClara, new Uint8Array([0x88])],
      )
      const rows = res.rows as { commit_rotation: boolean }[]
      return rows[0]?.commit_rotation
    })
    expect(commitClara).toBe(false)
  })
})
