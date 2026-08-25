import type { ComponentPropsWithoutRef, ReactNode } from 'react'
import { Link } from 'react-router-dom'
import stile from './Liste.module.css'

/**
 * Gruppierte Liste: eine Flaeche, Zeilen durch Haarlinien getrennt.
 *
 * Bis hierher war jeder Eintrag eine eigene Karte mit eigenem Rand, eigenem
 * Radius und eigenem Polster. Auf einem Telefon standen dadurch drei Aufgaben
 * auf einem ganzen Bildschirm, und ein Profil mit fuenf Abschnitten war eine
 * Kolonne aus fuenf weissen Kaesten. Eine Liste ist aber eine Sache und nicht
 * n Sachen: eine Flaeche, darin Zeilen. Das ist auf jedem Telefon dieselbe
 * Form, und sie kostet pro Eintrag eine Linie statt eines Rahmens.
 */
export function Liste({ className, children, ...rest }: ComponentPropsWithoutRef<'ul'>) {
  return (
    <ul className={[stile.liste, className].filter(Boolean).join(' ')} {...rest}>
      {children}
    </ul>
  )
}

/**
 * Ein Abschnitt: kleine Ueberschrift, die Liste, darunter ein Satz Erklaerung.
 *
 * Die Erklaerung steht unter der Liste und nicht darueber, und das ist der
 * Punkt: Wer weiss, was er sucht, liest die Zeilen und sonst nichts. Vorher
 * standen dort vier Zeilen Fliesstext vor jeder Schaltflaeche, und man musste
 * sie ueberspringen, um an die Sache zu kommen.
 */
export function Gruppe({
  titel,
  neben,
  fussnote,
  children,
}: {
  /**
   * Faellt weg, wo die einzige Zeile der Gruppe schon so heisst. "Fall
   * verlassen" ueber einer Zeile "Fall verlassen" ist keine Ueberschrift,
   * sondern dasselbe Wort zweimal.
   */
  titel?: string
  /** Was rechts neben dem Titel steht, etwa ein Badge. */
  neben?: ReactNode
  /** Ein Satz unter der Liste. Laenger sollte er nicht werden. */
  fussnote?: ReactNode
  children: ReactNode
}) {
  return (
    <section className={stile.gruppe}>
      {titel === undefined && neben === undefined ? null : (
        <div className={stile.gruppenkopf}>
          {titel === undefined ? null : <h2 className={stile.gruppentitel}>{titel}</h2>}
          {neben}
        </div>
      )}
      {children}
      {fussnote === undefined ? null : <p className={stile.fussnote}>{fussnote}</p>}
    </section>
  )
}

/** Eine Zeile in der Liste. Was darin steht, entscheidet der Screen. */
export function Zeile({ className, children, ...rest }: ComponentPropsWithoutRef<'li'>) {
  return (
    <li className={[stile.zeile, className].filter(Boolean).join(' ')} {...rest}>
      {children}
    </li>
  )
}

/**
 * Eine Zeile, die woandershin fuehrt: Text links, Winkel rechts, die ganze
 * Zeile ist die Trefferflaeche.
 */
export function Navizeile({
  titel,
  meta,
  ziel,
  vorleseText,
}: {
  titel: ReactNode
  meta?: ReactNode
  ziel: string
  /** Ergaenzt den vorgelesenen Namen, wenn der Titel allein nicht reicht. */
  vorleseText?: string
}) {
  return (
    <li className={stile.zeile}>
      <Link className={stile.navi} to={ziel}>
        <span className={stile.spalte}>
          <span className={stile.titel}>
            {titel}
            {vorleseText === undefined ? null : (
              <span className="nur-vorlesen">{vorleseText}</span>
            )}
          </span>
          {meta === undefined ? null : <span className={stile.meta}>{meta}</span>}
        </span>
        <Winkel />
      </Link>
    </li>
  )
}

/** Der Winkel am Zeilenende: „hier geht es weiter". */
export function Winkel() {
  return (
    <svg
      className={stile.winkel}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m9 5 7 7-7 7" />
    </svg>
  )
}

/**
 * Der Weg ins Detail als eigene Trefferflaeche neben dem Haekchen.
 *
 * Das Haekchen und der Weg ins Detail sind zwei Ziele in derselben Zeile, und
 * verschachteln lassen sie sich nicht: Ein `input` in einem `a` ist fuer
 * Tastatur und Vorlesestimme ein Ziel, das zwei Dinge tut. Sie stehen deshalb
 * nebeneinander, und der Winkel bekommt seine eigenen 44 px.
 */
export function Detailziel({ ziel, titel }: { ziel: string; titel: string }) {
  return (
    <Link className={stile.detail} to={ziel} aria-label={`Details: „${titel}“`}>
      <Winkel />
    </Link>
  )
}
