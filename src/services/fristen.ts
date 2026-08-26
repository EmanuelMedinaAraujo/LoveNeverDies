/**
 * Fristen: gespeichert wird `{fristTage, fristAb}`, gerechnet wird beim
 * Rendern (DESIGN.md §8, §7).
 *
 * ```
 * fristAb = sterbedatum  ->  cases.payload.sterbedatum + fristTage
 * fristAb = kenntnis     ->  eigenes kenntnisAm + fristTage   (#12)
 * fristAb = leer         ->  keine Frist
 * ```
 *
 * Kein Fristende wird je gespeichert: Das ist keine Sparsamkeit, sondern
 * die Bedingung dafür, dass §8 überhaupt aufgeht: Dieselbe geteilte Aufgabe mit
 * `fristAb = kenntnis` zeigt jedem Mitglied sein eigenes Datum, ohne dass sich
 * eine Zeile ändert. Ein abgelegtes Datum müsste pro Person divergieren, und
 * spätestens dann wäre es falsch.
 *
 * Erfunden wird nichts: Fehlt eine gesetzliche Frist, bleibt die Aufgabe
 * fristenlos; eine Frist ohne Rechtsgrundlage kommt schon durch den Import
 * nicht durch (§8). Und eine Frist ab Kenntnis wird ohne Kenntnisdatum
 * ausdrücklich nicht geschätzt: Eine falsch berechnete Ausschlagungsfrist
 * kostet den ganzen Nachlass.
 */

import type { Katalogherkunft } from './aufgabenService'

/** Was von einer Frist auf dem Bildschirm ankommt. */
export type Fristlage =
  /** Diese Aufgabe hat keine gesetzliche Frist. */
  | { art: 'keine' }
  /**
   * Die Frist läuft ab der Kenntnis dieser Person, und die steht noch nicht
   * fest (§8, #12). Ein Datum gibt es hier bewusst nicht.
   */
  | { art: 'ab-kenntnis' }
  /** Die Frist ist unverzüglich (ohne schuldhaftes Zögern). */
  | { art: 'unverzueglich' }
  | {
      art: 'datum'
      /** ISO `YYYY-MM-DD`, ausgerechnet und nirgends abgelegt. */
      ende: string
      /** Tage bis zum Fristende. `0` ist heute, negativ ist überfällig. */
      restTage: number
    }

const TAG_MS = 86_400_000

const ISO_FORM = /^(\d{4})-(\d{2})-(\d{2})$/

/**
 * `timeZone: 'UTC'`, weil ein Sterbedatum ein reines Kalenderdatum ohne Uhrzeit
 * ist; dieselbe Überlegung wie in `fallbeschriftung.ts`.
 */
const FORMAT = new Intl.DateTimeFormat('de-DE', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
})

/**
 * Ein Kalendertag als UTC-Mitternacht, oder `null`, wenn der Text keiner ist.
 *
 * Gerechnet wird durchgehend in UTC. Die Zeitzone des Geräts hat hier nichts
 * verloren: Sie verschöbe ein reines Datum an manchen Orten um einen Tag, und
 * ein Fristende, das je nach Aufenthaltsort einen Tag springt, ist schlimmer
 * als keines.
 */
function alsTag(iso: string | null): number | null {
  if (iso === null) {
    return null
  }

  const treffer = ISO_FORM.exec(iso)

  if (treffer === null) {
    return null
  }

  const [, jahr, monat, tag] = treffer
  const zeit = Date.UTC(Number(jahr), Number(monat) - 1, Number(tag))

  if (Number.isNaN(zeit)) {
    return null
  }

  /*
   * Die Rundreise, weil `Date.UTC` überzählige Tage weiterrollt: Aus dem
   * 31. Februar würde der 3. März, und ein vertipptes Kenntnisdatum ergäbe
   * stillschweigend ein Fristende, das niemand eingegeben hat (§8, #12).
   */
  return alsIso(zeit) === iso ? zeit : null
}

function alsIso(zeit: number): string {
  return new Date(zeit).toISOString().slice(0, 10)
}

