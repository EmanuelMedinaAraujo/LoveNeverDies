import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { alsNachricht } from '../../../core/fehler.ts'
import type { TresorItem } from '../../../services/tresorService.ts'
import type { Vorsorgefrage } from '../../../types/vorsorgefrage.ts'
import { Button } from '../../../ui/Button/Button.tsx'
import stile from './Nachlassbereich.module.css'

/**
 * Wie lange nach dem letzten Tastendruck gespeichert wird.
 *
 * Gespeichert wird beim Verlassen des Feldes — das ist der Normalfall und der
 * Moment, in dem jemand mit einer Antwort fertig ist. Der Zeitgeber ist die
 * Absicherung dahinter: Wer die letzte Antwort tippt und dann das Telefon
 * weglegt, verlässt das Feld nie. Zwei Sekunden sind lang genug, dass niemand
 * mitten im Satz eine Sync-Runde auslöst, und kurz genug, dass kaum jemand es
 * schafft, vorher die App zu schliessen.
 */
const NACHLAUF_MS = 2000

type Speicherstand =
  | { art: 'ruhig' }
  | { art: 'offen' }
  | { art: 'laeuft' }
  | { art: 'fertig' }
  | { art: 'fehler'; nachricht: string }

/** Das Häkchen vor „Gespeichert". */
function Haken() {
  return (
    <svg
      className={stile.haken}
      width="1em"
      height="1em"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.25"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="m5 12.8 4.4 4.4L19 7.6" />
    </svg>
  )
}

/** Was unter dem Feld steht, in einem Satz. */
function standText(stand: Speicherstand): ReactNode {
  switch (stand.art) {
    case 'laeuft':
      return 'Wird gespeichert…'
    case 'fertig':
      return (
        <>
          <Haken />
          Gespeichert
        </>
      )
    case 'offen':
      return 'Noch nicht gespeichert'
    case 'fehler':
      return `Nicht gespeichert: ${stand.nachricht}`
    case 'ruhig':
      return null
  }
}

/**
 * Eine Frage der Nachlass-Checkliste samt ihrem Antwortfeld (DESIGN.md §3.5).
 *
 * **Es gibt keinen Speichern-Knopf.** Gespeichert wird, sobald das Feld den
 * Fokus verliert, und spätestens zwei Sekunden nach dem letzten Tastendruck.
 * Acht Fragen mit acht Knöpfen wären acht Gelegenheiten, einen zu übersehen —
 * und eine Antwort, die man getippt und nicht abgeschickt hat, sieht genauso
 * aus wie eine, die im Tresor liegt.
 *
 * **Deshalb steht der Stand da.** Automatisch speichern heisst nicht
 * stillschweigend speichern: Unter jedem Feld steht, ob die Antwort noch offen
 * ist, gerade geschrieben wird oder liegt. Die Zeile behält ihre Höhe, auch
 * wenn sie leer ist — sonst ruckte die Seite unter dem Finger, sobald jemand
 * ein Feld verlässt.
 *
 * **Und deshalb bleibt ein Knopf im Fehlerfall.** Geht das Speichern schief,
 * steht die Meldung da und daneben ein Weg, es noch einmal zu versuchen. Ein
 * automatischer zweiter Versuch liefe bei einem dauerhaften Fehler in eine
 * Schleife; ein stiller Verlust wäre schlimmer als beides (§5).
 */
