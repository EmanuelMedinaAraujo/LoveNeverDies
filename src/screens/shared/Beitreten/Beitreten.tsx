import { useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import type { Kopplungszweck } from '../../../core/db/kopplung.ts'
import { useKopplungscode, useKopplungswache } from '../../../hooks/useKopplung.ts'
import { gruppierterKopplungscode } from '../../../services/kopplungService.ts'
import { Button } from '../../../ui/Button/Button.tsx'
import { Card } from '../../../ui/Card/Card.tsx'
import stile from './Beitreten.module.css'

/**
 * Die beitretende Seite der Kopplung (DESIGN.md §6, Schritt 1 bis 3 und 7).
 *
 * Derselbe Screen für beide Zwecke, weil §6 ausdrücklich feststellt, dass der
 * Ablauf identisch ist — nur mit `purpose = device` und Einstieg über Profil.
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
      'Nennen Sie diesen Code der Person, die Sie eingeladen hat — am Telefon oder persönlich. Sie gilt 15 Minuten und genau einmal.',
    erfolg: 'Sie gehören jetzt zum Fall.',
  },
  device: {
    titel: 'Dieses Gerät freischalten',
    einleitung:
      'Nennen Sie diesen Code Ihrem anderen Gerät, das den Fall bereits lesen kann. Er gilt 15 Minuten und genau einmal.',
    erfolg: 'Dieses Gerät ist freigeschaltet.',
  },
}

/** Sechs Ziffern in zwei Gruppen, wie in Profil → Geräte. */
function gruppierterPruefcode(pruefcode: string): string {
  return `${pruefcode.slice(0, 3)} ${pruefcode.slice(3)}`
}

export function Beitreten({ zweck }: { zweck: Kopplungszweck }) {
  const { zustand, neuAnfordern } = useKopplungscode(zweck)
  const wache = useKopplungswache(zustand.status === 'bereit')
  const navigate = useNavigate()

  const texte = TEXTE[zweck]
  const freigeschaltet = wache.status === 'freigeschaltet'

  useEffect(() => {
    if (!freigeschaltet) {
      return
    }

    /*
     * §6, Schritt 7: „schaltet innerhalb von Sekunden frei". Der Weg nach `/`
     * ist dabei mehr als Bequemlichkeit — der Startscreen lädt seine Fälle beim
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
      <div className={stile.kopf}>
        <h1>{texte.titel}</h1>
        <p className={stile.einleitung}>{texte.einleitung}</p>
      </div>

      {zustand.status === 'laedt' ? (
        <p className={stile.hinweis} role="status">
          Ihr Kopplungscode wird erzeugt…
        </p>
      ) : null}

      {zustand.status === 'fehler' ? (
        <Card>
          <p className={stile.hinweis} role="alert">
            Es war kein Kopplungscode zu bekommen. {zustand.nachricht}
          </p>
          <div className={stile.knoepfe}>
            <Button onClick={neuAnfordern}>Noch einmal versuchen</Button>
          </div>
        </Card>
      ) : null}

      {zustand.status === 'bereit' ? (
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
              <li>Die andere Seite bestätigt — und diese Seite schaltet von selbst frei.</li>
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

      <p className={stile.hinweis}>
        <Link to={zweck === 'device' ? '/profil' : '/'}>Zurück</Link>
      </p>
    </main>
  )
}
