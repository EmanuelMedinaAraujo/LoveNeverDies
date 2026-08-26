import { describe, expect, it } from 'vitest'
import { WURZEL } from '../../src/content/fragebaum.ts'
import {
  BAUPLAENE,
  aufgabenBeschreibung,
  ergebnisAus,
  infoText,
  istSeedAufgabe,
  knoten,
  mitAbgeleitetemHaken,
  notizAus,
  stammtAus,
  statusText,
} from '../../src/services/fragebaumService.ts'
import type { Katalogherkunft } from '../../src/services/aufgabenService.ts'

/**
 * Auswertung des Fragebaums (ERBE_DESIGN.md §6, §7).
 */

/** Ein Weg von der Wurzel zu irgendeinem Ergebnis, immer die erste Antwort. */
function ersterWeg(): string[] {
  const pfad = [WURZEL]

  for (;;) {
    const letzter = pfad.at(-1)
    const aktuell = letzter === undefined ? null : knoten(letzter)
    const naechste = aktuell?.antworten[0]

    if (aktuell === null || naechste === undefined) {
      return pfad
    }

    pfad.push(naechste.ziel)
  }
}

describe('statusText (§6)', () => {
  it('benennt alle fuenf Status', () => {
    expect(statusText('erbe')).toBe('Erbe')
    expect(statusText('wahrscheinlich-erbe')).toBe('Wahrscheinlich Erbe')
    expect(statusText('wahrscheinlich-kein-erbe')).toBe('Wahrscheinlich kein Erbe')
    expect(statusText('kein-erbe')).toBe('Kein Erbe')
    expect(statusText('noch-erbe')).toBe('Noch Erbe')
  })
})

describe('ergebnisAus (§6)', () => {
  it('haelt Pfad, Knoten und Status fest', () => {
    const pfad = ersterWeg()
    const ergebnis = ergebnisAus(pfad, new Date('2026-08-25T10:00:00.000Z'))

    expect(ergebnis.knotenId).toBe(pfad.at(-1))
    expect(ergebnis.pfad).toEqual(pfad)
    expect(ergebnis.am).toBe('2026-08-25T10:00:00.000Z')
    expect(ergebnis.status).toBe(knoten(ergebnis.knotenId)?.status ?? null)
  })

  it('kopiert den Pfad, statt ihn zu halten', () => {
    // Der Aufrufer haelt denselben Array waehrend des ganzen Durchlaufs. Ohne
    // Kopie schriebe ein spaeterer Klick in ein bereits gespeichertes Ergebnis.
    const pfad = ersterWeg()
    const ergebnis = ergebnisAus(pfad)

    pfad.push('n999')

    expect(ergebnis.pfad).not.toContain('n999')
  })

  it('weist einen Pfad ab, der an einer Frage endet', () => {
    expect(() => ergebnisAus([WURZEL])).toThrow()
  })

  it('weist einen leeren Pfad ab', () => {
    expect(() => ergebnisAus([])).toThrow()
  })

  it('weist einen unbekannten Knoten ab', () => {
    expect(() => ergebnisAus(['gibt-es-nicht'])).toThrow()
  })
})

