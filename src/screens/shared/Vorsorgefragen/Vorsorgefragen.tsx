import { useState, type FormEvent } from 'react'
import { VORSORGEFRAGEN } from '../../../content/vorsorgefragen.ts'
import { alsNachricht } from '../../../core/fehler.ts'
import { antwortZuFrage, eigeneFragen, type TresorItem } from '../../../services/tresorService.ts'
import type { Vorsorgefrage } from '../../../types/vorsorgefrage.ts'
import { Button } from '../../../ui/Button/Button.tsx'
import { Card } from '../../../ui/Card/Card.tsx'
import stile from './Vorsorgefragen.module.css'

/**
 * Die Vorsorgefragen mit ihren Antworten (DESIGN.md §3.5).
 *
 * Derselbe Block auf dem ersten Screen und im Tresor, und deshalb liegt er
 * hier und nicht in einem der beiden: Die Fragen sollen dort stehen, wo die
 * vorsorgende Person die App öffnet, und dort wiederzufinden sein, wo ihre
 * Antworten liegen. Zwei Fassungen desselben Formulars wären zwei Stellen, an
 * denen sich der Wortlaut auseinanderentwickelt.
 *
 * Zuerst die acht gelieferten Fragen, darunter die selbst gestellten, und
 * ganz unten das Feld, um eine weitere zu stellen. Eine selbst gestellte Frage
 * sieht aus wie eine gelieferte und wird genauso beantwortet: Wer aufschreibt,
 * wo der Zweitschlüssel liegt, tut dasselbe wie beim Testament, und dafür ein
 * zweites Formular zu bauen hiesse, denselben Vorgang zweimal zu erklären.
 *
 * Eine Frage, ein Feld, eine Schaltfläche. Kein Sammelspeichern über alle:
 * Wer eine Frage beantwortet und die nächsten offen lässt, hat gespeichert;
 * ein einzelner Knopf ganz unten machte aus den leeren Feldern die Bedingung
 * dafür, dass die eine Antwort ankommt.
 *
 * Der Screen verschlüsselt nichts. Das tut `tresorService`, aufgerufen über
 * `useTresor`: Frage wie Antwort gehen als Tresor-Item unter `K_v` in den Fall
 * wie jeder andere Inhalt dort — Angehörige lesen sie erst nach dem Trauerfall.
 */

