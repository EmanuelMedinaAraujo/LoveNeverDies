import type { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { alsBenutzer, frischeDatenbank, geraeteschluessel, type FuehreAus } from './postgres'

/**
 * Der Übergang von `vorsorge` nach `trauerfall` (DESIGN.md §3.5, §4, §8).
 *
 * Zwei Zusagen stehen hier auf dem Prüfstand, und beide sind Zusagen der
 * Datenbank und nicht des Clients:
 *
 * Das Proof-Gate. `open_vault` kippt den Status nur gegen einen Nachweis,
 * der zum `vault_commitment` passt. Ein Zähler von Freigaben löst nichts aus
 * (§3.5). Ein Mitglied kann jederzeit einen korrekt signierten Müll-Share
 * hochladen, und am Ende stünde sonst ein `trauerfall` an einer lebenden
 * Person.
 *
 * Der Weg in `vault_releases`. Er führt ausschließlich über die Edge
 * Function mit Service-Role. Für jede angemeldete Person ist die Tabelle
 * lesbar und für niemanden schreibbar, und der Primärschlüssel
 * `(case_id, user_id)` zählt Personen, keine Geräte.
 */

const ANNA = 'user_anna'
const BERND = 'user_bernd'
const CLARA = 'user_clara'

const COMMITMENT = new Uint8Array(32).fill(0xc0)
const FALSCHER_NACHWEIS = new Uint8Array(32).fill(0xba)

let db: PGlite

beforeAll(async () => {
  db = await frischeDatenbank()
})

afterAll(async () => {
  await db?.close()
})

/** Ein versiegelter Vorsorgefall samt Preparer und Angehörigen, an der RLS vorbei. */
async function versiegelterFall(preparer: string, ...angehoerige: string[]): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `insert into cases (status, current_kid, payload, preparer_id, vault_commitment, vault_n, vault_k)
     values ('vorsorge', 'case_test:1', '\\xaa', $1, $2, $3, $4)
     returning id`,
    [preparer, COMMITMENT, angehoerige.length, Math.max(1, Math.ceil((2 * angehoerige.length) / 3))],
  )

  const fallId = rows[0]?.id
  if (fallId === undefined) {
    throw new Error('Der versiegelte Testfall wurde nicht angelegt.')
  }

  for (const userId of [preparer, ...angehoerige]) {
    await db.query('insert into memberships (case_id, user_id) values ($1, $2)', [fallId, userId])
  }

  return fallId
}

/** Eine Freigabe dieser Person, an der Edge Function vorbei eingetragen. */
async function freigabeVon(fallId: string, userId: string): Promise<void> {
  const geraet = await geraeteschluessel(db, userId, `Gerät von ${userId}`)

  await db.query(
    `insert into vault_releases (case_id, user_id, signed_by_device, kid, released_share, signature)
     values ($1, $2, $3, 'case_test:1', '\x11', '\x22')
     on conflict (case_id, user_id) do nothing`,
    [fallId, userId, geraet],
  )
}

function oeffne(
  fuehreAus: FuehreAus,
  fallId: string,
  nachweis: Uint8Array = COMMITMENT,
  katalogVersion = '2026-08+testtest',
  payload: Uint8Array | null = null,
) {
  return fuehreAus('select open_vault($1, $2, $3, $4) as version', [
    fallId,
    nachweis,
    katalogVersion,
    payload,
  ])
}

async function fallstand(fallId: string) {
  const { rows } = await db.query<{
    status: string
    catalog_version: string | null
    payload: Uint8Array
    vault_resplit_pending: boolean
    version: string | number
  }>(
    'select status, catalog_version, payload, vault_resplit_pending, version from cases where id = $1',
    [fallId],
  )

  return rows[0]
}

