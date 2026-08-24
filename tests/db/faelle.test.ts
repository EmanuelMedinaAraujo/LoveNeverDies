import type { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  alsBenutzer,
  fallMitMitgliedern,
  frischeDatenbank,
  geraeteschluessel,
  type FuehreAus,
} from './postgres'

/**
 * Nahtstelle: Fallanlage, `key_wraps` und ihre RLS (DESIGN.md §3.6, §4).
 *
 * Hier hängt mehr als Sichtbarkeit dran. `key_wraps` ist insert-only, weil ein
 * überschriebener Wrap ein Gerät dauerhaft aussperrt; DELETE gibt es
 * ausschließlich für den Besitzer des betroffenen Geräts, damit er einen
 * fehlerhaften Wrap verwerfen und sich einen korrekten nachliefern lassen kann.
 * Beides ist eine Behauptung über die Datenbank, also wird sie hier gegen
 * echtes Postgres ausgeführt.
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

function kidFall(fallId: string): string {
  return `case_${fallId}:1`
}

function kidKatalog(fallId: string): string {
  return `cat_${fallId}`
}

/** Ruft `lege_trauerfall_an` mit lauter erkennbaren Platzhalter-Bytes. */
function legeAn(
  fuehreAus: FuehreAus,
  fallId: string,
  geraet: string,
  abweichung: { kidFall?: string; kidKatalog?: string; katalogVersion?: string } = {},
) {
  return fuehreAus(
    `select lege_trauerfall_an(
       $1, $2, $3, $4, $5, $6,
       '\\x01'::bytea, '\\x02'::bytea, '\\x03'::bytea,
       '\\x04'::bytea, '\\x05'::bytea, '\\x06'::bytea) as id`,
    [
      fallId,
      abweichung.kidFall ?? kidFall(fallId),
      abweichung.kidKatalog ?? kidKatalog(fallId),
      new Uint8Array([0xaa, 0xbb]),
      abweichung.katalogVersion ?? KATALOGSTAND,
      geraet,
    ],
  )
}

/** Der Katalogstand, mit dem die Testfälle eingefroren werden (§8). */
const KATALOGSTAND = '2026-08+testtest'

/** Eine neue UUID, ohne Runde über die Datenbank. */
function fallId(): string {
  return crypto.randomUUID()
}

/**
 * Läuft als `authenticated`, aber ohne `sub` im Token: der Zustand, den ein
 * abgelaufenes oder fehlendes Clerk-Token erzeugt.
 */
function ohneAnmeldung<T>(arbeit: (fuehreAus: FuehreAus) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.exec('set local role authenticated')

    return arbeit((sql, parameter = []) => tx.query(sql, parameter))
  }) as Promise<T>
}

describe('Katalogstand (§8)', () => {
  it('friert den Katalogstand bei der Anlage ein', async () => {
    // §8: Eingefroren wird beim Übergang nach `trauerfall`. Ein direkt dort
    // angelegter Fall friert sofort ein, nach derselben Regel.
    const geraet = await geraeteschluessel(db, ANNA)
    const id = fallId()

    await alsBenutzer(db, ANNA)((fuehreAus) => legeAn(fuehreAus, id, geraet))

    const { rows } = await db.query<{ catalog_version: string }>(
      'select catalog_version from cases where id = $1',
      [id],
    )

    expect(rows[0]?.catalog_version).toBe(KATALOGSTAND)
  })

  it('legt keinen Fall ohne Katalogstand an', async () => {
    const geraet = await geraeteschluessel(db, ANNA)

    await expect(
      alsBenutzer(db, ANNA)((fuehreAus) =>
        legeAn(fuehreAus, fallId(), geraet, { katalogVersion: '   ' }),
      ),
    ).rejects.toThrow(/Katalogstand/)
  })

  it('weist einen Trauerfall ohne Katalogstand auch an der RLS vorbei ab', async () => {
    // Der CHECK und nicht die Funktion trägt die Regel: Der zweite Weg in den
    // Status `trauerfall`, der Übergang aus der Vorsorge, ist noch nicht
    // geschrieben, und er soll sie nicht neu erfinden müssen.
    await expect(
      db.query(
        `insert into cases (status, current_kid, payload)
         values ('trauerfall', 'case_test:1', '\\x00')`,
      ),
    ).rejects.toThrow(/cases_trauerfall_hat_katalogstand/)
  })

  it('lässt einen Vorsorgefall ohne Katalogstand zu', async () => {
    // §8: Bis zum Übergang bleibt `catalog_version` NULL. Ein 2026 angelegter
    // Vorsorgefall instanziierte sonst 2031 das Recht von 2026.
    await expect(
      db.query(
        `insert into cases (status, current_kid, payload)
         values ('vorsorge', 'case_test:1', '\\x00')`,
      ),
    ).resolves.toBeDefined()
  })
})

