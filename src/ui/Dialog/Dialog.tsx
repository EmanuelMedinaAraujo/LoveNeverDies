import { useCallback, useEffect, useId, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Button } from '../Button/Button.tsx'
import stile from './Dialog.module.css'

/**
 * Ein Dialog ueber der Seite (DESIGN.md §7).
 *
 * Er gibt es fuer die zwei Faelle, in denen ein Screen etwas fragen oder
 * aufnehmen muss, ohne die Liste darunter zu verlieren: die Rueckfrage vor dem
 * Loeschen und das Formular hinter dem Plus. Beides stand vorher als Abschnitt
 * *in* der Seite -- die Rueckfrage ganz unten, das Formular ganz oben --, und
 * beides hatte denselben Fehler: Wer auf einem Telefon "Loeschen" tippt,
 * scrollt danach zu der Frage, die er selbst ausgeloest hat, und wer eine
 * Aufgabe anlegen will, schiebt sich das Formular durch jede Liste, in der er
 * nur nachsehen wollte.
 *
 * Die Kopfzeile ist immer gleich besetzt: links der Weg heraus, rechts die
 * Aktion, in der Mitte, wovon die Rede ist. Das ist die Anordnung, die jedes
 * Telefonbetriebssystem seit Jahren fuer genau diesen Zweck benutzt, und sie
 * ist an dieser Stelle wichtiger als eine eigene Idee: Wer das Kreuz sucht,
 * sucht es links oben.
 *
 * `aria-modal` und der Fokus im Dialog gehoeren zusammen. Ohne den zweiten Teil
 * waere das Attribut eine Behauptung: Eine Vorlesestimme saehe einen Dialog,
 * die Tabulatortaste liefe aber weiter durch die Seite dahinter, die niemand
 * mehr bedienen kann.
 */

/** Das Kreuz oben links: „hier geht es wieder heraus". */
function Kreuz() {
  return (
    <svg
      className={stile.kreuz}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m6 6 12 12M18 6 6 18" />
    </svg>
  )
}

/** Was die Tabulatortaste innerhalb des Dialogs erreichen kann. */
const FOKUSSIERBAR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

export function Dialog({
  titel,
  aufSchliessen,
  schliessenText = 'Abbrechen',
  kopfaktion,
  children,
}: {
  /** Wovon die Rede ist. Steht als Ueberschrift und benennt den Dialog (§7). */
  titel: string
  aufSchliessen: () => void
  /** Der vorgelesene Name des Kreuzes. „Abbrechen", wo nichts Besseres passt. */
  schliessenText?: string
  /** Was oben rechts steht: die eine Aktion, wegen der der Dialog offen ist. */
  kopfaktion?: ReactNode
  children: ReactNode
}) {
  const titelId = useId()
  const flaeche = useRef<HTMLDivElement>(null)

  /** Haelt die Referenz stabil, solange der Aufrufer sie stabil haelt. */
  const schliesse = useCallback(() => aufSchliessen(), [aufSchliessen])

  /*
   * Zwei Effekte und nicht einer: Der obere haengt an nichts und laeuft genau
   * einmal -- der Fokus soll nicht zurueckspringen, weil ein Aufrufer sein
   * `aufSchliessen` inline geschrieben hat und bei jedem Tastendruck im
   * Formular eine neue Funktion mitgibt. Der untere darf das, er haengt nur
   * einen Listener um.
   */
  useEffect(() => {
    const vorher = document.activeElement
    const koerper = document.body.style.overflow

    /*
     * Die Seite darunter scrollt nicht mit. Auf einem Telefon ist das der
     * Unterschied zwischen einem Dialog und einer Schicht, unter der die Liste
     * wegrutscht, sobald der Finger daneben liegt.
     */
    document.body.style.overflow = 'hidden'

    /*
     * Nur, wenn nicht schon etwas darin den Fokus hat: Ein Formular mit
     * `autoFocus` auf dem ersten Feld ist beim Aufbau schneller als dieser
     * Effekt (Kindeffekte laufen vor Elterneffekten), und der Dialog naehme
     * dem Feld den Fokus wieder weg -- die Tastatur ginge auf und die
     * Schreibmarke stuende nirgends.
     */
    if (flaeche.current !== null && !flaeche.current.contains(document.activeElement)) {
      flaeche.current.focus()
    }

    return () => {
      document.body.style.overflow = koerper

      // Zurueck auf die Schaltflaeche, die den Dialog geoeffnet hat. Sonst
      // faengt die Tabulatortaste danach wieder ganz oben an.
      if (vorher instanceof HTMLElement) {
        vorher.focus()
      }
    }
  }, [])

  useEffect(() => {
    function beiTaste(ereignis: KeyboardEvent) {
      if (ereignis.key === 'Escape') {
        ereignis.preventDefault()
        schliesse()
        return
      }

      if (ereignis.key !== 'Tab' || flaeche.current === null) {
        return
      }

      const ziele = [...flaeche.current.querySelectorAll<HTMLElement>(FOKUSSIERBAR)]

      if (ziele.length === 0) {
        return
      }

      const erstes = ziele.at(0)
      const letztes = ziele.at(-1)

      if (erstes === undefined || letztes === undefined) {
        return
      }

      // Vor dem ersten und hinter dem letzten Ziel geht es im Kreis weiter,
      // statt in die Seite dahinter, die gerade niemand bedienen kann.
      if (ereignis.shiftKey && document.activeElement === erstes) {
        ereignis.preventDefault()
        letztes.focus()
      } else if (!ereignis.shiftKey && document.activeElement === letztes) {
        ereignis.preventDefault()
        erstes.focus()
      }
    }

    document.addEventListener('keydown', beiTaste)

    return () => document.removeEventListener('keydown', beiTaste)
  }, [schliesse])

  return createPortal(
    <div className={stile.hintergrund}>
      <div
        className={stile.flaeche}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titelId}
        ref={flaeche}
        tabIndex={-1}
      >
        <div className={stile.kopf}>
          <Button
            variante="text"
            className={stile.schliessen}
            onClick={schliesse}
            vorleseText={schliessenText}
          >
            <Kreuz />
          </Button>

          <h2 className={stile.titel} id={titelId}>
            {titel}
          </h2>

          <div className={stile.kopfaktion}>{kopfaktion}</div>
        </div>

        {/*
          Nur der Inhalt scrollt, nicht die Kopfzeile: Speichern und Abbrechen
          bleiben erreichbar, auch wenn das Formular laenger ist als das
          Telefon hoch. Der zweite Speichern-Knopf steht trotzdem am Ende --
          wer von oben nach unten ausfuellt, hoert unten auf.
        */}
        <div className={stile.inhalt}>{children}</div>
      </div>
    </div>,
    document.body,
  )
}