describe('open_vault: das Proof-Gate (§3.5, §8)', () => {
  it('weist einen falschen Nachweis ab und lässt den Fall in vorsorge', async () => {
    const fallId = await versiegelterFall(ANNA, BERND)

    await expect(
      alsBenutzer(db, BERND)((fuehreAus) => oeffne(fuehreAus, fallId, FALSCHER_NACHWEIS)),
    ).rejects.toThrow(/Nachweis/i)

    expect(await fallstand(fallId)).toMatchObject({ status: 'vorsorge', catalog_version: null })
  })

  it('öffnet mit dem richtigen Nachweis und gibt die Katalogversion zurück', async () => {
    const fallId = await versiegelterFall(ANNA, BERND)
    await freigabeVon(fallId, BERND)

    const { rows } = await alsBenutzer(db, BERND)((fuehreAus) =>
      oeffne(fuehreAus, fallId, COMMITMENT, '2026-08+testtest', new Uint8Array([0xbe, 0xef])),
    )

    expect(rows[0]).toEqual({ version: '2026-08+testtest' })

    const stand = await fallstand(fallId)
    expect(stand).toMatchObject({
      status: 'trauerfall',
      catalog_version: '2026-08+testtest',
      vault_resplit_pending: false,
    })
    expect(Array.from(stand?.payload ?? [])).toEqual([0xbe, 0xef])
  })

  it('ist beim zweiten Aufruf folgenlos idempotent und gibt die gültige Version zurück', async () => {
    const fallId = await versiegelterFall(ANNA, BERND, CLARA)
    await freigabeVon(fallId, BERND)
    await freigabeVon(fallId, CLARA)

    await alsBenutzer(db, BERND)((fuehreAus) =>
      oeffne(fuehreAus, fallId, COMMITMENT, '2026-08+erster00', new Uint8Array([0x01])),
    )

    // Der zweite Client steht auf einem anderen App-Stand. Er bekommt die
    // Version des schnelleren zurück und schreibt seine eigene nicht hinein
    // (§3.5, §8).
    const { rows } = await alsBenutzer(db, CLARA)((fuehreAus) =>
      oeffne(fuehreAus, fallId, COMMITMENT, '2031-01+zweiter0', new Uint8Array([0x02])),
    )

    expect(rows[0]).toEqual({ version: '2026-08+erster00' })

    const stand = await fallstand(fallId)
    expect(stand?.catalog_version).toBe('2026-08+erster00')
    expect(Array.from(stand?.payload ?? [])).toEqual([0x01])
  })

  it('weist eine Person ab, die nicht Mitglied des Falls ist', async () => {
    const fallId = await versiegelterFall(ANNA, BERND)

    await expect(
      alsBenutzer(db, CLARA)((fuehreAus) => oeffne(fuehreAus, fallId)),
    ).rejects.toThrow(/Mitglied/i)

    expect(await fallstand(fallId)).toMatchObject({ status: 'vorsorge' })
  })

  it('hebt den Sync-Zähler des Falls nicht an', async () => {
    const fallId = await versiegelterFall(ANNA, BERND)
    await freigabeVon(fallId, BERND)
    const vorher = Number((await fallstand(fallId))?.version)

    await alsBenutzer(db, BERND)((fuehreAus) => oeffne(fuehreAus, fallId))

    // `cases.version` ist das Wasserzeichen des Delta-Sync (§5). Ein Sprung
    // ohne neue Zeile in `items` liesse jeden Client bei jeder Runde erneut
    // ein leeres Delta holen.
    expect(Number((await fallstand(fallId))?.version)).toBe(vorher)
  })

  it('weist einen abgeschriebenen Nachweis ab, solange keine Freigabe vorliegt', async () => {
    // `proof` ist `vault_commitment`, und die Spalte steht jedem Mitglied
    // offen. Ohne den Boden genügte Abschreiben, um einen Fall an einer
    // lebenden Person in den Trauerfall zu kippen (§3.5).
    const fallId = await versiegelterFall(ANNA, BERND)

    await expect(
      alsBenutzer(db, BERND)((fuehreAus) => oeffne(fuehreAus, fallId, COMMITMENT)),
    ).rejects.toThrow(/Freigaben/i)

    expect(await fallstand(fallId)).toMatchObject({ status: 'vorsorge' })
  })

  it('weist ab, solange die Schwelle k nicht erreicht ist', async () => {
    const fallId = await versiegelterFall(ANNA, BERND, CLARA, 'user_doris')
    await freigabeVon(fallId, BERND)

    // n = 3 ergibt k = 2 (§3.5). Eine Freigabe reicht nicht.
    await expect(
      alsBenutzer(db, BERND)((fuehreAus) => oeffne(fuehreAus, fallId, COMMITMENT)),
    ).rejects.toThrow(/Freigaben/i)

    await freigabeVon(fallId, CLARA)

    await alsBenutzer(db, BERND)((fuehreAus) => oeffne(fuehreAus, fallId, COMMITMENT))

    expect(await fallstand(fallId)).toMatchObject({ status: 'trauerfall' })
  })

  it('weist einen Fall ohne versiegelten Tresor ab', async () => {
    const { rows } = await db.query<{ id: string }>(
      `insert into cases (status, current_kid, payload, preparer_id)
       values ('vorsorge', 'case_test:1', '\\xaa', $1) returning id`,
      [ANNA],
    )
    const fallId = rows[0]?.id ?? ''
    await db.query('insert into memberships (case_id, user_id) values ($1, $2)', [fallId, BERND])

    await expect(
      alsBenutzer(db, BERND)((fuehreAus) => oeffne(fuehreAus, fallId)),
    ).rejects.toThrow(/Tresor/i)
  })

  it('weist einen leeren Katalogstand ab', async () => {
    const fallId = await versiegelterFall(ANNA, BERND)
    await freigabeVon(fallId, BERND)

    await expect(
      alsBenutzer(db, BERND)((fuehreAus) => oeffne(fuehreAus, fallId, COMMITMENT, '  ')),
    ).rejects.toThrow(/Katalogstand/i)
  })
})

