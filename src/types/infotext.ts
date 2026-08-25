/**
 * Ein Erklärtext mit Struktur (DESIGN.md §8).
 *
 * Wie beim Rechtskatalog steht die Form in `types` und nicht bei den Daten:
 * Die Inhaltsdatei, der Screen, der den Text anzeigt, und der Bauplan, der ihn
 * in eine Aufgabe schreibt, brauchen dieselbe Form.
 *
 * Struktur statt einem langen String mit Zeilenumbrüchen: Eine Aufzählung ist
 * hier eine Aufzählung und wird als `ul` gerendert. Ein Text, in dem die
 * Punkte als `*` oder `-` mitgeschrieben sind, sieht in jeder Ansicht anders
 * aus und verliert seine Gliederung, sobald ihn jemand vorgelesen bekommt.
 */

export type Infoabschnitt =
  /** Ein Fließtextabsatz. */
  | { art: 'absatz'; text: string }
  /** Eine Zwischenüberschrift, etwa "1. Was ist ein Erbschein?". */
  | { art: 'zwischentitel'; text: string }
  /** Eine Aufzählung. Die Punkte sind gefüllt, in jeder Ansicht (§7). */
  | { art: 'punkte'; punkte: string[] }

export type Infotext = {
  titel: string
  abschnitte: Infoabschnitt[]
}
