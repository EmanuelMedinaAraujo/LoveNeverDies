import type { ComponentPropsWithoutRef, ReactNode } from 'react'
import stile from './Card.module.css'

type CardProps = ComponentPropsWithoutRef<'section'> & {
  /**
   * Die Ueberschrift des Abschnitts, in der Karte statt darueber (§7).
   *
   * Vorher stand sie als `Gruppe titel` ueber der Flaeche: klein, grau und
   * ausserhalb dessen, was sie benennt. In einer Spalte aus sechs Karten sah
   * das aus wie sechs Etiketten mit sechs Kaesten daneben, und man musste bei
   * jedem einmal hinsehen, welches zu welchem gehoert. Ein Titel gehoert in
   * die Sache, die er benennt, und weil er der Titel ist, ist er auch der
   * groesste Text darin.
   */
  titel?: ReactNode
}

/** Flaeche fuer zusammengehoerende Inhalte. Masse und Farben aus den Tokens (§7, §12). */
export function Card({ titel, className, children, ...rest }: CardProps) {
  return (
    <section className={[stile.card, className].filter(Boolean).join(' ')} {...rest}>
      {titel === undefined ? null : <h2 className={stile.titel}>{titel}</h2>}
      {children}
    </section>
  )
}
