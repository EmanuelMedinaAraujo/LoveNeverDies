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
  /**
   * Was rechts neben dem Titel steht: ein Badge, oder die eine Aktion, die zu
   * dieser Karte gehoert.
   *
   * Rechts neben dem Titel und nicht unter dem Inhalt, weil eine Aktion, die
   * eine Liste ergaenzt, am Anfang der Liste zu finden sein muss und nicht
   * hinter ihr. Auf einem Telefon steht "hinter der Liste" naemlich unter dem
   * unteren Bildschirmrand, sobald die Liste laenger als drei Zeilen ist.
   */
  neben?: ReactNode
}

/** Flaeche fuer zusammengehoerende Inhalte. Masse und Farben aus den Tokens (§7, §12). */
export function Card({ titel, neben, className, children, ...rest }: CardProps) {
  return (
    <section className={[stile.card, className].filter(Boolean).join(' ')} {...rest}>
      {titel === undefined && neben === undefined ? null : (
        <div className={[stile.kopf, neben === undefined ? null : stile.mitAktion].filter(Boolean).join(' ')}>
          {titel === undefined ? null : <h2 className={stile.titel}>{titel}</h2>}
          {neben}
        </div>
      )}
      {children}
    </section>
  )
}
