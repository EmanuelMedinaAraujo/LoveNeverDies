import { render, renderHook, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  AuthKontextProvider,
  type AuthKontextWert,
  type AuthZustand,
} from '../../../src/core/auth/authProvider.ts'

/**
 * Der eine Client für die ganze App (DESIGN.md §4, §5).
 *
 * Was hier zählt, ist nicht, was Supabase tut, sondern wann der Provider einen
 * Client anlegt und wann er ihn wegräumt. Beides hat einen Grund, der im
 * Modul selbst als Kommentar steht, und beides ginge ohne Test lautlos kaputt.
 */

const erzeugeSupabaseClient = vi.fn()

vi.mock('../../../src/core/db/supabase.ts', () => ({
  erzeugeSupabaseClient: (...argumente: unknown[]) => erzeugeSupabaseClient(...argumente),
}))

const { SupabaseProvider, useSupabase } = await import(
  '../../../src/core/db/supabaseProvider.tsx'
)

function neuerClient() {
  return { removeAllChannels: vi.fn().mockResolvedValue(undefined) }
}

function authWert(zustand: AuthZustand, zugangstoken = vi.fn()): AuthKontextWert {
  return { zustand, abmelden: vi.fn(), zugangstoken }
}

function huelle(auth: AuthKontextWert) {
  return function Huelle({ children }: { children: ReactNode }) {
    return (
      <AuthKontextProvider value={auth}>
        <SupabaseProvider>{children}</SupabaseProvider>
      </AuthKontextProvider>
    )
  }
}

const ANGEMELDET: AuthZustand = {
  status: 'angemeldet',
  benutzer: { id: 'user_1', anzeigename: 'Anna', email: null },
}

beforeEach(() => {
  erzeugeSupabaseClient.mockReset()
  erzeugeSupabaseClient.mockImplementation(() => neuerClient())
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('useSupabase', () => {
  it('wirft ausserhalb eines Providers', () => {
    const stille = vi.spyOn(console, 'error').mockImplementation(() => {})

    try {
      expect(() => renderHook(() => useSupabase())).toThrow(/ausserhalb eines SupabaseProviders/)
    } finally {
      stille.mockRestore()
    }
  })
})

describe('SupabaseProvider', () => {
  it('legt keinen Client an, solange niemand danach fragt', () => {
    /*
     * Der Grund steht im Modul: Fehlt die Projektkonfiguration, wirft das
     * Anlegen. Ein Wurf beim Rendern des Providers naehme die
     * Anmeldeseite mit, die von Supabase gar nichts braucht.
     */
    render(
      <AuthKontextProvider value={authWert({ status: 'abgemeldet' })}>
        <SupabaseProvider>
          <p>Anmeldung</p>
        </SupabaseProvider>
      </AuthKontextProvider>,
    )

    expect(screen.getByText('Anmeldung')).toBeVisible()
    expect(erzeugeSupabaseClient).not.toHaveBeenCalled()
  })

  it('legt genau einen Client an, egal wie oft gefragt wird', () => {
    // Zwei Clients hielten zwei Realtime-Verbindungen (§5).
    const { result } = renderHook(() => useSupabase(), { wrapper: huelle(authWert(ANGEMELDET)) })

    const ersterZugriff = result.current()
    const zweiterZugriff = result.current()

    expect(ersterZugriff).toBe(zweiterZugriff)
    expect(erzeugeSupabaseClient).toHaveBeenCalledOnce()
  })

  it('fragt das Token ueber eine Referenz ab, nicht ueber die Funktion von damals', async () => {
    /*
     * Clerk gibt bei jeder Erneuerung eine neue Geberfunktion heraus. Haenge
     * der Client daran, entstuende er dauernd neu. Er haengt deshalb an einer
     * Referenz. Die muss auf den *aktuellen* Geber zeigen, sonst fragte
     * er fuer den Rest der Sitzung ein abgelaufenes Token ab.
     */
    const alterGeber = vi.fn().mockResolvedValue('altes-token')
    const neuerGeber = vi.fn().mockResolvedValue('neues-token')

    const { rerender } = renderHook(() => useSupabase(), {
      wrapper: huelle(authWert(ANGEMELDET, alterGeber)),
    })

    // Erst nach dem Zugriff existiert der Client samt seinem Token-Rueckruf.
    const { result } = renderHook(() => useSupabase(), {
      wrapper: huelle(authWert(ANGEMELDET, neuerGeber)),
    })
    result.current()

    const uebergeberRueckruf = erzeugeSupabaseClient.mock.calls.at(-1)?.[0] as () => Promise<
      string | null
    >

    await expect(uebergeberRueckruf()).resolves.toBe('neues-token')
    rerender()
  })

  it('raeumt den Client beim Benutzerwechsel weg', () => {
    /*
     * Die Kanaele des alten Clients haengen an den Zeilen, die der vorigen
     * Person sichtbar waren. Bliebe er stehen, laese die naechste Person durch
     * die Abonnements der vorigen.
     */
    const ersterClient = neuerClient()
    const zweiterClient = neuerClient()
    erzeugeSupabaseClient
      .mockImplementationOnce(() => ersterClient)
      .mockImplementationOnce(() => zweiterClient)

    const { result, rerender } = renderHook(() => useSupabase(), {
      wrapper: huelle(authWert(ANGEMELDET)),
    })
    expect(result.current()).toBe(ersterClient)

    // Dieselbe Komponente, andere Person.
    const { result: zweitesErgebnis } = renderHook(() => useSupabase(), {
      wrapper: huelle(
        authWert({
          status: 'angemeldet',
          benutzer: { id: 'user_2', anzeigename: 'Bernd', email: null },
        }),
      ),
    })

    expect(zweitesErgebnis.current()).toBe(zweiterClient)
    rerender()
  })

  it('schliesst die Kanaele des Clients beim Abbau', () => {
    const client = neuerClient()
    erzeugeSupabaseClient.mockImplementation(() => client)

    const { result, unmount } = renderHook(() => useSupabase(), {
      wrapper: huelle(authWert(ANGEMELDET)),
    })
    result.current()

    unmount()

    expect(client.removeAllChannels).toHaveBeenCalled()
  })
})
