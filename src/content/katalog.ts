/**
 * Der eingecheckte Rechtskatalog (DESIGN.md §8).
 *
 * `catalog.de.json` entsteht aus der Tabelle der Juristinnen und liegt im
 * Repository, nicht auf einem Server: Der Katalog ist Inhalt, kein Zustand, und
 * eine App, die ihn erst laden müsste, hätte beim ersten Start eines
 * Trauerfalls nichts zu zeigen.
 *
 * Erzeugt wird die Datei ausschliesslich von `npm run import:content`. Wer sie
 * von Hand ändert, fällt in `tests/content/katalog.test.ts` auf — dort wird
 * sie aus der Quelltabelle neu erzeugt und verglichen.
 *
 * **Der Katalog geht als Parameter durch die Dienste, nicht als Import.** Was
 * hier steht, ist der Stand dieses Builds; welcher Stand für einen Fall gilt,
 * entscheidet `cases.catalog_version` (§8). Ein Dienst, der den Katalog selbst
 * importierte, koennte diesen Unterschied nicht mehr machen.
 */

import type { Katalog } from '../types/katalog'
import katalogJson from './catalog.de.json'

/**
 * Der Stand, mit dem dieser Build ausgeliefert wurde.
 *
 * Die Umdeutung ist die einzige Stelle, an der aus einer JSON-Datei ein Typ
 * wird: TypeScript liest aus dem Literal `fristAb: string` heraus, wo
 * {@link Katalog} `'sterbedatum' | 'kenntnis' | null` verlangt. Geprüft hat
 * das der Import (§8), und der Test daneben prüft, dass die Datei von ihm
 * stammt.
 */
export function katalog(): Katalog {
  return katalogJson as unknown as Katalog
}