describe('Bauplaene (§7)', () => {
  it('gibt der Ausschlagung die Frist ab eigener Kenntnis', () => {
    // § 1944 BGB: sechs Wochen ab Kenntnis von Anfall und Berufungsgrund. Ohne
    // diese beiden Felder rechnet `fristen.ts` gar nichts.
    expect(BAUPLAENE.ausschlagung.katalog.fristTage).toBe(42)
    expect(BAUPLAENE.ausschlagung.katalog.fristAb).toBe('kenntnis')
  })

  it('traegt in keiner Vorlage einen Paragraphen oder einen Quelllink (ADR-0003)', () => {
    for (const [name, bauplan] of Object.entries(BAUPLAENE)) {
      const text = [bauplan.titel, bauplan.beschreibung, ...Object.values(bauplan.katalog)]
        .map((wert) => (Array.isArray(wert) ? wert.join(' ') : String(wert)))
        .join(' ')

      expect(text, name).not.toContain('§')
      expect(text, name).not.toContain('gesetze-im-internet.de')
    }
  })

  it('gibt der Anfechtung die Frist ab eigener Anfechtungskenntnis (D)', () => {
    // Ihr Jahr laeuft ab der Kenntnis des Anfechtungsgrundes, und das ist ein
    // anderer Tag als das `kenntnisAm` aus § 1944 BGB. Beides auf dasselbe Feld
    // zu legen ergaebe ein Fristende, das plausibel aussieht und falsch ist;
    // deshalb ein eigener Anker und kein `kenntnis`.
    expect(BAUPLAENE.anfechtung.katalog.fristTage).toBe(365)
    expect(BAUPLAENE.anfechtung.katalog.fristAb).toBe('anfechtungskenntnis')
    expect(BAUPLAENE.anfechtung.katalog.hinweis).toContain('ein Jahr')
    expect(BAUPLAENE.anfechtung.katalog.hinweis).not.toContain('wird hier nicht ausgerechnet')
  })

  it('gibt dem Testament die Frist unverzüglich ohne Tagesfrist', () => {
    expect(BAUPLAENE.testament.katalog.fristTage).toBeNull()
    expect(BAUPLAENE.testament.katalog.fristAb).toBe('unverzueglich')
    expect(BAUPLAENE.testament.katalog.hinweis).toContain('Unverzüglich')
  })

  it('schreibt den ganzen Erbschein-Text in die Aufgabe (§10)', () => {
    // Wer "Ja" getippt hat, hat den Text eine Sekunde vorher gelesen und soll
    // ihn in der Aufgabe wiederfinden — samt dem Weg dorthin, der auf der
    // Seite selbst nicht steht.
    const beschreibung = BAUPLAENE.erbschein.beschreibung

    expect(beschreibung).toContain('Eine amtliche Urkunde')
    expect(beschreibung).toContain('Wie beantragen Sie einen Erbschein?')
    expect(beschreibung).toContain('Beim Notar oder beim Nachlassgericht')
  })

  it('setzt in der Aufgabenbeschreibung gefuellte Punkte', () => {
    // Die Beschreibung ist ein String und traegt keine Liste. Dann steht der
    // Punkt im Text, und zwar ueberall derselbe: Der Export der Juristinnen
    // mischt "*" und "-".
    const punktzeilen = BAUPLAENE.erbschein.beschreibung
      .split('\n')
      .filter((zeile) => zeile.startsWith('•'))

    expect(punktzeilen.length).toBeGreaterThan(0)
    expect(BAUPLAENE.erbschein.beschreibung).not.toMatch(/^[*-] /m)
  })

  it('rechnet dem Erbschein keine Frist an', () => {
    // Das Gesetz nennt fuer den Antrag keine. §8 rechnet lieber gar nicht.
    expect(BAUPLAENE.erbschein.katalog.fristTage).toBeNull()
    expect(BAUPLAENE.erbschein.katalog.fristAb).toBeNull()
  })

  it('gibt jeder Vorlage eine eigene Herkunft', () => {
    const ids = Object.values(BAUPLAENE).map((bauplan) => bauplan.katalog.aufgabeId)

    expect(new Set(ids).size).toBe(ids.length)
  })

  it('haengt von nichts ab: private Aufgaben sind Wurzelaufgaben (§3.7)', () => {
    /*
     * Geprueft wird `haengtAbVon`, nicht `unteraufgaben`: Die beiden Felder
     * meinen Verschiedenes. `haengtAbVon` wuerde zu echten Zeilen im Bestand
     * werden, und genau die darf eine private Aufgabe nicht haben — sie stuende
     * unter einer geteilten Elternaufgabe, die es fuer alle anderen ohne dieses
     * Kind gibt (§3.7, `privatService.ts` legt `parentId` fest auf `null`).
     *
     * `unteraufgaben` ist dagegen blosse Beschreibung: die Schritte, die zu
     * dieser Aufgabe gehoeren, als Text an der Herkunft. Sie erzeugen keine
     * Zeile und koennen die Invariante deshalb nicht verletzen.
     */
    for (const bauplan of Object.values(BAUPLAENE)) {
      expect(bauplan.katalog.haengtAbVon).toEqual([])
    }
  })
})

