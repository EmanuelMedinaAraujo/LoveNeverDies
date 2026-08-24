import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Geraeteidentitaet } from '../../src/core/crypto/keystore.ts'
import type { Fall } from '../../src/services/fallService.ts'
import type { Kopplungsanfrage } from '../../src/services/kopplungService.ts'

/**
 * Die drei Kopplungs-Hooks (DESIGN.md §6, §3.6).
 *
 * Dienste und Adapter sind ersetzt — was gewrappt und was geprüft wird, steht
 * in `tests/services/kopplungService.test.ts` und in `tests/db/kopplung.test.ts`.
 * Hier geht es um die Zustandsführung: wann ein Code geholt wird, dass der
 * Prüfcode aus der **lokalen** Identität kommt, und dass die Wache aufhört zu
 * pollen, sobald sie ihre Antwort hat.
 */

const erzeugeKopplungscode = vi.fn()
const loeseKopplungscodeEin = vi.fn()
const fuegeZumFallHinzu = vi.fn()
const schalteGeraetFrei = vi.fn()
const ladeFaelle = vi.fn()
const useGeraeteanmeldung = vi.fn()
const useCase = vi.fn()
const useProfilAbgleich = vi.fn()
const profilNochmal = vi.fn()

vi.mock('../../src/services/kopplungService.ts', async () => {
  const echt = await vi.importActual<typeof import('../../src/services/kopplungService.ts')>(
    '../../src/services/kopplungService.ts',
  )

  return {
    ...echt,
    erzeugeKopplungscode: (...a: unknown[]) => erzeugeKopplungscode(...a),
    loeseKopplungscodeEin: (...a: unknown[]) => loeseKopplungscodeEin(...a),
    fuegeZumFallHinzu: (...a: unknown[]) => fuegeZumFallHinzu(...a),
    schalteGeraetFrei: (...a: unknown[]) => schalteGeraetFrei(...a),
  }
})
vi.mock('../../src/services/fallService.ts', () => ({
  ladeFaelle: (...a: unknown[]) => ladeFaelle(...a),
}))
vi.mock('../../src/hooks/useGeraete.ts', () => ({
  useGeraeteanmeldung: () => useGeraeteanmeldung(),
}))
vi.mock('../../src/hooks/useCase.ts', () => ({ useCase: () => useCase() }))
vi.mock('../../src/hooks/useProfil.ts', () => ({
  useProfilAbgleich: () => useProfilAbgleich(),
}))
vi.mock('../../src/core/db/supabaseKopplung.ts', () => ({ supabaseKopplung: () => ({}) }))
vi.mock('../../src/core/db/supabaseFaelle.ts', () => ({ supabaseFaelle: () => ({}) }))
vi.mock('../../src/core/db/supabaseFallschluessel.ts', () => ({
  supabaseFallschluessel: () => ({}),
}))
vi.mock('../../src/core/db/supabaseGeraeteschluessel.ts', () => ({
  supabaseGeraeteschluessel: () => ({}),
}))
// Siehe useGeraete.test.tsx: Der Zugang muss stabil bleiben, sonst dreht sich
// der Effekt endlos.
vi.mock('../../src/core/db/supabaseProvider.tsx', () => {
  const zugang = () => ({})
  return { useSupabase: () => zugang }
})

const { useEinloesung, useKopplungscode, useKopplungswache, WACHE_ABSTAND_MS } = await import(
  '../../src/hooks/useKopplung.ts'
)

const IDENTITAET = { pkKem: new Uint8Array([1]), pruefcode: '481253' } as Geraeteidentitaet

const ANMELDUNG_BEREIT = {
  status: 'bereit',
  identitaet: IDENTITAET,
  benutzer: { id: 'user_1', anzeigename: 'Anna', email: null },
  geraet: {
    id: 'geraet-1',
    label: 'iPhone',
    // Bewusst ein anderer als der lokale: Der Prüfcode zum Vorlesen darf nicht
    // aus der Serverzeile kommen (§3.6).
    pruefcode: '999999',
    angelegtAm: '',
    diesesGeraet: true,
  },
}

