/**
 * Der Ciphertext-Cache in IndexedDB (DESIGN.md §5).
 *
 * §5 ist hier wörtlich zu nehmen: „Der lokale Cache speichert Ciphertext,
 * byteidentisch zum Server, und entschlüsselt beim Start in den Speicher. Der
 * Cache auf dem Gerät ist damit genauso verschlüsselt wie der Server."
 *
 * Das ist keine Sparsamkeit, sondern die Bedingung dafür, dass der Cache
 * überhaupt sein darf. Ein Gerät, das entschlüsselte Aufgaben ablegte, machte
 * jede Browserdatensicherung und jede neugierige Erweiterung zum Leseweg in den
 * Fall — und die Kette aus §3.1 endete nicht im Speicher, sondern auf der
 * Festplatte. Deshalb gehen hier ausschliesslich `InhaltZeile` hinein: dieselben
 * Felder, die `items` trägt, mit denselben Bytes.
 *
 * **Ein zweiter Speicher neben dem Keystore, kein gemeinsamer.** Der Keystore
 * (§3.1) hält die Identität dieses Geräts und darf nie gelöscht werden; dieser
 * Cache ist jederzeit wegwerfbar, weil sein Inhalt auf dem Server steht. Zwei
 * Datenbanken, damit ein Aufräumen des einen nie das andere mitnimmt.
 */

import type { InhaltZeile } from './inhalte'

export const CACHE_DB = 'loveneverdies-cache'

const CACHE_DB_VERSION = 1

/** Die Zeilen, byteidentisch zu `items`. */
const INHALTE = 'inhalte'

/** Das Wasserzeichen je Fall (§5). */
const STAND = 'stand'

/** Die Warteschlange der noch nicht übertragenen Mutationen (§5). */
export const QUEUE = 'queue'

/** Der Cache war nicht zu öffnen, zu lesen oder zu beschreiben. */
export class CacheFehler extends Error {
  constructor(nachricht: string, options?: ErrorOptions) {
    super(nachricht, options)
    this.name = 'CacheFehler'
  }
}

export type Ciphertextcache = {
  /**
   * Der zuletzt abgelegte Stand eines Falls.
   *
   * Ein unbekannter Fall ergibt `{ zeilen: [], wasserzeichen: 0 }` — und 0 ist
   * genau die vollständige Resynchronisation aus §5, also kein Sonderfall,
   * sondern der Anfang derselben Rechnung.
   */
  lies(fallId: string): Promise<{ zeilen: InhaltZeile[]; wasserzeichen: number }>

  /**
   * Legt geänderte Zeilen ab und rückt das Wasserzeichen — in **einer**
   * Transaktion.
   *
   * Rückte das Wasserzeichen vor den Zeilen, verlöre ein Gerät, dem beim
   * Schreiben der Strom ausgeht, genau die Zeilen dazwischen: Der nächste
   * Delta-Abruf setzt oberhalb des Wasserzeichens an und holte sie nie wieder.
   *
   * @param zeilen nur die geänderten. Zeilen verschwinden nie — ein Tombstone
   * ist eine geänderte Zeile, kein Löschen (§5).
   */
  schreibe(fallId: string, zeilen: InhaltZeile[], wasserzeichen: number): Promise<void>
}

function indexedDbOderFehler(): IDBFactory {
  if (typeof indexedDB === 'undefined') {
    throw new CacheFehler(
      'IndexedDB ist nicht verfügbar. Ohne sie kann dieses Gerät keinen Stand behalten.',
    )
  }

  return indexedDB
}

/** Dasselbe wie {@link alsVersprechen}, für Aufrufer ausserhalb dieser Datei. */
export function alsVersprechenAusStore<T>(anfrage: IDBRequest<T>): Promise<T> {
  return alsVersprechen(anfrage)
}

function alsVersprechen<T>(anfrage: IDBRequest<T>): Promise<T> {
  return new Promise((erfuellen, ablehnen) => {
    anfrage.onsuccess = () => erfuellen(anfrage.result)
    anfrage.onerror = () => ablehnen(anfrage.error)
  })
}

/**
 * Öffnet die Cache-Datenbank und legt beim ersten Mal alle drei Stores an.
 *
 * Alle drei zusammen, obwohl die Queue in `core/sync/queue.ts` wohnt: Ein
 * `onupgradeneeded` je Modul brauchte je eine eigene Version, und zwei Module,
 * die dieselbe Datenbank unabhängig voneinander hochzählen, sperren sich
 * gegenseitig aus. Das Schema gehört an eine Stelle.
 */