/**
 * Der heutige Kalendertag, wie die Uhr des Geräts ihn zeigt.
 *
 * Lokal und nicht UTC: Wer um 23:30 auf die Liste schaut, soll den Tag sehen,
 * den sein Kalender zeigt, und nicht den von morgen.
 */
export function heuteIso(jetzt: Date = new Date()): string {
  const monat = `${jetzt.getMonth() + 1}`.padStart(2, '0')
  const tag = `${jetzt.getDate()}`.padStart(2, '0')

  return `${jetzt.getFullYear()}-${monat}-${tag}`
}

/** Ein Fristende ausgeschrieben: "15. Mai 2026". */
export function datumText(iso: string): string {
  const tag = alsTag(iso)

  return tag === null ? iso : FORMAT.format(new Date(tag))
}

/**
 * Ob dieser Text ein Kalendertag ist: `YYYY-MM-DD`, und den Tag gibt es.
 *
 * Die Prüfung, die vor jedem gespeicherten Kenntnisdatum steht (§8, #12).
 * Ein `<input type="date">` liefert diese Form, ein älterer Browser fällt auf
 * ein Textfeld zurück, und was von dort kommt, hat niemand geprüft.
 */
export function istKalendertag(text: string): boolean {
  return alsTag(text) !== null
}

/**
 * Ostersonntag eines Jahres, als UTC-Mitternacht (Gauß'sche Osterformel).
 *
 * Vier der neun bundeseinheitlichen Feiertage hängen an ihm (Karfreitag,
 * Ostermontag, Christi Himmelfahrt, Pfingstmontag) und wandern deshalb mit ihm
 * durchs Jahr. Die Formel rechnet für jedes Jahr, nicht nur für die paar, die
 * jemand von Hand eingetragen hätte.
 */
function ostersonntag(jahr: number): number {
  const a = jahr % 19
  const b = Math.floor(jahr / 100)
  const c = jahr % 100
  const d = Math.floor(b / 4)
  const e = b % 4
  const f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3)
  const h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4)
  const k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451)
  const wert = h + l - 7 * m + 114
  const monat = Math.floor(wert / 31)
  const tag = (wert % 31) + 1

  return Date.UTC(jahr, monat - 1, tag)
}

/** Die neun bundeseinheitlichen Feiertage eines Jahres, als UTC-Mitternacht. */
const FEIERTAGS_CACHE = new Map<number, Set<number>>()

/**
 * Die gesetzlichen Feiertage eines Jahres, auf die in ganz Deutschland Verlass
 * ist.
 *
 * Bewusst nur diese neun und nicht die Bundesland-spezifischen (Heilige Drei
 * Könige, Fronleichnam, Reformationstag, Allerheiligen, Mariä Himmelfahrt
 * u.a.): Die App kennt aktuell kein Bundesland des zuständigen Gerichts oder
 * Falls, über das sich das entscheiden ließe, und eine geratene Zuordnung wäre
 * nach §8 ein Fehler ("lieber gar nicht als falsch"). Wird der Fall eines
 * Tages um ein Bundesland ergänzt, gehört die Erweiterung hierher und nicht in
 * eine Vermutung an dieser Stelle.
 */
function feiertage(jahr: number): Set<number> {
  const gecacht = FEIERTAGS_CACHE.get(jahr)

  if (gecacht !== undefined) {
    return gecacht
  }

  const ostern = ostersonntag(jahr)

  const tage = new Set<number>([
    Date.UTC(jahr, 0, 1), // Neujahr
    ostern - 2 * TAG_MS, // Karfreitag
    ostern + TAG_MS, // Ostermontag
    Date.UTC(jahr, 4, 1), // Tag der Arbeit
    ostern + 39 * TAG_MS, // Christi Himmelfahrt
    ostern + 50 * TAG_MS, // Pfingstmontag
    Date.UTC(jahr, 9, 3), // Tag der Deutschen Einheit
    Date.UTC(jahr, 11, 25), // 1. Weihnachtsfeiertag
    Date.UTC(jahr, 11, 26), // 2. Weihnachtsfeiertag
  ])

  FEIERTAGS_CACHE.set(jahr, tage)

  return tage
}

