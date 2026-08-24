/**
 * Der Delta-Sync eines Falls (DESIGN.md §5).
 *
 * Hier laufen die vier Teile aus `core/sync` zusammen — Wasserzeichen,
 * Reconciler, Türklingel, Queue — und werden zu dem Ablauf, den §5 beschreibt:
 *
 * ```
 * Kaltstart   Cache lesen  → sofort rendern, ohne auf das Netz zu warten
 * Runde       Queue leeren → version prüfen → Delta holen → verrechnen → Cache
 * Türklingel  Realtime auf die cases-Zeile, Polling nur als Fallback
 * ```
 *
 * **Was dieser Hook herausgibt, ist Ciphertext.** Entschlüsselt wird eine Ebene
 * höher, in `useAufgaben`. Der Schnitt liegt hier, weil §5 zwei verschiedene
 * Dinge verlangt: Der Cache und die Queue tragen Bytes, die byteidentisch zum
 * Server sind, und die Ladeanzeige bezieht sich auf den Netzwerk-Fetch — nicht
 * auf das Entschlüsseln, das einige Millisekunden kostet und ohne Netz
 * auskommt.
 *
 * **Jede Mutation geht durch die Queue**, auch bei bester Verbindung. Ein
 * zweiter, direkter Schreibweg wäre ein zweites Verhalten für dieselbe
 * Handlung; siehe `core/sync/queue.ts`.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { idbCiphertextcache } from '../core/db/idb.ts'
import type { InhaltZeile } from '../core/db/inhalte.ts'
import { supabaseFaelle } from '../core/db/supabaseFaelle.ts'
import { supabaseInhalte } from '../core/db/supabaseInhalte.ts'
import { useSupabase } from '../core/db/supabaseProvider.tsx'
import { alsNachricht } from '../core/fehler.ts'
import { vereine, wendeAn } from '../core/sync/reconciler.ts'
import { tuerklingel } from '../core/sync/realtime.ts'
import { arbeiteAb, idbWarteschlange, type AbgelehnteMutation, type Mutation } from '../core/sync/queue.ts'
import { brauchtDelta, geruecktesWasserzeichen } from '../core/sync/watermark.ts'

export type SyncZustand = {
  /**
   * Der Bestand als Ciphertext: bestätigte Zeilen, überlagert von dem, was noch
   * in der Queue steht.
   */
  zeilen: InhaltZeile[]
  /**
   * Ob der Cache gelesen ist. Ab hier wird gerendert — auch ohne Netz, auch
   * bevor der erste Abruf zurück ist (§5).
   */
  gecacht: boolean
  /**
   * Ob gerade ein Netzwerk-Fetch läuft. §5: „Die Ladeanzeige bezieht sich auf
   * den Netzwerk-Fetch, nicht auf das Entschlüsseln."
   */
  laedtNetz: boolean
  /** Was beim letzten Abruf schiefging, oder `null`. */
  netzfehler: string | null
  /**
   * Was der Server verworfen hat. §5: nie stillschweigend, sondern als
   * Mitteilung — den Klartext dazu holt `useAufgaben`.
   */
  abgelehnt: AbgelehnteMutation[]
}

export type Syncdaten = {
  zustand: SyncZustand
  /** Hängt eine Mutation an und stösst eine Runde an. */
  mutiere: (mutation: Mutation) => Promise<void>
  /** Nimmt die Mitteilungen zur Kenntnis und räumt sie weg. */
  bestaetige: () => void
  /** Stösst eine Runde von Hand an. */
  aktualisiere: () => void
}

