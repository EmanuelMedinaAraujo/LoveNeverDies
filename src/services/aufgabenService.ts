/**
 * Aufgaben anlegen, ändern, abhaken und löschen (DESIGN.md §3.1, §3.3, §5).
 *
 * Die Kette ist zweistufig und immer dieselbe:
 *
 * ```
 * Anlegen  DEK erzeugen → payload = AES-GCM(DEK, Inhalt)
 *                       → wrapped_dek = AES-GCM(K_c, DEK)   → items
 * Lesen    wrapped_dek unter K_c entpacken → payload unter DEK entschlüsseln
 * Ändern   nur payload neu, derselbe DEK
 * Löschen  Tombstone, Payload und DEK werden geleert
 * ```
 *
 * Im Klartext gehen ausschließlich die Spalten aus §3.3 hinaus. Titel,
 * Beschreibung, Typ und Erledigt-Status liegen im Payload; der Server kann eine
 * Aufgabe zählen, datieren und ausliefern, lesen kann er sie nie.
 *
 * Dieser Dienst schreibt nirgends hin. Er nimmt Klartext entgegen und gibt
 * eine {@link Mutation} zurück: fertig verschlüsselt, bereit zum Anhängen an
 * die Offline-Queue (§5). Wann sie hinausgeht, entscheidet die Queue und nicht
 * der Moment des Tippens; das ist der Unterschied zwischen einer App, die im
 * Flugmodus funktioniert, und einer, die dort Fehlermeldungen zeigt.
 *
 * Nicht entschlüsselbare Items verschwinden still (§3.7). Sie gehören in
 * aller Regel einer anderen Person: Private Items liegen in derselben Tabelle
 * und tragen keinen Marker, also lädt jedes Mitglied sie mit und verwirft sie.
 * Dass dabei auch ein echter Defekt verschluckt wird, ist die bewusst
 * hingenommene Grenze aus §11.8. Deshalb zählt {@link aufgabenAusZeilen} die
 * übersprungenen Zeilen mit; anzeigen darf das ausschließlich der Dev-Modus.
 */

import { entschluessele, verschluessele } from '../core/crypto/aead'
import { bytesText, textBytes } from '../core/crypto/bytes'
import { entpackeDek, erzeugeDek, wrappeDek } from '../core/crypto/dek'
import type { InhaltZeile, NeuerInhalt } from '../core/db/inhalte'
import type { AbgelehnteMutation, Mutation } from '../core/sync/queue'
import { uuidv7 } from '../core/uuidv7'
import type { Katalogaufgabe } from '../types/katalog'
import type { PersoenlicherSchluessel } from './privatService'
import { NIEMAND, personen, zuweisungAus, type Zugewiesene, type Zuweisung } from './zuweisung'

/** Eine Aufgabe war nicht anzulegen oder nicht zu ändern. */
export class AufgabenFehler extends Error {
  constructor(nachricht: string, options?: ErrorOptions) {
    super(nachricht, options)
    this.name = 'AufgabenFehler'
  }
}

/**
 * Was der Dienst vom Fall braucht: seine ID und den Schlüssel, unter dem die
 * DEKs seiner Items liegen.
 *
 * `LesbarerFall` aus `fallService` erfüllt das; der schmalere Typ steht hier,
 * damit dieser Dienst nichts über Sterbedaten und Fallstatus wissen muss.
 */
export type Fallschluessel = {
  id: string
  /** `current_kid`, unter dem `kc` steht. */
  kid: string
  kc: Uint8Array
}

/**
 * Der persönliche Schlüssel der angemeldeten Person, oder `null` (§3.7).
 *
 * `null` ist der Normalfall und kein Sonderweg: `K_p` entsteht erst, wenn
 * jemand zum ersten Mal "Nur für mich" anhakt. Ohne ihn ist keine Zeile privat,
 * und alles läuft wie zuvor.
 */
export type Privatschluessel = PersoenlicherSchluessel | null

