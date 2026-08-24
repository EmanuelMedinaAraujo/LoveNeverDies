import { describe, expect, it } from 'vitest'
import type { Aufgabe, Katalogherkunft } from '../../src/services/aufgabenService'
import { baueBaum, knotenZu, sortiereNachFrist } from '../../src/services/aufgabenbaum'
import { NIEMAND } from '../../src/services/zuweisung'

/**
 * Der Aufgabenbaum: eine Ebene, abgeleiteter Abschluss, Abhängigkeiten
 * (DESIGN.md §7).
 *
 * Drei Regeln, alle aus §7:
 *
 *   1. Eine Aufgabe ohne Unteraufgaben ist ein Blatt und wird direkt abgehakt.
 *   2. Eine Aufgabe mit Unteraufgaben hat kein eigenes Häkchen und gilt genau
 *      dann als erledigt, wenn alle Kinder es sind — und dann zwingend.
 *   3. Eine Aufgabe mit offenen Abhängigkeiten ist blockiert und benennt sie.
 *
 * Der abgeleitete Abschluss ist der Grund, warum hier nichts gespeichert wird:
 * Es gibt nichts zu synchronisieren und nichts, was divergieren kann.
 */

function aufgabe(ueberschreibung: Partial<Aufgabe> = {}): Aufgabe {
  return {
    id: 'item-1',
    titel: 'Sterbeurkunde beantragen',
    beschreibung: '',
    erledigt: false,
    notizen: '',
    parentId: null,
    dependsOn: [],
    assignee: NIEMAND,
    katalog: null,
    dek: new Uint8Array([9]),
    kid: 'case_fall-1:1',
    ...ueberschreibung,
  }
}

function herkunft(ueberschreibung: Partial<Katalogherkunft> = {}): Katalogherkunft {
  return {
    aufgabeId: 'sterbefall-anzeigen',
    version: '2026-08+testtest',
    fristTage: null,
    fristAb: null,
    rechtsgrundlage: '',
    zustaendigeStelle: '',
    benoetigteDokumente: [],
    unteraufgaben: [],
    haengtAbVon: [],
    hinweis: '',
    quelleUrl: '',
    kategorie: '',
    reihenfolge: 10,
    ...ueberschreibung,
  }
}

