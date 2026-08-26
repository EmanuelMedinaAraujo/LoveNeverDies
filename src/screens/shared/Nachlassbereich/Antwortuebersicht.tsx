import { useNavigate } from 'react-router-dom'
import { VORSORGEFRAGEN } from '../../../content/vorsorgefragen.ts'
import { useAufgaben } from '../../../hooks/useAufgaben.ts'
import { useCase } from '../../../hooks/useCase.ts'
import { useTresor } from '../../../hooks/useTresor.ts'
import type { LesbarerFall } from '../../../services/fallService.ts'
import {
  antwortZuFrage,
  checklistenstand,
  freieEintraege,
} from '../../../services/tresorService.ts'
import { Badge } from '../../../ui/Badge/Badge.tsx'
import { Button } from '../../../ui/Button/Button.tsx'
import { Card } from '../../../ui/Card/Card.tsx'
import { Zurueck } from '../../../ui/Zurueck/Zurueck.tsx'
import { Vorsorgeseite } from './Vorsorgeseite.tsx'
import stile from './Nachlassbereich.module.css'

/**
 * Eine Frage mit ihrer Antwort, zum Lesen und nicht zum Ändern.
 *
 * Die Frage steht klein darüber, die Antwort gross darunter — umgekehrt als im
 * Formular, wo die Frage die Beschriftung des Feldes ist. Hier ist die Antwort
 * die Sache: Wer die Übersicht öffnet, kennt seine Fragen und will sehen, was
 * er geschrieben hat.
 */
function Antwort({ frage, text }: { frage: string; text: string }) {
  return (
    <div className={stile.antwort}>
      <p className={stile.antwortFrage}>{frage}</p>

      {text.trim() === '' ? (
        <p className={stile.antwortOffen}>Noch nicht beantwortet</p>
      ) : (
        <p className={stile.antwortText}>{text}</p>
      )}
    </div>
  )
}

/**
 * Alle Antworten am Stück (DESIGN.md §3.5, §7).
 *
 * Was im Formular acht Karten mit acht Feldern sind, ist hier eine Seite zum
 * Lesen: Frage, Antwort, Frage, Antwort. Sie beantwortet die eine Frage, die
 * ein Formular nicht beantwortet — reicht das, was ich hinterlassen habe?
 *
 * Unbeantwortete Fragen stehen mit da und werden nicht ausgelassen. Eine
 * Übersicht, aus der die Lücken verschwinden, ist genau die Übersicht, die man
 * nicht braucht: Sie sagt „acht Antworten", wo drei stehen.
 *
 * Nichts lässt sich hier ändern. Geändert wird im Formular, und dorthin führt
 * der Weg unten — an einer Stelle statt an zwei, damit derselbe Text nicht in
 * zwei Feldern zugleich steht (§5).
 */
function Inhalt({ fall }: { fall: LesbarerFall }) {
  const { aktualisiere } = useCase()
  const { zustand, zeilen, mutiere } = useAufgaben(fall)
  const { items } = useTresor(fall, zeilen, mutiere, aktualisiere)
  const navigate = useNavigate()

  if (zustand.status === 'laedt') {
    return (
      <main className={stile.seite}>
        <Zurueck ziel="/nachlass/checkliste/fragen" />
        <p className={stile.hinweis} role="status">
          Ihre Antworten werden geladen…
        </p>
      </main>
    )
  }

  const stand = checklistenstand(items)
  const weitere = freieEintraege(items)

  return (
    <main className={stile.seite}>
      <Zurueck ziel="/nachlass/checkliste/fragen" beschriftung="Zurück zum Formular" />

      <div className={stile.kopf}>
        <h1>Ihre Antworten</h1>
        <p className={stile.hinweis}>
          Was {fall.personName} im Tresor hinterlegt hat. Angehörige lesen es erst nach dem
          Trauerfall.
        </p>
      </div>

      <Card>
        <div className={stile.statusKopf}>
          <h2 className={stile.abschnitt}>Nachlass-Checkliste</h2>
          <Badge lage="ruhig">
            {stand.beantwortet} von {stand.gesamt}
          </Badge>
        </div>

        <div className={stile.fragen}>
          {VORSORGEFRAGEN.map((frage) => {
            const item = antwortZuFrage(items, frage.id)

            return (
              <Antwort
                key={frage.id}
                frage={frage.frage}
                text={item === null ? '' : item.inhalt}
              />
            )
          })}
        </div>
      </Card>

      {weitere.length === 0 ? null : (
        <Card>
          <h2 className={stile.abschnitt}>Weitere Einträge</h2>

          <ul className={stile.liste}>
            {weitere.map((item) => (
              <li key={item.id} className={stile.eintrag}>
                <p className={stile.eintragTitel}>{item.titel}</p>
                {item.inhalt === '' ? null : (
                  <p className={stile.eintragInhalt}>{item.inhalt}</p>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Button volleBreite onClick={() => navigate('/nachlass/checkliste/fragen')}>
        Antworten bearbeiten
      </Button>
    </main>
  )
}

export function Antwortuebersicht() {
  return <Vorsorgeseite kinder={(fall) => <Inhalt fall={fall} />} />
}