/**
 * Was beim Instanziieren aus dem Katalog in das Item kopiert wird (§8).
 *
 * Kopiert und nicht verknüpft: `catalog_version` ist eine Herkunftsangabe
 * ("aufgesetzt aus Katalogstand 2031-03"), keine lebende Verbindung: Ein
 * späterer Import ändert an einer bereits instanziierten Aufgabe nichts. Wer
 * Rechtsgrundlage und Quelle im Aufgabendetail liest (§7), liest den Stand von
 * damals, und genau den soll er lesen, denn danach hat jemand gehandelt.
 *
 * Alles ausser Titel und Kurzbeschreibung steht hier: Die beiden sind der
 * Aufgabe selbst geworden und dort änderbar.
 */
export type Katalogherkunft = Omit<Katalogaufgabe, 'id' | 'titel' | 'kurzbeschreibung'> & {
  /** Die Kennung der Katalogaufgabe, aus der dieses Item entstanden ist. */
  aufgabeId: string
  /** Der Katalogstand zum Zeitpunkt des Instanziierens. */
  version: string
}

/**
 * Der verschlüsselte Inhalt einer Aufgabe (§3.3).
 *
 * `typ` ist heute einwertig und steht trotzdem da: Er ist die Unterscheidung,
 * an der ein späterer Leser ein Konfigurations-Item (`kenntnisAm`, §8) von
 * einer Aufgabe trennt, ohne raten zu müssen. Ein Feld nachträglich zum
 * Unterscheidungsmerkmal zu erklären ginge nicht, da alte Payloads es nicht trügen.
 *
 * `erledigt` gilt nur für Blätter. Eine Aufgabe mit Unteraufgaben trägt das
 * Feld zwar weiter mit (schreiben lässt sich kein Payload ohne), aber
 * gelesen wird es dort nie: Der Client leitet ihren Abschluss bei jedem
 * Rendern aus den Kindern ab (§7, `aufgabenbaum.ts`). Es gibt deshalb nichts
 * zu synchronisieren und nichts, was divergieren kann.
 *
 * `parentId` und `dependsOn` sind UUIDs anderer Items desselben Falls und
 * liegen mit im Payload: Der Server erfährt über den Baum nichts (§3.3).
 */
export type Aufgabenpayload = {
  typ: 'aufgabe'
  titel: string
  beschreibung: string
  erledigt: boolean
  /** Freie Notizen zur Aufgabe, im Aufgabendetail (§7). */
  notizen: string
  /**
   * Die Elternaufgabe, oder `null` bei einer Wurzelaufgabe.
   *
   * Eine Ebene, keine Verschachtelung (§7). Erzwungen wird das nicht hier,
   * sondern beim Bauen des Baums: Ein `parentId`, das auf eine Unteraufgabe
   * zeigt, macht aus dem Kind eine Wurzel, statt es verschwinden zu lassen.
   */
  parentId: string | null
  /**
   * Aufgaben, die vorher erledigt sein sollten, als schlichte UUID-Liste (§7).
   *
   * Beim Instanziieren entsteht sie aus `katalog.haengtAbVon`; die
   * Katalog-IDs sind dabei bereits in die Item-IDs dieses Falls übersetzt (§8).
   */
  dependsOn: string[]
  /**
   * Wem die Aufgabe gehört (§7), verschlüsselt wie alles andere hier (§3.3).
   *
   * Der Server kann danach nicht filtern, und deshalb tut es der Start-Screen
   * nach dem Entschlüsseln. Was das für die Bearbeitungssperre bedeutet, steht
   * in `zuweisung.ts`.
   */
  assignee: Zuweisung
  /** Aus dem Katalog kopiert (§8), oder `null` bei einer selbst angelegten Aufgabe. */
  katalog: Katalogherkunft | null
}

