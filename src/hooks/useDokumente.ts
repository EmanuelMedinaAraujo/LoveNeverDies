/**
 * Die Dokumente eines Falls (DESIGN.md §7, §5).
 *
 * Gelesen wird aus demselben Delta wie die Aufgaben: Ein Dokument ist ein Item
 * mit `kind = 'file'`, und `useAufgaben` gibt den Bestand als Ciphertext heraus
 * (`zeilen`). Ein zweiter `useSync` daneben hielte einen zweiten Cache, ein
 * zweites Wasserzeichen und eine zweite Queue für denselben Fall.
 *
 * **Geschrieben wird dagegen an der Queue vorbei** (§5): „Dokument-Uploads
 * gehen nicht in die Offline-Queue." Deshalb tut dieser Hook zwei Dinge, die
 * `useAufgaben` nicht tut — er spricht direkt mit Storage und `items`, und er
 * stösst danach eine Sync-Runde an, damit die neue Zeile sofort im Bestand
 * steht statt erst beim nächsten Läuten.
 *
 * **Ohne Verbindung ist die Aufnahme gesperrt.** Das ist keine Bequemlichkeit,
 * sondern die Folge derselben Entscheidung: Was nicht in die Queue geht, kann
 * nicht auf den Reconnect warten. Eine Schaltfläche, die im Flugmodus eine
 * Fehlermeldung produziert, wäre die schlechtere Auskunft als eine, die sagt,
 * warum sie gerade nicht geht.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { workerDateikrypto } from '../core/crypto/workerDateikrypto.ts'
import { supabaseAblage } from '../core/db/supabaseAblage.ts'
import type { InhaltZeile } from '../core/db/inhalte.ts'
import { supabaseInhalte } from '../core/db/supabaseInhalte.ts'
import { useSupabase } from '../core/db/supabaseProvider.tsx'
import type { Fallschluessel } from '../services/aufgabenService.ts'
import {
  DokumentFehler,
  dokumenteAusZeilen,
  loescheDokument,
  nimmDokumentAuf,
  oeffneDokument,
  type Dateiauswahl,
  type Dokument,
} from '../services/dokumentService.ts'

export type Dokumentdaten = {
  /**
   * Die Dokumente dieses Falls, entschlüsselt.
   *
   * In der Reihenfolge von `zeilen` — der Reconciler ordnet über die `id`, und
   * die ist eine UUIDv7 (§5). Das ist die Aufnahmereihenfolge, ohne dass hier
   * noch einmal sortiert werden müsste.
   */
  dokumente: Dokument[]
  /**
   * Die Zeilen, die sich nicht entschlüsseln liessen (§3.7). Sichtbar
   * ausschliesslich im Dev-Modus.
   */
  uebersprungen: number
  /** Ob dieses Gerät gerade eine Verbindung hat. Ohne sie ist die Aufnahme zu. */
  online: boolean
  /** @param aufgabeId die Aufgabe, an der das Dokument hängt (§7). */
  nimmAuf: (datei: Dateiauswahl, aufgabeId: string | null) => Promise<Dokument>
  /** Holt die Datei und entschlüsselt sie. */
  oeffne: (dokument: Dokument) => Promise<Uint8Array>
  /** Setzt den Tombstone und entfernt die Datei (§7). */
  loesche: (dokument: Dokument) => Promise<void>
}

/** Keine Dokumente — als eine Liste, damit sie ihre Identität behält. */
const KEINE: Dokument[] = []

/**
 * Ob dieses Gerät online ist.
 *
 * `navigator.onLine` ist notorisch optimistisch — es sagt „ja" auch im WLAN
 * ohne Internet. Als Sperre reicht es trotzdem: Es liegt nie falsch, wenn es
 * „nein" sagt, und das ist die Richtung, um die es hier geht. Wer trotz „ja"
 * keine Verbindung hat, bekommt die Fehlermeldung des Uploads.
 */
