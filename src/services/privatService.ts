/**
 * Private Aufgaben: `K_p` beschaffen, anlegen, freigeben (DESIGN.md §3.7, §7).
 *
 * Unter `K_c` geht "nur für mich" nicht, den besitzen alle. Deshalb `K_p`: ein
 * Zufallsschlüssel pro Person und pro Fall, an die eigenen Geräte gewrappt, in
 * `personal_key_wraps`. Ein privates Item liegt danach in derselben
 * `items`-Tabelle wie jedes andere und trägt keinen Marker: Wer es nicht
 * entschlüsseln kann, verwirft es still (§3.7).
 *
 * Freigeben ist kein Kopieren und kein Neuverschlüsseln, sondern genau ein
 * Umwrappen des DEKs von `K_p` auf `K_c`. Der Payload bleibt, wo er ist, der
 * DEK ändert sich nie (§3.1). Danach ist es ein gewöhnliches Item, und der
 * Codepfad ist derselbe, den die Tresorfreigabe benutzt (§3.5).
 *
 * Neben den privaten Aufgaben liegt hier die zweite Sorte privater Items: die
 * Konfiguration, heute genau ein Feld, das eigene `kenntnisAm` (§8, #12). Sie
 * steht nie im Aufgabenbaum, hat weder Eltern noch Kinder noch Abhängigkeiten
 * und ist von den beiden Strukturregeln unten deshalb ausdrücklich nicht
 * betroffen.
 *
 * Zwei Strukturregeln stehen hier und nicht in der Datenbank: Private Aufgaben
 * sind immer Wurzelaufgaben, und nichts darf von einer privaten Aufgabe
 * abhängen (§3.7, §7). `parentId` und `dependsOn` liegen verschlüsselt im
 * Payload; der Server sieht sie nie und kann deshalb nichts darüber
 * durchsetzen. Umgekehrt ist erlaubt: "meine private Ausschlagung kann erst
 * los, wenn der Erbschein da ist" funktioniert.
 */

import { entschluessele, erzeugeAesSchluessel, verschluessele } from '../core/crypto/aead'
import { hexText, textBytes, zufallsBytes } from '../core/crypto/bytes'
import { wrappeDek } from '../core/crypto/dek'
import { entkapsele, kapsele } from '../core/crypto/kem'
import type { Geraeteidentitaet } from '../core/crypto/keystore'
import type { GeraeteschluesselTabelle } from '../core/db/geraeteschluessel'
import type { InhalteTabelle } from '../core/db/inhalte'
import type {
  PersoenlicheSchluesselTabelle,
  PersoenlicherSchluesselwrapZeile,
} from '../core/db/persoenlicheschluessel'
import type { Mutation } from '../core/sync/queue'
import { uuidv7 } from '../core/uuidv7'
import {
  AufgabenFehler,
  pruefeTitel,
  verschluesselterInhalt,
  type Aufgabe,
  type Fallschluessel,
  type Konfiguration,
  type Konfigurationspayload,
} from './aufgabenService'
import { heuteIso, istKalendertag } from './fristen'
import { NIEMAND, personen, type Zugewiesene } from './zuweisung'

/** Der persönliche Schlüssel dieser Person in diesem Fall (§3.7). */
export type PersoenlicherSchluessel = {
  /** Undurchsichtig, 32 Byte Zufall in Hex. Steht so in `items.kid`. */
  kid: string
  kp: Uint8Array
}

/**
 * Ein neues `kid` für `K_p`.
 *
 * Zufall und kein sprechender Name (§3.7). Ein `privat_<user_id>` sagte über
 * die Zeile in `items` hinaus, wem sie gehört. Der Join
 * `items.kid -> personal_key_wraps.kid -> user_id` verrät das dem Server
 * ohnehin (§3.3, §11.6), und mehr soll es nicht werden: Ein `kid` wandert in
 * jedes Delta an jedes Mitglied, die Tabelle dahinter nicht.
 */
export function erzeugePersoenlichesKid(): string {
  return hexText(zufallsBytes(32))
}

/**
 * Entpackt einen persönlichen Wrap.
 *
 * Ohne Signaturprüfung, anders als bei `key_wraps` (§3.6): Absender und
 * Empfänger sind dieselbe Person, und die RLS lässt niemanden sonst an die
 * Tabelle. Es gibt niemanden, gegen den zu verifizieren wäre.
 */
async function entpacke(
  wrap: PersoenlicherSchluesselwrapZeile,
  identitaet: Geraeteidentitaet,
): Promise<PersoenlicherSchluessel> {
  const geteiltesGeheimnis = entkapsele(wrap.kemCt, identitaet.kem.geheim)

  return { kid: wrap.kid, kp: await entschluessele(geteiltesGeheimnis, wrap.wrappedKey) }
}

