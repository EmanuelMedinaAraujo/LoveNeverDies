import { describe, expect, it } from 'vitest'
import { buildCsp } from '../../build/csp.ts'
import { buildHeaders } from '../../build/headers.ts'

/**
 * Regeln aus `_headers` lesen: Cloudflare gruppiert unter einem Pfadmuster
 * alle eingerueckten `Name: Wert`-Zeilen, bis die naechste Leerzeile kommt.
 */
function regeln(inhalt: string, muster: string): Record<string, string> {
  const zeilen = inhalt.split('\n')
  const start = zeilen.indexOf(muster)
  expect(start, `Pfadmuster ${muster} fehlt`).toBeGreaterThanOrEqual(0)

  const gefunden: Record<string, string> = {}
  for (const zeile of zeilen.slice(start + 1)) {
    if (!zeile.startsWith('  ')) {
      break
    }
    const trenner = zeile.indexOf(':')
    gefunden[zeile.slice(0, trenner).trim()] = zeile.slice(trenner + 1).trim()
  }
  return gefunden
}

describe('buildHeaders', () => {
  it('traegt dieselbe CSP wie buildCsp, damit Header und Meta-Tag nicht auseinanderlaufen', () => {
    const optionen = { extraHosts: ['https://clerk.example.de'] }

    expect(regeln(buildHeaders(optionen), '/*')['Content-Security-Policy']).toBe(buildCsp(optionen))
  })

  it('traegt die Direktiven, die ein Meta-Tag nicht tragen kann', () => {
    // Der ganze Grund fuer die Datei: `frame-ancestors` und
    // `upgrade-insecure-requests` verwirft der Browser im `<meta http-equiv>`.
    const csp = regeln(buildHeaders(), '/*')['Content-Security-Policy']

    expect(csp).toContain("frame-ancestors 'none'")
    expect(csp).toContain('upgrade-insecure-requests')
    expect(buildCsp({ ziel: 'meta' })).not.toContain('frame-ancestors')
  })

  it('setzt die Sicherheits-Header, auf die sich §11.2 stuetzt', () => {
    const global = regeln(buildHeaders(), '/*')

    expect(global['X-Content-Type-Options']).toBe('nosniff')
    expect(global['X-Frame-Options']).toBe('DENY')
    expect(global['Referrer-Policy']).toBe('strict-origin-when-cross-origin')
    expect(global['Cross-Origin-Resource-Policy']).toBe('same-origin')
    expect(global['Strict-Transport-Security']).toContain('max-age=31536000')
  })

  it('verspricht keine HSTS-Preload-Aufnahme, die auf *.workers.dev niemand einloest', () => {
    expect(regeln(buildHeaders(), '/*')['Strict-Transport-Security']).not.toContain('preload')
  })

  it('haelt Clerks Anmelde-Popup offen', () => {
    // `same-origin` nimmt dem Popup `window.opener` und damit den Rueckweg.
    expect(regeln(buildHeaders(), '/*')['Cross-Origin-Opener-Policy']).toBe(
      'same-origin-allow-popups',
    )
  })

  it('laesst die Kamera zu, weil der Beleg-Upload sie braucht', () => {
    // screens/shared/Dokumente: <input type="file" capture="environment">.
    const policy = regeln(buildHeaders(), '/*')['Permissions-Policy']

    expect(policy).toContain('camera=(self)')
    expect(policy).toContain('geolocation=()')
    expect(policy).toContain('microphone=(self)')
  })

  it('cacht nur die gehashten Assets unverfallbar, nicht die App-Huelle', () => {
    const inhalt = buildHeaders()

    expect(regeln(inhalt, '/assets/*')['Cache-Control']).toBe('public, max-age=31536000, immutable')
    // index.html und sw.js behalten Cloudflares must-revalidate. Stuende hier
    // eine eigene Regel, haenge ein Geraet nach dem Deploy an der alten Huelle.
    expect(inhalt).not.toContain('/index.html')
    expect(inhalt).not.toContain('/sw.js')
  })

  it('bleibt unter Cloudflares Grenze von 2000 Zeichen je Zeile', () => {
    const laengste = Math.max(...buildHeaders().split('\n').map((zeile) => zeile.length))

    expect(laengste).toBeLessThan(2000)
  })
})