describe('lege_trauerfall_an (§2, §4)', () => {
  it('legt Fall, Mitgliedschaft und beide Wraps in einem Zug an', async () => {
    const geraet = await geraeteschluessel(db, ANNA, 'iPhone von Anna')
    const id = fallId()

    await alsBenutzer(db, ANNA)((fuehreAus) => legeAn(fuehreAus, id, geraet))

    const { rows: faelle } = await db.query<{
      status: string
      current_kid: string
      key_generation: number
      payload: Uint8Array
    }>('select status, current_kid, key_generation, payload from cases where id = $1', [id])

    expect(faelle[0]).toMatchObject({
      status: 'trauerfall',
      current_kid: kidFall(id),
      key_generation: 1,
    })

    const { rows: mitglieder } = await db.query<{ user_id: string }>(
      'select user_id from memberships where case_id = $1',
      [id],
    )
    expect(mitglieder.map((zeile) => zeile.user_id)).toEqual([ANNA])

    const { rows: wraps } = await db.query<{ kid: string; wrapped_by: string }>(
      'select kid, wrapped_by from key_wraps where case_id = $1 order by kid',
      [id],
    )
    expect(wraps).toEqual([
      { kid: kidFall(id), wrapped_by: geraet },
      { kid: kidKatalog(id), wrapped_by: geraet },
    ])
  })

  it('legt den Fall unverschlüsselt gar nicht erst an', async () => {
    // Der Payload ist eine bytea-Spalte und trägt den Envelope aus §3.2. Hier
    // steht nur, dass die Funktion nichts hinzuerfindet: Was hineingereicht
    // wurde, steht drin, und der Name der Person kommt in keiner Klartextspalte
    // vor.
    const geraet = await geraeteschluessel(db, ANNA)
    const id = fallId()

    await alsBenutzer(db, ANNA)((fuehreAus) => legeAn(fuehreAus, id, geraet))

    const { rows } = await db.query<{ payload: Uint8Array }>(
      'select payload from cases where id = $1',
      [id],
    )

    expect(Array.from(rows[0]?.payload ?? [])).toEqual([0xaa, 0xbb])
  })

  it('weist ein Gerät ab, das einer anderen Person gehört', async () => {
    // Sonst schriebe Anna einen Wrap, den nur Bernds Gerät entpacken kann, und
    // ihr eigener Fall wäre für sie selbst unlesbar.
    const berndsGeraet = await geraeteschluessel(db, BERND)
    const id = fallId()

    await expect(
      alsBenutzer(db, ANNA)((fuehreAus) => legeAn(fuehreAus, id, berndsGeraet)),
    ).rejects.toThrow(/Gerät/i)

    const { rows } = await db.query('select 1 from cases where id = $1', [id])
    expect(rows).toEqual([])
  })

  it('weist ein kid ab, das nicht zum Fall gehört', async () => {
    // Das `kid` steht in der Wrap-Signatur (§3.2). Ein Fall mit einem `kid`,
    // das niemand aus der `case_id` herleiten kann, wäre für jedes zweite Gerät
    // unauffindbar.
    const geraet = await geraeteschluessel(db, ANNA)
    const id = fallId()

    await expect(
      alsBenutzer(db, ANNA)((fuehreAus) =>
        legeAn(fuehreAus, id, geraet, { kidFall: `case_${fallId()}:1` }),
      ),
    ).rejects.toThrow(/kid/i)

    await expect(
      alsBenutzer(db, ANNA)((fuehreAus) => legeAn(fuehreAus, id, geraet, { kidKatalog: 'cat_x' })),
    ).rejects.toThrow(/kid/i)
  })

  it('legt ohne Anmeldung nichts an', async () => {
    const geraet = await geraeteschluessel(db, ANNA)
    const id = fallId()

    await expect(ohneAnmeldung((fuehreAus) => legeAn(fuehreAus, id, geraet))).rejects.toThrow()

    const { rows } = await db.query('select 1 from cases where id = $1', [id])
    expect(rows).toEqual([])
  })
})

