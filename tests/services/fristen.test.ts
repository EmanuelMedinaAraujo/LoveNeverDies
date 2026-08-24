import { describe, expect, it } from 'vitest'
import type { Katalogherkunft } from '../../src/services/aufgabenService'
import {
  datumText,
  fristlage,
  fristText,
  heuteIso,
  vergleicheNachFrist,
  type Fristlage,
} from '../../src/services/fristen'

/**
 * Fristen (DESIGN.md §8, §7).
 *
 * Die eine Zusage, an der alles hängt: **Ein Item speichert `{fristTage,
 * fristAb}`, nie ein Datum.** Das Fristende wird bei jedem Rendern berechnet
 * und nirgends abgelegt. Dieselbe Zeile zeigt deshalb morgen einen Tag weniger,
 * ohne dass sich irgendwo etwas ändert.
 *
 * Und die zweite: Fehlt eine gesetzliche Frist, wird keine erfunden. Eine
 * Aufgabe ohne `fristTage` zeigt kein Datum, keinen Zähler und kein "bald".
 */

function herkunft(ueberschreibung: Partial<Katalogherkunft> = {}): Katalogherkunft {
  return {
    aufgabeId: 'sterbefall-anzeigen',
    version: '2026-08+testtest',
    fristTage: 3,
    fristAb: 'sterbedatum',
    rechtsgrundlage: '§ 28 PStG',
    zustaendigeStelle: 'Standesamt des Sterbeortes',
    benoetigteDokumente: [],
    unteraufgaben: [],
    haengtAbVon: [],
    hinweis: '',
    quelleUrl: '',
    kategorie: 'Sofort',
    reihenfolge: 10,
    ...ueberschreibung,
  }
}

describe('fristlage (§8)', () => {
  it('rechnet das Fristende aus Sterbedatum und Fristtagen', () => {
    expect(fristlage(herkunft(), '2026-05-12', '2026-05-12')).toEqual({
      art: 'datum',
      ende: '2026-05-15',
      restTage: 3,
    })
  })

  it('zählt die Resttage von heute und nicht vom Sterbedatum', () => {
    expect(fristlage(herkunft(), '2026-05-12', '2026-05-14')).toMatchObject({ restTage: 1 })
    expect(fristlage(herkunft(), '2026-05-12', '2026-05-15')).toMatchObject({ restTage: 0 })
    expect(fristlage(herkunft(), '2026-05-12', '2026-05-18')).toMatchObject({ restTage: -3 })
  })

  it('rechnet über einen Monatswechsel und über ein Schaltjahr hinweg', () => {
    expect(fristlage(herkunft({ fristTage: 42 }), '2024-02-20', '2024-02-20')).toMatchObject({
      ende: '2024-04-02',
    })
  })

  it('erfindet keine Frist, wo das Gesetz keine nennt', () => {
    const ohne = herkunft({ fristTage: null, fristAb: null, rechtsgrundlage: '' })

    expect(fristlage(ohne, '2026-05-12', '2026-05-12')).toEqual({ art: 'keine' })
  })

  it('erfindet auch dann keine, wenn nur eines der beiden Felder fehlt', () => {
    expect(fristlage(herkunft({ fristTage: null }), '2026-05-12', '2026-05-12')).toEqual({
      art: 'keine',
    })
    expect(fristlage(herkunft({ fristAb: null }), '2026-05-12', '2026-05-12')).toEqual({
      art: 'keine',
    })
  })

  it('gibt einer selbst angelegten Aufgabe keine Frist', () => {
    expect(fristlage(null, '2026-05-12', '2026-05-12')).toEqual({ art: 'keine' })
  })

  it('rechnet eine Frist ab Kenntnis nicht aus, sondern benennt sie', () => {
    /*
     * §8: Aufgaben mit `frist_ab = kenntnis` bleiben ohne `kenntnisAm`
     * fristenlos und tragen den sichtbaren Hinweis. Die App rechnet nicht mit
     * einer Vermutung: Eine falsch berechnete Ausschlagungsfrist kostet den
     * ganzen Nachlass. Das Kenntnisdatum selbst kommt in #12.
     */
    const ausschlagung = herkunft({ fristTage: 42, fristAb: 'kenntnis' })

    expect(fristlage(ausschlagung, '2026-05-12', '2026-05-12')).toEqual({ art: 'ab-kenntnis' })
  })

  it('rechnet ohne Sterbedatum nichts aus', () => {
    expect(fristlage(herkunft(), null, '2026-05-12')).toEqual({ art: 'keine' })
  })

  it('rechnet aus einem unbrauchbaren Sterbedatum nichts aus', () => {
    expect(fristlage(herkunft(), 'irgendwann', '2026-05-12')).toEqual({ art: 'keine' })
  })
})

describe('fristText (§7)', () => {
  function text(restTage: number): string | null {
    return fristText({ art: 'datum', ende: '2026-05-15', restTage })
  }

  it('nennt die Restzeit', () => {
    expect(text(3)).toBe('noch 3 Tage')
    expect(text(1)).toBe('noch 1 Tag')
  })

  it('nennt den letzten Tag beim Namen', () => {
    expect(text(0)).toBe('heute fällig')
  })

  it('beschönigt eine abgelaufene Frist nicht', () => {
    expect(text(-1)).toBe('seit 1 Tag überfällig')
    expect(text(-4)).toBe('seit 4 Tagen überfällig')
  })

  it('sagt bei einer Frist ab Kenntnis, woran sie hängt', () => {
    expect(fristText({ art: 'ab-kenntnis' })).toBe('Frist ab Ihrer Kenntnis')
  })

  it('schweigt, wo es keine Frist gibt', () => {
    expect(fristText({ art: 'keine' })).toBeNull()
  })
})

describe('vergleicheNachFrist (§7)', () => {
  const frueh: Fristlage = { art: 'datum', ende: '2026-05-15', restTage: 3 }
  const spaet: Fristlage = { art: 'datum', ende: '2026-06-23', restTage: 42 }

  it('stellt die knappste Frist nach vorn', () => {
    expect(vergleicheNachFrist(frueh, spaet)).toBeLessThan(0)
    expect(vergleicheNachFrist(spaet, frueh)).toBeGreaterThan(0)
  })

  it('stellt Aufgaben mit Frist vor Aufgaben ohne', () => {
    expect(vergleicheNachFrist(spaet, { art: 'keine' })).toBeLessThan(0)
    expect(vergleicheNachFrist({ art: 'ab-kenntnis' }, { art: 'keine' })).toBeLessThan(0)
    expect(vergleicheNachFrist(spaet, { art: 'ab-kenntnis' })).toBeLessThan(0)
  })

  it('lässt Gleiches gleich und damit die bisherige Reihenfolge stehen', () => {
    expect(vergleicheNachFrist({ art: 'keine' }, { art: 'keine' })).toBe(0)
    expect(vergleicheNachFrist(frueh, { ...frueh })).toBe(0)
  })
})

describe('heuteIso', () => {
  it('nimmt den Kalendertag der Uhr des Geräts', () => {
    expect(heuteIso(new Date(2026, 4, 12, 23, 30))).toBe('2026-05-12')
    expect(heuteIso(new Date(2026, 0, 1, 0, 5))).toBe('2026-01-01')
  })
})

describe('datumText', () => {
  it('schreibt ein Fristende aus', () => {
    expect(datumText('2026-05-15')).toBe('15. Mai 2026')
  })
})
