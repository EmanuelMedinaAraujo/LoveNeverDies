import type { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { alsBenutzer, fallMitMitgliedern, frischeDatenbank, geraeteschluessel } from './postgres'

/**
 * Was die Datenbank über private Items durchsetzen kann (DESIGN.md §3.7, §4).
 *
 * Und das ist wenig, mit Absicht: `parentId` und `dependsOn` liegen
 * verschlüsselt im Payload (§3.3), der Server sieht sie nie. Die beiden
 * Strukturregeln aus §3.7 gehören deshalb in den Client und werden dort
 * geprüft. Hier bleiben zwei Zusagen, und beide sind harte Grenzen:
 *
 * 1. Privat und im Tresor schließen sich aus, auch wenn das `kid` einer
 *    anderen Person gehört. Ein Tresor-Item ist für die Hinterbliebenen
 *    bestimmt; privat und im Tresor wäre eines, das nach dem Tod niemand mehr
 *    öffnen kann.
 * 2. `personal_key_wraps` einer anderen Person sind weder lesbar noch
 *    beschreibbar, anders als `key_wraps`, wo jedes Mitglied für fremde Geräte
 *    schreiben darf (§3.6).
 */

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

/** Legt einen persönlichen Schlüssel an, an der RLS vorbei. */
async function persoenlicherSchluessel(
  fallId: string,
  userId: string,
  kid: string,
): Promise<string> {
  const geraet = await geraeteschluessel(db, userId, `Gerät ${userId}`)

  await db.query(
    `insert into personal_key_wraps (case_id, user_id, kid, device_id, kem_ct, wrapped_key)
     values ($1, $2, $3, $4, '\\x01'::bytea, '\\x02'::bytea)`,
    [fallId, userId, kid, geraet],
  )

  return geraet
}

describe('Privat und im Tresor schließen sich aus (§3.7, §4)', () => {
  it('weist ein privates Item mit in_vault = true beim Anlegen ab', async () => {
    const fallId = await fallMitMitgliedern(db, ANNA)
    const kid = 'a1b2c3d4e5f6'
    await persoenlicherSchluessel(fallId, ANNA, kid)

    await expect(
      alsBenutzer(db, ANNA)((fuehreAus) =>
        fuehreAus(
          `insert into items (id, case_id, kind, kid, in_vault, wrapped_dek, payload)
           values ($1, $2, 'item', $3, true, '\\x11'::bytea, '\\x22'::bytea)`,
          [crypto.randomUUID(), fallId, kid],
        ),
      ),
    ).rejects.toThrow(/Tresor/)
  })

  it('weist auch den Umweg über ein UPDATE ab', async () => {
    /*
     * Ohne den UPDATE-Zweig legte jemand das Item privat an und schöbe es mit
     * einem zweiten Aufruf in den Tresor. Der Trigger muss beide Male greifen.
     */
    const fallId = await fallMitMitgliedern(db, ANNA)
    const kid = 'b1b2c3d4e5f6'
    await persoenlicherSchluessel(fallId, ANNA, kid)

    const itemId = crypto.randomUUID()

    await alsBenutzer(db, ANNA)((fuehreAus) =>
      fuehreAus(
        `insert into items (id, case_id, kind, kid, wrapped_dek, payload)
         values ($1, $2, 'item', $3, '\\x11'::bytea, '\\x22'::bytea)`,
        [itemId, fallId, kid],
      ),
    )

    await expect(
      alsBenutzer(db, ANNA)((fuehreAus) =>
        fuehreAus('update items set in_vault = true where id = $1', [itemId]),
      ),
    ).rejects.toThrow(/Tresor/)
  })

  it('weist es auch dann ab, wenn das kid einer anderen Person gehört', async () => {
    /*
     * Der Grund für `security definer` (§4): RLS verbirgt die
     * `personal_key_wraps` fremder Personen. Liefe die Prüfung als Aufrufer,
     * fände sie Bernds `kid` nicht und ließe die Zeile durch — der Trigger
     * versagte genau in dem Fall, für den er da ist.
     */
    const fallId = await fallMitMitgliedern(db, ANNA, BERND)
    const kidBernd = 'c1b2c3d4e5f6'
    await persoenlicherSchluessel(fallId, BERND, kidBernd)

    await expect(
      alsBenutzer(db, ANNA)((fuehreAus) =>
        fuehreAus(
          `insert into items (id, case_id, kind, kid, in_vault, wrapped_dek, payload)
           values ($1, $2, 'item', $3, true, '\\x11'::bytea, '\\x22'::bytea)`,
          [crypto.randomUUID(), fallId, kidBernd],
        ),
      ),
    ).rejects.toThrow(/Tresor/)
  })

  it('lässt ein gewöhnliches Tresor-Item durch', async () => {
    // Die Gegenprobe: Ohne sie bewiese der Trigger nur, dass er etwas abweist.
    const fallId = await fallMitMitgliedern(db, ANNA)

    await alsBenutzer(db, ANNA)((fuehreAus) =>
      fuehreAus(
        `insert into items (id, case_id, kind, kid, in_vault, wrapped_dek, payload)
         values ($1, $2, 'item', $3, true, '\\x11'::bytea, '\\x22'::bytea)`,
        [crypto.randomUUID(), fallId, `vault_${fallId}`],
      ),
    )

    const { rows } = await db.query('select 1 from items where case_id = $1 and in_vault', [fallId])
    expect(rows).toHaveLength(1)
  })

  it('lässt ein privates Item ohne Tresor durch', async () => {
    const fallId = await fallMitMitgliedern(db, ANNA)
    const kid = 'd1b2c3d4e5f6'
    await persoenlicherSchluessel(fallId, ANNA, kid)

    await alsBenutzer(db, ANNA)((fuehreAus) =>
      fuehreAus(
        `insert into items (id, case_id, kind, kid, wrapped_dek, payload)
         values ($1, $2, 'item', $3, '\\x11'::bytea, '\\x22'::bytea)`,
        [crypto.randomUUID(), fallId, kid],
      ),
    )

    const { rows } = await db.query('select 1 from items where case_id = $1 and kid = $2', [
      fallId,
      kid,
    ])
    expect(rows).toHaveLength(1)
  })
})

describe('personal_key_wraps gehören genau einer Person (§3.7, §4)', () => {
  it('gibt die Wraps einer anderen Person nicht heraus', async () => {
    const fallId = await fallMitMitgliedern(db, ANNA, BERND)
    await persoenlicherSchluessel(fallId, BERND, 'e1b2c3d4e5f6')

    const gesehen = await alsBenutzer(db, ANNA)((fuehreAus) =>
      fuehreAus('select kid from personal_key_wraps where case_id = $1', [fallId]),
    )

    // Nicht "es ist ein anderer Wrap": Es ist gar keiner. Anders als bei
    // `key_wraps` (§3.6) gibt es keinen Anlass, einen fremden auch nur zu sehen.
    expect(gesehen.rows).toHaveLength(0)
  })

  it('lässt niemanden im Namen einer anderen Person schreiben', async () => {
    const fallId = await fallMitMitgliedern(db, ANNA, BERND)
    const berndsGeraet = await geraeteschluessel(db, BERND, 'Gerät Bernd')

    await expect(
      alsBenutzer(db, ANNA)((fuehreAus) =>
        fuehreAus(
          `insert into personal_key_wraps (case_id, user_id, kid, device_id, kem_ct, wrapped_key)
           values ($1, $2, 'f1b2c3d4e5f6', $3, '\\x01'::bytea, '\\x02'::bytea)`,
          [fallId, BERND, berndsGeraet],
        ),
      ),
    ).rejects.toThrow()
  })

  it('lässt kein Mitglied eines fremden Falls an die eigenen Wraps', async () => {
    /*
     * Die zweite Hälfte der Policy: `is_member(case_id)`. Ohne sie legte
     * jemand einen persönlichen Schlüssel in einem Fall an, in dem er nichts
     * zu suchen hat, und der Server ordnete ihm dort Items zu.
     */
    const fallId = await fallMitMitgliedern(db, ANNA, BERND)
    const clarasGeraet = await geraeteschluessel(db, CLARA, 'Gerät Clara')

    await expect(
      alsBenutzer(db, CLARA)((fuehreAus) =>
        fuehreAus(
          `insert into personal_key_wraps (case_id, user_id, kid, device_id, kem_ct, wrapped_key)
           values ($1, $2, 'a2b2c3d4e5f6', $3, '\\x01'::bytea, '\\x02'::bytea)`,
          [fallId, CLARA, clarasGeraet],
        ),
      ),
    ).rejects.toThrow()
  })

  it('lässt die eigenen Wraps lesen, schreiben und löschen', async () => {
    const fallId = await fallMitMitgliedern(db, ANNA)
    const annasGeraet = await geraeteschluessel(db, ANNA, 'Anna zweites Gerät')

    await alsBenutzer(db, ANNA)(async (fuehreAus) => {
      await fuehreAus(
        `insert into personal_key_wraps (case_id, user_id, kid, device_id, kem_ct, wrapped_key)
         values ($1, $2, 'b2b2c3d4e5f6', $3, '\\x01'::bytea, '\\x02'::bytea)`,
        [fallId, ANNA, annasGeraet],
      )

      const { rows } = await fuehreAus(
        'select kid from personal_key_wraps where case_id = $1 and device_id = $2',
        [fallId, annasGeraet],
      )
      expect(rows).toHaveLength(1)

      await fuehreAus('delete from personal_key_wraps where case_id = $1 and device_id = $2', [
        fallId,
        annasGeraet,
      ])
    })

    const { rows } = await db.query(
      'select 1 from personal_key_wraps where case_id = $1 and device_id = $2',
      [fallId, annasGeraet],
    )
    expect(rows).toHaveLength(0)
  })
})