function fall(id: string, zustand: 'lesbar' | 'gesperrt' = 'lesbar'): Fall {
  return zustand === 'lesbar'
    ? {
        zustand: 'lesbar',
        id,
        status: 'trauerfall',
        personName: 'Hans Weber',
        sterbedatum: '2026-05-12',
        kid: `case_${id}:1`,
        kc: new Uint8Array([1]),
        kcat: new Uint8Array([2]),
      }
    : { zustand: 'gesperrt', id, grund: 'Kein Schlüssel.' }
}

const ANFRAGE: Kopplungsanfrage = {
  code: 'K4M7QP2X',
  pruefcode: '481253',
  angebot: {
    zweck: 'join',
    userId: 'user_anna',
    anzeigename: 'Anna Müller',
    email: 'anna@example.de',
    geraeteId: 'geraet-2',
    pkKem: new Uint8Array([1]),
    pkSig: new Uint8Array([2]),
  },
}

beforeEach(() => {
  vi.clearAllMocks()
  useGeraeteanmeldung.mockReturnValue(ANMELDUNG_BEREIT)
  useCase.mockReturnValue({ zustand: { status: 'kein-fall' }, legeTrauerfallAn: vi.fn() })
  useProfilAbgleich.mockReturnValue({ zustand: { status: 'bereit' }, nochmal: profilNochmal })
  erzeugeKopplungscode.mockResolvedValue({ code: 'K4M7QP2X', laeuftAbAm: '2026-08-24T10:15:00Z' })
  loeseKopplungscodeEin.mockResolvedValue(ANFRAGE)
  fuegeZumFallHinzu.mockResolvedValue(undefined)
  schalteGeraetFrei.mockResolvedValue({ freigeschaltet: 2, gesamt: 3 })
  ladeFaelle.mockResolvedValue([])
})

describe('useKopplungscode (§6)', () => {
  it('holt keinen Code, solange das Gerät nicht angemeldet ist', () => {
    useGeraeteanmeldung.mockReturnValue({ status: 'laedt' })

    const { result } = renderHook(() => useKopplungscode('join'))

    expect(result.current.zustand.status).toBe('laedt')
    expect(erzeugeKopplungscode).not.toHaveBeenCalled()
  })

  it('zeigt den Code und den Prüfcode dieses Geräts', async () => {
    const { result } = renderHook(() => useKopplungscode('device'))

    await waitFor(() => expect(result.current.zustand.status).toBe('bereit'))

    expect(result.current.zustand).toEqual({
      status: 'bereit',
      code: 'K4M7QP2X',
      laeuftAbAm: '2026-08-24T10:15:00Z',
      // Aus der lokalen Identität, nicht aus der Serverzeile: Sonst verglichen
      // beide Seiten dieselbe Serverangabe miteinander (§3.6).
      pruefcode: '481253',
    })
    expect(erzeugeKopplungscode).toHaveBeenCalledWith(expect.anything(), 'geraet-1', 'device')
  })

  it('holt auf Wunsch einen frischen Code und zeigt den alten nicht weiter', async () => {
    const { result } = renderHook(() => useKopplungscode('join'))
    await waitFor(() => expect(result.current.zustand.status).toBe('bereit'))

    erzeugeKopplungscode.mockResolvedValue({ code: 'ZZZZ2222', laeuftAbAm: '2026-08-24T10:30:00Z' })

    act(() => result.current.neuAnfordern())

    await waitFor(() =>
      expect(result.current.zustand).toMatchObject({ status: 'bereit', code: 'ZZZZ2222' }),
    )
    expect(erzeugeKopplungscode).toHaveBeenCalledTimes(2)
  })

  it('reicht einen Fehler aus der Anmeldung durch', () => {
    useGeraeteanmeldung.mockReturnValue({ status: 'fehler', nachricht: 'Kein Netz.' })

    const { result } = renderHook(() => useKopplungscode('join'))

    expect(result.current.zustand).toEqual({ status: 'fehler', nachricht: 'Kein Netz.' })
  })

  it('wartet auf das Profil, bevor es einen Code holt', () => {
    // `erzeuge_kopplungscode` weist einen Aufruf ohne Zeile in `profiles` ab
    // (§6). Ohne diese Reihenfolge liefe der erste Versuch in einen Fehler,
    // den niemand einordnen kann.
    useProfilAbgleich.mockReturnValue({ zustand: { status: 'laedt' }, nochmal: profilNochmal })

    const { result } = renderHook(() => useKopplungscode('join'))

    expect(result.current.zustand.status).toBe('laedt')
    expect(erzeugeKopplungscode).not.toHaveBeenCalled()
  })

  it('sagt es, wenn der Name nicht zu hinterlegen war', () => {
    useProfilAbgleich.mockReturnValue({
      zustand: { status: 'fehler', nachricht: 'permission denied' },
      nochmal: profilNochmal,
    })

    const { result } = renderHook(() => useKopplungscode('join'))

    expect(result.current.zustand).toMatchObject({
      status: 'fehler',
      nachricht: expect.stringContaining('ohne ihn gibt es keinen Kopplungscode'),
    })
    expect(erzeugeKopplungscode).not.toHaveBeenCalled()
  })

  it('versucht mit dem neuen Code auch das Profil noch einmal', async () => {
    const { result } = renderHook(() => useKopplungscode('join'))
    await waitFor(() => expect(result.current.zustand.status).toBe('bereit'))

    act(() => result.current.neuAnfordern())

    expect(profilNochmal).toHaveBeenCalled()
  })

  it('macht aus einem gescheiterten Aufruf einen Satz', async () => {
    erzeugeKopplungscode.mockRejectedValue(new Error('Ohne hinterlegten Namen.'))

    const { result } = renderHook(() => useKopplungscode('join'))

    await waitFor(() =>
      expect(result.current.zustand).toEqual({
        status: 'fehler',
        nachricht: 'Ohne hinterlegten Namen.',
      }),
    )
  })
})

