import { describe, expect, it } from 'vitest'
import type { Katalogherkunft } from '../../src/services/aufgabenService'
import {
  datumText,
  fristlage,
  fristText,
  heuteIso,
  naechsterWerktag,
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
    zustaendigeStelle: 'Standesamt des Sterbeortes',
    benoetigteDokumente: [],
    unteraufgaben: [],
    haengtAbVon: [],
    hinweis: '',
    kategorie: 'Sofort',
    reihenfolge: 10,
    ...ueberschreibung,
  }
}

/** Sterbedatum und eigenes Kenntnisdatum, wie `fristlage` sie erwartet (§8). */
function bezug(
  sterbedatum: string | null,
  kenntnisAm: string | null = null,
  anfechtungKenntnisAm: string | null = null,
) {
  return { sterbedatum, kenntnisAm, anfechtungKenntnisAm }
}

describe('fristlage (§8)', () => {
  it('rechnet das Fristende aus Sterbedatum und Fristtagen', () => {
    expect(fristlage(herkunft(), bezug('2026-05-12'), '2026-05-12')).toEqual({
      art: 'datum',
      ende: '2026-05-15',
      restTage: 3,
    })
  })

  it('zählt die Resttage von heute und nicht vom Sterbedatum', () => {
    expect(fristlage(herkunft(), bezug('2026-05-12'), '2026-05-14')).toMatchObject({ restTage: 1 })
    expect(fristlage(herkunft(), bezug('2026-05-12'), '2026-05-15')).toMatchObject({ restTage: 0 })
    expect(fristlage(herkunft(), bezug('2026-05-12'), '2026-05-18')).toMatchObject({ restTage: -3 })
  })

  it('rechnet über einen Monatswechsel und über ein Schaltjahr hinweg', () => {
    expect(fristlage(herkunft({ fristTage: 42 }), bezug('2024-02-20'), '2024-02-20')).toMatchObject({
      ende: '2024-04-02',
    })
  })

  it('verschiebt ein Fristende, das auf einen Sonntag fällt, auf den Montag (§8, D)', () => {
    // 12.5.2026 + 5 Tage wäre der 17.5.2026 — ein Sonntag.
    expect(fristlage(herkunft({ fristTage: 5 }), bezug('2026-05-12'), '2026-05-12')).toEqual({
      art: 'datum',
      ende: '2026-05-18',
      restTage: 6,
    })
  })

  it('verschiebt ein Fristende, das auf einen bundeseinheitlichen Feiertag fällt (§8, D)', () => {
    // 12.5.2026 + 2 Tage wäre der 14.5.2026 — Christi Himmelfahrt.
    expect(fristlage(herkunft({ fristTage: 2 }), bezug('2026-05-12'), '2026-05-12')).toEqual({
      art: 'datum',
      ende: '2026-05-15',
      restTage: 3,
    })
  })

  it('erfindet keine Frist, wo das Gesetz keine nennt', () => {
    const ohne = herkunft({ fristTage: null, fristAb: null })

    expect(fristlage(ohne, bezug('2026-05-12'), '2026-05-12')).toEqual({ art: 'keine' })
  })

  it('erfindet auch dann keine, wenn nur eines der beiden Felder fehlt', () => {
    expect(fristlage(herkunft({ fristTage: null }), bezug('2026-05-12'), '2026-05-12')).toEqual({
      art: 'keine',
    })
    expect(fristlage(herkunft({ fristAb: null }), bezug('2026-05-12'), '2026-05-12')).toEqual({
      art: 'keine',
    })
  })

  it('gibt einer selbst angelegten Aufgabe keine Frist', () => {
    expect(fristlage(null, bezug('2026-05-12'), '2026-05-12')).toEqual({ art: 'keine' })
  })

  it('rechnet eine Frist ab Kenntnis ohne Kenntnisdatum nicht aus, sondern benennt sie', () => {
    /*
     * §8: Aufgaben mit `frist_ab = kenntnis` bleiben ohne `kenntnisAm`
     * fristenlos und tragen den sichtbaren Hinweis. Die App rechnet nicht mit
     * einer Vermutung: Eine falsch berechnete Ausschlagungsfrist kostet den
     * ganzen Nachlass.
     */
    const ausschlagung = herkunft({ fristTage: 42, fristAb: 'kenntnis' })

    expect(fristlage(ausschlagung, bezug('2026-05-12'), '2026-05-12')).toEqual({
      art: 'ab-kenntnis',
    })
  })

  it('leitet ein Kenntnisdatum nicht aus dem Sterbedatum ab (#12)', () => {
    // Der Sohn war am Sterbetag dabei, der Bruder erfährt es drei Wochen
    // später vom Notar. Wer nichts eingetragen hat, bekommt kein Datum
    // untergeschoben, auch kein naheliegendes.
    const ausschlagung = herkunft({ fristTage: 42, fristAb: 'kenntnis' })

    expect(fristlage(ausschlagung, bezug('2026-05-12'), '2026-06-30')).toEqual({
      art: 'ab-kenntnis',
    })
  })

  it('rechnet ab dem eigenen Kenntnisdatum, sobald es eingetragen ist (§ 1944 BGB, #12)', () => {
    const ausschlagung = herkunft({ fristTage: 42, fristAb: 'kenntnis' })

    expect(fristlage(ausschlagung, bezug('2026-05-12', '2026-05-12'), '2026-05-12')).toEqual({
      art: 'datum',
      ende: '2026-06-23',
      restTage: 42,
    })
  })

  it('zeigt zwei Mitgliedern auf derselben Aufgabe verschiedene Fristenden (§8, #12)', () => {
    /*
     * Die eine Zusage, um die es in #12 geht: Dieselbe geteilte Aufgabe,
     * dieselbe Zeile, zwei Enden. Der Sohn war am Sterbetag dabei, der Bruder
     * erfuhr drei Wochen später davon.
     */
    const ausschlagung = herkunft({ fristTage: 42, fristAb: 'kenntnis' })

    const sohn = fristlage(ausschlagung, bezug('2026-05-12', '2026-05-12'), '2026-05-12')
    const bruder = fristlage(ausschlagung, bezug('2026-05-12', '2026-06-02'), '2026-05-12')

    expect(sohn).toMatchObject({ ende: '2026-06-23' })
    expect(bruder).toMatchObject({ ende: '2026-07-14' })
  })

  it('lässt das Kenntnisdatum bei einer Frist ab Sterbedatum unbeachtet', () => {
    expect(fristlage(herkunft(), bezug('2026-05-12', '2026-06-02'), '2026-05-12')).toMatchObject({
      ende: '2026-05-15',
    })
  })

  it('rechnet aus einem unbrauchbaren Kenntnisdatum nichts aus', () => {
    const ausschlagung = herkunft({ fristTage: 42, fristAb: 'kenntnis' })

    expect(fristlage(ausschlagung, bezug('2026-05-12', '2026-02-31'), '2026-05-12')).toEqual({
      art: 'ab-kenntnis',
    })
  })

  it('rechnet ohne Sterbedatum nichts aus', () => {
    expect(fristlage(herkunft(), bezug(null), '2026-05-12')).toEqual({ art: 'keine' })
  })

  it('rechnet aus einem unbrauchbaren Sterbedatum nichts aus', () => {
    expect(fristlage(herkunft(), bezug('irgendwann'), '2026-05-12')).toEqual({ art: 'keine' })
  })

  describe('Anfechtungsfrist ab eigener Anfechtungskenntnis (D)', () => {
    // Ein eigener Anker, `anfechtungskenntnis`, und ausdrücklich nicht
    // `kenntnis`: Beides ist die Kenntnis von etwas anderem und trägt ein
    // eigenes Fristende (ERBE_DESIGN.md §7).
    const anfechtung = herkunft({ fristTage: 365, fristAb: 'anfechtungskenntnis' })

    it('bleibt ohne eigenes Anfechtungsdatum "ab Kenntnis", auch mit einem Ausschlagungsdatum', () => {
      expect(
        fristlage(anfechtung, { sterbedatum: null, kenntnisAm: '2026-05-12', anfechtungKenntnisAm: null }, '2026-05-12'),
      ).toEqual({ art: 'ab-kenntnis' })
    })

    it('rechnet ab dem eigenen Anfechtungsdatum, sobald es eingetragen ist', () => {
      // Ein Jahr (365 Tage) ab dem 5. Januar 2026 ist der 5. Januar 2027 — ein
      // Dienstag, also ohne Verschiebung.
      expect(
        fristlage(
          anfechtung,
          { sterbedatum: null, kenntnisAm: null, anfechtungKenntnisAm: '2026-01-05' },
          '2026-01-05',
        ),
      ).toEqual({ art: 'datum', ende: '2027-01-05', restTage: 365 })
    })

    it('verwechselt das Ausschlagungs-Kenntnisdatum nicht mit dem Anfechtungsdatum', () => {
      // Wären beide auf demselben Feld, ergäbe ein eingetragenes
      // Ausschlagungsdatum ein Anfechtungsende, das niemand eingegeben hat.
      const nurAusschlagung = fristlage(
        anfechtung,
        { sterbedatum: null, kenntnisAm: '2026-05-12', anfechtungKenntnisAm: null },
        '2026-05-12',
      )
      const nurAnfechtung = fristlage(
        herkunft({ fristTage: 42, fristAb: 'kenntnis' }),
        { sterbedatum: null, kenntnisAm: null, anfechtungKenntnisAm: '2026-05-12' },
        '2026-05-12',
      )

      expect(nurAusschlagung).toEqual({ art: 'ab-kenntnis' })
      expect(nurAnfechtung).toEqual({ art: 'ab-kenntnis' })
    })
  })
})

