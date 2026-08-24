/**
 * Die Edge Function `vault-release` (DESIGN.md §3.5, §9).
 *
 * Die einzige Edge Function mit Service-Role, die eine Zeile schreibt, die
 * kein Client schreiben darf: `vault_releases` ist für jedes Mitglied lesbar
 * und für niemanden schreibbar (§4). Der Grund steht in §3.5: Der
 * Primärschlüssel `(case_id, user_id)` setzt durch, dass Personen gezählt
 * werden und nicht Geräte, und das trägt nur, wenn niemand daran vorbei
 * einfügen kann.
 *
 * Hier steht ausschliesslich die Verdrahtung: Token, Datenbank, HTTP.
 * Entschieden wird in `freigabe.ts`, und dort ist es geprüft (§10).
 *
 * Die `user_id` kommt aus dem Token, nie aus dem Body. Geprüft wird es von
 * PostgREST: Die Function ruft `angemeldete_kennung()` mit dem Token des
 * Aufrufers auf und bekommt den `sub`, den auch jede Policy dieses Projekts
 * sieht. Ein zweiter Prüfweg daneben mit eigenen JWKS, eigener Uhr und eigenen
 * Fehlerfällen böte nur eine zweite Gelegenheit, sich zu irren.
 *
 * Ausgeliefert wird sie deshalb ohne die eingebaute JWT-Prüfung des
 * Gateways: Die Anmeldung kommt von Clerk (§1), und geprüft wird sie hier
 * ausdrücklich selbst.
 *
 *     supabase functions deploy vault-release --no-verify-jwt
 */

import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2'
import { alsBytea, ausBytea } from '../../../src/core/db/bytea.ts'
import {
  FreigabeFehler,
  leseFreigabeanfrage,
  nimmFreigabeAn,
  type Freigabezugang,
} from './freigabe.ts'

/**
 * Der `sub` aus dem geprüften Token, oder `null`.
 *
 * Der Client trägt seine Anmeldung im `Authorization`-Kopf; dieser Aufruf
 * reicht ihn unverändert an PostgREST weiter. Kommt eine Kennung zurück, hat
 * die Plattform das Token gegen den Anbieter geprüft. Kommt keine, ist es
 * ungültig, abgelaufen oder gar nicht da.
 */
async function angemeldeteKennung(url: string, anonKey: string, autorisierung: string) {
  const client = createClient(url, anonKey, {
    global: { headers: { Authorization: autorisierung } },
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const { data, error } = await client.rpc('angemeldete_kennung')

  return error !== null || typeof data !== 'string' || data === '' ? null : data
}

/** Der Zugang mit Service-Role: `vault_releases` gibt es auf keinem anderen Weg. */
export function supabaseZugang(client: SupabaseClient): Freigabezugang {
  return {
    async geraet(deviceId) {
      const { data, error } = await client
        .from('device_keys')
        .select('user_id, sig_public_key')
        .eq('id', deviceId)
        .maybeSingle()

      if (error !== null || data === null) {
        return null
      }

      return { userId: data.user_id as string, pkSig: ausBytea(data.sig_public_key) }
    },

    async istMitglied(caseId, userId) {
      const { data, error } = await client
        .from('memberships')
        .select('user_id')
        .eq('case_id', caseId)
        .eq('user_id', userId)
        .maybeSingle()

      return error === null && data !== null
    },

    async schreibe(freigabe) {
      // `do update`, nicht `do nothing` (§3.5): Ein einziger kaputter Share
      // machte den Tresor sonst endgültig unöffenbar. Ersetzen ist
      // ungefährlich, denn jede neue Zeile ist durch dieselbe Signaturprüfung
      // gegangen und gezählt werden Personen, keine Versuche.
      const { error } = await client.from('vault_releases').upsert(
        {
          case_id: freigabe.caseId,
          user_id: freigabe.userId,
          signed_by_device: freigabe.geraeteId,
          kid: freigabe.kid,
          released_share: alsBytea(freigabe.releasedShare),
          signature: alsBytea(freigabe.signatur),
          released_at: new Date().toISOString(),
        },
        { onConflict: 'case_id,user_id' },
      )

      if (error !== null) {
        throw new Error(`Die Freigabe war nicht einzutragen: ${error.message}`)
      }
    },
  }
}

Deno.serve(async (anfrage: Request) => {
  if (anfrage.method !== 'POST') {
    return Response.json({ fehler: 'Nur POST.' }, { status: 405 })
  }

  const url = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

  if (url === undefined || anonKey === undefined || serviceKey === undefined) {
    return Response.json({ fehler: 'Die Zugangsdaten der Funktion fehlen.' }, { status: 500 })
  }

  const autorisierung = anfrage.headers.get('Authorization')

  if (autorisierung === null) {
    return Response.json({ fehler: 'Ohne Anmeldung wird nichts freigegeben.' }, { status: 401 })
  }

  const userId = await angemeldeteKennung(url, anonKey, autorisierung)

  if (userId === null) {
    return Response.json({ fehler: 'Die Anmeldung war nicht zu prüfen.' }, { status: 401 })
  }

  try {
    const gelesen = leseFreigabeanfrage(await anfrage.json())
    const { status, koerper } = await nimmFreigabeAn(
      gelesen,
      userId,
      supabaseZugang(createClient(url, serviceKey, { auth: { persistSession: false } })),
    )

    return Response.json(koerper, { status })
  } catch (ursache) {
    if (ursache instanceof FreigabeFehler) {
      return Response.json({ fehler: ursache.message }, { status: 400 })
    }

    return Response.json(
      { fehler: ursache instanceof Error ? ursache.message : String(ursache) },
      { status: 500 },
    )
  }
})
