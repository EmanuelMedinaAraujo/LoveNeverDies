import { defineConfig, devices } from '@playwright/test'
import { authDatei } from './tests/e2e/nutzer.ts'

/**
 * Playwright-E2E gegen den echten Produktionsbuild (DESIGN.md — CSP, Service
 * Worker und alles, was `npm run build` erst erzeugt, soll mitgetestet werden).
 *
 * Backend: der lokale Supabase-Stack aus `npx supabase start` (kostenlos, siehe
 * supabase/README.md). Auth: die echte Clerk-Dev-Instanz, aber nur die dafuer
 * angelegten Testpersonen — eine je Browser-Projekt, siehe tests/e2e/nutzer.ts
 * und tests/e2e/README.md.
 *
 * Aufruf ausschliesslich ueber `npm run test:e2e`, das `.env.test` per
 * `node --env-file` laedt. Ein direkter `playwright test`-Aufruf faende weder
 * die Supabase- noch die Clerk-Variablen.
 */

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

  /*
   * Zwei Engines, zwei Viewports, und je Projekt ein eigenes Setup:
   *
   * - **mobile-webkit** — der Hauptfall. Mobile-first PWA (README.md), und auf
   *   iOS gibt es praktisch nur WebKit. `devices['iPhone 13']` bringt
   *   `defaultBrowserType: 'webkit'` schon mit; der Name sagt das jetzt auch.
   *   Achtung: Playwrights WebKit ist nicht Safari — es faengt Engine-
   *   Unterschiede, ersetzt aber keinen Test auf echtem iOS.
   * - **desktop-chromium** — deckt Chrome und Edge ab, wo der Grossteil der
   *   Nutzung und die Windows-Entwicklung sitzt.
   *
   * Jedes Projekt hat sein eigenes Setup, weil jedes seine eigene Testperson
   * anmeldet — die Begruendung fuer die Trennung steht in tests/e2e/nutzer.ts.
   */
  projects: [
    {
      name: 'setup-mobile-webkit',
      testMatch: /auth\.setup\.ts/,
      use: { ...devices['iPhone 13'] },
    },
    {
      name: 'mobile-webkit',
      use: { ...devices['iPhone 13'], storageState: authDatei('mobile-webkit') },
      dependencies: ['setup-mobile-webkit'],
    },
    {
      name: 'setup-desktop-chromium',
      testMatch: /auth\.setup\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'desktop-chromium',
      use: { ...devices['Desktop Chrome'], storageState: authDatei('desktop-chromium') },
      dependencies: ['setup-desktop-chromium'],
    },
  ],
})
