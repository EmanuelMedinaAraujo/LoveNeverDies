import { useState, type FormEvent } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { alsNachricht } from '../../../core/fehler.ts'
import { useCase } from '../../../hooks/useCase.ts'
import { useProfilAbgleich } from '../../../hooks/useProfil.ts'
import { Button } from '../../../ui/Button/Button.tsx'
import { Card } from '../../../ui/Card/Card.tsx'
import { Zurueck } from '../../../ui/Zurueck/Zurueck.tsx'
import stile from './Todesfall.module.css'

/**
 * Einen Trauerfall anlegen (DESIGN.md §2, §3.1, §3.3).
 *
 * Name und Sterbedatum der verstorbenen Person verlassen dieses Formular nur
 * verschlüsselt: Der Kryptokern in `fallService` erzeugt `K_c` und `K_cat` und
 * wrappt beide an dieses Gerät, bevor irgendetwas beim Server ankommt.
 *
 * Der eigene Name steht daneben und geht einen anderen Weg: Er gehört nicht in
 * den Fall, sondern in `profiles`, und dort liegt er im Klartext (§3.3). Das
 * ist die eine bewusste Verbreiterung dieser App, und §6 nennt ihren Zweck:
 * Wer später jemanden einlädt, wird auf dem Telefon des anderen mit diesem
 * Namen angekündigt.
 *
 * Gefragt wird auf demselben Screen und nicht auf einem eigenen. Es sind zwei
 * Namen in einem Zusammenhang — „für wen" und „von wem" —, und die Person, um
 * die es hier geht, füllt zwei Tage nach einem Todesfall kein zweites Formular
 * aus, das sie nicht erwartet hat. Steht der Name schon bei Clerk, steht er
 * hier vorausgefüllt: dann ist es eine Bestätigung und keine Frage.
 */
export function Todesfall() {
  const { zustand, legeTrauerfallAn } = useCase()
  const { name: hinterlegterName, speichereNamen } = useProfilAbgleich()
  const navigate = useNavigate()

  const [personName, setzePersonName] = useState('')
  const [sterbedatum, setzeSterbedatum] = useState('')
  const [laeuft, setzeLaeuft] = useState(false)
  const [fehler, setzeFehler] = useState<string | null>(null)

  /*
   * `null` heißt „hier hat noch niemand hineingeschrieben", und dann steht der
   * hinterlegte Name da. Kein Zustand, der beim Laden nachgefüllt wird: Der
   * Name kommt aus einer Abfrage und ist beim ersten Rendern noch nicht da,
   * und ein Feld, das eine Sekunde nach dem ersten Tastendruck seinen Inhalt
   * austauscht, ist schlimmer als eines, das leer bleibt.
   */
  const [getippt, setzeGetippten] = useState<string | null>(null)
  const eigenerName = getippt ?? hinterlegterName

  async function absenden(ereignis: FormEvent) {
    ereignis.preventDefault()
    setzeLaeuft(true)
    setzeFehler(null)

    try {
      /*
       * Der eigene Name zuerst: Er ist der billigere Schritt und der einzige,
       * der sich wiederholen lässt. Scheitert er, ist noch kein Fall
       * angelegt, und der zweite Versuch ist derselbe Knopf. Umgekehrt stünde
       * ein Fall da, dessen Anlegerin für die anderen namenlos bleibt.
       */
      if (eigenerName.trim() !== hinterlegterName) {
        await speichereNamen(eigenerName)
      }

      await legeTrauerfallAn({ personName, sterbedatum })
      navigate('/', { replace: true })
    } catch (ursache) {
      setzeFehler(alsNachricht(ursache))
      setzeLaeuft(false)
    }
  }

  // Wer schon einen Fall hat, legt hier keinen zweiten an. Sonst entstünde
  // eine verwaiste, für niemanden erreichbare zweite Zeile in `cases` (§2).
  if (zustand.status === 'bereit') {
    return <Navigate to="/" replace />
  }

  return (
    <main className={stile.seite}>
      <Zurueck ziel="/" />

      <div className={stile.kopf}>
        <h1>Ein Todesfall ist eingetreten</h1>
        <p className={stile.einleitung}>
          Für wen legen wir diesen Fall an? Name und Sterbedatum bleiben verschlüsselt — niemand
          außer den Mitgliedern dieses Falls kann sie lesen.
        </p>
      </div>

      <Card>
        <form className={stile.formular} onSubmit={(ereignis) => void absenden(ereignis)}>
          <div className={stile.feld}>
            <label htmlFor="todesfall-name">Name der verstorbenen Person</label>
            <input
              id="todesfall-name"
              className={stile.eingabe}
              value={personName}
              onChange={(ereignis) => setzePersonName(ereignis.target.value)}
              required
              autoFocus
            />
          </div>

          <div className={stile.feld}>
            <label htmlFor="todesfall-sterbedatum">Sterbedatum</label>
            <input
              id="todesfall-sterbedatum"
              type="date"
              className={stile.eingabe}
              value={sterbedatum}
              onChange={(ereignis) => setzeSterbedatum(ereignis.target.value)}
              required
            />
          </div>

          <div className={stile.feld}>
            <label htmlFor="todesfall-eigener-name">Ihr Name</label>
            <input
              id="todesfall-eigener-name"
              className={stile.eingabe}
              value={eigenerName}
              onChange={(ereignis) => setzeGetippten(ereignis.target.value)}
              placeholder="Vor- und Nachname"
              autoComplete="name"
              required
            />
            <p className={stile.hinweis}>
              Unter diesem Namen erscheinen Sie bei den Angehörigen, die Sie später einladen.
            </p>
          </div>

          <Button type="submit" volleBreite disabled={laeuft}>
            Fall anlegen
          </Button>

          {fehler === null ? null : (
            <p className={stile.hinweis} role="alert">
              Der Fall war nicht anzulegen. {fehler}
            </p>
          )}
        </form>
      </Card>
    </main>
  )
}
