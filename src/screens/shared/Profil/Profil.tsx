import { useState } from 'react'
import { useAuth } from '../../../core/auth/authProvider.ts'
import { alsNachricht } from '../../../core/fehler.ts'
import {
  useAnsicht,
  type Ansichtsmodus,
  type Darstellung,
  type Textgroesse,
} from '../../../hooks/useAnsichtsmodus.ts'
import { useAufgaben } from '../../../hooks/useAufgaben.ts'
import { useCase } from '../../../hooks/useCase.ts'
import type { LesbarerFall } from '../../../services/fallService.ts'
import { statusText } from '../../../services/fragebaumService.ts'
import { Badge } from '../../../ui/Badge/Badge.tsx'
import { Button } from '../../../ui/Button/Button.tsx'
import { Gruppe, Liste, Navizeile, Zeile } from '../../../ui/Liste/Liste.tsx'
import { Geraeteliste } from './Geraeteliste.tsx'
import stile from './Profil.module.css'

/**
 * Profil (DESIGN.md §7).
 *
 * Der Tab trägt laut §7 Name, Angehörige, Fallwechsel, Geräte, Textgröße,
 * Darstellung und "Fall verlassen". In diesem Stand gibt es davon Name, Geräte,
 * die beiden Kopplungswege aus §6 und die drei Einstellungen zur Ansicht.
 *
 * Der Screen ist eine Einstellungsliste und sieht auch so aus: Abschnitte mit
 * kleiner Überschrift, darin Zeilen, darunter höchstens ein Satz. Vorher war
 * jeder Abschnitt eine eigene weiße Karte mit einem Absatz Fließtext darin,
 * und der Screen war eine Kolonne aus fünf Kästen, in der die eigentlichen
 * Wege — einladen, freischalten, umbenennen — zwischen den Erklärungen
 * untergingen.
 *
 * Profil liegt in `screens/shared`, nicht doppelt in `einfach` und `erweitert`:
 * Hier stehen die unumkehrbaren Abläufe, und ein zweiter Bestätigungsdialog,
 * der leicht anders formuliert ist, wäre ein Risiko ohne Gegenwert (§7).
 */

/**
 * Ansicht, Textgröße, Darstellung (§7).
 *
 * Drei Auswahlfelder, und alle drei wirken sofort: Wer hier auf "Einfach"
 * stellt, sieht die untere Leiste im selben Augenblick größer werden und
 * findet nach dem nächsten Tipp auf "Start" die einfache Fassung. Ein
 * Speichern-Knopf daneben wäre ein zweiter Schritt vor einer Einstellung, die
 * man ausprobieren will.
 *
 * Native `select`-Felder und keine nachgebauten. Sie bringen auf jedem Gerät
 * die Bedienung mit, die dort gilt — das Rad auf iOS, die Liste auf dem
 * Rechner —, und eine Vorlesestimme kennt sie ohne Zutun (§7).
 *
 * Beide Overrides stehen auf "Systemeinstellung folgen", und das ist mehr als
 * ein Vorgabewert: Solange er dort steht, zieht ein Wechsel im Betriebssystem
 * mit, ohne dass jemand hierher zurückkommen muss.
 */
/**
 * Der eigene Erbstatus, eine Zeile (ERBE_DESIGN.md §6).
 *
 * Nur die angemeldete Person sieht ihn: Er liegt im privaten
 * Konfigurations-Item unter `K_p` (§3.7), und die Clients der anderen
 * Mitglieder verwerfen die Zeile still.
 *
 * Der Screen zieht dafür einen Sync-Stream auf, obwohl er ein einziges Feld
 * braucht. Anders geht es nicht: `K_p` hängt an den Items des Falls, und einen
 * zweiten Weg dorthin zu bauen hieße, denselben Schlüssel an zwei Stellen zu
 * beschaffen (§3.7). Der Stream lebt, solange dieser Tab offen ist.
 *
 * Steht kein Ergebnis da, steht hier auch keine Zeile: Ein "Noch nicht
 * ermittelt" in einer Einstellungsliste wäre eine Aufforderung an einer
 * Stelle, an der man nichts erledigen kann. Der Weg in den Fragebaum steht in
 * Erbe (§10).
 */
function Erbstatuszeile({ fall }: { fall: LesbarerFall }) {
  const { fragebaum, fragebaumGeladen } = useAufgaben(fall)

  /*
   * `fragebaumGeladen` steht mit in der Bedingung, obwohl beide Wege dieselbe
   * leere Zeile ergeben: Ohne ihn hiesse die Bedingung „es gibt kein
   * Ergebnis", und das stimmt nicht — solange `K_p` unterwegs ist, heisst sie
   * „es ist noch keins zu sehen" (§3.7, ERBE_DESIGN.md §6).
   */
  if (!fragebaumGeladen || fragebaum === null || fragebaum.status === null) {
    return null
  }

  return (
    <Zeile>
      <span className={stile.etikett}>Erbstatus</span>
      <span className={stile.rechts}>{statusText(fragebaum.status)}</span>
    </Zeile>
  )
}

