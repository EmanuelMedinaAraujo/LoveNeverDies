/**
 * Implementierung von TresorTabelle über Supabase (DESIGN.md §3.5, §4).
 */

import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js'
import { alsBytea, ausBytea } from './bytea'
import type {
  ResplitShareInput,
  TresorTabelle,
  VaultKeyWrapZeile,
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
  }
}
