/**
 * Die Aufgaben eines Falls (DESIGN.md §3.3, §5, §7).
 *
 * Der Sync liegt darunter, in `useSync`: Cache, Delta, Türklingel und
 * Offline-Queue. Was hier passiert, ist der letzte Schritt aus §3.1 — DEK
 * entpacken, Payload entschlüsseln — und der erste in die andere Richtung:
 * verschlüsseln und an die Queue hängen.
 *
 * **Zwei Zusagen aus §5 stehen genau hier.**
 *
 * *„Gecachte Inhalte werden sofort gerendert."* Sobald der Cache gelesen ist,
 * steht die Liste. Die Ladeanzeige gehört dem Netzwerk-Fetch, nicht dem
 * Entschlüsseln — deshalb hat dieser Hook einen `laedt`-Zustand nur so lange,
 * bis der Cache da ist, und danach ein `laedtNetz` daneben.
 *
 * *„Sichtbare Screens aktualisieren sich nur für tatsächlich geänderte Zeilen."*
 * Der Reconciler ersetzt ausschliesslich die Zeilen, die sich geändert haben;
 * alle anderen behalten ihre Objektidentität. Daran erkennt dieser Hook, was er
 * nicht noch einmal entschlüsseln muss — bei einem Fall mit hundert Aufgaben ist
 * das der Unterschied zwischen einer Türklingel und einer Denkpause.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { InhaltZeile } from '../core/db/inhalte.ts'
import {
  aufgabenAusZeilen,
  beschreibeAbgelehnte,
  mutationAendern,
  mutationAnlegen,
  mutationLoeschen,
  type AbgelehnteAenderung,
  type Aufgabe,
  type Aufgabenaenderung,
  type Fallschluessel,
} from '../services/aufgabenService.ts'
import { useSync } from './useSync.ts'

export type AufgabenZustand =
  | { status: 'laedt' }
  | {
      status: 'bereit'
      aufgaben: Aufgabe[]
      uebersprungen: number
      /** Läuft gerade ein Netzwerk-Fetch? Die Liste steht trotzdem (§5). */
      laedtNetz: boolean
      /** Was beim letzten Abruf schiefging. Die Liste bleibt stehen. */
      netzfehler: string | null
    }

export type Aufgabendaten = {
  zustand: AufgabenZustand
  /**
   * Was der Server verworfen hat, mit entschlüsseltem Titel (§5). Verschwindet
   * erst, wenn jemand es zur Kenntnis nimmt.
   */
  abgelehnt: AbgelehnteAenderung[]
  bestaetige: () => void
  legeAn: (titel: string) => Promise<void>
  schreibe: (aufgabe: Aufgabe, aenderung: Aufgabenaenderung) => Promise<void>
  hakeAb: (aufgabe: Aufgabe, erledigt: boolean) => Promise<void>
  loesche: (aufgabe: Aufgabe) => Promise<void>
}

const LEER = { aufgaben: [] as Aufgabe[], uebersprungen: 0 }

export function useAufgaben(fall: Fallschluessel): Aufgabendaten {
  const { zustand: sync, mutiere, bestaetige } = useSync(fall.id)

  const [liste, setzeListe] = useState(LEER)
  const [abgelehnt, setzeAbgelehnt] = useState<AbgelehnteAenderung[]>([])

  /**
   * Die zuletzt entschlüsselte Fassung je Zeile.
   *
   * Der Schlüssel ist die Zeile selbst, nicht ihre ID: Der Reconciler gibt
   * unveränderte Zeilen unverändert zurück, also ist die Objektidentität genau
   * die Frage „hat sich hier etwas getan?" — und eine `WeakMap` lässt die
   * abgelösten Fassungen von selbst los.
   */
  const entschluesselt = useRef(new WeakMap<InhaltZeile, Aufgabe>())

  useEffect(() => {
    let aktuell = true

    void (async () => {
      const bekannt = entschluesselt.current
      const neue = sync.zeilen.filter((zeile) => !bekannt.has(zeile))
      const { aufgaben, uebersprungen } = await aufgabenAusZeilen(neue, fall)

      for (const aufgabe of aufgaben) {
        const zeile = neue.find((kandidat) => kandidat.id === aufgabe.id)

        if (zeile !== undefined) {
          bekannt.set(zeile, aufgabe)
        }
      }

      if (!aktuell) {
        return
      }

      // Die Reihenfolge kommt aus `sync.zeilen` und damit aus der `id`: die
      // Anlagereihenfolge (§4). Ein Häkchen verschiebt nichts.
      setzeListe({
        aufgaben: sync.zeilen
          .map((zeile) => bekannt.get(zeile))
          .filter((aufgabe): aufgabe is Aufgabe => aufgabe !== undefined),
        uebersprungen,
      })
    })()

    return () => {
      aktuell = false
    }
  }, [fall, sync.zeilen])

  useEffect(() => {
    if (sync.abgelehnt.length === 0) {
      setzeAbgelehnt([])
      return
    }

    let aktuell = true

    void (async () => {
      const beschrieben = await beschreibeAbgelehnte(sync.abgelehnt, sync.zeilen, fall)

      if (aktuell) {
        setzeAbgelehnt(beschrieben)
      }
    })()

    return () => {
      aktuell = false
    }
  }, [fall, sync.abgelehnt, sync.zeilen])

  const legeAn = useCallback(
    async (titel: string) => mutiere(await mutationAnlegen(fall, titel)),
    [fall, mutiere],
  )

  const schreibe = useCallback(
    async (aufgabe: Aufgabe, aenderung: Aufgabenaenderung) =>
      mutiere(await mutationAendern(aufgabe, aenderung)),
    [mutiere],
  )

  const hakeAb = useCallback(
    (aufgabe: Aufgabe, erledigt: boolean) => schreibe(aufgabe, { erledigt }),
    [schreibe],
  )

  const loesche = useCallback(
    (aufgabe: Aufgabe) => mutiere(mutationLoeschen(aufgabe)),
    [mutiere],
  )

  const zustand = useMemo<AufgabenZustand>(
    () =>
      sync.gecacht
        ? {
            status: 'bereit',
            aufgaben: liste.aufgaben,
            uebersprungen: liste.uebersprungen,
            laedtNetz: sync.laedtNetz,
            netzfehler: sync.netzfehler,
          }
        : { status: 'laedt' },
    [liste, sync.gecacht, sync.laedtNetz, sync.netzfehler],
  )

  return useMemo(
    () => ({ zustand, abgelehnt, bestaetige, legeAn, schreibe, hakeAb, loesche }),
    [zustand, abgelehnt, bestaetige, legeAn, schreibe, hakeAb, loesche],
  )
}
