import { deDE } from '@clerk/localizations'
import { ClerkProvider, useClerk, useSession, useUser } from '@clerk/react'
import { useCallback, useMemo, type ReactNode } from 'react'
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

function ClerkZustandBruecke({ children }: { children: ReactNode }) {
  const { isLoaded, isSignedIn, user } = useUser()
  const { session } = useSession()
  const clerk = useClerk()

  /*
   * Clerk gibt bei jedem Aufruf ein frisches Token heraus und erneuert es
   * selbst, sobald es abgelaufen ist. Deshalb wird hier keines zwischengelegt:
   * Der Supabase-Client fragt vor jeder Anfrage, und ein Token, das jemand
   * aufgehoben hat, ist genau das eine, das irgendwann nicht mehr gilt.
   */
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
        // Clerk laesst beide Namensfelder leer, wenn sich jemand nur mit einer
        // E-Mail-Adresse registriert. Dann ist die Adresse der Anzeigename;
        // ein leerer Name waere in §6 ("Anna Mueller zum Fall hinzufuegen?")
        // schlimmer als eine E-Mail-Adresse.
        anzeigename:
          user.fullName?.trim() ||
          user.primaryEmailAddress?.emailAddress ||
          'Unbenannt',
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

export function ClerkAuthProvider({ children }: { children: ReactNode }) {
  if (!publishableKey) {
    throw new Error(
      'VITE_CLERK_PUBLISHABLE_KEY fehlt. Siehe .env.example und `clerk init`.',
    )
  }

  return (
    <ClerkProvider
      publishableKey={publishableKey}
      localization={deDE}
      afterSignOutUrl="/"
      /*
       * ClerkJS meldet sonst Nutzungsdaten an `clerk-telemetry.com`. Die CSP
       * blockt das ohnehin (§11.2 kennt den Host nicht), aber ein blockierter
       * Aufruf ist eine Fehlermeldung in jeder Konsole und ein Versuch, der
       * bei jedem Laden neu unternommen wird. Abgeschaltet gehoert er auch
       * der Sache nach: Eine App, die Inhalte vor dem eigenen Server
       * verbirgt, soll ihr Nutzungsverhalten nicht an einen Dritten geben.
       */
      telemetry={{ disabled: true }}
    >
      <ClerkZustandBruecke>{children}</ClerkZustandBruecke>
    </ClerkProvider>
  )
}
