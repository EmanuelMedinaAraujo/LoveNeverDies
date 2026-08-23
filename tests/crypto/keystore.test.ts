import 'fake-indexeddb/auto'

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { leseChiffretext } from '../../src/core/crypto/envelope'
import { KEM_OEFFENTLICH_LAENGE } from '../../src/core/crypto/kem'
import {
  KEYSTORE_DB,
  KEYSTORE_STORE,
  SEED_SCHLUESSEL,
  WRAPPING_SCHLUESSEL,
} from '../../src/core/crypto/keystore'
import { pkSigBytes } from '../../src/core/crypto/sign'

/**
 * Nahtstelle: der Keystore aus DESIGN.md §3.1 und §3.6.
 *
 * Er ist die einzige Stelle, an der ein privater Schlüssel dieses Projekts
 * dauerhaft liegt. Geprüft wird deshalb nicht nur, dass er funktioniert,
 * sondern auch, wie er liegt: verschlüsselt, unter einem Schlüssel, den
 * WebCrypto nicht mehr herausgibt, und über einen Neustart hinweg derselbe.
 *
 * `fake-indexeddb` statt eines eingesetzten Speicher-Doubles: Was hier
 * schiefgehen kann, geht in IndexedDB schief — die Transaktion, die zweimal
 * schreibt, der strukturierte Klon, der einen `CryptoKey` verliert. Ein Double
 * mit einer `Map` würde beides nie zeigen.
 */

/** Was ein Neuladen der Seite mit dem Modulzustand macht, ohne die Datenbank anzufassen. */
async function nachNeuladen() {
  vi.resetModules()
  return import('../../src/core/crypto/keystore')
}

/** Was ein neu installierter Browser mit der Datenbank macht. */
async function leereDatenbank() {
  vi.resetModules()

  await new Promise<void>((erfuellen, ablehnen) => {
    const anfrage = indexedDB.deleteDatabase(KEYSTORE_DB)
    anfrage.onsuccess = () => erfuellen()
    anfrage.onerror = () => ablehnen(anfrage.error)
    anfrage.onblocked = () => erfuellen()
  })
}

/** Liest an der API vorbei, was wirklich auf der Platte liegt. */
async function rohsatz(schluessel: string): Promise<unknown> {
  const db = await new Promise<IDBDatabase>((erfuellen, ablehnen) => {
    const anfrage = indexedDB.open(KEYSTORE_DB)
    anfrage.onsuccess = () => erfuellen(anfrage.result)
    anfrage.onerror = () => ablehnen(anfrage.error)
  })

  try {
    return await new Promise<unknown>((erfuellen, ablehnen) => {
      const anfrage = db.transaction(KEYSTORE_STORE).objectStore(KEYSTORE_STORE).get(schluessel)
      anfrage.onsuccess = () => erfuellen(anfrage.result)
      anfrage.onerror = () => ablehnen(anfrage.error)
    })
  } finally {
    db.close()
  }
}

beforeEach(async () => {
  await leereDatenbank()
})

describe('Erste Anmeldung auf einem Gerät', () => {
  it('erzeugt beide Keypairs in den Längen aus §3.1', async () => {
    const { ladeOderErzeugeIdentitaet } = await nachNeuladen()

    const identitaet = await ladeOderErzeugeIdentitaet()

    expect(identitaet.pkKem).toHaveLength(KEM_OEFFENTLICH_LAENGE)
    expect([...identitaet.pkSig]).toEqual([...pkSigBytes(identitaet.signatur.oeffentlich)])
    expect(identitaet.pkSig).toHaveLength(1952 + 32)
  })

  it('liefert einen sechsstelligen Prüfcode über beide Schlüssel', async () => {
    const { ladeOderErzeugeIdentitaet } = await nachNeuladen()
    const { geraetePruefcode } = await import('../../src/core/crypto/fingerprint')

    const identitaet = await ladeOderErzeugeIdentitaet()

    expect(identitaet.pruefcode).toMatch(/^\d{6}$/)
    expect(identitaet.pruefcode).toBe(
      await geraetePruefcode(identitaet.pkKem, identitaet.pkSig),
    )
  })

  it('findet vorher keine Identität vor', async () => {
    const { ladeIdentitaet } = await nachNeuladen()

    expect(await ladeIdentitaet()).toBeNull()
  })
})

