/**
 * Einen Trauerfall anlegen und Fälle wieder lesen (DESIGN.md §2, §3.1, §3.6).
 *
 * Das Anlegen erzeugt `K_c` und `K_cat`, verschlüsselt Name und Sterbedatum
 * unter `K_c` und wrappt beide Schlüssel an das eigene Gerät — der Server
 * sieht nie mehr als Ciphertext. Das Lesen macht denselben Weg rückwärts: Wraps
 * holen, Signatur prüfen, entpacken, entschlüsseln.
 *
 * Beim Anlegen entsteht zugleich die Aufgabenliste der Juristinnen: Der
 * Katalogstand wird eingefroren und der Katalog instanziiert (§8). Ein neu
 * angelegter Trauerfall ist deshalb nicht leer.
 *
 * **Jeder Fehlschlag beim Lesen ergibt einen gesperrten Fall, kein Wurf** — ein
 * fehlender Wrap, ein unauffindbares `wrapped_by`, eine ungültige Signatur, ein
 * GCM-Tag, der nicht passt. Der Fall bleibt in der Liste, die App zeigt ihn,
 * aber sie liest nichts daraus (§3.6). Das gilt nicht fürs Anlegen: Dort ist
 * ein Fehler ein Fehler, und `legeTrauerfallAn` wirft ihn.
 */

import { entschluessele, erzeugeAesSchluessel, verschluessele } from '../core/crypto/aead'
import { bytesText, textBytes } from '../core/crypto/bytes'
import type { Geraeteidentitaet } from '../core/crypto/keystore'
import { signaturSchluesselAusBytes } from '../core/crypto/sign'
import { entpackeSchluessel, wrappeSchluessel, type WrapKontext } from '../core/crypto/wrap'
import type { FaelleTabelle, Fallstatus, FallZeile } from '../core/db/faelle'
import type { SchluesselwrapTabelle, SchluesselwrapZeile } from '../core/db/fallschluessel'
import type { GeraeteschluesselTabelle, GeraeteschluesselZeile } from '../core/db/geraeteschluessel'
import type { InhalteTabelle } from '../core/db/inhalte'
import { alsNachricht } from '../core/fehler'
import { katalog as ausgelieferterKatalog } from '../content/katalog'
import type { Katalog } from '../types/katalog'
import { instanziiereKatalog } from './katalogService'

/** Anlegen oder Lesen eines Falls ist gescheitert. */
export class FallFehler extends Error {
  constructor(nachricht: string, options?: ErrorOptions) {
    super(nachricht, options)
    this.name = 'FallFehler'
  }
}

export type Trauerfallangaben = {
  personName: string
  /** ISO `YYYY-MM-DD`. */
  sterbedatum: string
}

export type LesbarerFall = {
  zustand: 'lesbar'
  id: string
  status: Fallstatus
  personName: string
  sterbedatum: string | null
  /** `current_kid`, unter dem `kc` steht. */
  kid: string
  kc: Uint8Array
  kcat: Uint8Array
  /**
   * Der eingefrorene Katalogstand (§8). `null`, solange der Fall in der
   * Vorsorge steht und noch keine Aufgaben hat.
   */
  katalogVersion: string | null
}

export type GesperrterFall = {
  zustand: 'gesperrt'
  id: string
  /** Ein Satz für die Oberfläche. */
  grund: string
}

export type Fall = LesbarerFall | GesperrterFall

const STERBEDATUM_FORM = /^(\d{4})-(\d{2})-(\d{2})$/

/** `2026-02-30` besteht die Form, ist aber kein Kalendertag. */
function istGueltigesDatum(sterbedatum: string): boolean {
  const treffer = STERBEDATUM_FORM.exec(sterbedatum)

  if (treffer === null) {
    return false
  }

  const [, jahrText, monatText, tagText] = treffer
  const jahr = Number(jahrText)
  const monat = Number(monatText)
  const tag = Number(tagText)

  const datum = new Date(Date.UTC(jahr, monat - 1, tag))

  return (
    datum.getUTCFullYear() === jahr && datum.getUTCMonth() === monat - 1 && datum.getUTCDate() === tag
  )
}

