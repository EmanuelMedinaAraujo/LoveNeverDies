/**
 * Der Erbe-Fragebaum: nachschlagen, auswerten, Aufgaben daraus anlegen
 * (ERBE_DESIGN.md).
 *
 * Die Inhaltsdatei `content/fragebaum.ts` ist eine Liste; hier wird sie einmal
 * in eine Map gelegt und beantwortet Fragen. Sonst liefe jede Seitenanzeige
 * über 141 Eintraege, und der Fragebaum ist die Stelle, an der jemand zehnmal
 * hintereinander weiterklickt.
 *
 * Was hier ausdrücklich nicht steht: Rechtstext. Die Texte stehen in der
 * Inhaltsdatei, die Fristen an den Aufgabenvorlagen, und beide kommen von den
 * Juristinnen (DESIGN.md §8).
 */

import { FRAGEBAUM, WURZEL } from '../content/fragebaum.ts'
import type {
  Aufgabenvorlage,
  Erbstatus,
  Fragebaumknoten,
  Infothema,
} from '../types/fragebaum.ts'
import type { Fragebaumergebnis, Katalogherkunft } from './aufgabenService'

const KNOTEN = new Map(FRAGEBAUM.map((knoten) => [knoten.id, knoten]))

/** Die Herkunftsangabe der Aufgaben aus dem Baum (§8, ERBE_DESIGN.md §7). */
export const FRAGEBAUM_STAND = 'fragebaum-2026-08'

/**
 * Die Katalogaufgabe, die auf den Fragebaum führt (ADR-0001).
 *
 * Die einzige Aufgabe, die noch automatisch entsteht. Die Aufgabendetails
 * erkennen sie an dieser Kennung und zeigen den Knopf "Fragebaum starten".
 */
export const SEED_AUFGABE = 'erbenstellung-klaeren'

export { WURZEL }

/** Der Knoten zu dieser Id, oder `null`, wenn es ihn nicht gibt. */
export function knoten(id: string): Fragebaumknoten | null {
  return KNOTEN.get(id) ?? null
}

/** Alle Knoten, für Tests und für das Pruefen eines gespeicherten Pfads. */
export function alleKnoten(): Fragebaumknoten[] {
  return FRAGEBAUM
}

/**
 * Der Erbstatus als Satz, so wie er in Profil und auf der Erbe-Seite steht.
 *
 * "Noch Erbe" ist die Ausschlagung: Wer ausschlagen will, ist es bis zur
 * wirksamen Ausschlagung noch (ERBE_DESIGN.md §6).
 */
export function statusText(status: Erbstatus): string {
  switch (status) {
    case 'erbe':
      return 'Erbe'
    case 'wahrscheinlich-erbe':
      return 'Wahrscheinlich Erbe'
    case 'wahrscheinlich-kein-erbe':
      return 'Wahrscheinlich kein Erbe'
    case 'kein-erbe':
      return 'Kein Erbe'
    case 'noch-erbe':
      return 'Noch Erbe'
  }
}

/**
 * Das Ergebnis eines abgeschlossenen Durchlaufs.
 *
 * @param pfad die Knoten von der Wurzel bis hierher, das Ergebnis
 * eingeschlossen.
 * @throws {Error} wenn der letzte Knoten gar kein Ergebnis ist. Ein Ergebnis
 * an einer Frage wäre ein Status, den niemand erreicht hat.
 */
export function ergebnisAus(pfad: string[], jetzt: Date = new Date()): Fragebaumergebnis {
  const letzter = pfad.at(-1)
  const ziel = letzter === undefined ? null : knoten(letzter)

  if (ziel === null || ziel.art !== 'ergebnis') {
    throw new Error('Ein Fragebaum-Ergebnis entsteht nur an einem Ergebnisknoten.')
  }

  return {
    knotenId: ziel.id,
    pfad: [...pfad],
    status: ziel.status ?? null,
    am: jetzt.toISOString(),
  }
}

/**
 * Der Text eines Infoknotens.
 *
 * Der Export der Juristinnen nennt an diesen Stellen nur das Thema ("Infos zu
 * Erbschein"), nicht die Erläuterung. Sie fehlt also, und das steht hier
 * genau so — §8: "Erfunden wird nichts." Ein plausibel klingender Absatz über
 * den Erbschein wäre hier das Schlimmste von allem, weil er aussaehe wie
 * geprüft.
 */
