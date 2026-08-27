import { deDE } from '@clerk/localizations'
import { ClerkProvider, useClerk, useSession, useUser } from '@clerk/react'
import { useCallback, useMemo, useState, type ReactNode } from 'react'
import { AuthKontextProvider, type AuthKontextWert, type AuthZustand } from './authProvider.ts'

/**
 * Clerk hinter dem `AuthProvider`-Adapter (DESIGN.md §1).
 *
 * Dieses Modul kennt kein Aussehen und keinen Screen. Es uebersetzt nur Clerks
 * Sitzungszustand in `AuthZustand`. Das Anmeldeformular liegt in
 * `screens/shared/Anmelden`. Ein Screen ist ein Screen, und `core` zeigt
 * niemals nach oben (§9).
 */

const publishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY

const istGueltigerKey =
  typeof publishableKey === 'string' &&
  publishableKey.trim() !== '' &&
  !publishableKey.includes('xxxxxxxx') &&
  (publishableKey.startsWith('pk_test_') || publishableKey.startsWith('pk_live_'))

function ClerkZustandBruecke({ children }: { children: ReactNode }) {
  const { isLoaded, isSignedIn, user } = useUser()
  const { session } = useSession()
  const clerk = useClerk()

  const zugangstoken = useCallback(async () => (await session?.getToken()) ?? null, [session])

  const abmelden = useCallback(async () => {
    await clerk.signOut()
  }, [clerk])

  const zustand = useMemo<AuthZustand>(() => {
    if (!isLoaded) {
      return { status: 'laedt' }
    }

    if (!isSignedIn || !user) {
      return { status: 'abgemeldet' }
    }

    return {
      status: 'angemeldet',
      benutzer: {
        id: user.id,
        anzeigename:
          user.fullName?.trim() ||
          [user.firstName, user.lastName]
            .map((teil) => teil?.trim() ?? '')
            .filter((teil) => teil !== '')
            .join(' '),
        email: user.primaryEmailAddress?.emailAddress ?? null,
      },
    }
  }, [isLoaded, isSignedIn, user])

  const wert = useMemo<AuthKontextWert>(
    () => ({ zustand, abmelden, zugangstoken }),
    [zustand, abmelden, zugangstoken],
  )

  return <AuthKontextProvider value={wert}>{children}</AuthKontextProvider>
}

/**
 * Fallback-Provider für den Betrieb ohne Clerk-Konfiguration (Demo-Modus / lokales Testen).
 */
function DemoAuthProvider({ children }: { children: ReactNode }) {
  const [angemeldet, setzeAngemeldet] = useState(true)

  const abmelden = useCallback(async () => {
    setzeAngemeldet(false)
  }, [])

  const zugangstoken = useCallback(async () => null, [])

  const zustand = useMemo<AuthZustand>(() => {
    if (!angemeldet) {
      return { status: 'abgemeldet' }
    }
    return {
      status: 'angemeldet',
      benutzer: {
        id: 'demo-user-lokal',
        anzeigename: 'Demo Nutzer',
        email: 'demo@loveneverdies.app',
      },
    }
  }, [angemeldet])

  const wert = useMemo<AuthKontextWert>(
    () => ({ zustand, abmelden, zugangstoken }),
    [zustand, abmelden, zugangstoken],
  )

  return <AuthKontextProvider value={wert}>{children}</AuthKontextProvider>
}

export function ClerkAuthProvider({ children }: { children: ReactNode }) {
  if (!istGueltigerKey) {
    console.warn(
      'VITE_CLERK_PUBLISHABLE_KEY fehlt oder ist ein Platzhalter. App läuft im Demo/Entwicklungsmodus.',
    )
    return <DemoAuthProvider>{children}</DemoAuthProvider>
  }

  return (
    <ClerkProvider
      publishableKey={publishableKey}
      localization={deDE}
      afterSignOutUrl="/"
      telemetry={{ disabled: true }}
    >
      <ClerkZustandBruecke>{children}</ClerkZustandBruecke>
    </ClerkProvider>
  )
}
