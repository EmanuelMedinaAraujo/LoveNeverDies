import type { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  alsBenutzer,
  fallMitMitgliedern,
  frischeDatenbank,
  geraeteschluessel,
  profil,
  vorsorgefall,
  type FuehreAus,
} from './postgres'

/**
 * Nahtstelle: Kopplungscodes, Einlösung und Abschluss (DESIGN.md §6, §3.6, §4).
 *
 * Hier hängt der ganze Schutz der Kopplung. `pairing_codes` ist nicht
 * selektierbar, der Code lebt 15 Minuten und genau eine Einlösung, das
 * Rate-Limit zählt auch die Fehlgriffe, und `schliesse_kopplung_ab` legt
 * Mitgliedschaft und Wraps zusammen an oder gar nicht. Jede dieser Zusagen ist
 * eine Behauptung über die Datenbank, also läuft sie hier gegen echtes
 * Postgres.
 */

const ANNA = 'user_anna'
const BERND = 'user_bernd'
const FREMDE = 'user_fremde'

/** Die 32 Zeichen aus §6: keine Null, kein O, keine Eins, kein I. */
const ALPHABET = /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{8}$/

let db: PGlite

beforeAll(async () => {
  db = await frischeDatenbank()
})

afterAll(async () => {
  await db?.close()
})

beforeEach(async () => {
  // Das Rate-Limit zählt über Testgrenzen hinweg, wenn niemand aufräumt — und
  // dann scheitert irgendwann ein Test an einem Versuch, den ein anderer
  // unternommen hat.
  await db.exec('delete from pairing_attempts')
})

type Einloesung = {
  status: string
  purpose: string | null
  user_id: string | null
  display_name: string | null
  email: string | null
  device_id: string | null
  public_key: Uint8Array | null
  sig_public_key: Uint8Array | null
}

function erzeuge(fuehreAus: FuehreAus, geraet: string, zweck: string) {
  return fuehreAus('select * from erzeuge_kopplungscode($1, $2)', [geraet, zweck])
}

async function codeVon(user: string, geraet: string, zweck: string): Promise<string> {
  const { rows } = await alsBenutzer(db, user)((fuehreAus) => erzeuge(fuehreAus, geraet, zweck))
  const code = (rows[0] as { code: string } | undefined)?.code

  if (code === undefined) {
    throw new Error('Es kam kein Kopplungscode zurück.')
  }

  return code
}

async function loeseEin(user: string, code: string): Promise<Einloesung> {
  const { rows } = await alsBenutzer(db, user)((fuehreAus) =>
    fuehreAus('select * from loese_kopplungscode_ein($1)', [code]),
  )

  return rows[0] as Einloesung
}

function schliesseAb(
  fuehreAus: FuehreAus,
  code: string,
  fallId: string,
  absender: string,
  abweichung: { kidFall?: string; kidKatalog?: string } = {},
) {
  return fuehreAus(
    `select schliesse_kopplung_ab(
       $1, $2, $3, $4, $5,
       '\\x01'::bytea, '\\x02'::bytea, '\\x03'::bytea,
       '\\x04'::bytea, '\\x05'::bytea, '\\x06'::bytea)`,
    [
      code,
      fallId,
      abweichung.kidFall ?? 'case_test:1',
      abweichung.kidKatalog ?? `cat_${fallId}`,
      absender,
    ],
  )
}

/**
 * Läuft als `authenticated`, aber ohne `sub` im Token — der Zustand, den ein
 * abgelaufenes oder fehlendes Clerk-Token erzeugt.
 */
function ohneAnmeldung<T>(arbeit: (fuehreAus: FuehreAus) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.exec('set local role authenticated')

    return arbeit((sql, parameter = []) => tx.query(sql, parameter))
  }) as Promise<T>
}