export type Aufgabe = {
  id: string
  titel: string
  beschreibung: string
  /**
   * Das gespeicherte Häkchen, gültig nur für Blätter (§7). Ob eine Aufgabe
   * als erledigt gilt, beantwortet `aufgabenbaum.ts`, nicht dieses Feld.
   */
  erledigt: boolean
  notizen: string
  parentId: string | null
  dependsOn: string[]
  /** Wem sie gehört (§7). Wer nicht darunter steht, sieht sie und ändert sie nicht. */
  assignee: Zuweisung
  /**
   * Der DEK dieser Zeile, entpackt. Er bleibt im Speicher, weil jede Änderung
   * ihn wieder braucht; neu erzeugt würde er nur bei einer neuen Aufgabe.
   */
  dek: Uint8Array
  /** Der Schlüssel, unter dem der DEK auf dem Server liegt. */
  kid: string
  /**
   * Ob diese Aufgabe nur für die angemeldete Person da ist (§3.7).
   *
   * Abgeleitet und nirgends gespeichert: Eine Aufgabe ist privat, wenn ihr
   * `kid` der eigene `K_p` ist. In der Zeile steht dazu nichts, sie trägt
   * keinen Marker. Die privaten Aufgaben der anderen kommen hier nie an: Sie
   * ließen sich nicht entschlüsseln und sind längst still verworfen.
   */
  privat: boolean
  /** Woher diese Aufgabe stammt (§8), oder `null`, wenn jemand sie selbst angelegt hat. */
  katalog: Katalogherkunft | null
}

export type Aufgabenliste = {
  aufgaben: Aufgabe[]
  /**
   * Die Zeilen, die still verworfen wurden (§3.7), bei ihrer ID. Sichtbar
   * ausschließlich im Dev-Modus: In Produktion gibt es diesen Zähler nirgends
   * zu sehen.
   *
   * IDs statt einer Zahl, weil der Aufrufer stapelweise entschlüsselt: Er
   * bekommt nur die geänderten Zeilen zu sehen (§5) und müsste einen Zähler
   * über die Stapel hinweg selbst fortschreiben, und dazu wissen, welche Zeile
   * gar nicht erst mitzählt. Genau diese Regel steht hier und soll hier bleiben.
   */
  uebersprungeneIds: string[]
}

/** Was sich an einer Aufgabe ändern lässt. Was fehlt, bleibt, wie es war. */
export type Aufgabenaenderung = {
  titel?: string
  beschreibung?: string
  notizen?: string
  erledigt?: boolean
  /** Die UUID-Liste ganz, nicht einzelne Einträge: Sie ist kurz genug (§7). */
  dependsOn?: string[]
  /**
   * Die Zuweisung ganz: übernehmen, freigeben, jemanden eintragen (§7).
   *
   * Ganz und nicht als Einzelschritt, weil zwei Geräte denselben Payload
   * schreiben und die höhere `seq` gewinnt. Ein "füge mich hinzu" hätte kein
   * Gegenüber auf dem Server, der es ausführen könnte: Die Zusammenführung
   * findet hier statt, auf dem Stand, den dieses Gerät gerade sieht.
   */
  assignee?: Zuweisung
}

/**
 * Der Titel, gekürzt, oder ein Wurf.
 *
 * Exportiert, weil die privaten Aufgaben (§3.7) denselben Weg nehmen. Zwei
 * Prüfungen wären zwei Gelegenheiten, verschieden streng zu sein.
 */
export function pruefeTitel(titel: string): string {
  const gekuerzt = titel.trim()

  if (gekuerzt === '') {
    throw new AufgabenFehler('Eine Aufgabe braucht einen Titel.')
  }

  return gekuerzt
}

function alsText(wert: unknown): string {
  return typeof wert === 'string' ? wert : ''
}

function alsListe(wert: unknown): string[] {
  return Array.isArray(wert) ? wert.filter((eintrag) => typeof eintrag === 'string') : []
}

/**
 * Die Herkunft aus einem Payload, Feld für Feld.
 *
 * Nichts wird hier übernommen, wie es kommt: Der Payload ist zwar
 * entschlüsselt, aber er wurde irgendwann von irgendeiner Fassung dieser App
 * geschrieben. Ein Feld, das eine ältere Fassung noch nicht kannte, fehlt dann
 * einfach, und ein fehlender Wert soll eine leere Angabe ergeben und keinen
 * Absturz im Aufgabendetail.
 */