export function infoText(thema: Infothema): { frage: string; text: string } {
  const frage =
    thema === 'erbschein' ? 'Was ist ein Erbschein?' : 'Was ist das Nachlassgericht?'
  const gegenstand =
    thema === 'erbschein'
      ? 'den Erbschein'
      : 'das Nachlassgericht und darüber, wie es Kontakt aufnimmt'

  return {
    frage,
    text: `Diese Erläuterung wird noch von den Juristinnen ergänzt. Bis dahin steht hier nichts über ${gegenstand} — geraten wird an dieser Stelle nicht.`,
  }
}

/** Titel, Beschreibung und Rechtsangaben einer Aufgabe aus dem Baum. */
export type Aufgabenbauplan = {
  titel: string
  beschreibung: string
  katalog: Katalogherkunft
}

/**
 * Die drei Aufgaben, die der Baum anlegen kann (ERBE_DESIGN.md §7).
 *
 * Ihre Rechtsangaben stehen hier und nicht mehr im Katalog (ADR-0001). Sie
 * müssen mit: Ohne `{fristTage, fristAb}` rechnet `fristen.ts` keine Frist,
 * und die Ausschlagungsfrist ist die eine, deren Versaeumnis den ganzen
 * Nachlass kostet.
 *
 * Die Anfechtung trägt bewusst *keine* rechenbare Frist. Ihr Jahr läuft ab
 * der Kenntnis des Anfechtungsgrundes, und das ist ein anderer Tag als das
 * `kenntnisAm` aus § 1944 BGB. Beides auf dasselbe Feld zu legen ergäbe ein
 * Fristende, das plausibel aussieht und falsch ist; §8 rechnet lieber gar
 * nicht. Die Jahresfrist steht deshalb im Hinweis, wo sie zu lesen und nicht
 * zu verwechseln ist.
 */
export const BAUPLAENE: Record<Aufgabenvorlage, Aufgabenbauplan> = {
  testament: {
    titel: 'Testament beim Nachlassgericht abliefern',
    beschreibung:
      'Wer ein Testament der verstorbenen Person besitzt, muss es beim Nachlassgericht abliefern. Eine Nicht-Abgabe kann strafrechtliche Folgen und Kosten nach sich ziehen.',
    katalog: {
      aufgabeId: 'fragebaum-testament',
      version: FRAGEBAUM_STAND,
      fristTage: null,
      fristAb: null,
      zustaendigeStelle: 'Nachlassgericht (Amtsgericht)',
      benoetigteDokumente: ['Testament', 'Sterbeurkunde'],
      unteraufgaben: [],
      haengtAbVon: [],
      hinweis:
        'Das Gesetz verlangt die Ablieferung unverzüglich, nennt aber keine Zahl von Tagen. Unverzüglich heißt: ohne schuldhaftes Zögern.',
      kategorie: 'Erbe',
      reihenfolge: 40,
    },
  },
  ausschlagung: {
    titel: 'Erbe ausschlagen',
    beschreibung:
      'Die Ausschlagung wird beim Nachlassgericht erklärt, zur Niederschrift oder in öffentlich beglaubigter Form über ein Notariat.',
    katalog: {
      aufgabeId: 'fragebaum-ausschlagung',
      version: FRAGEBAUM_STAND,
      fristTage: 42,
      fristAb: 'kenntnis',
      zustaendigeStelle: 'Nachlassgericht (Amtsgericht) oder Notariat',
      benoetigteDokumente: ['Sterbeurkunde', 'Personalausweis'],
      unteraufgaben: [],
      haengtAbVon: [],
      hinweis:
        'Sechs Wochen ab Ihrer Kenntnis von Anfall und Berufungsgrund, nicht ab dem Sterbetag. Beim Notariat bekommen Sie schneller einen Termin, beim Nachlassgericht fallen keine zusätzlichen Kosten an.',
      kategorie: 'Erbe',
      reihenfolge: 50,
    },
  },
  anfechtung: {
    titel: 'Testament anfechten',
    beschreibung:
      'Die Anfechtung wird beim Nachlassgericht erklärt, schriftlich oder persönlich nach Terminvereinbarung. Durch die Anfechtung entstehen Kosten; sie werden gemildert oder entfallen bei wirksamer Anfechtung.',
    katalog: {
      aufgabeId: 'fragebaum-anfechtung',
      version: FRAGEBAUM_STAND,
      fristTage: null,
      fristAb: null,
      zustaendigeStelle: 'Nachlassgericht (Amtsgericht)',
      benoetigteDokumente: ['Sterbeurkunde', 'Testament'],
      unteraufgaben: [],
      haengtAbVon: [],
      hinweis:
        'Die Frist beträgt ein Jahr ab dem Tag, an dem Sie vom Anfechtungsgrund erfahren haben. Sie wird hier nicht ausgerechnet: Dieser Tag ist ein anderer als Ihre Kenntnis von Anfall und Berufungsgrund, und aus dem falschen Tag entstünde ein falsches Fristende.',
      kategorie: 'Erbe',
      reihenfolge: 45,
    },
  },
}

