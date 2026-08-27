import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
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
import { useProfilAbgleich } from '../../../hooks/useProfil.ts'
import { istVorsorgende, type LesbarerFall } from '../../../services/fallService.ts'
import { personenname } from '../../../services/personenname.ts'
import { statusText } from '../../../services/fragebaumService.ts'
import { Badge } from '../../../ui/Badge/Badge.tsx'
import { Button } from '../../../ui/Button/Button.tsx'
import { Gruppe, Liste, Navizeile, Zeile } from '../../../ui/Liste/Liste.tsx'
import { Zurueck } from '../../../ui/Zurueck/Zurueck.tsx'
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
    <Gruppe titel="Ansicht">
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

/**
 * Die Vorsorge samt Tresor löschen (DESIGN.md §3.5, §5).
 *
 * Sie steht dort, wo bei allen anderen „Fall verlassen" steht, und sieht
 * genauso aus: Es ist die entsprechende Handlung für die eine Person, die
 * ihren Fall nicht verlassen kann.
 *
 * Mit Rückfrage, und die Rückfrage nennt den Namen. „Wirklich löschen?" ist
 * eine Frage, die man wegtippt; „Die Vorsorge für Anna Müller samt allen
 * hinterlegten Angaben löschen?" ist eine, die man liest. Zurück kommt davon
 * nichts: Der Tresorschlüssel liegt nur auf den Geräten dieser Person, und
 * mit dem Fall geht auch er.
 */
function Vorsorgeloeschen({
  personName,
  onLoeschen,
}: {
  personName: string
  onLoeschen: () => Promise<void>
}) {
  const navigate = useNavigate()

  const [bestaetigung, setzeBestaetigung] = useState(false)
  const [laeuft, setzeLaeuft] = useState(false)
  const [fehler, setzeFehler] = useState<string | null>(null)

  async function loeschen() {
    setzeLaeuft(true)
    setzeFehler(null)

    try {
      await onLoeschen()
      navigate('/', { replace: true })
    } catch (ursache) {
      setzeFehler(alsNachricht(ursache))
      setzeLaeuft(false)
    }
  }

  if (!bestaetigung) {
    return (
      <Zeile>
        <Button
          variante="text"
          className={stile.gefahr}
          onClick={() => {
            setzeBestaetigung(true)
            setzeFehler(null)
          }}
        >
          Vorsorge löschen
        </Button>
      </Zeile>
    )
  }

  return (
    <Zeile className={stile.frage}>
      <p>
        Die Vorsorge für „{personName}“ samt allen hinterlegten Angaben wirklich löschen? Das
        lässt sich nicht rückgängig machen.
      </p>

      {fehler === null ? null : (
        <p className={stile.meta} role="alert">
          {fehler}
        </p>
      )}

      <div className={stile.knoepfe}>
        <Button variante="primaer" disabled={laeuft} onClick={() => void loeschen()}>
          {laeuft ? 'Wird gelöscht…' : 'Ja, Vorsorge löschen'}
        </Button>
        <Button
          variante="sekundaer"
          disabled={laeuft}
          onClick={() => {
            setzeBestaetigung(false)
            setzeFehler(null)
          }}
        >
          Abbrechen
        </Button>
      </div>
    </Zeile>
  )
}