function herkunftAus(wert: unknown): Katalogherkunft | null {
  if (typeof wert !== 'object' || wert === null) {
    return null
  }

  const felder = wert as Partial<Katalogherkunft>

  if (typeof felder.aufgabeId !== 'string' || felder.aufgabeId === '') {
    return null
  }

  return {
    aufgabeId: felder.aufgabeId,
    version: alsText(felder.version),
    fristTage: typeof felder.fristTage === 'number' ? felder.fristTage : null,
    fristAb:
      felder.fristAb === 'sterbedatum' || felder.fristAb === 'kenntnis' ? felder.fristAb : null,
    rechtsgrundlage: alsText(felder.rechtsgrundlage),
    zustaendigeStelle: alsText(felder.zustaendigeStelle),
    benoetigteDokumente: alsListe(felder.benoetigteDokumente),
    unteraufgaben: alsListe(felder.unteraufgaben),
    haengtAbVon: alsListe(felder.haengtAbVon),
    hinweis: alsText(felder.hinweis),
    quelleUrl: alsText(felder.quelleUrl),
    kategorie: alsText(felder.kategorie),
    reihenfolge: typeof felder.reihenfolge === 'number' ? felder.reihenfolge : 0,
  }
}

/**
 * Liest, was in einem entschlüsselten Payload steht.
 *
 * @throws wenn es kein Aufgabenpayload ist. Der Aufrufer macht daraus eine
 * übersprungene Zeile: Von aussen ist ein Defekt nicht von dem privaten Item
 * einer anderen Person zu unterscheiden (§11.8).
 */
function lesePayload(klartext: Uint8Array): Aufgabenpayload {
  const roh: unknown = JSON.parse(bytesText(klartext))

  if (
    typeof roh !== 'object' ||
    roh === null ||
    !('titel' in roh) ||
    typeof roh.titel !== 'string'
  ) {
    throw new AufgabenFehler('Dieser Payload ist keine Aufgabe.')
  }

  const felder = roh as Partial<Aufgabenpayload>

  return {
    typ: 'aufgabe',
    titel: felder.titel ?? '',
    beschreibung: felder.beschreibung ?? '',
    erledigt: felder.erledigt === true,
    // Dieselbe Vorsicht wie bei der Herkunft: Ein Payload, den eine ältere
    // Fassung geschrieben hat, kennt diese Felder nicht. Fehlt eines, ist die
    // Aufgabe eine Wurzel ohne Abhängigkeiten und ohne Notizen, und kein
    // Absturz im Aufgabendetail.
    notizen: typeof felder.notizen === 'string' ? felder.notizen : '',
    parentId: typeof felder.parentId === 'string' && felder.parentId !== '' ? felder.parentId : null,
    dependsOn: alsListe(felder.dependsOn),
    assignee: zuweisungAus(felder.assignee),
    katalog: herkunftAus(felder.katalog),
  }
}

/**
 * Der Schlüssel, unter dem der DEK dieser Zeile liegt: `K_c`, oder `K_p`, wenn
 * das `kid` der eigene persönliche Schlüssel ist (§3.7).
 *
 * Ein Vergleich und kein zweiter Entschlüsselungsversuch: Das `kid` sagt
 * eindeutig, welcher Schlüssel gemeint ist, und ein Fallback "erst `K_c`, dann
 * `K_p`" verdoppelte die Arbeit für jede fremde private Zeile, ohne je etwas
 * anderes herauszufinden.
 */
function schluesselFuer(zeile: InhaltZeile, fall: Fallschluessel, privat: Privatschluessel) {
  return privat !== null && zeile.kid === privat.kid ? privat.kp : fall.kc
}

