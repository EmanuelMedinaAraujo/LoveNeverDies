/**
 * `cases` über Supabase (DESIGN.md §4).
 *
 * Die Umsetzung des Ports aus `faelle.ts`. Angelegt wird ausschließlich über
 * die RPC `lege_trauerfall_an`: Sie legt Fall, Mitgliedschaft und beide Wraps
 * in einer Transaktion an, damit keine der drei Zeilen ohne die anderen
 * entsteht.
 */

import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js'
import { alsBytea, ausBytea } from './bytea'
import type { FaelleTabelle, Fallstatus, FallZeile, NeuerTrauerfall, NeuerVorsorgefall } from './faelle'

const TABELLE = 'cases'

const SPALTEN =
  'id, status, current_kid, key_generation, version, catalog_version, payload, preparer_id, vault_commitment, vault_resplit_pending, vault_k, vault_n, rotation_pending, rotation_claimed_by, rotation_claim_expires_at, created_at'

type RohZeile = {
  id: string
  status: Fallstatus
  current_kid: string
  key_generation: number
  version: number
  catalog_version: string | null
  payload: unknown
  preparer_id: string | null
  vault_commitment: unknown
  vault_resplit_pending: boolean
  vault_k: number | null
  vault_n: number | null
  rotation_pending: boolean
  rotation_claimed_by: string | null
  rotation_claim_expires_at: string | null
  created_at: string
}

export class FaelleFehler extends Error {
  constructor(was: string, ursache?: PostgrestError) {
    super(ursache === undefined ? was : `${was}: ${ursache.message}`)
    this.name = 'FaelleFehler'
    this.cause = ursache
  }
}

function alsZeile(roh: RohZeile): FallZeile {
  return {
    id: roh.id,
    status: roh.status,
    currentKid: roh.current_kid,
    keyGeneration: roh.key_generation,
    version: roh.version,
    katalogVersion: roh.catalog_version ?? null,
    payload: ausBytea(roh.payload),
    preparerId: roh.preparer_id ?? null,
    vaultCommitment:
      roh.vault_commitment === null || roh.vault_commitment === undefined
        ? null
        : ausBytea(roh.vault_commitment),
    vaultResplitPending: roh.vault_resplit_pending === true,
    vaultK: roh.vault_k === null || roh.vault_k === undefined ? null : Number(roh.vault_k),
    vaultN: roh.vault_n === null || roh.vault_n === undefined ? null : Number(roh.vault_n),
    rotationPending: roh.rotation_pending === true,
    rotationClaimedBy: roh.rotation_claimed_by ?? null,
    rotationClaimExpiresAt: roh.rotation_claim_expires_at ?? null,
    angelegtAm: roh.created_at,
  }
}

export function supabaseFaelle(client: SupabaseClient): FaelleTabelle {
  return {
    async legeTrauerfallAn(neu: NeuerTrauerfall) {
      const { error } = await client.rpc('lege_trauerfall_an', {
        p_fall_id: neu.id,
        p_kid_fall: neu.kidFall,
        p_kid_katalog: neu.kidKatalog,
        p_payload: alsBytea(neu.payload),
        p_katalog_version: neu.katalogVersion,
        p_geraet: neu.geraeteId,
        p_fall_kem_ct: alsBytea(neu.wrapFall.kemCt),
        p_fall_wrapped_key: alsBytea(neu.wrapFall.wrappedKey),
        p_fall_signatur: alsBytea(neu.wrapFall.signatur),
        p_kat_kem_ct: alsBytea(neu.wrapKatalog.kemCt),
        p_kat_wrapped_key: alsBytea(neu.wrapKatalog.wrappedKey),
        p_kat_signatur: alsBytea(neu.wrapKatalog.signatur),
      })

      if (error !== null) {
        throw new FaelleFehler('Der Trauerfall konnte nicht angelegt werden', error)
      }
    },

    async legeVorsorgefallAn(neu: NeuerVorsorgefall) {
      const { error } = await client.rpc('lege_vorsorgefall_an', {
        p_fall_id: neu.id,
        p_kid_fall: neu.kidFall,
        p_kid_katalog: neu.kidKatalog,
        p_payload: alsBytea(neu.payload),
        p_geraet: neu.geraeteId,
        p_fall_kem_ct: alsBytea(neu.wrapFall.kemCt),
        p_fall_wrapped_key: alsBytea(neu.wrapFall.wrappedKey),
        p_fall_signatur: alsBytea(neu.wrapFall.signatur),
        p_kat_kem_ct: alsBytea(neu.wrapKatalog.kemCt),
        p_kat_wrapped_key: alsBytea(neu.wrapKatalog.wrappedKey),
        p_kat_signatur: alsBytea(neu.wrapKatalog.signatur),
        p_vault_commitment: alsBytea(neu.vaultCommitment),
        p_vault_kem_ct: alsBytea(neu.vaultKemCt),
        p_vault_wrapped_key: alsBytea(neu.vaultWrappedKey),
      })

      if (error !== null) {
        throw new FaelleFehler('Der Vorsorgefall konnte nicht angelegt werden', error)
      }
    },

    async loescheVorsorgefall(fallId: string) {
      const { error } = await client.from(TABELLE).delete().eq('id', fallId)

      if (error !== null) {
        throw new FaelleFehler('Der Vorsorgefall konnte nicht gelöscht werden', error)
      }
    },

    async eigene() {
      const { data, error } = await client
        .from(TABELLE)
        .select(SPALTEN)
        .order('created_at', { ascending: true })
        .returns<RohZeile[]>()

      if (error !== null) {
        throw new FaelleFehler('Die eigenen Fälle konnten nicht abgerufen werden', error)
      }

      return data.map(alsZeile)
    },

    async version(fallId) {
      // Eine Spalte, eine Zeile, `maybeSingle`: Ein Fall, den die RLS
      // wegfiltert, ist keine Ausnahme, sondern eine leere Antwort.
      const { data, error } = await client
        .from(TABELLE)
        .select('version')
        .eq('id', fallId)
        .maybeSingle<{ version: number | string }>()

      if (error !== null) {
        throw new FaelleFehler('Der Stand dieses Falls konnte nicht abgerufen werden', error)
      }

      return data === null ? null : Number(data.version)
    },

    async claimRotation(fallId, expectedGeneration, geraeteId) {
      const { data, error } = await client.rpc('claim_rotation', {
        p_case_id: fallId,
        p_expected_generation: expectedGeneration,
        p_device_id: geraeteId,
      })

      if (error !== null) {
        throw new FaelleFehler('Das Mandat zur Schlüsselrotation konnte nicht angefordert werden', error)
      }

      return Boolean(data)
    },

    async commitRotation(fallId, expectedGeneration, newKid, geraeteId, payload, items) {
      const { data, error } = await client.rpc('commit_rotation', {
        p_case_id: fallId,
        p_expected_generation: expectedGeneration,
        p_new_kid: newKid,
        p_device_id: geraeteId,
        p_payload: payload === undefined ? null : alsBytea(payload),
        p_items:
          items === undefined
            ? []
            : items.map((item) => ({
                id: item.id,
                wrapped_dek: alsBytea(item.wrappedDek),
              })),
      })

      if (error !== null) {
        throw new FaelleFehler('Die Schlüsselrotation konnte nicht bestätigt werden', error)
      }

      return Boolean(data)
    },
  }
}

