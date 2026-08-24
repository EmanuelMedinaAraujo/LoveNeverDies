/**
 * Das Wasserzeichen (DESIGN.md §5).
 *
 * Eine Zahl je Fall: die höchste `seq`, die dieses Gerät gesehen hat. Sie ist
 * zugleich der Vergleichswert für den billigen Check (`cases.version`) und die
 * Untergrenze des nächsten Deltas (`seq > watermark`). Dass beides dieselbe
 * Zahl ist, ist die Entscheidung aus §4, den Fallzähler und den Sequenzzähler
 * zu einem zu machen.
 *
 * Zwei Zeilen Rechnung, die beide leicht falsch zu schreiben sind. Deshalb
 * stehen sie hier, ohne Netz und ohne Speicher, und nicht verstreut im Hook.
 */

import type { InhaltZeile } from '../db/inhalte'

/**
 * Schritt 1 aus §5: Lohnt sich der Abruf?
 *
 * @param version was `select version from cases where id = ?` geliefert hat,
 * oder `null`, wenn die RLS den Fall nicht hergibt.
 */
export function brauchtDelta(version: number | null, wasserzeichen: number): boolean {
  // Ein Fall ohne `version` ist entweder weg oder nicht sichtbar. Der Abruf
  // scheitert dann sichtbar, statt dass der Fall still auf dem Cache-Stand
  // einfriert. §5 verlangt, dass nichts stillschweigend verschwindet.
  return version === null || version !== wasserzeichen
}

/**
 * Schritt 2 aus §5, danach: Wohin rückt das Wasserzeichen?
 *
 * Auf die höchste `seq` des Deltas, nie auf die `version` aus dem billigen
 * Check: Zwischen den beiden Abfragen kann ein anderes Gerät weiterschreiben.
 * Der Check sagt 9, das Delta bringt 3 und 4, die Nummern 5 bis 9 committen
 * dazwischen. Wer jetzt auf 9 rückt, sieht sie nie wieder. Diese Funktion
 * bekommt die `version` deshalb gar nicht erst zu sehen.
 */
export function geruecktesWasserzeichen(wasserzeichen: number, delta: InhaltZeile[]): number {
  return delta.reduce((hoechstes, zeile) => Math.max(hoechstes, zeile.seq), wasserzeichen)
}