/** Ob dieser UTC-Kalendertag ein Sonntag oder ein bundeseinheitlicher Feiertag ist. */
function istSonntagOderFeiertag(tag: number): boolean {
  const datum = new Date(tag)

  return datum.getUTCDay() === 0 || feiertage(datum.getUTCFullYear()).has(tag)
}

/**
 * Verschiebt einen UTC-Kalendertag auf den nächsten Werktag, solange er auf
 * einen Sonntag oder einen bundeseinheitlichen Feiertag fällt.
 *
 * Ausdrücklich nicht auf einen Samstag: Verlangt ist nur die Verschiebung ab
 * Sonntag oder Feiertag, und eine zusätzliche Samstagsregel wäre erfunden.
 * Wiederholt sich, solange der verschobene Tag selbst wieder auf einen
 * Sonntag oder Feiertag fällt — etwa den zweiten Weihnachtsfeiertag, der auf
 * einen Sonntag folgt.
 */
function verschobenerWerktag(tag: number): number {
  /*
   * Ein Tag, der keiner ist, wird nicht verschoben, sondern unverändert
   * zurückgegeben.
   *
   * Ohne diese Zeile liefe die Schleife für `NaN` endlos: `feiertage(NaN)`
   * besteht aus neun `NaN`, eine Menge hält davon genau eines fest, und
   * `has(NaN)` trifft es (SameValueZero). `istSonntagOderFeiertag(NaN)` wäre
   * damit dauerhaft wahr und `NaN + TAG_MS` bliebe `NaN`. Ein eingefrorener
   * Bildschirm ist der schlechteste aller Ausgänge — schlechter als jedes
   * falsche Datum —, und die Prüfung steht deshalb hier, wo die Schleife ist,
   * und nicht nur bei den Aufrufern.
   */
  if (!Number.isFinite(tag)) {
    return tag
  }

  let verschoben = tag

  while (istSonntagOderFeiertag(verschoben)) {
    verschoben += TAG_MS
  }

  return verschoben
}

/**
 * Dieselbe Verschiebung, als Kalendertag `YYYY-MM-DD` (für Aufrufer und Tests
 * außerhalb dieser Datei).
 *
 * @param iso ein Kalendertag. Ist er keiner, kommt er unverändert zurück:
 * Diese Funktion prüft nicht, ob ein Datum gültig ist, das tut `alsTag` bereits
 * an der Stelle, die ein Fristende ausrechnet.
 */
export function naechsterWerktag(iso: string): string {
  const tag = alsTag(iso)

  return tag === null ? iso : alsIso(verschobenerWerktag(tag))
}

/**
 * Woran die Fristen dieses Falls für *diese* Person hängen (§8).
 *
 * Drei Daten und keine Aufgabe: Welches davon zählt, entscheidet `fristAb` am
 * Item. Sie stehen zusammen in einem Wert, weil sie immer zusammen gebraucht
 * werden und mehrere Zeichenketten nebeneinander eine Einladung wären, sie zu
 * vertauschen.
 */
export type Fristbezug = {
  /** Aus `cases.payload` (§8), oder `null` bei einem Vorsorgefall. */
  sterbedatum: string | null
  /**
   * Das eigene Kenntnisdatum, `null`, solange keines eingetragen ist (#12).
   *
   * Es liegt als privates Konfigurations-Item unter `K_p` (§3.7) und gehört
   * ausschließlich der angemeldeten Person: Derselbe Fall hat für ihren Bruder
   * ein anderes, und genau das ist der Zweck.
   */
  kenntnisAm: string | null
  /**
   * Der Tag, an dem diese Person vom Anfechtungsgrund erfahren hat, `null`,
   * solange keiner eingetragen ist.
   *
   * Ausdrücklich ein eigenes Feld und nicht `kenntnisAm`: Beide sind die
   * Kenntnis von etwas anderem und tragen deshalb unterschiedliche Fristenden
   * (`types/fragebaum.ts` bei `anfechtungsdatum`). Läge die Anfechtung auf
   * `kenntnisAm`, ergäbe ein früher eingetragenes Ausschlagungsdatum ein
   * Anfechtungsende, das niemand eingegeben hat.
   */
  anfechtungKenntnisAm: string | null
}

