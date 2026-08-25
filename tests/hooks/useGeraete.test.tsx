import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  AuthKontextProvider,
  type AuthZustand,
} from '../../src/core/auth/authProvider.ts'
import type { Geraeteidentitaet } from '../../src/core/crypto/keystore.ts'
import type { Geraet } from '../../src/services/geraeteService.ts'
import { authWert, geraet } from '../screens/harness.tsx'

/**
 * Die drei Hooks aus DESIGN.md §3.6, §7.
 *
 * Keystore, Supabase und der Dienst sind ersetzt: Was sie tun, steht in
 * `tests/crypto/keystore.test.ts`, `tests/db/` und
 * `tests/services/geraeteService.test.ts`. Hier geht es um die Zustandsführung:
 * wann `laedt`, wann `fehler`, und was beim Abmelden passiert.
 */

const ladeOderErzeugeIdentitaet = vi.fn()
const registriereGeraetGebuendelt = vi.fn()
const eigeneGeraete = vi.fn()
const benenneGeraetUm = vi.fn()

vi.mock('../../src/core/crypto/keystore.ts', () => ({
  ladeOderErzeugeIdentitaet: () => ladeOderErzeugeIdentitaet(),
}))
vi.mock('../../src/core/db/supabaseGeraeteschluessel.ts', () => ({
  supabaseGeraeteschluessel: () => ({}),
}))
/*
 * Der Zugang muss über Renderrunden hinweg dieselbe Funktion bleiben: Der
 * echte Provider gibt ihn aus einem `useCallback` mit leerer Abhängigkeitsliste
 * heraus. Ein Doppel, das bei jedem Rendern eine neue Funktion liefert, dreht
 * den Effekt in `useGeraete` in eine Endlosschleife: Er hängt an `zugang`.
 */
vi.mock('../../src/core/db/supabaseProvider.tsx', () => {
  const zugang = () => ({})
  return { useSupabase: () => zugang }
})
vi.mock('../../src/services/geraeteService.ts', () => ({
  registriereGeraetGebuendelt: (...a: unknown[]) => registriereGeraetGebuendelt(...a),
  eigeneGeraete: (...a: unknown[]) => eigeneGeraete(...a),
  benenneGeraetUm: (...a: unknown[]) => benenneGeraetUm(...a),
}))

const { useGeraete, useGeraeteanmeldung, useGeraeteidentitaet } = await import(
  '../../src/hooks/useGeraete.ts'
)

const IDENTITAET = { pkKem: new Uint8Array([1]), pkSig: new Uint8Array([2]) } as Geraeteidentitaet

const ANGEMELDET: AuthZustand = {
  status: 'angemeldet',
  benutzer: { id: 'user_1', anzeigename: 'Anna Müller', email: null },
}

function huelle(zustand: AuthZustand) {
  return function Huelle({ children }: { children: ReactNode }) {
    return <AuthKontextProvider value={authWert(zustand)}>{children}</AuthKontextProvider>
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  ladeOderErzeugeIdentitaet.mockResolvedValue(IDENTITAET)
  registriereGeraetGebuendelt.mockResolvedValue(geraet())
  eigeneGeraete.mockResolvedValue([geraet()])
  benenneGeraetUm.mockResolvedValue(undefined)
})

describe('useGeraeteidentitaet', () => {
  it('steht auf "laedt", solange die Sitzung laedt', () => {
    const { result } = renderHook(() => useGeraeteidentitaet(), {
      wrapper: huelle({ status: 'laedt' }),
    })

    expect(result.current.status).toBe('laedt')
  })

  it('erzeugt ohne Anmeldung keine Identitaet', () => {
    const { result } = renderHook(() => useGeraeteidentitaet(), {
      wrapper: huelle({ status: 'abgemeldet' }),
    })

    expect(result.current.status).toBe('abgemeldet')
    expect(ladeOderErzeugeIdentitaet).not.toHaveBeenCalled()
  })

  it('liefert die Identitaet nach der Anmeldung', async () => {
    const { result } = renderHook(() => useGeraeteidentitaet(), { wrapper: huelle(ANGEMELDET) })

    await waitFor(() => expect(result.current.status).toBe('bereit'))
    expect(result.current).toMatchObject({ identitaet: IDENTITAET })
  })

  it('meldet einen kaputten Keystore als Fehler', async () => {
    ladeOderErzeugeIdentitaet.mockRejectedValue(new Error('IndexedDB ist nicht verfügbar.'))

    const { result } = renderHook(() => useGeraeteidentitaet(), { wrapper: huelle(ANGEMELDET) })

    await waitFor(() => expect(result.current.status).toBe('fehler'))
    expect(result.current).toMatchObject({ nachricht: 'IndexedDB ist nicht verfügbar.' })
  })
})