function Ansichtseinstellungen() {
  const { modus, textgroesse, darstellung, waehleModus, waehleTextgroesse, waehleDarstellung } =
    useAnsicht()

  return (
    <Gruppe
      titel="Ansicht"
      fussnote="Die einfache Ansicht zeigt weniger auf einem Bildschirm und setzt alles größer. Die Wege durch die App sind in beiden gleich."
    >
      <Liste>
        <Zeile className={stile.einstellung}>
          <label className={stile.etikett} htmlFor="ansicht-modus">
            Ansicht
          </label>
          <select
            id="ansicht-modus"
            className={stile.auswahl}
            value={modus ?? 'einfach'}
            onChange={(ereignis) => waehleModus(ereignis.target.value as Ansichtsmodus)}
          >
            <option value="einfach">Einfach</option>
            <option value="erweitert">Erweitert</option>
          </select>
        </Zeile>

        <Zeile className={stile.einstellung}>
          <label className={stile.etikett} htmlFor="ansicht-textgroesse">
            Textgröße
          </label>
          <select
            id="ansicht-textgroesse"
            className={stile.auswahl}
            value={textgroesse}
            onChange={(ereignis) => waehleTextgroesse(ereignis.target.value as Textgroesse)}
          >
            <option value="system">Systemeinstellung folgen</option>
            <option value="gross">Größer</option>
            <option value="sehr-gross">Noch größer</option>
          </select>
        </Zeile>

        <Zeile className={stile.einstellung}>
          <label className={stile.etikett} htmlFor="ansicht-darstellung">
            Darstellung
          </label>
          <select
            id="ansicht-darstellung"
            className={stile.auswahl}
            value={darstellung}
            onChange={(ereignis) => waehleDarstellung(ereignis.target.value as Darstellung)}
          >
            <option value="system">Systemeinstellung folgen</option>
            <option value="hell">Hell</option>
            <option value="dunkel">Dunkel</option>
          </select>
        </Zeile>
      </Liste>
    </Gruppe>
  )
}