describe('vault_releases: der Weg hinein (§3.5, §4)', () => {
  it('lässt kein direktes INSERT zu, für niemanden', async () => {
    const fallId = await versiegelterFall(ANNA, BERND)
    const geraet = await geraeteschluessel(db, BERND)

    await expect(
      alsBenutzer(db, BERND)((fuehreAus) =>
        fuehreAus(
          `insert into vault_releases (case_id, user_id, signed_by_device, kid, released_share, signature)
           values ($1, $2, $3, 'case_test:1', '\\x11', '\\x22')`,
          [fallId, BERND, geraet],
        ),
      ),
    ).rejects.toThrow()

    const { rows } = await db.query('select 1 from vault_releases where case_id = $1', [fallId])
    expect(rows).toHaveLength(0)
  })

  it('hat keine Policy für insert, update oder delete', async () => {
    const { rows } = await db.query<{ cmd: string }>(
      "select cmd from pg_policies where tablename = 'vault_releases'",
    )

    expect(rows.map((zeile) => zeile.cmd)).toEqual(['SELECT'])
  })

  it('ist für die Service-Role schreibbar und ersetzt die Zeile derselben Person', async () => {
    const fallId = await versiegelterFall(ANNA, BERND)
    const erstesGeraet = await geraeteschluessel(db, BERND, 'iPhone')
    const zweitesGeraet = await geraeteschluessel(db, BERND, 'iPad')

    // Zwei Freigaben derselben Person von zwei Geräten: eine Zeile, und die
    // zweite ersetzt die erste (`do update`, nicht `do nothing`).
    for (const [geraet, share] of [
      [erstesGeraet, new Uint8Array([0x11])],
      [zweitesGeraet, new Uint8Array([0x33])],
    ] as const) {
      await db.transaction(async (tx) => {
        await tx.exec('set local role service_role')
        await tx.query(
          `insert into vault_releases (case_id, user_id, signed_by_device, kid, released_share, signature)
           values ($1, $2, $3, 'case_test:1', $4::bytea, '\\x22'::bytea)
           on conflict (case_id, user_id) do update
             set signed_by_device = excluded.signed_by_device,
                 kid              = excluded.kid,
                 released_share   = excluded.released_share,
                 signature        = excluded.signature,
                 released_at      = now()`,
          [fallId, BERND, geraet, share],
        )
      })
    }

    const { rows } = await db.query<{ signed_by_device: string; released_share: Uint8Array }>(
      'select signed_by_device, released_share from vault_releases where case_id = $1',
      [fallId],
    )

    expect(rows).toHaveLength(1)
    expect(rows[0]?.signed_by_device).toBe(zweitesGeraet)
    expect(Array.from(rows[0]?.released_share ?? [])).toEqual([0x33])
  })

  it('ist für jedes Mitglied des Falls lesbar', async () => {
    const fallId = await versiegelterFall(ANNA, BERND, CLARA)
    const geraet = await geraeteschluessel(db, BERND)

    await db.query(
      `insert into vault_releases (case_id, user_id, signed_by_device, kid, released_share, signature)
       values ($1, $2, $3, 'case_test:1', '\\x11', '\\x22')`,
      [fallId, BERND, geraet],
    )

    const { rows } = await alsBenutzer(db, CLARA)((fuehreAus) =>
      fuehreAus('select user_id from vault_releases where case_id = $1', [fallId]),
    )

    expect(rows).toEqual([{ user_id: BERND }])
  })
})

describe('angemeldete_kennung (§3.5, §9)', () => {
  it('gibt den sub aus dem geprüften Token zurück', async () => {
    const { rows } = await alsBenutzer(db, BERND)((fuehreAus) =>
      fuehreAus('select angemeldete_kennung() as kennung'),
    )

    expect(rows[0]).toEqual({ kennung: BERND })
  })
})

