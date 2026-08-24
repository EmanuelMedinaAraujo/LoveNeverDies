/**
 * Implementierung von TresorTabelle über Supabase (DESIGN.md §3.5, §4).
 */

import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js'
import { alsBytea, ausBytea } from './bytea'
import type {
  NeueFreigabe,
  ResplitShareInput,
  TresorTabelle,
  VaultKeyWrapZeile,
  VaultReleaseZeile,
  VaultShareZeile,
} from './tresor'

const TABELLE_WRAPS = 'vault_key_wraps'
const SPALTEN_WRAPS = 'case_id, device_id, kem_ct, wrapped_key'

type RohWrapZeile = {
  case_id: string
  device_id: string
  kem_ct: unknown
  wrapped_key: unknown
}

const TABELLE_SHARES = 'vault_shares'
const SPALTEN_SHARES = 'case_id, user_id, device_id, share_index, share_hash, kem_ct, wrapped_share'

type RohShareZeile = {
  case_id: string
  user_id: string
  device_id: string
  share_index: number
  share_hash: unknown
  kem_ct: unknown
  wrapped_share: unknown
}

const TABELLE_FREIGABEN = 'vault_releases'
const SPALTEN_FREIGABEN =
  'case_id, user_id, signed_by_device, kid, released_share, signature, released_at'

/** Der Name der Edge Function aus §9. */
const FUNKTION_FREIGABE = 'vault-release'

type RohFreigabeZeile = {
  case_id: string
  user_id: string
  signed_by_device: string
  kid: string
  released_share: unknown
  signature: unknown
  released_at: string
}

export class TresorFehler extends Error {
  constructor(was: string, ursache?: PostgrestError) {
    super(ursache === undefined ? was : `${was}: ${ursache.message}`)
    this.name = 'TresorFehler'
    this.cause = ursache
  }
}

function alsWrapZeile(roh: RohWrapZeile): VaultKeyWrapZeile {
  return {
    fallId: roh.case_id,
    geraeteId: roh.device_id,
    kemCt: ausBytea(roh.kem_ct),
    wrappedKey: ausBytea(roh.wrapped_key),
  }
}

function alsShareZeile(roh: RohShareZeile): VaultShareZeile {
  return {
    fallId: roh.case_id,
    userId: roh.user_id,
    geraeteId: roh.device_id,
    shareIndex: roh.share_index,
    shareHash: ausBytea(roh.share_hash),
    kemCt: ausBytea(roh.kem_ct),
    wrappedShare: ausBytea(roh.wrapped_share),
  }
}

/**
 * Der Grund, den die Edge Function genannt hat.
 *
 * `functions.invoke` meldet bei jedem Nicht-2xx dasselbe ("non-2xx status
 * code") und legt die Antwort selbst nach `context`. Der Satz, der die Person
 * vor dem Bildschirm etwas angeht, etwa dass das Gerät nicht zur angemeldeten
 * Person gehört oder die Signatur nicht stimmt, steht ausschliesslich dort.
 */
async function grundAusAntwort(fehler: unknown): Promise<string> {
  const kontext = (fehler as { context?: unknown }).context

  if (kontext instanceof Response) {
    try {
      const koerper = (await kontext.clone().json()) as { fehler?: unknown }

      if (typeof koerper.fehler === 'string' && koerper.fehler !== '') {
        return koerper.fehler
      }
    } catch {
      /* Keine JSON-Antwort: Dann bleibt die Meldung des Clients. */
    }
  }

  return fehler instanceof Error ? fehler.message : String(fehler)
}

function alsFreigabeZeile(roh: RohFreigabeZeile): VaultReleaseZeile {
  return {
    fallId: roh.case_id,
    userId: roh.user_id,
    geraeteId: roh.signed_by_device,
    kid: roh.kid,
    releasedShare: ausBytea(roh.released_share),
    signatur: ausBytea(roh.signature),
    freigegebenAm: roh.released_at,
  }
}

