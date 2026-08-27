import { useState, type FormEvent } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { alsNachricht } from '../../../core/fehler.ts'
import { useCase } from '../../../hooks/useCase.ts'
import { useProfilAbgleich } from '../../../hooks/useProfil.ts'
import { Button } from '../../../ui/Button/Button.tsx'
import { Card } from '../../../ui/Card/Card.tsx'
import { Zurueck } from '../../../ui/Zurueck/Zurueck.tsx'
import stile from './Vorsorge.module.css'

/**
 * Einen Vorsorgefall anlegen (DESIGN.md §2, §3.3, §3.5).
 *
 * Der Fall gilt für die eigene Person, hat keine Aufgaben und versiegelt den
 * Tresor. Der Schlüssel K_v liegt nur auf den Geräten der anlegenden Person.
 *
 * „Ihr Name" ist hier zweierlei zugleich, und beides landet an einer anderen
 * Stelle: Er ist der Name des Falls — verschlüsselt unter `K_c`, wie jeder
 * Fallname — und er ist der Name dieser Person in `profiles`, im Klartext und
 * mit Absicht (§3.3). Das zweite ist der Grund, warum das Feld nicht leer
 * bleiben darf: Ohne hinterlegten Namen gibt es keinen Kopplungscode (§6), und
 * ein Vorsorgefall ohne Angehörige ist ein Tresor, den niemand öffnen kann.
 */
export function Vorsorge() {
  const { zustand, legeVorsorgefallAn } = useCase()
  const { name: hinterlegterName, speichereNamen } = useProfilAbgleich()
  const navigate = useNavigate()

  const [laeuft, setzeLaeuft] = useState(false)
  const [fehler, setzeFehler] = useState<string | null>(null)

  /*
   * Vorbelegt wird nur ein wirklich hinterlegter Name (§3.3). `null` heißt
   * „hier hat noch niemand hineingeschrieben", und dann steht er da; der Name
   * kommt aus einer Abfrage und ist beim ersten Rendern noch nicht bekannt.
   *
   * Früher stand hier ersatzweise die E-Mail-Adresse, und wer sie stehen ließ
   * — die meisten, denn ein vorausgefülltes Feld liest sich wie eine Auskunft
   * der App —, legte seinen Vorsorgefall auf
   * `k7f3x9a2b1@privaterelay.appleid.com` an. Der Fallname steht danach in
   * jeder Überschrift und in jedem Kopplungsangebot.
   */
  const [getippt, setzeGetippten] = useState<string | null>(null)
  const personName = getippt ?? hinterlegterName

  async function absenden(ereignis: FormEvent) {
    ereignis.preventDefault()
    setzeLaeuft(true)
    setzeFehler(null)

    try {
      /*
       * Derselbe Name an beide Stellen, und der billigere zuerst: Scheitert
       * das Hinterlegen, steht noch kein Fall da und der zweite Versuch ist
       * derselbe Knopf.
       */
      if (personName.trim() !== hinterlegterName) {
        await speichereNamen(personName)
      }

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
              onChange={(ereignis) => setzeGetippten(ereignis.target.value)}
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
