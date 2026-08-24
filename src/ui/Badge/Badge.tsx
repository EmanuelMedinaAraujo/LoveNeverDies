import type { ComponentPropsWithoutRef } from 'react'
import stile from './Badge.module.css'

/**
 * Kleine Auszeichnung, in dieser App vor allem für Fristen (DESIGN.md §7).
 *
 * Drei Lagen, drei Farbpaare (§12): in Ruhe, knapp, abgelaufen. Die Farbe ist
 * die Abkürzung und nie die Aussage: Der Text sagt dasselbe ("noch 3 Tage",
 * "seit 4 Tagen überfällig"), damit die Angabe auch dann ankommt, wenn jemand
 * die Farben nicht unterscheiden kann oder sie vorgelesen bekommt.
 *
 * `hinweis` ist die vierte Lage und keine Frist: Sie trägt den Freigabe-Hinweis
 * aus §3.6 ("Freigabe nötig") in der Akzentfarbe. Eine eigene Komponente dafür
 * wären zwei Pillen mit zwei Radien und zwei Schriftgrößen; dieselbe Form mit
 * einer weiteren Farbe ist die kleinere Behauptung. Dass sie mit den drei
 * Fristenlagen nicht zu verwechseln ist, entscheidet auch hier der Text.
 */

export type Badgelage = 'ruhig' | 'knapp' | 'abgelaufen' | 'hinweis'

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
