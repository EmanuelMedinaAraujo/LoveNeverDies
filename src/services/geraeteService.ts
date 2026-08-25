/**
 * Geräteregistrierung und Geräteliste (DESIGN.md §3.6, §7).
 *
 * Nach der Anmeldung meldet sich das Gerät still beim Server an: öffentliche
 * Schlüssel hoch, Label dazu, fertig. Sichtbar wird davon nichts, bis jemand in
 * Profil nachsieht, und der Prüfcode, der dort steht, wird erst beim Koppeln
 * (§3.6) gebraucht. Stabil und ablesbar muss er trotzdem ab jetzt sein.
 *
 * Die Registrierung läuft bei jedem Start. Sie ist deshalb idempotent
 * gebaut: suchen, anlegen, und wenn dabei jemand schneller war, das Ergebnis
 * des Schnelleren nehmen. Zwei Zeilen für dasselbe Gerät wären kein
 * Schönheitsfehler: `key_wraps` zeigte danach auf eine davon, und welche,
 * entschiede der Zufall.
 */

import { geraetePruefcode } from '../core/crypto/fingerprint'
import type { Geraeteidentitaet } from '../core/crypto/keystore'
import type {
  GeraeteschluesselTabelle,
  GeraeteschluesselZeile,
} from '../core/db/geraeteschluessel'

/** Wie ein Gerät ohne eigenes Label in der Liste heißt. */
export const NOTNAME = 'Unbenanntes Gerät'

/** Ein Gerät, so wie Profil → Geräte es zeigt. */
export type Geraet = {
  id: string
  label: string
  /** Die sechs Ziffern aus §3.6, über beide öffentlichen Schlüssel. */
  pruefcode: string
  angelegtAm: string
  /** Das Gerät, an dem gerade jemand sitzt. Genau eines in der Liste. */
  diesesGeraet: boolean
}

export class GeraeteFehler extends Error {
  constructor(nachricht: string, options?: ErrorOptions) {
    super(nachricht, options)
    this.name = 'GeraeteFehler'
  }
}

function istDasselbeGeraet(zeile: GeraeteschluesselZeile, identitaet: Geraeteidentitaet): boolean {
  // Der öffentliche KEM-Schlüssel identifiziert die Zeile: Er ist zusammen mit
  // `user_id` eindeutig. Über die `device_keys.id` liefe es auch, aber die
  // müsste dann irgendwo liegen, und der Keystore soll nichts aufbewahren, was
  // sich aus dem Seed ergibt.
  return (
    zeile.pkKem.length === identitaet.pkKem.length &&
    zeile.pkKem.every((byte, i) => byte === identitaet.pkKem[i])
  )
}

async function alsGeraet(
  zeile: GeraeteschluesselZeile,
  identitaet: Geraeteidentitaet,
): Promise<Geraet> {
  return {
    id: zeile.id,
    label: zeile.label ?? NOTNAME,
    pruefcode: await geraetePruefcode(zeile.pkKem, zeile.pkSig),
    angelegtAm: zeile.angelegtAm,
    diesesGeraet: istDasselbeGeraet(zeile, identitaet),
  }
}

export type Registrierung = {
  /** Clerk `sub`. Steht im Klartext in `device_keys.user_id` (§3.3). */
  userId: string
  /** Nur beim ersten Mal. Ein später vergebenes Label bleibt unangetastet. */
  label: string | null
}

/**
 * Meldet dieses Gerät an, oder findet es wieder.
 *
 * @throws {GeraeteFehler} wenn weder Suchen noch Anlegen eine Zeile ergibt.
 * Das kann nur passieren, wenn die Tabelle zwischen beidem etwas gelöscht hat,
 * und dann ist Weiterlaufen schlimmer als Anhalten.
 */
export async function registriereGeraet(
  tabelle: GeraeteschluesselTabelle,
  identitaet: Geraeteidentitaet,
  { userId, label }: Registrierung,
): Promise<Geraet> {
  const vorhanden = await tabelle.finde(userId, identitaet.pkKem)

  if (vorhanden !== null) {
    return alsGeraet(vorhanden, identitaet)
  }

  const angelegt = await tabelle.legeAn({
    userId,
    pkKem: identitaet.pkKem,
    pkSig: identitaet.pkSig,
    label,
  })

  if (angelegt !== null) {
    return alsGeraet(angelegt, identitaet)
  }

  // Jemand war schneller. Seine Zeile ist die richtige.
  const fremdAngelegt = await tabelle.finde(userId, identitaet.pkKem)

  if (fremdAngelegt === null) {
    throw new GeraeteFehler(
      'Dieses Gerät ließ sich weder finden noch anlegen. Die Geräteliste ist nicht verlässlich.',
    )
  }

  return alsGeraet(fremdAngelegt, identitaet)
}

