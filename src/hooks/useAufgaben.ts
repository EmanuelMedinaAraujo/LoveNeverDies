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
import { supabaseInhalte } from '../core/db/supabaseInhalte.ts'
import { useSupabase } from '../core/db/supabaseProvider.tsx'
import {
  aufgabenAusZeilen,
  beschreibeAbgelehnte,
  mutationAendern,
  mutationAnlegen,
  mutationLoeschen,
  type AbgelehnteAenderung,
  type Aufgabe,
  type Aufgabenaenderung,
} from '../services/aufgabenService.ts'
import { instanziiereKatalog, type Katalogfall } from '../services/katalogService.ts'
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

/** Eine Zeile, die sich nicht entschlüsseln liess (§3.7). */
const VERWORFEN = Symbol('verworfen')

/** Nichts abgelehnt — als eine Liste, damit sie ihre Identität behält. */
const KEINE: AbgelehnteAenderung[] = []

/**
 * Die Aufgaben der Juristinnen zuerst, in ihrer Reihenfolge (§8) — danach, was
 * jemand selbst angelegt hat, in der Anlagereihenfolge.
 *
 * Ohne diesen Schritt stünde die Rechtsliste in der Reihenfolge ihrer IDs, und
 * die sind ein UUIDv5 über einen HMAC (§8): zufällig. Die Ausschlagungsfrist
 * käme dann irgendwo zwischen Krankenkasse und Bestattung zu stehen.
 *
 * `sort` ist stabil, also bleibt innerhalb derselben `reihenfolge` — und unter
 * allen selbst angelegten Aufgaben — die Reihenfolge aus `sync.zeilen` stehen.
 */
function nachReihenfolge(links: Aufgabe, rechts: Aufgabe): number {
  const hier = links.katalog?.reihenfolge
  const dort = rechts.katalog?.reihenfolge

  if (hier === undefined || dort === undefined) {
    // Keine von beiden aus dem Katalog: Die Reihenfolge aus `sync.zeilen`
    // bleibt. Nur eine: Die aus dem Katalog steht davor.
    return hier === dort ? 0 : hier === undefined ? 1 : -1
  }

  return hier - dort
}

