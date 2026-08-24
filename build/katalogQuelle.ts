import { createHash } from 'node:crypto'
import type { Fristanker, Katalog, Katalogaufgabe } from '../src/types/katalog.ts'

/**
 * Die Quelltabelle der Juristinnen einlesen und pruefen (DESIGN.md §8).
 *
 * Ein Datensatz pro Aufgabe, als CSV, weil das die Tabelle ist, die aus einem
 * Tabellenprogramm herausfaellt. Listenfelder trennen ihre Eintraege mit `;`
 * — deshalb bleibt `,` als Feldtrenner frei, und ein Hinweis darf Kommas
 * enthalten, solange er in Anfuehrungszeichen steht.
 *
 * **Was dieses Modul nicht tut: die Datei lesen.** Es bekommt Text und gibt
 * einen Katalog zurueck; `import-content.ts` daneben legt die Datei an. So
 * laesst sich jede Regel dieses Moduls pruefen, ohne eine Datei anzulegen.
 *
 * Die harte Regel aus §8 steht in {@link pruefeFrist}: Eine Frist ohne
 * Rechtsgrundlage bricht den Import ab. Fristen sind das, was diese App
 * gefaehrlich macht, wenn sie falsch sind — eine Zahl ohne Paragraph ist eine
 * Behauptung, und Behauptungen kommen hier nicht durch.
 */

/** Die Spalten aus §8, in der Reihenfolge der Quelltabelle. */
export const SPALTEN = [
  'id',
  'titel',
  'kurzbeschreibung',
  'frist_tage',
  'frist_ab',
  'rechtsgrundlage',
  'zustaendige_stelle',
  'benoetigte_dokumente',
  'subtasks',
  'depends_on',
  'hinweis',
  'quelle_url',
  'kategorie',
  'reihenfolge',
] as const

type Spalte = (typeof SPALTEN)[number]

/** Trennt die Eintraege innerhalb eines Listenfeldes (§8). */
const LISTENTRENNER = ';'

const ID_FORM = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

const GANZZAHL = /^[1-9][0-9]*$/

const REIHENFOLGE_FORM = /^-?[0-9]+$/

const STAND_FORM = /^#\s*stand:\s*(\S+)\s*$/

const FRISTANKER: readonly string[] = ['sterbedatum', 'kenntnis']

/** So viele Bytes des Inhalts-Hashes stehen in der Version. */
const FINGERABDRUCK_BYTES = 4

/**
 * Der Import ist gescheitert — mit allen Maengeln, nicht nur mit dem ersten.
 *
 * Wer eine Tabelle mit dreissig Zeilen pflegt, will nicht dreissig Mal
 * importieren, um dreissig Tippfehler zu finden.
 */
export class KatalogQuelleFehler extends Error {
  readonly maengel: readonly string[]

  constructor(maengel: readonly string[]) {
    super(`Die Quelltabelle ist nicht gueltig:\n${maengel.map((m) => `  - ${m}`).join('\n')}`)
    this.name = 'KatalogQuelleFehler'
    this.maengel = maengel
  }
}

type Datensatz = {
  /** Die Zeile in der Datei, ab 1 — fuer Fehlermeldungen, die man wiederfindet. */
  zeile: number
  felder: string[]
}

/**
 * CSV nach RFC 4180: Anfuehrungszeichen schuetzen Kommas, Zeilenumbrueche und
 * — verdoppelt — sich selbst.
 *
 * Von Hand und nicht aus einem Paket: Es ist ein Zustandsautomat mit vier
 * Zweigen, und er kostet weniger als die Abhaengigkeit, die er ersetzt.
 */
function leseCsv(text: string): Datensatz[] {
  const datensaetze: Datensatz[] = []

  let felder: string[] = []
  let feld = ''
  let inAnfuehrung = false
  let zeile = 1
  let beginnt = 1
  let angefangen = false

  const schliesseFeld = () => {
    felder.push(feld)
    feld = ''
  }

  const schliesseZeile = () => {
    schliesseFeld()
    datensaetze.push({ zeile: beginnt, felder })
    felder = []
    angefangen = false
  }

  for (let i = 0; i < text.length; i++) {
    const zeichen = text[i]

    if (!angefangen) {
      beginnt = zeile
      angefangen = true
    }

    if (inAnfuehrung) {
      if (zeichen === '"') {
        if (text[i + 1] === '"') {
          feld += '"'
          i += 1
        } else {
          inAnfuehrung = false
        }
      } else {
        if (zeichen === '\n') {
          zeile += 1
        }
        feld += zeichen
      }

      continue
    }

    switch (zeichen) {
      case '"':
        inAnfuehrung = true
        break

      case ',':
        schliesseFeld()
        break

      case '\r':
        break

      case '\n':
        schliesseZeile()
        zeile += 1
        break

      default:
        feld += zeichen
    }
  }

  // Eine Datei ohne abschliessenden Zeilenumbruch traegt trotzdem einen
  // Datensatz; eine mit einem traegt keinen leeren hinterher.
  if (angefangen) {
    schliesseZeile()
  }

  return datensaetze
}

