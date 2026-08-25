import type { ComponentPropsWithoutRef, ReactNode } from 'react'
import stile from './Checkbox.module.css'

/**
 * Haekchen (DESIGN.md §7).
 *
 * Ein echtes `input[type=checkbox]`, nur groesser gesetzt. Kein nachgebauter
 * Schalter aus `div` und `role`: Die Zielgruppe benutzt Bildschirmleser und
 * Tastaturen, und ein natives Element bringt Fokus, Tastensteuerung und
 * Ansage mit, ohne dass jemand daran denken muss.
 *
 * Die Beschriftung ist Pflicht und umschliesst das Feld. Damit trifft auch ein
 * ungenauer Fingertipp. Die Trefferflaeche ist die ganze Zeile, nicht das
 * Kaestchen.
 */

type CheckboxProps = Omit<ComponentPropsWithoutRef<'input'>, 'type' | 'children'> & {
  label: ReactNode
  /**
   * Haekt das Kaestchen etwas ab, das damit erledigt ist? Dann wird die
   * Beschriftung im angehakten Zustand durchgestrichen.
   *
   * Ausdruecklich zu setzen und nicht der Normalfall: Ein Haekchen waehlt oft
   * nur aus (wem eine Aufgabe gehoert, ob sie privat ist). Einen Namen
   * durchzustreichen, weil die Person zustaendig ist, liest sich wie
   * "gestrichen" und ist genau das Gegenteil des Gemeinten.
   */
  abhaken?: boolean
}

export function Checkbox({ label, className, abhaken = false, ...rest }: CheckboxProps) {
  return (
    <label
      className={[stile.zeile, abhaken ? stile.abhaken : null, className]
        .filter(Boolean)
        .join(' ')}
    >
      <input type="checkbox" className={stile.feld} {...rest} />
      <span className={stile.beschriftung}>{label}</span>
    </label>
  )
}