describe('stammtAus und istSeedAufgabe (§7, §9)', () => {
  it('erkennt eine Aufgabe an ihrer Herkunft und nicht am Titel', () => {
    const herkunft = BAUPLAENE.ausschlagung.katalog

    expect(stammtAus(herkunft, 'ausschlagung')).toBe(true)
    expect(stammtAus(herkunft, 'testament')).toBe(false)
    expect(stammtAus(null, 'ausschlagung')).toBe(false)
  })

  it('haelt eine selbst angelegte Aufgabe fuer keine aus dem Baum', () => {
    expect(stammtAus(null, 'testament')).toBe(false)
    expect(istSeedAufgabe(null)).toBe(false)
  })

  it('erkennt die Seed-Aufgabe', () => {
    const seed = { aufgabeId: 'erbenstellung-klaeren' } as Katalogherkunft

    expect(istSeedAufgabe(seed)).toBe(true)
    expect(istSeedAufgabe(BAUPLAENE.testament.katalog)).toBe(false)
  })
})

describe('infoText (§5)', () => {
  it('erfindet keinen Rechtstext, sondern sagt, dass er fehlt', () => {
    // §8: "Erfunden wird nichts." Der Export nennt an diesen Stellen nur das
    // Thema, nicht die Erlaeuterung.
    for (const thema of ['erbschein', 'nachlassgericht'] as const) {
      expect(infoText(thema).text).toContain('ergänzt')
    }
  })

  it('liefert den vorliegenden Pflichtteil-Text fest, statt den Platzhalter (B)', () => {
    const info = infoText('pflichtteil')

    expect(info.frage).toBe('Was ist der Pflichtteil?')
    expect(info.text).toBe('Der Pflichtteil ist ein Mindest-Betrag an Geld aus dem Erbe.')
    expect(info.text).not.toContain('ergänzt')
  })
})

describe('notizAus (§8)', () => {
  it('haelt vollständige Gerichtsdaten fest', () => {
    const gericht = {
      id: 1,
      name: 'Amtsgericht Heilbronn',
      lieferanschrift: 'Knorrstr. 1, 74074 Heilbronn',
      postanschrift: '74064 Heilbronn',
      telefon: '07131 64-1',
      fax: null,
      internet: 'https://amtsgericht-heilbronn.justiz-bw.de',
      email: 'poststelle@agheilbronn.justiz.bwl.de',
    }
    const notiz = notizAus({ plz: '74199', gericht })
    expect(notiz).toContain('Zuständiges Nachlassgericht (PLZ 74199):')
    expect(notiz).toContain('Amtsgericht Heilbronn')
    expect(notiz).toContain('Lieferanschrift: Knorrstr. 1, 74074 Heilbronn')
    expect(notiz).toContain('poststelle@agheilbronn.justiz.bwl.de')
  })

  it('haelt Eingabe und Antwort der Suche fest', () => {
    expect(notizAus({ plz: '80331', stelle: 'Nachlassgericht München' })).toContain('80331')
    expect(notizAus({ plz: '80331', stelle: 'Nachlassgericht München' })).toContain('München')
  })

  it('haelt die Postleitzahl auch ohne Antwort fest', () => {
    expect(notizAus({ plz: '80331' })).toContain('80331')
  })

  it('haelt das Anfechtungsdatum mit seiner Frist fest', () => {
    const notiz = notizAus({ anfechtungAm: '2026-05-12' })

    expect(notiz).toContain('2026-05-12')
    expect(notiz).toContain('ein Jahr')
  })

  it('bleibt leer, wenn nichts eingegeben wurde', () => {
    expect(notizAus({})).toBe('')
    expect(notizAus({ plz: '', anfechtungAm: '' })).toBe('')
  })
})