export function useAufgaben(fall: Katalogfall): Aufgabendaten {
  const { zustand: sync, mutiere, bestaetige } = useSync(fall.id)
  const zugang = useSupabase()

  const [liste, setzeListe] = useState(LEER)
  const [abgelehnt, setzeAbgelehnt] = useState<AbgelehnteAenderung[]>([])

  /**
   * Die zuletzt entschlüsselte Fassung je Zeile — oder die Feststellung, dass
   * sie sich nicht entschlüsseln liess (§3.7).
   *
   * Der Schlüssel ist die Zeile selbst, nicht ihre ID: Der Reconciler gibt
   * unveränderte Zeilen unverändert zurück, also ist die Objektidentität genau
   * die Frage „hat sich hier etwas getan?" — und eine `WeakMap` lässt die
   * abgelösten Fassungen von selbst los.
   *
   * Auch das Verworfene steht drin, und nicht bloss als Zahl. Nur so gilt der
   * Zähler aus §3.7 für den ganzen Bestand: Entschlüsselt wird stapelweise, und
   * ein Stapel ohne neue Zeilen brächte sonst eine 0 mit und löschte damit,
   * was die Stapel davor gefunden haben.
   */
  const entschluesselt = useRef(new WeakMap<InhaltZeile, Aufgabe | typeof VERWORFEN>())

  useEffect(() => {
    let aktuell = true

    void (async () => {
      const bekannt = entschluesselt.current
      const neue = sync.zeilen.filter((zeile) => !bekannt.has(zeile))
      const { aufgaben, uebersprungeneIds } = await aufgabenAusZeilen(neue, fall)

      const nachId = new Map(neue.map((zeile) => [zeile.id, zeile]))

      for (const aufgabe of aufgaben) {
        const zeile = nachId.get(aufgabe.id)

        if (zeile !== undefined) {
          bekannt.set(zeile, aufgabe)
        }
      }

      for (const id of uebersprungeneIds) {
        const zeile = nachId.get(id)

        if (zeile !== undefined) {
          bekannt.set(zeile, VERWORFEN)
        }
      }

      if (!aktuell) {
        return
      }

      // Die Reihenfolge kommt aus `sync.zeilen` und damit aus der `id`: die
      // Anlagereihenfolge (§4). Ein Häkchen verschiebt nichts.
      const eintraege = sync.zeilen.map((zeile) => bekannt.get(zeile))

      setzeListe({
        aufgaben: eintraege
          .filter((eintrag): eintrag is Aufgabe => eintrag !== undefined && eintrag !== VERWORFEN)
          .sort(nachReihenfolge),
        uebersprungen: eintraege.filter((eintrag) => eintrag === VERWORFEN).length,
      })
    })()

    return () => {
      aktuell = false
    }
  }, [fall, sync.zeilen])

  useEffect(() => {
    let aktuell = true

    void (async () => {
      // `KEINE` und nicht `[]`: Die Liste wird bei jeder Runde neu berechnet,
      // und ein frisches leeres Array wäre jedes Mal ein neuer Zustand — also
      // ein zusätzliches Rendern für die Nachricht „es gibt nichts zu melden".
      const beschrieben =
        sync.abgelehnt.length === 0
          ? KEINE
          : await beschreibeAbgelehnte(sync.abgelehnt, sync.zeilen, fall)

      if (aktuell) {
        setzeAbgelehnt(beschrieben)
      }
    })()

    return () => {
      aktuell = false
    }
  }, [fall, sync.abgelehnt, sync.zeilen])

  /**
   * Der Rechtskatalog, sobald der Bestand einmal wirklich vollständig ist (§8).
   *
   * Angelegt wird er bei der Fallanlage. Diese Stelle ist der zweite Anlauf für
   * die Fälle, bei denen das nicht durchkam: eine Verbindung, die mitten in der
   * Anlage abbrach, oder — sobald es die Vorsorge gibt (#15) — ein Übergang
   * nach `trauerfall`, den ein anderes Gerät vollzogen hat.
   *
   * **Erst nach dem Abgleich.** Vor dem ersten Abruf ist `zeilen` der Cache,
   * und ein leerer Cache heisst nicht, dass der Fall leer ist. Wer daraus
   * schlösse, es fehle der Katalog, legte ihn bei jedem Start erneut an — ohne
   * Duplikate, dank der deterministischen IDs, aber mit vierzig
   * Schreibversuchen, die alle nichts tun.
   *
   * **Und höchstens einmal je Fall.** Der Bestand ändert sich mit jedem Delta;
   * ein zweiter Lauf brächte nur dieselbe Feststellung. Was danach fehlt, hat
   * jemand gelöscht, und gelöscht bleibt gelöscht (§5).
   */
  const instanziiert = useRef<string | null>(null)

  useEffect(() => {
    if (!sync.abgeglichen || fall.katalogVersion === null || instanziiert.current === fall.id) {
      return
    }

    instanziiert.current = fall.id

    void (async () => {
      try {
        await instanziiereKatalog(
          supabaseInhalte(zugang()),
          fall,
          sync.zeilen.map((zeile) => zeile.id),
        )
      } catch {
        /*
         * Kein Wurf und keine Mitteilung. Was hier scheitert, ist entweder das
         * Netz — dann kommt die nächste Runde ohnehin — oder ein Katalogstand,
         * den dieser Build nicht kennt. Im zweiten Fall wäre die Meldung eine
         * Zumutung: Angehörige können daran nichts ändern, und die Aufgaben
         * eines anderen Mitglieds kommen mit dem nächsten Delta von selbst.
         */
        instanziiert.current = null
      }
    })()
  }, [fall, sync.abgeglichen, sync.zeilen, zugang])

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
