import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { alsNachricht } from '../../../core/fehler.ts'
import { useAufgaben } from '../../../hooks/useAufgaben.ts'
import { useCase } from '../../../hooks/useCase.ts'
import { useTresor } from '../../../hooks/useTresor.ts'
import type { LesbarerFall } from '../../../services/fallService.ts'
import { checklistenstand } from '../../../services/tresorService.ts'
import { Badge } from '../../../ui/Badge/Badge.tsx'
import { Button } from '../../../ui/Button/Button.tsx'
import { Card } from '../../../ui/Card/Card.tsx'
import { NeueAufgabe } from '../../erweitert/Alle/Alle.tsx'
import { Vorsorgeseite } from './Vorsorgeseite.tsx'
import { SymbolAufgabe, SymbolCheckliste } from './Symbole.tsx'
import stile from './Nachlassbereich.module.css'

/**
 * Der Tab „Nachlass" im Vorsorgefall (DESIGN.md §3.5, §7).
 *
 * Er ist der erste Screen, den eine vorsorgende Person sieht, und deshalb
 * beantwortet er zuerst die Frage, die vor allen anderen steht: Was passiert
 * eigentlich mit dem, was ich hier eintrage? Darauf antwortet der Tresor-Status
 * — versiegelt, und ohne Angehörige kann ihn niemand öffnen. Erst darunter
 * stehen die beiden Wege.
 *
 * Zwei Wege und keiner mehr. Vorher stand hier alles zugleich: Status,
 * Einladung, acht Fragen mit acht Feldern, freie Tresor-Einträge und ganz
 * unten das Löschen des Falls. Die Fragen liegen jetzt hinter „Nachlass-Checkliste",
 * das Löschen in Profil.
 *
 * Eine neue Aufgabe entsteht über den Dialog aus §7 direkt auf Knopfdruck,
 * ohne Umweg über eine Übergangsseite.
 */
