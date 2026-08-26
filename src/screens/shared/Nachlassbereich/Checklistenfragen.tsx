import { useNavigate } from 'react-router-dom'
import { TESTAMENT_FRAGE } from '../../../content/testament.ts'
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
import { Button } from '../../../ui/Button/Button.tsx'
import { Card } from '../../../ui/Card/Card.tsx'
import { Zurueck } from '../../../ui/Zurueck/Zurueck.tsx'
import { Antwortfeld } from './Antwortfeld.tsx'
import { Vorsorgeseite } from './Vorsorgeseite.tsx'
import { Weitereeintraege } from './Weitereeintraege.tsx'
import stile from './Nachlassbereich.module.css'

/**
 * Der Weg zum Testament-Erklärtext, unter der Testamentfrage (§3.5).
 *
 * Er steht dort und nicht als eigener Punkt in der Liste: Wer sein Testament
 * längst hat, hat die Frage beantwortet und liest hier nicht weiter. Wer
 * keines hat, steht genau an dieser Stelle vor der nächsten Frage.
 */
function Testamentweg() {
  const navigate = useNavigate()

  return (
    <>
      <p className={stile.absatz}>{TESTAMENT_FRAGE}</p>
      <Button
        variante="sekundaer"
        onClick={() => navigate('/nachlass/checkliste/testament')}
      >
        Ja – wie geht das?
      </Button>
    </>
  )
}

/**
 * Das Formular der Nachlass-Checkliste (DESIGN.md §3.5, §7).
 *
 * Acht Fragen, eine Karte je Frage. Acht Felder in einer Karte wären acht
 * Felder in einem Kasten, und wer nach der dritten aufhört, sähe nicht, wo
 * eine Frage aufhört und die nächste anfängt.
 *
 * Kein Speichern-Knopf und keine Reihenfolge, an die man sich halten müsste:
 * Jede Antwort wird für sich gespeichert, sobald das Feld den Fokus verliert
 * (siehe `Antwortfeld`). Wer eine Frage beantwortet und die übrigen sieben
 * offen lässt, hat gespeichert.
 *
 * Der Screen verschlüsselt nichts. Das tut `tresorService`, aufgerufen über
 * `useTresor`: Frage wie Antwort gehen als Tresor-Item unter `K_v` in den Fall
 * wie jeder andere Inhalt dort — Angehörige lesen sie erst nach dem
 * Trauerfall.
 */
function Inhalt({ fall }: { fall: LesbarerFall }) {
  const { aktualisiere } = useCase()
  const { zustand, zeilen, mutiere } = useAufgaben(fall)
  const { items, speichereAntwort, legeItemAn, loescheItem } = useTresor(
    fall,
    zeilen,
    mutiere,
    aktualisiere,
  )
  const navigate = useNavigate()

  if (zustand.status === 'laedt') {
    return (
      <main className={stile.seite}>
        <Zurueck ziel="/nachlass/checkliste" />
        <p className={stile.hinweis} role="status">
          Ihre Checkliste wird geladen…
        </p>
      </main>
    )
  }

  const stand = checklistenstand(items)

  return (
    <main className={stile.seite}>
      <Zurueck ziel="/nachlass/checkliste" />

      <div className={stile.kopf}>
        <h1>Nachlass-Checkliste</h1>
        <p className={stile.hinweis}>
          {stand.beantwortet} von {stand.gesamt} beantwortet. Jede Antwort wird gespeichert,
          sobald Sie das Feld verlassen.
        </p>
      </div>

      <div className={stile.fragen}>
        {VORSORGEFRAGEN.map((frage) => (
          <Card key={frage.id}>
            <Antwortfeld
              frage={frage}
              antwortItem={antwortZuFrage(items, frage.id)}
              onSpeichern={speichereAntwort}
              anschluss={frage.anschluss === 'testament' ? <Testamentweg /> : undefined}
            />
          </Card>
        ))}

        <Weitereeintraege
          eintraege={freieEintraege(items)}
          onNeu={legeItemAn}
          onLoeschen={loescheItem}
        />
      </div>

      {/*
        Ganz unten und als einzige Schaltfläche in voller Breite: Wer bis
        hierher gescrollt ist, ist durch — und will sehen, was jetzt dasteht.
      */}
      <Button volleBreite onClick={() => navigate('/nachlass/checkliste/uebersicht')}>
        Übersicht aller Antworten anzeigen
      </Button>
    </main>
  )
}

export function Checklistenfragen() {
  return <Vorsorgeseite kinder={(fall) => <Inhalt fall={fall} />} />
}
