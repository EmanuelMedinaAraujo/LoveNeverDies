import { describe, expect, it } from 'vitest'
import type { Aufgabe, Katalogherkunft } from '../../src/services/aufgabenService'
import { baueBaum } from '../../src/services/aufgabenbaum'
import { ERINNERUNGSTAGE, planeErinnerungen } from '../../src/services/erinnerungen'
import { NIEMAND } from '../../src/services/zuweisung'

/**
 * Lokale Erinnerungen (DESIGN.md §7).
 *
 * "Rein lokal, aus entschlüsselten Fristen, nach jeder Synchronisation neu
 * geplant." Server-Push gibt es nicht und kann es nicht geben: Der Server
 * kennt die Fristen nicht, sie liegen verschlüsselt im Payload (§3.3).
 *
 * Dieser Teil ist die Planung und rein: Aufgaben und eine Uhrzeit hinein,
 * Termine heraus. Was daraus Timer macht, steht in `useErinnerungen`.
 */

const STERBEDATUM = '2026-05-12'

function aufgabe(ueberschreibung: Partial<Aufgabe> = {}): Aufgabe {
  return {
    id: 'item-1',
    titel: 'Sterbefall anzeigen',
    beschreibung: '',
    erledigt: false,
    notizen: '',
    parentId: null,
    dependsOn: [],
    assignee: NIEMAND,
    katalog: null,
    dek: new Uint8Array([9]),
    kid: 'case_fall-1:1',
    privat: false,
    ...ueberschreibung,
  }
}

function mitFrist(tage: number, ueberschreibung: Partial<Aufgabe> = {}): Aufgabe {
  const katalog: Katalogherkunft = {
    aufgabeId: 'sterbefall-anzeigen',
    version: '2026-08+testtest',
    fristTage: tage,
    fristAb: 'sterbedatum',
    zustaendigeStelle: '',
    benoetigteDokumente: [],
    unteraufgaben: [],
    haengtAbVon: [],
    hinweis: '',
    kategorie: '',
    reihenfolge: 10,
  }

  return aufgabe({ katalog, ...ueberschreibung })
}

/** Dieselbe Aufgabe, aber mit einer Frist ab der eigenen Kenntnis (§8, #12). */
function abKenntnis(tage: number, ueberschreibung: Partial<Aufgabe> = {}): Aufgabe {
  const vorlage = mitFrist(tage, ueberschreibung)

  return vorlage.katalog === null
    ? vorlage
    : { ...vorlage, katalog: { ...vorlage.katalog, fristAb: 'kenntnis' } }
}

/** Der Morgen des angegebenen Kalendertags, lokale Zeit. */
function morgens(iso: string, stunde = 6): Date {
  const [jahr, monat, tag] = iso.split('-').map(Number)

  return new Date(jahr ?? 0, (monat ?? 1) - 1, tag ?? 1, stunde)
}

function plan(aufgaben: Aufgabe[], jetzt: Date, kenntnisAm: string | null = null) {
  return planeErinnerungen(baueBaum(aufgaben), { sterbedatum: STERBEDATUM, kenntnisAm }, jetzt)
}

