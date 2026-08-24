/**
 * Der Nachlass-Tresor eines Falls (DESIGN.md §3.5).
 *
 * Im Tab Erbe legt der Preparer Inhalte in den Tresor: `in_vault = true`, DEK
 * unter `K_v` statt `K_c`.
 *
 * Gelesen wird aus demselben Delta wie Aufgaben und Dokumente: `zeilen` und
 * `mutiere` werden aus dem Sync-Stream des Falls bezogen. Ein zweiter `useSync`
 * daneben hielte einen zweiten Cache, ein zweites Wasserzeichen und eine zweite
 * Queue für denselben Fall (DESIGN.md §5, useDokumente.ts:6-7).
 *
 * Verwaltet Tresor-Items, Schwellwerte, Freigabestatus und stößt den Re-Split
 * bei Mitgliederänderungen an.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from '../core/auth/authProvider.ts'
import type { InhaltZeile } from '../core/db/inhalte.ts'
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
import type { Mutation } from '../core/sync/queue.ts'

export type TresorSyncStatus = {
  gecacht: boolean
  laedtNetz: boolean
  netzfehler: string | null
  abgeglichen?: boolean
}

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

export function useTresor(
  fall: LesbarerFall,
  zeilen: InhaltZeile[],
  mutiere: (mutation: Mutation) => void,
  syncStatus?: TresorSyncStatus,
  onFallAktualisieren?: () => void,
): Tresordaten {
  const zugang = useSupabase()
  const { zustand: authZustand } = useAuth()

  const [items, setzeItems] = useState<TresorItem[]>([])
  const [resplitLaeuft, setzeResplitLaeuft] = useState(false)
  const [resplitFehler, setzeResplitFehler] = useState<string | null>(null)

  const resplitLaeuftRef = useRef(false)
  const ausgefuehrtTriggerRef = useRef<string | null>(null)

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

      const entschluesselt = await tresorItemsAusZeilen(zeilen, kv)
      if (aktuell) {
        setzeItems(entschluesselt)
      }
    })()

    return () => {
      aktuell = false
    }
  }, [kv, zeilen])

  const triggerKey = fall.vaultResplitPending ? `${fall.id}:${fall.vaultN}` : null

  // Automatischer Re-Split, wenn vault_resplit_pending gesetzt ist und Preparer online ist (§3.5)
  useEffect(() => {
    if (
      !fall.vaultResplitPending ||
      !istPreparer ||
      kv === null ||
      syncStatus?.abgeglichen === false ||
      resplitLaeuft ||
      resplitLaeuftRef.current ||
      (triggerKey !== null && ausgefuehrtTriggerRef.current === triggerKey)
    ) {
      return
    }

    let aktuell = true
    resplitLaeuftRef.current = true
    setzeResplitLaeuft(true)
    setzeResplitFehler(null)

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

        if (triggerKey !== null) {
          ausgefuehrtTriggerRef.current = triggerKey
        }
        onFallAktualisieren?.()
      } catch (ursache) {
        if (aktuell) {
          setzeResplitFehler(alsNachricht(ursache))
        }
      } finally {
        resplitLaeuftRef.current = false
        if (aktuell) {
          setzeResplitLaeuft(false)
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
    onFallAktualisieren,
    resplitLaeuft,
    syncStatus?.abgeglichen,
    triggerKey,
    zugang,
  ])

  const verteileShares = useCallback(async () => {
    if (kv === null) {
      throw new Error('Ohne Tresorschlüssel können keine Shares verteilt werden.')
    }
    if (resplitLaeuftRef.current) {
      throw new Error('Eine Schlüsselverteilung läuft bereits.')
    }

    resplitLaeuftRef.current = true
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

      if (triggerKey !== null) {
        ausgefuehrtTriggerRef.current = triggerKey
      }
      onFallAktualisieren?.()
      return ergebnis
    } catch (ursache) {
      const nachricht = alsNachricht(ursache)
      setzeResplitFehler(nachricht)
      throw ursache
    } finally {
      resplitLaeuftRef.current = false
      setzeResplitLaeuft(false)
    }
  }, [authZustand, fall.id, fall.preparerId, kv, onFallAktualisieren, triggerKey, zugang])

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

  const gecacht = syncStatus?.gecacht ?? true
  const laedtNetz = syncStatus?.laedtNetz ?? false
  const netzfehler = syncStatus?.netzfehler ?? null

  const zustand = useMemo<TresorZustand>(() => {
    if (!gecacht) {
      return { status: 'laedt' }
    }

    return {
      status: 'bereit',
      items,
      schwelle,
      istPreparer,
      resplitPending: fall.vaultResplitPending,
      laedtNetz,
      netzfehler,
    }
  }, [
    fall.vaultResplitPending,
    gecacht,
    istPreparer,
    items,
    laedtNetz,
    netzfehler,
    schwelle,
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