describe('RLS auf cases (§4)', () => {
  it('zeigt einer fremden Person den Fall nicht', async () => {
    const id = await fallMitMitgliedern(db, ANNA)

    const rows = await alsBenutzer(db, FREMDE)(async (fuehreAus) => {
      const { rows } = await fuehreAus('select id from cases where id = $1', [id])
      return rows
    })

    expect(rows).toEqual([])
  })
})

describe('RLS auf key_wraps (§3.6, §4)', () => {
  async function fallMitWrap(besitzer: string, ...weitere: string[]) {
    const id = await fallMitMitgliedern(db, besitzer, ...weitere)
    const geraet = await geraeteschluessel(db, besitzer)

    await db.query(
      `insert into key_wraps (case_id, kid, device_id, kem_ct, wrapped_key, wrapped_by, signature)
       values ($1, $2, $3, '\\x01', '\\x02', $3, '\\x03')`,
      [id, kidFall(id), geraet],
    )

    return { id, geraet }
  }

  it('zeigt einem Gerät seine eigenen Wraps', async () => {
    const { id } = await fallMitWrap(ANNA)

    const rows = await alsBenutzer(db, ANNA)(async (fuehreAus) => {
      const { rows } = await fuehreAus('select kid from key_wraps where case_id = $1', [id])
      return rows as { kid: string }[]
    })

    expect(rows.map((zeile) => zeile.kid)).toEqual([kidFall(id)])
  })

  it('verbirgt die Wraps eines fremden Geräts, auch im gemeinsamen Fall', async () => {
    // Bernd darf für Annas Gerät schreiben, aber nie lesen, was dort steht.
    // Sonst brächte ein zweites Mitglied im Fall nichts: Wer alle Wraps sieht,
    // sieht sie nur nicht entschlüsselt, und die RLS wäre die einzige Schicht,
    // die zwischen ihm und einem fremden `sk_u`-Ziel steht.
    const { id } = await fallMitWrap(ANNA, BERND)

    const rows = await alsBenutzer(db, BERND)(async (fuehreAus) => {
      const { rows } = await fuehreAus('select kid from key_wraps where case_id = $1', [id])
      return rows
    })

    expect(rows).toEqual([])
  })

  it('verbirgt die Wraps eines fremden Falls', async () => {
    const { id } = await fallMitWrap(ANNA)

    const rows = await alsBenutzer(db, FREMDE)(async (fuehreAus) => {
      const { rows } = await fuehreAus('select kid from key_wraps where case_id = $1', [id])
      return rows
    })

    expect(rows).toEqual([])
  })

  it('lässt ein Mitglied für das Gerät eines anderen Mitglieds schreiben', async () => {
    // Der Fall aus §3.6: Ein neues Gerät sieht den Fall und liest nichts, bis
    // ein anderes Mitglied `K_c` daran wrappt.
    const id = await fallMitMitgliedern(db, ANNA, BERND)
    const annasGeraet = await geraeteschluessel(db, ANNA)
    const berndsGeraet = await geraeteschluessel(db, BERND)

    await alsBenutzer(db, ANNA)((fuehreAus) =>
      fuehreAus(
        `insert into key_wraps (case_id, kid, device_id, kem_ct, wrapped_key, wrapped_by, signature)
         values ($1, $2, $3, '\\x01', '\\x02', $4, '\\x03')`,
        [id, kidFall(id), berndsGeraet, annasGeraet],
      ),
    )

    const rows = await alsBenutzer(db, BERND)(async (fuehreAus) => {
      const { rows } = await fuehreAus('select device_id from key_wraps where case_id = $1', [id])
      return rows as { device_id: string }[]
    })

    expect(rows.map((zeile) => zeile.device_id)).toEqual([berndsGeraet])
  })

  it('lässt niemanden im Namen eines fremden Geräts wrappen', async () => {
    // `wrapped_by` ist die Adresse, gegen die das Empfängergerät die Signatur
    // prüft. Stünde dort ein fremdes Gerät, prüfte es gegen einen Schlüssel,
    // den der Absender nie hatte, und der Wrap wäre unentpackbar statt
    // abgewiesen.
    const id = await fallMitMitgliedern(db, ANNA, BERND)
    const annasGeraet = await geraeteschluessel(db, ANNA)
    const berndsGeraet = await geraeteschluessel(db, BERND)

    await expect(
      alsBenutzer(db, ANNA)((fuehreAus) =>
        fuehreAus(
          `insert into key_wraps (case_id, kid, device_id, kem_ct, wrapped_key, wrapped_by, signature)
           values ($1, $2, $3, '\\x01', '\\x02', $3, '\\x03')`,
          [id, kidFall(id), berndsGeraet],
        ),
      ),
    ).rejects.toThrow(/row-level security/i)

    expect(annasGeraet).not.toBe(berndsGeraet)
  })

  it('lässt niemanden in einen fremden Fall wrappen', async () => {
    const fremderFall = await fallMitMitgliedern(db, FREMDE)
    const annasGeraet = await geraeteschluessel(db, ANNA)

    await expect(
      alsBenutzer(db, ANNA)((fuehreAus) =>
        fuehreAus(
          `insert into key_wraps (case_id, kid, device_id, kem_ct, wrapped_key, wrapped_by, signature)
           values ($1, $2, $3, '\\x01', '\\x02', $3, '\\x03')`,
          [fremderFall, kidFall(fremderFall), annasGeraet],
        ),
      ),
    ).rejects.toThrow(/row-level security/i)
  })

  it('lässt den zweiten Schreiber auf dieselbe Zeile nicht gewinnen', async () => {
    const { id, geraet } = await fallMitWrap(ANNA)

    await expect(
      alsBenutzer(db, ANNA)((fuehreAus) =>
        fuehreAus(
          `insert into key_wraps (case_id, kid, device_id, kem_ct, wrapped_key, wrapped_by, signature)
           values ($1, $2, $3, '\\xff', '\\xff', $3, '\\xff')`,
          [id, kidFall(id), geraet],
        ),
      ),
    ).rejects.toThrow(/unique|duplicate|eindeutig/i)

    const { rows } = await db.query<{ kem_ct: Uint8Array }>(
      'select kem_ct from key_wraps where case_id = $1 and kid = $2',
      [id, kidFall(id)],
    )
    expect(Array.from(rows[0]?.kem_ct ?? [])).toEqual([0x01])
  })

  it('schließt UPDATE für jeden aus', async () => {
    // Nicht nur für Fremde: Auch der eigene Wrap ist unveränderlich. Ein
    // überschriebener Wrap ist genau der Angriff, gegen den §3.6 die Tabelle
    // insert-only hält.
    const { id } = await fallMitWrap(ANNA)

    await expect(
      alsBenutzer(db, ANNA)((fuehreAus) =>
        fuehreAus('update key_wraps set wrapped_key = $2 where case_id = $1', [
          id,
          new Uint8Array([0xff]),
        ]),
      ),
    ).rejects.toThrow(/permission denied|row-level security/i)
  })

  it('lässt den Besitzer eines Geräts dessen Wrap löschen', async () => {
    const { id } = await fallMitWrap(ANNA)

    const geloescht = await alsBenutzer(db, ANNA)(async (fuehreAus) => {
      const { rows } = await fuehreAus(
        'delete from key_wraps where case_id = $1 returning kid',
        [id],
      )
      return rows
    })

    expect(geloescht).toHaveLength(1)
  })

  it('lässt niemanden den Wrap eines fremden Geräts löschen', async () => {
    const { id } = await fallMitWrap(ANNA, BERND)

    const geloescht = await alsBenutzer(db, BERND)(async (fuehreAus) => {
      const { rows } = await fuehreAus(
        'delete from key_wraps where case_id = $1 returning kid',
        [id],
      )
      return rows
    })

    expect(geloescht).toEqual([])

    const { rows } = await db.query('select 1 from key_wraps where case_id = $1', [id])
    expect(rows).toHaveLength(1)
  })
})
