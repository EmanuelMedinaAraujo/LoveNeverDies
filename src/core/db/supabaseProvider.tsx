import { createContext, useCallback, useContext, useEffect, useRef, type ReactNode } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { useAuth } from '../auth/authProvider.ts'
import { erzeugeSupabaseClient } from './supabase.ts'

/**
 * Ein Supabase-Client für die ganze App (DESIGN.md §4).
 *
 * Genau einer, weil er eine Realtime-Verbindung hält (§5) und weil zwei
 * Clients zwei Verbindungen hielten. Er entsteht neu, wenn eine andere Person
 * angemeldet ist — beim An- und Abmelden, und sonst nie.
 *
 * **Nicht am Token-Geber festgemacht.** Clerk gibt bei jeder Erneuerung eine
 * neue Funktion heraus, und das passiert im Betrieb dauernd. Hinge der Client
 * daran, entstünde er dauernd neu; der alte hielte seine Verbindung weiter,
 * und aus dem einen Client würden über eine lange Sitzung viele. Der Client
 * fragt deshalb über eine Referenz nach dem Token — was er beim Anlegen
 * vorfand, ist beim Absenden ohnehin abgelaufen.
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
  const { zustand, zugangstoken } = useAuth()

  const geber = useRef(zugangstoken)
  const client = useRef<SupabaseClient | null>(null)

  useEffect(() => {
    geber.current = zugangstoken
  }, [zugangstoken])

  const zugang = useCallback<SupabaseZugang>(
    () => (client.current ??= erzeugeSupabaseClient(() => geber.current())),
    [],
  )

  const benutzerId = zustand.status === 'angemeldet' ? zustand.benutzer.id : null

  useEffect(() => {
    // Beim Benutzerwechsel wird der Client weggeräumt, statt ihn liegen zu
    // lassen: Seine Kanäle sind an die Zeilen gebunden, die der vorigen Person
    // sichtbar waren, und der nächste Aufruf legt einen frischen an. React
    // führt alle Aufräumer eines Commits vor allen Effekten aus — was hier
    // genullt wird, ist genullt, bevor ein Kind wieder `zugang()` ruft.
    return () => {
      void client.current?.removeAllChannels()
      client.current = null
    }
  }, [benutzerId])

  return <SupabaseKontext.Provider value={zugang}>{children}</SupabaseKontext.Provider>
}