describe('erzeuge_kopplungscode (§6)', () => {
  it('gibt acht Zeichen ohne O, 0, I und 1 zurück', async () => {
    const geraet = await geraeteschluessel(db, ANNA)
    await profil(db, ANNA)

    // Ein einzelner Code sagt über das Alphabet wenig. Zwanzig sagen genug:
    // 160 Zeichen, und keines davon darf zu den vier verwechselbaren gehören.
    for (let runde = 0; runde < 20; runde++) {
      expect(await codeVon(ANNA, geraet, 'device')).toMatch(ALPHABET)
    }
  })

  it('schöpft an jeder Stelle das ganze Alphabet aus', async () => {
    /*
     * Ein UUIDv4 trägt in Byte 6 die Version und in Byte 8 zwei Variantenbits.
     * Wer sie in den Code nähme, bekäme an diesen Stellen nur die Hälfte des
     * Alphabets — und das sieht man einem einzelnen Code nicht an. Hier fällt
     * es auf: Bei 200 Codes müsste jede Stelle deutlich mehr als 16 der 32
     * Zeichen zeigen.
     */
    const geraet = await geraeteschluessel(db, 'user_verteilung')
    await profil(db, 'user_verteilung')

    const gesehen = Array.from({ length: 8 }, () => new Set<string>())

    for (let runde = 0; runde < 200; runde++) {
      const code = await codeVon('user_verteilung', geraet, 'device')

      for (let stelle = 0; stelle < 8; stelle++) {
        gesehen[stelle]?.add(code[stelle] ?? '')
      }
    }

    for (const stelle of gesehen) {
      expect(stelle.size).toBeGreaterThan(20)
    }
  })

  it('lässt den Code nach 15 Minuten ablaufen', async () => {
    const geraet = await geraeteschluessel(db, ANNA)
    await profil(db, ANNA)

    const { rows } = await alsBenutzer(db, ANNA)((fuehreAus) => erzeuge(fuehreAus, geraet, 'join'))
    const { expires_at } = rows[0] as { expires_at: Date }

    const minuten = (expires_at.getTime() - Date.now()) / 60_000

    expect(minuten).toBeGreaterThan(14)
    expect(minuten).toBeLessThanOrEqual(15)
  })

  it('weist ein Gerät ab, das einer anderen Person gehört', async () => {
    const fremdesGeraet = await geraeteschluessel(db, FREMDE)
    await profil(db, ANNA)

    await expect(
      alsBenutzer(db, ANNA)((fuehreAus) => erzeuge(fuehreAus, fremdesGeraet, 'join')),
    ).rejects.toThrow(/gehört nicht zur angemeldeten Person/)
  })

  it('gibt ohne hinterlegten Namen keinen Code aus', async () => {
    // §6 zeigt der einladenden Person einen echten Namen, bevor sie das
    // Familiengeheimnis weitergibt. Ein Code ohne Profil unterliefe genau das.
    const geraet = await geraeteschluessel(db, 'user_ohne_profil')

    await expect(
      alsBenutzer(db, 'user_ohne_profil')((fuehreAus) => erzeuge(fuehreAus, geraet, 'join')),
    ).rejects.toThrow(/Ohne hinterlegten Namen/)
  })

  it('kennt nur die beiden Zwecke aus §6', async () => {
    const geraet = await geraeteschluessel(db, ANNA)
    await profil(db, ANNA)

    await expect(
      alsBenutzer(db, ANNA)((fuehreAus) => erzeuge(fuehreAus, geraet, 'alles')),
    ).rejects.toThrow(/Unbekannter Kopplungszweck/)
  })

  it('gibt ohne Anmeldung keinen Code aus', async () => {
    const geraet = await geraeteschluessel(db, ANNA)
    await profil(db, ANNA)

    await expect(ohneAnmeldung((fuehreAus) => erzeuge(fuehreAus, geraet, 'join'))).rejects.toThrow(
      /Ohne Anmeldung/,
    )
  })

  it('nimmt einen früheren offenen Code desselben Zwecks aus dem Verkehr', async () => {
    const geraet = await geraeteschluessel(db, ANNA)
    await profil(db, ANNA)

    const alt = await codeVon(ANNA, geraet, 'join')
    const neu = await codeVon(ANNA, geraet, 'join')

    expect(await loeseEin(BERND, alt)).toMatchObject({ status: 'unbekannt' })
    expect(await loeseEin(BERND, neu)).toMatchObject({ status: 'ok' })
  })

  it('lässt einen Code für den anderen Zweck daneben stehen', async () => {
    const geraet = await geraeteschluessel(db, ANNA)
    await profil(db, ANNA)

    const beitritt = await codeVon(ANNA, geraet, 'join')
    await codeVon(ANNA, geraet, 'device')

    expect(await loeseEin(BERND, beitritt)).toMatchObject({ status: 'ok' })
  })
})

