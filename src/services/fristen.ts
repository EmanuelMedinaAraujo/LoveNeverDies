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
 * Woran die Fristen dieses Falls für *diese* Person hängen (§8).
 *
 * Zwei Daten und keine Aufgabe: Welches von beiden zählt, entscheidet
 * `fristAb` am Item. Sie stehen zusammen in einem Wert, weil sie immer
 * zusammen gebraucht werden und zwei Zeichenketten nebeneinander eine
 * Einladung wären, sie zu vertauschen.
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
}

/**
 * Die Frist einer Aufgabe, gerechnet für heute.
 *
 * @param katalog die Herkunft der Aufgabe. `null` bei einer selbst angelegten:
 * Fristen stehen im Gesetz und nicht im Eingabefeld (§8).
 * @param bezug die beiden Daten, ab denen gezählt wird. `kenntnisAm` ist das
 * *eigene* (§8, #12): Dieselbe geteilte Aufgabe ergibt für zwei Mitglieder
 * zwei Fristenden, ohne dass sich an ihr etwas ändert.
 * @param heute der Kalendertag, gegen den gezählt wird: als Parameter, damit
 * diese Funktion rein bleibt und ein Test einen Tag vorgeben kann.
 */
export function fristlage(
  katalog: Katalogherkunft | null,
  bezug: Fristbezug,
  heute: string,
): Fristlage {
  if (katalog === null || katalog.fristTage === null || katalog.fristAb === null) {
    return { art: 'keine' }
  }

  const abKenntnis = katalog.fristAb === 'kenntnis'
  const beginn = alsTag(abKenntnis ? bezug.kenntnisAm : bezug.sterbedatum)
  const heuteTag = alsTag(heute)

  if (beginn === null || heuteTag === null) {
    /*
     * Ohne Kenntnisdatum bleibt die Aufgabe fristenlos und sagt, woran das
     * liegt (§8, #12). Geschätzt wird nichts, schon gar nicht aus dem
     * Sterbedatum: Eine falsch berechnete Ausschlagungsfrist kostet den ganzen
     * Nachlass.
     */
    return abKenntnis ? { art: 'ab-kenntnis' } : { art: 'keine' }
  }

  const ende = beginn + katalog.fristTage * TAG_MS

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
  return lage.art === 'datum' ? 0 : lage.art === 'ab-kenntnis' ? 1 : 2
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
