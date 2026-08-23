import { Link } from 'react-router-dom'
import { useAuth } from '../../../core/auth/authProvider.ts'
import { Card } from '../../../ui/Card/Card.tsx'
import { Geraeteliste } from './Geraeteliste.tsx'
import stile from './Profil.module.css'

/**
 * Profil (DESIGN.md §7).
 *
 * Der Tab trägt laut §7 Name, Angehörige, Fallwechsel, Geräte, Textgröße,
 * Darstellung und "Fall verlassen". In diesem Stand gibt es davon Name und
 * Geräte — alles Weitere setzt einen Fall voraus, den es noch nicht gibt.
 *
 * Profil liegt in `screens/shared`, nicht doppelt in `senior` und `advanced`:
 * Hier stehen die unumkehrbaren Abläufe, und ein zweiter Bestätigungsdialog,
 * der leicht anders formuliert ist, wäre ein Risiko ohne Gegenwert (§7).
 */
export function Profil() {
  const { zustand } = useAuth()
  const benutzer = zustand.status === 'angemeldet' ? zustand.benutzer : null

  return (
    <main className={stile.seite}>
      <div className={stile.kopf}>
        <h1>Profil</h1>
        <Link className={stile.zurueck} to="/">
          Zurück
        </Link>
      </div>

      {benutzer === null ? null : (
        <Card>
          <h2 className={stile.abschnitt}>Sie</h2>
          <p className={stile.name}>{benutzer.anzeigename}</p>
          {benutzer.email === null ? null : (
            <p className={stile.hinweis}>{benutzer.email}</p>
          )}
        </Card>
      )}

      <Card>
        <h2 className={stile.abschnitt}>Geräte</h2>
        <p className={stile.hinweis}>
          Jedes Gerät hat einen eigenen Schlüssel. Der Prüfcode gehört dazu; Sie vergleichen ihn,
          wenn Sie ein weiteres Gerät oder eine weitere Person freigeben.
        </p>
        <Geraeteliste />
      </Card>
    </main>
  )
}
