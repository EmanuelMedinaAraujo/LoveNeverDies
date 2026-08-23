/**
 * Die Aufgaben eines Falls (DESIGN.md §3.3, §5, §7).
 *
 * Jede Änderung wird zweimal wirksam: sofort auf der angezeigten Liste und
 * danach noch einmal mit dem, was der Server zurückgibt.
 *
 * Das **Sofort** verlangt §5 — eine Mutation wird optimistisch lokal angewandt.
 * Ohne das springt ein gerade gesetztes Häkchen für die Dauer eines
 * Rundlaufs sichtbar zurück, und wer auf einem Telefon im Zug tippt, tippt
 * ein zweites Mal.
 *
 * Das **Danach** ist der Weg aus §3.1 in voller Länge: DEK entpacken, Payload
 * entschlüsseln. Was am Ende auf dem Bildschirm steht, hat ihn wirklich
 * durchlaufen, und ein abgelehnter Schreibvorgang nimmt sich damit von selbst
 * zurück — deshalb wird auch nach einem Fehlschlag neu geladen.
 *
 * Was hier noch **nicht** steht, ist die Offline-Queue aus §5: Eine Mutation
 * ohne Verbindung wird nicht angehängt, sondern scheitert sichtbar. Sie gehört
 * zum Sync-Slice.
 *
 * Muster für Laden, Fehler und Neuladen: `useCase.ts`.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabaseInhalte } from '../core/db/supabaseInhalte.ts'
import { useSupabase } from '../core/db/supabaseProvider.tsx'
import { alsNachricht } from '../core/fehler.ts'
import {
  ladeAufgaben,
  legeAufgabeAn as legeAufgabeAnDienst,
  loescheAufgabe as loescheAufgabeDienst,
  schreibeAufgabe as schreibeAufgabeDienst,
  type Aufgabe,
  type Aufgabenaenderung,
  type Aufgabenliste,
  type Fallschluessel,
} from '../services/aufgabenService.ts'

type Ergebnis = { wert: Aufgabenliste } | { nachricht: string }

export type AufgabenZustand =
  | { status: 'laedt' }
  | { status: 'fehler'; nachricht: string }
  | { status: 'bereit'; aufgaben: Aufgabe[]; uebersprungen: number }

export type Aufgabendaten = {
  zustand: AufgabenZustand
  legeAn: (titel: string) => Promise<void>
  schreibe: (aufgabe: Aufgabe, aenderung: Aufgabenaenderung) => Promise<void>
  hakeAb: (aufgabe: Aufgabe, erledigt: boolean) => Promise<void>
  loesche: (aufgabe: Aufgabe) => Promise<void>
}

export function useAufgaben(fall: Fallschluessel): Aufgabendaten {
  const zugang = useSupabase()

  const [ergebnis, setzeErgebnis] = useState<Ergebnis | null>(null)
  const [runde, setzeRunde] = useState(0)

  /**
   * Zählt die optimistisch angewandten Änderungen.
   *
   * Ein Abruf, der vor der jüngsten Änderung losgeschickt wurde, kennt sie
   * naturgemäß nicht. Träfe seine Antwort danach ein, überschriebe sie das
   * gerade gesetzte Häkchen mit dem Stand von davor — es spränge sichtbar
   * zurück, bis der eigene Abruf nachkommt. Deshalb merkt sich jeder Abruf den
   * Zählerstand seines Starts und verwirft sein Ergebnis, wenn inzwischen
   * jemand etwas angefasst hat.
   */
  const aenderungen = useRef(0)

  useEffect(() => {
    let aktuell = true
    const stand = aenderungen.current

    void (async () => {
      try {
        const liste = await ladeAufgaben(supabaseInhalte(zugang()), fall)

        if (aktuell && aenderungen.current === stand) {
          setzeErgebnis({ wert: liste })
        }
      } catch (fehler) {
        // Ein Fehlschlag wird immer gezeigt: Er gehört nicht der einen
        // Änderung, sondern dem Abruf, und ein verschluckter Fehler liesse
        // eine tote Liste stehen.
        if (aktuell) {
          setzeErgebnis({ nachricht: alsNachricht(fehler) })
        }
      }
    })()

    return () => {
      aktuell = false
    }
  }, [fall, runde, zugang])

  /**
   * Schreibt eine Änderung sofort in die angezeigte Liste (§5).
   *
   * Sie hält genau bis zum Ende des Rundlaufs. Danach steht dort, was der
   * Server hergibt — auch dann, wenn das etwas anderes ist als das, was hier
   * eingetragen wurde.
   */
  const wendeSofortAn = useCallback(
    (aendere: (aufgaben: Aufgabe[]) => Aufgabe[]) => {
      aenderungen.current += 1

      setzeErgebnis((vorher) =>
        vorher === null || 'nachricht' in vorher
          ? vorher
          : { wert: { ...vorher.wert, aufgaben: aendere(vorher.wert.aufgaben) } },
      )
    },
    [],
  )

  /**
   * Jede Mutation läuft über denselben Weg: ausführen, dann neu laden.
   *
   * Neu geladen wird auch nach einem Fehlschlag — das ist die Rücknahme der
   * optimistischen Anzeige und kostet nichts, weil der Server ohnehin gefragt
   * werden muss. Der Fehler selbst wird nicht abgefangen: Er gehört an die
   * Stelle, an der jemand gerade etwas getippt hat, denn §5 verlangt, dass
   * abgelehnte Änderungen nie stillschweigend verschwinden.
   */
  const mitNeuladen = useCallback(
    async (arbeit: (inhalte: ReturnType<typeof supabaseInhalte>) => Promise<void>) => {
      try {
        await arbeit(supabaseInhalte(zugang()))
      } finally {
        setzeRunde((vorher) => vorher + 1)
      }
    },
    [zugang],
  )

  const legeAn = useCallback(
    // Eine neue Aufgabe erscheint erst nach dem Rundlauf: Ihre `seq` und damit
    // ihr Platz in der Liste entstehen erst auf dem Server (§4).
    (titel: string) => mitNeuladen((inhalte) => legeAufgabeAnDienst(inhalte, fall, titel)),
    [fall, mitNeuladen],
  )

  const schreibe = useCallback(
    (aufgabe: Aufgabe, aenderung: Aufgabenaenderung) => {
      // Feld für Feld statt als Spread: Ein mitgeschicktes `undefined` soll
      // dasselbe bedeuten wie im Dienst — „bleibt, wie es war" — und nicht
      // hier das Feld leeren und beim nächsten Laden wieder auftauchen lassen.
      wendeSofortAn((aufgaben) =>
        aufgaben.map((kandidat) =>
          kandidat.id === aufgabe.id
            ? {
                ...kandidat,
                titel: aenderung.titel ?? kandidat.titel,
                beschreibung: aenderung.beschreibung ?? kandidat.beschreibung,
                erledigt: aenderung.erledigt ?? kandidat.erledigt,
              }
            : kandidat,
        ),
      )

      return mitNeuladen((inhalte) => schreibeAufgabeDienst(inhalte, aufgabe, aenderung))
    },
    [mitNeuladen, wendeSofortAn],
  )

  const hakeAb = useCallback(
    (aufgabe: Aufgabe, erledigt: boolean) => schreibe(aufgabe, { erledigt }),
    [schreibe],
  )

  const loesche = useCallback(
    (aufgabe: Aufgabe) => {
      wendeSofortAn((aufgaben) => aufgaben.filter((kandidat) => kandidat.id !== aufgabe.id))

      return mitNeuladen((inhalte) => loescheAufgabeDienst(inhalte, aufgabe))
    },
    [mitNeuladen, wendeSofortAn],
  )

  const zustand = useMemo<AufgabenZustand>(() => {
    if (ergebnis === null) {
      return { status: 'laedt' }
    }

    if ('nachricht' in ergebnis) {
      return { status: 'fehler', nachricht: ergebnis.nachricht }
    }

    return { status: 'bereit', ...ergebnis.wert }
  }, [ergebnis])

  return useMemo(
    () => ({ zustand, legeAn, schreibe, hakeAb, loesche }),
    [zustand, legeAn, schreibe, hakeAb, loesche],
  )
}
