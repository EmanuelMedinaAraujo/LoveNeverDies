import { useState, type FormEvent } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { useAuth } from '../../../core/auth/authProvider.ts'
import { alsNachricht } from '../../../core/fehler.ts'
import { useCase } from '../../../hooks/useCase.ts'
import { Button } from '../../../ui/Button/Button.tsx'
import { Card } from '../../../ui/Card/Card.tsx'
import { Zurueck } from '../../../ui/Zurueck/Zurueck.tsx'
import stile from './Vorsorge.module.css'

/**
 * Einen Vorsorgefall anlegen (DESIGN.md §2, §3.5).
 *
 * Der Fall gilt für die eigene Person, hat keine Aufgaben und versiegelt den
 * Tresor. Der Schlüssel K_v liegt nur auf den Geräten der anlegenden Person.
 */
export function Vorsorge() {
  const { zustand, legeVorsorgefallAn } = useCase()
  const { zustand: authZustand } = useAuth()
  const navigate = useNavigate()

  /*
   * Vorbelegt wird nur ein wirklich hinterlegter Name (§3.3).
   *
   * Frueher stand hier ersatzweise die E-Mail-Adresse, und wer sie stehen
   * liess — die meisten, denn ein vorausgefuelltes Feld liest sich wie eine
   * Auskunft der App —, legte seinen Vorsorgefall auf
   * `k7f3x9a2b1@privaterelay.appleid.com" an. Der Fallname steht danach in
   * jeder Ueberschrift und in jedem Kopplungsangebot.
   *
   * Steht kein Name bereit, bleibt das Feld leer und der Platzhalter sagt, was
   * hineingehoert (`core/auth/clerkAdapter.tsx`).
   */
  const standardName =
    authZustand.status === 'angemeldet' ? authZustand.benutzer.anzeigename.trim() : ''

  const [personName, setzePersonName] = useState(standardName)
  const [laeuft, setzeLaeuft] = useState(false)
  const [fehler, setzeFehler] = useState<string | null>(null)

  async function absenden(ereignis: FormEvent) {
    ereignis.preventDefault()
    setzeLaeuft(true)
    setzeFehler(null)

    try {
      await legeVorsorgefallAn({ personName: personName.trim() })
      navigate('/nachlass', { replace: true })
    } catch (ursache) {
      setzeFehler(alsNachricht(ursache))
      setzeLaeuft(false)
    }
  }

  if (zustand.status === 'bereit') {
    return <Navigate to="/" replace />
  }

  return (
    <main className={stile.seite}>
      <Zurueck ziel="/" />

      <div className={stile.kopf}>
        <h1>Für später vorsorgen</h1>
        <p className={stile.einleitung}>
          Legen Sie einen Vorsorgefall für sich selbst an. Dokumente und Zugangsdaten
          im Nachlass-Tresor bleiben verschlüsselt, bis Angehörige den Trauerfall bestätigen.
        </p>
      </div>

      <Card>
        <form className={stile.formular} onSubmit={(ereignis) => void absenden(ereignis)}>
          <div className={stile.feld}>
            <label htmlFor="vorsorge-name">Ihr Name</label>
            <input
              id="vorsorge-name"
              className={stile.eingabe}
              value={personName}
              onChange={(ereignis) => setzePersonName(ereignis.target.value)}
              placeholder="Vor- und Nachname"
              required
              autoFocus
            />
          </div>

          <Button type="submit" volleBreite disabled={laeuft}>
            Vorsorge anlegen
          </Button>

          {fehler === null ? null : (
            <p className={stile.hinweis} role="alert">
              Der Vorsorgefall konnte nicht angelegt werden. {fehler}
            </p>
          )}
        </form>
      </Card>
    </main>
  )
}
