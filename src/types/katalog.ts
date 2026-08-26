/**
 * Der Rechtskatalog als Typ (DESIGN.md §8).
 *
 * Zwei Seiten brauchen dieselbe Form: das Import-Skript in `build/`, das aus
 * der Tabelle der Juristinnen `catalog.de.json` erzeugt, und die App, die es
 * einliest. Deshalb steht der Typ hier und nicht in einem der beiden, als
 * Modul ohne Laufzeit, das keine der beiden Seiten in die andere zieht.
 *
 * Die Feldnamen sind die aus §8, aus `snake_case` der Quelltabelle in das
 * `camelCase` des Codes übersetzt. Übersetzt wird ausschließlich beim Import,
 * an genau einer Stelle.
 */

/**
 * Woran eine Frist hängt (§8). `null` heißt: keine gesetzliche Frist.
 *
 * `anfechtungskenntnis` ist ausdrücklich kein Alias für `kenntnis`: Beide
 * hängen an einem eigenen, aber unterschiedlichen Tag (ERBE_DESIGN.md §7,
 * `fragebaumService.ts` bei `BAUPLAENE.anfechtung`). Sie auf denselben Anker
 * zu legen ergäbe für zwei verschiedene Fristen dasselbe Datum und damit ein
 * Fristende, das für die eine oder die andere falsch ist.
 */
export type Fristanker = 'sterbedatum' | 'kenntnis' | 'anfechtungskenntnis'

/**
 * Eine Katalogaufgabe, so wie sie eingecheckt ist.
 *
 * Beim Instanziieren wandert alles davon in das Item und altert dort mit ihm
 * (§8). `catalog_version` ist eine Herkunftsangabe und keine lebende
 * Verknüpfung. Ein späterer Import ändert deshalb an einer bereits
 * instanziierten Aufgabe nichts.
 */
export type Katalogaufgabe = {
  /**
   * Der stabile Bezeichner aus der Quelltabelle, etwa `erbausschlagung-pruefen`.
   *
   * Er geht in den HMAC ein, aus dem die Item-ID entsteht (§8). Wird er
   * geändert, gilt die Aufgabe als eine andere: Ein Fall, der schon
   * instanziiert hat, bekommt sie ein zweites Mal. Umbenennen heißt hier also
   * nicht "Tippfehler beheben", sondern "neue Aufgabe".
   */
  id: string
  titel: string
  kurzbeschreibung: string
  /** Tage, oder `null`, wenn es keine gesetzliche Frist gibt. Nie geraten (§8). */
  fristTage: number | null
  fristAb: Fristanker | null
  zustaendigeStelle: string
  benoetigteDokumente: string[]
  unteraufgaben: string[]
  /** IDs anderer Katalogaufgaben, die vorher erledigt sein sollten. */
  haengtAbVon: string[]
  hinweis: string
  kategorie: string
  /** Die Reihenfolge, in der die Juristinnen die Aufgaben sehen wollen. */
  reihenfolge: number
}

export type Katalog = {
  /** Heute nur `de`. Der Dateiname trägt es mit, der Inhalt sagt es. */
  sprache: string
  /**
   * Der Stand, den die Juristinnen pflegen, etwa `2026-08`. Er steht in der
   * ersten Zeile der Quelltabelle.
   */
  stand: string
  /**
   * Was in `cases.catalog_version` eingefroren wird: der Stand und ein
   * Fingerabdruck über den Inhalt, etwa `2026-08+1a2b3c4d`.
   *
   * Der Stand allein trüge die Zusage nicht. Zwei Tabellen mit demselben Stand
   * und verschiedenem Inhalt hießen sonst gleich, und ein Fall behauptete eine
   * Herkunft, die sich nicht mehr nachvollziehen lässt.
   */
  version: string
  /** Nach `reihenfolge` sortiert, bei Gleichstand nach `id`. */
  aufgaben: Katalogaufgabe[]
}
