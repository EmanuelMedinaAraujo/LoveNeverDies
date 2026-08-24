import 'fake-indexeddb/auto'
import { afterEach, describe, expect, it } from 'vitest'
import { bytesText, textBytes } from '../../src/core/crypto/bytes'
import { CACHE_DB, idbCiphertextcache, type Ciphertextcache } from '../../src/core/db/idb'
import type { InhaltZeile } from '../../src/core/db/inhalte'

/**
 * Nahtstelle: der Ciphertext-Cache (DESIGN.md §5).
 *
 * Die Zusage aus §5 ist wörtlich zu nehmen: „Der lokale Cache speichert
 * Ciphertext, byteidentisch zum Server, und entschlüsselt beim Start in den
 * Speicher. Der Cache auf dem Gerät ist damit genauso verschlüsselt wie der
 * Server."
 *
 * Deshalb prüft dieser Test nicht nur, dass etwas zurückkommt, sondern **was**
 * in IndexedDB liegt: dieselben Bytes, kein Klartext, kein entschlüsseltes
 * Nebenfeld. Ein Cache, der beim Schreiben freundlich mitentschlüsselte, wäre
 * von aussen nicht zu unterscheiden — bis jemand die Browserdaten ausliest.
 */

function zeile(id: string, seq: number, ueberschreibung: Partial<InhaltZeile> = {}): InhaltZeile {
  return {
    id,
    fallId: 'fall-1',
    seq,
    art: 'item',
    geloescht: false,
    imTresor: false,
    kid: 'case_fall-1:1',
    wrappedDek: new Uint8Array([0xaa, 0xbb, 0xcc]),
    payload: new Uint8Array([0x01, 0x02, 0x03, 0xff]),
    geaendertAm: '2026-08-24T10:00:00Z',
    ...ueberschreibung,
  }
}

function frisch(): Ciphertextcache {
  return idbCiphertextcache()
}

afterEach(async () => {
  await new Promise<void>((erfuellen) => {
    const anfrage = indexedDB.deleteDatabase(CACHE_DB)
    anfrage.onsuccess = () => erfuellen()
    anfrage.onerror = () => erfuellen()
    anfrage.onblocked = () => erfuellen()
  })
})

describe('Ciphertext-Cache', () => {
  it('gibt für einen unbekannten Fall einen leeren Stand zurück', async () => {
    // Wasserzeichen 0 heisst „vollständige Resynchronisation" (§5) und ist der
    // richtige Startwert für ein Gerät, das den Fall noch nie gesehen hat.
    expect(await frisch().lies('fall-1')).toEqual({ zeilen: [], wasserzeichen: 0 })
  })

  it('gibt zurück, was hineingeschrieben wurde', async () => {
    const cache = frisch()

    await cache.schreibe('fall-1', [zeile('a', 1), zeile('b', 2)], 2)

    expect(await cache.lies('fall-1')).toEqual({
      zeilen: [zeile('a', 1), zeile('b', 2)],
      wasserzeichen: 2,
    })
  })

  it('überdauert einen Kaltstart', async () => {
    // Der Fall aus §5: „Ein Kaltstart ohne Netz zeigt den zuletzt gecachten
    // Stand." Ein zweiter Cache über derselben IndexedDB ist genau das.
    await frisch().schreibe('fall-1', [zeile('a', 1)], 1)

    expect((await frisch().lies('fall-1')).zeilen).toEqual([zeile('a', 1)])
  })

  it('hält die Fälle auseinander', async () => {
    const cache = frisch()

    await cache.schreibe('fall-1', [zeile('a', 1)], 1)
    await cache.schreibe('fall-2', [zeile('b', 5, { fallId: 'fall-2' })], 5)

    expect((await cache.lies('fall-1')).zeilen.map((eintrag) => eintrag.id)).toEqual(['a'])
    expect(await cache.lies('fall-2')).toEqual({
      zeilen: [zeile('b', 5, { fallId: 'fall-2' })],
      wasserzeichen: 5,
    })
  })

  it('überschreibt eine Zeile, statt sie zu verdoppeln', async () => {
    const cache = frisch()

    await cache.schreibe('fall-1', [zeile('a', 1)], 1)
    await cache.schreibe('fall-1', [zeile('a', 4, { geloescht: true })], 4)

    expect(await cache.lies('fall-1')).toEqual({
      zeilen: [zeile('a', 4, { geloescht: true })],
      wasserzeichen: 4,
    })
  })

  it('gibt die Zeilen in Anlagereihenfolge zurück', async () => {
    const cache = frisch()

    await cache.schreibe('fall-1', [zeile('c', 3), zeile('a', 1), zeile('b', 2)], 3)

    expect((await cache.lies('fall-1')).zeilen.map((eintrag) => eintrag.id)).toEqual([
      'a',
      'b',
      'c',
    ])
  })

  it('legt Zeilen und Wasserzeichen zusammen ab oder gar nicht', async () => {
    /*
     * Rückte das Wasserzeichen vor den Zeilen, verlöre ein Gerät, dem beim
     * Schreiben der Strom ausgeht, genau die Zeilen dazwischen — und holte sie
     * nie wieder, weil der nächste Delta-Abruf oberhalb des Wasserzeichens
     * ansetzt. Beides gehört in eine Transaktion.
     */
    const cache = frisch()

    await cache.schreibe('fall-1', [zeile('a', 7)], 7)

    const gelesen = await cache.lies('fall-1')
    expect(gelesen.wasserzeichen).toBe(7)
    expect(gelesen.zeilen.map((eintrag) => eintrag.seq)).toEqual([7])
  })

  it('legt ausschliesslich Ciphertext ab, byteidentisch zum Server', async () => {
    /*
     * Die Zusage aus §5, an ihrer einzig prüfbaren Stelle: in der abgelegten
     * Zeile selbst. Verglichen wird gegen die Bytes, die vom Server kamen —
     * nicht gegen das, was `lies` zurückgibt, denn ein Cache, der beim
     * Schreiben entschlüsselt und beim Lesen wieder verschlüsselt, bestände
     * jeden Rundlauftest.
     */
    const klartext = 'Sterbeurkunde beantragen'
    const ciphertext = textBytes(klartext).map((byte) => byte ^ 0x5a)

    await frisch().schreibe('fall-1', [zeile('a', 1, { payload: ciphertext })], 1)

    const abgelegt = await rohAusIndexedDb()

    expect(abgelegt).toHaveLength(1)
    expect(abgelegt[0]?.payload).toEqual(ciphertext)
    expect(JSON.stringify(abgelegt)).not.toContain(klartext)
    expect(bytesText(abgelegt[0]?.payload ?? new Uint8Array())).not.toBe(klartext)
  })
})

/** Liest an der Cache-Schnittstelle vorbei, was wirklich in IndexedDB steht. */
async function rohAusIndexedDb(): Promise<{ payload: Uint8Array }[]> {
  const db = await new Promise<IDBDatabase>((erfuellen, ablehnen) => {
    const anfrage = indexedDB.open(CACHE_DB)
    anfrage.onsuccess = () => erfuellen(anfrage.result)
    anfrage.onerror = () => ablehnen(anfrage.error)
  })

  try {
    const store = db.transaction('inhalte').objectStore('inhalte')

    return await new Promise((erfuellen, ablehnen) => {
      const anfrage = store.getAll()
      anfrage.onsuccess = () => erfuellen(anfrage.result as { payload: Uint8Array }[])
      anfrage.onerror = () => ablehnen(anfrage.error)
    })
  } finally {
    db.close()
  }
}