describe('baueBaum (§7)', () => {
  it('hängt Unteraufgaben unter ihre Elternaufgabe und nicht in die Liste', () => {
    const eltern = aufgabe({ id: 'eltern' })
    const kind = aufgabe({ id: 'kind', titel: 'Sterbeurkunden bestellen', parentId: 'eltern' })

    const baum = baueBaum([eltern, kind])

    expect(baum).toHaveLength(1)
    expect(baum[0]?.aufgabe.id).toBe('eltern')
    expect(baum[0]?.unteraufgaben.map((unter) => unter.id)).toEqual(['kind'])
  })

  it('gibt einem Blatt ein eigenes Häkchen', () => {
    const [knoten] = baueBaum([aufgabe({ erledigt: true })])

    expect(knoten?.istBlatt).toBe(true)
    expect(knoten?.erledigt).toBe(true)
  })

  it('nimmt einer Aufgabe mit Unteraufgaben das eigene Häkchen', () => {
    const eltern = aufgabe({ id: 'eltern', erledigt: true })
    const kind = aufgabe({ id: 'kind', parentId: 'eltern', erledigt: false })

    const [knoten] = baueBaum([eltern, kind])

    // Das gespeicherte `erledigt` der Elternaufgabe zählt nicht mehr. Es steht
    // im Payload, weil ein Payload ohne es nicht zu schreiben wäre — gelesen
    // wird es nie (§7).
    expect(knoten?.istBlatt).toBe(false)
    expect(knoten?.erledigt).toBe(false)
  })

  it('gilt als erledigt, sobald alle Kinder es sind — und dann zwingend', () => {
    const eltern = aufgabe({ id: 'eltern', erledigt: false })
    const kinder = [
      aufgabe({ id: 'kind-1', parentId: 'eltern', erledigt: true }),
      aufgabe({ id: 'kind-2', parentId: 'eltern', erledigt: true }),
    ]

    const [knoten] = baueBaum([eltern, ...kinder])

    expect(knoten?.erledigt).toBe(true)
  })

  it('bleibt offen, solange ein Kind offen ist', () => {
    const eltern = aufgabe({ id: 'eltern' })
    const kinder = [
      aufgabe({ id: 'kind-1', parentId: 'eltern', erledigt: true }),
      aufgabe({ id: 'kind-2', parentId: 'eltern', erledigt: false }),
    ]

    expect(baueBaum([eltern, ...kinder])[0]?.erledigt).toBe(false)
  })

  it('lässt zwei getrennt gesetzte Häkchen beide gelten', () => {
    /*
     * §7: „Läge alles im Payload der Elternaufgabe, überlebte von zwei offline
     * gesetzten Häkchen genau eines." Zwei Zeilen, zwei Häkchen, beide da —
     * das ist die ganze Begründung für eigene Zeilen.
     */
    const eltern = aufgabe({ id: 'eltern' })
    const vomHandy = aufgabe({ id: 'kind-1', parentId: 'eltern', erledigt: true })
    const vomLaptop = aufgabe({ id: 'kind-2', parentId: 'eltern', erledigt: true })

    const [knoten] = baueBaum([eltern, vomHandy, vomLaptop])

    expect(knoten?.unteraufgaben.map((unter) => unter.erledigt)).toEqual([true, true])
    expect(knoten?.erledigt).toBe(true)
  })

  it('verschachtelt nicht: das Kind eines Kindes steht als Wurzel', () => {
    // §7: eine Ebene, keine Verschachtelung. Ein Enkel darf trotzdem nicht
    // verschwinden — er wird eine Wurzelaufgabe.
    const eltern = aufgabe({ id: 'eltern' })
    const kind = aufgabe({ id: 'kind', parentId: 'eltern' })
    const enkel = aufgabe({ id: 'enkel', parentId: 'kind' })

    const baum = baueBaum([eltern, kind, enkel])

    expect(baum.map((knoten) => knoten.aufgabe.id)).toEqual(['eltern', 'enkel'])
    expect(baum[0]?.unteraufgaben.map((unter) => unter.id)).toEqual(['kind'])
  })

  it('lässt eine verwaiste Unteraufgabe stehen statt sie zu verschlucken', () => {
    // Die Elternaufgabe ist gelöscht, das Kind nicht. Sichtbar bleiben muss es
    // trotzdem — sonst hätte jemand eine Aufgabe, die es nirgends mehr gibt.
    const waise = aufgabe({ id: 'kind', parentId: 'weg' })

    expect(baueBaum([waise]).map((knoten) => knoten.aufgabe.id)).toEqual(['kind'])
  })

  it('behält die Reihenfolge, in der die Aufgaben ankommen', () => {
    const erste = aufgabe({ id: 'a' })
    const zweite = aufgabe({ id: 'b' })

    expect(baueBaum([erste, zweite]).map((knoten) => knoten.aufgabe.id)).toEqual(['a', 'b'])
  })
})

