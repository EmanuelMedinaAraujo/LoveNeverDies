import { renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import {
  AuthKontextProvider,
  useAuth,
  type AuthKontextWert,
} from '../../../src/core/auth/authProvider.ts'

/**
 * Der Adapter aus DESIGN.md §1: Der Rest der App kennt ausschliesslich dieses
 * Interface, nie Clerk. Geprueft wird deshalb der Vertrag, nicht der Anbieter.
 */

function wert(ueberschreibung: Partial<AuthKontextWert> = {}): AuthKontextWert {
  return {
    zustand: { status: 'abgemeldet' },
    abmelden: vi.fn().mockResolvedValue(undefined),
    zugangstoken: vi.fn().mockResolvedValue(null),
    ...ueberschreibung,
  }
}

function huelle(kontext: AuthKontextWert) {
  return function Huelle({ children }: { children: ReactNode }) {
    return <AuthKontextProvider value={kontext}>{children}</AuthKontextProvider>
  }
}

describe('useAuth', () => {
  it('wirft ausserhalb eines Providers', () => {
    /*
     * Der Wurf ist die Zusage: Ohne Provider gaebe ein `null` einen stillen
     * "abgemeldet"-Zustand vor, und ein Screen zeigte die Anmeldung an, obwohl
     * in Wirklichkeit die Verkabelung fehlt.
     *
     * React schreibt den Fehler zusaetzlich in die Konsole. Der Test soll
     * deswegen nicht rot aussehen.
     */
    const stille = vi.spyOn(console, 'error').mockImplementation(() => {})

    try {
      expect(() => renderHook(() => useAuth())).toThrow(/ausserhalb eines AuthProviders/)
    } finally {
      stille.mockRestore()
    }
  })

  it('reicht den abgemeldeten Zustand durch', () => {
    const { result } = renderHook(() => useAuth(), { wrapper: huelle(wert()) })

    expect(result.current.zustand).toEqual({ status: 'abgemeldet' })
  })

  it('reicht die angemeldete Person durch', () => {
    const benutzer = { id: 'user_1', anzeigename: 'Anna Müller', email: 'anna@example.de' }
    const { result } = renderHook(() => useAuth(), {
      wrapper: huelle(wert({ zustand: { status: 'angemeldet', benutzer } })),
    })

    expect(result.current.zustand).toEqual({ status: 'angemeldet', benutzer })
  })

  it('reicht Abmelden und Token durch', async () => {
    const kontext = wert({ zugangstoken: vi.fn().mockResolvedValue('ein-token') })
    const { result } = renderHook(() => useAuth(), { wrapper: huelle(kontext) })

    await result.current.abmelden()
    expect(kontext.abmelden).toHaveBeenCalledOnce()

    await expect(result.current.zugangstoken()).resolves.toBe('ein-token')
  })
})