function Frage({
  frage,
  antwortItem,
  onSpeichern,
  onLoeschen,
}: {
  frage: Vorsorgefrage
  antwortItem: TresorItem | null
  onSpeichern: (frageId: string, frage: string, antwort: string) => Promise<void>
  /** Nur bei selbst gestellten Fragen: Die acht gelieferten bleiben stehen. */
  onLoeschen?: () => Promise<void>
}) {
  const gespeichert = antwortItem === null ? '' : antwortItem.inhalt

  const [antwort, setzeAntwort] = useState(gespeichert)
  const [zuletztGesehen, setzeZuletztGesehen] = useState(gespeichert)
  const [laeuft, setzeLaeuft] = useState(false)
  const [fehler, setzeFehler] = useState<string | null>(null)
  const [loeschenBestaetigen, setzeLoeschenBestaetigen] = useState(false)

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

  async function loeschen() {
    if (onLoeschen === undefined) {
      return
    }

    setzeLaeuft(true)
    setzeFehler(null)

    try {
      await onLoeschen()
    } catch (ursache) {
      setzeFehler(alsNachricht(ursache))
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

      {/*
        Löschen nur bei den selbst gestellten Fragen, und mit Rückfrage: Eine
        Frage samt Antwort ist mit einem Griff weg, und im Tresor liegt nichts,
        was man nebenan noch einmal nachlesen könnte (§5).
      */}
      {onLoeschen === undefined ? null : loeschenBestaetigen ? (
        <div className={stile.loeschen}>
          <p className={stile.hinweis}>Diese Frage samt Antwort aus dem Tresor entfernen?</p>
          <div className={stile.knopfgruppe}>
            <Button variante="sekundaer" disabled={laeuft} onClick={() => void loeschen()}>
              Ja, Frage löschen
            </Button>
            <Button
              variante="sekundaer"
              disabled={laeuft}
              onClick={() => setzeLoeschenBestaetigen(false)}
            >
              Abbrechen
            </Button>
          </div>
        </div>
      ) : (
        <Button
          variante="text"
          disabled={laeuft}
          onClick={() => setzeLoeschenBestaetigen(true)}
          aria-label={`Eigene Frage „${frage.frage}“ löschen`}
        >
          Frage löschen
        </Button>
      )}
    </Card>
  )
}

/**
 * Das Feld, in dem eine weitere Frage entsteht.
 *
 * Eingeklappt, solange niemand es braucht: Unter den Fragen steht eine
 * Schaltfläche und kein leeres Feld, damit das Ende der Liste nicht aussieht
 * wie eine neunte unbeantwortete Frage.
 */
function NeueFrage({ onAnlegen }: { onAnlegen: (frage: string) => Promise<void> }) {
  const [offen, setzeOffen] = useState(false)
  const [frage, setzeFrage] = useState('')
  const [laeuft, setzeLaeuft] = useState(false)
  const [fehler, setzeFehler] = useState<string | null>(null)

  async function absenden(ereignis: FormEvent) {
    ereignis.preventDefault()
    setzeLaeuft(true)
    setzeFehler(null)

    try {
      await onAnlegen(frage)
      setzeFrage('')
      setzeOffen(false)
    } catch (ursache) {
      setzeFehler(alsNachricht(ursache))
    } finally {
      setzeLaeuft(false)
    }
  }

  if (!offen) {
    return (
      <Card>
        <p className={stile.hinweis}>
          Fehlt etwas, das Ihre Angehörigen wissen sollten? Stellen Sie sich eine eigene Frage
          und beantworten Sie sie hier.
        </p>
        <Button volleBreite onClick={() => setzeOffen(true)}>
          Eigene Frage hinzufügen
        </Button>
      </Card>
    )
  }

  return (
    <Card>
      <form className={stile.formular} onSubmit={(ereignis) => void absenden(ereignis)}>
        <div className={stile.feld}>
          <label className={stile.frage} htmlFor="vorsorgefrage-neu">
            Ihre eigene Frage
          </label>
          <textarea
            id="vorsorgefrage-neu"
            className={stile.textbereich}
            rows={3}
            value={frage}
            onChange={(ereignis) => setzeFrage(ereignis.target.value)}
            placeholder="z. B. Wo liegt der Zweitschlüssel zur Wohnung?"
            required
            autoFocus
          />
        </div>

        {fehler === null ? null : (
          <p className={stile.warnung} role="alert">
            Ihre Frage war nicht zu speichern. {fehler}
          </p>
        )}

        <div className={stile.knopfgruppe}>
          <Button type="submit" disabled={laeuft || frage.trim() === ''}>
            Frage hinzufügen
          </Button>
          <Button
            variante="sekundaer"
            type="button"
            disabled={laeuft}
            onClick={() => {
              setzeOffen(false)
              setzeFehler(null)
            }}
          >
            Abbrechen
          </Button>
        </div>
      </form>
    </Card>
  )
}

export function Vorsorgefragen({
  items,
  onSpeichern,
  onFrageAnlegen,
  onFrageLoeschen,
}: {
  /** Alle Tresor-Inhalte; die Fragen und Antworten sucht dieser Block sich selbst heraus. */
  items: TresorItem[]
  onSpeichern: (frageId: string, frage: string, antwort: string) => Promise<void>
  onFrageAnlegen: (frage: string) => Promise<void>
  onFrageLoeschen: (item: TresorItem) => Promise<void>
}) {
  /*
   * Die selbst gestellten Fragen stehen im Tresor und nicht in einer
   * Inhaltsdatei: Ihr Wortlaut ist die Auskunft der vorsorgenden Person und
   * gehört damit hinter dieselbe Verschlüsselung wie die Antwort darauf.
   */
  const eigene = eigeneFragen(items)

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

      {eigene.map((item) => (
        <Frage
          key={item.id}
          // Der Wortlaut steht im Titel der Tresorzeile; die Kennung ist die
          // des Items selbst, damit `antwortZuFrage` dieselbe Zeile wiederfindet.
          frage={{ id: item.frageId ?? item.id, frage: item.titel }}
          antwortItem={item}
          onSpeichern={onSpeichern}
          onLoeschen={() => onFrageLoeschen(item)}
        />
      ))}

      <NeueFrage onAnlegen={onFrageAnlegen} />
    </div>
  )
}
