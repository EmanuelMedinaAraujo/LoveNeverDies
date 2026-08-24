import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthKontextProvider, type AuthZustand } from '../../src/core/auth/authProvider.ts'
import { ANGEMELDET, authWert, BENUTZER } from '../screens/harness.tsx'

/**
 * Wer außer mir zu diesem Fall gehört (DESIGN.md §4, §7).
 *
 * Der Adapter ist ersetzt; was er übersetzt, steht in
 * `tests/db/supabaseMitglieder.test.ts`. Hier geht es um das, was der Hook
 * daraus macht: die angemeldete Person steht immer dabei, und ein Fehlschlag
 * nimmt niemandem die Auswahl weg.
 */

const imFall = vi.fn()

vi.mock('../../src/core/db/supabaseMitglieder.ts', () => ({
  supabaseMitglieder: () => ({ imFall: (...a: unknown[]) => imFall(...a) }),
}))

/* Derselbe Grund wie in `useGeraete.test.tsx`: eine stabile Funktion. */
vi.mock('../../src/core/db/supabaseProvider.tsx', () => {
  const zugang = () => ({})
  return { useSupabase: () => zugang }
})

const { useMitglieder } = await import('../../src/hooks/useMitglieder.ts')

function huelle(zustand: AuthZustand = ANGEMELDET) {
  return function Huelle({ children }: { children: ReactNode }) {
    return <AuthKontextProvider value={authWert(zustand)}>{children}</AuthKontextProvider>
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  imFall.mockResolvedValue([])
})

describe('useMitglieder', () => {
  it('liest die Mitglieder des Falls', async () => {
    imFall.mockResolvedValue([
      { userId: BENUTZER.id, beigetretenAm: '2026-08-24T10:00:00Z' },
      { userId: 'user_bert', beigetretenAm: '2026-08-25T09:00:00Z' },
    ])

    const { result } = renderHook(() => useMitglieder('fall-1'), { wrapper: huelle() })

    await waitFor(() => expect(result.current.userIds).toEqual([BENUTZER.id, 'user_bert']))
    expect(imFall).toHaveBeenCalledWith('fall-1')
  })

  it('nennt die angemeldete Person, wie sie in eine Zuweisung geschrieben wird', () => {
    const { result } = renderHook(() => useMitglieder('fall-1'), { wrapper: huelle() })

    expect(result.current.ich).toEqual({ userId: BENUTZER.id, name: BENUTZER.anzeigename })
  })

  it('hat die angemeldete Person dabei, noch bevor der Abruf zurück ist', () => {
    /*
     * Ohne sie stünde in der Auswahl "niemand", während man selbst davorsitzt,
     * und "Übernehmen" wäre für einen Moment eine Schaltfläche ohne Ziel (§7).
     */
    const { result } = renderHook(() => useMitglieder('fall-1'), { wrapper: huelle() })

    expect(result.current.userIds).toEqual([BENUTZER.id])
  })

  it('lässt nach einem Fehlschlag die eigene Person stehen', async () => {
    imFall.mockRejectedValue(new Error('keine Verbindung'))

    const { result } = renderHook(() => useMitglieder('fall-1'), { wrapper: huelle() })

    await waitFor(() => expect(result.current.fehler).toBe('keine Verbindung'))
    expect(result.current.userIds).toEqual([BENUTZER.id])
  })

  it('kennt ohne Anmeldung niemanden zum Eintragen', () => {
    const { result } = renderHook(() => useMitglieder('fall-1'), {
      wrapper: huelle({ status: 'abgemeldet' }),
    })

    expect(result.current.ich).toEqual({ userId: '', name: '' })
    expect(result.current.userIds).toEqual([])
  })
})
