import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Geraeteidentitaet } from '../../src/core/crypto/keystore.ts'
import type { Fall } from '../../src/services/fallService.ts'

/**
 * Der Fall, in dem die angemeldete Person gerade steckt (DESIGN.md §2, §3.6).
 *
 * `fallService` ist ersetzt — was er entschlüsselt und wann er einen Fall
 * sperrt, steht in `tests/services/fallService.test.ts`. Hier geht es um die
 * Zustandsführung des Hooks: Er lädt erst, wenn das Gerät angemeldet ist, und
 * er lädt nach dem Anlegen vom Server neu statt lokal anzuhängen.
 */

const ladeFaelle = vi.fn()
const legeTrauerfallAnDienst = vi.fn()
const verlasseFallDienst = vi.fn()
const rotiereFallschluesselDienst = vi.fn()
const useGeraeteanmeldung = vi.fn()

vi.mock('../../src/services/fallService.ts', () => ({
  ladeFaelle: (...a: unknown[]) => ladeFaelle(...a),
  legeTrauerfallAn: (...a: unknown[]) => legeTrauerfallAnDienst(...a),
  legeVorsorgefallAn: vi.fn(),
  loescheVorsorgefall: vi.fn(),
  verlasseFall: (...a: unknown[]) => verlasseFallDienst(...a),
}))
vi.mock('../../src/services/rotationService.ts', () => ({
  rotiereFallschluessel: (...a: unknown[]) => rotiereFallschluesselDienst(...a),
}))
vi.mock('../../src/hooks/useGeraete.ts', () => ({
  useGeraeteanmeldung: () => useGeraeteanmeldung(),
}))
vi.mock('../../src/core/db/supabaseFaelle.ts', () => ({ supabaseFaelle: () => ({}) }))
vi.mock('../../src/core/db/supabaseFallschluessel.ts', () => ({
  supabaseFallschluessel: () => ({}),
}))
vi.mock('../../src/core/db/supabaseGeraeteschluessel.ts', () => ({
  supabaseGeraeteschluessel: () => ({}),
}))
vi.mock('../../src/core/db/supabaseInhalte.ts', () => ({ supabaseInhalte: () => ({}) }))
vi.mock('../../src/core/db/supabaseMitglieder.ts', () => ({ supabaseMitglieder: () => ({}) }))
vi.mock('../../src/core/db/supabaseTresor.ts', () => ({ supabaseTresor: () => ({}) }))
vi.mock('../../src/core/db/idb.ts', () => ({ idbCiphertextcache: () => ({}) }))

// Siehe useGeraete.test.tsx: Der Zugang muss stabil bleiben, sonst dreht sich
// der Effekt endlos.
vi.mock('../../src/core/db/supabaseProvider.tsx', () => {
  const zugang = () => ({})
  return { useSupabase: () => zugang }
})

const { useCase } = await import('../../src/hooks/useCase.ts')

const IDENTITAET = { pkKem: new Uint8Array([1]) } as Geraeteidentitaet

const LESBAR: Fall = {
  zustand: 'lesbar',
  id: 'fall-1',
  status: 'trauerfall',
  personName: 'Hans Weber',
  sterbedatum: '2024-03-15',
  kid: 'case_fall-1:1',
  keyGeneration: 1,
  rotationPending: false,
  kc: new Uint8Array([1]),
  kcat: new Uint8Array([2]),
  kv: null,
  preparerId: null,
  vaultCommitment: null,
  vaultResplitPending: false,
  vaultK: null,
  vaultN: null,
  katalogVersion: '2026-08+testtest',
}

const ANMELDUNG_BEREIT = {
  status: 'bereit',
  identitaet: IDENTITAET,
  benutzer: { id: 'user_1', anzeigename: 'Anna', email: null },
  geraet: { id: 'geraet-1', label: 'iPhone', pruefcode: '481253', angelegtAm: '', diesesGeraet: true },
}

beforeEach(() => {
  vi.clearAllMocks()
  useGeraeteanmeldung.mockReturnValue(ANMELDUNG_BEREIT)
  ladeFaelle.mockResolvedValue([])
  legeTrauerfallAnDienst.mockResolvedValue(LESBAR)
})

