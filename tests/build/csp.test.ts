import { describe, expect, it } from 'vitest'
import { buildCsp } from '../../build/csp.ts'

describe('buildCsp', () => {
  it('erlaubt standardmaessig nur die eigene Herkunft und die bekannten Platzhalter', () => {
    const csp = buildCsp()

    expect(csp).toContain("default-src 'self'")
    expect(csp).toContain('https://*.supabase.co')
    expect(csp).toContain('wss://*.supabase.co')
    expect(csp).toContain('upgrade-insecure-requests')
  })

  it('nimmt zusaetzliche Clerk-Hosts in script-src, connect-src und frame-src auf', () => {
    const csp = buildCsp({ extraHosts: ['https://clerk.example.de'] })

    for (const directive of ['script-src', 'connect-src', 'frame-src']) {
      const werte = csp.split('; ').find((teil) => teil.startsWith(directive))
      expect(werte).toContain('https://clerk.example.de')
    }
  })

  it('nimmt den konfigurierten Supabase-Origin in connect-src auf', () => {
    const csp = buildCsp({ supabaseHosts: ['http://127.0.0.1:54321', 'ws://127.0.0.1:54321'] })

    const connectSrc = csp.split('; ').find((teil) => teil.startsWith('connect-src'))
    expect(connectSrc).toContain('http://127.0.0.1:54321')
    expect(connectSrc).toContain('ws://127.0.0.1:54321')
  })

  it('laesst upgrade-insecure-requests weg, sobald ein Ziel bewusst unverschluesselt ist', () => {
    // Sonst schriebe die Direktive genau die http-Anfrage auf https um, die
    // `connect-src` gerade erst erlaubt hat, gegen ein https, das dort nicht
    // existiert (vite.config.ts, lokaler Supabase-Stack).
    const csp = buildCsp({ supabaseHosts: ['http://127.0.0.1:54321', 'ws://127.0.0.1:54321'] })

    expect(csp).not.toContain('upgrade-insecure-requests')
  })

  it('behaelt upgrade-insecure-requests, wenn alle zusaetzlichen Hosts https sind', () => {
    const csp = buildCsp({
      extraHosts: ['https://clerk.example.de'],
      supabaseHosts: ['https://eigenes-projekt.example.de'],
    })

    expect(csp).toContain('upgrade-insecure-requests')
  })
})
