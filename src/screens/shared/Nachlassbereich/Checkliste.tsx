import { useNavigate } from 'react-router-dom'
import { CHECKLISTE_ERKLAERUNG } from '../../../content/nachlass.ts'
import { Button } from '../../../ui/Button/Button.tsx'
import { Card } from '../../../ui/Card/Card.tsx'
import { Infoblock } from '../../../ui/Infoblock/Infoblock.tsx'
import { Zurueck } from '../../../ui/Zurueck/Zurueck.tsx'
import { Vorsorgeseite } from './Vorsorgeseite.tsx'
import stile from './Nachlassbereich.module.css'

/**
 * Was eine Nachlass-Checkliste ist, bevor man sie ausfüllt (DESIGN.md §3.5).
 *
 * Eine eigene Seite für einen Absatz Text, und das hat einen Grund: Das
 * Formular dahinter fragt nach Ausweisen, Versicherungen und Passwörtern. Wer
 * darauf ohne Vorwarnung stösst, sieht ein Amtsformular. Wer vorher gelesen
 * hat, wozu es gut ist, sieht dasselbe Formular als Entlastung für die eigenen
 * Angehörigen — und das ist der Unterschied, ob jemand anfängt.
 *
 * Kein Feld auf dieser Seite. Sie hat genau einen nächsten Schritt, und der
 * steht als einzige Schaltfläche darunter (§7).
 */
function Inhalt() {
  const navigate = useNavigate()

  return (
    <main className={stile.seite}>
      <Zurueck ziel="/nachlass" />

      <div className={stile.kopf}>
        <h1>Nachlass-Checkliste</h1>
      </div>

      <Card>
        <Infoblock text={CHECKLISTE_ERKLAERUNG} titelEbene="h2" />
      </Card>

      <Card>
        <p className={stile.hinweis}>
          Sie müssen nicht alles auf einmal beantworten. Jede Antwort wird für sich gespeichert,
          und ändern können Sie sie jederzeit. Ihre Angaben liegen verschlüsselt in Ihrem Tresor;
          Angehörige lesen sie erst im Trauerfall.
        </p>

        <Button volleBreite onClick={() => navigate('/nachlass/checkliste/fragen')}>
          Weiter zu den Fragen
        </Button>
      </Card>
    </main>
  )
}

export function Checkliste() {
  return <Vorsorgeseite kinder={() => <Inhalt />} />
}
