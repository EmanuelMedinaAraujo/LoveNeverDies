/**
 * Der Nachlass-Tresor eines Falls (DESIGN.md §3.5).
 *
 * Im Tab Erbe legt der Preparer Inhalte in den Tresor: `in_vault = true`, DEK
 * unter `K_v` statt `K_c`.
 *
 * Verwaltet Tresor-Items, Schwellwerte, Freigabestatus und stößt den Re-Split
 * bei Mitgliederänderungen an.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '../core/auth/authProvider.ts'
import { supabaseGeraeteschluessel } from '../core/db/supabaseGeraeteschluessel.ts'
import { supabaseMitglieder } from '../core/db/supabaseMitglieder.ts'
import { supabaseTresor } from '../core/db/supabaseTresor.ts'
import { useSupabase } from '../core/db/supabaseProvider.tsx'
import { alsNachricht } from '../core/fehler.ts'
import type { LesbarerFall } from '../services/fallService.ts'
import {
  berechneTresorSchwelle,
  mutationTresorAnlegen,
  mutationTresorLoeschen,
  tresorItemsAusZeilen,
  verteileShares as verteileSharesDienst,
  type TresorItem,
  type TresorSchwelle,
} from '../services/tresorService.ts'
import { useSync } from './useSync.ts'

export type TresorZustand =
  | { status: 'laedt' }
  | {
      status: 'bereit'
      items: TresorItem[]
      schwelle: TresorSchwelle
      istPreparer: boolean
      resplitPending: boolean
      laedtNetz: boolean
      netzfehler: string | null
    }

export type Tresordaten = {
  zustand: TresorZustand
  legeItemAn: (titel: string, inhalt: string) => Promise<void>
  loescheItem: (item: TresorItem) => Promise<void>
  verteileShares: () => Promise<TresorSchwelle>
  resplitLaeuft: boolean
  resplitFehler: string | null
}

export function useTresor(fall: LesbarerFall): Tresordaten {
  const { zustand: sync, mutiere } = useSync(fall.id)
  const zugang = useSupabase()
  const { zustand: authZustand } = useAuth()

  const [items, setzeItems] = useState<TresorItem[]>([])
  const [resplitLaeuft, setzeResplitLaeuft] = useState(false)
  const [resplitFehler, setzeResplitFehler] = useState<string | null>(null)

  const istPreparer = fall.status === 'vorsorge' && fall.kv !== null
  const kv = fall.kv

  useEffect(() => {
    let aktuell = true

    void (async () => {
      if (kv === null) {
        if (aktuell) {
          setzeItems([])
        }
        return
      }

      const entschluesselt = await tresorItemsAusZeilen(sync.zeilen, kv)
      if (aktuell) {
        setzeItems(entschluesselt)
      }
    })()

    return () => {
      aktuell = false
    }
  }, [kv, sync.zeilen])

  const verteileShares = useCallback(async () => {
    if (kv === null) {
      throw new Error('Ohne Tresorschlüssel können keine Shares verteilt werden.')
    }

    setzeResplitLaeuft(true)
    setzeResplitFehler(null)

    try {
      const client = zugang()
      const preparerId =
        fall.preparerId ??
        (authZustand.status === 'angemeldet' ? authZustand.benutzer.id : '')

      const ergebnis = await verteileSharesDienst(
        supabaseTresor(client),
        supabaseMitglieder(client),
        supabaseGeraeteschluessel(client),
        fall.id,
        kv,
        preparerId,
      )

      return ergebnis
    } catch (ursache) {
      const nachricht = alsNachricht(ursache)
      setzeResplitFehler(nachricht)
      throw ursache
    } finally {
      setzeResplitLaeuft(false)
    }
  }, [authZustand, fall.id, fall.preparerId, kv, zugang])

  // Automatischer Re-Split, wenn vault_resplit_pending gesetzt ist und Preparer online ist (§3.5)
  useEffect(() => {
    if (!fall.vaultResplitPending || !istPreparer || kv === null || !sync.abgeglichen || resplitLaeuft) {
      return
    }

    let aktuell = true
    void (async () => {
      try {
        const client = zugang()
        const preparerId =
          fall.preparerId ??
          (authZustand.status === 'angemeldet' ? authZustand.benutzer.id : '')

        await verteileSharesDienst(
          supabaseTresor(client),
          supabaseMitglieder(client),
          supabaseGeraeteschluessel(client),
          fall.id,
          kv,
          preparerId,
        )
      } catch (ursache) {
        if (aktuell) {
          setzeResplitFehler(alsNachricht(ursache))
        }
      }
    })()

    return () => {
      aktuell = false
    }
  }, [
    authZustand,
    fall.id,
    fall.preparerId,
    fall.vaultResplitPending,
    istPreparer,
    kv,
    resplitLaeuft,
    sync.abgeglichen,
    zugang,
  ])

  const legeItemAn = useCallback(
    async (titel: string, inhalt: string) => {
      if (kv === null) {
        throw new Error('Ohne Tresorschlüssel kann kein Tresor-Item angelegt werden.')
      }

      mutiere(await mutationTresorAnlegen(fall.id, kv, titel, inhalt))
    },
    [fall.id, kv, mutiere],
  )

  const loescheItem = useCallback(
    async (item: TresorItem) => {
      mutiere(mutationTresorLoeschen(item.id))
    },
    [mutiere],
  )

  const schwelle = useMemo<TresorSchwelle>(() => {
    const n = fall.vaultN ?? 0
    return fall.vaultK !== null && fall.vaultK !== undefined
      ? { n, k: fall.vaultK }
      : berechneTresorSchwelle(n)
  }, [fall.vaultK, fall.vaultN])

  const zustand = useMemo<TresorZustand>(() => {
    if (!sync.gecacht) {
      return { status: 'laedt' }
    }

    return {
      status: 'bereit',
      items,
      schwelle,
      istPreparer,
      resplitPending: fall.vaultResplitPending,
      laedtNetz: sync.laedtNetz,
      netzfehler: sync.netzfehler,
    }
  }, [
    fall.vaultResplitPending,
    istPreparer,
    items,
    schwelle,
    sync.gecacht,
    sync.laedtNetz,
    sync.netzfehler,
  ])

  return useMemo(
    () => ({
      zustand,
      legeItemAn,
      loescheItem,
      verteileShares,
      resplitLaeuft,
      resplitFehler,
    }),
    [zustand, legeItemAn, loescheItem, verteileShares, resplitLaeuft, resplitFehler],
  )
}
