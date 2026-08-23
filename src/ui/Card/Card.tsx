import type { ComponentPropsWithoutRef } from 'react'
import stile from './Card.module.css'

/** Flaeche fuer zusammengehoerende Inhalte. Masse und Farben aus den Tokens (§7, §12). */
export function Card({ className, children, ...rest }: ComponentPropsWithoutRef<'section'>) {
  return (
    <section className={[stile.card, className].filter(Boolean).join(' ')} {...rest}>
      {children}
    </section>
  )
}
