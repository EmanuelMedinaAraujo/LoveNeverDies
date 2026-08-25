import { describe, expect, it } from 'vitest'
import { FRAGEBAUM, WURZEL } from '../../src/content/fragebaum.ts'
import { BAUPLAENE, statusText } from '../../src/services/fragebaumService.ts'
import type { Erbstatus } from '../../src/types/fragebaum.ts'

/**
 * Der Fragebaum als Inhalt (ERBE_DESIGN.md §2).
 *
 * Die Datei ist von Hand gepflegt und traegt bewusst Wiederholungen: Derselbe
 * Ergebnistext steht mehrfach darin, ganze Teilbaeume sind mehrfach
 * ausgeschrieben (ADR-0002). Genau deshalb steht dieser Test hier. Wer den
 * neunten Ausschlagungstext anfasst und den achten vergisst, faellt in einem
 * Knotengraph sofort auf und in einem wiederholten Baum nur hier.
 *
 * Geprueft wird die Struktur und nicht der Wortlaut: Was in den Texten steht,
 * entscheiden die Juristinnen, und ein Test, der Rechtstext festnagelt, machte
 * aus jeder Korrektur einen roten Lauf.
 */

const nachId = new Map(FRAGEBAUM.map((knoten) => [knoten.id, knoten]))

/** Alles, was von der Wurzel aus mit endlich vielen Antworten zu erreichen ist. */
function erreichbar(): Set<string> {
  const gesehen = new Set<string>()
  const offen = [WURZEL]

  while (offen.length > 0) {
    const id = offen.pop()

    if (id === undefined || gesehen.has(id)) {
      continue
    }

    gesehen.add(id)

    for (const antwort of nachId.get(id)?.antworten ?? []) {
      offen.push(antwort.ziel)
    }
  }

  return gesehen
}