describe('uebergib_tresoranteil: Gerätewechsel vor dem Öffnen (§3.5)', () => {
  /** Legt den Share einer Person auf einem Gerät an, an der RLS vorbei. */
  async function share(fallId: string, userId: string, geraet: string) {
    await db.query(
      `insert into vault_shares (case_id, user_id, device_id, share_index, share_hash, kem_ct, wrapped_share)
       values ($1, $2, $3, 7, $4, '\x01', '\x02')`,
      [fallId, userId, geraet, new Uint8Array([0xab])],
    )
  }

  function uebergib(fuehreAus: FuehreAus, fallId: string, geraet: string) {
    return fuehreAus('select uebergib_tresoranteil($1, $2, $3, $4)', [
      fallId,
      geraet,
      new Uint8Array([0x11]),
      new Uint8Array([0x22]),
    ])
  }

  it('wrappt den eigenen Anteil an das eigene neue Gerät, ohne den Preparer', async () => {
    const fallId = await versiegelterFall(ANNA, BERND)
    const altes = await geraeteschluessel(db, BERND, 'altes iPhone')
    const neues = await geraeteschluessel(db, BERND, 'neues iPhone')
    await share(fallId, BERND, altes)

    await alsBenutzer(db, BERND)((fuehreAus) => uebergib(fuehreAus, fallId, neues))

    const { rows } = await db.query<{
      user_id: string
      share_index: number
      share_hash: Uint8Array
      wrapped_share: Uint8Array
    }>(
      'select user_id, share_index, share_hash, wrapped_share from vault_shares where case_id = $1 and device_id = $2',
      [fallId, neues],
    )

    expect(rows).toHaveLength(1)
    expect(rows[0]?.user_id).toBe(BERND)
    // Stelle und Hash kommen aus der bestehenden Zeile und nicht vom Client:
    // Sonst schöbe jemand einen erfundenen Anteil samt passendem Hash unter.
    expect(rows[0]?.share_index).toBe(7)
    expect(Array.from(rows[0]?.share_hash ?? [])).toEqual([0xab])
    expect(Array.from(rows[0]?.wrapped_share ?? [])).toEqual([0x22])
  })

  it('lässt den alten Anteil stehen, bis der Preparer neu verteilt', async () => {
    const fallId = await versiegelterFall(ANNA, BERND)
    const altes = await geraeteschluessel(db, BERND, 'altes iPhone')
    const neues = await geraeteschluessel(db, BERND, 'neues iPhone')
    await share(fallId, BERND, altes)

    await alsBenutzer(db, BERND)((fuehreAus) => uebergib(fuehreAus, fallId, neues))

    const { rows } = await db.query('select 1 from vault_shares where case_id = $1', [fallId])
    expect(rows).toHaveLength(2)
  })

  it('weist ein Gerät ab, das einer anderen Person gehört', async () => {
    const fallId = await versiegelterFall(ANNA, BERND, CLARA)
    const berndsGeraet = await geraeteschluessel(db, BERND)
    const clarasGeraet = await geraeteschluessel(db, CLARA)
    await share(fallId, BERND, berndsGeraet)

    await expect(
      alsBenutzer(db, BERND)((fuehreAus) => uebergib(fuehreAus, fallId, clarasGeraet)),
    ).rejects.toThrow(/Gerät/i)
  })

  it('weist ab, wer selbst keinen Anteil hält', async () => {
    const fallId = await versiegelterFall(ANNA, BERND, CLARA)
    const clarasGeraet = await geraeteschluessel(db, CLARA)

    await expect(
      alsBenutzer(db, CLARA)((fuehreAus) => uebergib(fuehreAus, fallId, clarasGeraet)),
    ).rejects.toThrow(/Anteil/i)
  })

  it('ersetzt einen bereits übergebenen Anteil, statt zu scheitern', async () => {
    const fallId = await versiegelterFall(ANNA, BERND)
    const altes = await geraeteschluessel(db, BERND, 'altes iPhone')
    const neues = await geraeteschluessel(db, BERND, 'neues iPhone')
    await share(fallId, BERND, altes)

    await alsBenutzer(db, BERND)((fuehreAus) => uebergib(fuehreAus, fallId, neues))
    await alsBenutzer(db, BERND)((fuehreAus) => uebergib(fuehreAus, fallId, neues))

    const { rows } = await db.query('select 1 from vault_shares where case_id = $1', [fallId])
    expect(rows).toHaveLength(2)
  })
})

