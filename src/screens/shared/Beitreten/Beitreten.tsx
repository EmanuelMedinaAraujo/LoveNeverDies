import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import type { Kopplungszweck } from '../../../core/db/kopplung.ts'
import { alsNachricht } from '../../../core/fehler.ts'
import { useKopplungscode, useKopplungswache } from '../../../hooks/useKopplung.ts'
import {
  gruppierterKopplungscode,
  gruppierterPruefcode,
} from '../../../services/kopplungService.ts'
import { Button } from '../../../ui/Button/Button.tsx'
import { Card } from '../../../ui/Card/Card.tsx'
import { QrCode } from '../../../ui/QrCode/QrCode.tsx'
import { Zurueck } from '../../../ui/Zurueck/Zurueck.tsx'
import stile from './Beitreten.module.css'

/**
 * Die beitretende Seite der Kopplung (DESIGN.md §6, Schritt 1 bis 3 und 7).
 *
 * Derselbe Screen für beide Zwecke, weil §6 ausdrücklich feststellt, dass der
 * Ablauf identisch ist, nur mit `purpose = device` und Einstieg über Profil.
 * Zwei Screens, die sich in zwei Sätzen unterscheiden, wären zwei Stellen, an
 * denen der Prüfcode-Hinweis auseinanderlaufen kann.
 *
 * Was hier steht, steht groß: der Code zum Vorlesen und der eigene Prüfcode.
 * Beides wird am Telefon genannt, und der zweite entscheidet darüber, ob der
 * Schlüssel bei der richtigen Person landet (§3.6).
 */

const TEXTE: Record<Kopplungszweck, { titel: string; einleitung: string; erfolg: string }> = {
  join: {
    titel: 'Ich wurde eingeladen',
    einleitung:
      'Nennen Sie diesen Code der Person, die Sie eingeladen hat, am Telefon oder persönlich. Sie gilt 15 Minuten und genau einmal.',
    erfolg: 'Sie gehören jetzt zum Fall.',
  },
  device: {
    titel: 'Dieses Gerät freischalten',
    einleitung:
      'Nennen Sie diesen Code Ihrem anderen Gerät, das den Fall bereits lesen kann. Er gilt 15 Minuten und genau einmal.',
    erfolg: 'Dieses Gerät ist freigeschaltet.',
  },
}

/**
 * Ein QR-Code-Symbol, rein zur Kennzeichnung des Knopfs.
 *
 * `aria-hidden`, weil das gesprochene Label am Button selbst steht
 * (`aria-label`): Ein Icon allein ist bei dieser Zielgruppe eine Vermutung,
 * kein Wegweiser (§7, wie in `src/ui/Leiste/Symbole.tsx`).
 */
function SymbolQrCode() {
  return (
    <svg
      width="1.5em"
      height="1.5em"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <rect x="3.5" y="3.5" width="6" height="6" rx="1" />
      <rect x="14.5" y="3.5" width="6" height="6" rx="1" />
      <rect x="3.5" y="14.5" width="6" height="6" rx="1" />
      <path d="M14.5 14.5h2.6M18.6 14.5h1.9M14.5 18.6h1.9M18.6 18.6h1.9M14.5 20.5h1.9M20.5 14.5v1.9M20.5 18.6v1.9" />
    </svg>
  )
}

/** "12:34 Uhr", oder nichts, wenn der Zeitstempel keiner ist. */
function uhrzeit(zeitpunkt: string): string | null {
  const datum = new Date(zeitpunkt)

  return Number.isNaN(datum.getTime())
    ? null
    : datum.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })
}

/**
 * „Wie heißen Sie?" — der eine Schritt vor dem Kopplungscode (§3.3, §6).
 *
 * Ein eigenes Formular und kein Feld irgendwo dazwischen: Solange der Name
 * fehlt, gibt es auf diesem Screen nichts anderes zu tun, und ein Code, der
 * daneben schon stünde, wäre einer, den niemand einlösen kann.
 */
function Namensfrage({ onSpeichern }: { onSpeichern: (name: string) => Promise<void> }) {
  const [name, setzeNamen] = useState('')
  const [laeuft, setzeLaeuft] = useState(false)
  const [fehler, setzeFehler] = useState<string | null>(null)

  async function absenden(ereignis: FormEvent) {
    ereignis.preventDefault()
    setzeLaeuft(true)
    setzeFehler(null)

    try {
      await onSpeichern(name)
    } catch (ursache) {
      setzeFehler(alsNachricht(ursache))
      setzeLaeuft(false)
    }
  }

  return (
    <Card>
      <h2 className={stile.abschnitt}>Wie heißen Sie?</h2>
      <p className={stile.hinweis}>
        Die Person, die Sie einlädt, sieht diesen Namen, bevor sie Sie in den Fall aufnimmt.
      </p>

      <form className={stile.formular} onSubmit={(ereignis) => void absenden(ereignis)}>
        <div className={stile.feld}>
          <label htmlFor="beitreten-name">Ihr Name</label>
          <input
            id="beitreten-name"
            className={stile.eingabe}
            value={name}
            onChange={(ereignis) => setzeNamen(ereignis.target.value)}
            placeholder="Vor- und Nachname"
            autoComplete="name"
            required
            autoFocus
          />
        </div>

        <Button type="submit" volleBreite disabled={laeuft}>
          Weiter
        </Button>

        {fehler === null ? null : (
          <p className={stile.hinweis} role="alert">
            Ihr Name war nicht zu hinterlegen. {fehler}
          </p>
        )}
      </form>
    </Card>
  )
}