describe('useGeraeteanmeldung', () => {
  it('bleibt "laedt", bis das Geraet in der Tabelle steht', async () => {
    /*
     * Auch wenn die Identitaet laengst da ist: Daran haengt, dass die
     * Geraeteliste nicht in eine halb fertige Registrierung hineinliest.
     */
    let loese: (wert: Geraet) => void = () => {}
    registriereGeraetGebuendelt.mockReturnValue(
      new Promise<Geraet>((erfuellen) => {
        loese = erfuellen
      }),
    )

    const { result } = renderHook(() => useGeraeteanmeldung(), { wrapper: huelle(ANGEMELDET) })

    await waitFor(() => expect(registriereGeraetGebuendelt).toHaveBeenCalled())
    expect(result.current.status).toBe('laedt')

    loese(geraet())
    await waitFor(() => expect(result.current.status).toBe('bereit'))
  })

  it('meldet das Geraet mit einem aus dem User-Agent geratenen Namen an', async () => {
    const { result } = renderHook(() => useGeraeteanmeldung(), { wrapper: huelle(ANGEMELDET) })

    await waitFor(() => expect(result.current.status).toBe('bereit'))
    expect(registriereGeraetGebuendelt).toHaveBeenCalledWith(
      expect.anything(),
      IDENTITAET,
      expect.objectContaining({ userId: 'user_1', label: expect.any(String) }),
    )
  })

  it('meldet einen gescheiterten Rundlauf als Fehler', async () => {
    registriereGeraetGebuendelt.mockRejectedValue(new Error('Kein Netz.'))

    const { result } = renderHook(() => useGeraeteanmeldung(), { wrapper: huelle(ANGEMELDET) })

    await waitFor(() => expect(result.current.status).toBe('fehler'))
  })

  it('ist abgemeldet, wenn niemand angemeldet ist', () => {
    const { result } = renderHook(() => useGeraeteanmeldung(), {
      wrapper: huelle({ status: 'abgemeldet' }),
    })

    expect(result.current.status).toBe('abgemeldet')
    expect(registriereGeraetGebuendelt).not.toHaveBeenCalled()
  })
})

describe('useGeraete', () => {
  it('liefert die eigenen Geraete', async () => {
    const { result } = renderHook(() => useGeraete(), { wrapper: huelle(ANGEMELDET) })

    await waitFor(() => expect(result.current.zustand.status).toBe('bereit'))
    expect(result.current.zustand).toMatchObject({ geraete: [geraet()] })
  })

  it('reicht einen Fehler aus der Anmeldung durch', async () => {
    // Ohne angemeldetes Geraet gibt es keine verlaessliche Liste.
    registriereGeraetGebuendelt.mockRejectedValue(new Error('Kein Netz.'))

    const { result } = renderHook(() => useGeraete(), { wrapper: huelle(ANGEMELDET) })

    await waitFor(() => expect(result.current.zustand.status).toBe('fehler'))
    expect(result.current.zustand).toMatchObject({ nachricht: 'Kein Netz.' })
  })

  it('meldet einen Fehler beim Laden der Liste', async () => {
    eigeneGeraete.mockRejectedValue(new Error('Liste nicht abrufbar.'))

    const { result } = renderHook(() => useGeraete(), { wrapper: huelle(ANGEMELDET) })

    await waitFor(() => expect(result.current.zustand.status).toBe('fehler'))
  })

  it('holt die Liste nach dem Umbenennen vom Server, nicht aus dem Speicher', async () => {
    /*
     * Was der Server liefert, hat die RLS passiert; was lokal nachgezogen
     * waere, nicht.
     */
    const { result } = renderHook(() => useGeraete(), { wrapper: huelle(ANGEMELDET) })
    await waitFor(() => expect(result.current.zustand.status).toBe('bereit'))
    expect(eigeneGeraete).toHaveBeenCalledTimes(1)

    eigeneGeraete.mockResolvedValue([geraet({ label: 'Neuer Name' })])
    await result.current.umbenennen('geraet-1', 'Neuer Name')

    await waitFor(() => expect(eigeneGeraete).toHaveBeenCalledTimes(2))
    await waitFor(() => {
      expect(result.current.zustand).toMatchObject({ geraete: [{ label: 'Neuer Name' }] })
    })
    expect(benenneGeraetUm).toHaveBeenCalledWith(expect.anything(), 'geraet-1', 'Neuer Name')
  })
})