describe('useCase', () => {
  it('laedt nichts, solange das Geraet nicht angemeldet ist', () => {
    // Vorher gibt es weder `identitaet` noch die `device_id`, die `key_wraps`
    // braucht.
    useGeraeteanmeldung.mockReturnValue({ status: 'laedt' })

    const { result } = renderHook(() => useCase())

    expect(result.current.zustand.status).toBe('laedt')
    expect(ladeFaelle).not.toHaveBeenCalled()
  })

  it('reicht einen Fehler aus der Anmeldung durch', () => {
    useGeraeteanmeldung.mockReturnValue({ status: 'fehler', nachricht: 'Kein Netz.' })

    const { result } = renderHook(() => useCase())

    expect(result.current.zustand).toEqual({ status: 'fehler', nachricht: 'Kein Netz.' })
  })

  it('meldet "kein-fall", wenn die Liste leer ist', async () => {
    const { result } = renderHook(() => useCase())

    await waitFor(() => expect(result.current.zustand.status).toBe('kein-fall'))
  })

  it('nimmt den ersten Fall als den aktiven', async () => {
    const zweiter: Fall = { zustand: 'gesperrt', id: 'fall-2', grund: 'egal' }
    ladeFaelle.mockResolvedValue([LESBAR, zweiter])

    const { result } = renderHook(() => useCase())

    await waitFor(() => expect(result.current.zustand.status).toBe('bereit'))
    expect(result.current.zustand).toMatchObject({ aktiver: LESBAR, faelle: [LESBAR, zweiter] })
  })

  it('meldet einen Fehler beim Laden', async () => {
    ladeFaelle.mockRejectedValue(new Error('Fälle nicht abrufbar.'))

    const { result } = renderHook(() => useCase())

    await waitFor(() => expect(result.current.zustand.status).toBe('fehler'))
    expect(result.current.zustand).toMatchObject({ nachricht: 'Fälle nicht abrufbar.' })
  })

  it('weigert sich, ohne angemeldetes Geraet einen Fall anzulegen', async () => {
    useGeraeteanmeldung.mockReturnValue({ status: 'laedt' })

    const { result } = renderHook(() => useCase())

    await expect(
      result.current.legeTrauerfallAn({ personName: 'Hans', sterbedatum: '2024-03-15' }),
    ).rejects.toThrow(/Ohne angemeldetes Gerät/)
    expect(legeTrauerfallAnDienst).not.toHaveBeenCalled()
  })

  it('laedt nach dem Anlegen vom Server neu, statt lokal anzuhaengen', async () => {
    /*
     * Was `ladeFaelle` liefert, hat den vollen Weg aus §3.6 durchlaufen —
     * Wrap lesen, Signatur pruefen, entpacken — und genau das soll auch fuer
     * den eigenen, gerade erst angelegten Fall gelten.
     */
    const { result } = renderHook(() => useCase())
    await waitFor(() => expect(ladeFaelle).toHaveBeenCalledTimes(1))

    ladeFaelle.mockResolvedValue([LESBAR])
    await result.current.legeTrauerfallAn({
      personName: 'Hans Weber',
      sterbedatum: '2024-03-15',
    })

    await waitFor(() => expect(ladeFaelle).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(result.current.zustand).toMatchObject({ aktiver: LESBAR }))

    expect(legeTrauerfallAnDienst).toHaveBeenCalledWith(
      // Die Fall- und die Item-Tabelle: Der Katalog wird beim Anlegen
      // instanziiert (§8), und beides geht über denselben Client.
      expect.anything(),
      expect.anything(),
      IDENTITAET,
      'geraet-1',
      { personName: 'Hans Weber', sterbedatum: '2024-03-15' },
    )
  })

  it('ruft verlasseFall auf und lädt danach neu', async () => {
    ladeFaelle.mockResolvedValue([LESBAR])
    const { result } = renderHook(() => useCase())
    await waitFor(() => expect(result.current.zustand.status).toBe('bereit'))

    ladeFaelle.mockResolvedValue([])
    await result.current.verlasseFall('fall-1')

    expect(verlasseFallDienst).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      'fall-1',
    )
    await waitFor(() => expect(result.current.zustand.status).toBe('kein-fall'))
  })

  it('führt bei rotationPending automatisch Schlüsselrotation durch', async () => {
    const rotierenderFall: Fall = {
      ...LESBAR,
      rotationPending: true,
    }
    const fertigRotierterFall: Fall = {
      ...LESBAR,
      keyGeneration: 2,
      rotationPending: false,
    }

    ladeFaelle.mockResolvedValueOnce([rotierenderFall])
    rotiereFallschluesselDienst.mockResolvedValueOnce({
      status: 'erfolg',
      kidNeu: 'case_fall-1:2',
      kcNeu: new Uint8Array(32),
      keyGeneration: 2,
    })
    ladeFaelle.mockResolvedValueOnce([fertigRotierterFall])

    const { result } = renderHook(() => useCase())

    await waitFor(() => expect(rotiereFallschluesselDienst).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(result.current.zustand.status).toBe('bereit'))
    expect(result.current.zustand).toMatchObject({ aktiver: fertigRotierterFall })
  })

  it('zeigt schluessel-erneuerung, wenn Mandat verweigert wurde', async () => {
    const rotierenderFall: Fall = {
      ...LESBAR,
      rotationPending: true,
    }

    ladeFaelle.mockResolvedValue([rotierenderFall])
    rotiereFallschluesselDienst.mockResolvedValue({
      status: 'mandat_verweigert',
    })

    const { result } = renderHook(() => useCase())

    await waitFor(() =>
      expect(result.current.zustand.status).toBe('schluessel-erneuerung'),
    )
  })
})

