import type { Plugin } from 'vite'

/**
 * Content-Security-Policy (DESIGN.md §11.2).
 *
 * XSS im eigenen Origin entschluesselt alles: `extractable: false` schuetzt
 * davor, dass die Rohbytes eines Schluessels ausgelesen werden, nicht davor,
 * dass fremder Code im selben Origin ihn benutzt. Die Gegenmassnahme ist eine
 * strikte CSP und eine kurze Abhaengigkeitsliste, keine Kryptographie.
 *
 * `script-src` traegt deshalb kein `unsafe-inline` und kein `unsafe-eval`.
 *
 * Eine bewusste Ausnahme steht in `style-src`: Clerks vorgefertigte
 * Anmeldekomponenten injizieren ihre Styles inline. Ein XSS-Vektor ist das
 * nicht im selben Sinn, denn ausfuehrbarer Code entsteht daraus nicht. Es ist
 * aber eine Abweichung von §11.2 und gehoert benannt statt weggeschwiegen. Faellt
 * die Anmeldung irgendwann auf eigenes Markup um, faellt die Ausnahme mit.
 */

/** Clerk laedt ClerkJS von der Frontend-API-Domain der jeweiligen Instanz. */
const CLERK_HOSTS = ['https://*.clerk.accounts.dev', 'https://*.clerk.com']

/** Clerks Bot-Schutz laeuft ueber Cloudflare Turnstile in einem iframe. */
const TURNSTILE = 'https://challenges.cloudflare.com'

const SUPABASE_PLACEHOLDER = 'https://*.supabase.co'

/** ElevenLabs Conversational AI WebSocket und REST Endpunkte */
const ELEVENLABS_HOSTS = ['https://api.elevenlabs.io', 'wss://api.elevenlabs.io']

export type CspOptions = {
  /**
   * Zusaetzliche Hosts, etwa die Frontend-API einer Clerk-Produktionsinstanz
   * (`https://clerk.example.de`), die von den Platzhaltern nicht gedeckt ist.
   */
  extraHosts?: string[]
  /**
   * Der tatsaechlich konfigurierte Supabase-Origin (samt `ws`/`wss`-Pendant),
   * etwa `http://127.0.0.1:54321` fuer den lokalen Stack aus den E2E-Tests.
   * `SUPABASE_PLACEHOLDER` deckt nur `*.supabase.co` ab. Ein selbst gehostetes
   * oder lokales Projekt braeuchte ohne diese Ergaenzung eine eigene CSP-Bypass,
   * um `connect-src` ueberhaupt zu erreichen.
   */
  supabaseHosts?: string[]
  /**
   * Wohin die Direktivenliste geht. `meta` laesst weg, was der Browser in
   * einem `<meta http-equiv>` ohnehin verwirft — `frame-ancestors` und
   * `upgrade-insecure-requests`. Stehen sie trotzdem dort, meldet die Konsole
   * bei jedem Laden einen Fehler, und ein echter Fehler ginge darin unter.
   * Beide traegt stattdessen der Header aus `build/headers.ts`.
   */
  ziel?: 'header' | 'meta'
}

export function buildCsp({
  extraHosts = [],
  supabaseHosts = [],
  ziel = 'header',
}: CspOptions = {}): string {
  const clerk = [...CLERK_HOSTS, ...extraHosts]

  const directives: Record<string, string[]> = {
    'default-src': ["'self'"],
    'base-uri': ["'self'"],
    'object-src': ["'none'"],
    'frame-ancestors': ["'none'"],
    'form-action': ["'self'"],
    'script-src': ["'self'", ...clerk, TURNSTILE],
    // Siehe Kommentar oben: Ausnahme fuer Clerks Komponenten.
    'style-src': ["'self'", "'unsafe-inline'"],
    'img-src': ["'self'", 'data:', 'blob:', 'https://img.clerk.com'],
    'font-src': ["'self'"],
    'connect-src': ["'self'", ...clerk, SUPABASE_PLACEHOLDER, 'wss://*.supabase.co', ...ELEVENLABS_HOSTS, ...supabaseHosts],
    'media-src': ["'self'", 'blob:', 'data:', ...ELEVENLABS_HOSTS],
    'worker-src': ["'self'", 'blob:'],
    'frame-src': ["'self'", ...clerk, TURNSTILE],
    'manifest-src': ["'self'"],
  }

  if (ziel === 'meta') {
    delete directives['frame-ancestors']
  }

  const serialisiert = Object.entries(directives)
    .map(([name, werte]) => `${name} ${werte.join(' ')}`)
    .join('; ')

  if (ziel === 'meta') {
    return serialisiert
  }

  /*
   * `upgrade-insecure-requests` schreibt jede `http:`-Anfrage der Seite auf
   * `https:` um, auch solche, die `connect-src` gerade ausdruecklich erlaubt
   * hat. Ein bewusst unverschluesseltes Supabase (lokaler Stack, selbst
   * gehostet im eigenen Netz) waere damit nicht erreichbar, sondern liefe
   * gegen ein `https:`, das dort gar nicht existiert.
   */
  const hatUnverschluesseltesZiel = [...extraHosts, ...supabaseHosts].some(
    (host) => host.startsWith('http://') || host.startsWith('ws://'),
  )

  return hatUnverschluesseltesZiel ? serialisiert : `${serialisiert}; upgrade-insecure-requests`
}

/**
 * Setzt die CSP nur in den Build. Der Dev-Server von Vite injiziert eigene
 * Inline-Skripte fuer HMR; eine strikte `script-src` wuerde ihn lahmlegen, ohne
 * dass die ausgelieferte Anwendung davon irgendetwas haette.
 *
 * Eingehaengt wird mit `head`, nicht `head-prepend`: Sonst schoebe die
 * Direktivenliste das <meta charset> hinter die 1024 Bytes, in denen der
 * Browser es laut Spezifikation finden muss.
 *
 * Ein `<meta http-equiv>` ist die schwaechere Variante. Browser ignorieren
 * `frame-ancestors` und `upgrade-insecure-requests` an dieser Stelle, deshalb
 * laesst `ziel: 'meta'` beide weg. Getragen werden sie vom echten Header, den
 * `build/headers.ts` als `_headers` fuer Cloudflare erzeugt (§11.2). Das
 * Meta-Tag bleibt daneben stehen, weil es auch dort greift, wo die Datei
 * niemand liest — etwa unter `npm run preview`.
 */
export function cspPlugin(options: CspOptions = {}): Plugin {
  return {
    name: 'loveneverdies-csp',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler() {
        return [
          {
            tag: 'meta',
            attrs: {
              'http-equiv': 'Content-Security-Policy',
              content: buildCsp({ ...options, ziel: 'meta' }),
            },
            injectTo: 'head' as const,
          },
        ]
      },
    },
  }
}
