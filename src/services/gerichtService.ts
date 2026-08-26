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

/**
 * Extrahiert eine 5-stellige Postleitzahl aus einer Notiz, falls vorhanden.
 */
export function extrahierePlzAusNotiz(notiz: string): string | null {
  if (!notiz) {
    return null
  }

  const matchGericht = notiz.match(/Zuständiges Nachlassgericht \(PLZ\s*(\d{5})\)/i)
  if (matchGericht?.[1]) {
    return matchGericht[1]
  }

  const matchWohnort = notiz.match(/Letzter Wohnort \(PLZ\)[:\s→]+(\d{5})/i)
  if (matchWohnort?.[1]) {
    return matchWohnort[1]
  }

  const matchPlz = notiz.match(/\bPLZ[:\s]+(\d{5})\b/i)
  if (matchPlz?.[1]) {
    return matchPlz[1]
  }

  return null
}

/**
 * Aktualisiert oder fügt die Kontaktdaten eines Nachlassgerichts in die Notizen ein.
 * Bereits vorhandene Gerichtsangaben werden ersetzt, andere Notizen bleiben erhalten.
 */
export function aktualisiereNotizMitGericht(
  bisherigeNotiz: string,
  gericht: Nachlassgericht,
  plz: string,
): string {
  const neueGerichtNotiz = formatGerichtNotiz(gericht, plz)
  const getrimmt = bisherigeNotiz.trim()

  if (getrimmt === '') {
    return neueGerichtNotiz
  }

  const gerichtMuster = /Zuständiges Nachlassgericht \(PLZ\s*\d{5}\):[\s\S]*?(?=(\n\s*\n|\n(?:Vom Anfechtungsgrund|Letzter Wohnort)|$))/i
  if (gerichtMuster.test(getrimmt)) {
    return getrimmt.replace(gerichtMuster, neueGerichtNotiz).trim()
  }

  const wohnortMuster = /Letzter Wohnort \(PLZ\)[\s\S]*?(?=(\n\s*\n|\n(?:Vom Anfechtungsgrund|Zuständiges Nachlassgericht)|$))/i
  if (wohnortMuster.test(getrimmt)) {
    return getrimmt.replace(wohnortMuster, neueGerichtNotiz).trim()
  }

  return `${neueGerichtNotiz}\n\n${getrimmt}`
}