async function leseZeile(
  zeile: InhaltZeile,
  fall: Fallschluessel,
  privat: Privatschluessel,
): Promise<Aufgabe> {
  const dek = await entpackeDek(schluesselFuer(zeile, fall, privat), zeile.wrappedDek)
  const { titel, beschreibung, erledigt, notizen, parentId, dependsOn, assignee, katalog } =
    lesePayload(await entschluessele(dek, zeile.payload))

  return {
    id: zeile.id,
    titel,
    beschreibung,
    erledigt,
    notizen,
    parentId,
    dependsOn,
    assignee,
    katalog,
    dek,
    kid: zeile.kid,
    privat: privat !== null && zeile.kid === privat.kid,
  }
}

/**
 * Macht aus Ciphertext-Zeilen Aufgaben: der Schritt, den §5 "entschlüsselt beim
 * Start in den Speicher" nennt.
 *
 * Die Zeilen kommen aus dem Cache oder aus dem Delta; woher, ist dieser
 * Funktion gleich. Sie kostet einige Millisekunden, und deshalb bezieht sich
 * die Ladeanzeige ausdrücklich auf den Netzwerk-Fetch und nicht auf diesen
 * Schritt (§5).
 *
 * Ein Fehlschlag beim Entschlüsseln einer einzelnen Zeile bringt die Liste
 * nicht zum Scheitern: Er zählt.
 *
 * @param privat der eigene `K_p`, sofern es einen gibt (§3.7). Die privaten
 * Zeilen der anderen tragen keinen Marker und lassen sich hier nicht von einem
 * Defekt unterscheiden; sie landen deshalb bei den übersprungenen.
 */
export async function aufgabenAusZeilen(
  zeilen: InhaltZeile[],
  fall: Fallschluessel,
  privat: Privatschluessel = null,
): Promise<Aufgabenliste> {
  const aufgaben: Aufgabe[] = []
  const uebersprungeneIds: string[] = []

  for (const zeile of zeilen) {
    // Tombstones werden vor jedem Entschlüsselungsversuch aussortiert: Sie sind
    // leer und zählten sonst als Defekt, obwohl sie das Gegenteil sind: ein
    // ordnungsgemäß gelöschtes Item (§5).
    //
    // Tresor-Inhalte ebenso, und die aus einem zweiten Grund: Sie tragen
    // `art: 'item'` wie eine Aufgabe, ihr DEK liegt aber unter `K_v` und nicht
    // unter `K_c` (§3.5). Jeder Versuch hier scheiterte zwangsläufig und
    // zählte den Tresor als Defekt hoch.
    if (zeile.geloescht || zeile.art !== 'item' || zeile.imTresor) {
      continue
    }

    try {
      aufgaben.push(await leseZeile(zeile, fall, privat))
    } catch {
      uebersprungeneIds.push(zeile.id)
    }
  }

  return { aufgaben, uebersprungeneIds }
}

/**
 * Eine neue Aufgabe: eigener DEK, Payload darunter, DEK unter `K_c`.
 *
 * Die ID entsteht hier und nicht auf dem Server: eine clientseitige UUIDv7
 * (§5), damit Anlegen offline funktioniert und die Queue eine Aufgabe benennen
 * kann, die der Server noch nie gesehen hat.
 *
 * @param wer die anlegende Person, die damit gleich eingetragen ist (§7).
 * Etwas selbst aufzuschreiben *ist* die Ansage "ich mache das", und eine
 * Aufgabe, die man nach dem Tippen erst noch übernehmen müsste, um ihren Titel
 * zu korrigieren, wäre eine Hürde ohne Zweck. `null` lässt sie frei; so kommen
 * die Aufgaben der Juristinnen in den Fall (§8).
 */
export async function mutationAnlegen(
  fall: Fallschluessel,
  titel: string,
  parentId: string | null = null,
  wer: Zugewiesene | null = null,
): Promise<Mutation> {
  const { id, wrappedDek, payload } = await verschluesselterInhalt(fall, uuidv7(), {
    typ: 'aufgabe',
    titel: pruefeTitel(titel),
    beschreibung: '',
    erledigt: false,
    notizen: '',
    parentId,
    dependsOn: [],
    assignee: wer === null ? NIEMAND : personen([wer]),
    katalog: null,
  })

  return {
    op: 'anlegen',
    itemId: id,
    fallId: fall.id,
    art: 'item',
    kid: fall.kid,
    wrappedDek,
    payload,
    ts: Date.now(),
  }
}