describe('useKopplungswache (§6, Schritt 7)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  /**
   * Den ersten Durchlauf abwarten, ohne `waitFor`.
   *
   * `waitFor` pollt gegen eine Uhr, die hier stillsteht; das ist unter Last die
   * Sorte Test, die einmal im Monat grundlos rot wird. Ein Takt von null
   * Millisekunden treibt stattdessen genau die Mikrotasks vor, auf die es
   * ankommt.
   */
  async function erstesNachsehen() {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
  }

  it('sieht nicht nach, solange sie nicht aktiv ist', () => {
    renderHook(() => useKopplungswache(false))

    expect(ladeFaelle).not.toHaveBeenCalled()
  })

  it('wartet, solange nicht mehr Fälle lesbar sind als am Anfang', async () => {
    ladeFaelle.mockResolvedValue([fall('fall-1', 'gesperrt')])

    const { result } = renderHook(() => useKopplungswache(true))

    await erstesNachsehen()
    expect(result.current.status).toBe('wartet')

    await act(async () => {
      await vi.advanceTimersByTimeAsync(WACHE_ABSTAND_MS)
    })

    expect(result.current.status).toBe('wartet')
    expect(ladeFaelle).toHaveBeenCalledTimes(2)
  })

  it('meldet frei, sobald ein Fall dazukommt, und hört dann auf zu pollen', async () => {
    ladeFaelle.mockResolvedValue([])

    const { result } = renderHook(() => useKopplungswache(true))
    await erstesNachsehen()
    expect(result.current.status).toBe('wartet')

    ladeFaelle.mockResolvedValue([fall('fall-1')])

    await act(async () => {
      await vi.advanceTimersByTimeAsync(WACHE_ABSTAND_MS)
    })

    expect(result.current).toEqual({ status: 'freigeschaltet', lesbar: 1 })

    const bisher = ladeFaelle.mock.calls.length
    await act(async () => {
      await vi.advanceTimersByTimeAsync(WACHE_ABSTAND_MS * 3)
    })
    expect(ladeFaelle).toHaveBeenCalledTimes(bisher)
  })

  it('lässt einen langsamen Abruf die Freigabe nicht überschreiben', async () => {
    /*
     * Ein Abruf, der nach einem schnelleren zurückkommt, dürfte „wartet" nicht
     * über ein bereits gemeldetes „freigeschaltet" schreiben: Der Takt ist dann
     * abgeräumt, es sähe nie wieder jemand nach, und der Screen bliebe auf
     * „Warten auf die Bestätigung…" stehen, obwohl längst alles da ist.
     */
    let langsamAufloesen: ((faelle: unknown[]) => void) | null = null

    ladeFaelle.mockImplementationOnce(() => Promise.resolve([]))
    ladeFaelle.mockImplementationOnce(
      () => new Promise((erfuellen) => (langsamAufloesen = erfuellen)),
    )
    ladeFaelle.mockImplementation(() => Promise.resolve([fall('fall-1')]))

    const { result } = renderHook(() => useKopplungswache(true))
    await erstesNachsehen()

    // Der langsame Abruf startet …
    await act(async () => {
      await vi.advanceTimersByTimeAsync(WACHE_ABSTAND_MS)
    })
    // … der nächste überholt ihn und gibt frei …
    await act(async () => {
      await vi.advanceTimersByTimeAsync(WACHE_ABSTAND_MS)
    })

    expect(result.current.status).toBe('freigeschaltet')

    // … und erst danach kommt der langsame mit seinem alten Bild zurück.
    await act(async () => {
      langsamAufloesen?.([])
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(result.current.status).toBe('freigeschaltet')
  })

  it('meldet nicht frei, wenn schon am Anfang etwas lesbar war', async () => {
    // Ein zweites Gerät kann zwei von drei Fällen längst lesen und auf den
    // dritten warten. „Mindestens einer lesbar" wäre hier sofort erfüllt.
    ladeFaelle.mockResolvedValue([fall('fall-1'), fall('fall-2', 'gesperrt')])

    const { result } = renderHook(() => useKopplungswache(true))

    await erstesNachsehen()
    expect(result.current.status).toBe('wartet')

    await act(async () => {
      await vi.advanceTimersByTimeAsync(WACHE_ABSTAND_MS)
    })

    expect(result.current.status).toBe('wartet')
  })

  it('macht aus einem gescheiterten Abruf einen Satz', async () => {
    ladeFaelle.mockRejectedValue(new Error('Kein Netz.'))

    const { result } = renderHook(() => useKopplungswache(true))

    await erstesNachsehen()

    expect(result.current).toEqual({ status: 'fehler', nachricht: 'Kein Netz.' })
  })
})

describe('useEinloesung (§6, Schritt 4 bis 6)', () => {
  it('beginnt leer und hält nach dem Einlösen das Angebot', async () => {
    const { result } = renderHook(() => useEinloesung())

    expect(result.current.zustand).toEqual({ status: 'leer', fehler: null })

    await act(() => result.current.einloesen('k4m7-qp2x'))

    expect(result.current.zustand).toEqual({ status: 'angebot', anfrage: ANFRAGE, fehler: null })
    expect(loeseKopplungscodeEin).toHaveBeenCalledWith(expect.anything(), 'k4m7-qp2x')
  })

  it('bestätigt nichts, solange kein Angebot vorliegt', async () => {
    const { result } = renderHook(() => useEinloesung())

    await act(() => result.current.bestaetigen())

    expect(fuegeZumFallHinzu).not.toHaveBeenCalled()
    expect(result.current.zustand).toEqual({ status: 'leer', fehler: null })
  })

  it('bestätigt nichts, solange die Fallliste noch lädt', async () => {
    /*
     * Der Code ist zu diesem Zeitpunkt eingelöst und verbrannte an einer Liste,
     * die es noch gar nicht gibt — bei `device` mit der Meldung „0 von 0 Fällen
     * freigeschaltet", die wie ein Erfolg aussieht.
     */
    useCase.mockReturnValue({ zustand: { status: 'laedt' }, legeTrauerfallAn: vi.fn() })

    const { result } = renderHook(() => useEinloesung())
    await act(() => result.current.einloesen('K4M7QP2X'))

    expect(result.current.faelleBereit).toBe(false)

    await act(() => result.current.bestaetigen())

    expect(fuegeZumFallHinzu).not.toHaveBeenCalled()
    expect(result.current.zustand).toMatchObject({
      status: 'angebot',
      fehler: expect.stringContaining('noch nicht geladen'),
    })
  })

  it('hält das Angebot fest, wenn das Bestätigen scheitert', async () => {
    /*
     * Zurück ins Eingabefeld wäre eine Sackgasse: Der Code ist eingelöst und
     * käme nur noch als „bereits eingelöst" zurück, obwohl
     * `schliesse_kopplung_ab` ihn weiterhin annähme.
     */
    useCase.mockReturnValue({
      zustand: { status: 'bereit', faelle: [fall('fall-1')], aktiver: fall('fall-1') },
      legeTrauerfallAn: vi.fn(),
    })
    fuegeZumFallHinzu.mockRejectedValue(new Error('Kein Netz.'))

    const { result } = renderHook(() => useEinloesung())
    await act(() => result.current.einloesen('K4M7QP2X'))
    await act(() => result.current.bestaetigen('fall-1'))

    expect(result.current.zustand).toEqual({
      status: 'angebot',
      anfrage: ANFRAGE,
      fehler: 'Kein Netz.',
    })
  })

  it('fügt die Person dem gewählten Fall hinzu', async () => {
    useCase.mockReturnValue({
      zustand: { status: 'bereit', faelle: [fall('fall-1'), fall('fall-2')], aktiver: fall('fall-1') },
      legeTrauerfallAn: vi.fn(),
    })

    const { result } = renderHook(() => useEinloesung())
    await act(() => result.current.einloesen('K4M7QP2X'))
    await act(() => result.current.bestaetigen('fall-2'))

    expect(fuegeZumFallHinzu).toHaveBeenCalledWith(
      expect.anything(),
      ANFRAGE,
      expect.objectContaining({ id: 'fall-2' }),
      IDENTITAET,
      'geraet-1',
    )
    expect(result.current.zustand).toMatchObject({ status: 'fertig' })
  })

  it('sagt es, wenn der gewählte Fall von hier aus nicht weiterzugeben ist', async () => {
    useCase.mockReturnValue({
      zustand: { status: 'bereit', faelle: [fall('fall-1', 'gesperrt')], aktiver: fall('fall-1', 'gesperrt') },
      legeTrauerfallAn: vi.fn(),
    })

    const { result } = renderHook(() => useEinloesung())
    await act(() => result.current.einloesen('K4M7QP2X'))
    await act(() => result.current.bestaetigen('fall-1'))

    expect(result.current.zustand).toMatchObject({
      status: 'angebot',
      fehler: expect.stringContaining('nur teilen, was Sie selbst lesen können'),
    })
    expect(fuegeZumFallHinzu).not.toHaveBeenCalled()
  })

  it('schaltet bei einem device-Code alle lesbaren Fälle frei und benennt die Zahl', async () => {
    loeseKopplungscodeEin.mockResolvedValue({
      ...ANFRAGE,
      angebot: { ...ANFRAGE.angebot, zweck: 'device' },
    })
    useCase.mockReturnValue({
      zustand: { status: 'bereit', faelle: [fall('fall-1'), fall('fall-2')], aktiver: fall('fall-1') },
      legeTrauerfallAn: vi.fn(),
    })

    const { result } = renderHook(() => useEinloesung())
    await act(() => result.current.einloesen('K4M7QP2X'))
    await act(() => result.current.bestaetigen())

    expect(schalteGeraetFrei).toHaveBeenCalled()
    expect(result.current.zustand).toEqual({
      status: 'fertig',
      nachricht: '2 von 3 Fällen freigeschaltet',
    })
  })

  it('macht aus einem abgewiesenen Code einen Satz', async () => {
    loeseKopplungscodeEin.mockRejectedValue(new Error('Diesen Kopplungscode gibt es nicht.'))

    const { result } = renderHook(() => useEinloesung())
    await act(() => result.current.einloesen('ZZZZZZZZ'))

    expect(result.current.zustand).toEqual({
      status: 'leer',
      fehler: 'Diesen Kopplungscode gibt es nicht.',
    })
  })

  it('kehrt beim Abbrechen in den leeren Zustand zurück', async () => {
    const { result } = renderHook(() => useEinloesung())
    await act(() => result.current.einloesen('K4M7QP2X'))

    act(() => result.current.abbrechen())

    expect(result.current.zustand).toEqual({ status: 'leer', fehler: null })
  })
})
