import { Card } from '../../../ui/Card/Card.tsx'
import { Button } from '../../../ui/Button/Button.tsx'
import stile from './KeinFall.module.css'

/**
 * Ohne Fall ist die App gesperrt: ein Screen, drei Schaltflächen (DESIGN.md §7).
 *
 * Die drei Wege sind die Fallweiche aus dem Onboarding. Sie tragen in diesem
 * Stand noch keine Funktion — die Fallanlage, die Vorsorge und der
 * Kopplungscode kommen in eigenen Slices.
 */
export function KeinFall() {
  return (
    <main className={stile.seite}>
      <div className={stile.kopf}>
        <h1>Willkommen</h1>
        <p className={stile.einleitung}>
          Sie haben noch keinen Fall angelegt. Bitte wählen Sie, wie es weitergehen soll.
        </p>
      </div>

      <Card>
        <div className={stile.weiche}>
          <Button volleBreite disabled>
            Ein Todesfall ist eingetreten
          </Button>
          <Button volleBreite variante="sekundaer" disabled>
            Ich möchte für später vorsorgen
          </Button>
          <Button volleBreite variante="sekundaer" disabled>
            Ich wurde eingeladen
          </Button>
          <p className={stile.hinweis}>
            Diese Schritte werden gerade gebaut und sind noch nicht auswählbar.
          </p>
        </div>
      </Card>
    </main>
  )
}
