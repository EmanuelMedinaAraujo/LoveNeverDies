/**
 * Der Name, unter dem ein Gerät zum ersten Mal in Profil steht (DESIGN.md §3.6).
 *
 * Eine Vermutung aus dem User-Agent, mehr nicht — und sie darf falsch liegen,
 * weil die Person den Namen ändern kann. Wozu sie überhaupt dient: Der Prüfcode
 * ist sechs Ziffern, und sechs Ziffern sagen am Telefon nicht, welches Gerät
 * gemeint ist. "iPhone von Anna · Prüfcode 481 253" sagt es.
 *
 * Kein User-Agent-Parser als Abhängigkeit: §11.2 nennt die kurze
 * Abhängigkeitsliste als Gegenmaßnahme gegen XSS im eigenen Origin, und ein
 * falsch geratener Gerätename kostet nichts.
 */

/** Reihenfolge zählt: Ein iPad trägt "Mac OS X" im User-Agent, ein Mac kein "iPad". */
const GERAETE: [muster: RegExp, name: string][] = [
  [/iPhone/i, 'iPhone'],
  [/iPad/i, 'iPad'],
  [/Macintosh|Mac OS X/i, 'Mac'],
  [/Android/i, 'Android-Telefon'],
  [/Windows/i, 'Windows-PC'],
  [/Linux|X11/i, 'Linux-PC'],
]

const UNBEKANNT = 'Gerät'

function geraetetyp(userAgent: string): string {
  return GERAETE.find(([muster]) => muster.test(userAgent))?.[1] ?? UNBEKANNT
}

function vorname(anzeigename: string): string {
  const [erstesWort = ''] = anzeigename.trim().split(/\s+/)

  // Bei einer E-Mail-Adresse steht der Name davor. Steht dort nichts
  // Brauchbares, bleibt der Gerätetyp für sich.
  return (erstesWort.split('@')[0] ?? '').trim()
}

export function standardGeraetename(userAgent: string, anzeigename: string): string {
  const person = vorname(anzeigename)
  const typ = geraetetyp(userAgent)

  return person === '' ? typ : `${typ} von ${person}`
}
