import { useState, type ReactNode } from 'react'
import { Button } from '../Button/Button.tsx'
import stile from './Klapp.module.css'

/**
 * Ein Aufklapp-Element: zu, bis jemand tippt.
 *
 * Dasselbe Muster wie das gleichnamige, lokale Element im Fragebaum
 * (`screens/shared/Fragebaum/Fragebaum.tsx`): eine Schaltfläche mit
 * `aria-expanded` statt eines eigenen Zustands mit eigener Ansage. Der Browser
 * kennt die Rolle und die Vorlesestimme sagt "eingeklappt"/"ausgeklappt" von
 * selbst.
 *
 * Hier als eigene, wiederverwendbare Komponente unter `src/ui/`, weil mehr als
 * ein Screen etwas aus dem Weg räumt, ohne es verschwinden zu lassen: erledigte
 * Aufgaben in "Meine Aufgaben" und "Alle Aufgaben", in beiden Ansichten.
 * Verschwinden dürfen sie nicht — nur zu Anfang nicht im Weg stehen.
 */
export function Klapp({
  titel,
  offenText,
  children,
}: {
  /** Steht, solange zu ist, z.B. "3 erledigte Aufgaben anzeigen". */
  titel: string
  /** Steht, sobald offen ist. Fällt auf `titel` zurück, wenn nicht gesetzt. */
  offenText?: string
  children: ReactNode
}) {
  const [offen, setzeOffen] = useState(false)

  return (
    <div className={stile.klapp}>
      <Button
        variante="text"
        className={stile.knopf}
        aria-expanded={offen}
        onClick={() => setzeOffen((vorher) => !vorher)}
      >
        <span>{offen ? (offenText ?? titel) : titel}</span>
        <svg
          className={[stile.pfeil, offen ? stile.pfeilOffen : ''].filter(Boolean).join(' ')}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </Button>
      {offen ? children : null}
    </div>
  )
}