export function Profil() {
  const { zustand } = useAuth()
  const { zustand: fall, verlasseFall } = useCase()
  const benutzer = zustand.status === 'angemeldet' ? zustand.benutzer : null

  const [bestaetigung, setzeBestaetigung] = useState(false)
  const [wirdVerlassen, setzeWirdVerlassen] = useState(false)
  const [fehler, setzeFehler] = useState<string | null>(null)

  const fuerWen =
    fall.status === 'bereit' && fall.aktiver.zustand === 'lesbar' ? fall.aktiver.personName : null

  const faelle = fall.status === 'bereit' ? fall.faelle : []
  const gesperrte = faelle.filter((eintrag) => eintrag.zustand === 'gesperrt').length
  const kannTeilen = faelle.some((eintrag) => eintrag.zustand === 'lesbar')

  /*
   * Den Erbstatus gibt es nur im Trauerfall: Ein Vorsorgefall hat laut §2 keine
   * Erben, und der Fragebaum erscheint dort gar nicht (ERBE_DESIGN.md §1).
   */
  const trauerfall =
    fall.status === 'bereit' && fall.aktiver.zustand === 'lesbar' && fall.aktiver.status !== 'vorsorge'
      ? fall.aktiver
      : null

  const istVorsorge =
    fall.status === 'bereit' &&
    fall.aktiver.zustand === 'lesbar' &&
    fall.aktiver.status === 'vorsorge'

  const istVersiegelterVorsorgePreparer =
    istVorsorge &&
    fall.status === 'bereit' &&
    fall.aktiver.zustand === 'lesbar' &&
    fall.aktiver.vaultCommitment !== null &&
    benutzer !== null &&
    fall.aktiver.preparerId === benutzer.id

  return (
    <main className={stile.seite}>
      <h1>Profil</h1>

      {benutzer === null ? null : (
        <Gruppe titel="Sie">
          <Liste>
            <Zeile>
              {/*
                Name und E-Mail sind bei einer Anmeldung ohne Profilnamen
                dasselbe. Dann steht die Zeile einmal da und nicht zweimal.
              */}
              <div className={stile.wert}>
                <span>{benutzer.anzeigename}</span>
                {benutzer.email === null || benutzer.email === benutzer.anzeigename ? null : (
                  <span className={stile.meta}>{benutzer.email}</span>
                )}
              </div>
            </Zeile>
          </Liste>
        </Gruppe>
      )}

      {fuerWen === null ? null : (
        <Gruppe titel="Fall">
          <Liste>
            <Zeile>
              <span className={stile.etikett}>Für wen?</span>
              <span className={stile.rechts}>{fuerWen}</span>
            </Zeile>
            {trauerfall === null ? null : <Erbstatuszeile fall={trauerfall} />}
            {istVorsorge ? <Navizeile titel="Nachlass-Tresor" ziel="/erbe" /> : null}
          </Liste>
        </Gruppe>
      )}

      {/*
        §6: "Jedes Mitglied darf einladen. Das hier ist eine Familie, keine
        Organisation." Deshalb steht der Weg in Profil und nicht an einer Rolle.
        Die einzige Bedingung ist, dass dieses Gerät den Fall überhaupt lesen
        kann: Man kann nur weitergeben, was man selbst hat (§3.6).
      */}
      <Gruppe
        titel="Angehörige"
        fussnote={
          kannTeilen
            ? 'Wer dazukommt, nennt Ihnen einen Kopplungscode. Den Prüfcode vergleichen Sie am Telefon, bevor Sie bestätigen.'
            : 'Solange dieses Gerät keinen Fall lesen kann, lässt sich niemand hinzufügen.'
        }
      >
        <Liste>
          {kannTeilen ? (
            <Navizeile titel="Angehörige einladen" ziel="/koppeln" />
          ) : (
            <Zeile>
              <span className={stile.aus}>Angehörige einladen</span>
            </Zeile>
          )}
        </Liste>
      </Gruppe>

      <Gruppe
        titel="Geräte"
        neben={gesperrte > 0 ? <Badge lage="hinweis">Freigabe nötig</Badge> : null}
        fussnote="Jedes Gerät hat einen eigenen Schlüssel. Den Prüfcode vergleichen Sie beim Freigeben."
      >
        <Liste>
          <Geraeteliste />

          {/*
            Beide Richtungen stehen nebeneinander, weil dasselbe Gerät je nach
            Lage in beiden Rollen steckt: Es gibt ein anderes frei, oder es
            wartet selbst auf seine Freigabe (§3.6).
          */}
          <Navizeile titel="Dieses Gerät freischalten lassen" ziel="/geraet-freischalten" />
          {kannTeilen ? (
            <Navizeile titel="Ein weiteres Gerät freigeben" ziel="/koppeln" />
          ) : null}
        </Liste>
      </Gruppe>

      <Ansichtseinstellungen />

      {fall.status === 'bereit' && fall.aktiver.zustand === 'lesbar' ? (
        <Gruppe
          fussnote={
            istVersiegelterVorsorgePreparer
              ? 'Als Ersteller dieses versiegelten Vorsorgefalls können Sie ihn nicht verlassen. Löschen können Sie ihn im Tab Erbe.'
              : 'Danach haben Sie keinen Zugriff mehr auf die Aufgaben und Daten dieses Falls.'
          }
        >
          <Liste>
            {istVersiegelterVorsorgePreparer ? (
              <Zeile>
                <span className={stile.aus}>Fall verlassen</span>
              </Zeile>
            ) : bestaetigung ? (
              <Zeile className={stile.frage}>
                <p>Den Fall für „{fuerWen}“ wirklich verlassen?</p>
                {fehler === null ? null : (
                  <p className={stile.meta} role="alert">
                    {fehler}
                  </p>
                )}
                <div className={stile.knoepfe}>
                  <Button
                    variante="primaer"
                    disabled={wirdVerlassen}
                    onClick={async () => {
                      try {
                        setzeWirdVerlassen(true)
                        setzeFehler(null)
                        await verlasseFall(fall.aktiver.id)
                        setzeBestaetigung(false)
                      } catch (err) {
                        setzeFehler(alsNachricht(err))
                      } finally {
                        setzeWirdVerlassen(false)
                      }
                    }}
                  >
                    {wirdVerlassen ? 'Wird verlassen…' : 'Ja, Fall verlassen'}
                  </Button>
                  <Button
                    variante="sekundaer"
                    disabled={wirdVerlassen}
                    onClick={() => {
                      setzeBestaetigung(false)
                      setzeFehler(null)
                    }}
                  >
                    Abbrechen
                  </Button>
                </div>
              </Zeile>
            ) : (
              <Zeile>
                {/*
                  Die einzige Aktion in dieser App, die etwas wegnimmt. Sie
                  sieht deshalb anders aus als die Wege daneben — nicht lauter,
                  aber unverwechselbar.
                */}
                <Button
                  variante="text"
                  className={stile.gefahr}
                  onClick={() => {
                    setzeBestaetigung(true)
                    setzeFehler(null)
                  }}
                >
                  Fall verlassen
                </Button>
              </Zeile>
            )}
          </Liste>
        </Gruppe>
      ) : null}
    </main>
  )
}
