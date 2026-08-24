import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthKontextProvider } from '../../src/core/auth/authProvider.ts'
import type { AuthZustand } from '../../src/core/auth/authProvider.ts'
import { authWert } from '../screens/harness.tsx'

/**
 * Der Profilabgleich nach der Anmeldung (DESIGN.md §3.3, §6).
 *
 * Er läuft still mit und hat keinen Screen. Was hier zählt: Er schreibt, sobald
 * jemand angemeldet ist, er schreibt bei jeder Anmeldung erneut (Namen ändern
 * sich), und er hält die App nicht an, wenn er scheitert.
 */

const speichere = vi.fn()

vi.mock('../../src/core/db/supabaseProfil.ts', () => ({
  supabaseProfil: () => ({ speichere: (...a: unknown[]) => speichere(...a) }),
}))
vi.mock('../../src/core/db/supabaseProvider.tsx', () => {
  const zugang = () => ({})
  return { useSupabase: () => zugang }
})

const { useProfilAbgleich } = await import('../../src/hooks/useProfil.ts')

function huelle(zustand: AuthZustand) {
  const wert = authWert(zustand)

  return function Huelle({ children }: { children: React.ReactNode }) {
    return <AuthKontextProvider value={wert}>{children}</AuthKontextProvider>
  }
}

const ANGEMELDET: AuthZustand = {
  status: 'angemeldet',
  benutzer: { id: 'user_1', anzeigename: 'Anna Müller', email: 'anna@example.de' },
}

beforeEach(() => {
  vi.clearAllMocks()
  speichere.mockResolvedValue(undefined)
})

describe('useProfilAbgleich (§3.3)', () => {
  it('schreibt nichts, solange niemand angemeldet ist', () => {
    const { result } = renderHook(() => useProfilAbgleich(), {
      wrapper: huelle({ status: 'abgemeldet' }),
    })

    expect(result.current.zustand).toEqual({ status: 'abgemeldet' })
    expect(speichere).not.toHaveBeenCalled()
  })

  it('hinterlegt Name und E-Mail der angemeldeten Person', async () => {
    const { result } = renderHook(() => useProfilAbgleich(), { wrapper: huelle(ANGEMELDET) })

    await waitFor(() => expect(result.current.zustand).toEqual({ status: 'bereit' }))

    expect(speichere).toHaveBeenCalledWith({
      userId: 'user_1',
      anzeigename: 'Anna Müller',
      email: 'anna@example.de',
    })
  })

  it('nimmt eine Person ohne E-Mail an', async () => {
    const { result } = renderHook(() => useProfilAbgleich(), {
      wrapper: huelle({
        status: 'angemeldet',
        benutzer: { id: 'user_1', anzeigename: 'Anna Müller', email: null },
      }),
    })

    await waitFor(() => expect(result.current.zustand).toEqual({ status: 'bereit' }))
    expect(speichere).toHaveBeenCalledWith(expect.objectContaining({ email: null }))
  })

  it('meldet einen Fehlschlag, ohne etwas anzuhalten', async () => {
    // Ohne Profil scheitert später `erzeuge_kopplungscode` mit einem Satz, der
    // sagt, was fehlt (§6). Bis dahin funktioniert alles andere.
    speichere.mockRejectedValue(new Error('permission denied'))

    const { result } = renderHook(() => useProfilAbgleich(), { wrapper: huelle(ANGEMELDET) })

    await waitFor(() =>
      expect(result.current.zustand).toEqual({ status: 'fehler', nachricht: 'permission denied' }),
    )
  })

  it('schreibt auf Wunsch noch einmal', async () => {
    /*
     * Ohne diesen Weg bliebe die Sitzung nach einem einzigen misslungenen
     * Rundlauf bis zum Neuladen ohne Profil — und jede Kopplung scheiterte an
     * „Ohne hinterlegten Namen gibt es keinen Kopplungscode" (§6).
     */
    speichere.mockRejectedValueOnce(new Error('permission denied'))

    const { result } = renderHook(() => useProfilAbgleich(), { wrapper: huelle(ANGEMELDET) })
    await waitFor(() => expect(result.current.zustand.status).toBe('fehler'))

    act(() => result.current.nochmal())

    await waitFor(() => expect(result.current.zustand).toEqual({ status: 'bereit' }))
    expect(speichere).toHaveBeenCalledTimes(2)
  })
})
