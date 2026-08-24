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
   * Ob mindestens eine Runde vollständig durchgelaufen ist: Der Bestand hat
   * dann den Server gesehen und nicht nur den Cache.
   *
   * Der Unterschied zu `!laedtNetz` ist der Zeitpunkt vor dem ersten Abruf —
   * dort läuft nichts, und trotzdem weiss niemand, was auf dem Server steht.
   * Wer aus dem Fehlen einer Zeile etwas schliessen will, braucht genau diese
   * Unterscheidung; der Rechtskatalog tut das (§8).
   */
  abgeglichen: boolean
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

  const cache = useMemo(() => idbCiphertextcache(), [])
  const warteschlange = useMemo(() => idbWarteschlange(), [])

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
  const [abgeglichen, setzeAbgeglichen] = useState(false)
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

        /*
         * Der Fehlschlag bleibt in der Schleife.
         *
         * Fienge ihn erst ein `catch` um das `do` herum, riss die gescheiterte
         * Runde jeden Wunsch mit sich, der waehrend ihrer Laufzeit eintraf:
         * `nochmal` war gesetzt, die Schleife kam aber nicht mehr bis zu ihrer
         * Bedingung. Eine Aufgabe, die genau in diesem Moment angetippt wurde,
         * bliebe in der Queue liegen und wartete auf ein Ereignis, das nicht
         * kommt — die Tuerklingel laeutet nur, wenn jemand *anders* schreibt,
         * `online` feuert nicht, wer nie offline war, und das Polling schweigt,
         * solange Realtime steht. Sichtbar waere sie trotzdem: optimistisch
         * angezeigt, aber auf keinem Server. Genau das schliesst §5 aus.
         *
         * Ein Rennen gibt es dabei nicht: Jeder Durchgang wartet auf das Netz,
         * und `nochmal` traegt nur ein Ja oder Nein, keinen Zaehler.
         */
        try {
          // Erst hinaus, dann herein: Was dieses Gerät geschrieben hat, soll im
          // selben Delta zurückkommen, statt eine Runde später.
          const abarbeitung = await arbeiteAb(warteschlange, inhalte)
          wartend.current = (await warteschlange.offen()).map((eintrag) => eintrag.mutation)

          if (abarbeitung.abgelehnt.length > 0 && aktuell.current) {
            setzeAbgelehnt((vorher) => [...vorher, ...abarbeitung.abgelehnt])
          }

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
          }

          if (aktuell.current) {
            setzeNetzfehler(null)
            setzeAbgeglichen(true)
          }
        } catch (fehler) {
          if (aktuell.current) {
            setzeNetzfehler(alsNachricht(fehler))
          }
        } finally {
          /*
           * Genau ein Bild je Runde, und zwar am Ende.
           *
           * Die Überlagerung aus der Queue fällt weg, sobald der Server die
           * Mutation angenommen hat — die bestätigte Zeile kommt aber erst mit
           * dem Delta ein paar Zeilen weiter oben. Dazwischen zu rendern hiesse,
           * für die Dauer von `version` plus `seit` den Stand *vor* der Änderung
           * zu zeigen: Das Häkchen spränge zurück, die gelöschte Aufgabe käme
           * wieder, und beides ausgerechnet dann, wenn alles geklappt hat.
           *
           * Deshalb `finally`: Auch die Runde, die unterwegs abbricht,
           * hinterlässt ein stimmiges Bild — abgelehnte Mutationen haben die
           * Queue schon verlassen, und ihre Wirkung muss mit ihnen verschwinden.
           */
          zeige()
        }
      } while (nochmal.current)
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
      /*
       * Erst anhängen, dann anzeigen — und ausdrücklich in dieser Reihenfolge.
       *
       * Andersherum wäre die Änderung eine Lidschlagsdauer lang zu sehen, ohne
       * irgendwo zu liegen: Wer in dem Moment den Tab schliesst oder
       * weiternavigiert, bricht die IndexedDB-Transaktion ab und verliert sie,
       * nachdem die Oberfläche sie bereits bestätigt hat. §5 stellt die Queue
       * genau dafür zwischen die Handlung und den Server.
       *
       * Dass ein Häkchen deshalb nicht springt, ist die Sache der Zeile, die es
       * trägt: Sie hält, was angetippt wurde, bis der Bestand nachgezogen hat
       * (siehe `Aufgabenzeile` in `screens/shared/Alle`).
       */
      await warteschlange.haengeAn(mutation)

      wartend.current = [...wartend.current, mutation]
      zeige()

      void runde()
    },
    [runde, warteschlange, zeige],
  )

  const bestaetige = useCallback(() => setzeAbgelehnt([]), [])

  const aktualisiere = useCallback(() => void runde(), [runde])

  const zustand = useMemo<SyncZustand>(
    () => ({ zeilen, gecacht, laedtNetz, netzfehler, abgeglichen, abgelehnt }),
    [zeilen, gecacht, laedtNetz, netzfehler, abgeglichen, abgelehnt],
  )

  return useMemo(
    () => ({ zustand, mutiere, bestaetige, aktualisiere }),
    [zustand, mutiere, bestaetige, aktualisiere],
  )
}
