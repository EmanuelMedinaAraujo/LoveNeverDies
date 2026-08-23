import { defineConfig } from 'vitest/config'

/**
 * Eigene Konfiguration statt eines `test`-Blocks in `vite.config.ts`: Die Tests
 * brauchen weder React-Transform noch Service-Worker-Erzeugung, und der
 * Lint-Lauf soll nicht darauf warten.
 */
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    // Der erste Lint-Lauf lädt die gesamte ESLint-Konfiguration samt Plugins
    // und braucht auf einem kalten Cache deutlich mehr als die üblichen
    // 5 Sekunden.
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
})