describe('RLS auf pairing_codes (§4)', () => {
  it('lässt niemanden die Codes direkt lesen', async () => {
    const geraet = await geraeteschluessel(db, ANNA)
    await profil(db, ANNA)
    await codeVon(ANNA, geraet, 'join')

    // Nicht bloß leer, sondern verwehrt: Die Tabelle hat weder Policy noch
    // `grant`. Der einzige Weg an diese Zeilen führt über die RPC.
    await expect(
      alsBenutzer(db, ANNA)((fuehreAus) => fuehreAus('select code from pairing_codes')),
    ).rejects.toThrow(/permission denied/)
  })
})

describe('loese_kopplungscode_ein (§6, §3.6)', () => {
  it('gibt Name, E-Mail und beide öffentlichen Schlüssel heraus', async () => {
    const pkKem = new Uint8Array([1, 2, 3, 4])
    const geraet = await geraeteschluessel(db, ANNA, 'iPhone von Anna', pkKem)
    await profil(db, ANNA, 'Anna Müller', 'anna@example.de')

    const code = await codeVon(ANNA, geraet, 'join')
    const einloesung = await loeseEin(BERND, code)

    expect(einloesung).toMatchObject({
      status: 'ok',
      purpose: 'join',
      user_id: ANNA,
      display_name: 'Anna Müller',
      email: 'anna@example.de',
      device_id: geraet,
    })
    // Aus diesen Bytes rechnet die einladende Seite denselben Prüfcode, den
    // Annas Gerät anzeigt (§3.6). Deshalb müssen beide Schlüssel mitkommen und
    // nicht nur der für das Wrappen nötige.
    expect(new Uint8Array(einloesung.public_key as Uint8Array)).toEqual(pkKem)
    expect(einloesung.sig_public_key).not.toBeNull()
  })

  it('verbraucht den Code mit der ersten Einlösung', async () => {
    const geraet = await geraeteschluessel(db, ANNA)
    await profil(db, ANNA)

    const code = await codeVon(ANNA, geraet, 'join')

    expect(await loeseEin(BERND, code)).toMatchObject({ status: 'ok' })
    expect(await loeseEin(BERND, code)).toMatchObject({ status: 'verbraucht' })
  })

  it('weist einen abgelaufenen Code ab', async () => {
    const geraet = await geraeteschluessel(db, ANNA)
    await profil(db, ANNA)

    const code = await codeVon(ANNA, geraet, 'join')
    await db.query(`update pairing_codes set expires_at = now() - interval '1 second'`)

    expect(await loeseEin(BERND, code)).toMatchObject({ status: 'abgelaufen' })
  })

  it('weist einen Code ab, den es nicht gibt', async () => {
    expect(await loeseEin(BERND, 'ZZZZZZZZ')).toMatchObject({ status: 'unbekannt' })
  })

  it('liest den Code so, wie er am Telefon genannt wurde', async () => {
    const geraet = await geraeteschluessel(db, ANNA)
    await profil(db, ANNA)

    const code = await codeVon(ANNA, geraet, 'join')
    const wieAbgeschrieben = `${code.slice(0, 4).toLowerCase()}-${code.slice(4).toLowerCase()}`

    expect(await loeseEin(BERND, wieAbgeschrieben)).toMatchObject({ status: 'ok' })
  })

  it('lässt einen join-Code nicht von der eigenen Person einlösen', async () => {
    const geraet = await geraeteschluessel(db, ANNA)
    await profil(db, ANNA)

    const code = await codeVon(ANNA, geraet, 'join')

    expect(await loeseEin(ANNA, code)).toMatchObject({ status: 'selbst' })
    // Der Code überlebt den Fehlgriff: Die andere Seite wartet noch auf ihn.
    expect(await loeseEin(BERND, code)).toMatchObject({ status: 'ok' })
  })

  it('lässt einen device-Code nicht von einer fremden Person einlösen', async () => {
    const geraet = await geraeteschluessel(db, ANNA)
    await profil(db, ANNA)

    const code = await codeVon(ANNA, geraet, 'device')

    expect(await loeseEin(FREMDE, code)).toMatchObject({ status: 'fremd' })
    expect(await loeseEin(ANNA, code)).toMatchObject({ status: 'ok' })
  })

  it('sperrt nach zu vielen Versuchen, und zählt dabei die Fehlgriffe mit', async () => {
    const geraet = await geraeteschluessel(db, ANNA)
    await profil(db, ANNA)
    const code = await codeVon(ANNA, geraet, 'join')

    for (let versuch = 0; versuch < 10; versuch++) {
      expect(await loeseEin(BERND, 'ZZZZZZZZ')).toMatchObject({ status: 'unbekannt' })
    }

    // Der gültige Code, der jetzt kommt, hätte ohne die zehn Fehlgriffe davor
    // funktioniert. Genau das ist die Zusage.
    expect(await loeseEin(BERND, code)).toMatchObject({ status: 'gesperrt' })
  })

  it('lässt die Sperre nach 15 Minuten wieder los', async () => {
    const geraet = await geraeteschluessel(db, ANNA)
    await profil(db, ANNA)
    const code = await codeVon(ANNA, geraet, 'join')

    for (let versuch = 0; versuch < 11; versuch++) {
      await loeseEin(BERND, 'ZZZZZZZZ')
    }

    await db.query(`update pairing_attempts set attempted_at = now() - interval '16 minutes'`)

    expect(await loeseEin(BERND, code)).toMatchObject({ status: 'ok' })
  })

  it('zählt das Limit je Person', async () => {
    const geraet = await geraeteschluessel(db, ANNA)
    await profil(db, ANNA)
    const code = await codeVon(ANNA, geraet, 'join')

    for (let versuch = 0; versuch < 11; versuch++) {
      await loeseEin(FREMDE, 'ZZZZZZZZ')
    }

    expect(await loeseEin(BERND, code)).toMatchObject({ status: 'ok' })
  })

  it('löst ohne Anmeldung nichts ein', async () => {
    await expect(
      ohneAnmeldung((fuehreAus) => fuehreAus('select * from loese_kopplungscode_ein($1)', ['ZZZZZZZZ'])),
    ).rejects.toThrow(/Ohne Anmeldung/)
  })
})

