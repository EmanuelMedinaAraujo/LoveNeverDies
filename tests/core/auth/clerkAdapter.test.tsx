import { render, renderHook, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Clerk hinter dem Adapter (DESIGN.md §1).
 *
 * Dieses Modul ist eine von genau zwei Stellen, an denen der Anbietername
 * überhaupt vorkommt. Geprüft wird deshalb die Übersetzung: Was Clerks Hooks
 * sagen, wird zu `AuthZustand`, und zwar so, dass "lädt" und "abgemeldet"
 * nicht verwechselt werden. Eine Verwechslung zeigte die Anmeldung an, während
 * die Sitzung noch lädt, und ein angemeldeter Mensch sähe kurz das Formular.
 */

const useUser = vi.fn()
const useSession = vi.fn()
const useClerk = vi.fn()
const signOut = vi.fn()
const getToken = vi.fn()

vi.mock('@clerk/localizations', () => ({ deDE: { locale: 'de-DE' } }))

vi.mock('@clerk/react', () => ({
  ClerkProvider: ({ children }: { children: ReactNode; publishableKey: string }) => (
    <div data-testid="clerk-provider">{children}</div>
  ),
  useUser: () => useUser(),
  useSession: () => useSession(),
  useClerk: () => useClerk(),
}))

/**
 * `resetModules` samt dynamischem Import, weil der Adapter den Publishable Key
 * beim Laden des Moduls liest.
 *
 * `useAuth` kommt aus demselben frisch geladenen Modulgraphen, nicht aus
 * einem Import oben in dieser Datei: Nach `resetModules` gibt es `authProvider`
 * zweimal, jedes mit einem eigenen React-Kontextobjekt. Der Provider schriebe
 * dann in den einen Kontext und der Verbraucher läse aus dem anderen. Der
 * Test scheiterte an `useAuth ausserhalb eines AuthProviders`, ohne dass am
 * Code etwas falsch wäre.
 */
async function ladeModul(publishableKey: string | undefined) {
  vi.resetModules()
  vi.stubEnv('VITE_CLERK_PUBLISHABLE_KEY', publishableKey ?? '')

  const [adapter, provider] = await Promise.all([
    import('../../../src/core/auth/clerkAdapter.tsx'),
    import('../../../src/core/auth/authProvider.ts'),
  ])

  function Zeige() {
    const { zustand } = provider.useAuth()
    return <span data-testid="zustand">{JSON.stringify(zustand)}</span>
  }

  return { ...adapter, useAuth: provider.useAuth, Zeige }
}

beforeEach(() => {
  vi.clearAllMocks()
  useUser.mockReturnValue({ isLoaded: true, isSignedIn: false, user: null })
  useSession.mockReturnValue({ session: { getToken } })
  useClerk.mockReturnValue({ signOut })
  getToken.mockResolvedValue('ein-token')
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('ClerkAuthProvider', () => {
  it('nennt den fehlenden Schluessel beim Namen', async () => {
    // Sonst stuende ein leerer Bildschirm ohne Hinweis, was fehlt.
    const { ClerkAuthProvider } = await ladeModul(undefined)
    const stille = vi.spyOn(console, 'error').mockImplementation(() => {})

    try {
      expect(() => render(<ClerkAuthProvider>{null}</ClerkAuthProvider>)).toThrow(
        /VITE_CLERK_PUBLISHABLE_KEY fehlt/,
      )
    } finally {
      stille.mockRestore()
    }
  })

  it('rendert die Kinder unter dem Anbieter', async () => {
    const { ClerkAuthProvider } = await ladeModul('pk_test_abc')

    render(
      <ClerkAuthProvider>
        <p>Inhalt</p>
      </ClerkAuthProvider>,
    )

    expect(screen.getByTestId('clerk-provider')).toBeVisible()
    expect(screen.getByText('Inhalt')).toBeVisible()
  })
})

describe('Zustandsuebersetzung', () => {
  async function rendereZustand() {
    const { ClerkAuthProvider, Zeige } = await ladeModul('pk_test_abc')

    render(
      <ClerkAuthProvider>
        <Zeige />
      </ClerkAuthProvider>,
    )

    return JSON.parse(screen.getByTestId('zustand').textContent ?? '{}') as {
      status: string
      benutzer?: { id: string; anzeigename: string; email: string | null }
    }
  }

  it('meldet "laedt", solange Clerk nicht geladen hat', async () => {
    useUser.mockReturnValue({ isLoaded: false, isSignedIn: false, user: null })

    expect((await rendereZustand()).status).toBe('laedt')
  })

  it('meldet "abgemeldet", wenn niemand angemeldet ist', async () => {
    expect((await rendereZustand()).status).toBe('abgemeldet')
  })

  it('meldet "abgemeldet", wenn Clerk angemeldet sagt, aber keinen Benutzer liefert', async () => {
    useUser.mockReturnValue({ isLoaded: true, isSignedIn: true, user: null })

    expect((await rendereZustand()).status).toBe('abgemeldet')
  })

  it('uebernimmt den vollen Namen als Anzeigenamen', async () => {
    useUser.mockReturnValue({
      isLoaded: true,
      isSignedIn: true,
      user: {
        id: 'user_1',
        fullName: 'Anna Müller',
        primaryEmailAddress: { emailAddress: 'anna@example.de' },
      },
    })

    expect(await rendereZustand()).toEqual({
      status: 'angemeldet',
      benutzer: { id: 'user_1', anzeigename: 'Anna Müller', email: 'anna@example.de' },
    })
  })

  it('setzt den Namen aus Vor- und Nachname zusammen, wenn nur die dastehen', async () => {
    useUser.mockReturnValue({
      isLoaded: true,
      isSignedIn: true,
      user: {
        id: 'user_1',
        fullName: null,
        firstName: 'Anna',
        lastName: '  Müller ',
        primaryEmailAddress: { emailAddress: 'anna@example.de' },
      },
    })

    expect((await rendereZustand()).benutzer?.anzeigename).toBe('Anna Müller')
  })

  it('nimmt die E-Mail-Adresse nicht als Namen, wenn keiner hinterlegt ist', async () => {
    /*
     * Der Fall, den „Mit Apple anmelden" jedes Mal erzeugt, wenn Apple den
     * Namen nicht weitergibt: Frueher stand dann die Adresse als Anzeigename
     * da, und weil sie von hier aus in `profiles`, in die Vorsorge-Anlage und
     * in jedes Kopplungsangebot wandert, fragte §6 danach, ob
     * `k7f3x9a2b1@privaterelay.appleid.com` zum Fall hinzugefuegt werden soll.
     */
    useUser.mockReturnValue({
      isLoaded: true,
      isSignedIn: true,
      user: {
        id: 'user_1',
        fullName: '   ',
        primaryEmailAddress: { emailAddress: 'k7f3x9a2b1@privaterelay.appleid.com' },
      },
    })

    expect(await rendereZustand()).toMatchObject({
      benutzer: { anzeigename: '', email: 'k7f3x9a2b1@privaterelay.appleid.com' },
    })
  })

  it('laesst den Namen leer, wenn beides fehlt', async () => {
    useUser.mockReturnValue({
      isLoaded: true,
      isSignedIn: true,
      user: { id: 'user_1', fullName: null, primaryEmailAddress: null },
    })

    expect(await rendereZustand()).toMatchObject({
      benutzer: { anzeigename: '', email: null },
    })
  })
})

describe('Token und Abmelden', () => {
  async function rendereHook() {
    const { ClerkAuthProvider, useAuth } = await ladeModul('pk_test_abc')

    return renderHook(() => useAuth(), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <ClerkAuthProvider>{children}</ClerkAuthProvider>
      ),
    })
  }

  it('holt bei jedem Aufruf ein frisches Token', async () => {
    /*
     * Kein Zwischenlegen: Clerk erneuert selbst, und ein aufgehobenes Token
     * ist genau das eine, das irgendwann nicht mehr gilt (§4).
     */
    const { result } = await rendereHook()

    await expect(result.current.zugangstoken()).resolves.toBe('ein-token')
    await expect(result.current.zugangstoken()).resolves.toBe('ein-token')
    expect(getToken).toHaveBeenCalledTimes(2)
  })

  it('liefert null, solange es keine Sitzung gibt', async () => {
    // Dann greift keine Policy, und PostgREST antwortet mit leeren Mengen
    // statt mit fremden Zeilen.
    useSession.mockReturnValue({ session: null })

    const { result } = await rendereHook()

    await expect(result.current.zugangstoken()).resolves.toBeNull()
  })

  it('meldet ueber Clerk ab', async () => {
    const { result } = await rendereHook()

    await result.current.abmelden()

    expect(signOut).toHaveBeenCalledOnce()
  })
})
