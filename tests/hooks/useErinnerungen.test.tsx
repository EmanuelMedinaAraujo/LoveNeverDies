import { renderHook, act } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useErinnerungen } from '../../src/hooks/useErinnerungen.ts'
import type { Aufgabe, Katalogherkunft } from '../../src/services/aufgabenService.ts'
import { baueBaum } from '../../src/services/aufgabenbaum.ts'
import { NIEMAND } from '../../src/services/zuweisung.ts'

/**
 * Erinnerungen als Timer (DESIGN.md §7).
 *
 * Geprüft wird, was der reine Plan nicht prüfen kann: dass überhaupt jemand
 * benachrichtigt wird, dass ohne Erlaubnis nichts läuft, und dass ein neuer
 * Baum die alten Timer ablöst, statt sich zu ihnen zu stellen. Der letzte Punkt
 * ist die Zusage "nach jeder Synchronisation neu geplant": Ohne das Aufräumen
 * hätte ein Gerät nach einer Stunde Türklingel hundert Timer zur selben Frist.
 */

const STERBEDATUM = '2026-05-12'

/** Woran die Fristen hängen: das Sterbedatum, kein eigenes Kenntnisdatum (§8). */
const BEZUG = { sterbedatum: STERBEDATUM, kenntnisAm: null }

/** Der 12. Mai 2026, morgens um sechs: lokale Zeit, wie ein Gerät sie sieht. */
const JETZT = new Date(2026, 4, 12, 6)

function aufgabe(ueberschreibung: Partial<Aufgabe> = {}): Aufgabe {
  const katalog: Katalogherkunft = {
    aufgabeId: 'sterbefall-anzeigen',
    version: '2026-08+testtest',
    fristTage: 3,
    fristAb: 'sterbedatum',
    rechtsgrundlage: '§ 28 PStG',
    zustaendigeStelle: '',
    benoetigteDokumente: [],
    unteraufgaben: [],
    haengtAbVon: [],
    hinweis: '',
    quelleUrl: '',
    kategorie: '',
    reihenfolge: 10,
  }

  return {
    id: 'item-1',
    titel: 'Sterbefall anzeigen',
    beschreibung: '',
    erledigt: false,
    notizen: '',
    parentId: null,
    dependsOn: [],
    assignee: NIEMAND,
    katalog,
    dek: new Uint8Array([9]),
    kid: 'case_fall-1:1',
    privat: false,
    ...ueberschreibung,
  }
}

const gezeigt: string[] = []

/**
 * Ein `Notification`, das nur mitschreibt.
 *
 * Als Klasse und nicht als `vi.fn`: Der Hook ruft `new Notification(...)`, und
 * eine Pfeilfunktion lässt sich nicht mit `new` aufrufen.
 */
function benachrichtigung(erlaubnis: NotificationPermission) {
  class Attrappe {
    static permission: NotificationPermission = erlaubnis

    static requestPermission = vi.fn(async () => {
      Attrappe.permission = 'granted'
      return 'granted' as NotificationPermission
    })

    constructor(text: string) {
      gezeigt.push(text)
    }
  }

  return Attrappe
}

beforeEach(() => {
  gezeigt.length = 0
  vi.useFakeTimers()
  vi.setSystemTime(JETZT)
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('useErinnerungen (§7)', () => {
  it('benachrichtigt, wenn ein Termin fällig wird', () => {
    vi.stubGlobal('Notification', benachrichtigung('granted'))

    const baum = baueBaum([aufgabe()])
    renderHook(() => useErinnerungen(baum, BEZUG))

    // Fristende ist der 15. Mai; erinnert wird zuletzt an diesem Morgen.
    act(() => {
      vi.advanceTimersByTime(4 * 86_400_000)
    })

    expect(gezeigt).toContain('„Sterbefall anzeigen" ist heute fällig.')
  })

  it('plant nichts, solange niemand gefragt wurde', () => {
    vi.stubGlobal('Notification', benachrichtigung('default'))

    const { result } = renderHook(() => useErinnerungen(baueBaum([aufgabe()]), BEZUG))

    act(() => {
      vi.advanceTimersByTime(4 * 86_400_000)
    })

    expect(result.current.erlaubnis).toBe('ungefragt')
    expect(gezeigt).toEqual([])
  })

  it('zählt die Termine auch ohne Erlaubnis, damit die Oberfläche etwas anzubieten hat', () => {
    vi.stubGlobal('Notification', benachrichtigung('default'))

    const { result } = renderHook(() => useErinnerungen(baueBaum([aufgabe()]), BEZUG))

    expect(result.current.geplant).toBeGreaterThan(0)
  })

  it('kommt ohne Benachrichtigungen im Browser zurecht', () => {
    vi.stubGlobal('Notification', undefined)

    const { result } = renderHook(() => useErinnerungen(baueBaum([aufgabe()]), BEZUG))

    expect(result.current.erlaubnis).toBe('nicht-verfuegbar')

    act(() => {
      vi.advanceTimersByTime(4 * 86_400_000)
    })

    expect(gezeigt).toEqual([])
  })

  it('fragt einmal nach und merkt sich die Antwort', async () => {
    const Attrappe = benachrichtigung('default')
    vi.stubGlobal('Notification', Attrappe)

    const { result } = renderHook(() => useErinnerungen(baueBaum([aufgabe()]), BEZUG))

    await act(async () => {
      await result.current.frage()
    })

    expect(Attrappe.requestPermission).toHaveBeenCalledTimes(1)
    expect(result.current.erlaubnis).toBe('erteilt')
  })

  it('plant nach jedem neuen Baum neu, statt die alten Timer stehenzulassen', () => {
    /*
     * §7: "nach jeder Synchronisation neu geplant". Der Baum wechselt mit jedem
     * Delta seine Identität; würden die alten Timer nicht abgeräumt, käme
     * dieselbe Erinnerung nach zehn Türklingeln zehnmal.
     */
    vi.stubGlobal('Notification', benachrichtigung('granted'))

    const { rerender } = renderHook(
      ({ baum }: { baum: ReturnType<typeof baueBaum> }) => useErinnerungen(baum, BEZUG),
      { initialProps: { baum: baueBaum([aufgabe()]) } },
    )

    rerender({ baum: baueBaum([aufgabe()]) })
    rerender({ baum: baueBaum([aufgabe()]) })

    act(() => {
      vi.advanceTimersByTime(4 * 86_400_000)
    })

    expect(gezeigt.filter((text) => text === '„Sterbefall anzeigen" ist heute fällig.')).toHaveLength(1)
  })

  it('erinnert nicht mehr, sobald die Aufgabe erledigt ist', () => {
    vi.stubGlobal('Notification', benachrichtigung('granted'))

    const { rerender } = renderHook(
      ({ baum }: { baum: ReturnType<typeof baueBaum> }) => useErinnerungen(baum, BEZUG),
      { initialProps: { baum: baueBaum([aufgabe()]) } },
    )

    rerender({ baum: baueBaum([aufgabe({ erledigt: true })]) })

    act(() => {
      vi.advanceTimersByTime(4 * 86_400_000)
    })

    expect(gezeigt).toEqual([])
  })
})
