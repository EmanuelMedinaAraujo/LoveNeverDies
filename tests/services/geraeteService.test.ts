import { beforeEach, describe, expect, it } from 'vitest'
import { geraetePruefcode } from '../../src/core/crypto/fingerprint'
import { erzeugeKemSchluesselpaar } from '../../src/core/crypto/kem'
import type { Geraeteidentitaet } from '../../src/core/crypto/keystore'
import { erzeugeSignaturSchluesselpaar, pkSigBytes } from '../../src/core/crypto/sign'
import type {
  GeraeteschluesselTabelle,
  GeraeteschluesselZeile,
  NeuerGeraeteschluessel,
} from '../../src/core/db/geraeteschluessel'
import {
  benenneGeraetUm,
  eigeneGeraete,
  registriereGeraet,
} from '../../src/services/geraeteService'

/**
 * Nahtstelle: die Geräteregistrierung (DESIGN.md §3.6).
 *
 * Sie läuft bei jedem Start, also muss sie idempotent sein, und sie schickt
 * öffentliche Schlüssel an den Server, also darf sie nichts anderes schicken.
 * Beides wird hier gegen eine Tabelle geprüft, die sich merkt, was ihr
 * übergeben wurde: Die SQL-Seite derselben Zusage steht in
 * `tests/db/geraeteschluessel.test.ts`.
 */

const ANNA = 'user_anna'

async function testidentitaet(fuellwert: number): Promise<Geraeteidentitaet> {
  const kem = erzeugeKemSchluesselpaar(new Uint8Array(32).fill(fuellwert))
  const signatur = erzeugeSignaturSchluesselpaar(new Uint8Array(64).fill(fuellwert))
  const pkKem = kem.oeffentlich
  const pkSig = pkSigBytes(signatur.oeffentlich)

  return {
    kem,
    signatur,
    pkKem,
    pkSig,
    fingerabdruck: new Uint8Array(32),
    pruefcode: await geraetePruefcode(pkKem, pkSig),
  }
}

/** Eine Tabelle mit demselben Verhalten wie `device_keys`, nur im Speicher. */
function speicherTabelle() {
  const zeilen: GeraeteschluesselZeile[] = []
  const angelegt: NeuerGeraeteschluessel[] = []
  let naechsteId = 1

  const tabelle: GeraeteschluesselTabelle = {
    async finde(userId, pkKem) {
      const gesucht = pkKem.join(',')

      return (
        zeilen.find(
          (zeile) => zeile.userId === userId && zeile.pkKem.join(',') === gesucht,
        ) ?? null
      )
    },

    async legeAn(neu) {
      angelegt.push(neu)

      // `(user_id, public_key)` ist eindeutig: Der zweite Schreiber bekommt
      // nichts zurück, so wie `on conflict do nothing`. Die Prüfung steht
      // bewusst ohne `await` davor: Der Index in Postgres ist atomar, und ein
      // Double, das dazwischen die Kontrolle abgibt, verspräche weniger als die
      // Datenbank hält.
      const gesucht = neu.pkKem.join(',')
      const schonDa = zeilen.some(
        (zeile) => zeile.userId === neu.userId && zeile.pkKem.join(',') === gesucht,
      )

      if (schonDa) {
        return null
      }

      const zeile: GeraeteschluesselZeile = {
        id: `geraet-${naechsteId++}`,
        userId: neu.userId,
        pkKem: neu.pkKem,
        pkSig: neu.pkSig,
        label: neu.label,
        angelegtAm: `2026-08-2${naechsteId}T10:00:00Z`,
      }

      zeilen.push(zeile)

      return zeile
    },

    async nachId(id) {
      return zeilen.find((zeile) => zeile.id === id) ?? null
    },

    async fuerBenutzer(userId) {
      return zeilen.filter((zeile) => zeile.userId === userId)
    },

    async benenneUm(id, label) {
      const zeile = zeilen.find((kandidat) => kandidat.id === id)

      if (zeile !== undefined) {
        zeile.label = label
      }
    },
  }

  return { tabelle, zeilen, angelegt }
}

let dieses: Geraeteidentitaet
let anderes: Geraeteidentitaet

beforeEach(async () => {
  dieses = await testidentitaet(1)
  anderes = await testidentitaet(2)
})

