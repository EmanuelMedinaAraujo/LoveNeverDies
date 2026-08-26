import { Link, useLocation, useNavigate } from 'react-router-dom'
import stile from './Zurueck.module.css'

/**
 * Der Weg zurueck, oben links (DESIGN.md §7).
 *
 * Er steht auf den linearen Screens und nur dort: Aufgabendetail, Todesfall,
 * Vorsorge, Koppeln, Beitreten, Fragebaum, Nachlass-Tresor. Die vier
 * Hauptscreens haben die untere Leiste, und ein zweiter Weg neben ihr waere
 * eine zweite Navigation mit einer anderen Antwort auf dieselbe Frage.
 *
 * Vorher trug jeder dieser Screens seinen eigenen Textlink, verschieden
 * benannt ("Zurueck zu allen Aufgaben", "Zurueck zu Profil", "Zurueck") und
 * verschieden platziert, mal oben, mal am Ende einer langen Seite. Wer sich
 * verlaufen hat, sucht den Weg zurueck nicht unten.
 *
 * **Ein Link und trotzdem die Historie.** Das Element ist ein `<a>` mit echtem
 * `href`: Es laesst sich in einem neuen Tab oeffnen, es liest sich als Link
 * vor, und ohne JavaScript fuehrt es trotzdem irgendwohin. Ein gewoehnlicher
 * Klick geht aber `history.back()`, denn nur die Historie weiss, ob jemand aus
 * "Alle" oder von "Start" hereingekommen ist. Das `ziel` ist der Ausweg fuer
 * den Fall, dass es keine Historie gibt: ein geteilter Link, ein Lesezeichen,
 * eine installierte App, die auf dieser Adresse neu startet.
 *
 * Ob es eine Historie gibt, sagt `location.key`: Der Router vergibt jedem
 * Eintrag einen Schluessel und nennt genau den ersten `default`. Steht er da,
 * ist dieser Screen der Einstieg dieser Sitzung, und `navigate(-1)` fuehrte
 * aus der App heraus -- im installierten Zustand auf einen leeren Bildschirm.
 *
 * **Wo die Historie das falsche Versprechen gibt.** Ein Screen kann beim
 * Navigieren `state.zurueck` mitgeben und damit sagen: Von hier fuehrt der Weg
 * zurueck nicht dorthin, wo der Klick herkam. Der Fragebaum tut das, wenn er
 * eine angelegte Aufgabe oeffnet -- er ist ein Ablauf, aus dem man
 * herauskommt, und wer die Aufgabe gesehen hat, will danach zu den Aufgaben
 * und nicht mitten in den Baum zurueck. Der Eintrag wird dabei ersetzt: Die
 * Aufgabe bleibt sonst zwischen Uebersicht und Baum stehen, und der
 * Zurueck-Knopf des Browsers fuehrte durch dasselbe Detail ein zweites Mal.
 */
export function Zurueck({
  ziel,
  beschriftung = 'Zurück',
}: {
  /** Wohin, wenn es keine Historie gibt. */
  ziel: string
  /** Nur setzen, wo "Zurück" allein zu wenig sagt. */
  beschriftung?: string
}) {
  const navigate = useNavigate()
  const { key, state } = useLocation()
  /*
   * Das erzwungene Ziel des Screens, der hierher navigiert hat. Es gewinnt
   * gegen die Historie und gegen `ziel`: Nur der Weg herein weiss, ob der Weg
   * zurueck derselbe sein soll.
   */
  const erzwungen = (state as { zurueck?: unknown } | null)?.zurueck
  const ausweg = typeof erzwungen === 'string' ? erzwungen : null

  function zurueck(ereignis: React.MouseEvent<HTMLAnchorElement>) {
    // Ein Klick mit Zusatztaste oder mit der mittleren Maustaste gehoert dem
    // Browser: Er soll das `href` in einem neuen Tab oeffnen duerfen.
    if (
      ereignis.defaultPrevented ||
      ereignis.button !== 0 ||
      ereignis.metaKey ||
      ereignis.ctrlKey ||
      ereignis.shiftKey ||
      ereignis.altKey
    ) {
      return
    }

    if (ausweg !== null) {
      ereignis.preventDefault()
      navigate(ausweg, { replace: true })
      return
    }

    if (key !== 'default') {
      ereignis.preventDefault()
      navigate(-1)
    }
  }

  return (
    <Link to={ausweg ?? ziel} className={stile.zurueck} onClick={zurueck}>
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
        <path d="M15 19 8 12l7-7" />
      </svg>
      {beschriftung}
    </Link>
  )
}
