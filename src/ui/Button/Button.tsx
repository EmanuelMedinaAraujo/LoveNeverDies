import type { ComponentPropsWithoutRef } from 'react'
import stile from './Button.module.css'

/**
 * Schaltflaeche (DESIGN.md §7).
 *
 * Zusage ist hier eingebaut statt in jedem Screen wiederholt:
 * der Text zum Vorlesen.
 *
 * Drei Varianten. `primaer` und `sekundaer` sind die Schaltflaechen, die einen
 * Ablauf tragen; sie stehen in Formularen und unter Bestaetigungsfragen.
 * `text` ist die dritte, und sie gibt es, weil eine Listenzeile vier davon
 * nebeneinander stellen kann. Vier umrandete Kaesten in einer Zeile machen aus
 * einer Liste eine Werkzeugleiste; als Text stehen dieselben vier Aktionen da,
 * ohne die Zeile zu uebertoenen. Die Trefferflaeche bleibt in allen drei
 * Varianten dieselbe.
 */

type ButtonProps = ComponentPropsWithoutRef<'button'> & {
  variante?: 'primaer' | 'sekundaer' | 'text'
  volleBreite?: boolean
  /**
   * Zusaetzlicher Text zum Vorlesen (§7). Pflicht, sobald die Schaltflaeche
   * kein sichtbares Label traegt. Sonst hoert eine blinde Person "Schaltflaeche"
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
