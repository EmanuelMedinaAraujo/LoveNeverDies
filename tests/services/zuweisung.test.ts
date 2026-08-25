import { describe, expect, it } from 'vitest'
import {
  ALLE,
  NIEMAND,
  benenne,
  darfAbhaken,
  darfBearbeiten,
  istFrei,
  istZugewiesen,
  mitPerson,
  nameImDativ,
  nameVon,
  ohnePerson,
  personen,
  uebernommenVon,
  zuweisungAus,
  zuweisungText,
  type Zuweisung,
} from '../../src/services/zuweisung'

/**
 * Wem eine Aufgabe gehört (DESIGN.md §7).
 *
 * Reine Regeln, ohne Netz und ohne Krypto: wer bearbeiten darf, wer sich
 * eintragen kann, und wer eine Aufgabe weggeschnappt hat. Dass die Zuweisung
 * verschlüsselt hinausgeht, steht in `aufgabenService.test.ts`: Hier steht,
 * was sie bedeutet.
 */

const ICH = { userId: 'user_anna', name: 'Anna Müller' }
const BERT = { userId: 'user_bert', name: 'Bert Müller' }

describe('zuweisungAus', () => {
  it('liest eine Personenliste', () => {
    expect(zuweisungAus({ art: 'personen', personen: [ICH] })).toEqual({
      art: 'personen',
      personen: [ICH],
    })
  })

  it('liest "Alle" als eigenen Wert und nicht als Liste aller Namen', () => {
    expect(zuweisungAus({ art: 'alle' })).toEqual(ALLE)
  })

  it('macht aus einem Payload ohne Zuweisung eine unzugewiesene Aufgabe', () => {
    expect(zuweisungAus(undefined)).toEqual(NIEMAND)
    expect(zuweisungAus(null)).toEqual(NIEMAND)
    expect(zuweisungAus('Anna')).toEqual(NIEMAND)
  })

  it('macht aus einer leeren Personenliste eine unzugewiesene Aufgabe', () => {
    expect(zuweisungAus({ art: 'personen', personen: [] })).toEqual(NIEMAND)
  })

  it('wirft Einträge ohne Kennung weg, statt daran zu scheitern', () => {
    expect(
      zuweisungAus({ art: 'personen', personen: [ICH, { name: 'Ohne Kennung' }, 42] }),
    ).toEqual({ art: 'personen', personen: [ICH] })
  })

  it('ergänzt einen fehlenden Namen, statt die Person zu verlieren', () => {
    expect(zuweisungAus({ art: 'personen', personen: [{ userId: 'user_bert' }] })).toEqual({
      art: 'personen',
      personen: [{ userId: 'user_bert', name: '' }],
    })
  })
})

describe('personen', () => {
  it('nimmt jede Person nur einmal auf', () => {
    expect(personen([ICH, { ...ICH, name: 'Anna M.' }])).toEqual({
      art: 'personen',
      personen: [ICH],
    })
  })

  it('ist ohne Person dasselbe wie unzugewiesen', () => {
    expect(personen([])).toEqual(NIEMAND)
  })
})

describe('istZugewiesen', () => {
  it('gilt für jede Person des Falls, wenn "Alle" zugewiesen ist', () => {
    expect(istZugewiesen(ALLE, ICH.userId)).toBe(true)
    expect(istZugewiesen(ALLE, BERT.userId)).toBe(true)
  })

  it('gilt nur für die genannten Personen', () => {
    const zuweisung = personen([BERT])

    expect(istZugewiesen(zuweisung, BERT.userId)).toBe(true)
    expect(istZugewiesen(zuweisung, ICH.userId)).toBe(false)
  })

  it('gilt für niemanden, solange die Aufgabe frei ist', () => {
    expect(istZugewiesen(NIEMAND, ICH.userId)).toBe(false)
  })
})

describe('darfBearbeiten', () => {
  it('erlaubt es der zugewiesenen Person', () => {
    expect(darfBearbeiten(personen([ICH]), ICH.userId)).toBe(true)
  })

  it('verwehrt es allen anderen — sie sehen die Aufgabe, ändern sie aber nicht (§7)', () => {
    expect(darfBearbeiten(personen([BERT]), ICH.userId)).toBe(false)
  })

  it('verwehrt es auch bei einer freien Aufgabe: erst übernehmen, dann bearbeiten', () => {
    expect(darfBearbeiten(NIEMAND, ICH.userId)).toBe(false)
    expect(istFrei(NIEMAND)).toBe(true)
  })
})

describe('darfAbhaken', () => {
  it('erlaubt das Häkchen auf einer freien Aufgabe', () => {
    // Sie abzuhaken *ist* die Ansage "ich habe das gemacht"; `useAufgaben`
    // trägt die Übernahme im selben Payload mit.
    expect(darfAbhaken(NIEMAND, ICH.userId)).toBe(true)
  })

  it('erlaubt es der zugewiesenen Person wie darfBearbeiten', () => {
    expect(darfAbhaken(personen([ICH]), ICH.userId)).toBe(true)
    expect(darfAbhaken(ALLE, ICH.userId)).toBe(true)
  })

  it('verwehrt es auf einer fremden Aufgabe', () => {
    // Die Sperre soll verhindern, dass zwei Menschen dieselbe Behörde
    // anrufen. Sie beiläufig zu übergehen hieße, sie abzuschaffen.
    expect(darfAbhaken(personen([BERT]), ICH.userId)).toBe(false)
  })
})

