import { Link, useNavigate } from 'react-router-dom'
import { Card } from '../../../ui/Card/Card.tsx'
import { Button } from '../../../ui/Button/Button.tsx'
import stile from './KeinFall.module.css'

/**
 * Ohne Fall ist die App gesperrt: ein Screen, drei Schaltflächen (DESIGN.md §7).
 *
 * Die drei Wege sind die Fallweiche aus dem Onboarding. "Ein Todesfall ist
 * eingetreten" führt zur Fallanlage (§2, §3.1); die beiden anderen tragen noch
 * keine Funktion — Vorsorge und Kopplungscode kommen in eigenen Slices.
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
          <Button volleBreite variante="sekundaer" disabled>
            Ich möchte für später vorsorgen
          </Button>
          <Button volleBreite variante="sekundaer" disabled>
            Ich wurde eingeladen
          </Button>
          <p className={stile.hinweis}>
            Die beiden anderen Schritte werden gerade gebaut und sind noch nicht auswählbar.
          </p>
        </div>
      </Card>

      {/*
        Die untere Leiste aus §7 — Start · Erbe · Alle · Profil — kommt mit den
        Screens, die sie verbindet. Bis dahin steht hier der eine Weg, den es
        schon gibt: Profil zeigt die Geräte und ihre Prüfcodes (§3.6).
      */}
      <p className={stile.hinweis}>
        <Link to="/profil">Profil und Geräte</Link>
      </p>
    </main>
  )
}
