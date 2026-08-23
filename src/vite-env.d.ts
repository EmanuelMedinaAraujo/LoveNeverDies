/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
  readonly VITE_CLERK_PUBLISHABLE_KEY: string
  /**
   * Kommaseparierte Zusatz-Hosts für die CSP, etwa die Frontend-API einer
   * Clerk-Produktionsinstanz. Wird nur zur Bauzeit gelesen (`build/csp.ts`).
   */
  readonly VITE_CLERK_FRONTEND_API?: string
  /**
   * Projekt-URL aus Supabase, Region EU/Frankfurt (§4).
   *
   * Optional, weil sie fehlen darf: Die Anmeldeseite braucht kein Supabase, und
   * `erzeugeSupabaseClient` prueft das ausdruecklich. Stuende hier `string`,
   * saehe jeder Aufrufer einen Wert, den es nicht immer gibt.
   */
  readonly VITE_SUPABASE_URL?: string
  /**
   * Der oeffentliche Anon-Key. Er darf im ausgelieferten JavaScript stehen: Was
   * jemand damit sieht, entscheidet die RLS aus §4, nicht der Besitz des Keys.
   */
  readonly VITE_SUPABASE_ANON_KEY?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