function useOnline(): boolean {
  const [online, setzeOnline] = useState(() => globalThis.navigator?.onLine ?? true)

  useEffect(() => {
    const merke = () => setzeOnline(globalThis.navigator?.onLine ?? true)

    globalThis.addEventListener?.('online', merke)
    globalThis.addEventListener?.('offline', merke)

    // Zwischen dem ersten Rendern und diesem Effekt kann sich die Verbindung
    // geändert haben.
    merke()

    return () => {
      globalThis.removeEventListener?.('online', merke)
      globalThis.removeEventListener?.('offline', merke)
    }
  }, [])

  return online
}

/**
 * @param zeilen der Bestand als Ciphertext, aus `useAufgaben`.
 * @param aktualisiere stösst eine Sync-Runde an — der Weg, auf dem eine an der
 * Queue vorbei geschriebene Zeile in den Bestand kommt.
 */
export function useDokumente(
  fall: Fallschluessel,
  zeilen: InhaltZeile[],
  aktualisiere: () => void,
): Dokumentdaten {
  const zugang = useSupabase()
  const online = useOnline()

  /*
   * Eine Werkbank je Fall, und sie entsteht erst beim ersten Auftrag: Die
   * meisten Sitzungen laden nie ein Dokument hoch, und ein Worker, der nie
   * gebraucht wird, soll auch nie starten (siehe `workerDateikrypto`).
   */
  const krypto = useMemo(() => workerDateikrypto(), [])

  useEffect(() => () => krypto.schliesse(), [krypto])

  const [liste, setzeListe] = useState({ dokumente: KEINE, uebersprungen: 0 })

  useEffect(() => {
    let aktuell = true

    void (async () => {
      const { dokumente, uebersprungeneIds } = await dokumenteAusZeilen(zeilen, fall)

      if (!aktuell) {
        return
      }

      setzeListe({
        dokumente: dokumente.length === 0 ? KEINE : dokumente,
        uebersprungen: uebersprungeneIds.length,
      })
    })()

    return () => {
      aktuell = false
    }
  }, [fall, zeilen])

  /*
   * Anders als bei den Aufgaben wird hier bei jedem Delta alles neu
   * entschlüsselt, ohne WeakMap davor. Ein Fall trägt Dutzende Aufgaben, aber
   * eine Handvoll Dokumente, und entschlüsselt werden nur die Metadaten — die
   * Datei selbst liegt im Storage und wird erst beim Öffnen geholt.
   */

  const werkzeug = useCallback(
    () => {
      const client = zugang()

      return { fall, ablage: supabaseAblage(client), inhalte: supabaseInhalte(client), krypto }
    },
    [fall, krypto, zugang],
  )

  const nimmAuf = useCallback(
    async (datei: Dateiauswahl, aufgabeId: string | null) => {
      if (!online) {
        throw new DokumentFehler(
          'Ohne Verbindung lässt sich kein Dokument aufnehmen. Ihre Aufgaben können Sie weiter bearbeiten — sobald das Netz zurück ist, geht das Foto hinaus.',
        )
      }

      const dokument = await nimmDokumentAuf(werkzeug(), datei, aufgabeId)

      // Die Zeile ist am Delta vorbei entstanden. Ohne diesen Anstoss stünde
      // das Dokument erst da, wenn jemand anderes etwas schreibt (§5).
      aktualisiere()

      return dokument
    },
    [aktualisiere, online, werkzeug],
  )

  const oeffne = useCallback(
    (dokument: Dokument) => oeffneDokument(dokument, supabaseAblage(zugang()), krypto),
    [krypto, zugang],
  )

  const loesche = useCallback(
    async (dokument: Dokument) => {
      const client = zugang()

      await loescheDokument(dokument, supabaseAblage(client), supabaseInhalte(client))
      aktualisiere()
    },
    [aktualisiere, zugang],
  )

  return useMemo(
    () => ({
      dokumente: liste.dokumente,
      uebersprungen: liste.uebersprungen,
      online,
      nimmAuf,
      oeffne,
      loesche,
    }),
    [liste, loesche, nimmAuf, oeffne, online],
  )
}
