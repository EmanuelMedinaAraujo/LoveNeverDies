/**
 * Die Türklingel (DESIGN.md §5).
 *
 * §5, Schritt 3: "Realtime-Subscription auf die `cases`-Zeile. Als Fallback
 * Polling bei Fokus und alle 30 Sekunden, nur falls die Subscription nicht
 * verfügbar ist oder fehlgeschlagen ist."
 *
 * Die Klingel trägt keine Nutzlast. Sie sagt "da war was", und was es war, holt
 * der Delta-Sync: durch die RLS, mit den Bytes, die der Client ohnehin
 * entschlüsseln muss. Deshalb reicht die eine Zeile in `cases`: Ihr `version`
 * hebt der Trigger `items_assign_seq` bei jeder Inhaltsänderung des Falls mit
 * (§4), und mehr als "es hat sich etwas geändert" braucht niemand zu wissen.
 *
 * Das "nur" im Fallback ist die eigentliche Zusage: Ein Polling, das immer
 * mitliefe, wäre kein Fallback: Es hielte auf einem Telefon im Zug zwei
 * Verbindungen für dieselbe Nachricht offen und weckte das Gerät alle 30
 * Sekunden, auch wenn Realtime längst antwortet.
 */

import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js'

/** §5: "alle 30 Sekunden". */
export const POLLING_ABSTAND_MS = 30_000

/**
 * Die Zustände, nach denen die Subscription nicht mehr trägt.
 *
 * `CLOSED` steht bewusst dabei: Ein geschlossener Kanal liefert nichts mehr,
 * und ob ihn ein Fehler oder ein Verbindungsabbruch geschlossen hat, ändert für
 * das Gerät vor dem Fenster nichts.
 */
const GESCHEITERT = new Set(['CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED'])

/**
 * Läutet, sobald sich im Fall etwas geändert hat.
 *
 * @param laeute wird bei jeder Änderung gerufen, und beim Polling auch dann,
 * wenn sich nichts geändert hat. Das ist kein Mangel: Der billige Check aus §5
 * kostet einen Integer, und wer ihn spart, spart an der falschen Stelle.
 * @returns die Abräumfunktion. Nach ihrem Aufruf läutet nichts mehr, auch nicht
 * ein Ereignis, das schon unterwegs war.
 */
export function tuerklingel(
  client: SupabaseClient,
  fallId: string,
  laeute: () => void,
): () => void {
  let abgeraeumt = false
  let takt: ReturnType<typeof setInterval> | null = null

  function melde() {
    if (!abgeraeumt) {
      laeute()
    }
  }

  function beginnePolling() {
    if (abgeraeumt || takt !== null) {
      return
    }

    takt = setInterval(melde, POLLING_ABSTAND_MS)
    globalThis.addEventListener?.('focus', melde)
  }

  function beendePolling() {
    if (takt === null) {
      return
    }

    clearInterval(takt)
    takt = null
    globalThis.removeEventListener?.('focus', melde)
  }

  let kanal: RealtimeChannel | null = null

  try {
    kanal = client
      .channel(`fall:${fallId}`)
      .on(
        // Nur `UPDATE`: Die `cases`-Zeile entsteht, bevor dieses Gerät sie
        // abonniert, und gelöscht wird sie in diesem Stand nirgends.
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'cases', filter: `id=eq.${fallId}` },
        melde,
      )
      .subscribe((status) => {
        if (GESCHEITERT.has(status)) {
          beginnePolling()
          return
        }

        if (status === 'SUBSCRIBED') {
          // Realtime verbindet sich von selbst neu. Bliebe das Polling danach
          // stehen, liefe es für den Rest der Sitzung nebenher.
          beendePolling()
        }
      })
  } catch {
    // "nicht verfügbar" aus §5. Ohne diesen Zweig bliebe die App stumm, ohne
    // dass irgendwo etwas fehlschlüge.
    beginnePolling()
  }

  return () => {
    abgeraeumt = true
    beendePolling()

    if (kanal !== null) {
      void client.removeChannel(kanal)
    }
  }
}
