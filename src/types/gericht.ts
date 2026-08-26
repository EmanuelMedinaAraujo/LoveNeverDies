/**
 * Die Datenstruktur eines Amts- und Nachlassgerichts in Deutschland.
 */
export type Nachlassgericht = {
  id: number
  name: string
  lieferanschrift: string | null
  postanschrift: string | null
  telefon: string | null
  fax: string | null
  internet: string | null
  email: string | null
}

/**
 * Das Ergebnis einer PLZ-Nachschlageoperation.
 */
export type GerichtLookupErgebnis =
  | {
      status: 'gefunden'
      plz: string
      gericht: Nachlassgericht
    }
  | {
      status: 'mehrdeutig'
      plz: string
      hinweis: string
      linkUrl: string
    }
  | {
      status: 'nicht_gefunden'
      plz: string
      hinweis: string
    }
  | {
      status: 'ungueltig'
      plz: string
      hinweis: string
    }