function Inhalt({ fall }: { fall: LesbarerFall }) {
  const { aktualisiere } = useCase()
  const { zustand, zeilen, mutiere, legeAn } = useAufgaben(fall)
  const { items, schwelle, resplitPending, resplitLaeuft, resplitFehler, verteileShares } =
    useTresor(fall, zeilen, mutiere, aktualisiere)
  const navigate = useNavigate()

  const [legtAn, setzeLegtAn] = useState(false)
  const [laeuft, setzeLaeuft] = useState(false)
  const [fehler, setzeFehler] = useState<string | null>(null)

  async function fuehreAus(arbeit: () => Promise<unknown>): Promise<boolean> {
    setzeLaeuft(true)
    setzeFehler(null)

    try {
      await arbeit()
      return true
    } catch (ursache) {
      setzeFehler(alsNachricht(ursache))
      return false
    } finally {
      setzeLaeuft(false)
    }
  }

  const stand = checklistenstand(items)
  const laedt = zustand.status === 'laedt'

  return (
    <main className={stile.seite}>
      <div className={stile.kopf}>
        <h1>Nachlass</h1>
        <p className={stile.hinweis}>{fall.personName} · Vorsorge</p>
      </div>

      {fehler === null ? null : (
        <p className={stile.warnung} role="alert">
          {fehler}
        </p>
      )}

      <Card>
        <div className={stile.statusKopf}>
          <h2 className={stile.abschnitt}>Tresor-Status</h2>
          <Badge lage="ruhig">Versiegelt</Badge>
        </div>

        {/*
          Drei Lagen, drei Sätze (§3.5). Der erste ist der einzige, der zu
          etwas auffordert: Ohne Angehörige gibt es niemanden, der den Tresor
          im Ernstfall öffnen könnte, und alles, was hier hineingeht, wäre
          verschlossen und verloren. Die Einladung steht deshalb direkt
          darunter und nicht in Profil, wo sie ebenfalls steht — hier ist der
          Ort, an dem der Grund dafür sichtbar wird (§6).
        */}
        {schwelle.n === 0 ? (
          <>
            <p className={stile.warnung}>
              Der Tresor ist versiegelt. Was Sie hier hinterlegen, kann nach Ihrem Tod nur von
              Ihren Angehörigen geöffnet werden. Bitte laden Sie Angehörige ein, damit sie im
              Ernstfall an Ihre Angaben kommen.
            </p>
            <Button volleBreite onClick={() => navigate('/koppeln')}>
              Angehörige einladen
            </Button>
          </>
        ) : (
          <>
            <p className={stile.hinweis}>
              {schwelle.n === 1
                ? 'Solange nur eine angehörige Person hinterlegt ist, kann diese den Tresor allein öffnen.'
                : `Zur Öffnung sind ${schwelle.k} von ${schwelle.n} Freigaben erforderlich.`}
            </p>
            <Button variante="sekundaer" volleBreite onClick={() => navigate('/koppeln')}>
              Weitere Angehörige einladen
            </Button>
          </>
        )}

        {resplitPending && !resplitLaeuft ? (
          <p className={stile.hinweis} role="status">
            Die Angehörigen haben sich geändert. Die Tresorschlüssel werden aktualisiert…
          </p>
        ) : null}

        {resplitLaeuft ? (
          <p className={stile.hinweis} role="status">
            Schlüssel werden neu verteilt…
          </p>
        ) : null}

        {resplitFehler !== null && !resplitLaeuft ? (
          <>
            <p className={stile.warnung} role="alert">
              Die Schlüssel konnten nicht neu verteilt werden: {resplitFehler} Bis das gelingt,
              können die zuletzt hinzugekommenen Angehörigen den Tresor nicht freigeben.
            </p>
            {/*
              Von Hand und nicht von allein: Ein automatischer zweiter Versuch
              liefe bei einem dauerhaften Fehler in eine Schleife gegen den
              Server. Die vorsorgende Person sieht den Stand und entscheidet.
            */}
            <Button
              variante="sekundaer"
              volleBreite
              onClick={() => void verteileShares().catch(() => undefined)}
            >
              Erneut versuchen
            </Button>
          </>
        ) : null}
      </Card>

      <div className={stile.wege}>
        <button
          type="button"
          className={stile.weg}
          onClick={() => setzeLegtAn(true)}
        >
          <Card>
            <div className={stile.wegKopf}>
              <SymbolAufgabe />
              <h2 className={stile.wegTitel}>Aufgabe erstellen</h2>
            </div>
            <p className={stile.hinweis}>
              Persönliche Bitten und kleine Aufgaben, die Ihre Angehörigen später übernehmen.
            </p>
          </Card>
        </button>

        <Link className={stile.weg} to="/nachlass/checkliste">
          <Card>
            <div className={stile.wegKopf}>
              <SymbolCheckliste />
              <h2 className={stile.wegTitel}>Nachlass-Checkliste</h2>
              {/*
                Der Stand steht am Weg und nicht erst dahinter: Wer die App
                zum zweiten Mal öffnet, will wissen, ob noch etwas offen ist,
                ohne dafür hineinzugehen. Solange die Zeilen laden, steht dort
                nichts — „0 von 8" wäre eine Auskunft, die gleich widerrufen
                wird (§5).
              */}
              {laedt ? null : (
                <Badge lage="ruhig">
                  {stand.beantwortet} von {stand.gesamt}
                </Badge>
              )}
            </div>
            <p className={stile.hinweis}>
              Wo die Papiere liegen, welche Verträge laufen, was mit der Bestattung sein soll.
              Ihre Antworten liegen verschlüsselt im Tresor.
            </p>
          </Card>
        </Link>
      </div>

      {legtAn ? (
        <NeueAufgabe
          gesperrt={laeuft}
          aufSchliessen={() => setzeLegtAn(false)}
          aufAnlegen={(titel, nurFuerMich, angaben) =>
            fuehreAus(() => legeAn(titel, null, nurFuerMich, angaben))
          }
        />
      ) : null}
    </main>
  )
}

export function Nachlassbereich() {
  return <Vorsorgeseite kinder={(fall) => <Inhalt fall={fall} />} />
}