/** Ob diese Herkunft von der genannten Vorlage aus dem Baum stammt. */
export function stammtAus(
  katalog: Katalogherkunft | null,
  vorlage: Aufgabenvorlage,
): boolean {
  return katalog !== null && katalog.aufgabeId === BAUPLAENE[vorlage].katalog.aufgabeId
}

/** Ob diese Aufgabe die Katalogaufgabe ist, die auf den Fragebaum führt. */
export function istSeedAufgabe(katalog: Katalogherkunft | null): boolean {
  return katalog !== null && katalog.aufgabeId === SEED_AUFGABE
}

/**
 * Die Notiz, die eine ermittelte Stelle oder ein Anfechtungsdatum festhaelt.
 *
 * Sie wandert in `notizen` der erzeugten Aufgabe, damit eine Eingabe nicht
 * verloren ist, die heute noch nirgends sonst hinkann (ERBE_DESIGN.md §8).
 */
export function notizAus(teile: { plz?: string; stelle?: string; anfechtungAm?: string }): string {
  const zeilen: string[] = []

  if (teile.plz !== undefined && teile.plz !== '') {
    zeilen.push(
      teile.stelle === undefined || teile.stelle === ''
        ? `Letzter Wohnort (PLZ): ${teile.plz}`
        : `Letzter Wohnort (PLZ) ${teile.plz} → ${teile.stelle}`,
    )
  }

  if (teile.anfechtungAm !== undefined && teile.anfechtungAm !== '') {
    zeilen.push(`Vom Anfechtungsgrund erfahren am: ${teile.anfechtungAm}`)
    zeilen.push('Die Frist beträgt ein Jahr ab diesem Tag.')
  }

  return zeilen.join('\n')
}

/**
 * Setzt das abgeleitete "erledigt" der Seed-Aufgabe (ERBE_DESIGN.md §9).
 *
 * Die Aufgabe ist geteilt, das Ergebnis des Fragebaums ist es nicht. Ein
 * gespeichertes Häkchen hakte sie deshalb für alle ab: Anna wäre fertig und
 * Bert, der den Baum nie gegangen ist, sähe seine Aufgabe erledigt.
 *
 * Abgeleitet und nirgends abgelegt, genau wie bei einer Aufgabe mit
 * Unteraufgaben (§7). Dass dieselbe geteilte Zeile jedem Mitglied etwas
 * anderes zeigt, ohne dass etwas divergiert, ist dieselbe Konstruktion, mit der
 * §8 die Fristen ab eigener Kenntnis löst.
 *
 * @param ergebnis das eigene Fragebaum-Ergebnis, oder `null`.
 */
export function mitAbgeleitetemHaken<T extends { erledigt: boolean; katalog: Katalogherkunft | null }>(
  aufgaben: T[],
  ergebnis: Fragebaumergebnis | null,
): T[] {
  return aufgaben.map((aufgabe) =>
    istSeedAufgabe(aufgabe.katalog) ? { ...aufgabe, erledigt: ergebnis !== null } : aufgabe,
  )
}
