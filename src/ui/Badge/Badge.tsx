import type { ComponentPropsWithoutRef } from 'react'
import stile from './Badge.module.css'

/**
 * Kleine Auszeichnung, in dieser App vor allem für Fristen (DESIGN.md §7).
 *
 * Drei Lagen, drei Farbpaare (§12): in Ruhe, knapp, abgelaufen. Die Farbe ist
 * die Abkürzung und nie die Aussage — der Text sagt dasselbe („noch 3 Tage",
 * „seit 4 Tagen überfällig"), damit die Angabe auch dann ankommt, wenn jemand
 * die Farben nicht unterscheiden kann oder sie vorgelesen bekommt.
 */

export type Badgelage = 'ruhig' | 'knapp' | 'abgelaufen'

type BadgeProps = ComponentPropsWithoutRef<'span'> & {
  lage?: Badgelage
}

export function Badge({ lage = 'ruhig', className, children, ...rest }: BadgeProps) {
  return (
    <span className={[stile.badge, stile[lage], className].filter(Boolean).join(' ')} {...rest}>
      {children}
    </span>
  )
}
