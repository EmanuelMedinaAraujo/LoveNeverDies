import type { SupabaseClient } from '@supabase/supabase-js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { POLLING_ABSTAND_MS, freigabeklingel, tuerklingel } from '../../src/core/sync/realtime'

/**
 * Nahtstelle: die Türklingel (DESIGN.md §5).
 *
 * §5, Schritt 3: "Realtime-Subscription auf die `cases`-Zeile. Als Fallback
 * Polling bei Fokus und alle 30 Sekunden, nur falls die Subscription nicht
 * verfügbar ist oder fehlgeschlagen ist."
 *
 * Das "nur" ist die eigentliche Zusage. Ein Fallback, der immer mitläuft, wäre
 * kein Fallback, sondern Polling mit einer Subscription obendrauf: auf einem
 * Telefon im Zug zwei Verbindungen für dieselbe Nachricht.
 *
 * Getestet wird gegen ein Kanaldoppel und nicht gegen einen echten Server: Ob
 * Supabase Realtime funktioniert, ist nicht die Frage. Die Frage ist, was diese
 * App aus `SUBSCRIBED`, `CHANNEL_ERROR` und `TIMED_OUT` macht.
 */

type Rueckruf = (nutzlast: unknown) => void
type Statusruf = (status: string, fehler?: Error) => void