describe('Wie der Seed liegt (§3.1)', () => {
  it('legt ihn ausschließlich verschlüsselt ab', async () => {
    const { ladeOderErzeugeIdentitaet } = await nachNeuladen()

    const identitaet = await ladeOderErzeugeIdentitaet()
    const abgelegt = await rohsatz(SEED_SCHLUESSEL)

    expect(abgelegt).toBeInstanceOf(Uint8Array)

    const blob = abgelegt as Uint8Array
    // Ein Envelope aus §3.2, kein nackter Seed: Magic, Version, AEAD-Byte.
    expect(() => leseChiffretext(blob)).not.toThrow()

    // Und der geheime KEM-Schlüssel steht nirgends darin im Klartext.
    const alsText = [...blob].join(',')
    expect(alsText).not.toContain([...identitaet.kem.geheim].join(','))
  })

  it('schützt ihn unter einem Schlüssel, den WebCrypto nicht mehr herausgibt', async () => {
    const { ladeOderErzeugeIdentitaet } = await nachNeuladen()

    await ladeOderErzeugeIdentitaet()
    const wrappingSchluessel = (await rohsatz(WRAPPING_SCHLUESSEL)) as CryptoKey

    expect(wrappingSchluessel.extractable).toBe(false)
    await expect(crypto.subtle.exportKey('raw', wrappingSchluessel)).rejects.toThrow()
  })
})

describe('Über Neuladen und Neustart hinweg (§3.6)', () => {
  it('benutzt dieselbe Identität weiter und erzeugt kein zweites Keypair', async () => {
    const erstes = await nachNeuladen()
    const vorher = await erstes.ladeOderErzeugeIdentitaet()
    const abgelegterSeed = await rohsatz(SEED_SCHLUESSEL)

    const zweites = await nachNeuladen()
    const nachher = await zweites.ladeOderErzeugeIdentitaet()

    expect([...nachher.pkKem]).toEqual([...vorher.pkKem])
    expect([...nachher.pkSig]).toEqual([...vorher.pkSig])
    expect(nachher.pruefcode).toBe(vorher.pruefcode)
    // Der Seed wurde nicht neu geschrieben, sondern gelesen.
    expect([...(abgelegterSeed as Uint8Array)]).toEqual([
      ...((await rohsatz(SEED_SCHLUESSEL)) as Uint8Array),
    ])
  })

  it('gibt zwei nebenläufigen Aufrufen dieselbe Identität', async () => {
    // React im StrictMode ruft jeden Effekt zweimal auf, und der zweite Aufruf
    // startet, bevor der erste geschrieben hat. Ohne Absicherung entstünden
    // zwei Keypairs, und eines davon wäre ab dem nächsten Neuladen verloren —
    // samt allem, was daran gewrappt war.
    const { ladeOderErzeugeIdentitaet } = await nachNeuladen()

    const [links, rechts] = await Promise.all([
      ladeOderErzeugeIdentitaet(),
      ladeOderErzeugeIdentitaet(),
    ])

    expect([...links.pkKem]).toEqual([...rechts.pkKem])
    expect([...links.pkSig]).toEqual([...rechts.pkSig])
  })

  it('hält auch dann zusammen, wenn zwei frisch geladene Module gleichzeitig anlaufen', async () => {
    // Zwei Tabs derselben App. Der Modulzustand hilft hier nicht, weil jeder
    // Tab seinen eigenen hat — nur die Transaktion in IndexedDB entscheidet.
    const [links, rechts] = await Promise.all([
      import('../../src/core/crypto/keystore').then((m) => m.ladeOderErzeugeIdentitaet()),
      nachNeuladen().then((m) => m.ladeOderErzeugeIdentitaet()),
    ])

    expect([...links.pkKem]).toEqual([...rechts.pkKem])
  })
})