/**
 * Der persönliche Schlüssel dieses Geräts, oder `null`, wenn es noch keinen
 * gibt.
 *
 * Kein Wurf, wenn keiner da ist: Die meisten Menschen legen nie eine private
 * Aufgabe an, und für sie soll der Fall genauso laden wie bisher. Erzeugt wird
 * `K_p` erst, wenn jemand "Nur für mich" wirklich anhakt.
 *
 * Ein Wrap, der sich nicht entpacken lässt, wird übersprungen und nicht
 * gemeldet: Er ist entweder für ein anderes eigenes Gerät bestimmt oder
 * beschädigt. Die Frage ist, ob es einen lesbaren gibt, und die beantwortet
 * die Schleife.
 */
export async function ladePersoenlichenSchluessel(
  db: PersoenlicheSchluesselTabelle,
  fallId: string,
  geraeteId: string,
  identitaet: Geraeteidentitaet,
): Promise<PersoenlicherSchluessel | null> {
  for (const wrap of await db.fuerGeraet(fallId, geraeteId)) {
    try {
      return await entpacke(wrap, identitaet)
    } catch {
      continue
    }
  }

  return null
}

/** Wrappt `K_p` an ein Gerät derselben Person. */
async function wrappeAnGeraet(
  schluessel: PersoenlicherSchluessel,
  fallId: string,
  userId: string,
  empfaenger: { geraeteId: string; pkKem: Uint8Array },
): Promise<PersoenlicherSchluesselwrapZeile> {
  const kapselung = kapsele(empfaenger.pkKem)

  return {
    fallId,
    userId,
    kid: schluessel.kid,
    geraeteId: empfaenger.geraeteId,
    kemCt: kapselung.kemCt,
    wrappedKey: await verschluessele(kapselung.geteiltesGeheimnis, schluessel.kp),
  }
}

/**
 * Der persönliche Schlüssel dieses Falls, notfalls frisch erzeugt (§3.7).
 *
 * Frisch heißt: an *alle* registrierten Geräte dieser Person gewrappt, nicht
 * nur an dieses. Sonst läse das Telefon nicht, was am Rechner entstanden ist,
 * und die private Aufgabe wäre ausgerechnet für ihre Besitzerin die einzige,
 * die beim Gerätewechsel verschwindet.
 *
 * @param userId die eigene Kennung. Sie steht in der Zeile, und die RLS
 * vergleicht sie mit dem Token: Für eine fremde Person lässt sich hier nichts
 * anlegen (§3.7).
 */
export async function stellePersoenlichenSchluesselBereit(
  db: PersoenlicheSchluesselTabelle,
  geraete: GeraeteschluesselTabelle,
  fallId: string,
  userId: string,
  geraeteId: string,
  identitaet: Geraeteidentitaet,
): Promise<PersoenlicherSchluessel> {
  const vorhanden = await ladePersoenlichenSchluessel(db, fallId, geraeteId, identitaet)

  if (vorhanden !== null) {
    return vorhanden
  }

  const schluessel: PersoenlicherSchluessel = {
    kid: erzeugePersoenlichesKid(),
    kp: erzeugeAesSchluessel(),
  }

  const eigeneGeraete = await geraete.fuerBenutzer(userId)

  /*
   * Das eigene Gerät muss dabei sein, auch wenn die Liste es nicht mitbringt.
   * Ohne diesen Zusatz schriebe ein gerade erst registriertes Gerät, das in
   * einer veralteten Liste fehlt, einen Schlüssel, den es selbst nie wieder
   * läse: Die private Aufgabe entstünde und wäre im selben Moment weg.
   */
  const empfaenger = eigeneGeraete.some((geraet) => geraet.id === geraeteId)
    ? eigeneGeraete.map((geraet) => ({ geraeteId: geraet.id, pkKem: geraet.pkKem }))
    : [
        ...eigeneGeraete.map((geraet) => ({ geraeteId: geraet.id, pkKem: geraet.pkKem })),
        { geraeteId, pkKem: identitaet.pkKem },
      ]

  await db.schreibeWraps(
    await Promise.all(
      empfaenger.map((geraet) => wrappeAnGeraet(schluessel, fallId, userId, geraet)),
    ),
  )

  return schluessel
}

/**
 * Reicht `K_p` an ein weiteres Gerät derselben Person weiter (§3.7).
 *
 * Der Schritt, ohne den die Kopplung eines zweiten Geräts (§6) die privaten
 * Aufgaben zurückließe: Der Fall wäre lesbar, die eigenen privaten Aufgaben
 * aber nicht, und sie sähen von dort aus wie die einer anderen Person.
 *
 * Gibt es nichts weiterzugeben, passiert nichts: Wer nie etwas Privates
 * angelegt hat, hat keinen `K_p`, und einer auf Vorrat wäre ein Schlüssel ohne
 * Gegenstand.
 */
