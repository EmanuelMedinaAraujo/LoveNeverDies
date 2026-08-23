import { defineConfig, devices } from '@playwright/test'

/**
 * Playwright-E2E gegen den echten Produktionsbuild (DESIGN.md — CSP, Service
 * Worker und alles, was `npm run build` erst erzeugt, soll mitgetestet werden).
 *
 * Backend: der lokale Supabase-Stack aus `npx supabase start` (kostenlos, siehe
 * supabase/README.md). Auth: die echte Clerk-Dev-Instanz, aber nur die eine
 * Testperson aus `E2E_CLERK_USER_EMAIL` — siehe tests/e2e/README.md.
 *
 * Aufruf ausschliesslich ueber `npm run test:e2e`, das `.env.test` per
 * `node --env-file` laedt. Ein direkter `playwright test`-Aufruf faende weder
 * die Supabase- noch die Clerk-Variablen.
 */

const AUTH_FILE = 'tests/e2e/.auth/user.json'

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  /*
   * Auch lokal mindestens ein Retry: Der allererste Request nach der Anmeldung
   * traegt ein druckfrisches Clerk-JWT, und dessen `nbf` faellt manchmal auf
   * dieselbe Sekunde wie die PostgREST-Pruefung — "JWT not yet valid" bei
   * einer Uhr, die nachweislich synchron laeuft. Der zweite Versuch traegt ein
   * neues Token und geht durch.
   */
  retries: process.env.CI ? 2 : 1,
  reporter: 'html',
  globalSetup: './tests/e2e/global-setup.ts',

  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'on-first-retry',
  },

  /*
   * Grosszuegig, weil die App vor jeder Ansicht erst Krypto-Schluessel im
   * Browser erzeugt (ML-KEM-768 + ML-DSA-65, DESIGN.md §3.1) und danach die
   * Geraeteanmeldung und die Fallliste vom Server holt — beides zusammen
   * dauert beim allerersten Laden laenger als die ueblichen 5s.
   */
  expect: { timeout: 15_000 },

  webServer: {
    command: 'npm run build:test && npm run preview:test',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },

  projects: [
    { name: 'setup', testMatch: /auth\.setup\.ts/ },
    {
      name: 'mobile-chromium',
      // Mobile-first PWA (README.md): der Haupt-Viewport ist ein Telefon, kein
      // Desktop-Browserfenster.
      use: { ...devices['iPhone 13'], storageState: AUTH_FILE },
      dependencies: ['setup'],
    },
  ],
})
