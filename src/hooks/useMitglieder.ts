/**
 * Wer außer mir zu diesem Fall gehört (DESIGN.md §4, §7).
 *
 * Die Kennungen kommen aus `memberships` und stehen dort im Klartext (§3.3);
 * die Namen kommen aus den Zuweisungen, die schon im Fall liegen, und
 * irgendwann aus `profiles` (#10). Zusammengesetzt wird beides in
 * `services/zuweisung.ts`: Dieser Hook holt nur die eine Liste, die der Server
 * hat.
 *
 * Ein Fehlschlag nimmt niemandem die Aufgaben weg: Wer die Mitglieder nicht
 * abrufen kann, sieht eine Auswahl, die nur ihn selbst enthält, und kann eine
 * Aufgabe immer noch übernehmen und wieder freigeben. Das ist die Handlung, auf
 * die es in dem Moment ankommt.
 */

import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../core/auth/authProvider.ts'
import { supabaseMitglieder } from '../core/db/supabaseMitglieder.ts'
import { useSupabase } from '../core/db/supabaseProvider.tsx'
import { alsNachricht } from '../core/fehler.ts'
import type { Zugewiesene } from '../services/zuweisung.ts'

export type Mitgliederdaten = {
  /** Die Kennungen aus `memberships`, in der Reihenfolge der Beitritte. */
  userIds: string[]
  /** Die angemeldete Person, so wie sie in eine Zuweisung geschrieben wird. */
  ich: Zugewiesene
  /** Was beim letzten Abruf schiefging, oder `null`. */
  fehler: string | null
}

/** Solange niemand angemeldet ist, gibt es auch keine Person zum Eintragen. */
const NIEMAND_ANGEMELDET: Zugewiesene = { userId: '', name: '' }

export function useMitglieder(fallId: string): Mitgliederdaten {
  const zugang = useSupabase()
  const { zustand: authZustand } = useAuth()

  const [userIds, setzeUserIds] = useState<string[]>([])
  const [fehler, setzeFehler] = useState<string | null>(null)

  const ich = useMemo<Zugewiesene>(
    () =>
      authZustand.status === 'angemeldet'
        ? { userId: authZustand.benutzer.id, name: authZustand.benutzer.anzeigename }
        : NIEMAND_ANGEMELDET,
    [authZustand],
  )

  useEffect(() => {
    let aktuell = true

    void (async () => {
      try {
        const zeilen = await supabaseMitglieder(zugang()).imFall(fallId)

        if (aktuell) {
          setzeUserIds(zeilen.map((zeile) => zeile.userId))
          setzeFehler(null)
        }
      } catch (ursache) {
        if (aktuell) {
          setzeFehler(alsNachricht(ursache))
        }
      }
    })()

    return () => {
      aktuell = false
    }
  }, [fallId, zugang])

  /*
   * Die angemeldete Person steht immer dabei, auch bevor der Abruf zurück ist.
   * Ohne sie stünde in der Auswahl "niemand", während man selbst davorsitzt,
   * und "Übernehmen" wäre für einen Moment eine Schaltfläche ohne Ziel.
   */
  const vollstaendig = useMemo(
    () =>
      ich.userId !== '' && !userIds.includes(ich.userId) ? [ich.userId, ...userIds] : userIds,
    [ich.userId, userIds],
  )

  return useMemo(
    () => ({ userIds: vollstaendig, ich, fehler }),
    [vollstaendig, ich, fehler],
  )
}
