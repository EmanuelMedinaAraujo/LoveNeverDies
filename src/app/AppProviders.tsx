import type { ReactNode } from 'react'
import { BrowserRouter } from 'react-router-dom'
import { ClerkAuthProvider } from '../core/auth/clerkAdapter.tsx'
import { SupabaseProvider } from '../core/db/supabaseProvider.tsx'
import { ErrorBoundary } from './ErrorBoundary.tsx'

/**
 * Die Provider-Schicht (DESIGN.md §9).
 *
 * Genau hier steht der Anbietername ein einziges Mal in der App. Ein Wechsel
 * der Auth-Schicht tauscht `ClerkAuthProvider` aus; alles darunter kennt nur
 * `useAuth()` aus `core/auth/authProvider.ts` (§1).
 */
export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <ErrorBoundary>
      <ClerkAuthProvider>
        <SupabaseProvider>
          <BrowserRouter>{children}</BrowserRouter>
        </SupabaseProvider>
      </ClerkAuthProvider>
    </ErrorBoundary>
  )
}
