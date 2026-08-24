import type { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  alsBenutzer,
  frischeDatenbank,
  geraeteschluessel,
  type FuehreAus,
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

function kidFall(fallId: string): string {
  return `case_${fallId}:1`
}

function kidKatalog(fallId: string): string {
  return `cat_${fallId}`
}

function fallId(): string {
  return crypto.randomUUID()
}

/** Ruft `lege_vorsorgefall_an` auf */
function legeVorsorgeAn(
  fuehreAus: FuehreAus,
  id: string,
  geraet: string,
  commitment: Uint8Array = new Uint8Array([0xcc, 0xdd]),
) {
  return fuehreAus(
    `select lege_vorsorgefall_an(
       $1, $2, $3, $4, $5,
       '\\x01'::bytea, '\\x02'::bytea, '\\x03'::bytea,
       '\\x04'::bytea, '\\x05'::bytea, '\\x06'::bytea,
       $6, '\\x07'::bytea, '\\x08'::bytea
     ) as id`,
    [
      id,
      kidFall(id),
      kidKatalog(id),
      new Uint8Array([0xaa, 0xbb]),
      geraet,
      commitment,
    ],
  )
}

describe('lege_vorsorgefall_an (§2, §3.5, §4)', () => {
  it('legt Fall in vorsorge an, ohne Aufgaben und mit catalog_version = NULL', async () => {
    const geraet = await geraeteschluessel(db, ANNA, 'iPhone von Anna')
    const id = fallId()

    await alsBenutzer(db, ANNA)((fuehreAus) => legeVorsorgeAn(fuehreAus, id, geraet))

    const { rows: faelle } = await db.query<{
      status: string
      current_kid: string
      catalog_version: string | null
      preparer_id: string
      vault_commitment: Uint8Array
      vault_n: number
      vault_k: number | null
      vault_resplit_pending: boolean
    }>(
      'select status, current_kid, catalog_version, preparer_id, vault_commitment, vault_n, vault_k, vault_resplit_pending from cases where id = $1',
      [id],
    )

    expect(faelle[0]).toMatchObject({
      status: 'vorsorge',
      current_kid: kidFall(id),
      catalog_version: null,
      preparer_id: ANNA,
      vault_n: 0,
      vault_k: null,
      vault_resplit_pending: false,
    })
    expect(Array.from(faelle[0]?.vault_commitment ?? [])).toEqual([0xcc, 0xdd])

    const { rows: mitglieder } = await db.query<{ user_id: string }>(
      'select user_id from memberships where case_id = $1',
      [id],
    )
    expect(mitglieder.map((z) => z.user_id)).toEqual([ANNA])

    const { rows: vaultWraps } = await db.query<{ device_id: string; wrapped_key: Uint8Array }>(
      'select device_id, wrapped_key from vault_key_wraps where case_id = $1',
      [id],
    )
    expect(vaultWraps).toHaveLength(1)
    expect(vaultWraps[0]?.device_id).toBe(geraet)
  })
})

describe('RLS auf vault_key_wraps (§3.5, §4)', () => {
  it('ist für den Preparer lesbar', async () => {
    const geraet = await geraeteschluessel(db, ANNA)
    const id = fallId()
    await alsBenutzer(db, ANNA)((fuehreAus) => legeVorsorgeAn(fuehreAus, id, geraet))

    const rows = await alsBenutzer(db, ANNA)(async (fuehreAus) => {
      const { rows } = await fuehreAus(
        'select device_id from vault_key_wraps where case_id = $1',
        [id],
      )
      return rows
    })

    expect(rows).toHaveLength(1)
  })

  it('ist für Nicht-Preparer unsichtbar, auch wenn sie Mitglied im Fall sind', async () => {
    const annasGeraet = await geraeteschluessel(db, ANNA)
    const id = fallId()
    await alsBenutzer(db, ANNA)((fuehreAus) => legeVorsorgeAn(fuehreAus, id, annasGeraet))

    // Bernd tritt bei
    await db.query('insert into memberships (case_id, user_id) values ($1, $2)', [id, BERND])

    const rows = await alsBenutzer(db, BERND)(async (fuehreAus) => {
      const { rows } = await fuehreAus(
        'select device_id from vault_key_wraps where case_id = $1',
        [id],
      )
      return rows
    })

    expect(rows).toEqual([])
  })
})

describe('resplit_vault RPC (§3.5, §4)', () => {
  it('verteilt Shares und löscht alte Shares und Freigaben transaktional', async () => {
    const annasGeraet = await geraeteschluessel(db, ANNA)
    const berndsGeraet = await geraeteschluessel(db, BERND)
    const clarasGeraet = await geraeteschluessel(db, CLARA)
    const id = fallId()

    await alsBenutzer(db, ANNA)((fuehreAus) => legeVorsorgeAn(fuehreAus, id, annasGeraet))
    await db.query('insert into memberships (case_id, user_id) values ($1, $2), ($1, $3)', [
      id,
      BERND,
      CLARA,
    ])

    // Alte Releases und Shares simulieren
    await db.query(
      `insert into vault_releases (case_id, user_id, signed_by_device, released_share, signature)
       values ($1, $2, $3, '\\x11', '\\x22')`,
      [id, BERND, berndsGeraet],
    )

    // Resplit als Anna ausführen (n=2, k=2)
    await alsBenutzer(db, ANNA)(async (fuehreAus) => {
      await fuehreAus(
        `select resplit_vault(
           $1, 2, 2,
           array[
             row($2, $3::uuid, 1, '\\xaa'::bytea, '\\x01'::bytea, '\\x02'::bytea)::public.resplit_share_input,
             row($4, $5::uuid, 2, '\\xbb'::bytea, '\\x03'::bytea, '\\x04'::bytea)::public.resplit_share_input
           ]
         )`,
        [id, BERND, berndsGeraet, CLARA, clarasGeraet],
      )
    })

    // vault_releases muss leer sein
    const { rows: releases } = await db.query(
      'select * from vault_releases where case_id = $1',
      [id],
    )
    expect(releases).toHaveLength(0)

    // vault_shares muss 2 Zeilen haben
    const { rows: shares } = await db.query<{
      user_id: string
      device_id: string
      share_index: number
      share_hash: Uint8Array
    }>('select user_id, device_id, share_index, share_hash from vault_shares where case_id = $1 order by share_index', [
      id,
    ])
    expect(shares).toHaveLength(2)
    expect(shares[0]?.user_id).toBe(BERND)
    expect(shares[1]?.user_id).toBe(CLARA)

    // cases muss aktualisiert sein
    const { rows: faelle } = await db.query<{
      vault_n: number
      vault_k: number
      vault_resplit_pending: boolean
    }>('select vault_n, vault_k, vault_resplit_pending from cases where id = $1', [id])
    expect(faelle[0]).toMatchObject({
      vault_n: 2,
      vault_k: 2,
      vault_resplit_pending: false,
    })
  })

  it('weist den Aufruf ab, wenn er nicht vom Preparer stammt', async () => {
    const annasGeraet = await geraeteschluessel(db, ANNA)
    const berndsGeraet = await geraeteschluessel(db, BERND)
    const id = fallId()

    await alsBenutzer(db, ANNA)((fuehreAus) => legeVorsorgeAn(fuehreAus, id, annasGeraet))
    await db.query('insert into memberships (case_id, user_id) values ($1, $2)', [id, BERND])

    await expect(
      alsBenutzer(db, BERND)((fuehreAus) =>
        fuehreAus(
          `select resplit_vault(
             $1, 1, 1,
             array[row($2, $3::uuid, 1, '\\xaa'::bytea, '\\x01'::bytea, '\\x02'::bytea)::public.resplit_share_input]
           )`,
          [id, BERND, berndsGeraet],
        ),
      ),
    ).rejects.toThrow(/Nur der Preparer/i)
  })
})

describe('Mitgliederänderungen und Preparer-Sperre (§3.5, §4)', () => {
  it('setzt vault_resplit_pending bei Beitritt eines Angehörigen', async () => {
    const annasGeraet = await geraeteschluessel(db, ANNA)
    const id = fallId()
    await alsBenutzer(db, ANNA)((fuehreAus) => legeVorsorgeAn(fuehreAus, id, annasGeraet))

    // Bernd tritt bei
    await db.query('insert into memberships (case_id, user_id) values ($1, $2)', [id, BERND])

    const { rows } = await db.query<{ vault_resplit_pending: boolean }>(
      'select vault_resplit_pending from cases where id = $1',
      [id],
    )
    expect(rows[0]?.vault_resplit_pending).toBe(true)
  })

  it('weist den Austritt des Preparers aus einem versiegelten Fall ab', async () => {
    const annasGeraet = await geraeteschluessel(db, ANNA)
    const id = fallId()
    await alsBenutzer(db, ANNA)((fuehreAus) => legeVorsorgeAn(fuehreAus, id, annasGeraet))

    await expect(
      alsBenutzer(db, ANNA)((fuehreAus) =>
        fuehreAus('delete from memberships where case_id = $1 and user_id = $2', [id, ANNA]),
      ),
    ).rejects.toThrow(/Preparer eines versiegelten Falls kann die Mitgliedschaft nicht verlassen/i)
  })

  it('löscht beim Austritt eines Angehörigen dessen Shares und setzt vault_resplit_pending', async () => {
    const annasGeraet = await geraeteschluessel(db, ANNA)
    const berndsGeraet = await geraeteschluessel(db, BERND)
    const id = fallId()
    await alsBenutzer(db, ANNA)((fuehreAus) => legeVorsorgeAn(fuehreAus, id, annasGeraet))
    await db.query('insert into memberships (case_id, user_id) values ($1, $2)', [id, BERND])

    // Resplit
    await alsBenutzer(db, ANNA)((fuehreAus) =>
      fuehreAus(
        `select resplit_vault(
           $1, 1, 1,
           array[row($2, $3::uuid, 1, '\\xaa'::bytea, '\\x01'::bytea, '\\x02'::bytea)::public.resplit_share_input]
         )`,
        [id, BERND, berndsGeraet],
      ),
    )

    // Bernd verlässt den Fall
    await alsBenutzer(db, BERND)((fuehreAus) =>
      fuehreAus('delete from memberships where case_id = $1 and user_id = $2', [id, BERND]),
    )

    const { rows: shares } = await db.query(
      'select * from vault_shares where case_id = $1 and user_id = $2',
      [id, BERND],
    )
    expect(shares).toHaveLength(0)

    const { rows: faelle } = await db.query<{ vault_resplit_pending: boolean }>(
      'select vault_resplit_pending from cases where id = $1',
      [id],
    )
    expect(faelle[0]?.vault_resplit_pending).toBe(true)
  })

  it('erlaubt dem Preparer das kaskadierende Löschen des gesamten Falls', async () => {
    const annasGeraet = await geraeteschluessel(db, ANNA)
    const id = fallId()
    await alsBenutzer(db, ANNA)((fuehreAus) => legeVorsorgeAn(fuehreAus, id, annasGeraet))
    await db.query('insert into memberships (case_id, user_id) values ($1, $2)', [id, BERND])

    // Fall löschen als Anna
    await alsBenutzer(db, ANNA)(async (fuehreAus) => {
      const { rows } = await fuehreAus('delete from cases where id = $1 returning id', [id])
      expect(rows).toHaveLength(1)
    })

    // Überprüfen, dass alles kaskadierend weg ist
    const { rows: faelle } = await db.query('select * from cases where id = $1', [id])
    expect(faelle).toHaveLength(0)

    const { rows: mitglieder } = await db.query('select * from memberships where case_id = $1', [id])
    expect(mitglieder).toHaveLength(0)

    const { rows: vaultWraps } = await db.query('select * from vault_key_wraps where case_id = $1', [
      id,
    ])
    expect(vaultWraps).toHaveLength(0)
  })
})
