import { Link } from 'react-router-dom'
import { useAuth } from '../../../core/auth/authProvider.ts'
import { useCase } from '../../../hooks/useCase.ts'
import { Badge } from '../../../ui/Badge/Badge.tsx'
import { Card } from '../../../ui/Card/Card.tsx'
import { Geraeteliste } from './Geraeteliste.tsx'
import stile from './Profil.module.css'

/**
 * Profil (DESIGN.md §7).
 *
 * Der Tab trägt laut §7 Name, Angehörige, Fallwechsel, Geräte, Textgröße,
 * Darstellung und "Fall verlassen". In diesem Stand gibt es davon Name, Geräte
 * und die beiden Kopplungswege aus §6 — alles Weitere setzt Screens voraus, die
 * es noch nicht gibt.
 *
 * Profil liegt in `screens/shared`, nicht doppelt in `senior` und `advanced`:
 * Hier stehen die unumkehrbaren Abläufe, und ein zweiter Bestätigungsdialog,
 * der leicht anders formuliert ist, wäre ein Risiko ohne Gegenwert (§7).
 */
export function Profil() {
  const { zustand } = useAuth()
  const { zustand: fall } = useCase()
  const benutzer = zustand.status === 'angemeldet' ? zustand.benutzer : null

  const fuerWen =
    fall.status === 'bereit' && fall.aktiver.zustand === 'lesbar' ? fall.aktiver.personName : null

  const faelle = fall.status === 'bereit' ? fall.faelle : []
  const gesperrte = faelle.filter((eintrag) => eintrag.zustand === 'gesperrt').length
  const kannTeilen = faelle.some((eintrag) => eintrag.zustand === 'lesbar')

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

      {fuerWen === null ? null : (
        <Card>
          <h2 className={stile.abschnitt}>Für wen?</h2>
          <p className={stile.name}>{fuerWen}</p>
          {fall.status === 'bereit' &&
          fall.aktiver.zustand === 'lesbar' &&
          fall.aktiver.status === 'vorsorge' ? (
            <p className={stile.hinweis}>
              Dies ist ein Vorsorgefall. <Link to="/erbe">Zum Nachlass-Tresor</Link>
            </p>
          ) : null}
        </Card>
      )}

      {/*
        §6: „Jedes Mitglied darf einladen. Das hier ist eine Familie, keine
        Organisation." Deshalb steht der Weg in Profil und nicht an einer Rolle;
        die einzige Bedingung ist, dass dieses Gerät den Fall überhaupt lesen
        kann — man kann nur weitergeben, was man selbst hat (§3.6).
      */}
      <Card>
        <h2 className={stile.abschnitt}>Angehörige</h2>
        <p className={stile.hinweis}>
          Wer dazukommt, meldet sich zuerst selbst an und nennt Ihnen einen Kopplungscode. Sie geben
          ihn hier ein, sehen den Namen und einen Prüfcode — und vergleichen ihn am Telefon, bevor
          Sie bestätigen.
        </p>
        {kannTeilen ? (
          <p className={stile.hinweis}>
            <Link to="/koppeln">Angehörige einladen</Link>
          </p>
        ) : (
          <p className={stile.hinweis}>
            Solange dieses Gerät keinen Fall lesen kann, lässt sich niemand hinzufügen.
          </p>
        )}
      </Card>

      <Card>
        <div className={stile.geraetKopf}>
          <h2 className={stile.abschnitt}>Geräte</h2>
          {gesperrte > 0 ? <Badge lage="hinweis">Freigabe nötig</Badge> : null}
        </div>
        <p className={stile.hinweis}>
          Jedes Gerät hat einen eigenen Schlüssel. Der Prüfcode gehört dazu; Sie vergleichen ihn,
          wenn Sie ein weiteres Gerät oder eine weitere Person freigeben.
        </p>

        {/*
          Beide Richtungen stehen nebeneinander, weil dasselbe Gerät je nach
          Lage in beiden Rollen steckt: Es gibt ein anderes frei, oder es wartet
          selbst auf seine Freigabe (§3.6).
        */}
        <p className={stile.hinweis}>
          <Link to="/geraet-freischalten">Dieses Gerät freischalten lassen</Link>
        </p>
        {kannTeilen ? (
          <p className={stile.hinweis}>
            <Link to="/koppeln">Ein weiteres Gerät freigeben</Link>
          </p>
        ) : null}

        <Geraeteliste />
      </Card>
    </main>
  )
}
