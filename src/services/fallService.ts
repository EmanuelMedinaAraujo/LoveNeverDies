/**
 * Einen Trauerfall oder Vorsorgefall anlegen und Fälle wieder lesen (DESIGN.md §2, §3.1, §3.5, §3.6).
 *
 * Das Anlegen erzeugt `K_c` und `K_cat` (und bei Vorsorge zusätzlich `K_v`),
 * verschlüsselt den Namen unter `K_c` und wrappt die Schlüssel an das eigene
 * Gerät: Der Server sieht nie mehr als Ciphertext. Das Lesen macht denselben
 * Weg rückwärts: Wraps holen, Signatur prüfen, entpacken, entschlüsseln.
 *
 * Beim Trauerfall entsteht zugleich die Aufgabenliste der Juristinnen: Der
 * Katalogstand wird eingefroren und der Katalog instanziiert (§8). Ein
 * Vorsorgefall hat dagegen keine Aufgaben und friert den Katalog noch nicht
 * ein (`catalog_version = null`).
 *
 * Jeder Fehlschlag beim Lesen ergibt einen gesperrten Fall, kein Wurf: ein
 * fehlender Wrap, ein unauffindbares `wrapped_by`, eine ungültige Signatur, ein
 * GCM-Tag, der nicht passt. Der Fall bleibt in der Liste, die App zeigt ihn,
 * aber sie liest nichts daraus (§3.6). Das gilt nicht fürs Anlegen: Dort ist
 * ein Fehler ein Fehler, und `legeTrauerfallAn` bzw. `legeVorsorgefallAn` wirft ihn.
 */

import { entschluessele, erzeugeAesSchluessel, verschluessele } from '../core/crypto/aead'
import { bytesText, textBytes } from '../core/crypto/bytes'
import { stimmtTresorCommitment, tresorCommitment } from '../core/crypto/commitment'
import { entkapsele, kapsele } from '../core/crypto/kem'
import type { Geraeteidentitaet } from '../core/crypto/keystore'
import { signaturSchluesselAusBytes } from '../core/crypto/sign'
import { entpackeSchluessel, wrappeSchluessel, type WrapKontext } from '../core/crypto/wrap'
import type { FaelleTabelle, Fallstatus, FallZeile } from '../core/db/faelle'
import type { SchluesselwrapTabelle, SchluesselwrapZeile } from '../core/db/fallschluessel'
import type { GeraeteschluesselTabelle, GeraeteschluesselZeile } from '../core/db/geraeteschluessel'
import type { InhalteTabelle } from '../core/db/inhalte'
import type { TresorTabelle } from '../core/db/tresor'
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

export type Vorsorgefallangaben = {
  personName: string
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
   * Tresorschlüssel `K_v`, nur auf Geräten des Preparers vorhanden (§3.5).
   */
  kv: Uint8Array | null
  preparerId: string | null
  vaultCommitment: Uint8Array | null
  vaultResplitPending: boolean
  vaultK: number | null
  vaultN: number | null
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

/**
 * `2026-02-30` besteht die Form, ist aber kein Kalendertag.
 *
 * Exportiert, weil der Übergang aus der Vorsorge dasselbe Datum prüft, bevor
 * er es in den Fall-Payload schreibt (§3.5). Zwei Prüfungen wären zwei
 * Gelegenheiten, verschieden streng zu sein.
 */
export function istGueltigesSterbedatum(sterbedatum: string): boolean {
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

  if (!istGueltigesSterbedatum(angaben.sterbedatum)) {
    throw new FallFehler(`"${angaben.sterbedatum}" ist kein gültiges Sterbedatum.`)
  }
}

/**
 * Legt einen Trauerfall an: `K_c` und `K_cat` frisch, Name und Sterbedatum
 * unter `K_c`, beide Schlüssel an das eigene Gerät gewrappt, und die Aufgaben
 * aus dem Rechtskatalog gleich dazu.
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
    kv: null,
    preparerId: null,
    vaultCommitment: null,
    vaultResplitPending: false,
    vaultK: null,
    vaultN: null,
    katalogVersion: katalog.version,
  }

  try {
    await instanziiereKatalog(inhalte, fall, [], katalog)
  } catch {
    /* Instanziierung wird beim nächsten Start nachgeholt. */
  }

  return fall
}

/**
 * Legt einen Vorsorgefall für die eigene Person an (§2, §3.5).
 *
 * Der Fall hat den Status 'vorsorge', kein Sterbedatum und keine Aufgaben.
 * Erzeugt K_v, wrappt ihn an das eigene Gerät und speichert das
 * vault_commitment auf dem Fall.
 */