/**
 * Die Frist einer Aufgabe, gerechnet für heute.
 *
 * @param katalog die Herkunft der Aufgabe. `null` bei einer selbst angelegten:
 * Gesetzliche Fristen stehen im Gesetz und nicht im Eingabefeld (§8).
 * @param bezug die beiden Daten, ab denen gezählt wird. `kenntnisAm` ist das
 * *eigene* (§8, #12): Dieselbe geteilte Aufgabe ergibt für zwei Mitglieder
 * zwei Fristenden, ohne dass sich an ihr etwas ändert.
 * @param heute der Kalendertag, gegen den gezählt wird: als Parameter, damit
 * diese Funktion rein bleibt und ein Test einen Tag vorgeben kann.
 * @param eigeneFrist die selbst gesetzte Frist der Aufgabe (`fristAm`), oder
 * `null`. Sie tritt neben die gesetzliche und nicht an ihre Stelle: Gezeigt
 * wird die frühere von beiden. Ein selbst eingetragener späterer Tag darf eine
 * Ausschlagungsfrist nicht vom Bildschirm nehmen (§8) — und ein früherer soll
 * mahnen, weil genau dafür ihn jemand eingetragen hat.
 */
export function fristlage(
  katalog: Katalogherkunft | null,
  bezug: Fristbezug,
  heute: string,
  eigeneFrist: string | null = null,
): Fristlage {
  const gesetzlich = gesetzlicheLage(katalog, bezug, heute)
  const eigen = eigeneLage(eigeneFrist, heute)

  if (eigen === null) {
    return gesetzlich
  }

  /*
   * "unverzüglich" hat kein Datum und ist trotzdem das Dringlichere: Wer ohne
   * schuldhaftes Zögern handeln muss, wartet nicht bis zu dem Tag, den er sich
   * selbst notiert hat.
   */
  if (gesetzlich.art === 'unverzueglich') {
    return gesetzlich
  }

  if (gesetzlich.art !== 'datum') {
    return eigen
  }

  return eigen.ende < gesetzlich.ende ? eigen : gesetzlich
}

/**
 * Die selbst gesetzte Frist als Lage, oder `null`, wenn keine (gültige)
 * dasteht.
 *
 * Ohne Sonntags-/Feiertagsverschiebung: Sie gilt für Fristen, die eine Zahl von
 * Tagen aus einem Ereignis ableiten (§8). Wer sich selbst einen Tag notiert,
 * hat sich diesen Tag notiert, und ihn stillschweigend auf den Montag zu
 * schieben hiesse, ein Datum zu zeigen, das niemand eingegeben hat.
 */
function eigeneLage(eigeneFrist: string | null, heute: string): (Fristlage & { art: 'datum' }) | null {
  const ende = alsTag(eigeneFrist)
  const heuteTag = alsTag(heute)

  if (ende === null || heuteTag === null) {
    return null
  }

  return {
    art: 'datum',
    ende: alsIso(ende),
    restTage: Math.round((ende - heuteTag) / TAG_MS),
  }
}

