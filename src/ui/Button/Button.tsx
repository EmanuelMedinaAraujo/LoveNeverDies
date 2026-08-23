import type { ComponentPropsWithoutRef } from 'react'
import stile from './Button.module.css'

/**
 * Schaltflaeche (DESIGN.md §7).
 *
 * Zwei Zusagen sind hier eingebaut statt in jedem Screen wiederholt:
 * das Touch-Ziel von mindestens 48 px und der Text zum Vorlesen.
 */

type ButtonProps = ComponentPropsWithoutRef<'button'> & {
  variante?: 'primaer' | 'sekundaer'
  volleBreite?: boolean
  /**
   * Zusaetzlicher Text zum Vorlesen (§7). Pflicht, sobald die Schaltflaeche
   * kein sichtbares Label traegt — sonst hoert eine blinde Person "Schaltflaeche"
   * und sonst nichts.
   */
  vorleseText?: string
}

export function Button({
  variante = 'primaer',
  volleBreite = false,
  vorleseText,
  className,
  type = 'button',
  children,
  ...rest
}: ButtonProps) {
  const klassen = [stile.button, stile[variante], volleBreite ? stile.volleBreite : null, className]
    .filter(Boolean)
    .join(' ')

  return (
    <button type={type} className={klassen} {...rest}>
      {children}
      {vorleseText ? <span className="nur-vorlesen">{vorleseText}</span> : null}
    </button>
  )
}
