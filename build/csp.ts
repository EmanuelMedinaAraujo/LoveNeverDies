import type { Plugin } from 'vite'

/**
 * Content-Security-Policy (DESIGN.md §11.2).
 *
 * HINWEIS: Temporärer Notfall-Fix für ElevenLabs Conversational AI, Web Audio & iOS-Kompatibilität.
 * Funktion > Sicherheit: blob:, data:, wss:, media-src und Worklets sind freigegeben, damit
 * der Sprachassistent auf Safari & Brave ohne Blockaden starten und sprechen kann.
 */

/** Clerk laedt ClerkJS von der Frontend-API-Domain der jeweiligen Instanz. */
const CLERK_HOSTS = ['https://*.clerk.accounts.dev', 'https://*.clerk.com']

/** Clerks Bot-Schutz laeuft ueber Cloudflare Turnstile in einem iframe. */
const TURNSTILE = 'https://challenges.cloudflare.com'

const SUPABASE_PLACEHOLDER = 'https://*.supabase.co'

/** ElevenLabs Conversational AI WebSocket und REST Endpunkte */
const ELEVENLABS_HOSTS = ['https://api.elevenlabs.io', 'wss://api.elevenlabs.io', 'https://*.elevenlabs.io', 'wss://*.elevenlabs.io']

export type CspOptions = {
  /**
   * Zusaetzliche Hosts, etwa die Frontend-API einer Clerk-Produktionsinstanz
   * (`https://clerk.example.de`), die von den Platzhaltern nicht gedeckt ist.
   */
  extraHosts?: string[]
  /**
   * Der tatsaechlich konfigurierte Supabase-Origin (samt `ws`/`wss`-Pendant),
   * etwa `http://127.0.0.1:54321` fuer den lokalen Stack aus den E2E-Tests.
   */
  supabaseHosts?: string[]
  /**
   * Wohin die Direktivenliste geht. `meta` laesst weg, was der Browser in
   * einem `<meta http-equiv>` ohnehin verwirft.
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
    'default-src': ["'self'", 'blob:', 'data:', 'https:'],
    'base-uri': ["'self'"],
    'object-src': ["'none'"],
    'frame-ancestors': ["'none'"],
    'form-action': ["'self'"],
    'script-src': ["'self'", "'unsafe-inline'", "'unsafe-eval'", 'blob:', 'data:', ...clerk, TURNSTILE, 'https://*.elevenlabs.io'],
    'style-src': ["'self'", "'unsafe-inline'"],
    'img-src': ["'self'", 'data:', 'blob:', 'https://img.clerk.com', 'https://*.elevenlabs.io'],
    'font-src': ["'self'", 'data:'],
    'media-src': ["'self'", 'blob:', 'data:', 'mediastream:', 'https:', ...ELEVENLABS_HOSTS],
    'connect-src': ["'self'", 'blob:', 'data:', 'wss:', 'https:', 'http:', 'ws:', ...clerk, SUPABASE_PLACEHOLDER, 'wss://*.supabase.co', ...ELEVENLABS_HOSTS, ...supabaseHosts],
    'worker-src': ["'self'", 'blob:', 'data:'],
    'frame-src': ["'self'", 'blob:', 'data:', ...clerk, TURNSTILE],
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

  const hatUnverschluesseltesZiel = [...extraHosts, ...supabaseHosts].some(
    (host) => host.startsWith('http://') || host.startsWith('ws://'),
  )

  return hatUnverschluesseltesZiel ? serialisiert : `${serialisiert}; upgrade-insecure-requests`
}

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