/**
 * Die Aufrufe, die gerade laufen, je Benutzer und Gerät.
 *
 * Modulweiter Zustand, und das ist hier die Aussage: Ein Bündel gilt genau so
 * weit, wie ein Dokument reicht. Zwei Tabs haben zwei Module und laufen sich
 * weiterhin ins Gehege — dafür ist der eindeutige Index da, nicht diese Map.
 */
const laufendeRegistrierungen = new Map<string, Promise<Geraet>>()

function buendelSchluessel(userId: string, pkKem: Uint8Array): string {
  // Der Strich trennt sauber: In einer Clerk-`sub` kommt er nicht vor, und die
  // Bytes danach sind Zahlen mit Kommas. Dieselben zwei Felder wie der
  // eindeutige Index `device_keys_pk_unique (user_id, public_key)`.
  return `${userId}|${pkKem.join(',')}`
}

/**
 * Wie `registriereGeraet`, aber ohne denselben Aufruf zweimal ans Netz zu
 * lassen.
 *
 * Wer dazukommt, während für dieselbe `userId` und denselben `pkKem` schon
 * einer läuft, bekommt dessen Promise. Der zweite Durchlauf schickt damit gar
 * kein `insert` mehr, und die Konsole bleibt beim ersten Start still: Das
 * doppelte `useEffect` aus `StrictMode` erzeugt kein 23505 mehr, das wie ein
 * kaputter Zustand aussieht (Issue #21).
 *
 * Ein Bündel, kein Cache: Der Eintrag fällt weg, sobald der Aufruf fertig ist
 * — auch wenn er scheitert. Sonst hinge ein Netzfehler für den Rest der
 * Sitzung fest, und ein umbenanntes Gerät hieße nach dem Neuladen wieder wie
 * beim ersten Start.
 */
export function registriereGeraetGebuendelt(
  tabelle: GeraeteschluesselTabelle,
  identitaet: Geraeteidentitaet,
  registrierung: Registrierung,
): Promise<Geraet> {
  const schluessel = buendelSchluessel(registrierung.userId, identitaet.pkKem)
  const laufender = laufendeRegistrierungen.get(schluessel)

  if (laufender !== undefined) {
    return laufender
  }

  const lauf = registriereGeraet(tabelle, identitaet, registrierung).finally(() => {
    laufendeRegistrierungen.delete(schluessel)
  })

  laufendeRegistrierungen.set(schluessel, lauf)

  return lauf
}

/**
 * Die eigenen Geräte, das aktuelle zuerst.
 *
 * Vorn steht, was die Person am Telefon vorlesen soll: "Dieses Gerät · iPhone
 * von Anna · Prüfcode 481 253". Danach nach Alter, damit die Reihenfolge sich
 * nicht bei jedem Aufruf ändert.
 */
export async function eigeneGeraete(
  tabelle: GeraeteschluesselTabelle,
  identitaet: Geraeteidentitaet,
  userId: string,
): Promise<Geraet[]> {
  const zeilen = await tabelle.fuerBenutzer(userId)
  const geraete = await Promise.all(zeilen.map((zeile) => alsGeraet(zeile, identitaet)))

  return geraete.sort((links, rechts) => {
    if (links.diesesGeraet !== rechts.diesesGeraet) {
      return links.diesesGeraet ? -1 : 1
    }

    return links.angelegtAm.localeCompare(rechts.angelegtAm)
  })
}

/** Das Label, das die Person selbst vergibt (§3.6). */
export async function benenneGeraetUm(
  tabelle: GeraeteschluesselTabelle,
  id: string,
  label: string,
): Promise<void> {
  const getrimmt = label.trim()

  if (getrimmt === '') {
    throw new GeraeteFehler('Ein Gerätename darf nicht leer sein.')
  }

  await tabelle.benenneUm(id, getrimmt)
}