export async function oeffneCacheDb(): Promise<IDBDatabase> {
  const anfrage = indexedDbOderFehler().open(CACHE_DB, CACHE_DB_VERSION)

  anfrage.onupgradeneeded = () => {
    const db = anfrage.result

    if (!db.objectStoreNames.contains(INHALTE)) {
      db.createObjectStore(INHALTE, { keyPath: ['fallId', 'id'] })
    }

    if (!db.objectStoreNames.contains(STAND)) {
      db.createObjectStore(STAND, { keyPath: 'fallId' })
    }

    if (!db.objectStoreNames.contains(QUEUE)) {
      // `autoIncrement`, weil §5 „beim Reconnect abgearbeitet" verlangt und das
      // die Reihenfolge des Anhängens meint. Ein Zeitstempel trüge sie nicht:
      // Zwei Mutationen in derselben Millisekunde stünden in beliebiger Folge,
      // und ein Häkchen käme womöglich vor der Aufgabe an, an der es hängt.
      db.createObjectStore(QUEUE, { autoIncrement: true })
    }
  }

  const geoeffnet = alsVersprechen(anfrage)

  // Siehe `keystore.ts`: Nach `blocked` kommt weder `success` noch `error`, das
  // Versprechen bliebe für immer offen und mit ihm der Aufruf, der darauf wartet.
  const blockiert = new Promise<never>((_, ablehnen) => {
    anfrage.onblocked = () =>
      ablehnen(
        new CacheFehler(
          'Der lokale Zwischenspeicher ist in einem anderen Tab dieser App noch offen. Bitte schliessen Sie die übrigen Tabs und laden Sie neu.',
        ),
      )
  })

  try {
    return await Promise.race([geoeffnet, blockiert])
  } catch (ursache) {
    if (ursache instanceof CacheFehler) {
      throw ursache
    }

    throw new CacheFehler('Der lokale Zwischenspeicher war nicht zu öffnen.', { cause: ursache })
  }
}

/** Führt Arbeit in einer Transaktion aus und schliesst die Datenbank danach. */
export async function inTransaktion<T>(
  stores: string[],
  modus: IDBTransactionMode,
  was: string,
  arbeit: (transaktion: IDBTransaction) => Promise<T> | T,
): Promise<T> {
  const db = await oeffneCacheDb()

  try {
    const transaktion = db.transaction(stores, modus)

    // Das Ergebnis wird zuerst abgewartet, der Abschluss danach: Ein `put`, das
    // die Transaktion abbricht, meldet den Grund über `onabort` und nicht über
    // die einzelne Anfrage.
    const [ergebnis] = await Promise.all([
      arbeit(transaktion),
      new Promise<void>((erfuellen, ablehnen) => {
        transaktion.oncomplete = () => erfuellen()
        transaktion.onerror = () => ablehnen(transaktion.error)
        transaktion.onabort = () => ablehnen(transaktion.error)
      }),
    ])

    return ergebnis
  } catch (ursache) {
    if (ursache instanceof CacheFehler) {
      throw ursache
    }

    throw new CacheFehler(was, { cause: ursache })
  } finally {
    db.close()
  }
}

/** Der Datensatz, wie er in IndexedDB liegt: die Zeile selbst, nichts daneben. */
type Abgelegt = InhaltZeile

export function idbCiphertextcache(): Ciphertextcache {
  return {
    lies(fallId) {
      return inTransaktion(
        [INHALTE, STAND],
        'readonly',
        'Der lokale Stand dieses Falls war nicht zu lesen.',
        async (transaktion) => {
          const zeilen = await alsVersprechen(
            transaktion
              .objectStore(INHALTE)
              // Der Schlüssel ist `[fallId, id]`, und ein `IDBKeyRange` über
              // diesem Paar trifft genau die Zeilen eines Falls — sortiert nach
              // `id` und damit in Anlagereihenfolge (§4). Ein eigener Index
              // wäre ein zweiter Weg zu derselben Ordnung.
              .getAll(IDBKeyRange.bound([fallId], [fallId, []])) as IDBRequest<Abgelegt[]>,
          )

          const stand = await alsVersprechen(
            transaktion.objectStore(STAND).get(fallId) as IDBRequest<
              { fallId: string; wasserzeichen: number } | undefined
            >,
          )

          return { zeilen, wasserzeichen: stand?.wasserzeichen ?? 0 }
        },
      )
    },

    schreibe(fallId, zeilen, wasserzeichen) {
      return inTransaktion(
        [INHALTE, STAND],
        'readwrite',
        'Der lokale Stand dieses Falls war nicht zu schreiben.',
        (transaktion) => {
          const inhalte = transaktion.objectStore(INHALTE)

          for (const zeile of zeilen) {
            // Die Zeile, wie sie kam. Kein Umbau, keine zusätzlichen Felder:
            // Was hier abgelegt wird, ist das, was der Server geschickt hat.
            inhalte.put(zeile)
          }

          transaktion.objectStore(STAND).put({ fallId, wasserzeichen })
        },
      )
    },
  }
}