describe('Abhängigkeiten (§7)', () => {
  it('benennt die offene Aufgabe, auf die gewartet wird', () => {
    const zuerst = aufgabe({ id: 'zuerst', titel: 'Sterbefall anzeigen' })
    const danach = aufgabe({ id: 'danach', dependsOn: ['zuerst'] })

    const baum = baueBaum([zuerst, danach])

    expect(baum[1]?.blockiertVon.map((offen) => offen.titel)).toEqual(['Sterbefall anzeigen'])
  })

  it('gibt die Aufgabe frei, sobald die Abhängigkeit erledigt ist', () => {
    const zuerst = aufgabe({ id: 'zuerst', erledigt: true })
    const danach = aufgabe({ id: 'danach', dependsOn: ['zuerst'] })

    expect(baueBaum([zuerst, danach])[1]?.blockiertVon).toEqual([])
  })

  it('wartet auf den abgeleiteten Abschluss und nicht auf das gespeicherte Feld', () => {
    // Die Elternaufgabe trägt `erledigt: false` im Payload, ihre Kinder sind
    // fertig — dann ist sie fertig, und was von ihr abhängt, ist frei.
    const zuerst = aufgabe({ id: 'zuerst', erledigt: false })
    const kind = aufgabe({ id: 'kind', parentId: 'zuerst', erledigt: true })
    const danach = aufgabe({ id: 'danach', dependsOn: ['zuerst'] })

    const baum = baueBaum([zuerst, kind, danach])

    expect(baum[1]?.blockiertVon).toEqual([])
  })

  it('blockiert nicht auf eine Abhängigkeit, die es nicht mehr gibt', () => {
    /*
     * Die Aufgabe, auf die verwiesen wird, ist gelöscht — oder sie ist die
     * private Aufgabe einer anderen Person und für dieses Mitglied gar nicht
     * da (§3.7). Eine Aufgabe, die dauerhaft blockiert bliebe, wäre in beiden
     * Fällen eine versäumte Frist ohne Ausweg.
     */
    const danach = aufgabe({ id: 'danach', dependsOn: ['gibt-es-nicht'] })

    expect(baueBaum([danach])[0]?.blockiertVon).toEqual([])
  })

  it('nennt mehrere offene Abhängigkeiten alle', () => {
    const eins = aufgabe({ id: 'eins', titel: 'Eins' })
    const zwei = aufgabe({ id: 'zwei', titel: 'Zwei', erledigt: true })
    const drei = aufgabe({ id: 'drei', titel: 'Drei' })
    const danach = aufgabe({ id: 'danach', dependsOn: ['eins', 'zwei', 'drei'] })

    const baum = baueBaum([eins, zwei, drei, danach])

    expect(baum[3]?.blockiertVon.map((offen) => offen.titel)).toEqual(['Eins', 'Drei'])
  })
})

describe('knotenZu', () => {
  it('findet eine Wurzelaufgabe mit ihren Unteraufgaben', () => {
    const eltern = aufgabe({ id: 'eltern' })
    const kind = aufgabe({ id: 'kind', parentId: 'eltern' })

    expect(knotenZu([eltern, kind], 'eltern')?.unteraufgaben).toHaveLength(1)
  })

  it('findet auch eine Unteraufgabe, damit ein Link auf sie nicht ins Leere geht', () => {
    const eltern = aufgabe({ id: 'eltern' })
    const kind = aufgabe({ id: 'kind', parentId: 'eltern' })

    expect(knotenZu([eltern, kind], 'kind')?.aufgabe.id).toBe('kind')
  })

  it('gibt null zurück, wo es nichts gibt', () => {
    expect(knotenZu([aufgabe()], 'weg')).toBeNull()
  })
})

describe('sortiereNachFrist (§7)', () => {
  it('stellt die knappste Frist nach vorn und lässt fristenlose hinten', () => {
    const spaet = aufgabe({
      id: 'spaet',
      katalog: herkunft({ fristTage: 42, fristAb: 'sterbedatum' }),
    })
    const ohne = aufgabe({ id: 'ohne' })
    const frueh = aufgabe({
      id: 'frueh',
      katalog: herkunft({ fristTage: 3, fristAb: 'sterbedatum' }),
    })

    const sortiert = sortiereNachFrist(baueBaum([spaet, ohne, frueh]), '2026-05-12', '2026-05-12')

    expect(sortiert.map((knoten) => knoten.aufgabe.id)).toEqual(['frueh', 'spaet', 'ohne'])
  })

  it('lässt die Reihenfolge der Juristinnen stehen, wo keine Frist entscheidet', () => {
    const erste = aufgabe({ id: 'a' })
    const zweite = aufgabe({ id: 'b' })

    const sortiert = sortiereNachFrist(baueBaum([erste, zweite]), '2026-05-12', '2026-05-12')

    expect(sortiert.map((knoten) => knoten.aufgabe.id)).toEqual(['a', 'b'])
  })

  it('lässt den übergebenen Baum unangetastet', () => {
    const spaet = aufgabe({
      id: 'spaet',
      katalog: herkunft({ fristTage: 42, fristAb: 'sterbedatum' }),
    })
    const frueh = aufgabe({
      id: 'frueh',
      katalog: herkunft({ fristTage: 3, fristAb: 'sterbedatum' }),
    })

    const baum = baueBaum([spaet, frueh])
    sortiereNachFrist(baum, '2026-05-12', '2026-05-12')

    expect(baum.map((knoten) => knoten.aufgabe.id)).toEqual(['spaet', 'frueh'])
  })
})
