import { describe, expect, it } from 'vitest'
import { KopplungscodeFehler, supabaseKopplung } from '../../src/core/db/supabaseKopplung'
import { alsHex, fehler, stubClient } from './supabaseAdapter'

/**
 * Der Adapter für `pairing_codes` (DESIGN.md §6, §4).
 *
 * Geprüft wird die Übersetzung: Welche RPC wird mit welchen Argumenten
 * gerufen, was wird aus einer Antwort und was aus einem Fehler. Ob die
 * Funktionen selbst das Richtige tun, steht daneben in `kopplung.test.ts`
 * gegen echtes Postgres.
 */

const GERAET = 'a0000000-0000-4000-8000-000000000001'

const ANGEBOT = {
  status: 'ok',
  purpose: 'join',
  user_id: 'user_anna',
  display_name: 'Anna Müller',
  email: 'anna@example.de',
  device_id: GERAET,
  public_key: alsHex([1, 2, 3]),
  sig_public_key: alsHex([4, 5]),
}

const WRAP = { kemCt: new Uint8Array([1]), wrappedKey: new Uint8Array([2]), signatur: new Uint8Array([3]) }

const ABSCHLUSS = {
  code: 'K4M7QP2X',
  fallId: 'f0000000-0000-4000-8000-000000000002',
  kidFall: 'case_f0000000-0000-4000-8000-000000000002:1',
  kidKatalog: 'cat_f0000000-0000-4000-8000-000000000002',
  absenderId: GERAET,
  wrapFall: WRAP,
  wrapKatalog: WRAP,
}

describe('erzeugeCode (§6)', () => {
  it('ruft die RPC mit Gerät und Zweck', async () => {
    const { client, gesehen } = stubClient({
      data: [{ code: 'K4M7QP2X', expires_at: '2026-08-24T10:15:00Z' }],
      error: null,
    })

    const code = await supabaseKopplung(client).erzeugeCode(GERAET, 'device')

    expect(gesehen.rpc).toBe('erzeuge_kopplungscode')
    expect(gesehen.rpcArgumente).toEqual({ p_geraet: GERAET, p_zweck: 'device' })
    expect(code).toEqual({ code: 'K4M7QP2X', laeuftAbAm: '2026-08-24T10:15:00Z' })
  })

  it('macht aus einem PostgREST-Fehler einen KopplungscodeFehler', async () => {
    const { client } = stubClient({ data: null, error: fehler('permission denied') })

    await expect(supabaseKopplung(client).erzeugeCode(GERAET, 'join')).rejects.toThrow(
      KopplungscodeFehler,
    )
  })

  it('nimmt eine leere Antwort nicht als Code hin', async () => {
    const { client } = stubClient({ data: [], error: null })

    await expect(supabaseKopplung(client).erzeugeCode(GERAET, 'join')).rejects.toThrow(
      /ohne Ergebnis/,
    )
  })
})

describe('loeseEin (§6, §3.6)', () => {
  it('übersetzt ein Angebot samt beider öffentlicher Schlüssel', async () => {
    const { client, gesehen } = stubClient({ data: [ANGEBOT], error: null })

    const ergebnis = await supabaseKopplung(client).loeseEin('K4M7QP2X')

    expect(gesehen.rpc).toBe('loese_kopplungscode_ein')
    expect(gesehen.rpcArgumente).toEqual({ p_code: 'K4M7QP2X' })

    if (ergebnis.status !== 'ok') {
      throw new Error('Diese Antwort war ein Angebot.')
    }

    expect(ergebnis.angebot).toEqual({
      zweck: 'join',
      userId: 'user_anna',
      anzeigename: 'Anna Müller',
      email: 'anna@example.de',
      geraeteId: GERAET,
      pkKem: new Uint8Array([1, 2, 3]),
      pkSig: new Uint8Array([4, 5]),
    })
  })

  it('reicht einen abweisenden Status durch, ohne ihn zu deuten', async () => {
    for (const status of ['gesperrt', 'unbekannt', 'abgelaufen', 'verbraucht', 'selbst', 'fremd']) {
      const { client } = stubClient({ data: [{ status }], error: null })

      expect(await supabaseKopplung(client).loeseEin('K4M7QP2X')).toEqual({ status })
    }
  })

  it('weist ein Angebot ohne Namen ab', async () => {
    // §6 verlangt einen echten Namen, bevor jemand das Familiengeheimnis
    // weitergibt. Ein halb gefülltes Angebot ist deshalb kein halb brauchbares.
    const { client } = stubClient({ data: [{ ...ANGEBOT, display_name: null }], error: null })

    await expect(supabaseKopplung(client).loeseEin('K4M7QP2X')).rejects.toThrow(/unvollständig/)
  })

  it('macht aus einem PostgREST-Fehler einen KopplungscodeFehler', async () => {
    const { client } = stubClient({ data: null, error: fehler('Ohne Anmeldung') })

    await expect(supabaseKopplung(client).loeseEin('K4M7QP2X')).rejects.toThrow(
      KopplungscodeFehler,
    )
  })
})

describe('schliesseAb (§6)', () => {
  it('schickt beide Wraps hex-kodiert an die RPC', async () => {
    const { client, gesehen } = stubClient({ data: null, error: null })

    await supabaseKopplung(client).schliesseAb(ABSCHLUSS)

    expect(gesehen.rpc).toBe('schliesse_kopplung_ab')
    expect(gesehen.rpcArgumente).toEqual({
      p_code: 'K4M7QP2X',
      p_fall_id: ABSCHLUSS.fallId,
      p_kid_fall: ABSCHLUSS.kidFall,
      p_kid_katalog: ABSCHLUSS.kidKatalog,
      p_absender: GERAET,
      p_fall_kem_ct: alsHex([1]),
      p_fall_wrapped_key: alsHex([2]),
      p_fall_signatur: alsHex([3]),
      p_kat_kem_ct: alsHex([1]),
      p_kat_wrapped_key: alsHex([2]),
      p_kat_signatur: alsHex([3]),
    })
  })

  it('macht aus einem PostgREST-Fehler einen KopplungscodeFehler', async () => {
    const { client } = stubClient({ data: null, error: fehler('nicht von Ihnen eingelöst') })

    await expect(supabaseKopplung(client).schliesseAb(ABSCHLUSS)).rejects.toThrow(
      KopplungscodeFehler,
    )
  })
})
