import { useState } from 'react'
import { Navigate } from 'react-router-dom'
import { useAufgaben } from '../../../hooks/useAufgaben.ts'
import { useCase } from '../../../hooks/useCase.ts'
import type { Nachlasseintrag } from '../../../services/aufgabenService.ts'
import type { LesbarerFall } from '../../../services/fallService.ts'
import { Card } from '../../../ui/Card/Card.tsx'
import { Zurueck } from '../../../ui/Zurueck/Zurueck.tsx'
import { KeinFall } from '../KeinFall/KeinFall.tsx'
import { fallLadeText } from '../Ladeanzeige/FallLadeanzeige.tsx'
import stile from './Nachlass.module.css'

/**
 * Der geöffnete Nachlass-Tresor (DESIGN.md §3.5, §7).
 *
 * Was die vorsorgende Person hinterlegt hat, an einer Stelle und vollständig:
 * Bankverbindungen, Zugänge, ein Brief. Vor dem Öffnen gab es diesen Screen
 * nicht, weil es nichts zu zeigen gab — die Einträge lagen unter `K_v`, und
 * den hatte niemand. Nach dem Öffnen liegen ihre DEKs unter `K_c` und jedes
 * Mitglied kann sie lesen.
 *
 * **Nur lesen.** Kein Häkchen, keine Zuständigkeit, kein „Löschen". Eine
 * hinterlegte Notiz ist keine Aufgabe, die jemand abhakt, und ein Löschen wäre
 * hier endgültig (§5) — die letzte Nachricht einer verstorbenen Person, einen
 * Fehltipp von der Auslöschung entfernt. Wer etwas davon braucht, schreibt sich
 * dazu eine eigene Aufgabe.
 *
 * **Zugeklappt.** Ein Zugang steht sonst offen auf einem Bildschirm, den
 * jemand am Küchentisch weiterreicht. Der Titel steht da, der Inhalt kommt auf
 * Tippen. Das ist kein Schutz — wer den Fall lesen darf, liest alles —, aber
 * es ist der Unterschied zwischen „nachsehen" und „danebenliegen".
 *
 * Ein eigener Screen und keine Karte im Tab Erbe: Dort steht, wie es um den
 * Fall bestellt ist, hier steht der Inhalt. Der Weg dorthin ist die Karte
 * „Nachlass-Tresor", und der Weg zurück steht oben links (§7).
 */

function Ladeanzeige({ text }: { text: string }) {
  return (
    <p className={stile.hinweis} role="status">
      {text}
    </p>
  )
}

function Eintrag({ eintrag }: { eintrag: Nachlasseintrag }) {
  const [offen, setzeOffen] = useState(false)

  return (
    <li className={stile.eintrag}>
      {/*
        `<details>` und nicht ein eigener Zustand mit `aria-expanded`: Der
        Browser bringt Rolle, Tastensteuerung und Ansage mit, und die
        Vorlesestimme sagt „zugeklappt" ohne dass jemand daran denken muss.
        Der Zustand hier oben dient nur dem Text der Zusammenfassung.
      */}
      <details onToggle={(ereignis) => setzeOffen(ereignis.currentTarget.open)}>
        <summary className={stile.titel}>
          <span>{eintrag.titel}</span>
          <span className={stile.schalter}>{offen ? 'Zuklappen' : 'Anzeigen'}</span>
        </summary>

        {eintrag.inhalt.trim() === '' ? (
          <p className={stile.leer}>Zu diesem Eintrag steht nichts weiter da.</p>
        ) : (
          /*
            `white-space: pre-wrap` in der CSS: Wer einen Brief oder eine Liste
            von Zugängen hinterlegt, hat die Zeilenumbrüche gesetzt, und sie
            wegzurechnen machte aus der Liste einen Absatz.
          */
          <p className={stile.inhalt}>{eintrag.inhalt}</p>
        )}
      </details>
    </li>
  )
}

function Inhalte({ fall }: { fall: LesbarerFall }) {
  const { zustand, nachlass } = useAufgaben(fall)

  if (zustand.status === 'laedt') {
    return <Ladeanzeige text="Der Tresor wird geöffnet…" />
  }

  return (
    <Card>
      {nachlass.length === 0 ? (
        <p className={stile.hinweis}>
          {/*
            Ein leerer Tresor und ein noch ladender sind nicht dasselbe (§5).
            Der ladende ist oben schon abgefangen; hier steht wirklich nichts.
          */}
          {zustand.laedtNetz
            ? 'Der Tresor wird geöffnet…'
            : `${fall.personName} hat nichts im Tresor hinterlegt.`}
        </p>
      ) : (
        <ul className={stile.liste}>
          {nachlass.map((eintrag) => (
            <Eintrag key={eintrag.id} eintrag={eintrag} />
          ))}
        </ul>
      )}
    </Card>
  )
}

export function Nachlass() {
  const { zustand } = useCase()

  if (zustand.status === 'laedt' || zustand.status === 'schluessel-erneuerung') {
    return (
      <main className={stile.seite}>
        <Zurueck ziel="/erbe" />
        <Ladeanzeige text={fallLadeText(zustand.status)} />
      </main>
    )
  }

  if (zustand.status === 'kein-fall') {
    return <KeinFall />
  }

  if (zustand.status === 'fehler') {
    return (
      <main className={stile.seite}>
        <Zurueck ziel="/erbe" />
        <p className={stile.hinweis} role="alert">
          Der Fall war nicht zu laden: {zustand.nachricht}
        </p>
      </main>
    )
  }

  const fall = zustand.aktiver

  /*
   * §3.5: Solange der Tresor versiegelt ist, gibt es hier nichts zu zeigen —
   * die Einträge liegen unter `K_v`. Der Freigabestand steht im Tab Erbe, und
   * dorthin geht es, statt auf einem leeren Screen zu enden.
   */
  if (fall.zustand === 'gesperrt' || fall.status === 'vorsorge') {
    return <Navigate to="/erbe" replace />
  }

  return (
    <main className={stile.seite}>
      <Zurueck ziel="/erbe" />

      <div className={stile.kopf}>
        <h1>Nachlass-Tresor</h1>
        <p className={stile.hinweis}>
          Was {fall.personName} hinterlegt hat. Nur zum Lesen — geändert wird hier nichts.
        </p>
      </div>

      <Inhalte fall={fall} />
    </main>
  )
}
