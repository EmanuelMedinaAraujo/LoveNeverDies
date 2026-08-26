import { useState, type ChangeEvent, type FormEvent } from 'react'
import { useEinloesung } from '../../../hooks/useKopplung.ts'
import { useQrScanner } from '../../../hooks/useQrScanner.ts'
import {
  formatiereKopplungscodeEingabe,
  KOPPLUNGSCODE_LAENGE,
} from '../../../services/kopplungService.ts'
import { Button } from '../../../ui/Button/Button.tsx'
import { Card } from '../../../ui/Card/Card.tsx'
import { Zurueck } from '../../../ui/Zurueck/Zurueck.tsx'
import stile from './Koppeln.module.css'

/**
 * Die einladende Seite der Kopplung (DESIGN.md §6, Schritt 4 bis 6).
 *
 * Zwei Schritte, sichtbar getrennt: Code eingeben, dann bestätigen. Dazwischen
 * steht der Prüfcode, und dazwischen telefonieren zwei Menschen. Ein Formular,
 * das beides in einem Zug erledigte, hätte für den Abgleich keine Stelle. Der
 * Abgleich ist der einzige Schutz gegen einen Server, der beim Rendezvous
 * fremde Schlüssel unterschiebt (§3.6).
 *
 * Derselbe Screen nimmt beide Zwecke an. Welcher es ist, sagt der Code, nicht
 * die Person: Wer sich in der Tür geirrt hat, soll das an der Bestätigungsfrage
 * merken und nicht an einer Fehlermeldung.
 */
