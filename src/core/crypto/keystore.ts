/**
 * Keystore: die Geräteidentität und wie sie liegt (DESIGN.md §3.1, §3.6).
 *
 * Ein Gerät hat zwei Keypairs — ML-KEM-768 + X25519 für den Schlüsseltransport,
 * ML-DSA-65 + Ed25519 für Signaturen. Aufbewahrt wird von beiden nur der Seed:
 * 96 Byte gegen 32 Byte KEM-Geheimnis plus 4064 Byte Signaturgeheimnis, und vor
 * allem nur eine Sache, die verschlüsselt liegen muss.
 *
 * **Der Seed verlässt das Gerät nie.** Er liegt in IndexedDB, at-rest
 * verschlüsselt unter einem AES-GCM-`CryptoKey` mit `extractable: false`, der
 * daneben liegt. Das schützt gegen einen Angreifer, der den Speicher ausliest —
 * eine Erweiterung, ein Backup, ein fremder Prozess: Er bekommt den Envelope
 * und einen Schlüssel, dessen Bytes WebCrypto nicht herausrückt. Es schützt
 * nicht gegen fremden Code im eigenen Origin, der den Schlüssel schlicht
 * benutzt; dagegen steht die CSP aus §11.2, keine Kryptographie.
 *
 * **Es gibt keinen Weg zurück.** Kein portabler Seed, keine
 * Wiederherstellungsphrase, keine Ableitung aus dem Login-Passwort — die
 * Begründungen stehen in §3.6, die Konsequenz als Grenze 1 in §11. Wer das
 * Gerät verliert, verliert die Entschlüsselbarkeit; die einzige Absicherung ist
 * ein zweites Gerät oder eine zweite Person im Fall.
 */

import { entschluessele, verschluessele } from './aead'
import { webcrypto, zufallsBytes } from './bytes'
import { geraetePruefcode, fingerabdruck } from './fingerprint'
import {
  KEM_GEHEIM_LAENGE,
  erzeugeKemSchluesselpaar,
  type KemSchluesselpaar,
} from './kem'
import {
  SIGNATUR_SEED_LAENGE,
  erzeugeSignaturSchluesselpaar,
  pkSigBytes,
  type SignaturSchluesselpaar,
} from './sign'

export const KEYSTORE_DB = 'loveneverdies-keystore'

export const KEYSTORE_STORE = 'identitaet'

const KEYSTORE_DB_VERSION = 1

/** Der `CryptoKey`, unter dem der Seed liegt. Nicht extrahierbar, nie exportiert. */
export const WRAPPING_SCHLUESSEL = 'wrapping-key'

/** Der Envelope aus §3.2, in dem der Seed steckt. */
export const SEED_SCHLUESSEL = 'seed'

/** 32 Byte KEM (`sk_u`), dahinter 64 Byte für die beiden Signaturverfahren. */
export const GERAETE_SEED_LAENGE = KEM_GEHEIM_LAENGE + SIGNATUR_SEED_LAENGE

/** Der Keystore war nicht zu öffnen oder sein Inhalt nicht zu lesen. */
export class KeystoreFehler extends Error {
  constructor(nachricht: string, options?: ErrorOptions) {
    super(nachricht, options)
    this.name = 'KeystoreFehler'
  }
}

export type Geraeteidentitaet = {
  kem: KemSchluesselpaar
  signatur: SignaturSchluesselpaar
  /** `pk_u`, 1216 Byte. Geht im Klartext an den Server. */
  pkKem: Uint8Array
  /** ML-DSA-65-pk ‖ Ed25519-pk, 1984 Byte. Geht im Klartext an den Server. */
  pkSig: Uint8Array
  /** `SHA-256("LN-fp-v1" ‖ pk_kem ‖ pk_sig)` (§3.6). */
  fingerabdruck: Uint8Array
  /** Die sechs Ziffern, die beim Koppeln mündlich verglichen werden (§3.6). */
  pruefcode: string
}

function indexedDbOderFehler(): IDBFactory {
  if (typeof indexedDB === 'undefined') {
    throw new KeystoreFehler(
      'IndexedDB ist nicht verfügbar. Ohne sie kann dieses Gerät keine Identität behalten.',
    )
  }

  return indexedDB
}

function alsVersprechen<T>(anfrage: IDBRequest<T>): Promise<T> {
  return new Promise((erfuellen, ablehnen) => {
    anfrage.onsuccess = () => erfuellen(anfrage.result)
    anfrage.onerror = () => ablehnen(anfrage.error)
  })
}