/**
 * Ein Payload als anzulegende Zeile: eigener DEK, Payload darunter, DEK unter
 * `K_c`: die Kette aus §3.1, einmal.
 *
 * Zwei Wege enden hier. Eine getippte Aufgabe wird daraus eine {@link Mutation}
 * für die Offline-Queue; der Rechtskatalog (§8) nimmt die Zeile unverändert und
 * schreibt sie mit `on conflict do nothing`, weil seine IDs deterministisch
 * sind und mehrere Mitglieder gleichzeitig instanziieren können. Verschlüsselt
 * wird auf beiden Wegen dasselbe, und das steht deshalb an einer Stelle.
 *
 * @param id die Item-ID: eine UUIDv7 für getippte Aufgaben (§5), die
 * abgeleitete UUIDv5 für Katalogaufgaben (§8).
 */
export async function verschluesselterInhalt(
  fall: Fallschluessel,
  id: string,
  payload: Aufgabenpayload,
): Promise<NeuerInhalt> {
  const dek = erzeugeDek()

  const [verschluesselt, wrappedDek] = await Promise.all([
    verschluessele(dek, textBytes(JSON.stringify(payload))),
    wrappeDek(fall.kc, dek),
  ])

  return { id, fallId: fall.id, art: 'item', kid: fall.kid, wrappedDek, payload: verschluesselt }
}

/**
 * Geänderte Felder unter demselben DEK. Er ändert sich nie (§3.1), und deshalb
 * kostet ein Edit genau eine Spalte.
 */
export async function mutationAendern(
  aufgabe: Aufgabe,
  aenderung: Aufgabenaenderung,
): Promise<Mutation> {
  const payload: Aufgabenpayload = {
    typ: 'aufgabe',
    titel: aenderung.titel === undefined ? aufgabe.titel : pruefeTitel(aenderung.titel),
    beschreibung: aenderung.beschreibung ?? aufgabe.beschreibung,
    erledigt: aenderung.erledigt ?? aufgabe.erledigt,
    notizen: aenderung.notizen ?? aufgabe.notizen,
    // `parentId` schreibt jede Änderung unverändert mit: Eine Unteraufgabe
    // wechselt ihre Elternaufgabe nicht, sie wird gelöscht und neu angelegt.
    // Fiele das Feld beim ersten Häkchen heraus, sprängen die Unteraufgaben
    // reihenweise auf die Wurzelebene (§7).
    parentId: aufgabe.parentId,
    dependsOn: aenderung.dependsOn ?? aufgabe.dependsOn,
    // Auch die Zuweisung schreibt jede Änderung mit. Fiele sie beim ersten
    // Häkchen heraus, gäbe ein Abhaken die Aufgabe frei, und die Sperre, die
    // zwei Menschen davor bewahrt, dieselbe Behörde anzurufen, hielte genau
    // bis zum ersten Fortschritt (§7).
    assignee: aenderung.assignee ?? aufgabe.assignee,
    // Die Herkunft schreibt jede Änderung unverändert mit. Sie ist kein Feld,
    // das jemand bearbeitet. Sie fiele sonst beim ersten Häkchen aus dem
    // Payload, und mit ihr Rechtsgrundlage und Quelle (§8).
    katalog: aufgabe.katalog,
  }

  return {
    op: 'aendern',
    itemId: aufgabe.id,
    payload: await verschluessele(aufgabe.dek, textBytes(JSON.stringify(payload))),
    ts: Date.now(),
  }
}

/**
 * Löschen: als Tombstone, nicht als DELETE (§5).
 *
 * Löschen gewinnt endgültig: Die Datenbank weist ein `deleted → false` ab (§4),
 * ein späteres Edit von einem anderen Gerät belebt die Aufgabe also nicht
 * wieder.
 */