describe('Fragebaum-Inhalt (ERBE_DESIGN.md §2)', () => {
  it('hat eine Wurzel, und sie ist eine Frage', () => {
    expect(nachId.get(WURZEL)?.art).toBe('frage')
  })

  it('vergibt jede Id genau einmal', () => {
    expect(nachId.size).toBe(FRAGEBAUM.length)
  })

  it('laesst keine Antwort ins Leere zeigen', () => {
    const tote = FRAGEBAUM.flatMap((knoten) =>
      knoten.antworten.filter((antwort) => !nachId.has(antwort.ziel)).map((antwort) => antwort.ziel),
    )

    expect(tote).toEqual([])
  })

  it('erreicht jeden Knoten von der Wurzel aus', () => {
    const gesehen = erreichbar()
    const verwaist = FRAGEBAUM.filter((knoten) => !gesehen.has(knoten.id)).map((knoten) => knoten.id)

    expect(verwaist).toEqual([])
  })

  it('gibt jeder Frage mindestens eine Antwort', () => {
    const sackgassen = FRAGEBAUM.filter(
      (knoten) => knoten.art === 'frage' && knoten.antworten.length === 0,
    ).map((knoten) => knoten.id)

    expect(sackgassen).toEqual([])
  })

  it('laesst kein Ergebnis weiterfuehren', () => {
    const weiter = FRAGEBAUM.filter(
      (knoten) => knoten.art === 'ergebnis' && knoten.antworten.length > 0,
    ).map((knoten) => knoten.id)

    expect(weiter).toEqual([])
  })

  it('gibt es keinen Zyklus: jeder Weg endet an einem Ergebnis', () => {
    // Ein Baum hat keine Zyklen, aber die Datei ist von Hand gepflegt: Eine
    // Antwort, die versehentlich auf einen Knoten weiter oben zeigt, ergaebe
    // einen Durchlauf, aus dem niemand herauskommt.
    const tiefe = new Map<string, number>()

    const messe = (id: string, weg: Set<string>): number => {
      if (weg.has(id)) {
        throw new Error(`Zyklus über ${id}`)
      }

      const gemerkt = tiefe.get(id)

      if (gemerkt !== undefined) {
        return gemerkt
      }

      const knoten = nachId.get(id)
      const kinder = knoten?.antworten ?? []
      const wert =
        kinder.length === 0
          ? 0
          : 1 + Math.max(...kinder.map((antwort) => messe(antwort.ziel, new Set(weg).add(id))))

      tiefe.set(id, wert)

      return wert
    }

    expect(() => messe(WURZEL, new Set())).not.toThrow()
    expect(messe(WURZEL, new Set())).toBeLessThan(20)
  })

  it('traegt einen Status nur an Ergebnissen', () => {
    const fragenMitStatus = FRAGEBAUM.filter(
      (knoten) => knoten.art === 'frage' && knoten.status !== undefined,
    ).map((knoten) => knoten.id)

    expect(fragenMitStatus).toEqual([])
  })

  it('benennt jeden vorkommenden Status', () => {
    const stati = new Set(
      FRAGEBAUM.map((knoten) => knoten.status).filter(
        (status): status is Erbstatus => status !== undefined,
      ),
    )

    expect(stati.size).toBeGreaterThan(0)

    for (const status of stati) {
      expect(statusText(status)).not.toBe('')
    }
  })

  it('bildet die Ergebnistexte auf die vereinbarten Status ab (§6)', () => {
    // Die Abbildung aus ERBE_DESIGN.md §6, an den Texten festgemacht. Sie ist
    // die eine Stelle, an der ein Vertippen in der Inhaltsdatei aus "Sie sind
    // Erbe" ein "Kein Erbe" machen wuerde, ohne dass es jemandem auffiele.
    const erwartet: [string, Erbstatus | undefined][] = [
      ['Sie sind Erbe.', 'erbe'],
      ['Sie könnten nach der gesetzlichen Erbfolge Erbe sein.', 'wahrscheinlich-erbe'],
      ['Sie sind wahrscheinlich kein Erbe.', 'wahrscheinlich-kein-erbe'],
      ['Sie sind kein Erbe.', 'kein-erbe'],
      ['Nach den Angaben lässt sich noch nicht sicher sagen, ob Sie Erbe sind.', undefined],
    ]

    for (const [text, status] of erwartet) {
      const treffer = FRAGEBAUM.filter((knoten) => knoten.text === text)

      expect(treffer.length, text).toBeGreaterThan(0)

      for (const knoten of treffer) {
        expect(knoten.status, text).toBe(status)
      }
    }
  })

  it('gibt der Ausschlagung "Noch Erbe" und der Anfechtung "Kein Erbe" (§6)', () => {
    const ausschlagung = FRAGEBAUM.filter((knoten) =>
      knoten.text.startsWith('Sie wollen das Erbe nicht (Ausschlagung)'),
    )
    const anfechtung = FRAGEBAUM.filter((knoten) =>
      knoten.text.startsWith('Informationen zur Testamentsanfechtung'),
    )

    expect(ausschlagung.length).toBeGreaterThan(0)
    expect(anfechtung.length).toBeGreaterThan(0)

    for (const knoten of ausschlagung) {
      expect(knoten.status).toBe('noch-erbe')
      expect(knoten.aufgabe).toBe('ausschlagung')
      expect(knoten.kenntnisdatum).toBe(true)
    }

    for (const knoten of anfechtung) {
      expect(knoten.status).toBe('kein-erbe')
      expect(knoten.aufgabe).toBe('anfechtung')
      expect(knoten.anfechtungsdatum).toBe(true)
    }
  })

  it('kennt zu jeder Aufgabenmarkierung einen Bauplan', () => {
    for (const knoten of FRAGEBAUM) {
      if (knoten.aufgabe !== undefined) {
        expect(BAUPLAENE[knoten.aufgabe]).toBeDefined()
      }
    }
  })

  it('bietet die Suche nach der zustaendigen Stelle auf jeder Aufgabenseite an (§8)', () => {
    // Alle drei Aufgaben brauchen das Nachlassgericht. Eine Seite, die zur
    // Aufgabe fuehrt und nicht sagt, wohin, liesse die Frage offen, die
    // unmittelbar danach kommt.
    for (const knoten of FRAGEBAUM) {
      if (knoten.aufgabe !== undefined) {
        expect(knoten.gericht, knoten.id).toBe(true)
      }
    }
  })

  it('uebersetzt die englischen Antwortlabels des Exports (§2)', () => {
    const englisch = FRAGEBAUM.flatMap((knoten) =>
      knoten.antworten.filter((antwort) => antwort.text === 'Yes' || antwort.text === 'No'),
    )

    expect(englisch).toEqual([])
  })

  it('laesst keine Regieanweisung des Exports im Text stehen (§2)', () => {
    const reste = FRAGEBAUM.filter(
      (knoten) =>
        knoten.text.includes('Eingabefeld') ||
        knoten.text.includes('Aufgabe erstellen') ||
        knoten.text.includes('/n'),
    ).map((knoten) => knoten.id)

    expect(reste).toEqual([])
  })

  it('schliesst jede Fettauszeichnung und laesst sie in ihrer Zeile (§2)', () => {
    // `**fett**` ist die einzige Auszeichnung in diesen Texten, und der Screen
    // loest sie zeilenweise auf. Ein vergessenes zweites Sternchenpaar stuende
    // roh auf der Seite, ein ueber einen Umbruch gezogenes bliebe unerkannt.
    const kaputt = FRAGEBAUM.filter((knoten) =>
      knoten.text.split('\n').some((zeile) => (zeile.split('**').length - 1) % 2 !== 0),
    ).map((knoten) => knoten.id)

    expect(kaputt).toEqual([])
  })

  it('legt die Kette "Ja oder Nein" zusammen (§2)', () => {
    const wollen = FRAGEBAUM.filter((knoten) => knoten.text === 'Wollen Sie das Erbe haben?')

    expect(wollen.length).toBeGreaterThan(0)

    for (const knoten of wollen) {
      // Statt einer einzigen Antwort "Ja oder Nein" stehen hier beide, und der
      // Hinweis ueber Schulden steht als Hinweis an der Frage.
      expect(knoten.antworten.map((antwort) => antwort.text)).toEqual([
        'Ja, ich will das Erbe',
        'Nein, ich will das Erbe nicht',
      ])
      expect(knoten.hinweis).toContain('Schulden')
    }
  })
})
