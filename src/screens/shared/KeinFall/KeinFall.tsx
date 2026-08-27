import { Link, useNavigate } from 'react-router-dom'
import { Card } from '../../../ui/Card/Card.tsx'
import { Button } from '../../../ui/Button/Button.tsx'
import stile from './KeinFall.module.css'

/**
 * Ohne Fall ist die App gesperrt: ein Screen, drei Schaltflächen (DESIGN.md §7).
 *
 * Die drei Wege sind die Fallweiche aus dem Onboarding:
 * - "Ein Todesfall ist eingetreten" führt zur Trauerfallanlage (§2, §3.1)
 * - "Ich möchte für später vorsorgen" führt zur Vorsorgeanlage (§2, §3.5)
 * - "Ich wurde eingeladen" zum Kopplungscode (§6)
 *
 * Ohne Fall steht keine untere Leiste unter dem Screen (§7, `app/Rahmen.tsx`):
 * Zwei ihrer vier Plätze führten nirgendwohin, einer wieder hierher. Der eine
 * Weg, der von hier aus wirklich woanders hinführt, steht deshalb als Zeile am
 * Fuß — abmelden, Textgröße, Darstellung liegen in Profil, und ohne diese
 * Zeile käme niemand mehr dorthin.
 */
export function KeinFall() {
  const navigate = useNavigate()

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
          <Button volleBreite onClick={() => navigate('/todesfall')}>
            Ein Todesfall ist eingetreten
          </Button>
          <Button volleBreite variante="sekundaer" onClick={() => navigate('/vorsorge')}>
            Ich möchte für später vorsorgen
          </Button>
          <Button volleBreite variante="sekundaer" onClick={() => navigate('/beitreten')}>
            Ich wurde eingeladen
          </Button>
        </div>
      </Card>

      <p className={stile.fuss}>
        <Link className={stile.link} to="/profil">
          Profil und Einstellungen
        </Link>
      </p>
    </main>
  )
}