export function Profil() {
  const { zustand, abmelden } = useAuth()
  const { zustand: fall, verlasseFall, loescheVorsorgefall } = useCase()
  /*
   * Der Name aus `profiles` und nicht der aus der Anmeldung: Wer ihn selbst
   * eingetragen hat — beim Anlegen eines Falls oder vor einem Kopplungscode
   * (§3.3) —, soll ihn hier wiederfinden und nicht „Namen ergänzen" lesen,
   * obwohl er es eben getan hat.
   */
  const { name: hinterlegterName } = useProfilAbgleich()
  const benutzer = zustand.status === 'angemeldet' ? zustand.benutzer : null

  const [bestaetigung, setzeBestaetigung] = useState(false)
  const [wirdVerlassen, setzeWirdVerlassen] = useState(false)
  const [fehler, setzeFehler] = useState<string | null>(null)
  const [wirdAbgemeldet, setzeWirdAbgemeldet] = useState(false)
  const [abmeldefehler, setzeAbmeldefehler] = useState<string | null>(null)

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

  /*
   * §3.5: Der eigene Vorsorgefall. Wer ihn angelegt hat, kann ihn nicht
   * verlassen — `K_v` liegt nur auf seinen Geräten, und ein Fall ohne
   * vorsorgende Person wäre ein Tresor, den niemand mehr füllen und niemand
   * mehr öffnen kann. Löschen kann er ihn, und das steht hier: Es ist die
   * zweite endgültige Kontoaktion, und beide gehören an dieselbe Stelle.
   */
  const vorsorgende = fall.status === 'bereit' && istVorsorgende(fall.aktiver)

  /*
   * Ohne Fall steht keine untere Leiste unter dem Screen (§7,
   * `app/Rahmen.tsx`), und Profil ist dann der einzige Screen, der nicht der
   * Willkommen-Screen ist. Der Weg zurueck steht deshalb genau dort, wo er auf
   * den linearen Screens steht — und nur dann: Mit Leiste waere er eine zweite
   * Navigation mit einer anderen Antwort auf dieselbe Frage.
   */
  const ohneFall = fall.status === 'kein-fall'

  return (
    <main className={stile.seite}>
      {ohneFall ? <Zurueck ziel="/" /> : null}

      <h1>Profil</h1>

      {benutzer === null ? null : (
        <Gruppe
          titel="Sie"
          fussnote="E-Mail-Adresse, Passwort und Name gehören zur Anmeldung. Ihre Aufgaben und Dokumente hängen an diesem Gerät und nicht daran."
        >
          <Liste>
            {/*
              Der eigene Name war bis hierher die einzige Zeile in diesem
              Screen, die dastand, ohne irgendwohin zu führen — und
              ausgerechnet dort tippt jeder zuerst hin, der seine E-Mail-Adresse
              oder sein Passwort ändern will. Jetzt führt sie dorthin.

              Ohne hinterlegten Namen steht dort die Aufforderung, ihn zu
              ergaenzen, und nicht die E-Mail-Adresse: Sie steht in der Zeile
              darunter, und ein zweites Mal als Name gaebe sie fuer einen aus
              (`core/auth/clerkAdapter.tsx`). Die Zeile fuehrt genau dorthin,
              wo sich der Name eintragen laesst.
            */}
            <Navizeile
              titel={personenname(hinterlegterName, 'Namen ergänzen')}
              meta={benutzer.email ?? undefined}
              ziel="/konto"
              vorleseText=": Konto und Anmeldung ändern"
            />

            {/*
              §7: Abmelden ist kein Fallwechsel und kein "Fall verlassen". Es
              nimmt nichts weg — der Fall, die Aufgaben und die Schlüssel
              dieses Geräts bleiben, wo sie sind (§3.6). Es beendet nur diese
              Sitzung, damit sich jemand anderes anmelden kann: die Tochter auf
              dem Telefon der Mutter, oder dieselbe Person mit einem zweiten
              Konto.

              Ohne Rückfrage, weil nichts verloren geht: Wer sich versehentlich
              abmeldet, meldet sich wieder an. Ein Dialog vor einer Handlung,
              die man in zehn Sekunden rückgängig macht, ist eine Hürde ohne
              Gegenwert — die Rückfragen in dieser App gehören dem, was nicht
              zurückkommt (§5).
            */}
            <Zeile className={abmeldefehler === null ? undefined : stile.frage}>
              <Button
                variante="text"
                disabled={wirdAbgemeldet}
                onClick={async () => {
                  try {
                    setzeWirdAbgemeldet(true)
                    setzeAbmeldefehler(null)
                    await abmelden()
                  } catch (err) {
                    setzeAbmeldefehler(alsNachricht(err))
                  } finally {
                    setzeWirdAbgemeldet(false)
                  }
                }}
              >
                {wirdAbgemeldet ? 'Sie werden abgemeldet…' : 'Abmelden'}
              </Button>

              {abmeldefehler === null ? null : (
                <p className={stile.meta} role="alert">
                  {abmeldefehler}
                </p>
              )}
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
            {istVorsorge ? (
              <Navizeile titel="Nachlass" ziel={vorsorgende ? '/nachlass' : '/erbe'} />
            ) : null}
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
            wartet selbst auf seine Freigabe (§3.6). Beide zugleich geht nicht:
            Wer einen Fall lesen kann, ist freigeschaltet und bekommt jeden
            neuen Fall ohnehin mit — der Weg bliebe eine Aufforderung ohne
            Gegenstand.
          */}
          {kannTeilen ? null : (
            <Navizeile titel="Dieses Gerät freischalten lassen" ziel="/geraet-freischalten" />
          )}
          {kannTeilen ? (
            <Navizeile titel="Ein weiteres Gerät freigeben" ziel="/koppeln" />
          ) : null}
        </Liste>
      </Gruppe>

      <Ansichtseinstellungen />

      {fall.status === 'bereit' && fall.aktiver.zustand === 'lesbar' ? (
        <Gruppe
          fussnote={
            vorsorgende
              ? 'Als vorsorgende Person können Sie diesen Fall nicht verlassen: Der Tresorschlüssel liegt nur auf Ihren Geräten. Löschen können Sie ihn — mit allem, was darin liegt.'
              : 'Danach haben Sie keinen Zugriff mehr auf die Aufgaben und Daten dieses Falls.'
          }
        >
          <Liste>
            {/*
              §3.5: Die vorsorgende Person löscht statt zu verlassen. Beide
              Wege stehen in derselben Gruppe, weil sie dasselbe beantworten —
              „Ich möchte hier raus" — und weil zwei Gruppen mit je einer Zeile
              am Ende einer Einstellungsliste wie zwei verschiedene Fälle
              aussähen.
            */}
            {vorsorgende ? (
              <Vorsorgeloeschen
                personName={fuerWen ?? ''}
                onLoeschen={() => loescheVorsorgefall(fall.aktiver.id)}
              />
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

      <footer className={stile.fusszeile}>
        <a
          href="/legal/datenschutz.html"
          target="_blank"
          rel="noreferrer"
          className={stile.datenschutzLink}
        >
          Datenschutz
        </a>
      </footer>
    </main>
  )
}