function clientDoppel() {
  const gesehen: { kanal?: string; optionen?: unknown; entfernt: number } = { entfernt: 0 }

  let aufAenderung: Rueckruf | null = null
  let melde: Statusruf | null = null

  const kanal = {
    on(_ereignis: string, optionen: unknown, rueckruf: Rueckruf) {
      gesehen.optionen = optionen
      aufAenderung = rueckruf
      return kanal
    },
    subscribe(statusruf: Statusruf) {
      melde = statusruf
      return kanal
    },
  }

  const client = {
    channel(name: string) {
      gesehen.kanal = name
      return kanal
    },
    removeChannel: vi.fn(() => {
      gesehen.entfernt += 1
      return Promise.resolve('ok')
    }),
  } as unknown as SupabaseClient

  return {
    client,
    gesehen,
    /** Der Server meldet eine Änderung an der `cases`-Zeile. */
    aendereZeile: () => aufAenderung?.({}),
    meldeStatus: (status: string) => melde?.(status),
  }
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('tuerklingel', () => {
  it('abonniert genau die eine cases-Zeile', async () => {
    // Nicht die Tabelle, nicht `items`: eine Zeile. Der Trigger aus §4 hebt
    // `cases.version` bei jeder Inhaltsänderung des Falls mit, und mehr muss
    // die Klingel nicht wissen.
    const { client, gesehen } = clientDoppel()

    tuerklingel(client, 'fall-1', vi.fn())

    expect(gesehen.optionen).toEqual({
      event: 'UPDATE',
      schema: 'public',
      table: 'cases',
      filter: 'id=eq.fall-1',
    })
  })

  it('läutet, wenn sich die Zeile ändert', () => {
    const { client, aendereZeile, meldeStatus } = clientDoppel()
    const laeute = vi.fn()

    tuerklingel(client, 'fall-1', laeute)
    meldeStatus('SUBSCRIBED')
    aendereZeile()

    expect(laeute).toHaveBeenCalledTimes(1)
  })

  it('pollt nicht, solange die Subscription steht', () => {
    const { client, meldeStatus } = clientDoppel()
    const laeute = vi.fn()

    tuerklingel(client, 'fall-1', laeute)
    meldeStatus('SUBSCRIBED')

    vi.advanceTimersByTime(POLLING_ABSTAND_MS * 3)
    window.dispatchEvent(new Event('focus'))

    expect(laeute).not.toHaveBeenCalled()
  })

  it('pollt, sobald die Subscription fehlgeschlagen ist', () => {
    const { client, meldeStatus } = clientDoppel()
    const laeute = vi.fn()

    tuerklingel(client, 'fall-1', laeute)
    meldeStatus('CHANNEL_ERROR')

    vi.advanceTimersByTime(POLLING_ABSTAND_MS)

    expect(laeute).toHaveBeenCalledTimes(1)
  })

  it('pollt nach einem Timeout', () => {
    const { client, meldeStatus } = clientDoppel()
    const laeute = vi.fn()

    tuerklingel(client, 'fall-1', laeute)
    meldeStatus('TIMED_OUT')

    vi.advanceTimersByTime(POLLING_ABSTAND_MS)

    expect(laeute).toHaveBeenCalledTimes(1)
  })

  it('pollt bei Fokus, wenn die Subscription fehlgeschlagen ist', () => {
    // Der wichtigere der beiden Fallback-Auslöser: Wer sein Telefon wieder in
    // die Hand nimmt, will den Stand sofort sehen und nicht in bis zu 30
    // Sekunden.
    const { client, meldeStatus } = clientDoppel()
    const laeute = vi.fn()

    tuerklingel(client, 'fall-1', laeute)
    meldeStatus('CHANNEL_ERROR')

    window.dispatchEvent(new Event('focus'))

    expect(laeute).toHaveBeenCalledTimes(1)
  })

  it('hört wieder auf zu pollen, wenn die Subscription doch noch steht', () => {
    // Realtime verbindet sich von selbst neu. Bliebe das Polling danach
    // stehen, liefe es für den Rest der Sitzung neben einer funktionierenden
    // Subscription her.
    const { client, meldeStatus } = clientDoppel()
    const laeute = vi.fn()

    tuerklingel(client, 'fall-1', laeute)
    meldeStatus('CHANNEL_ERROR')
    vi.advanceTimersByTime(POLLING_ABSTAND_MS)
    expect(laeute).toHaveBeenCalledTimes(1)

    meldeStatus('SUBSCRIBED')
    vi.advanceTimersByTime(POLLING_ABSTAND_MS * 3)

    expect(laeute).toHaveBeenCalledTimes(1)
  })

  it('pollt, wenn es gar keine Subscription gibt', () => {
    // "nicht verfügbar" aus §5: Der Client kann keinen Kanal aufmachen. Ohne
    // diesen Zweig bliebe die App stumm, ohne dass irgendwo etwas fehlschlägt.
    const client = {
      channel: () => {
        throw new Error('Realtime ist nicht verfügbar.')
      },
      removeChannel: vi.fn(),
    } as unknown as SupabaseClient

    const laeute = vi.fn()
    tuerklingel(client, 'fall-1', laeute)

    vi.advanceTimersByTime(POLLING_ABSTAND_MS)

    expect(laeute).toHaveBeenCalledTimes(1)
  })

  it('räumt Kanal, Takt und Fokus wieder ab', () => {
    const { client, gesehen, meldeStatus } = clientDoppel()
    const laeute = vi.fn()

    const schliesse = tuerklingel(client, 'fall-1', laeute)
    meldeStatus('CHANNEL_ERROR')
    schliesse()

    vi.advanceTimersByTime(POLLING_ABSTAND_MS * 3)
    window.dispatchEvent(new Event('focus'))

    expect(laeute).not.toHaveBeenCalled()
    expect(gesehen.entfernt).toBe(1)
  })

  it('läutet nach dem Abräumen auch dann nicht, wenn der Kanal noch feuert', () => {
    // Der Kanal wird asynchron entfernt; ein Ereignis, das schon unterwegs war,
    // kann danach noch ankommen. Es darf keinen Zustand mehr anfassen, der zu
    // einem abgeräumten Screen gehört.
    const { client, aendereZeile, meldeStatus } = clientDoppel()
    const laeute = vi.fn()

    const schliesse = tuerklingel(client, 'fall-1', laeute)
    meldeStatus('SUBSCRIBED')
    schliesse()
    aendereZeile()

    expect(laeute).not.toHaveBeenCalled()
  })
})

/**
 * Die zweite Klingel: die Freigaben eines Vorsorgefalls (DESIGN.md §3.5).
 *
 * Es gibt sie, weil `vault_releases` neben `items` steht und nicht am
 * Delta-Sync haengt: Eine Freigabe hebt `cases.version` nicht, die Tuerklingel
 * schweigt also. Wer im Tab Erbe auf den Zaehler schaut, waehrend eine andere
 * Person auf ihrem Telefon bestaetigt, saehe ohne sie gar nichts -- bis er den
 * Tab verlaesst und zurueckkommt.
 */
describe('freigabeklingel', () => {
  it('abonniert die Freigaben genau dieses Falls', () => {
    const { client, gesehen } = clientDoppel()

    freigabeklingel(client, 'fall-1', vi.fn())

    expect(gesehen.kanal).toBe('freigaben:fall-1')
    expect(gesehen.optionen).toEqual({
      // `*` und nicht nur `INSERT`: Eine Freigabe ist ersetzbar (§3.5, ein
      // unbrauchbarer Anteil), und die zweite Fassung kommt als `UPDATE`.
      event: '*',
      schema: 'public',
      table: 'vault_releases',
      filter: 'case_id=eq.fall-1',
    })
  })

  it('laeutet, wenn eine Freigabe hereinkommt', () => {
    const { client, aendereZeile, meldeStatus } = clientDoppel()
    const laeute = vi.fn()

    freigabeklingel(client, 'fall-1', laeute)
    meldeStatus('SUBSCRIBED')
    aendereZeile()

    expect(laeute).toHaveBeenCalledTimes(1)
  })

  it('faellt auf Polling zurueck wie die Tuerklingel', () => {
    // Dieselbe Zusage aus §5, und deshalb derselbe Weg: Fokus und alle 30
    // Sekunden, aber nur, wenn die Subscription nicht traegt.
    const { client, meldeStatus } = clientDoppel()
    const laeute = vi.fn()

    freigabeklingel(client, 'fall-1', laeute)
    meldeStatus('CHANNEL_ERROR')
    vi.advanceTimersByTime(POLLING_ABSTAND_MS)

    expect(laeute).toHaveBeenCalledTimes(1)
  })

  it('raeumt ihren Kanal wieder ab', () => {
    const { client, gesehen } = clientDoppel()

    freigabeklingel(client, 'fall-1', vi.fn())()

    expect(gesehen.entfernt).toBe(1)
  })
})
