/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
  readonly VITE_CLERK_PUBLISHABLE_KEY: string
  /**
   * Kommaseparierte Zusatz-Hosts für die CSP, etwa die Frontend-API einer
   * Clerk-Produktionsinstanz. Wird nur zur Bauzeit gelesen (`build/csp.ts`).
   */
  readonly VITE_CLERK_FRONTEND_API?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
