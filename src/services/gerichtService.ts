/**
 * Nachlassgericht-Ermittlung anhand der deutschen Postleitzahl.
 *
 * Greift auf den normalisierten Datensatz aus `src/content/gerichte.json` zu,
 * der 611 Gerichte für alle 10.813 deutschen 5-stelligen PLZs enthält.
 */

import gerichteJson from '../content/gerichte.json'
import type { GerichtLookupErgebnis, Nachlassgericht } from '../types/gericht.ts'

type GerichteData = {
  gerichte: Nachlassgericht[]
  plz: Record<string, number>
}

const daten = gerichteJson as unknown as GerichteData

/**
 * Ermittelt das zuständige Nachlassgericht für eine 5-stellige deutsche Postleitzahl.
 */
export function findeNachlassgericht(plzEingabe: string): GerichtLookupErgebnis {
  const bereinigt = plzEingabe.trim()

  if (!/^\d{5}$/.test(bereinigt)) {
    return {
      status: 'ungueltig',
      plz: bereinigt,
      hinweis: 'Bitte geben Sie eine gültige 5-stellige Postleitzahl ein.',
    }
  }

  const gerichtIndex = daten.plz[bereinigt]

  if (gerichtIndex === undefined || gerichtIndex === -2) {
    return {
      status: 'nicht_gefunden',
      plz: bereinigt,
      hinweis:
        'Diese Postleitzahl gehört zu einem Postfach oder Großempfänger ohne Wohnbevölkerung. Bitte geben Sie die Postleitzahl des tatsächlichen Wohnorts an.',
    }
  }

  if (gerichtIndex === -1) {
    return {
      status: 'mehrdeutig',
      plz: bereinigt,
      hinweis:
        'Für diese Postleitzahl gibt es je nach Ortsteil oder Gemeinde unterschiedliche Zuständigkeiten. Bitte prüfen Sie die Website des übergeordneten Amtsgerichts.',
      linkUrl: `https://www.justizadressen.nrw.de/de/justiz/gericht?ang=nachlass&plzort=${bereinigt}`,
    }
  }

  const gericht = daten.gerichte[gerichtIndex]
  if (!gericht) {
    return {
      status: 'nicht_gefunden',
      plz: bereinigt,
      hinweis: 'Zu dieser Postleitzahl konnte kein Nachlassgericht gefunden werden.',
    }
  }

  return {
    status: 'gefunden',
    plz: bereinigt,
    gericht,
  }
}

/**
 * Erzeugt den vollständigen mehrzeiligen Notiztext für eine erstellte Aufgabe.
 */
export function formatGerichtNotiz(gericht: Nachlassgericht, plz: string): string {
  const zeilen: string[] = [`Zuständiges Nachlassgericht (PLZ ${plz}):`, gericht.name]

  if (gericht.lieferanschrift) {
    zeilen.push(`Lieferanschrift: ${gericht.lieferanschrift}`)
  }
  if (gericht.postanschrift) {
    zeilen.push(`Postanschrift: ${gericht.postanschrift}`)
  }
  if (gericht.telefon) {
    zeilen.push(`Telefon: ${gericht.telefon}`)
  }
  if (gericht.fax) {
    zeilen.push(`Fax: ${gericht.fax}`)
  }
  if (gericht.email) {
    zeilen.push(`E-Mail: ${gericht.email}`)
  }
  if (gericht.internet) {
    zeilen.push(`Internet: ${gericht.internet}`)
  }

  return zeilen.join('\n')
}