export function mutationLoeschen(aufgabe: Aufgabe): Mutation {
  return { op: 'loeschen', itemId: aufgabe.id, ts: Date.now() }
}

/**
 * Eine abgelehnte Änderung, so wie sie auf dem Bildschirm steht.
 *
 * §5: "Abgelehnte Mutationen werden nie stillschweigend verworfen, sondern mit
 * ihrem entschlüsselten Inhalt als Mitteilung angezeigt." Ohne den Inhalt
 * wäre die Mitteilung eine Zumutung: "eine Änderung konnte nicht gespeichert
 * werden" sagt niemandem, was er noch einmal tippen muss.
 */
export type AbgelehnteAenderung = {
  itemId: string
  /** Was jemand tun wollte, in einem Wort für die Oberfläche. */
  was: 'anlegen' | 'aendern' | 'loeschen'
  /**
   * Der Titel, entschlüsselt. Leer, wenn er sich nicht mehr herstellen lässt:
   * Dann fehlt der DEK, weil die Zeile inzwischen ein Tombstone ist.
   */
  titel: string
  /** Was der Server gesagt hat. */
  grund: string
}

/** Der DEK einer Zeile, oder `null`, wenn er sich nicht entpacken lässt. */
async function dekVon(
  zeile: InhaltZeile | undefined,
  fall: Fallschluessel,
  privat: Privatschluessel,
) {
  if (zeile === undefined || zeile.wrappedDek.length === 0) {
    return null
  }

  try {
    return await entpackeDek(schluesselFuer(zeile, fall, privat), zeile.wrappedDek)
  } catch {
    return null
  }
}

async function titelAus(
  payload: Uint8Array | null,
  dek: Uint8Array | null,
): Promise<string> {
  if (payload === null || dek === null) {
    return ''
  }

  try {
    return lesePayload(await entschluessele(dek, payload)).titel
  } catch {
    return ''
  }
}

/**
 * Entschlüsselt, was der Server abgelehnt hat.
 *
 * @param zeilen der aktuelle Bestand. Für ein Edit und ein Löschen steht der
 * DEK dort: Die Mutation trägt ihn nicht mit, weil ein Edit genau eine Spalte
 * kostet (§3.1).
 * @param privat der eigene `K_p` (§3.7). Eine abgelehnte private Aufgabe soll
 * ihren Titel nennen wie jede andere: §5 verlangt, dass niemand raten muss,
 * was er noch einmal tippen soll.
 */
export function beschreibeAbgelehnte(
  abgelehnt: AbgelehnteMutation[],
  zeilen: InhaltZeile[],
  fall: Fallschluessel,
  privat: Privatschluessel = null,
): Promise<AbgelehnteAenderung[]> {
  const nachId = new Map(zeilen.map((zeile) => [zeile.id, zeile]))

  return Promise.all(
    abgelehnt.map(async ({ mutation, grund }): Promise<AbgelehnteAenderung> => {
      const gemeinsam = { itemId: mutation.itemId, was: mutation.op, grund }

      if (mutation.op === 'anlegen') {
        // Die abgelehnte Anlage trägt ihren eigenen DEK mit: Auf dem Server gibt
        // es diese Zeile nicht, und im Bestand steht sie auch nicht. Das `kid`
        // gehört dazu, sonst wäre eine abgelehnte private Aufgabe die einzige
        // ohne Titel in der Meldung (§3.7).
        const dek = await dekVon(
          { kid: mutation.kid, wrappedDek: mutation.wrappedDek } as InhaltZeile,
          fall,
          privat,
        )

        return { ...gemeinsam, titel: await titelAus(mutation.payload, dek) }
      }

      const dek = await dekVon(nachId.get(mutation.itemId), fall, privat)

      return {
        ...gemeinsam,
        titel: await titelAus(
          // Beim Löschen gibt es keinen neuen Payload: Gemeint ist der, der
          // noch dasteht.
          mutation.op === 'aendern' ? mutation.payload : (nachId.get(mutation.itemId)?.payload ?? null),
          dek,
        ),
      }
    }),
  )
}