function pruefeAngaben(angaben: Trauerfallangaben): void {
  if (angaben.personName.trim() === '') {
    throw new FallFehler('Der Name der verstorbenen Person darf nicht leer sein.')
  }

  if (!istGueltigesDatum(angaben.sterbedatum)) {
    throw new FallFehler(`"${angaben.sterbedatum}" ist kein gültiges Sterbedatum.`)
  }
}

/**
 * Legt einen Trauerfall an: `K_c` und `K_cat` frisch, Name und Sterbedatum
 * unter `K_c`, beide Schlüssel an das eigene Gerät gewrappt — und die Aufgaben
 * aus dem Rechtskatalog gleich dazu.
 *
 * Der Katalogstand friert dabei ein (§8). Ein direkt in `trauerfall` angelegter
 * Fall tut das sofort, nach derselben Regel wie der Übergang aus der Vorsorge
 * und ohne Sonderfall.
 *
 * **Scheitert das Instanziieren, gilt der Fall trotzdem als angelegt.** Er ist
 * vollständig da, lesbar und trägt seinen Katalogstand; was fehlt, sind Items,
 * deren IDs jedes Gerät nachrechnen kann. Ein Wurf machte daraus die Meldung
 * „Der Fall war nicht anzulegen" — und der zweite Versuch legte einen zweiten
 * Fall zu derselben verstorbenen Person an, den niemand wieder loswird.
 *
 * @param katalog der Stand, den dieser Build mitbringt (§8). Voreingestellt der
 * ausgelieferte; die Tests geben einen eigenen vor.
 * @throws {FallFehler} bei ungültigen Angaben oder wenn das Anlegen scheitert.
 */
export async function legeTrauerfallAn(
  faelle: FaelleTabelle,
  inhalte: InhalteTabelle,
  identitaet: Geraeteidentitaet,
  geraeteId: string,
  angaben: Trauerfallangaben,
  katalog: Katalog = ausgelieferterKatalog(),
): Promise<LesbarerFall> {
  pruefeAngaben(angaben)

  const id = crypto.randomUUID()
  const kidFall = `case_${id}:1`
  const kidKatalog = `cat_${id}`

  const kc = erzeugeAesSchluessel()
  const kcat = erzeugeAesSchluessel()

  const empfaenger = { geraeteId, pkKem: identitaet.pkKem }

  const [payloadVerschluesselt, wrapFall, wrapKatalog] = await Promise.all([
    verschluessele(kc, textBytes(JSON.stringify(angaben))),
    wrappeSchluessel(kc, empfaenger, { fallId: id, kid: kidFall }, identitaet.signatur.geheim),
    wrappeSchluessel(kcat, empfaenger, { fallId: id, kid: kidKatalog }, identitaet.signatur.geheim),
  ])

  await faelle.legeTrauerfallAn({
    id,
    kidFall,
    kidKatalog,
    payload: payloadVerschluesselt,
    katalogVersion: katalog.version,
    geraeteId,
    wrapFall,
    wrapKatalog,
  })

  const fall: LesbarerFall = {
    zustand: 'lesbar',
    id,
    status: 'trauerfall',
    personName: angaben.personName,
    sterbedatum: angaben.sterbedatum,
    kid: kidFall,
    kc,
    kcat,
    katalogVersion: katalog.version,
  }

  try {
    // Ohne Bestand: Den Fall gibt es seit einem Augenblick, Items kann er keine
    // haben. Das `on conflict` in `legeAlleNeuen` trägt trotzdem — ein zweites
    // Gerät kann in derselben Sekunde nicht instanziieren, ein zweiter Anlauf
    // dieses Geräts nach einem Abbruch aber schon.
    await instanziiereKatalog(inhalte, fall, [], katalog)
  } catch {
    /*
     * Nachgeholt wird es beim nächsten Laden: `useAufgaben` instanziiert, sobald
     * der Bestand einmal mit dem Server abgeglichen ist, und rechnet dabei
     * dieselben IDs aus (§8). Der Fall ist bis dahin ein Trauerfall ohne
     * Aufgaben — unvollständig, aber nicht falsch, und in ein paar Sekunden von
     * selbst behoben.
     */
  }

  return fall
}

