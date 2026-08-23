import 'fake-indexeddb/auto'

import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  KEYSTORE_DB,
  KEYSTORE_STORE,
  SEED_SCHLUESSEL,
  WRAPPING_SCHLUESSEL,
} from '../../src/core/crypto/keystore'

/**
 * Nahtstelle: was der Keystore tut, wenn der abgelegte Satz beschädigt ist
 * (DESIGN.md §3.1, §3.6).
 *
 * Der gewöhnliche Weg steht in `keystore.test.ts`. Hier geht es um die zwei
 * Zusagen, die man erst bemerkt, wenn sie fehlen:
 *
 * 1. **Ein unlesbarer Seed wird nicht ersetzt.** Neu erzeugen sähe aus wie ein
 *    frisches Gerät und machte stillschweigend alles unlesbar, was an den alten
 *    Schlüssel gewrappt ist — der Fall wäre weg, ohne Fehlermeldung.
 * 2. **Ein gescheiterter Versuch vergiftet den nächsten nicht.** Der Hook ruft
 *    erneut auf; stünde die gescheiterte Zusage weiter im Modul, bliebe das
 *    Gerät für den Rest der Sitzung ohne Identität.
 */

async function leereDatenbank() {
  vi.resetModules()

  await new Promise<void>((erfuellen, ablehnen) => {
    const anfrage = indexedDB.deleteDatabase(KEYSTORE_DB)
    anfrage.onsuccess = () => erfuellen()
    anfrage.onerror = () => ablehnen(anfrage.error)
    anfrage.onblocked = () => erfuellen()
  })
}

/** Schreibt an der API vorbei, was auf der Platte liegen soll. */
async function schreibeRoh(satz: Record<string, unknown>) {
  const db = await new Promise<IDBDatabase>((erfuellen, ablehnen) => {
    const anfrage = indexedDB.open(KEYSTORE_DB, 1)
    anfrage.onupgradeneeded = () => {
      if (!anfrage.result.objectStoreNames.contains(KEYSTORE_STORE)) {
        anfrage.result.createObjectStore(KEYSTORE_STORE)
      }
    }
    anfrage.onsuccess = () => erfuellen(anfrage.result)
    anfrage.onerror = () => ablehnen(anfrage.error)
  })

  try {
    await new Promise<void>((erfuellen, ablehnen) => {
      const transaktion = db.transaction(KEYSTORE_STORE, 'readwrite')
      const store = transaktion.objectStore(KEYSTORE_STORE)

      for (const [schluessel, wert] of Object.entries(satz)) {
        store.put(wert, schluessel)
      }

      transaktion.oncomplete = () => erfuellen()
      transaktion.onerror = () => ablehnen(transaktion.error)
    })
  } finally {
    db.close()
  }
}

/** Ein AES-GCM-Schlüssel, der zu keinem abgelegten Envelope passt. */
async function fremderSchluessel(): Promise<CryptoKey> {
  return crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
    'encrypt',
    'decrypt',
  ])
}

beforeEach(async () => {
  await leereDatenbank()
})

describe('Ein Seed, der nicht zu entschluesseln ist', () => {
  it('wird gemeldet statt stillschweigend ersetzt', async () => {
    const { ladeOderErzeugeIdentitaet } = await import('../../src/core/crypto/keystore')

    // Beides da, aber der Schluessel passt nicht zum Envelope — so sieht ein
    // teilweise wiederhergestelltes Backup aus.
    await schreibeRoh({
      [WRAPPING_SCHLUESSEL]: await fremderSchluessel(),
      [SEED_SCHLUESSEL]: new Uint8Array(64).fill(0x11),
    })

    await expect(ladeOderErzeugeIdentitaet()).rejects.toThrow(
      /Die Identität dieses Geräts ist beschädigt/,
    )
  })

  it('meldet dasselbe ueber ladeIdentitaet', async () => {
    const { ladeIdentitaet } = await import('../../src/core/crypto/keystore')

    await schreibeRoh({
      [WRAPPING_SCHLUESSEL]: await fremderSchluessel(),
      [SEED_SCHLUESSEL]: new Uint8Array(64).fill(0x11),
    })

    await expect(ladeIdentitaet()).rejects.toThrow(/beschädigt/)
  })

  it('laesst den naechsten Versuch wieder zu', async () => {
    /*
     * Der erste Aufruf scheitert an der Datenbank. Danach ist der abgelegte
     * Satz in Ordnung — und der zweite Aufruf muss ihn bekommen, statt die
     * gescheiterte Zusage von vorhin zurueckzugeben.
     */
    const { ladeOderErzeugeIdentitaet } = await import('../../src/core/crypto/keystore')

    const echtesOeffnen = indexedDB.open.bind(indexedDB)
    const kaputt = vi.spyOn(indexedDB, 'open').mockImplementation(() => {
      throw new Error('IndexedDB weg')
    })

    await expect(ladeOderErzeugeIdentitaet()).rejects.toThrow()

    kaputt.mockImplementation(echtesOeffnen)

    const identitaet = await ladeOderErzeugeIdentitaet()
    expect(identitaet.pruefcode).toMatch(/^\d{6}$/)

    kaputt.mockRestore()
  })
})

describe('Ein halb beschriebener Keystore', () => {
  it('wird ueberschrieben statt gerettet', async () => {
    /*
     * Ein abgebrochener erster Start hat genau einen der beiden Saetze
     * hinterlassen. Der Seed ohne seinen Schluessel ist Datenmuell, der
     * Schluessel ohne Seed auch.
     */
    const { ladeOderErzeugeIdentitaet } = await import('../../src/core/crypto/keystore')

    await schreibeRoh({ [SEED_SCHLUESSEL]: new Uint8Array(64).fill(0x22) })

    const identitaet = await ladeOderErzeugeIdentitaet()

    expect(identitaet.pruefcode).toMatch(/^\d{6}$/)
    expect(identitaet.pkKem.length).toBeGreaterThan(0)
  })

  it('kommt auch mit einem Schluessel ohne Seed zurecht', async () => {
    const { ladeOderErzeugeIdentitaet } = await import('../../src/core/crypto/keystore')

    await schreibeRoh({ [WRAPPING_SCHLUESSEL]: await fremderSchluessel() })

    await expect(ladeOderErzeugeIdentitaet()).resolves.toMatchObject({
      pruefcode: expect.stringMatching(/^\d{6}$/),
    })
  })
})

describe('ladeIdentitaet ohne abgelegte Identitaet', () => {
  it('liefert null statt eine zu erzeugen', async () => {
    const { ladeIdentitaet } = await import('../../src/core/crypto/keystore')

    await expect(ladeIdentitaet()).resolves.toBeNull()
  })
})
