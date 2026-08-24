import { describe, expect, it } from 'vitest'
import { KatalogQuelleFehler, SPALTEN, leseQuelltabelle } from '../../build/katalogQuelle.ts'

/**
 * Der Import der Quelltabelle (DESIGN.md §8).
 *
 * Die Regel, um die es hier vor allem geht, steht in §8 als einziger harter
 * Importfehler: Eine Frist ohne Rechtsgrundlage kommt nicht durch. Alles andere
 * hier prueft, dass die Tabelle ueberhaupt als Tabelle gelesen wird — Kommas in
 * Hinweisen, Listenfelder, Zeilennummern in den Meldungen.
 */

const KOPF = SPALTEN.join(',')

/** Eine gueltige Zeile, aus der die Tests einzelne Felder herausbrechen. */
function zeile(aenderungen: Partial<Record<(typeof SPALTEN)[number], string>> = {}): string {
  const felder: Record<(typeof SPALTEN)[number], string> = {
    id: 'erbausschlagung-pruefen',
    titel: 'Ausschlagung pruefen',
    kurzbeschreibung: 'Wer erbt, haftet auch fuer die Schulden.',
    frist_tage: '42',
    frist_ab: 'kenntnis',
    rechtsgrundlage: '§ 1944 BGB',
    zustaendige_stelle: 'Nachlassgericht',
    benoetigte_dokumente: 'Sterbeurkunde;Personalausweis',
    subtasks: '',
    depends_on: '',
    hinweis: '',
    quelle_url: 'https://www.gesetze-im-internet.de/bgb/__1944.html',
    kategorie: 'Erbe',
    reihenfolge: '50',
    ...aenderungen,
  }

  // Ein Feld mit Komma gehoert in Anfuehrungszeichen. Was schon welche
  // mitbringt, kommt aus einem Test, der genau darum geht.
  return SPALTEN.map((spalte) => felder[spalte])
    .map((wert) => (wert.includes(',') && !wert.startsWith('"') ? `"${wert}"` : wert))
    .join(',')
}

function tabelle(...zeilen: string[]): string {
  return ['# stand: 2026-08', KOPF, ...zeilen].join('\n')
}

function maengelVon(quelle: string): string[] {
  try {
    leseQuelltabelle(quelle)
  } catch (fehler) {
    expect(fehler).toBeInstanceOf(KatalogQuelleFehler)

    return (fehler as KatalogQuelleFehler).maengel as string[]
  }

  throw new Error('Der Import ist nicht gescheitert, obwohl er es sollte.')
}