describe('naechsterWerktag (§8, D)', () => {
  it('lässt einen gewöhnlichen Werktag unverändert', () => {
    // Dienstag, weder Sonntag noch Feiertag.
    expect(naechsterWerktag('2026-05-12')).toBe('2026-05-12')
  })

  it('verschiebt einen Sonntag auf den Montag', () => {
    expect(naechsterWerktag('2026-05-17')).toBe('2026-05-18')
  })

  it('verschiebt einen festen Feiertag, auch über einen zweiten Feiertag und einen Sonntag hinweg', () => {
    /*
     * 2026: Der erste Weihnachtsfeiertag (Fr, 25.12.) trifft auf den zweiten
     * (Sa, 26.12.) und den darauffolgenden Sonntag (27.12.) — erst der Montag
     * (28.12.) ist frei von beidem.
     */
    expect(naechsterWerktag('2026-12-25')).toBe('2026-12-28')
  })

  it('verschiebt einen beweglichen Feiertag (Ostermontag, über die Gauß-Formel)', () => {
    // Ostersonntag 2026 ist der 5. April, Ostermontag also der 6. April.
    expect(naechsterWerktag('2026-04-06')).toBe('2026-04-07')
  })

  it('verschiebt einen Feiertag, der auf einen Samstag fällt, trotzdem (Tag der Deutschen Einheit 2026)', () => {
    // 3.10.2026 ist ein Samstag und ein Feiertag; 4.10. ist ein Sonntag;
    // erst der 5.10. (Montag) ist frei von beidem.
    expect(naechsterWerktag('2026-10-03')).toBe('2026-10-05')
  })

  it('lässt einen Samstag ohne Feiertag unverändert (keine erfundene Samstagsregel)', () => {
    // 16.5.2026 ist ein Samstag, aber kein Feiertag: Verlangt ist nur die
    // Verschiebung ab Sonntag oder Feiertag.
    expect(naechsterWerktag('2026-05-16')).toBe('2026-05-16')
  })

  it('lässt einen Text, der kein Kalendertag ist, unverändert', () => {
    expect(naechsterWerktag('irgendwann')).toBe('irgendwann')
  })
})

/**
 * Was passiert, wenn eine Herkunft ihre Tageszahl gar nicht mitbringt (§8).
 *
 * Der Fall ist kein Hirngespinst: Eine Herkunft aus einer älteren Fassung oder
 * aus einem Test trägt `undefined` statt `null`, und `undefined * TAG_MS` ist
 * `NaN`. Ohne Schutz lief die Verschiebung darauf endlos — eine Menge aus
 * lauter `NaN` enthält `NaN`, und `NaN + einem Tag` bleibt `NaN`. Der
 * Bildschirm fror ein, statt dass irgendwo eine Frist fehlte.
 */
describe('Frist ohne brauchbare Tageszahl (§8)', () => {
  it('hält eine Herkunft ohne `fristTage` für fristenlos, statt sich aufzuhängen', () => {
    const ohneZahl = { aufgabeId: 'irgendeine', fristAb: 'sterbedatum' } as unknown as Katalogherkunft

    expect(
      fristlage(ohneZahl, { sterbedatum: '2026-05-12', kenntnisAm: null, anfechtungKenntnisAm: null }, '2026-05-20'),
    ).toEqual({ art: 'keine' })
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
