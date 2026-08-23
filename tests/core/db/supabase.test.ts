import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Der Supabase-Client (DESIGN.md §1, §4).
 *
 * Die beiden Werte werden beim Laden des Moduls gelesen. Deshalb steht hier
 * `vi.resetModules()` samt dynamischem Import: Ein einmal geladenes Modul
 * behielte die Umgebung, unter der es zuerst geladen wurde, und die Tests
 * liefen gegen den Zustand des jeweils ersten.
 */

const createClient = vi.fn()

vi.mock('@supabase/supabase-js', () => ({
  createClient: (...argumente: unknown[]) => createClient(...argumente),
}))

async function ladeModul() {
  vi.resetModules()
  return import('../../../src/core/db/supabase.ts')
}

beforeEach(() => {
  createClient.mockReset()
  createClient.mockReturnValue({ derClient: true })
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('erzeugeSupabaseClient', () => {
  it('nennt die fehlende Konfiguration beim Namen', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', '')
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', '')

    const { erzeugeSupabaseClient } = await ladeModul()

    expect(() => erzeugeSupabaseClient(async () => null)).toThrow(
      /VITE_SUPABASE_URL oder VITE_SUPABASE_ANON_KEY fehlt/,
    )
  })

  it('wirft auch, wenn nur der Schluessel fehlt', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', 'http://127.0.0.1:54321')
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', '')

    const { erzeugeSupabaseClient } = await ladeModul()

    expect(() => erzeugeSupabaseClient(async () => null)).toThrow()
  })

  it('legt den Client mit URL, Anon-Key und dem Tokengeber an', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', 'http://127.0.0.1:54321')
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'anon-key')

    const { erzeugeSupabaseClient } = await ladeModul()
    const zugangstoken = vi.fn().mockResolvedValue('token')

    erzeugeSupabaseClient(zugangstoken)

    const [url, schluessel, optionen] = createClient.mock.calls[0] as [
      string,
      string,
      { accessToken: unknown; auth: Record<string, boolean> },
    ]

    expect(url).toBe('http://127.0.0.1:54321')
    expect(schluessel).toBe('anon-key')
    expect(optionen.accessToken).toBe(zugangstoken)
  })

  it('fuehrt keine eigene Sitzung neben Clerk', async () => {
    /*
     * Zwei Sitzungen waeren zwei Wahrheiten darueber, wer angemeldet ist, und
     * sie liefen beim Abmelden auseinander. Die Sitzung fuehrt Clerk (§1).
     */
    vi.stubEnv('VITE_SUPABASE_URL', 'http://127.0.0.1:54321')
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'anon-key')

    const { erzeugeSupabaseClient } = await ladeModul()
    erzeugeSupabaseClient(async () => null)

    const [, , optionen] = createClient.mock.calls[0] as [
      string,
      string,
      { auth: Record<string, boolean> },
    ]

    expect(optionen.auth).toEqual({
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    })
  })
})