describe('Registrierung', () => {
  it('legt die öffentlichen Schlüssel mit Label an', async () => {
    const { tabelle, zeilen } = speicherTabelle()

    const geraet = await registriereGeraet(tabelle, dieses, {
      userId: ANNA,
      label: 'iPhone von Anna',
    })

    expect(zeilen).toHaveLength(1)
    expect(geraet.label).toBe('iPhone von Anna')
    expect(geraet.diesesGeraet).toBe(true)
    expect(geraet.pruefcode).toBe(dieses.pruefcode)
  })

  it('schickt keinen privaten Schlüssel mit', async () => {
    // Der Seed verlässt das Gerät nie (§3.1). Geprüft wird an dem, was der
    // Tabelle übergeben wurde, nicht an dem, was sie speichert: Was hier
    // ankommt, geht eine Zeile später über die Leitung.
    const { tabelle, angelegt } = speicherTabelle()

    await registriereGeraet(tabelle, dieses, { userId: ANNA, label: 'iPhone von Anna' })

    const uebergeben = JSON.stringify(angelegt.map((eintrag) => [...eintrag.pkKem, ...eintrag.pkSig]))

    expect(uebergeben).not.toContain([...dieses.kem.geheim].join(','))
    expect(uebergeben).not.toContain([...dieses.signatur.geheim.ed25519].join(','))
    expect(uebergeben).not.toContain([...dieses.signatur.geheim.mldsa].join(','))
  })

  it('legt beim zweiten Start keine zweite Zeile an', async () => {
    const { tabelle, zeilen } = speicherTabelle()

    const erstes = await registriereGeraet(tabelle, dieses, { userId: ANNA, label: 'iPhone' })
    const zweites = await registriereGeraet(tabelle, dieses, { userId: ANNA, label: 'iPhone' })

    expect(zeilen).toHaveLength(1)
    expect(zweites.id).toBe(erstes.id)
  })

  it('überschreibt ein selbst vergebenes Label nicht', async () => {
    // Sonst hieße das Gerät nach jedem Neuladen wieder "iPhone".
    const { tabelle } = speicherTabelle()

    const geraet = await registriereGeraet(tabelle, dieses, { userId: ANNA, label: 'iPhone' })
    await benenneGeraetUm(tabelle, geraet.id, 'Annas altes iPhone')

    const nachNeuladen = await registriereGeraet(tabelle, dieses, { userId: ANNA, label: 'iPhone' })

    expect(nachNeuladen.label).toBe('Annas altes iPhone')
  })

  it('nimmt hin, dass ein zweiter Tab schneller war', async () => {
    // Beide Tabs finden nichts, beide legen an, einer verliert am eindeutigen
    // Index. Der Verlierer darf nicht scheitern, sondern muss die Zeile des
    // Gewinners bekommen, es ist dieselbe Identität.
    const { tabelle, zeilen } = speicherTabelle()

    const [links, rechts] = await Promise.all([
      registriereGeraet(tabelle, dieses, { userId: ANNA, label: 'iPhone' }),
      registriereGeraet(tabelle, dieses, { userId: ANNA, label: 'iPhone' }),
    ])

    expect(zeilen).toHaveLength(1)
    expect(links.id).toBe(rechts.id)
  })
})

describe('Die eigene Geräteliste (§7 Profil)', () => {
  it('nennt zu jedem Gerät Label und sechsstelligen Prüfcode', async () => {
    const { tabelle } = speicherTabelle()
    await registriereGeraet(tabelle, dieses, { userId: ANNA, label: 'iPhone von Anna' })
    await registriereGeraet(tabelle, anderes, { userId: ANNA, label: 'Laptop von Anna' })

    const liste = await eigeneGeraete(tabelle, dieses, ANNA)

    expect(liste.map((geraet) => geraet.label)).toEqual(['iPhone von Anna', 'Laptop von Anna'])
    for (const geraet of liste) {
      expect(geraet.pruefcode).toMatch(/^\d{6}$/)
    }
  })

  it('markiert genau das Gerät, an dem man sitzt', async () => {
    const { tabelle } = speicherTabelle()
    await registriereGeraet(tabelle, anderes, { userId: ANNA, label: 'Laptop von Anna' })
    await registriereGeraet(tabelle, dieses, { userId: ANNA, label: 'iPhone von Anna' })

    const liste = await eigeneGeraete(tabelle, dieses, ANNA)

    expect(liste.filter((geraet) => geraet.diesesGeraet).map((geraet) => geraet.label)).toEqual([
      'iPhone von Anna',
    ])
  })

  it('stellt das eigene Gerät nach vorn', async () => {
    const { tabelle } = speicherTabelle()
    await registriereGeraet(tabelle, anderes, { userId: ANNA, label: 'Laptop von Anna' })
    await registriereGeraet(tabelle, dieses, { userId: ANNA, label: 'iPhone von Anna' })

    const liste = await eigeneGeraete(tabelle, dieses, ANNA)

    expect(liste[0]?.label).toBe('iPhone von Anna')
  })

  it('gibt dem Prüfcode dieselben Ziffern wie dem Fingerprint über beide Schlüssel', async () => {
    const { tabelle } = speicherTabelle()
    await registriereGeraet(tabelle, anderes, { userId: ANNA, label: 'Laptop von Anna' })

    const [laptop] = await eigeneGeraete(tabelle, dieses, ANNA)

    expect(laptop?.pruefcode).toBe(await geraetePruefcode(anderes.pkKem, anderes.pkSig))
  })

  it('nennt ein Gerät ohne Label beim Notnamen statt gar nicht', async () => {
    const { tabelle } = speicherTabelle()
    await tabelle.legeAn({ userId: ANNA, pkKem: dieses.pkKem, pkSig: dieses.pkSig, label: null })

    const [geraet] = await eigeneGeraete(tabelle, dieses, ANNA)

    expect(geraet?.label).toBe('Unbenanntes Gerät')
  })
})
