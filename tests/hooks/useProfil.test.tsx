import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthKontextProvider } from '../../src/core/auth/authProvider.ts'
import type { AuthZustand } from '../../src/core/auth/authProvider.ts'
import { authWert } from '../screens/harness.tsx'

/**
 * Der Profilabgleich nach der Anmeldung (DESIGN.md §3.3, §6).
 *
 * Er läuft still mit und hat keinen Screen, solange bei Clerk ein Name steht:
 * Er schreibt, sobald jemand angemeldet ist, er schreibt bei jeder Anmeldung
 * erneut (Namen ändern sich), und er hält die App nicht an, wenn er scheitert.
 *
 * Steht dort keiner — der Regelfall bei „Mit Apple anmelden" —, ist er das
 * Gegenteil: Er überschreibt nichts, meldet den fehlenden Namen und nimmt ihn
 * entgegen, wenn ein Formular ihn erfragt hat (§3.3, §6).
 */

const speichere = vi.fn()
const namen = vi.fn<() => Promise<Map<string, string>>>()

vi.mock('../../src/core/db/supabaseProfil.ts', () => ({
  supabaseProfil: () => ({
    speichere: (...a: unknown[]) => speichere(...a),
    namen: () => namen(),
  }),
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
  namen.mockResolvedValue(new Map())
})

/** Angemeldet, aber ohne Namen bei Clerk: „Mit Apple anmelden". */
const OHNE_NAMEN: AuthZustand = {
  status: 'angemeldet',
  benutzer: { id: 'user_1', anzeigename: '', email: 'k7f3x9a2b1@privaterelay.appleid.com' },
}

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
    expect(result.current.name).toBe('Anna Müller')
    expect(result.current.nameFehlt).toBe(false)
  })

  it('schreibt nicht noch einmal, was schon so dasteht', async () => {
    namen.mockResolvedValue(new Map([['user_1', 'Anna Müller']]))

    const { result } = renderHook(() => useProfilAbgleich(), { wrapper: huelle(ANGEMELDET) })

    await waitFor(() => expect(result.current.zustand).toEqual({ status: 'bereit' }))
    expect(speichere).not.toHaveBeenCalled()
  })

  it('meldet den fehlenden Namen, statt die E-Mail-Adresse einzutragen (§3.3)', async () => {
    const { result } = renderHook(() => useProfilAbgleich(), { wrapper: huelle(OHNE_NAMEN) })

    await waitFor(() => expect(result.current.zustand).toEqual({ status: 'bereit' }))

    expect(speichere).not.toHaveBeenCalled()
    expect(result.current.name).toBe('')
    expect(result.current.nameFehlt).toBe(true)
  })

  it('haelt eine als Name eingetragene Adresse fuer keinen Namen', async () => {
    /*
     * Der Bestand aus der Zeit, in der der Adapter die Adresse ersatzweise
     * eintrug: Sie steht in `profiles.display_name` und wuerde sonst weiter
     * als Name durchgehen (`services/personenname.ts`).
     */
    namen.mockResolvedValue(new Map([['user_1', 'k7f3x9a2b1@privaterelay.appleid.com']]))

    const { result } = renderHook(() => useProfilAbgleich(), { wrapper: huelle(OHNE_NAMEN) })

    await waitFor(() => expect(result.current.nameFehlt).toBe(true))
    expect(result.current.name).toBe('')
  })

  it('laesst den selbst eingetragenen Namen stehen und gibt ihn heraus', async () => {
    namen.mockResolvedValue(new Map([['user_1', 'Bernd Weber']]))

    const { result } = renderHook(() => useProfilAbgleich(), { wrapper: huelle(OHNE_NAMEN) })

    await waitFor(() => expect(result.current.zustand).toEqual({ status: 'bereit' }))

    // Der leere Name aus Clerk gewinnt nicht: Sonst waere der eingetragene
    // beim naechsten Oeffnen der App wieder weg.
    expect(speichere).not.toHaveBeenCalled()
    expect(result.current.name).toBe('Bernd Weber')
    expect(result.current.nameFehlt).toBe(false)
  })

  it('nimmt einen eingegebenen Namen entgegen', async () => {
    const { result } = renderHook(() => useProfilAbgleich(), { wrapper: huelle(OHNE_NAMEN) })
    await waitFor(() => expect(result.current.nameFehlt).toBe(true))

    await act(() => result.current.speichereNamen('  Bernd Weber '))

    expect(speichere).toHaveBeenCalledWith({
      userId: 'user_1',
      anzeigename: 'Bernd Weber',
      email: 'k7f3x9a2b1@privaterelay.appleid.com',
    })
    expect(result.current.name).toBe('Bernd Weber')
    expect(result.current.nameFehlt).toBe(false)
  })

  it('nimmt keinen leeren Namen entgegen', async () => {
    const { result } = renderHook(() => useProfilAbgleich(), { wrapper: huelle(OHNE_NAMEN) })
    await waitFor(() => expect(result.current.nameFehlt).toBe(true))

    await expect(result.current.speichereNamen('   ')).rejects.toThrow(/Namen/)
    expect(speichere).not.toHaveBeenCalled()
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
     * Rundlauf bis zum Neuladen ohne Profil, und jede Kopplung scheiterte an
     * "Ohne hinterlegten Namen gibt es keinen Kopplungscode" (§6).
     */
    speichere.mockRejectedValueOnce(new Error('permission denied'))

    const { result } = renderHook(() => useProfilAbgleich(), { wrapper: huelle(ANGEMELDET) })
    await waitFor(() => expect(result.current.zustand.status).toBe('fehler'))

    act(() => result.current.nochmal())

    await waitFor(() => expect(result.current.zustand).toEqual({ status: 'bereit' }))
    expect(speichere).toHaveBeenCalledTimes(2)
  })
})
