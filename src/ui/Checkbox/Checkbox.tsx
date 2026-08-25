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
 *
 * `nurKaestchen` dreht genau das um, und zwar fuer die Aufgabenlisten: Dort
 * fuehrt die ganze Zeile in das Aufgabendetail, und ein Tipp auf den Titel
 * soll dorthin fuehren und nicht die Aufgabe abhaken. Abgehakt wird dann nur
 * ueber das Kaestchen selbst. Umgesetzt mit `pointer-events` und nicht mit
 * einem `<label for>` neben dem Feld: Die Beschriftung bleibt so im Element
 * stehen, der zugaengliche Name aendert sich nicht, und Tastatur und
 * Bildschirmleser merken von der Umstellung nichts.
 */

type CheckboxProps = Omit<ComponentPropsWithoutRef<'input'>, 'type' | 'children'> & {
  label: ReactNode
  /** Nur das Kaestchen ist anzutippen, nicht die Beschriftung. */
  nurKaestchen?: boolean
}

export function Checkbox({ label, className, nurKaestchen = false, ...rest }: CheckboxProps) {
  return (
    <label
      className={[stile.zeile, nurKaestchen ? stile.nurKaestchen : null, className]
        .filter(Boolean)
        .join(' ')}
    >
      <input type="checkbox" className={stile.feld} {...rest} />
      <span className={stile.beschriftung}>{label}</span>
    </label>
  )
}
