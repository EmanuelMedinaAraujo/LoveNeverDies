import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { KatalogQuelleFehler, alsJsonText, leseQuelltabelle } from './katalogQuelle.ts'

/**
 * `npm run import:content` (DESIGN.md §8).
 *
 * Liest die Tabelle der Juristinnen, prueft sie und schreibt
 * `src/content/catalog.de.json`. Beides ist eingecheckt: die Quelle, damit sich
 * die juristische Arbeit versionieren laesst, und das Ergebnis, damit die App
 * kein Werkzeug braucht, um zu starten.
 *
 * Der Lauf ist wiederholbar. Gleiche Quelle fuehrt zu gleichen Bytes. Ein Import ohne
 * inhaltliche Aenderung erzeugt deshalb keinen Diff.
 *
 * Dieses Skript ist die einzige Datei hier, die Dateien anfasst. Was
 * inhaltlich zaehlt, steht in `katalogQuelle.ts` und laeuft in den Tests ohne
 * Dateisystem.
 */

const QUELLE = fileURLToPath(new URL('../src/content/rechtskatalog.de.csv', import.meta.url))
const ZIEL = fileURLToPath(new URL('../src/content/catalog.de.json', import.meta.url))

function fuehreAus(): number {
  let quelltext: string

  try {
    quelltext = readFileSync(QUELLE, 'utf8')
  } catch (ursache) {
    console.error(`Die Quelltabelle ${QUELLE} war nicht zu lesen: ${(ursache as Error).message}`)
    return 1
  }

  let jsonText: string

  try {
    const katalog = leseQuelltabelle(quelltext)
    jsonText = alsJsonText(katalog)
    console.log(
      `Katalogstand ${katalog.version}: ${katalog.aufgaben.length} Aufgaben, ${
        katalog.aufgaben.filter((aufgabe) => aufgabe.fristTage !== null).length
      } davon mit gesetzlicher Frist.`,
    )
  } catch (ursache) {
    if (ursache instanceof KatalogQuelleFehler) {
      // Kein Stack: Die Maengel gehoeren den Juristinnen, der Stack gehoerte
      // niemandem.
      console.error(ursache.message)
      return 1
    }

    throw ursache
  }

  writeFileSync(ZIEL, jsonText, 'utf8')
  console.log(`Geschrieben: ${ZIEL}`)

  return 0
}

process.exitCode = fuehreAus()