async function oeffneDb(): Promise<IDBDatabase> {
  const anfrage = indexedDbOderFehler().open(KEYSTORE_DB, KEYSTORE_DB_VERSION)

  anfrage.onupgradeneeded = () => {
    if (!anfrage.result.objectStoreNames.contains(KEYSTORE_STORE)) {
      anfrage.result.createObjectStore(KEYSTORE_STORE)
    }
  }

  const geoeffnet = alsVersprechen(anfrage)

  /*
   * `blocked` feuert, wenn ein anderer Tab die alte Version noch offen hält.
   * Danach kommt weder `success` noch `error` — ohne diesen Zweig bliebe das
   * Versprechen für immer offen, und mit ihm der Aufruf, der darauf wartet:
   * Profil stünde auf „lädt", ohne Fehler und ohne zweiten Versuch. Heute
   * unerreichbar, weil die Version bei 1 steht; erreichbar beim ersten
   * Versionssprung, und dann genau bei dem, der die App offen hatte.
   */
  const blockiert = new Promise<never>((_, ablehnen) => {
    anfrage.onblocked = () =>
      ablehnen(
        new KeystoreFehler(
          'Der Keystore ist in einem anderen Tab dieser App noch offen. Bitte schließen Sie die übrigen Tabs und laden Sie neu.',
        ),
      )
  })

  try {
    return await Promise.race([geoeffnet, blockiert])
  } catch (ursache) {
    if (ursache instanceof KeystoreFehler) {
      throw ursache
    }

    throw new KeystoreFehler('Der Keystore war nicht zu öffnen.', { cause: ursache })
  }
}

type Abgelegt = {
  wrappingSchluessel: CryptoKey
  seedEnvelope: Uint8Array
}

/**
 * Liest beide Sätze und schreibt die übergebenen, falls noch keine da sind —
 * alles in **einer** `readwrite`-Transaktion.
 *
 * Hier liegt der Schutz gegen das zweite Keypair: IndexedDB serialisiert
 * `readwrite`-Transaktionen auf demselben Store, also gewinnt der erste
 * Schreiber, und jeder weitere Aufruf bekommt das Vorgefundene zurück. Deshalb
 * wird der Kandidat vorher erzeugt und hier nur noch abgelegt oder verworfen:
 * Zwischen Lesen und Schreiben darf kein `await` auf etwas anderes liegen, sonst
 * schließt der Browser die Transaktion.
 */
async function legeAnOderLies(kandidat: Abgelegt): Promise<Abgelegt> {
  const db = await oeffneDb()

  try {
    return await new Promise<Abgelegt>((erfuellen, ablehnen) => {
      const transaktion = db.transaction(KEYSTORE_STORE, 'readwrite')
      const store = transaktion.objectStore(KEYSTORE_STORE)

      const gelesenerSchluessel = store.get(WRAPPING_SCHLUESSEL)
      const gelesenerSeed = store.get(SEED_SCHLUESSEL)

      let ergebnis: Abgelegt = kandidat

      transaktion.oncomplete = () => erfuellen(ergebnis)
      transaktion.onerror = () => ablehnen(transaktion.error)
      transaktion.onabort = () => ablehnen(transaktion.error)

      gelesenerSeed.onsuccess = () => {
        const vorhandenerSchluessel = gelesenerSchluessel.result as CryptoKey | undefined
        const vorhandenerSeed = gelesenerSeed.result as Uint8Array | undefined

        if (vorhandenerSchluessel !== undefined && vorhandenerSeed !== undefined) {
          ergebnis = {
            wrappingSchluessel: vorhandenerSchluessel,
            seedEnvelope: vorhandenerSeed,
          }
          return
        }

        // Halb beschriebener Keystore: Ein abgebrochener erster Start hat
        // genau einen der beiden Sätze hinterlassen. Der Seed ohne seinen
        // Schlüssel ist Datenmüll, der Schlüssel ohne Seed auch — beide werden
        // überschrieben, statt einen Zustand zu retten, aus dem nichts folgt.
        store.put(kandidat.wrappingSchluessel, WRAPPING_SCHLUESSEL)
        store.put(kandidat.seedEnvelope, SEED_SCHLUESSEL)
      }
    })
  } catch (ursache) {
    throw new KeystoreFehler('Der Keystore war nicht zu beschreiben.', { cause: ursache })
  } finally {
    db.close()
  }
}