export async function legeVorsorgefallAn(
  faelle: FaelleTabelle,
  identitaet: Geraeteidentitaet,
  geraeteId: string,
  angaben: Vorsorgefallangaben,
): Promise<LesbarerFall> {
  const personName = angaben.personName.trim()
  if (personName === '') {
    throw new FallFehler('Der Name der vorsorgenden Person darf nicht leer sein.')
  }

  const id = crypto.randomUUID()
  const kidFall = `case_${id}:1`
  const kidKatalog = `cat_${id}`

  const kc = erzeugeAesSchluessel()
  const kcat = erzeugeAesSchluessel()
  const kv = erzeugeAesSchluessel()

  const empfaenger = { geraeteId, pkKem: identitaet.pkKem }

  const kapselungKv = kapsele(identitaet.pkKem)

  const [payloadVerschluesselt, wrapFall, wrapKatalog, vaultWrappedKey, vaultCommitment] =
    await Promise.all([
      verschluessele(kc, textBytes(JSON.stringify({ personName, sterbedatum: null }))),
      wrappeSchluessel(kc, empfaenger, { fallId: id, kid: kidFall }, identitaet.signatur.geheim),
      wrappeSchluessel(kcat, empfaenger, { fallId: id, kid: kidKatalog }, identitaet.signatur.geheim),
      verschluessele(kapselungKv.geteiltesGeheimnis, kv),
      tresorCommitment(kv),
    ])

  await faelle.legeVorsorgefallAn({
    id,
    kidFall,
    kidKatalog,
    payload: payloadVerschluesselt,
    geraeteId,
    wrapFall,
    wrapKatalog,
    vaultCommitment,
    vaultKemCt: kapselungKv.kemCt,
    vaultWrappedKey,
  })

  return {
    zustand: 'lesbar',
    id,
    status: 'vorsorge',
    personName,
    sterbedatum: null,
    kid: kidFall,
    kc,
    kcat,
    kv,
    preparerId: null,
    vaultCommitment,
    vaultResplitPending: false,
    vaultK: null,
    vaultN: 0,
    katalogVersion: null,
  }
}

/**
 * Löscht einen Vorsorgefall samt Tresor kaskadierend (§3.5).
 */
export async function loescheVorsorgefall(faelle: FaelleTabelle, fallId: string): Promise<void> {
  await faelle.loescheVorsorgefall(fallId)
}

/**
 * Entpackt einen einzelnen Wrap: Absender nachschlagen, Signatur prüfen, entpacken.
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
 * Liest einen einzelnen Fall: Wraps holen, entpacken, Payload entschlüsseln
 * und bei Vorsorge K_v aus vault_key_wraps entpacken (§3.5).
 */
async function leseFall(
  zeile: FallZeile,
  wraps: SchluesselwrapTabelle,
  geraete: GeraeteschluesselTabelle,
  identitaet: Geraeteidentitaet,
  geraeteId: string,
  tresor?: TresorTabelle,
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

  let kv: Uint8Array | null = null
  if (zeile.status === 'vorsorge' && tresor !== undefined) {
    try {
      const wrapKv = await tresor.wrapFuerGeraet(zeile.id, geraeteId)
      if (wrapKv !== null) {
        const geteiltesGeheimnis = entkapsele(wrapKv.kemCt, identitaet.kem.geheim)
        const kandidatKv = await entschluessele(geteiltesGeheimnis, wrapKv.wrappedKey)
        if (zeile.vaultCommitment !== null) {
          const gueltig = await stimmtTresorCommitment(kandidatKv, zeile.vaultCommitment)
          if (!gueltig) {
            throw new FallFehler('Der Tresorschlüssel stimmt nicht mit dem hinterlegten Commitment überein.')
          }
        }
        kv = kandidatKv
      }
    } catch (ursache) {
      throw new FallFehler(`Der Tresorschlüssel konnte nicht entpackt werden: ${alsNachricht(ursache)}`)
    }
  }

  const angaben = JSON.parse(bytesText(await entschluessele(kc, zeile.payload))) as {
    personName: string
    sterbedatum?: string | null
  }

  return {
    zustand: 'lesbar',
    id: zeile.id,
    status: zeile.status,
    personName: angaben.personName,
    sterbedatum: angaben.sterbedatum ?? null,
    kid: zeile.currentKid,
    kc,
    kcat,
    kv,
    preparerId: zeile.preparerId,
    vaultCommitment: zeile.vaultCommitment,
    vaultResplitPending: zeile.vaultResplitPending,
    vaultK: zeile.vaultK,
    vaultN: zeile.vaultN,
    katalogVersion: zeile.katalogVersion,
  }
}

/**
 * Die eigenen Fälle, jeweils lesbar oder gesperrt.
 */
export async function ladeFaelle(
  faelle: FaelleTabelle,
  wraps: SchluesselwrapTabelle,
  geraete: GeraeteschluesselTabelle,
  identitaet: Geraeteidentitaet,
  geraeteId: string,
  tresor?: TresorTabelle,
): Promise<Fall[]> {
  const zeilen = await faelle.eigene()

  return Promise.all(
    zeilen.map(async (zeile): Promise<Fall> => {
      try {
        return await leseFall(zeile, wraps, geraete, identitaet, geraeteId, tresor)
      } catch (fehler) {
        return { zustand: 'gesperrt', id: zeile.id, grund: alsNachricht(fehler) }
      }
    }),
  )
}
