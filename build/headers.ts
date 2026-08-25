import type { Plugin } from 'vite'
import { buildCsp, type CspOptions } from './csp.ts'

/**
 * Sicherheits-Header als echte HTTP-Header (DESIGN.md §11.2).
 *
 * `build/csp.ts` setzt die CSP als `<meta http-equiv>`. Das ist die schwaechere
 * Variante: Browser ignorieren `frame-ancestors` und
 * `upgrade-insecure-requests` an dieser Stelle, und ein Angreifer, der das
 * erste Byte des Dokuments kontrolliert, kontrolliert auch das Meta-Tag. Ein
 * Header laesst sich aus dem Dokument heraus nicht aendern.
 *
 * Cloudflare Workers mit statischen Assets liest eine Datei `_headers` aus dem
 * Asset-Verzeichnis und macht daraus Response-Header. Sie wird nicht selbst
 * ausgeliefert. Erzeugt wird sie hier, damit CSP-Header und CSP-Meta aus
 * derselben Quelle fallen und nicht auseinanderlaufen koennen.
 *
 * Grenze: 100 Regeln, 2000 Zeichen je Zeile.
 */

/*
 * `same-origin` waere strenger, bricht aber Clerks OAuth-Popup: Das Popup
 * braucht `window.opener`, um das Ergebnis zurueckzureichen. `-allow-popups`
 * behaelt die Trennung fuer alles, was uns einbettet, und laesst nur die von
 * uns selbst geoeffneten Fenster durch.
 */
const COOP = 'same-origin-allow-popups'

/*
 * Kein `Cross-Origin-Embedder-Policy`: `require-corp` verlangt von jeder
 * eingebetteten Ressource ein CORP-Bekenntnis, und weder Clerks Frontend-API
 * noch Turnstile liefern eines. Die Anmeldung waere tot. COEP kaeme erst in
 * Frage, wenn §11.2 einmal ohne fremde iframes auskommt.
 */

/*
 * Nur verweigern, was die App nicht benutzt. `camera` bleibt offen: Hinter dem
 * Beleg-Upload in `screens/shared/Dokumente` steht ein
 * `<input type="file" capture="environment">`, das auf dem Telefon die Kamera
 * oeffnet. `publickey-credentials-get` bleibt offen, damit Clerk Passkeys
 * anbieten kann.
 */
const PERMISSIONS_POLICY = [
  'accelerometer=()',
  'autoplay=()',
  'browsing-topics=()',
  'camera=(self)',
  'display-capture=()',
  'encrypted-media=()',
  'geolocation=()',
  'gyroscope=()',
  'hid=()',
  'idle-detection=()',
  'local-fonts=()',
  'magnetometer=()',
  'microphone=()',
  'midi=()',
  'payment=()',
  'picture-in-picture=()',
  'publickey-credentials-get=(self)',
  'screen-wake-lock=()',
  'serial=()',
  'usb=()',
  'xr-spatial-tracking=()',
].join(', ')

export function buildHeaders(options: CspOptions = {}): string {
  const global: Record<string, string> = {
    'Content-Security-Policy': buildCsp(options),
    /*
     * Ohne `preload`. Die Direktive ist ein Versprechen an die Preload-Liste
     * der Browser, und eingetragen wird dort nur, wer eine eigene Domain
     * anmeldet. Auf `*.workers.dev` waere sie eine Behauptung ohne Deckung.
     */
    'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
    'X-Content-Type-Options': 'nosniff',
    // Deckungsgleich mit `frame-ancestors 'none'`, fuer aeltere Browser.
    'X-Frame-Options': 'DENY',
    /*
     * Die Pfade tragen Fall-IDs. Cross-Origin darf davon nur der Origin
     * sichtbar werden, nie der Pfad.
     */
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Cross-Origin-Opener-Policy': COOP,
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Permissions-Policy': PERMISSIONS_POLICY,
  }

  const zeilen = [
    '# Erzeugt von build/headers.ts. Nicht von Hand bearbeiten.',
    '',
    '/*',
    ...Object.entries(global).map(([name, wert]) => `  ${name}: ${wert}`),
    '',
    /*
     * Die Dateinamen unter /assets/ tragen einen Inhalts-Hash; aendert sich der
     * Inhalt, aendert sich der Name. Alles andere - index.html, sw.js - behaelt
     * Cloudflares Vorgabe (`max-age=0, must-revalidate`), sonst haenge ein
     * Geraet nach einem Deploy an einer alten App-Huelle fest.
     */
    '/assets/*',
    '  Cache-Control: public, max-age=31536000, immutable',
    '',
  ]

  return zeilen.join('\n')
}

export function headersPlugin(options: CspOptions = {}): Plugin {
  return {
    name: 'loveneverdies-headers',
    apply: 'build',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: '_headers', source: buildHeaders(options) })
    },
  }
}