describe('planeErinnerungen (§7)', () => {
  it('plant zu einer Frist einen Termin je Vorlauf', () => {
    // Fristende: 12. Mai + 10 Tage = 22. Mai.
    const termine = plan([mitFrist(10)], morgens('2026-05-12'))

    expect(termine).toHaveLength(ERINNERUNGSTAGE.length)
    expect(termine.map((termin) => termin.wann)).toEqual([...termine.map((t) => t.wann)].sort((a, b) => a - b))
  })

  it('legt jeden Termin auf den Morgen des jeweiligen Tages', () => {
    const [erster] = plan([mitFrist(10)], morgens('2026-05-12'))
    const wann = new Date(erster?.wann ?? 0)

    // 22. Mai minus dem grössten Vorlauf.
    expect(wann.getDate()).toBe(22 - (ERINNERUNGSTAGE[0] ?? 0))
    expect(wann.getHours()).toBe(9)
    expect(wann.getMinutes()).toBe(0)
  })

  it('lässt vergangene Termine weg', () => {
    // Zwei Tage vor dem Ende: Was sieben und drei Tage vorher fällig war, ist
    // vorbei. Eine Erinnerung, die sofort losgeht, ist keine Erinnerung.
    const termine = plan([mitFrist(10)], morgens('2026-05-20'))

    expect(termine.every((termin) => termin.wann > morgens('2026-05-20').getTime())).toBe(true)
    expect(termine.length).toBeLessThan(ERINNERUNGSTAGE.length)
  })

  it('erinnert nicht an eine erledigte Aufgabe', () => {
    expect(plan([mitFrist(10, { erledigt: true })], morgens('2026-05-12'))).toEqual([])
  })

  it('erinnert nicht an eine Aufgabe, deren Unteraufgaben alle erledigt sind', () => {
    // §7: Sind alle Kinder erledigt, gilt sie zwingend als erledigt, auch für
    // die Erinnerung, deren gespeichertes Feld noch `false` sagt.
    const eltern = mitFrist(10, { id: 'eltern', erledigt: false })
    const kind = aufgabe({ id: 'kind', parentId: 'eltern', erledigt: true })

    expect(plan([eltern, kind], morgens('2026-05-12'))).toEqual([])
  })

  it('erinnert nicht an eine Aufgabe ohne gesetzliche Frist', () => {
    expect(plan([aufgabe()], morgens('2026-05-12'))).toEqual([])
  })

  it('erinnert nicht an eine Frist ab Kenntnis, solange das Datum fehlt', () => {
    // §8: Die App rechnet nicht mit einer Vermutung. Eine Erinnerung zu einem
    // geratenen Fristende wäre genau das (#12).
    expect(plan([abKenntnis(42)], morgens('2026-05-12'))).toEqual([])
  })

  it('plant die Termine, sobald das Kenntnisdatum eingetragen ist (#12)', () => {
    /*
     * §7: "nach jeder Synchronisation neu geplant". Das eingetragene
     * Kenntnisdatum kommt als privates Konfigurations-Item über denselben Weg
     * herein (§3.7), also plant dieselbe Funktion mit demselben Baum neu.
     */
    const termine = plan([abKenntnis(10)], morgens('2026-06-01'), '2026-06-01')

    expect(termine.map((termin) => termin.text)).toEqual([
      '„Sterbefall anzeigen" ist in 7 Tagen fällig.',
      '„Sterbefall anzeigen" ist in 3 Tagen fällig.',
      '„Sterbefall anzeigen" ist morgen fällig.',
      '„Sterbefall anzeigen" ist heute fällig.',
    ])
  })

  it('plant für zwei Kenntnisdaten zwei verschiedene Tage (§8, #12)', () => {
    // Dieselbe Aufgabe, dieselbe Zeile: Was auseinandergeht, ist allein das
    // Datum, das jede Person für sich eingetragen hat.
    const frueh = plan([abKenntnis(10)], morgens('2026-06-01'), '2026-06-01')
    const spaet = plan([abKenntnis(10)], morgens('2026-06-01'), '2026-06-04')

    expect(frueh.at(-1)?.wann).not.toBe(spaet.at(-1)?.wann)
  })

  it('erinnert nicht mehr an eine abgelaufene Frist', () => {
    expect(plan([mitFrist(3)], morgens('2026-06-01'))).toEqual([])
  })

  it('plant nichts über den Horizont hinaus, den ein Timer trägt', () => {
    /*
     * `setTimeout` hält nur knapp 25 Tage; eine längere Frist würde sofort
     * feuern. Geplant wird deshalb nur, was in Reichweite ist, und beim
     * nächsten Abgleich neu (§7).
     */
    expect(plan([mitFrist(365)], morgens('2026-05-12'))).toEqual([])
  })

  it('nennt die Aufgabe und die Restzeit beim Namen', () => {
    const termine = plan([mitFrist(10, { titel: 'Sterbefall anzeigen' })], morgens('2026-05-12'))
    const letzter = termine.at(-1)

    expect(letzter?.itemId).toBe('item-1')
    expect(letzter?.titel).toBe('Sterbefall anzeigen')
    expect(letzter?.text).toContain('Sterbefall anzeigen')
  })

  it('sagt am Fristtag, dass es der Fristtag ist', () => {
    const termine = plan([mitFrist(2)], morgens('2026-05-13', 5))
    const letzter = termine.at(-1)

    expect(letzter?.text).toBe('„Sterbefall anzeigen" ist heute fällig.')
  })

  it('sortiert die Termine nach Zeit', () => {
    const termine = plan(
      [mitFrist(20, { id: 'spaet' }), mitFrist(5, { id: 'frueh', titel: 'Früh' })],
      morgens('2026-05-12'),
    )

    expect(termine[0]?.itemId).toBe('frueh')
  })

  it('plant ohne Sterbedatum nichts', () => {
    expect(
      planeErinnerungen(
        baueBaum([mitFrist(10)]),
        { sterbedatum: null, kenntnisAm: null },
        morgens('2026-05-12'),
      ),
    ).toEqual([])
  })
})