/**
 * Entpackt einen einzelnen Wrap: Absender nachschlagen, Signatur prüfen, entpacken.
 *
 * @param absenderCache Beide Wraps eines Falls stammen in diesem Stand vom
 * selben anlegenden Gerät (§3.1) — ohne Cache holte `leseFall` dieselbe
 * `device_keys`-Zeile zweimal.
 */
async function entpackeWrap(
  wrap: SchluesselwrapZeile,
  kontext: WrapKontext,
  geraete: GeraeteschluesselTabelle,
  eigenerKemGeheim: Uint8Array,
  absenderCache: Map<string, Promise<GeraeteschluesselZeile | null>>,
): Promise<Uint8Array> {
  let absenderAnfrage = absenderCache.get(wrap.wrappedBy)

  if (absenderAnfrage === undefined) {
    absenderAnfrage = geraete.nachId(wrap.wrappedBy)
    absenderCache.set(wrap.wrappedBy, absenderAnfrage)
  }

  const absender = await absenderAnfrage

  if (absender === null) {
    throw new FallFehler(
      `Das Gerät, das den Schlüssel zu "${kontext.kid}" gewrappt hat, ist nicht mehr auffindbar.`,
    )
  }

  return entpackeSchluessel(
    wrap,
    kontext,
    eigenerKemGeheim,
    signaturSchluesselAusBytes(absender.pkSig),
  )
}

/**
 * Liest einen einzelnen Fall: beide Wraps holen, entpacken, Payload
 * entschlüsseln.
 *
 * @throws bei jedem Fehlschlag — der Aufrufer fängt das ab und macht daraus
 * einen gesperrten Fall.
 */
async function leseFall(
  zeile: FallZeile,
  wraps: SchluesselwrapTabelle,
  geraete: GeraeteschluesselTabelle,
  identitaet: Geraeteidentitaet,
  geraeteId: string,
): Promise<LesbarerFall> {
  const kidKatalog = `cat_${zeile.id}`

  const eigeneWraps = await wraps.fuerGeraet(zeile.id, geraeteId)
  const wrapFall = eigeneWraps.find((wrap) => wrap.kid === zeile.currentKid)
  const wrapKatalog = eigeneWraps.find((wrap) => wrap.kid === kidKatalog)

  if (wrapFall === undefined || wrapKatalog === undefined) {
    throw new FallFehler('Für dieses Gerät liegt noch kein Schlüssel zu diesem Fall vor.')
  }

  const absenderCache = new Map<string, Promise<GeraeteschluesselZeile | null>>()

  const [kc, kcat] = await Promise.all([
    entpackeWrap(
      wrapFall,
      { fallId: zeile.id, kid: zeile.currentKid, geraeteId },
      geraete,
      identitaet.kem.geheim,
      absenderCache,
    ),
    entpackeWrap(
      wrapKatalog,
      { fallId: zeile.id, kid: kidKatalog, geraeteId },
      geraete,
      identitaet.kem.geheim,
      absenderCache,
    ),
  ])

  const angaben = JSON.parse(bytesText(await entschluessele(kc, zeile.payload))) as Trauerfallangaben

  return {
    zustand: 'lesbar',
    id: zeile.id,
    status: zeile.status,
    personName: angaben.personName,
    sterbedatum: angaben.sterbedatum,
    kid: zeile.currentKid,
    kc,
    kcat,
    katalogVersion: zeile.katalogVersion,
  }
}

/**
 * Die eigenen Fälle, jeweils lesbar oder gesperrt.
 *
 * Kein Fall bringt diese Funktion selbst zum Scheitern — was `faelle.eigene()`
 * liefert, ist bereits durch die RLS gefiltert, und jeder Fehlschlag beim
 * Entpacken landet als `gesperrt` in der Liste statt als Wurf.
 */
export async function ladeFaelle(
  faelle: FaelleTabelle,
  wraps: SchluesselwrapTabelle,
  geraete: GeraeteschluesselTabelle,
  identitaet: Geraeteidentitaet,
  geraeteId: string,
): Promise<Fall[]> {
  const zeilen = await faelle.eigene()

  return Promise.all(
    zeilen.map(async (zeile): Promise<Fall> => {
      try {
        return await leseFall(zeile, wraps, geraete, identitaet, geraeteId)
      } catch (fehler) {
        return { zustand: 'gesperrt', id: zeile.id, grund: alsNachricht(fehler) }
      }
    }),
  )
}