export function Beitreten({ zweck }: { zweck: Kopplungszweck }) {
  const { zustand, nameFehlt, speichereNamen, neuAnfordern } = useKopplungscode(zweck)
  const wache = useKopplungswache(zustand.status === 'bereit')
  const navigate = useNavigate()

  const texte = TEXTE[zweck]
  const freigeschaltet = wache.status === 'freigeschaltet'

  const laeuftAbAm = zustand.status === 'bereit' ? zustand.laeuftAbAm : null

  /*
   * Im State steht der Zeitpunkt, dessen Uhr abgelaufen ist, kein `boolean`.
   * Ein frischer Code bringt einen anderen Zeitpunkt mit und gilt damit von
   * selbst wieder; ein Flag müsste jemand zurücksetzen, und genau das vergisst
   * man beim nächsten Zweig.
   */
  const [abgelaufenerZeitpunkt, setzeAbgelaufenenZeitpunkt] = useState<string | null>(null)
  const abgelaufen = laeuftAbAm !== null && abgelaufenerZeitpunkt === laeuftAbAm

  /*
   * Der QR-Code ist zu, bis jemand ihn ausdrücklich anfordert (Punkt 5 der
   * Kopplungs-Anforderungen). Er ersetzt das Vorlesen nicht, sondern bietet es
   * nur als Alternative an, und ein Bildschirm, der ihn ungefragt zeigt, hat
   * für jede Person, die den Code stattdessen am Telefon nennt, nur eine
   * Fläche mehr auf dem Schirm.
   */
  const [qrOffen, setzeQrOffen] = useState(false)

  useEffect(() => {
    if (laeuftAbAm === null) {
      return
    }

    /*
     * §6: Ein Code gilt 15 Minuten. Ohne diese Uhr stünde er danach weiter groß
     * auf dem Screen, und jemand läse ihn am Telefon vor, während die andere
     * Seite "abgelaufen" zurückbekommt.
     *
     * Die Wache läuft trotzdem weiter, und das ist kein Versehen: Wer den Code
     * *vor* dem Ablauf eingelöst hat, darf ihn danach noch bestätigen; der
     * Abgleich am Telefon soll nicht unter Zeitdruck stehen
     * (`schliesse_kopplung_ab`). Diese Seite muss die Freigabe also weiter
     * mitbekommen.
     */
    const rest = new Date(laeuftAbAm).getTime() - Date.now()

    // Ein Zeitstempel, den niemand lesen kann, ist kein abgelaufener Code: Dann
    // steht daneben "Er gilt 15 Minuten." und sonst nichts.
    if (Number.isNaN(rest)) {
      return
    }

    const takt = setTimeout(() => setzeAbgelaufenenZeitpunkt(laeuftAbAm), Math.max(rest, 0))

    return () => clearTimeout(takt)
  }, [laeuftAbAm])

  useEffect(() => {
    if (!freigeschaltet) {
      return
    }

    /*
     * §6, Schritt 7: "schaltet innerhalb von Sekunden frei". Der Weg nach `/`
     * ist dabei mehr als Bequemlichkeit: Der Startscreen lädt seine Fälle beim
     * Aufbau neu, und was dort steht, hat den vollen Weg aus §3.6 durchlaufen:
     * Wrap holen, Signatur prüfen, entpacken.
     *
     * Eine kurze Pause davor, damit die Erfolgsmeldung nicht ungelesen
     * vorbeizieht.
     */
    const takt = setTimeout(() => navigate('/', { replace: true }), 1_500)

    return () => clearTimeout(takt)
  }, [freigeschaltet, navigate])

  return (
    <main className={stile.seite}>
      <Zurueck ziel={zweck === 'device' ? '/profil' : '/'} />

      <div className={stile.kopf}>
        <h1>{texte.titel}</h1>
        <p className={stile.einleitung}>{texte.einleitung}</p>
      </div>

      {/*
        §3.3, §6: Ohne hinterlegten Namen gibt es keinen Kopplungscode — und
        das ist keine Formalie der Datenbank. Die einladende Person sieht
        gleich „Wer da ist" und entscheidet daran, ob sie den Fall weitergibt.
        Stünde dort nichts oder eine verborgene Apple-Adresse, entschiede sie
        über einen Fremden.

        Gefragt wird nur, wo wirklich nichts steht: Wer seinen Namen bei der
        Anmeldung angegeben hat, bekommt seinen Code ohne Zwischenschritt.
      */}
      {nameFehlt ? <Namensfrage onSpeichern={speichereNamen} /> : null}

      {!nameFehlt && zustand.status === 'laedt' ? (
        <p className={stile.hinweis} role="status">
          Ihr Kopplungscode wird erzeugt…
        </p>
      ) : null}

      {!nameFehlt && zustand.status === 'fehler' ? (
        <Card>
          <p className={stile.hinweis} role="alert">
            Es war kein Kopplungscode zu bekommen. {zustand.nachricht}
          </p>
          <div className={stile.knoepfe}>
            <Button onClick={neuAnfordern}>Noch einmal versuchen</Button>
          </div>
        </Card>
      ) : null}

      {!nameFehlt && zustand.status === 'bereit' ? (
        <>
          <Card>
            <h2 className={stile.abschnitt}>Ihr Kopplungscode</h2>
            {/*
              Zum Vorlesen die Zeichen einzeln: Ein Screenreader macht aus
              "K4M7-QP2X" sonst Wortbrocken, und verglichen werden Zeichen.
            */}
            <p className={stile.code} aria-hidden="true">
              {gruppierterKopplungscode(zustand.code)}
            </p>
            <p className="nur-vorlesen">Ihr Kopplungscode lautet {[...zustand.code].join(' ')}</p>
            <p className={stile.hinweis}>
              In diesem Code kommen kein O, keine 0, kein I und keine 1 vor.
            </p>
            {abgelaufen ? (
              <p className={stile.hinweis} role="alert">
                Dieser Code ist abgelaufen. Bitte fordern Sie einen neuen an.
              </p>
            ) : (
              <p className={stile.hinweis}>
                {uhrzeit(zustand.laeuftAbAm) === null
                  ? 'Er gilt 15 Minuten.'
                  : `Er gilt bis ${uhrzeit(zustand.laeuftAbAm)} Uhr.`}
              </p>
            )}

            {/*
              Alternative zum Vorlesen: derselbe Code als QR-Code, zum
              Scannen statt Abtippen. Zu, bis jemand ausdrücklich danach
              fragt -- der Knopf trägt nur ein Symbol, das Label steht als
              `aria-label` daran, sonst hörte eine blinde Person nur
              "Schaltfläche" (§7).
            */}
            <div className={stile.qrKnopf}>
              <Button
                variante="sekundaer"
                aria-expanded={qrOffen}
                aria-label={qrOffen ? 'QR-Code verbergen' : 'QR-Code anzeigen'}
                onClick={() => setzeQrOffen((vorher) => !vorher)}
              >
                <SymbolQrCode />
              </Button>
            </div>

            {qrOffen ? (
              <div className={stile.qrBereich}>
                <QrCode wert={zustand.code} />
                <p className={stile.hinweis}>
                  Lassen Sie die andere Seite diesen QR-Code scannen, statt den Kopplungscode
                  vorzulesen.
                </p>
              </div>
            ) : null}
          </Card>

          <Card>
            <h2 className={stile.abschnitt}>Ihr Prüfcode</h2>
            <p className={stile.pruefcode}>
              <span aria-hidden="true">{gruppierterPruefcode(zustand.pruefcode)}</span>
              <span className="nur-vorlesen">{[...zustand.pruefcode].join(' ')}</span>
            </p>
            <p className={stile.hinweis}>
              Die andere Seite sieht dieselben sechs Ziffern, sobald sie den Kopplungscode
              eingegeben hat. Vergleichen Sie sie miteinander, bevor jemand bestätigt. Stimmen sie
              nicht überein, brechen Sie ab.
            </p>
          </Card>

          <Card>
            <h2 className={stile.abschnitt}>So geht es weiter</h2>
            <ol className={stile.schritte}>
              <li>Sie nennen den Kopplungscode.</li>
              <li>Die andere Seite gibt ihn ein und sieht Ihren Namen und den Prüfcode.</li>
              <li>Sie vergleichen den Prüfcode miteinander.</li>
              <li>Die andere Seite bestätigt, und diese Seite schaltet von selbst frei.</li>
            </ol>

            <p className={stile.hinweis} role="status">
              {wache.status === 'freigeschaltet'
                ? texte.erfolg
                : wache.status === 'fehler'
                  ? `Der Stand ist gerade nicht abrufbar. ${wache.nachricht}`
                  : 'Warten auf die Bestätigung…'}
            </p>

            <div className={stile.knoepfe}>
              <Button variante="sekundaer" onClick={neuAnfordern}>
                Neuen Code anfordern
              </Button>
            </div>
          </Card>
        </>
      ) : null}
    </main>
  )
}