/** Fuehrende Kommentarzeilen: der Stand steht dort, und sonst nichts Verbindliches. */
function leseKopf(text: string): { stand: string | null; rest: string } {
  const zeilen = text.split('\n')
  let stand: string | null = null
  let i = 0

  for (; i < zeilen.length; i++) {
    const zeile = zeilen[i] ?? ''

    if (!zeile.startsWith('#')) {
      break
    }

    const treffer = STAND_FORM.exec(zeile.trimEnd())

    if (treffer?.[1] !== undefined) {
      stand = treffer[1]
    }
  }

  // Die Kommentarzeilen werden durch leere ersetzt statt entfernt: Die
  // Zeilennummern in den Fehlermeldungen sollen die der Datei sein.
  return { stand, rest: [...zeilen.slice(0, i).map(() => ''), ...zeilen.slice(i)].join('\n') }
}

function leerZeile(datensatz: Datensatz): boolean {
  return datensatz.felder.every((feld) => feld.trim() === '')
}

function liste(feld: string): string[] {
  return feld
    .split(LISTENTRENNER)
    .map((eintrag) => eintrag.trim())
    .filter((eintrag) => eintrag !== '')
}

type Zugriff = (spalte: Spalte) => string

function zugriff(kopf: string[], datensatz: Datensatz): Zugriff {
  return (spalte) => (datensatz.felder[kopf.indexOf(spalte)] ?? '').trim()
}

/**
 * Die harte Regel aus §8 — und ihre beiden Nachbarn.
 *
 * Eine Frist ohne Rechtsgrundlage ist ein Importfehler. Eine Frist ohne Anker
 * waere nicht berechenbar (§8: ab Sterbedatum oder ab Kenntnis), und ein Anker
 * ohne Frist benennt einen Zeitpunkt, ab dem nichts laeuft.
 */
function pruefeFrist(lies: Zugriff, ort: string, maengel: string[]): void {
  const tage = lies('frist_tage')
  const ab = lies('frist_ab')

  if (tage !== '' && !GANZZAHL.test(tage)) {
    maengel.push(`${ort}: frist_tage ist "${tage}" und keine positive ganze Zahl.`)
  }

  if (ab !== '' && !FRISTANKER.includes(ab)) {
    maengel.push(`${ort}: frist_ab ist "${ab}" und weder "sterbedatum" noch "kenntnis".`)
  }

  if (tage !== '' && lies('rechtsgrundlage') === '') {
    maengel.push(
      `${ort}: frist_tage ist gesetzt, rechtsgrundlage ist leer. Eine Frist ohne Rechtsgrundlage geht nicht durch (§8).`,
    )
  }

  if (tage !== '' && ab === '') {
    maengel.push(`${ort}: frist_tage ist gesetzt, frist_ab ist leer. Die Frist liefe ab nichts.`)
  }

  if (tage === '' && ab !== '') {
    maengel.push(`${ort}: frist_ab ist gesetzt, frist_tage ist leer. Der Anker traegt keine Frist.`)
  }
}

function pruefeZeile(lies: Zugriff, ort: string, maengel: string[]): void {
  const id = lies('id')

  if (id === '') {
    maengel.push(`${ort}: id fehlt.`)
  } else if (!ID_FORM.test(id)) {
    maengel.push(
      `${ort}: id "${id}" ist keine Kleinbuchstaben-Kennung mit Bindestrichen. Sie geht in die Item-ID ein (§8) und darf sich nie beilaeufig aendern.`,
    )
  }

  for (const spalte of ['titel', 'kurzbeschreibung', 'kategorie'] as const) {
    if (lies(spalte) === '') {
      maengel.push(`${ort}: ${spalte} fehlt.`)
    }
  }

  if (!REIHENFOLGE_FORM.test(lies('reihenfolge'))) {
    maengel.push(`${ort}: reihenfolge ist "${lies('reihenfolge')}" und keine ganze Zahl.`)
  }

  const quelle = lies('quelle_url')

  if (quelle !== '' && !quelle.startsWith('https://') && !quelle.startsWith('http://')) {
    maengel.push(`${ort}: quelle_url "${quelle}" ist keine URL.`)
  }

  pruefeFrist(lies, ort, maengel)
}

function alsAufgabe(lies: Zugriff): Katalogaufgabe {
  const tage = lies('frist_tage')
  const ab = lies('frist_ab')

  return {
    id: lies('id'),
    titel: lies('titel'),
    kurzbeschreibung: lies('kurzbeschreibung'),
    fristTage: tage === '' ? null : Number(tage),
    fristAb: ab === '' ? null : (ab as Fristanker),
    rechtsgrundlage: lies('rechtsgrundlage'),
    zustaendigeStelle: lies('zustaendige_stelle'),
    benoetigteDokumente: liste(lies('benoetigte_dokumente')),
    unteraufgaben: liste(lies('subtasks')),
    haengtAbVon: liste(lies('depends_on')),
    hinweis: lies('hinweis'),
    quelleUrl: lies('quelle_url'),
    kategorie: lies('kategorie'),
    reihenfolge: Number(lies('reihenfolge')),
  }
}