describe('mitPerson und ohnePerson', () => {
  it('trägt eine Person ein', () => {
    expect(mitPerson(NIEMAND, ICH)).toEqual(personen([ICH]))
    expect(mitPerson(personen([ICH]), BERT)).toEqual(personen([ICH, BERT]))
  })

  it('trägt dieselbe Person kein zweites Mal ein', () => {
    expect(mitPerson(personen([ICH]), ICH)).toEqual(personen([ICH]))
  })

  it('löst die Reservierung — und zwar von jedem, nicht nur von der reservierenden Person', () => {
    expect(ohnePerson(personen([BERT]), BERT.userId)).toEqual(NIEMAND)
  })

  it('lässt die übrigen Personen stehen', () => {
    expect(ohnePerson(personen([ICH, BERT]), BERT.userId)).toEqual(personen([ICH]))
  })

  it('lässt "Alle" unangetastet — dort wird die Art gewechselt, nicht eine Person', () => {
    expect(mitPerson(ALLE, ICH)).toEqual(ALLE)
    expect(ohnePerson(ALLE, ICH.userId)).toEqual(ALLE)
  })
})

describe('zuweisungText', () => {
  it('nennt die angemeldete Person "Sie"', () => {
    expect(zuweisungText(personen([ICH]), ICH.userId)).toBe('Sie')
  })

  it('nennt die anderen beim Namen', () => {
    expect(zuweisungText(personen([BERT]), ICH.userId)).toBe('Bert Müller')
  })

  it('zählt mehrere Personen auf', () => {
    expect(zuweisungText(personen([ICH, BERT]), ICH.userId)).toBe('Sie und Bert Müller')
  })

  it('nennt "Alle" beim eigenen Namen und nicht als Liste', () => {
    expect(zuweisungText(ALLE, ICH.userId)).toBe('Alle')
  })

  it('sagt bei einer freien Aufgabe, dass sie frei ist', () => {
    expect(zuweisungText(NIEMAND, ICH.userId)).toBe('Niemand')
  })

  it('behilft sich, wenn der Name einer Person nicht bekannt ist', () => {
    expect(zuweisungText(personen([{ userId: 'user_carla', name: '' }]), ICH.userId)).toBe(
      'Weiteres Mitglied',
    )
  })
})

describe('uebernommenVon', () => {
  it('nennt die Person, die zuerst da war', () => {
    expect(uebernommenVon(personen([BERT]), ICH.userId)).toBe('Bert Müller')
  })

  it('schweigt, wenn die eigene Reservierung durchgekommen ist', () => {
    expect(uebernommenVon(personen([ICH, BERT]), ICH.userId)).toBeNull()
  })

  it('schweigt bei "Alle" — dort ist die angemeldete Person zugewiesen', () => {
    expect(uebernommenVon(ALLE, ICH.userId)).toBeNull()
  })

  it('schweigt bei einer wieder freigegebenen Aufgabe', () => {
    expect(uebernommenVon(NIEMAND, ICH.userId)).toBeNull()
  })
})

describe('Serialisierung', () => {
  it('übersteht den Weg durch den Payload', () => {
    const zuweisung: Zuweisung = personen([ICH, BERT])

    expect(zuweisungAus(JSON.parse(JSON.stringify(zuweisung)))).toEqual(zuweisung)
  })
})

describe('benenne', () => {
  it('kennt die angemeldete Person aus der Anmeldung', () => {
    expect(benenne([ICH.userId], [], ICH)).toEqual([ICH])
  })

  it('holt den Namen der anderen aus den Zuweisungen des Falls', () => {
    expect(benenne([ICH.userId, BERT.userId], [personen([BERT])], ICH)).toEqual([ICH, BERT])
  })

  it('lässt ein Mitglied ohne Namen trotzdem auswählbar', () => {
    expect(benenne([ICH.userId, 'user_carla'], [], ICH)).toEqual([
      ICH,
      { userId: 'user_carla', name: '' },
    ])
  })

  it('behält die Reihenfolge der Mitgliedschaften', () => {
    expect(benenne([BERT.userId, ICH.userId], [personen([BERT])], ICH)).toEqual([BERT, ICH])
  })
})

describe('nameVon', () => {
  it('sagt "Sie" zur angemeldeten Person', () => {
    expect(nameVon(ICH, ICH.userId)).toBe('Sie')
  })

  it('behilft sich ohne Namen', () => {
    expect(nameVon({ userId: 'user_carla', name: '' }, ICH.userId)).toBe('Weiteres Mitglied')
  })
})

describe('nameImDativ', () => {
  it('sagt "Ihnen" zur angemeldeten Person', () => {
    // Die Kaestchen antworten auf "Wem ist sie zugewiesen?". "Sie" waere dort
    // der falsche Fall.
    expect(nameImDativ(ICH, ICH.userId)).toBe('Ihnen')
  })

  it('laesst einen Eigennamen, wie er ist', () => {
    expect(nameImDativ(BERT, ICH.userId)).toBe('Bert Müller')
  })

  it('behilft sich ohne Namen wie nameVon', () => {
    expect(nameImDativ({ userId: 'user_carla', name: '' }, ICH.userId)).toBe('Weiteres Mitglied')
  })
})
