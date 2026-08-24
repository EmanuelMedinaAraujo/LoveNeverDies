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
}

export function Checkbox({ label, className, ...rest }: CheckboxProps) {
  return (
    <label className={[stile.zeile, className].filter(Boolean).join(' ')}>
      <input type="checkbox" className={stile.feld} {...rest} />
      <span className={stile.beschriftung}>{label}</span>
    </label>
  )
}