export function Antwortfeld({
  frage,
  antwortItem,
  onSpeichern,
  anschluss,
}: {
  frage: Vorsorgefrage
  antwortItem: TresorItem | null
  onSpeichern: (frageId: string, frage: string, antwort: string) => Promise<void>
  /** Was unter dem Feld steht — bei der Testamentfrage der Weg zum Erklärtext. */
  anschluss?: ReactNode
}) {
  const gespeichert = antwortItem === null ? '' : antwortItem.inhalt

  const [antwort, setzeAntwort] = useState(gespeichert)
  const [zuletztGesehen, setzeZuletztGesehen] = useState(gespeichert)
  const [stand, setzeStand] = useState<Speicherstand>({ art: 'ruhig' })

  /*
   * Der Zeitgeber und der zuletzt losgeschickte Wortlaut liegen in Refs: Beide
   * werden aus Ereignishandlern gelesen, die sonst eine ältere Fassung dieser
   * Funktion vor sich hätten.
   */
  const zeitgeber = useRef<ReturnType<typeof setTimeout> | null>(null)
  const abgeschickt = useRef(gespeichert)
  const montiert = useRef(true)

  /*
   * Auch die Speicherfunktion selbst, und zwar aus einem bestimmten Grund:
   * `speichereAntwort` sucht sich die vorhandene Zeile aus `items` heraus und
   * bekommt bei jeder Sync-Runde eine neue Fassung. Der Zeitgeber unten hält
   * aber die Fassung von dem Moment fest, in dem jemand getippt hat. Ohne
   * diesen Ref liefe er mit einem veralteten Bestand und legte im ungünstigen
   * Fall eine zweite Zeile zu derselben Frage an.
   */
  const speichernRef = useRef(onSpeichern)

  useEffect(() => {
    speichernRef.current = onSpeichern
  }, [onSpeichern])

  /*
   * Was im Tresor steht, gewinnt, aber erst, wenn es sich wirklich geändert
   * hat. Sonst überschriebe jede Sync-Runde den halb getippten Satz — dieselbe
   * Überlegung wie bei den Notizen einer Aufgabe (§5, §7).
   */
  if (zuletztGesehen !== gespeichert) {
    setzeZuletztGesehen(gespeichert)
    setzeAntwort(gespeichert)
  }

  /*
   * Der Merker zieht mit, wenn der Tresor etwas Neues bringt — und ausserhalb
   * des Renderns, weil ein Ref dort nichts zu suchen hat. Ohne das hielte das
   * Feld nach einem Wechsel von einem anderen Gerät die alte Fassung für
   * „schon losgeschickt" und schriebe sie beim nächsten Verlassen zurück.
   */
  useEffect(() => {
    abgeschickt.current = gespeichert
  }, [gespeichert])

  useEffect(() => {
    montiert.current = true

    return () => {
      montiert.current = false

      if (zeitgeber.current !== null) {
        clearTimeout(zeitgeber.current)
      }
    }
  }, [])

  const speichere = useCallback(
    async (wert: string) => {
      if (zeitgeber.current !== null) {
        clearTimeout(zeitgeber.current)
        zeitgeber.current = null
      }

      /*
       * Nichts Neues: Ein zweites Mal denselben Wortlaut zu schreiben wäre
       * eine Sync-Runde, an deren Ende sich nichts geändert hat — und beim
       * blossen Antippen eines Feldes passierte genau das.
       */
      if (wert === abgeschickt.current) {
        return
      }

      const vorher = abgeschickt.current
      abgeschickt.current = wert
      setzeStand({ art: 'laeuft' })

      try {
        await speichernRef.current(frage.id, frage.frage, wert)

        if (montiert.current) {
          setzeStand({ art: 'fertig' })
        }
      } catch (ursache) {
        /*
         * Der Merker geht zurück, damit derselbe Wortlaut noch einmal
         * losgeschickt werden darf: Sonst hielte der zweite Versuch ihn für
         * bereits gespeichert und täte nichts.
         */
        abgeschickt.current = vorher

        if (montiert.current) {
          setzeStand({ art: 'fehler', nachricht: alsNachricht(ursache) })
        }
      }
    },
    [frage.frage, frage.id],
  )

  function beiEingabe(wert: string) {
    setzeAntwort(wert)
    setzeStand(wert === abgeschickt.current ? { art: 'ruhig' } : { art: 'offen' })

    if (zeitgeber.current !== null) {
      clearTimeout(zeitgeber.current)
    }

    zeitgeber.current = setTimeout(() => void speichere(wert), NACHLAUF_MS)
  }

  const feldId = `checkliste-${frage.id}`
  const erlaeuterungId = `${feldId}-erlaeuterung`
  const standKlassen = [stile.stand, stand.art === 'fehler' ? stile.standFehler : null]
    .filter(Boolean)
    .join(' ')

  return (
    <div className={stile.feld}>
      {/*
        Die Frage ist die Beschriftung des Feldes und keine Überschrift
        darüber: Wer sie vorgelesen bekommt, bekommt sie genau dann, wenn der
        Fokus im Feld steht, und muss sie nicht im Kopf behalten (§7).
      */}
      <label className={stile.frage} htmlFor={feldId}>
        {frage.frage}
      </label>

      {/*
        Die Erläuterung hängt über `aria-describedby` am Feld und steht nicht
        bloss daneben: Sonst hörte eine blinde Person die Frage und danach ein
        leeres Textfeld, während die Erklärung, was eine Vorsorgevollmacht ist,
        irgendwo davor vorbeigelaufen wäre.
      */}
      {frage.erlaeuterung === undefined ? null : (
        <p className={stile.hinweis} id={erlaeuterungId}>
          {frage.erlaeuterung}
        </p>
      )}

      <textarea
        id={feldId}
        className={stile.textbereich}
        rows={5}
        value={antwort}
        aria-describedby={frage.erlaeuterung === undefined ? undefined : erlaeuterungId}
        onChange={(ereignis) => beiEingabe(ereignis.target.value)}
        onBlur={() => void speichere(antwort)}
        placeholder="Ihre Antwort"
      />

      <p className={standKlassen} role="status">
        {standText(stand)}
      </p>

      {stand.art === 'fehler' ? (
        <Button variante="sekundaer" onClick={() => void speichere(antwort)}>
          Erneut speichern
        </Button>
      ) : null}

      {anschluss === undefined ? null : <div className={stile.anschluss}>{anschluss}</div>}
    </div>
  )
}
