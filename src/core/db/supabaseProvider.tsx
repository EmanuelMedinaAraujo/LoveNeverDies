import { createContext, useContext, useMemo, type ReactNode } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { useAuth } from '../auth/authProvider.ts'
import { erzeugeSupabaseClient } from './supabase.ts'

/**
 * Ein Supabase-Client für die ganze App (DESIGN.md §4).
 *
 * Genau einer, weil er eine Realtime-Verbindung hält (§5) und weil zwei
 * Clients zwei Verbindungen hielten. Er entsteht neu, wenn sich der
 * Token-Geber ändert — also beim An- und Abmelden, und sonst nie.
 *
 * **Er entsteht erst, wenn ihn jemand braucht.** Der Kontext gibt keinen
 * Client heraus, sondern einen Zugang, der ihn beim ersten Aufruf anlegt. Der
 * Unterschied ist keine Feinheit: Fehlt die Projektkonfiguration, wirft das
 * Anlegen — und ein Wurf beim Rendern des Providers nähme die Anmeldeseite mit,
 * die von Supabase gar nichts braucht. So scheitert stattdessen der eine
 * Aufruf, der wirklich einen Server wollte, und die Meldung landet dort, wo
 * jemand etwas damit anfangen kann.
 */

export type SupabaseZugang = () => SupabaseClient

const SupabaseKontext = createContext<SupabaseZugang | null>(null)

export function useSupabase(): SupabaseZugang {
  const zugang = useContext(SupabaseKontext)

  if (zugang === null) {
    throw new Error('useSupabase ausserhalb eines SupabaseProviders aufgerufen.')
  }

  return zugang
}

export function SupabaseProvider({ children }: { children: ReactNode }) {
  const { zugangstoken } = useAuth()

  const zugang = useMemo<SupabaseZugang>(() => {
    let client: SupabaseClient | null = null

    return () => (client ??= erzeugeSupabaseClient(zugangstoken))
  }, [zugangstoken])

  return <SupabaseKontext.Provider value={zugang}>{children}</SupabaseKontext.Provider>
}