export function supabaseTresor(client: SupabaseClient): TresorTabelle {
  return {
    async wrapFuerGeraet(fallId, geraeteId) {
      const { data, error } = await client
        .from(TABELLE_WRAPS)
        .select(SPALTEN_WRAPS)
        .eq('case_id', fallId)
        .eq('device_id', geraeteId)
        .maybeSingle<RohWrapZeile>()

      if (error !== null) {
        throw new TresorFehler('Der Tresorschlüssel-Wrap war nicht abzurufen', error)
      }

      return data === null ? null : alsWrapZeile(data)
    },

    async legeWrapAn(wrap) {
      // `ignoreDuplicates`: ON CONFLICT DO NOTHING statt DO UPDATE. Die Policy
      // auf vault_key_wraps gibt select, insert und delete frei, kein update;
      // ein echtes Upsert liefe deshalb in einen Rechtefehler statt in den
      // harmlosen Normalfall "steht schon da".
      const { error } = await client
        .from(TABELLE_WRAPS)
        .upsert(
          {
            case_id: wrap.fallId,
            device_id: wrap.geraeteId,
            kem_ct: alsBytea(wrap.kemCt),
            wrapped_key: alsBytea(wrap.wrappedKey),
          },
          { onConflict: 'case_id,device_id', ignoreDuplicates: true },
        )

      if (error !== null) {
        throw new TresorFehler('Der Tresorschlüssel-Wrap war nicht anzulegen', error)
      }
    },

    async sharesFuerFall(fallId) {
      const { data, error } = await client
        .from(TABELLE_SHARES)
        .select(SPALTEN_SHARES)
        .eq('case_id', fallId)
        .order('share_index', { ascending: true })
        .returns<RohShareZeile[]>()

      if (error !== null) {
        throw new TresorFehler('Die Tresor-Shares waren nicht abzurufen', error)
      }

      return data.map(alsShareZeile)
    },

    async resplitVault(fallId: string, n: number, k: number | null, shares: ResplitShareInput[]) {
      const pShares = shares.map((s) => ({
        user_id: s.userId,
        device_id: s.deviceId,
        share_index: s.shareIndex,
        share_hash: alsBytea(s.shareHash),
        kem_ct: alsBytea(s.kemCt),
        wrapped_share: alsBytea(s.wrappedShare),
      }))

      const { error } = await client.rpc('resplit_vault', {
        p_fall_id: fallId,
        p_n: n,
        p_k: k,
        p_shares: pShares,
      })

      if (error !== null) {
        throw new TresorFehler('Der Re-Split des Tresors ist fehlgeschlagen', error)
      }
    },

    async uebergibShare(fallId, geraeteId, kemCt, wrappedShare) {
      const { error } = await client.rpc('uebergib_tresoranteil', {
        p_fall_id: fallId,
        p_geraet: geraeteId,
        p_kem_ct: alsBytea(kemCt),
        p_wrapped_share: alsBytea(wrappedShare),
      })

      if (error !== null) {
        throw new TresorFehler('Der Schlüsselanteil war nicht weiterzugeben', error)
      }
    },

    async freigabenFuerFall(fallId) {
      const { data, error } = await client
        .from(TABELLE_FREIGABEN)
        .select(SPALTEN_FREIGABEN)
        .eq('case_id', fallId)
        .order('released_at', { ascending: true })
        .returns<RohFreigabeZeile[]>()

      if (error !== null) {
        throw new TresorFehler('Die Freigaben waren nicht abzurufen', error)
      }

      return data.map(alsFreigabeZeile)
    },

    async sendeFreigabe(freigabe: NeueFreigabe) {
      /*
       * Über `functions.invoke` und nicht über `from(...).insert`: In
       * `vault_releases` schreibt kein Client, für niemanden gibt es eine
       * Policy (§4). Der Client trägt sein Clerk-Token bereits im Kopf jeder
       * Anfrage; die Function nimmt die Kennung daraus und nie aus diesem
       * Body (§3.5).
       *
       * `user_id` steht trotzdem darin, weil sie in die Signatur eingeht: Der
       * Empfänger prüft gegen die Kennung aus dem Token, und eine Signatur
       * über eine fremde ergibt keine gültige Nachricht.
       */
      const { error } = await client.functions.invoke(FUNKTION_FREIGABE, {
        body: {
          caseId: freigabe.caseId,
          userId: freigabe.userId,
          deviceId: freigabe.geraeteId,
          kid: freigabe.kid,
          releasedShare: alsBytea(freigabe.releasedShare),
          signatur: alsBytea(freigabe.signatur),
        },
      })

      if (error !== null) {
        throw new TresorFehler(
          `Die Freigabe wurde nicht angenommen: ${await grundAusAntwort(error)}`,
        )
      }
    },

    async oeffneTresor(fallId, proof, katalogVersion, payload) {
      const { data, error } = await client.rpc('open_vault', {
        p_fall_id: fallId,
        p_proof: alsBytea(proof),
        p_katalog_version: katalogVersion,
        p_payload: alsBytea(payload),
      })

      if (error !== null) {
        throw new TresorFehler('Der Tresor liess sich nicht öffnen', error)
      }

      // Die gültige `catalog_version`: die eigene oder die eines schnelleren
      // Clients (§3.5, §8).
      return typeof data === 'string' && data !== '' ? data : null
    },
  }
}
