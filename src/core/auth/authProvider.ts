import { createContext, useContext } from 'react'

/**
 * Die Auth-Schicht als Adapter (DESIGN.md §1).
 *
 * Der Rest der App kennt ausschliesslich dieses Interface. Clerk kommt in genau
 * zwei Dateien vor: `core/auth/clerkAdapter.tsx` (Sitzung) und
 * `screens/shared/Anmelden` (Anmeldeformular). Ein Wechsel des Anbieters
 * tauscht diese beiden aus und sonst nichts.
 *
 * §3.6 nennt den Grund, warum diese Grenze mehr ist als Ordnungsliebe: Ein
 * gestohlenes Passwort reicht nicht zum Entschluesseln, weil `sk_u`
 * geraetegebunden bleibt. Die Anmeldung sagt, wer jemand ist, nie, was jemand
 * lesen darf. Das entscheiden RLS und die Schluesselhierarchie.
 */

export type AuthBenutzer = {
  /** Clerk `sub`. Steht im Klartext in `memberships.user_id` (§3.3). */
  id: string
  anzeigename: string
  email: string | null
}

export type AuthZustand =
  | { status: 'laedt' }
  | { status: 'abgemeldet' }
  | { status: 'angemeldet'; benutzer: AuthBenutzer }

export type AuthKontextWert = {
  zustand: AuthZustand
  abmelden: () => Promise<void>
  /**
   * Das Token, mit dem der Supabase-Client sich ausweist (§4).
   *
   * Es steht hier und nicht neben dem Client, weil sonst der Anbietername eine
   * dritte Datei braeuchte. `null`, solange niemand angemeldet ist. Dann
   * greift keine Policy, und PostgREST antwortet mit leeren Mengen statt mit
   * fremden Zeilen.
   */
  zugangstoken: () => Promise<string | null>
}

const AuthKontext = createContext<AuthKontextWert | null>(null)

export const AuthKontextProvider = AuthKontext.Provider

export function useAuth(): AuthKontextWert {
  const wert = useContext(AuthKontext)

  if (wert === null) {
    throw new Error('useAuth ausserhalb eines AuthProviders aufgerufen.')
  }

  return wert
}
