import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

/**
 * Eigene Konfiguration statt eines `test`-Blocks in `vite.config.ts`: Die Tests
 * brauchen keine Service-Worker-Erzeugung, und der Lint-Lauf soll nicht darauf
 * warten.
 *
 * Zwei Projekte, weil zwei Sorten Tests zwei Umgebungen brauchen:
 *
 * - node. Kryptokern, PGlite und die Dienste. `jsdom` brächte hier nichts
 *   und stünde zwischen den Tests und dem echten WebCrypto bzw. Postgres.
 * - jsdom. Alles, was rendert. Nur dieses Projekt lädt das React-Plugin
 *   für die JSX-Transformation und die Matcher aus `@testing-library/jest-dom`.
 *
 * Die Aufteilung läuft über die Dateiendung: `.test.ts` ist node, `.test.tsx`
 * ist jsdom. Damit steht die Umgebung schon am Dateinamen und nicht in einer
 * Liste, die beim nächsten neuen Test vergessen wird.
 */
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'node',
          include: ['tests/**/*.test.ts'],
          environment: 'node',
          // Der erste Lint-Lauf lädt die gesamte ESLint-Konfiguration samt
          // Plugins und braucht auf einem kalten Cache deutlich mehr als die
          // üblichen 5 Sekunden.
          testTimeout: 120_000,
          hookTimeout: 120_000,
        },
      },
      {
        plugins: [react()],
        test: {
          name: 'jsdom',
          include: ['tests/**/*.test.tsx'],
          environment: 'jsdom',
          setupFiles: ['tests/setup.ts'],
        },
      },
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.module.css.d.ts', 'src/vite-env.d.ts'],
    },
  },
})