async function lies(): Promise<Abgelegt | null> {
  const db = await oeffneDb()

  try {
    const store = db.transaction(KEYSTORE_STORE).objectStore(KEYSTORE_STORE)

    const wrappingSchluessel = (await alsVersprechen(store.get(WRAPPING_SCHLUESSEL))) as
      | CryptoKey
      | undefined
    const seedEnvelope = (await alsVersprechen(store.get(SEED_SCHLUESSEL))) as
      | Uint8Array
      | undefined

    if (wrappingSchluessel === undefined || seedEnvelope === undefined) {
      return null
    }

    return { wrappingSchluessel, seedEnvelope }
  } catch (ursache) {
    throw new KeystoreFehler('Der Keystore war nicht zu lesen.', { cause: ursache })
  } finally {
    db.close()
  }
}

/**
 * Erzeugt den Schlüssel, unter dem der Seed liegt.
 *
 * `generateKey` mit `extractable: false` statt `importKey` über eigene Bytes:
 * So gibt es die Rohbytes zu keinem Zeitpunkt im JavaScript-Heap. Der Schlüssel
 * ist nur als Handle greifbar, und ein Handle lässt sich zwar benutzen, aber
 * nicht abschreiben.
 */
async function erzeugeWrappingSchluessel(): Promise<CryptoKey> {
  return webcrypto().subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
    'encrypt',
    'decrypt',
  ])
}

async function identitaetAusSeed(seed: Uint8Array): Promise<Geraeteidentitaet> {
  if (seed.length !== GERAETE_SEED_LAENGE) {
    throw new KeystoreFehler(
      `Der Geräte-Seed muss ${GERAETE_SEED_LAENGE} Byte lang sein, war ${seed.length}.`,
    )
  }

  const kem = erzeugeKemSchluesselpaar(seed.subarray(0, KEM_GEHEIM_LAENGE))
  const signatur = erzeugeSignaturSchluesselpaar(seed.subarray(KEM_GEHEIM_LAENGE))

  const pkKem = kem.oeffentlich
  const pkSig = pkSigBytes(signatur.oeffentlich)

  return {
    kem,
    signatur,
    pkKem,
    pkSig,
    fingerabdruck: await fingerabdruck(pkKem, pkSig),
    pruefcode: await geraetePruefcode(pkKem, pkSig),
  }
}

async function entpacke(abgelegt: Abgelegt): Promise<Geraeteidentitaet> {
  try {
    return await identitaetAusSeed(
      await entschluessele(abgelegt.wrappingSchluessel, abgelegt.seedEnvelope),
    )
  } catch (ursache) {
    if (ursache instanceof KeystoreFehler) {
      throw ursache
    }

    // Der Seed ist da, aber nicht zu entschlüsseln. Neu erzeugen wäre hier
    // falsch: Es sähe aus wie ein frisches Gerät und würde stillschweigend
    // alles unlesbar machen, was an den alten Schlüssel gewrappt ist.
    throw new KeystoreFehler(
      'Der abgelegte Seed war nicht zu entschlüsseln. Die Identität dieses Geräts ist beschädigt.',
      { cause: ursache },
    )
  }
}

/**
 * Ein Modulzustand für den Normalfall: Innerhalb eines Tabs fragt jeder Aufruf
 * dieselbe laufende Zusage ab, statt eine zweite Runde Schlüsselerzeugung
 * anzustoßen. Über Tabs hinweg trägt das nicht — dort entscheidet die
 * Transaktion in {@link legeAnOderLies}.
 */
let laufend: Promise<Geraeteidentitaet> | null = null

/**
 * Die Identität dieses Geräts, erzeugt beim ersten Aufruf und ab dann dieselbe.
 *
 * Läuft still: §7 sieht zwischen der Anmeldung und der Ansichtswahl keinen
 * sichtbaren Zwischenschritt vor.
 */
export function ladeOderErzeugeIdentitaet(): Promise<Geraeteidentitaet> {
  laufend ??= (async () => {
    const seed = zufallsBytes(GERAETE_SEED_LAENGE)
    const wrappingSchluessel = await erzeugeWrappingSchluessel()

    const kandidat: Abgelegt = {
      wrappingSchluessel,
      seedEnvelope: await verschluessele(wrappingSchluessel, seed),
    }

    return entpacke(await legeAnOderLies(kandidat))
  })().catch((fehler: unknown) => {
    // Ein gescheiterter Versuch darf den nächsten nicht vergiften: Ein Tab, dem
    // IndexedDB einmal wegbricht, soll es beim nächsten Aufruf erneut versuchen.
    laufend = null
    throw fehler
  })

  return laufend
}

/** Die abgelegte Identität, oder `null`, wenn dieses Gerät noch keine hat. */
export async function ladeIdentitaet(): Promise<Geraeteidentitaet | null> {
  const abgelegt = await lies()

  return abgelegt === null ? null : entpacke(abgelegt)
}