/** Die gesetzliche Frist aus dem Katalog, ohne die selbst gesetzte (§8). */
function gesetzlicheLage(
  katalog: Katalogherkunft | null,
  bezug: Fristbezug,
  heute: string,
): Fristlage {
  /*
   * `Number.isFinite` und nicht nur `!== null`: Eine Herkunft, der die Zahl
   * ganz fehlt, trägt `undefined` und nicht `null`, und `undefined * TAG_MS`
   * ergäbe ein Fristende aus `NaN` — im besten Fall ein `RangeError` in
   * `alsIso`, im schlechteren ein Datum, das keines ist. §8 rechnet lieber gar
   * nicht: Was keine Zahl von Tagen mitbringt, hat hier keine Frist.
   */
  if (katalog === null || katalog.fristAb === null) {
    return { art: 'keine' }
  }

  if (katalog.fristAb === 'unverzueglich') {
    return { art: 'unverzueglich' }
  }

  if (
    katalog.fristTage === null ||
    !Number.isFinite(katalog.fristTage)
  ) {
    return { art: 'keine' }
  }

  const abEigenerKenntnis = katalog.fristAb === 'kenntnis' || katalog.fristAb === 'anfechtungskenntnis'
  const eigenesDatum =
    katalog.fristAb === 'anfechtungskenntnis' ? bezug.anfechtungKenntnisAm : bezug.kenntnisAm
  const beginn = alsTag(abEigenerKenntnis ? eigenesDatum : bezug.sterbedatum)
  const heuteTag = alsTag(heute)

  if (beginn === null || heuteTag === null) {
    /*
     * Ohne Kenntnisdatum bleibt die Aufgabe fristenlos und sagt, woran das
     * liegt (§8, #12). Geschätzt wird nichts, schon gar nicht aus dem
     * Sterbedatum: Eine falsch berechnete Ausschlagungsfrist kostet den ganzen
     * Nachlass.
     */
    return abEigenerKenntnis ? { art: 'ab-kenntnis' } : { art: 'keine' }
  }

  /*
   * Die Sonntags-/Feiertagsverschiebung greift erst hier, auf das fertig
   * gerechnete Ende, und nicht auf `beginn`: Der Tag der Kenntnis oder des
   * Sterbefalls ist ein Datum, an dem etwas geschah, keine Frist, die
   * verschieben könnte.
   */
  const ende = verschobenerWerktag(beginn + katalog.fristTage * TAG_MS)

  return { art: 'datum', ende: alsIso(ende), restTage: Math.round((ende - heuteTag) / TAG_MS) }
}

/**
 * Die Restzeit als Text für das Badge (§7).
 *
 * Beschönigt wird nichts: Eine abgelaufene Frist sagt, dass sie abgelaufen ist.
 * Wer eine Frist versäumt hat, muss das an der Aufgabe sehen und nicht daran,
 * dass ein Zähler bei null stehen bleibt.
 *
 * @returns `null`, wo es keine Frist gibt: Dann steht auch kein Badge da.
 */
export function fristText(lage: Fristlage): string | null {
  if (lage.art === 'keine') {
    return null
  }

  if (lage.art === 'unverzueglich') {
    return 'unverzüglich'
  }

  if (lage.art === 'ab-kenntnis') {
    return 'Frist ab Ihrer Kenntnis'
  }

  if (lage.restTage === 0) {
    return 'heute fällig'
  }

  if (lage.restTage < 0) {
    const tage = -lage.restTage

    return `seit ${tage} ${tage === 1 ? 'Tag' : 'Tagen'} überfällig`
  }

  return `noch ${lage.restTage} ${lage.restTage === 1 ? 'Tag' : 'Tage'}`
}

/** Der Rang einer Fristlage: je kleiner, desto weiter vorn. */
function rang(lage: Fristlage): number {
  return lage.art === 'unverzueglich' ? 0 : lage.art === 'datum' ? 1 : lage.art === 'ab-kenntnis' ? 2 : 3
}

/**
 * Sortiert nach Frist: das knappste Ende zuerst, danach die Fristen ohne
 * Datum, zuletzt die Aufgaben ohne Frist (§7).
 *
 * Gibt bei Gleichstand `0` zurück und überlässt die Reihenfolge damit dem
 * stabilen `sort`: also der Reihenfolge der Juristinnen (§8).
 */
export function vergleicheNachFrist(links: Fristlage, rechts: Fristlage): number {
  if (rang(links) !== rang(rechts)) {
    return rang(links) - rang(rechts)
  }

  return links.art === 'datum' && rechts.art === 'datum'
    ? links.restTage - rechts.restTage
    : 0
}
