/**
 * `cases` über Supabase (DESIGN.md §4).
 *
 * Die Umsetzung des Ports aus `faelle.ts`. Angelegt wird ausschließlich über
 * die RPC `lege_trauerfall_an` — sie legt Fall, Mitgliedschaft und beide Wraps
 * in einer Transaktion an, damit keine der drei Zeilen ohne die anderen
 * entsteht.
 */

import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js'
import { alsBytea, ausBytea } from './bytea'
import type { FaelleTabelle, Fallstatus, FallZeile, NeuerTrauerfall, NeuerVorsorgefall } from './faelle'

const TABELLE = 'cases'

const SPALTEN =
  'id, status, current_kid, key_generation, version, catalog_version, payload, preparer_id, vault_commitment, vault_resplit_pending, vault_k, vault_n, created_at'

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
        throw new FaelleFehler('Der Trauerfall war nicht anzulegen', error)
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
        throw new FaelleFehler('Der Vorsorgefall war nicht anzulegen', error)
      }
    },

    async loescheVorsorgefall(fallId: string) {
      const { error } = await client.from(TABELLE).delete().eq('id', fallId)

      if (error !== null) {
        throw new FaelleFehler('Der Vorsorgefall war nicht zu löschen', error)
      }
    },

    async eigene() {
      const { data, error } = await client
        .from(TABELLE)
        .select(SPALTEN)
        .order('created_at', { ascending: true })
        .returns<RohZeile[]>()

      if (error !== null) {
        throw new FaelleFehler('Die eigenen Fälle waren nicht abzurufen', error)
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
        throw new FaelleFehler('Der Stand dieses Falls war nicht abzurufen', error)
      }

      return data === null ? null : Number(data.version)
    },
  }
}