export function Koppeln() {
  const { zustand, laeuft, faelleBereit, lesbareFaelle, einloesen, bestaetigen, abbrechen } =
    useEinloesung()

  const [eingabe, setzeEingabe] = useState('')
  const [gewaehlterFall, setzeGewaehltenFall] = useState<string | null>(null)

  /*
   * Scannen ist eine Alternative zum Eintippen, keine zweite Baustelle: Der
   * QR-Code trägt genau den Kopplungscode, den auch das Textfeld annimmt
   * (§6, Punkt 5 der Kopplungs-Anforderungen). Zu, bis jemand ihn ausdrücklich
   * anfordert, sonst hinge diese Seite an einer Kamera, die die meisten
   * Besuche gar nicht brauchen.
   */
  const [scanAktiv, setzeScanAktiv] = useState(false)

  function codeErkannt(rohwert: string) {
    // Dieselbe Normalisierung wie beim Tippen, damit ein gescannter Code
    // durch keine andere Prüfung läuft als ein eingetippter (§6). Der
    // eigentliche Format- und Alphabet-Check sitzt in `loeseKopplungscodeEin`
    // und trifft beide Wege gleichermaßen.
    const formatiert = formatiereKopplungscodeEingabe(rohwert, { geloescht: false, vorher: '' })

    setzeEingabe(formatiert)
    setzeScanAktiv(false)
    void einloesen(formatiert)
  }

  const { zustand: scanZustand, videoRef: scanVideoRef } = useQrScanner(scanAktiv, codeErkannt)

  /*
   * Getippt wird der Code, den Bindestrich setzt das Feld (§6, Schritt 4). Ob
   * gerade gelöscht wurde, weiß nur das Ereignis; ohne diese Auskunft käme der
   * Bindestrich nach jedem Löschversuch sofort zurück, und das vierte Zeichen
   * ließe sich nicht mehr entfernen.
   */
  function tippen(ereignis: ChangeEvent<HTMLInputElement>) {
    const art = (ereignis.nativeEvent as InputEvent).inputType ?? ''

    setzeEingabe(
      formatiereKopplungscodeEingabe(ereignis.target.value, {
        geloescht: art.startsWith('delete'),
        vorher: eingabe,
      }),
    )
  }

  function absenden(ereignis: FormEvent) {
    ereignis.preventDefault()
    void einloesen(eingabe)
  }

  if (zustand.status === 'fertig') {
    return (
      <main className={stile.seite}>
        <Zurueck ziel="/profil" />

        <div className={stile.kopf}>
          <h1>Fertig</h1>
        </div>

        <Card>
          <p className={stile.name} role="status">
            {zustand.nachricht}
          </p>
        </Card>
      </main>
    )
  }

  if (zustand.status === 'angebot') {
    const { angebot, pruefcode } = zustand.anfrage
    const fallId = gewaehlterFall ?? lesbareFaelle[0]?.id ?? null

    return (
      <main className={stile.seite}>
        <Zurueck ziel="/profil" />

        <div className={stile.kopf}>
          <h1>{angebot.zweck === 'join' ? 'Zum Fall hinzufügen?' : 'Gerät freischalten?'}</h1>
          <p className={stile.einleitung}>
            Vergleichen Sie den Prüfcode am Telefon, bevor Sie bestätigen. Stimmt er nicht überein,
            brechen Sie ab — dann stimmt etwas mit der Verbindung nicht.
          </p>
        </div>

        <Card>
          <h2 className={stile.abschnitt}>Wer da ist</h2>
          <p className={stile.name}>{angebot.anzeigename}</p>
          {angebot.email === null ? null : <p className={stile.hinweis}>{angebot.email}</p>}
        </Card>

        <Card>
          <h2 className={stile.abschnitt}>Prüfcode</h2>
          {/* Zum Vorlesen die Ziffern einzeln, denn verglichen werden Ziffern. */}
          <p className={stile.pruefcode}>
            <span aria-hidden="true">{`${pruefcode.slice(0, 3)} ${pruefcode.slice(3)}`}</span>
            <span className="nur-vorlesen">{[...pruefcode].join(' ')}</span>
          </p>
          <p className={stile.hinweis}>
            Dieselben sechs Ziffern stehen auf der anderen Seite. Sie decken beide Schlüssel des
            Geräts ab.
          </p>
        </Card>

        {angebot.zweck === 'join' && lesbareFaelle.length > 1 ? (
          <Card>
            <h2 className={stile.abschnitt}>Zu welchem Fall?</h2>
            <div className={stile.feld}>
              <label htmlFor="koppeln-fall">Fall</label>
              <select
                id="koppeln-fall"
                className={stile.eingabe}
                value={fallId ?? ''}
                onChange={(ereignis) => setzeGewaehltenFall(ereignis.target.value)}
              >
                {lesbareFaelle.map((fall) => (
                  <option key={fall.id} value={fall.id}>
                    {fall.personName}
                  </option>
                ))}
              </select>
            </div>
          </Card>
        ) : null}

        {angebot.zweck === 'device' ? (
          <Card>
            <p className={stile.hinweis}>
              Freigeschaltet werden alle Fälle, die <strong>dieses</strong> Gerät lesen kann. Fälle,
              die hier gesperrt sind, bleiben es auch dort.
            </p>
          </Card>
        ) : null}

        <div className={stile.knoepfe}>
          {/*
            Ohne geladene Fallliste bleibt der Knopf zu. Ein Klick darauf
            verbrennte den Code an einer Liste, die es noch gar nicht gibt.
            Eingelöst ist er zu diesem Zeitpunkt bereits.
          */}
          <Button
            disabled={laeuft || !faelleBereit || lesbareFaelle.length === 0}
            onClick={() => void bestaetigen(fallId ?? undefined)}
          >
            Prüfcode stimmt überein — bestätigen
          </Button>
          <Button variante="sekundaer" disabled={laeuft} onClick={abbrechen}>
            Abbrechen
          </Button>
        </div>

        {zustand.fehler === null ? null : (
          <p className={stile.hinweis} role="alert">
            {zustand.fehler}
          </p>
        )}

        {faelleBereit && lesbareFaelle.length === 0 ? (
          <p className={stile.hinweis} role="alert">
            Sie können nichts weitergeben, solange dieses Gerät keinen Fall lesen kann. Sie können
            nur teilen, was Sie selbst lesen können.
          </p>
        ) : null}
      </main>
    )
  }

  return (
    <main className={stile.seite}>
      <Zurueck ziel="/profil" />

      <div className={stile.kopf}>
        <h1>Kopplungscode eingeben</h1>
        <p className={stile.einleitung}>
          Lassen Sie sich die acht Zeichen nennen. Groß- und Kleinschreibung spielen keine Rolle,
          und den Bindestrich setzt das Feld selbst.
        </p>
      </div>

      <Card>
        <form className={stile.formular} onSubmit={absenden}>
          <div className={stile.feld}>
            <label htmlFor="koppeln-code">Kopplungscode</label>
            <input
              id="koppeln-code"
              className={`${stile.eingabe} ${stile.codeeingabe}`}
              value={eingabe}
              onChange={tippen}
              maxLength={KOPPLUNGSCODE_LAENGE + 1}
              inputMode="text"
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              required
              autoFocus
            />
          </div>

          <Button type="submit" volleBreite disabled={laeuft}>
            Weiter
          </Button>

          {zustand.status === 'leer' && zustand.fehler !== null ? (
            <p className={stile.hinweis} role="alert">
              {zustand.fehler}
            </p>
          ) : null}
        </form>
      </Card>

      <Card>
        <h2 className={stile.abschnitt}>Oder Code scannen</h2>

        {scanAktiv ? (
          <>
            {scanZustand.status === 'nicht-unterstuetzt' ? (
              <p className={stile.hinweis} role="alert">
                Scannen wird auf diesem Gerät nicht unterstützt, bitte Code eintippen.
              </p>
            ) : scanZustand.status === 'fehler' ? (
              <p className={stile.hinweis} role="alert">
                {scanZustand.nachricht}
              </p>
            ) : (
              <>
                {/*
                  Reines Kamerabild ohne eigenen Inhalt: Was hier zu wissen ist,
                  steht in der Statuszeile daneben (§7).
                */}
                <video
                  ref={scanVideoRef}
                  className={stile.video}
                  autoPlay
                  playsInline
                  muted
                  aria-hidden="true"
                />
                <p className={stile.hinweis} role="status">
                  {scanZustand.status === 'startet'
                    ? 'Kamera wird gestartet…'
                    : 'Halten Sie den QR-Code vor die Kamera.'}
                </p>
              </>
            )}

            <Button variante="sekundaer" volleBreite onClick={() => setzeScanAktiv(false)}>
              Scannen abbrechen
            </Button>
          </>
        ) : (
          <Button variante="sekundaer" volleBreite onClick={() => setzeScanAktiv(true)}>
            Code scannen
          </Button>
        )}
      </Card>
    </main>
  )
}
