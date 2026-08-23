import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'
import { cspPlugin } from './build/csp.ts'

export default defineConfig(({ mode }) => {
  /*
   * `loadEnv` statt `process.env`: Vite lädt diese Datei, bevor es die
   * `.env`-Dateien liest, und kopiert `VITE_`-Variablen nie nach `process.env`.
   * Ohne den Aufruf bliebe `VITE_CLERK_FRONTEND_API` aus `.env.local`
   * unsichtbar und die CSP ohne den Host — eine Clerk-Produktionsinstanz, die
   * ihr ClerkJS von `clerk.<domain>` ausliefert, wäre blockiert. Erst nach dem
   * Deployen, ohne Warnung beim Bauen.
   */
  const env = loadEnv(mode, process.cwd(), 'VITE_')

  const clerkExtraHosts = (env.VITE_CLERK_FRONTEND_API ?? '')
    .split(',')
    .map((host) => host.trim())
    .filter(Boolean)

  return {
    plugins: [
      react(),
      cspPlugin({ extraHosts: clerkExtraHosts }),
      VitePWA({
        registerType: 'autoUpdate',
        // Der Service Worker soll auch im Dev-Modus laufen, damit sich das
        // Installieren auf einem echten Gerät testen lässt.
        devOptions: { enabled: true, type: 'module' },
        includeAssets: ['favicon.svg', 'apple-touch-icon-180.png'],
        manifest: {
          name: 'LoveNeverDies',
          short_name: 'LoveNeverDies',
          description:
            'Begleitet Angehörige nach einem Todesfall durch die rechtlichen und organisatorischen Aufgaben.',
          lang: 'de',
          dir: 'ltr',
          start_url: '/',
          scope: '/',
          display: 'standalone',
          orientation: 'portrait',
          background_color: '#F7F4EC',
          theme_color: '#35523C',
          icons: [
            { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
            { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
            {
              src: 'icon-maskable-512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'maskable',
            },
          ],
        },
        workbox: {
          globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
          // Der Ciphertext-Cache liegt in IndexedDB (§5), nicht im Service
          // Worker. Hier wird ausschließlich die App-Hülle vorgehalten.
          navigateFallback: 'index.html',
          cleanupOutdatedCaches: true,
        },
      }),
    ],
  }
})
