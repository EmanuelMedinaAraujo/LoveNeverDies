import { useNavigate } from 'react-router-dom'
import { TESTAMENT_TITEL, TESTAMENT_VERFASSEN } from '../../../content/testament.ts'
import { Button } from '../../../ui/Button/Button.tsx'
import { Card } from '../../../ui/Card/Card.tsx'
import { Infoblock } from '../../../ui/Infoblock/Infoblock.tsx'
import { Zurueck } from '../../../ui/Zurueck/Zurueck.tsx'
import { Vorsorgeseite } from './Vorsorgeseite.tsx'
import stile from './Nachlassbereich.module.css'

/**
 * So verfassen Sie ein Testament (DESIGN.md §3.5, §8).
 *
 * Der Weg hierher steht unter der Testamentfrage der Checkliste und nirgends
 * sonst: Wer sein Testament längst beim Notar liegen hat, soll diesen Text
 * nicht wegblättern müssen.
 *
 * Rechtstext, wörtlich aus `content/testament.ts`. Der Screen setzt ihn und
 * formuliert ihn nicht.
 *
 * Zwei Wege zurück, und beide führen an dieselbe Stelle: der Pfeil oben links
 * — der Weg, den die App überall hat — und die Schaltfläche unten, weil der
 * Text lang genug ist, dass der Pfeil dann aus dem Bild gescrollt ist. Wer
 * unten ankommt, soll dort weiterkommen und nicht erst zurückwischen müssen.
 */
function Inhalt() {
  const navigate = useNavigate()

  return (
    <main className={stile.seite}>
      <Zurueck ziel="/nachlass/checkliste/fragen" beschriftung="Zurück zum Formular" />

      <div className={stile.kopf}>
        <h1>{TESTAMENT_TITEL}</h1>
      </div>

      <Card>
        <Infoblock text={TESTAMENT_VERFASSEN} titelEbene="h2" />
      </Card>

      <Button volleBreite onClick={() => navigate('/nachlass/checkliste/fragen')}>
        Zurück zum Formular
      </Button>
    </main>
  )
}

export function Testament() {
  return <Vorsorgeseite kinder={() => <Inhalt />} />
}