export async function uebergebePersoenlichenSchluessel(
  db: PersoenlicheSchluesselTabelle,
  fallId: string,
  userId: string,
  geraeteId: string,
  identitaet: Geraeteidentitaet,
  empfaenger: { geraeteId: string; pkKem: Uint8Array },
): Promise<void> {
  const schluessel = await ladePersoenlichenSchluessel(db, fallId, geraeteId, identitaet)

  if (schluessel === null) {
    return
  }

  await db.schreibeWraps([await wrappeAnGeraet(schluessel, fallId, userId, empfaenger)])
}

/**
 * Eine private Aufgabe: eigener DEK, Payload darunter, DEK unter `K_p`.
 *
 * Immer eine Wurzelaufgabe und immer ohne Abhängigkeiten (§3.7). Beides steht
 * hier als Tatsache und nicht als Prüfung: Es gibt keinen Parameter, über den
 * ein Aufrufer etwas anderes verlangen könnte, und damit auch keine Stelle, an
 * der die Regel eines Tages umgangen wird.
 *
 * @param wer die anlegende Person, die damit gleich eingetragen ist (§7). Bei
 * einer privaten Aufgabe ist das ohnehin die einzige, die sie sieht.
 */
export async function mutationPrivatAnlegen(
  fall: Pick<Fallschluessel, 'id'>,
  schluessel: PersoenlicherSchluessel,
  titel: string,
  wer: Zugewiesene | null = null,
): Promise<Mutation> {
  const { id, wrappedDek, payload } = await verschluesselterInhalt(
    { id: fall.id, kid: schluessel.kid, kc: schluessel.kp },
    uuidv7(),
    {
      typ: 'aufgabe',
      titel: pruefeTitel(titel),
      beschreibung: '',
      erledigt: false,
      notizen: '',
      parentId: null,
      dependsOn: [],
      assignee: wer === null ? NIEMAND : personen([wer]),
      katalog: null,
    },
  )

  return {
    op: 'anlegen',
    itemId: id,
    fallId: fall.id,
    art: 'item',
    kid: schluessel.kid,
    wrappedDek,
    payload,
    ts: Date.now(),
  }
}

/**
 * Gibt eine private Aufgabe für alle frei (§3.7).
 *
 * Der DEK wandert von `K_p` auf `K_c` und sonst nichts: kein neuer Payload,
 * keine neue Zeile, keine neue ID. Danach ist es ein gewöhnliches Item, das
 * jedes Mitglied sieht, und die Zuweisung entscheidet wie überall darüber, wer
 * es ändern darf (§7).
 *
 * Nicht über die Offline-Queue: Sie kennt Anlegen, Ändern und Löschen (§5), und
 * ein Umwrappen wäre eine vierte Operation für einen Handgriff, den man genau
 * einmal je Aufgabe tut. Der Preis ist, dass Freigeben eine Verbindung
 * braucht; bei einem Schritt, den man bewusst geht und nicht zurücknehmen
 * kann, ist das die ehrlichere Antwort als ein "erledigt", das noch stundenlang
 * in einer Queue liegt.
 *
 * @throws {AufgabenFehler} wenn die Aufgabe gar nicht privat ist. Ein zweiter
 * Klick auf eine bereits freigegebene Aufgabe wrappte den DEK sonst ein
 * zweites Mal unter `K_c` und ergäbe eine Zeile, die niemand mehr liest.
 */
export async function gibFuerAlleFrei(
  inhalte: InhalteTabelle,
  fall: Fallschluessel,
  schluessel: PersoenlicherSchluessel,
  aufgabe: Aufgabe,
): Promise<void> {
  if (!aufgabe.privat || aufgabe.kid !== schluessel.kid) {
    throw new AufgabenFehler('Diese Aufgabe ist nicht privat; sie sehen ohnehin alle.')
  }

  await inhalte.umwrappe(aufgabe.id, fall.kid, await wrappeDek(fall.kc, aufgabe.dek))
}

/**
 * Prüft, was §3.7 über den Baum sagt, bevor eine Abhängigkeit gespeichert wird.
 *
 * Nichts darf von einer privaten Aufgabe abhängen: Die anderen hielten sonst
 * eine UUID, zu der es für sie keine Aufgabe gibt, und die abhängige Aufgabe
 * bliebe dauerhaft blockiert oder würde fälschlich freigegeben (§7). Umgekehrt
 * ist es erlaubt, und deshalb prüft diese Funktion nur eine Richtung:
 * "meine private Ausschlagung kann erst los, wenn der Erbschein da ist"
 * funktioniert.
 *
 * @param abhaengig die Aufgabe, die warten soll.
 * @param dependsOn die neue Liste ganz (§7).
 * @param aufgaben alles, was dieses Gerät entschlüsselt hat.
 * @throws {AufgabenFehler} mit einem Satz für die Oberfläche.
 */