describe('schliesse_kopplung_ab (§6, §3.6)', () => {
  let annasGeraet: string
  let berndsGeraet: string
  let fallId: string

  beforeEach(async () => {
    annasGeraet = await geraeteschluessel(db, ANNA)
    berndsGeraet = await geraeteschluessel(db, BERND)
    await profil(db, ANNA)
    await profil(db, BERND, 'Bernd Müller', 'bernd@example.de')
    fallId = await fallMitMitgliedern(db, BERND)
  })

  it('legt Mitgliedschaft und beide Wraps in einem Zug an', async () => {
    const code = await codeVon(ANNA, annasGeraet, 'join')
    await loeseEin(BERND, code)

    await alsBenutzer(db, BERND)((fuehreAus) =>
      schliesseAb(fuehreAus, code, fallId, berndsGeraet),
    )

    const { rows: mitglieder } = await db.query(
      'select user_id from memberships where case_id = $1 order by user_id',
      [fallId],
    )
    expect(mitglieder).toEqual([{ user_id: ANNA }, { user_id: BERND }])

    // Beide Wraps, beide an Annas Gerät, beide von Bernds Gerät signiert.
    const { rows: wraps } = await db.query(
      'select kid, device_id, wrapped_by from key_wraps where case_id = $1 order by kid',
      [fallId],
    )
    expect(wraps).toEqual([
      { kid: 'case_test:1', device_id: annasGeraet, wrapped_by: berndsGeraet },
      { kid: `cat_${fallId}`, device_id: annasGeraet, wrapped_by: berndsGeraet },
    ])
  })

  it('lässt die beitretende Person danach Fall und Wraps lesen', async () => {
    const code = await codeVon(ANNA, annasGeraet, 'join')
    await loeseEin(BERND, code)
    await alsBenutzer(db, BERND)((fuehreAus) => schliesseAb(fuehreAus, code, fallId, berndsGeraet))

    const { rows } = await alsBenutzer(db, ANNA)(async (fuehreAus) => {
      const faelle = await fuehreAus('select id from cases where id = $1', [fallId])
      const wraps = await fuehreAus(
        'select kid from key_wraps where case_id = $1 order by kid',
        [fallId],
      )

      return { rows: [faelle.rows, wraps.rows] }
    })

    expect(rows[0]).toEqual([{ id: fallId }])
    expect(rows[1]).toEqual([{ kid: 'case_test:1' }, { kid: `cat_${fallId}` }])
  })

  it('lässt niemanden abschließen, der den Code nicht eingelöst hat', async () => {
    const code = await codeVon(ANNA, annasGeraet, 'join')
    await loeseEin(BERND, code)

    const fremdesGeraet = await geraeteschluessel(db, FREMDE)
    await db.query('insert into memberships (case_id, user_id) values ($1, $2)', [fallId, FREMDE])

    await expect(
      alsBenutzer(db, FREMDE)((fuehreAus) => schliesseAb(fuehreAus, code, fallId, fremdesGeraet)),
    ).rejects.toThrow(/nicht von Ihnen eingelöst/)
  })

  it('schließt einen Code ab, der noch gar nicht eingelöst wurde, nicht ab', async () => {
    const code = await codeVon(ANNA, annasGeraet, 'join')

    await expect(
      alsBenutzer(db, BERND)((fuehreAus) => schliesseAb(fuehreAus, code, fallId, berndsGeraet)),
    ).rejects.toThrow(/nicht von Ihnen eingelöst/)
  })

  it('lässt niemanden in einen fremden Fall koppeln', async () => {
    const fremderFall = await fallMitMitgliedern(db, FREMDE)
    const code = await codeVon(ANNA, annasGeraet, 'join')
    await loeseEin(BERND, code)

    await expect(
      alsBenutzer(db, BERND)((fuehreAus) => schliesseAb(fuehreAus, code, fremderFall, berndsGeraet)),
    ).rejects.toThrow(/gehören nicht zum Fall/)
  })

  it('weist ein kid ab, das nicht zum Fall gehört', async () => {
    const code = await codeVon(ANNA, annasGeraet, 'join')
    await loeseEin(BERND, code)

    await expect(
      alsBenutzer(db, BERND)((fuehreAus) =>
        schliesseAb(fuehreAus, code, fallId, berndsGeraet, { kidKatalog: 'cat_falsch' }),
      ),
    ).rejects.toThrow(/gehört nicht zum Fall/)
  })

  it('weist ein fremdes Absendergerät ab', async () => {
    const code = await codeVon(ANNA, annasGeraet, 'join')
    await loeseEin(BERND, code)

    await expect(
      alsBenutzer(db, BERND)((fuehreAus) => schliesseAb(fuehreAus, code, fallId, annasGeraet)),
    ).rejects.toThrow(/gehört nicht zur angemeldeten Person/)
  })

  it('weist einen Abschluss ab, für den zu lange niemand bestätigt hat', async () => {
    const code = await codeVon(ANNA, annasGeraet, 'join')
    await loeseEin(BERND, code)
    await db.query(`update pairing_codes set redeemed_at = now() - interval '16 minutes'`)

    await expect(
      alsBenutzer(db, BERND)((fuehreAus) => schliesseAb(fuehreAus, code, fallId, berndsGeraet)),
    ).rejects.toThrow(/zu viel Zeit vergangen/)
  })

  it('überschreibt einen vorhandenen Wrap nicht', async () => {
    const code = await codeVon(ANNA, annasGeraet, 'join')
    await loeseEin(BERND, code)

    await db.query(
      `insert into key_wraps (case_id, kid, device_id, kem_ct, wrapped_key, wrapped_by, signature)
       values ($1, 'case_test:1', $2, '\\xaa', '\\xbb', $3, '\\xcc')`,
      [fallId, annasGeraet, berndsGeraet],
    )

    await alsBenutzer(db, BERND)((fuehreAus) => schliesseAb(fuehreAus, code, fallId, berndsGeraet))

    // „Erster Schreiber gewinnt" (§3.6): Der Wrap von vorhin steht noch da.
    const { rows } = await db.query(
      `select encode(kem_ct, 'hex') as kem_ct from key_wraps
        where case_id = $1 and kid = 'case_test:1'`,
      [fallId],
    )
    expect(rows).toEqual([{ kem_ct: 'aa' }])
  })

  describe('zweites Gerät (purpose = device)', () => {
    it('wrappt für alle Fälle, die das freigebende Gerät lesen kann', async () => {
      const berndsZweites = await geraeteschluessel(db, BERND)
      const zweiterFall = await fallMitMitgliedern(db, BERND)

      const code = await codeVon(BERND, berndsZweites, 'device')
      await loeseEin(BERND, code)

      for (const fall of [fallId, zweiterFall]) {
        await alsBenutzer(db, BERND)((fuehreAus) =>
          schliesseAb(fuehreAus, code, fall, berndsGeraet),
        )
      }

      const { rows } = await db.query(
        'select count(*)::int as anzahl from key_wraps where device_id = $1',
        [berndsZweites],
      )
      expect(rows).toEqual([{ anzahl: 4 }])
    })

    it('legt keine zweite Mitgliedschaft an', async () => {
      const berndsZweites = await geraeteschluessel(db, BERND)
      const code = await codeVon(BERND, berndsZweites, 'device')
      await loeseEin(BERND, code)

      await alsBenutzer(db, BERND)((fuehreAus) => schliesseAb(fuehreAus, code, fallId, berndsGeraet))

      const { rows } = await db.query(
        'select count(*)::int as anzahl from memberships where case_id = $1',
        [fallId],
      )
      expect(rows).toEqual([{ anzahl: 1 }])
    })
  })
})

