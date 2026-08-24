import type { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { alsBenutzer, fallMitMitgliedern, frischeDatenbank, profil } from './postgres'

/**
 * Nahtstelle: `profiles` und ihre RLS (DESIGN.md §3.3, §4).
 *
 * Die eine Tabelle mit personenbezogenem Klartext. Sichtbar ist sie für die
 * eigene Person und für alle, mit denen man einen Fall teilt, nicht für die
 * Welt, und das ist der ganze Unterschied zwischen einer bewussten
 * Verbreiterung (§3.3) und einem Verzeichnis aller Namen dieser App.
 */

const ANNA = 'user_anna'
const BERND = 'user_bernd'
const FREMDE = 'user_fremde'

let db: PGlite

beforeAll(async () => {
  db = await frischeDatenbank()

  await profil(db, ANNA, 'Anna Müller', 'anna@example.de')
  await profil(db, BERND, 'Bernd Müller', 'bernd@example.de')
  await profil(db, FREMDE, 'Fremde Person', 'fremde@example.de')

  await fallMitMitgliedern(db, ANNA, BERND)
})

afterAll(async () => {
  await db?.close()
})

function namenFuer(user: string) {
  return alsBenutzer(db, user)((fuehreAus) =>
    fuehreAus('select display_name from profiles order by display_name'),
  )
}

describe('RLS auf profiles (§4)', () => {
  it('zeigt der eigenen Person ihr Profil und die der Mitglieder', async () => {
    const { rows } = await namenFuer(ANNA)

    expect(rows).toEqual([{ display_name: 'Anna Müller' }, { display_name: 'Bernd Müller' }])
  })

  it('verbirgt Personen, mit denen man keinen Fall teilt', async () => {
    const { rows } = await namenFuer(FREMDE)

    expect(rows).toEqual([{ display_name: 'Fremde Person' }])
  })

  it('lässt die eigene Person ihren Namen ändern', async () => {
    await alsBenutzer(db, ANNA)((fuehreAus) =>
      fuehreAus(`update profiles set display_name = 'Anna M.' where user_id = $1`, [ANNA]),
    )

    const { rows } = await db.query('select display_name from profiles where user_id = $1', [ANNA])
    expect(rows).toEqual([{ display_name: 'Anna M.' }])
  })

  it('lässt niemanden ein fremdes Profil ändern', async () => {
    // Kein Wurf, sondern null betroffene Zeilen: Die Policy schränkt ein, sie
    // wirft nicht. Der Adapter macht daraus die Meldung. Hier zählt, dass in
    // der Tabelle nichts anderes steht als vorher.
    await alsBenutzer(db, FREMDE)((fuehreAus) =>
      fuehreAus(`update profiles set display_name = 'Untergeschoben' where user_id = $1`, [BERND]),
    )

    const { rows } = await db.query('select display_name from profiles where user_id = $1', [BERND])
    expect(rows).toEqual([{ display_name: 'Bernd Müller' }])
  })

  it('lässt niemanden ein Profil auf fremden Namen anlegen', async () => {
    await expect(
      alsBenutzer(db, FREMDE)((fuehreAus) =>
        fuehreAus(`insert into profiles (user_id, display_name) values ('user_neu', 'Neu')`),
      ),
    ).rejects.toThrow(/row-level security/)
  })

  it('lässt niemanden ein Profil löschen', async () => {
    await expect(
      alsBenutzer(db, ANNA)((fuehreAus) =>
        fuehreAus('delete from profiles where user_id = $1', [ANNA]),
      ),
    ).rejects.toThrow(/permission denied/)
  })
})
