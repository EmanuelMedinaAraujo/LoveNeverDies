import { useState, type FormEvent } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { alsNachricht } from '../../../core/fehler.ts'
import { useCase } from '../../../hooks/useCase.ts'
import { Button } from '../../../ui/Button/Button.tsx'
import { Card } from '../../../ui/Card/Card.tsx'
import stile from './Todesfall.module.css'

/**
 * Einen Trauerfall anlegen (DESIGN.md §2, §3.1).
 *
 * Name und Sterbedatum verlassen dieses Formular nur verschlüsselt: Der
 * Kryptokern in `fallService` erzeugt `K_c` und `K_cat` und wrappt beide an
 * dieses Gerät, bevor irgendetwas beim Server ankommt.
 */
export function Todesfall() {
  const { zustand, legeTrauerfallAn } = useCase()
  const navigate = useNavigate()

  const [personName, setzePersonName] = useState('')
  const [sterbedatum, setzeSterbedatum] = useState('')
  const [laeuft, setzeLaeuft] = useState(false)
  const [fehler, setzeFehler] = useState<string | null>(null)

  async function absenden(ereignis: FormEvent) {
    ereignis.preventDefault()
    setzeLaeuft(true)
    setzeFehler(null)

    try {
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
