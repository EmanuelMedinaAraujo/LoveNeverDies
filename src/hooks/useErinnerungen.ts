/**
 * Erinnerungen einplanen: lokal, nach jeder Synchronisation neu (DESIGN.md §7).
 *
 * Was geplant wird, entscheidet `services/erinnerungen.ts`; hier stehen die
 * Timer und die Benachrichtigung. Die Trennung ist nicht Ordnungsliebe: Der
 * Plan lässt sich so gegen eine feste Uhrzeit prüfen, und dieser Hook bleibt
 * klein genug, um ihn zu überblicken.
 *
 * Neu geplant wird bei jedem neuen Baum: Der entsteht aus den Zeilen, die
 * der Sync zuletzt geliefert hat. Eine abgehakte Aufgabe, eine gelöschte
 * Frist oder eine neue Unteraufgabe ziehen die Erinnerungen deshalb von selbst
 * nach. Ein Zeitgeber, der die Planung selbst anstösst, wäre eine zweite
 * Wahrheit daneben.
 *
 * Und es geht nichts über den Server: Er kennt die Fristen nicht (§3.3),
 * ein Push wäre gar nicht zu bilden. Was hier nicht läuft, weil das Gerät aus
 * ist, holt der nächste Start nach.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Aufgabenknoten } from '../services/aufgabenbaum.ts'
import { planeErinnerungen } from '../services/erinnerungen.ts'
import type { Fristbezug } from '../services/fristen.ts'

/**
 * Ob dieses Gerät erinnern darf.
 *
 * `nicht-verfuegbar` ist keine Störung: Ein Browser ohne Benachrichtigungen ist
 * ein Browser, in dem die App sonst vollständig funktioniert. Fristen stehen
 * ohnehin sichtbar in der Liste (§7).
 */
export type Erinnerungserlaubnis = 'nicht-verfuegbar' | 'ungefragt' | 'erteilt' | 'verweigert'

export type Erinnerungsdaten = {
  erlaubnis: Erinnerungserlaubnis
  /** Fragt einmal nach. Ohne Antwort bleibt alles, wie es ist. */
  frage: () => Promise<void>
  /** Wie viele Termine gerade eingeplant sind, für den Hinweis in der Oberfläche. */
  geplant: number
}

function verfuegbar(): boolean {
  return typeof Notification !== 'undefined'
}

function gelesen(): Erinnerungserlaubnis {
  if (!verfuegbar()) {
    return 'nicht-verfuegbar'
  }

  return Notification.permission === 'granted'
    ? 'erteilt'
    : Notification.permission === 'denied'
      ? 'verweigert'
      : 'ungefragt'
}

export function useErinnerungen(baum: Aufgabenknoten[], bezug: Fristbezug): Erinnerungsdaten {
  const [erlaubnis, setzeErlaubnis] = useState<Erinnerungserlaubnis>(gelesen)

  /*
   * Die einzelnen Daten und nicht der `bezug` als Objekt: Ein frisch gebautes
   * Objekt bei jedem Rendern plante sonst jedes Mal neu und stellte damit
   * sämtliche Timer neu, ohne dass sich etwas geändert hätte.
   */
  const { sterbedatum, kenntnisAm, anfechtungKenntnisAm } = bezug

  const termine = useMemo(
    () => planeErinnerungen(baum, { sterbedatum, kenntnisAm, anfechtungKenntnisAm }, new Date()),
    [baum, sterbedatum, kenntnisAm, anfechtungKenntnisAm],
  )

  useEffect(() => {
    if (erlaubnis !== 'erteilt') {
      return
    }

    const jetzt = Date.now()

    const timer = termine.map((termin) =>
      setTimeout(() => {
        /*
          * `tag` je Item: Zwei Erinnerungen zu derselben Aufgabe sollen einander
          * ersetzen und nicht übereinander liegen. Wer die App eine Woche nicht
          * öffnet, findet sonst vier Meldungen zur selben Frist.
          */
        new Notification(termin.text, { tag: `frist-${termin.itemId}` })
      }, Math.max(0, termin.wann - jetzt)),
    )

    return () => {
      for (const eintrag of timer) {
        clearTimeout(eintrag)
      }
    }
  }, [erlaubnis, termine])

  const frage = useCallback(async () => {
    if (!verfuegbar()) {
      return
    }

    try {
      await Notification.requestPermission()
    } catch {
      /*
        * Ältere Browser geben den Rückruf statt eines Promise und werfen hier.
        * Der Zustand wird gleich darauf ohnehin neu gelesen. Wenn nicht,
        * bleibt es bei "ungefragt", was stimmt.
        */
    }

    setzeErlaubnis(gelesen())
  }, [])

  return useMemo(
    () => ({ erlaubnis, frage, geplant: termine.length }),
    [erlaubnis, frage, termine.length],
  )
}
