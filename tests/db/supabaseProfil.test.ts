import { describe, expect, it } from 'vitest'
import { ProfilFehler, supabaseProfil } from '../../src/core/db/supabaseProfil'
import { fehler, stubClient } from './supabaseAdapter'

/**
 * Der Adapter für `profiles` (DESIGN.md §3.3, §4).
 *
 * Ein `upsert` und die Frage, was aus einem Fehler wird. Wer welches Profil
 * sehen darf, steht daneben in `profile.test.ts` gegen echtes Postgres.
 */

const ANGABEN = { userId: 'user_anna', anzeigename: 'Anna Müller', email: 'anna@example.de' }

describe('speichere (§3.3)', () => {
  it('schreibt Name und E-Mail in die eigene Zeile', async () => {
    const { client, gesehen } = stubClient({ data: null, error: null })

    await supabaseProfil(client).speichere(ANGABEN)

    expect(gesehen.tabelle).toBe('profiles')
    expect(gesehen.hochgeladen?.werte).toMatchObject({
      user_id: 'user_anna',
      display_name: 'Anna Müller',
      email: 'anna@example.de',
    })
    // Ohne `onConflict` legte der zweite Start eine zweite Zeile an — und der
    // Primärschlüssel wiese sie ab, bei jeder Anmeldung aufs Neue.
    expect(gesehen.hochgeladen?.optionen).toEqual({ onConflict: 'user_id' })
  })

  it('nimmt ein Profil ohne E-Mail an', async () => {
    const { client, gesehen } = stubClient({ data: null, error: null })

    await supabaseProfil(client).speichere({ ...ANGABEN, email: null })

    expect(gesehen.hochgeladen?.werte).toMatchObject({ email: null })
  })

  it('macht aus einem PostgREST-Fehler einen ProfilFehler', async () => {
    const { client } = stubClient({ data: null, error: fehler('permission denied') })

    await expect(supabaseProfil(client).speichere(ANGABEN)).rejects.toThrow(ProfilFehler)
  })
})