describe('on_membership_created (§3.5, §4)', () => {
  it('setzt vault_resplit_pending, wenn jemand einem Vorsorgefall beitritt', async () => {
    const fallId = await vorsorgefall(db, BERND, BERND)
    await db.query('update cases set vault_resplit_pending = false where id = $1', [fallId])

    await db.query('insert into memberships (case_id, user_id) values ($1, $2)', [fallId, ANNA])

    const { rows } = await db.query(
      'select vault_resplit_pending from cases where id = $1',
      [fallId],
    )
    expect(rows).toEqual([{ vault_resplit_pending: true }])
  })

  it('lässt einen Trauerfall unberührt', async () => {
    const fallId = await fallMitMitgliedern(db, BERND)

    await db.query('insert into memberships (case_id, user_id) values ($1, $2)', [fallId, ANNA])

    const { rows } = await db.query(
      'select vault_resplit_pending from cases where id = $1',
      [fallId],
    )
    expect(rows).toEqual([{ vault_resplit_pending: false }])
  })

  it('lässt den Preparer selbst die Fahne nicht setzen', async () => {
    // Der Preparer tritt seinem eigenen Vorsorgefall bei — etwa mit einem
    // zweiten Gerät. Seine Shares liegen bereits, wo sie hingehören.
    const fallId = await vorsorgefall(db, BERND)
    await db.query('update cases set vault_resplit_pending = false where id = $1', [fallId])

    await db.query('insert into memberships (case_id, user_id) values ($1, $2)', [fallId, BERND])

    const { rows } = await db.query(
      'select vault_resplit_pending from cases where id = $1',
      [fallId],
    )
    expect(rows).toEqual([{ vault_resplit_pending: false }])
  })

  it('setzt die Fahne auch über die Kopplung', async () => {
    const annasGeraet = await geraeteschluessel(db, ANNA)
    const berndsGeraet = await geraeteschluessel(db, BERND)
    await profil(db, ANNA)
    await profil(db, BERND, 'Bernd Müller', 'bernd@example.de')

    const fallId = await vorsorgefall(db, BERND, BERND)
    await db.query('update cases set vault_resplit_pending = false where id = $1', [fallId])

    const code = await codeVon(ANNA, annasGeraet, 'join')
    await loeseEin(BERND, code)
    await alsBenutzer(db, BERND)((fuehreAus) => schliesseAb(fuehreAus, code, fallId, berndsGeraet))

    const { rows } = await db.query(
      'select vault_resplit_pending from cases where id = $1',
      [fallId],
    )
    expect(rows).toEqual([{ vault_resplit_pending: true }])
  })
})