export function pruefeAbhaengigkeiten(
  abhaengig: Aufgabe,
  dependsOn: string[],
  aufgaben: Aufgabe[],
): void {
  if (abhaengig.privat) {
    // Eine private Aufgabe darf warten, worauf sie will: Ihre Besitzerin sieht
    // beide Seiten, und niemand sonst sieht die Verknüpfung überhaupt.
    return
  }

  const privat = aufgaben.find((kandidat) => kandidat.privat && dependsOn.includes(kandidat.id))

  if (privat !== undefined) {
    throw new AufgabenFehler(
      `Von einer privaten Aufgabe kann nichts abhängen: „${privat.titel}". Machen Sie sie erst für alle sichtbar.`,
    )
  }
}

/**
 * Ein Kenntnisdatum, geprüft, oder ein Wurf.
 *
 * Zwei Prüfungen, und beide sind Rechtsschutz und keine Formsache (§8). Ein
 * Datum, das kein Kalendertag ist, ergäbe eine Aufgabe, die stumm fristenlos
 * bleibt, obwohl jemand etwas eingetragen hat. Ein Datum in der Zukunft ergäbe
 * ein Fristende, das später liegt als das wirkliche: Aus einem vertippten Jahr
 * würde eine versäumte Ausschlagungsfrist, und die kostet den ganzen Nachlass.
 *
 * @param heute der Kalendertag, gegen den geprüft wird: als Parameter, damit
 * ein Test einen Tag vorgeben kann.
 */
function pruefeKenntnisdatum(kenntnisAm: string | null, heute: string): string | null {
  if (kenntnisAm === null) {
    // Zurücknehmen muss gehen: Wer sich vertan hat, soll das Feld leeren
    // können, statt mit einem falschen Datum weiterzuleben. Danach ist die
    // Aufgabe wieder fristenlos und sagt das auch (§8).
    return null
  }

  if (!istKalendertag(kenntnisAm)) {
    throw new AufgabenFehler('Ein Kenntnisdatum ist ein Kalendertag, etwa 2026-05-12.')
  }

  if (kenntnisAm > heute) {
    throw new AufgabenFehler('Ein Kenntnisdatum liegt nicht in der Zukunft.')
  }

  return kenntnisAm
}

/**
 * Das erste eigene Kenntnisdatum: ein privates Konfigurations-Item unter `K_p`
 * (§3.7, §8).
 *
 * Dieselbe Kette wie bei einer privaten Aufgabe, nur mit dem anderen Payload:
 * eigener DEK, Payload darunter, DEK unter `K_p`. Für die anderen Mitglieder
 * ist es eine Zeile, die sie nicht entschlüsseln können und still verwerfen —
 * und mehr sollen sie darüber auch nicht erfahren, denn wann jemand erfahren
 * hat, dass er Erbe ist, geht seine Geschwister nichts an.
 */
export async function mutationKenntnisAnlegen(
  fall: Pick<Fallschluessel, 'id'>,
  schluessel: PersoenlicherSchluessel,
  kenntnisAm: string | null,
  heute: string = heuteIso(),
): Promise<Mutation> {
  const payload: Konfigurationspayload = {
    typ: 'konfiguration',
    kenntnisAm: pruefeKenntnisdatum(kenntnisAm, heute),
  }

  const { id, wrappedDek, payload: verschluesselt } = await verschluesselterInhalt(
    { id: fall.id, kid: schluessel.kid, kc: schluessel.kp },
    uuidv7(),
    payload,
  )

  return {
    op: 'anlegen',
    itemId: id,
    fallId: fall.id,
    art: 'item',
    kid: schluessel.kid,
    wrappedDek,
    payload: verschluesselt,
    ts: Date.now(),
  }
}

/**
 * Ein geändertes Kenntnisdatum unter demselben DEK (§3.1).
 *
 * Geändert und nicht neu angelegt: Ein zweites Konfigurations-Item wäre eine
 * zweite Wahrheit über denselben Tag, und welche davon gilt, entschiede dann
 * die Reihenfolge der IDs statt der Mensch, der es eingetragen hat.
 */
export async function mutationKenntnisAendern(
  konfiguration: Konfiguration,
  kenntnisAm: string | null,
  heute: string = heuteIso(),
): Promise<Mutation> {
  const payload: Konfigurationspayload = {
    typ: 'konfiguration',
    kenntnisAm: pruefeKenntnisdatum(kenntnisAm, heute),
  }

  return {
    op: 'aendern',
    itemId: konfiguration.id,
    payload: await verschluessele(konfiguration.dek, textBytes(JSON.stringify(payload))),
    ts: Date.now(),
  }
}