function pruefeKopf(kopf: string[], maengel: string[]): void {
  for (const spalte of SPALTEN) {
    if (!kopf.includes(spalte)) {
      maengel.push(`Die Kopfzeile hat keine Spalte "${spalte}".`)
    }
  }

  for (const spalte of kopf) {
    if (!(SPALTEN as readonly string[]).includes(spalte)) {
      maengel.push(`Die Kopfzeile hat eine unbekannte Spalte "${spalte}".`)
    }
  }
}

/**
 * Verweise unter den Aufgaben: `depends_on` zeigt auf IDs derselben Tabelle.
 *
 * Ein Verweis ins Leere faellt sonst erst dem Aufgabendetail auf (§7), also
 * nach dem Instanziieren — und dann steht er bereits in den Items von Faellen,
 * die niemand mehr anfasst.
 */
function pruefeVerweise(aufgaben: Katalogaufgabe[], maengel: string[]): void {
  const bekannt = new Set(aufgaben.map((aufgabe) => aufgabe.id))

  for (const aufgabe of aufgaben) {
    for (const verweis of aufgabe.haengtAbVon) {
      if (verweis === aufgabe.id) {
        maengel.push(`Aufgabe "${aufgabe.id}": depends_on verweist auf sich selbst.`)
      } else if (!bekannt.has(verweis)) {
        maengel.push(`Aufgabe "${aufgabe.id}": depends_on verweist auf "${verweis}", das es nicht gibt.`)
      }
    }
  }
}

/**
 * Der Fingerabdruck ueber den Inhalt, der neben dem Stand in der Version steht.
 *
 * Gehasht wird der kanonische JSON-Text ohne das Versionsfeld selbst — sonst
 * haenge der Hash von sich ab.
 */
function fingerabdruck(ohneVersion: Omit<Katalog, 'version'>): string {
  return createHash('sha256')
    .update(JSON.stringify(ohneVersion))
    .digest('hex')
    .slice(0, FINGERABDRUCK_BYTES * 2)
}

/**
 * Liest die Quelltabelle und gibt den geprueften Katalog zurueck.
 *
 * @param text der Inhalt der CSV-Datei, samt der Kommentarzeilen mit dem Stand.
 * @throws {KatalogQuelleFehler} mit allen Maengeln auf einmal.
 */
export function leseQuelltabelle(text: string): Katalog {
  const maengel: string[] = []
  const { stand, rest } = leseKopf(text)

  if (stand === null) {
    maengel.push('Es fehlt eine Zeile "# stand: <Katalogstand>" am Anfang der Datei.')
  }

  const datensaetze = leseCsv(rest).filter((datensatz) => !leerZeile(datensatz))
  const [kopfsatz, ...zeilen] = datensaetze

  if (kopfsatz === undefined) {
    throw new KatalogQuelleFehler([...maengel, 'Die Quelltabelle hat keine Kopfzeile.'])
  }

  const kopf = kopfsatz.felder.map((feld) => feld.trim())
  pruefeKopf(kopf, maengel)

  if (zeilen.length === 0) {
    maengel.push('Die Quelltabelle hat keine einzige Aufgabe.')
  }

  const aufgaben: Katalogaufgabe[] = []
  const gesehen = new Set<string>()

  for (const datensatz of zeilen) {
    const ort = `Zeile ${datensatz.zeile}`

    if (datensatz.felder.length !== kopf.length) {
      maengel.push(
        `${ort}: ${datensatz.felder.length} Felder, die Kopfzeile hat ${kopf.length}.`,
      )
      continue
    }

    const lies = zugriff(kopf, datensatz)
    pruefeZeile(lies, ort, maengel)

    const id = lies('id')

    if (gesehen.has(id)) {
      maengel.push(`${ort}: die id "${id}" steht schon weiter oben.`)
    }

    gesehen.add(id)
    aufgaben.push(alsAufgabe(lies))
  }

  pruefeVerweise(aufgaben, maengel)

  if (maengel.length > 0) {
    throw new KatalogQuelleFehler(maengel)
  }

  aufgaben.sort((a, b) => a.reihenfolge - b.reihenfolge || a.id.localeCompare(b.id))

  const ohneVersion = { sprache: 'de', stand: stand ?? '', aufgaben }

  return {
    sprache: ohneVersion.sprache,
    stand: ohneVersion.stand,
    version: `${ohneVersion.stand}+${fingerabdruck(ohneVersion)}`,
    aufgaben,
  }
}

/**
 * Der Text, der in `catalog.de.json` steht.
 *
 * Eingecheckt (§8), also muss er sich bei gleicher Quelle Byte fuer Byte
 * wiederholen — sonst zeigte jeder Import einen Diff, der nichts bedeutet.
 */
export function alsJsonText(katalog: Katalog): string {
  return `${JSON.stringify(katalog, null, 2)}\n`
}