export function useSync(fallId: string): Syncdaten {
  const zugang = useSupabase()

  const cache = useMemo(idbCiphertextcache, [])
  const warteschlange = useMemo(idbWarteschlange, [])

  /*
   * Der Bestand liegt in Refs und wird ins State gespiegelt.
   *
   * Eine Runde kann von der Türklingel, vom `online`-Ereignis und von einer
   * Mutation zugleich angestossen werden. Läse sie ihren Ausgangsstand aus dem
   * State, arbeitete sie mit dem, was beim Aufbau der Funktion galt — und zwei
   * Runden hintereinander setzten dasselbe Wasserzeichen zweimal.
   */
  const bestand = useRef<InhaltZeile[]>([])
  const wasserzeichen = useRef(0)
  const wartend = useRef<Mutation[]>([])

  const [zeilen, setzeZeilen] = useState<InhaltZeile[]>([])
  const [gecacht, setzeGecacht] = useState(false)
  const [laedtNetz, setzeLaedtNetz] = useState(false)
  const [netzfehler, setzeNetzfehler] = useState<string | null>(null)
  const [abgelehnt, setzeAbgelehnt] = useState<AbgelehnteMutation[]>([])

  /** Lebt so lange wie der Fall auf dem Bildschirm. */
  const aktuell = useRef(true)

  const zeige = useCallback(() => {
    if (aktuell.current) {
      setzeZeilen(wendeAn(bestand.current, wartend.current))
    }
  }, [])

  /**
   * Eine Runde: Queue leeren, billiger Check, Delta, verrechnen, ablegen.
   *
   * `laeuft` und `nochmal` sind kein Feinschliff: Die Türklingel feuert, während
   * eine Runde läuft, und zwei gleichzeitige Runden holten dasselbe Delta
   * zweimal — die zweite mit dem Wasserzeichen von vor der ersten, also mit
   * doppelter Arbeit und einem Rennen um den Cache.
   */
  const laeuft = useRef(false)
  const nochmal = useRef(false)

  const runde = useCallback(async () => {
    if (laeuft.current) {
      nochmal.current = true
      return
    }

    laeuft.current = true
    setzeLaedtNetz(true)

    try {
      do {
        nochmal.current = false

        const client = zugang()
        const inhalte = supabaseInhalte(client)

        // Erst hinaus, dann herein: Was dieses Gerät geschrieben hat, soll im
        // selben Delta zurückkommen, statt eine Runde später.
        const abarbeitung = await arbeiteAb(warteschlange, inhalte)
        wartend.current = (await warteschlange.offen()).map((eintrag) => eintrag.mutation)

        if (abarbeitung.abgelehnt.length > 0 && aktuell.current) {
          setzeAbgelehnt((vorher) => [...vorher, ...abarbeitung.abgelehnt])
        }

        zeige()

        // Schritt 1 aus §5: ein Integer. Gleich dem Wasserzeichen → kein Fetch.
        const version = await supabaseFaelle(client).version(fallId)

        if (brauchtDelta(version, wasserzeichen.current)) {
          const delta = await inhalte.seit(fallId, wasserzeichen.current)
          const { zeilen: vereint, geaendert } = vereine(bestand.current, delta)

          bestand.current = vereint
          // Ausdrücklich aus dem Delta und nicht aus der `version`: Zwischen
          // beiden Abfragen kann weitergeschrieben worden sein (§5).
          wasserzeichen.current = geruecktesWasserzeichen(wasserzeichen.current, delta)

          const zuSchreiben = vereint.filter((zeile) => geaendert.includes(zeile.id))
          await cache.schreibe(fallId, zuSchreiben, wasserzeichen.current)

          zeige()
        }

        if (aktuell.current) {
          setzeNetzfehler(null)
        }
      } while (nochmal.current)
    } catch (fehler) {
      if (aktuell.current) {
        setzeNetzfehler(alsNachricht(fehler))
      }
    } finally {
      laeuft.current = false
      nochmal.current = false

      if (aktuell.current) {
        setzeLaedtNetz(false)
      }
    }
  }, [cache, fallId, warteschlange, zeige, zugang])

  useEffect(() => {
    aktuell.current = true

    // Der Kaltstart: erst der Cache, dann das Netz. §5 — „Gecachte Inhalte
    // werden sofort gerendert", und die Ladeanzeige gehört dem Fetch.
    void (async () => {
      try {
        const [gelesen, offen] = await Promise.all([cache.lies(fallId), warteschlange.offen()])

        if (!aktuell.current) {
          return
        }

        bestand.current = gelesen.zeilen
        wasserzeichen.current = gelesen.wasserzeichen
        wartend.current = offen.map((eintrag) => eintrag.mutation)
        zeige()
      } catch {
        /*
         * Ohne Cache läuft die App weiter, nur eben ohne Sofortanzeige. Ein
         * Wurf hier nähme den Fall mit, obwohl der Server ihn gleich liefern
         * wird — und der Grund wäre ein Zwischenspeicher, den es zu verlieren
         * nichts kostet.
         */
      } finally {
        if (aktuell.current) {
          setzeGecacht(true)
          void runde()
        }
      }
    })()

    return () => {
      aktuell.current = false
    }
  }, [cache, fallId, runde, warteschlange, zeige])

  useEffect(() => {
    // Die Türklingel aus §5, Schritt 3. Sie trägt keine Nutzlast — was sich
    // geändert hat, holt die Runde.
    return tuerklingel(zugang(), fallId, () => void runde())
  }, [fallId, runde, zugang])

  useEffect(() => {
    // Der Reconnect aus §5: Was im Flugmodus angehängt wurde, geht jetzt hinaus.
    const beiVerbindung = () => void runde()

    globalThis.addEventListener?.('online', beiVerbindung)
    return () => globalThis.removeEventListener?.('online', beiVerbindung)
  }, [runde])

  const mutiere = useCallback(
    async (mutation: Mutation) => {
      await warteschlange.haengeAn(mutation)

      // Sofort sichtbar, bevor irgendetwas das Gerät verlässt (§5). Ohne das
      // spränge ein gerade gesetztes Häkchen für die Dauer eines Rundlaufs
      // zurück, und wer im Zug tippt, tippt ein zweites Mal.
      wartend.current = [...wartend.current, mutation]
      zeige()

      void runde()
    },
    [runde, warteschlange, zeige],
  )

  const bestaetige = useCallback(() => setzeAbgelehnt([]), [])

  const aktualisiere = useCallback(() => void runde(), [runde])

  const zustand = useMemo<SyncZustand>(
    () => ({ zeilen, gecacht, laedtNetz, netzfehler, abgelehnt }),
    [zeilen, gecacht, laedtNetz, netzfehler, abgelehnt],
  )

  return useMemo(
    () => ({ zustand, mutiere, bestaetige, aktualisiere }),
    [zustand, mutiere, bestaetige, aktualisiere],
  )
}
