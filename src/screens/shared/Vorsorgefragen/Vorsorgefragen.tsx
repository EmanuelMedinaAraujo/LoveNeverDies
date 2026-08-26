import { useState, type FormEvent } from 'react'
import { VORSORGEFRAGEN } from '../../../content/vorsorgefragen.ts'
import { alsNachricht } from '../../../core/fehler.ts'
import { antwortZuFrage, type TresorItem } from '../../../services/tresorService.ts'
import type { Vorsorgefrage } from '../../../types/vorsorgefrage.ts'
import { Button } from '../../../ui/Button/Button.tsx'
import { Card } from '../../../ui/Card/Card.tsx'
import stile from './Vorsorgefragen.module.css'

/**
 * Die acht Vorsorgefragen mit ihren Antworten (DESIGN.md §3.5).
 *
 * Derselbe Block auf dem ersten Screen und im Tresor, und deshalb liegt er
 * hier und nicht in einem der beiden: Die Fragen sollen dort stehen, wo die
 * vorsorgende Person die App öffnet, und dort wiederzufinden sein, wo ihre
 * Antworten liegen. Zwei Fassungen desselben Formulars wären zwei Stellen, an
 * denen sich der Wortlaut auseinanderentwickelt.
 *
 * Eine Frage, ein Feld, eine Schaltfläche. Kein Sammelspeichern über alle acht:
 * Wer eine Frage beantwortet und die nächsten sieben offen lässt, hat gespeichert;
 * ein einzelner Knopf ganz unten machte aus sieben leeren Feldern die Bedingung
 * dafür, dass die eine Antwort ankommt.
 *
 * Der Screen verschlüsselt nichts. Das tut `tresorService`, aufgerufen über
 * `useTresor`: Die Antwort geht als Tresor-Item unter `K_v` in den Fall wie
 * jeder andere Inhalt dort — Angehörige lesen sie erst nach dem Trauerfall.
 */

function Frage({
  frage,
  antwortItem,
  onSpeichern,
}: {
  frage: Vorsorgefrage
  antwortItem: TresorItem | null
  onSpeichern: (frageId: string, frage: string, antwort: string) => Promise<void>
}) {
  const gespeichert = antwortItem === null ? '' : antwortItem.inhalt

  const [antwort, setzeAntwort] = useState(gespeichert)
  const [zuletztGesehen, setzeZuletztGesehen] = useState(gespeichert)
  const [laeuft, setzeLaeuft] = useState(false)
  const [fehler, setzeFehler] = useState<string | null>(null)

  /*
   * Was im Tresor steht, gewinnt, aber erst, wenn es sich wirklich geändert
   * hat. Sonst überschriebe jede Sync-Runde den halb getippten Satz — dieselbe
   * Überlegung wie bei den Notizen einer Aufgabe (§5, §7).
   */
  if (zuletztGesehen !== gespeichert) {
    setzeZuletztGesehen(gespeichert)
    setzeAntwort(gespeichert)
  }

  const geaendert = antwort !== gespeichert

  async function absenden(ereignis: FormEvent) {
    ereignis.preventDefault()
    setzeLaeuft(true)
    setzeFehler(null)

    try {
      await onSpeichern(frage.id, frage.frage, antwort)
    } catch (ursache) {
      setzeFehler(alsNachricht(ursache))
    } finally {
      setzeLaeuft(false)
    }
  }

  const feldId = `vorsorgefrage-${frage.id}`

  return (
    <Card>
      <form className={stile.formular} onSubmit={(ereignis) => void absenden(ereignis)}>
        <div className={stile.feld}>
          {/*
            Die Frage ist die Beschriftung des Feldes und keine Überschrift
            darüber: Wer sie vorgelesen bekommt, bekommt sie genau dann, wenn
            der Fokus im Feld steht, und muss sie nicht im Kopf behalten (§7).
          */}
          <label className={stile.frage} htmlFor={feldId}>
            {frage.frage}
          </label>
          <textarea
            id={feldId}
            className={stile.textbereich}
            rows={5}
            value={antwort}
            onChange={(ereignis) => setzeAntwort(ereignis.target.value)}
            placeholder="Ihre Antwort"
          />
        </div>

        {fehler === null ? null : (
          <p className={stile.warnung} role="alert">
            Ihre Antwort war nicht zu speichern. {fehler}
          </p>
        )}

        <Button type="submit" volleBreite disabled={laeuft || !geaendert}>
          Speichern
        </Button>

        {/*
          Die Bestätigung steht nur da, solange nichts Ungespeichertes daneben
          liegt. "Gespeichert" unter einem Feld, in dem gerade jemand tippt,
          wäre die falsche Auskunft über genau den Satz, den man vor sich sieht.
        */}
        {!geaendert && gespeichert !== '' ? (
          <p className={stile.gespeichert} role="status">
            Ihre Antwort ist im Tresor gespeichert.
          </p>
        ) : null}
      </form>
    </Card>
  )
}

export function Vorsorgefragen({
  items,
  onSpeichern,
}: {
  /** Alle Tresor-Inhalte; die Antworten sucht dieser Block sich selbst heraus. */
  items: TresorItem[]
  onSpeichern: (frageId: string, frage: string, antwort: string) => Promise<void>
}) {
  return (
    <div className={stile.fragen}>
      {VORSORGEFRAGEN.map((frage) => (
        <Frage
          key={frage.id}
          frage={frage}
          antwortItem={antwortZuFrage(items, frage.id)}
          onSpeichern={onSpeichern}
        />
      ))}
    </div>
  )
}