describe('leseQuelltabelle (§8)', () => {
  it('macht aus einem Datensatz eine Katalogaufgabe', () => {
    const katalog = leseQuelltabelle(tabelle(zeile()))

    expect(katalog.aufgaben).toEqual([
      {
        id: 'erbausschlagung-pruefen',
        titel: 'Ausschlagung pruefen',
        kurzbeschreibung: 'Wer erbt, haftet auch fuer die Schulden.',
        fristTage: 42,
        fristAb: 'kenntnis',
        rechtsgrundlage: '§ 1944 BGB',
        zustaendigeStelle: 'Nachlassgericht',
        benoetigteDokumente: ['Sterbeurkunde', 'Personalausweis'],
        unteraufgaben: [],
        haengtAbVon: [],
        hinweis: '',
        quelleUrl: 'https://www.gesetze-im-internet.de/bgb/__1944.html',
        kategorie: 'Erbe',
        reihenfolge: 50,
      },
    ])
  })

  it('weist eine Frist ohne Rechtsgrundlage ab, mit Zeile und Grund', () => {
    const maengel = maengelVon(tabelle(zeile({ rechtsgrundlage: '' })))

    expect(maengel).toHaveLength(1)
    expect(maengel[0]).toContain('Zeile 3')
    expect(maengel[0]).toContain('rechtsgrundlage ist leer')
  })

  it('laesst eine Rechtsgrundlage ohne Frist zu — fehlt die Frist, bleibt das Feld leer', () => {
    const katalog = leseQuelltabelle(
      tabelle(zeile({ frist_tage: '', frist_ab: '', rechtsgrundlage: '§ 2259 BGB' })),
    )

    expect(katalog.aufgaben[0]?.fristTage).toBeNull()
    expect(katalog.aufgaben[0]?.fristAb).toBeNull()
    expect(katalog.aufgaben[0]?.rechtsgrundlage).toBe('§ 2259 BGB')
  })

  it('weist eine Frist ohne Anker und einen Anker ohne Frist ab', () => {
    expect(maengelVon(tabelle(zeile({ frist_ab: '' }))).join()).toContain('Die Frist liefe ab nichts')
    expect(maengelVon(tabelle(zeile({ frist_tage: '' }))).join()).toContain(
      'Der Anker traegt keine Frist',
    )
  })

  it('nimmt als Anker nur die beiden aus §8', () => {
    expect(maengelVon(tabelle(zeile({ frist_ab: 'beerdigung' }))).join()).toContain('frist_ab')
  })

  it('sammelt alle Maengel statt beim ersten abzubrechen', () => {
    const maengel = maengelVon(
      tabelle(zeile({ id: 'Gross Geschrieben', titel: '', reihenfolge: 'zehn' })),
    )

    expect(maengel).toHaveLength(3)
  })

  it('liest Kommas und Anfuehrungszeichen innerhalb eines Feldes', () => {
    const hinweis = 'Sechs Wochen, nicht ab dem Sterbetag, sondern ab Ihrer ""Kenntnis"".'
    const katalog = leseQuelltabelle(tabelle(zeile({ hinweis: `"${hinweis}"` })))

    expect(katalog.aufgaben[0]?.hinweis).toBe(
      'Sechs Wochen, nicht ab dem Sterbetag, sondern ab Ihrer "Kenntnis".',
    )
  })

  it('zaehlt Zeilen einer mehrzeiligen Zelle mit, damit die Meldung auffindbar bleibt', () => {
    const maengel = maengelVon(
      tabelle(zeile({ hinweis: '"erste\nzweite"' }), zeile({ id: '', titel: '' })),
    )

    expect(maengel.join()).toContain('Zeile 5')
  })

  it('sortiert nach reihenfolge und bei Gleichstand nach id', () => {
    const katalog = leseQuelltabelle(
      tabelle(
        zeile({ id: 'zweite', reihenfolge: '20' }),
        zeile({ id: 'erste', reihenfolge: '10' }),
        zeile({ id: 'auch-zwanzig', reihenfolge: '20' }),
      ),
    )

    expect(katalog.aufgaben.map((aufgabe) => aufgabe.id)).toEqual([
      'erste',
      'auch-zwanzig',
      'zweite',
    ])
  })

  it('weist eine doppelte id ab — sie waere zweimal dasselbe Item (§8)', () => {
    expect(maengelVon(tabelle(zeile(), zeile())).join()).toContain('steht schon weiter oben')
  })

  it('weist einen depends_on-Verweis ins Leere und auf sich selbst ab', () => {
    expect(maengelVon(tabelle(zeile({ depends_on: 'gibt-es-nicht' }))).join()).toContain(
      'das es nicht gibt',
    )
    expect(maengelVon(tabelle(zeile({ depends_on: 'erbausschlagung-pruefen' }))).join()).toContain(
      'auf sich selbst',
    )
  })

  it('verlangt die Kopfzeile aus §8 und keine andere', () => {
    const maengel = maengelVon(['# stand: 2026-08', 'id,titel,unbekannt'].join('\n'))

    expect(maengel.join()).toContain('keine Spalte "kurzbeschreibung"')
    expect(maengel.join()).toContain('unbekannte Spalte "unbekannt"')
  })

  it('verlangt den Stand und eine Aufgabe', () => {
    const maengel = maengelVon([KOPF].join('\n'))

    expect(maengel.join()).toContain('# stand:')
    expect(maengel.join()).toContain('keine einzige Aufgabe')
  })

  it('benennt die Version aus Stand und Inhalt — gleicher Inhalt, gleiche Version', () => {
    const eine = leseQuelltabelle(tabelle(zeile()))
    const gleiche = leseQuelltabelle(tabelle(zeile()))
    const andere = leseQuelltabelle(tabelle(zeile({ titel: 'Anders' })))

    expect(eine.version).toMatch(/^2026-08\+[0-9a-f]{8}$/)
    expect(gleiche.version).toBe(eine.version)
    expect(andere.version).not.toBe(eine.version)
  })
})