describe('mitAbgeleitetemHaken (§9)', () => {
  const seed = { aufgabeId: 'erbenstellung-klaeren' } as Katalogherkunft

  it('hakt die Seed-Aufgabe ab, sobald ein eigenes Ergebnis vorliegt', () => {
    const ergebnis = ergebnisAus(ersterWeg())
    const [aufgabe] = mitAbgeleitetemHaken([{ erledigt: false, katalog: seed }], ergebnis)

    expect(aufgabe?.erledigt).toBe(true)
  })

  it('lässt sie offen, solange keines vorliegt', () => {
    const [aufgabe] = mitAbgeleitetemHaken([{ erledigt: true, katalog: seed }], null)

    // Auch gegen ein gespeichertes `true`: Das könnte von einer anderen Person
    // stammen, und dann wäre es genau die Behauptung, die §9 verhindern soll.
    expect(aufgabe?.erledigt).toBe(false)
  })

  it('lässt jede andere Aufgabe unangetastet', () => {
    const andere = [
      { erledigt: true, katalog: null },
      { erledigt: false, katalog: BAUPLAENE.ausschlagung.katalog },
    ]

    expect(mitAbgeleitetemHaken(andere, null)).toEqual(andere)
  })

  it('gibt dieselben Objekte zurück, wo nichts abzuleiten ist', () => {
    // Sonst entstünde bei jedem Rendern eine neue Identität, und jede
    // Memoisierung darunter liefe ins Leere.
    const unveraendert = { erledigt: false, katalog: null }

    expect(mitAbgeleitetemHaken([unveraendert], null)[0]).toBe(unveraendert)
  })
})

/**
 * Was in einer Aufgabe aus dem Baum steht (ERBE_DESIGN.md §7).
 *
 * Die Anforderung ist wörtlich: "Die Informationen stehen immer über dem Button
 * 'Aufgabe erstellen'. Genau diese Informationen müssen in die Aufgabe mit
 * rein." Dazu die Schritte, die dafür zu tun sind.
 */
describe('aufgabenBeschreibung (§7)', () => {
  it('stellt den gelesenen Ergebnistext voran', () => {
    const gelesen = 'Sie wollen das Erbe nicht (Ausschlagung)\n1. Frist\nSechs Wochen.'
    const beschreibung = aufgabenBeschreibung('ausschlagung', gelesen)

    expect(beschreibung.startsWith(gelesen)).toBe(true)
    expect(beschreibung).toContain(BAUPLAENE.ausschlagung.beschreibung)
  })

  it('bleibt bei der Bauplan-Beschreibung, wenn kein Text mitkommt', () => {
    expect(aufgabenBeschreibung('testament')).toBe(BAUPLAENE.testament.beschreibung)
  })

  it('schreibt denselben Text nicht zweimal', () => {
    const nur = BAUPLAENE.anfechtung.beschreibung

    expect(aufgabenBeschreibung('anfechtung', nur)).toBe(nur)
  })
})

describe('Schritte an den Aufgaben aus dem Baum (§7)', () => {
  it('nennt zu jeder Vorlage, was dafür zu tun ist', () => {
    for (const [name, bauplan] of Object.entries(BAUPLAENE)) {
      expect(bauplan.katalog.unteraufgaben.length, name).toBeGreaterThan(0)

      for (const schritt of bauplan.katalog.unteraufgaben) {
        expect(schritt.trim(), name).not.toBe('')
      }
    }
  })

  it('lässt die Aufgaben mit Frist nach dem Tag des Fristbeginns fragen', () => {
    // §8: Wo eine Frist zählt, muss der Tag erfragt werden, ab dem sie läuft.
    for (const vorlage of ['ausschlagung', 'anfechtung'] as const) {
      const { katalog } = BAUPLAENE[vorlage]

      expect(katalog.fristTage, vorlage).not.toBeNull()
      expect(katalog.unteraufgaben.some((schritt) => schritt.includes('Datum eintragen'))).toBe(
        true,
      )
    }
  })
})
