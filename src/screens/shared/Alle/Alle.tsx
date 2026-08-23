import { useState, type FormEvent } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { alsNachricht } from '../../../core/fehler.ts'
import { useAufgaben } from '../../../hooks/useAufgaben.ts'
import { useCase } from '../../../hooks/useCase.ts'
import type { Aufgabe } from '../../../services/aufgabenService.ts'
import type { LesbarerFall } from '../../../services/fallService.ts'
import { Button } from '../../../ui/Button/Button.tsx'
import { Card } from '../../../ui/Card/Card.tsx'
import { Checkbox } from '../../../ui/Checkbox/Checkbox.tsx'
import stile from './Alle.module.css'

/**
 * Der Tab "Alle": alle Aufgaben des Falls (DESIGN.md §7).
 *
 * Anlegen, abhaken, umbenennen, löschen — und nach jedem Neuladen stimmt der
 * Stand, weil nichts davon nur lokal passiert. Verschlüsselt wird im
 * `aufgabenService`, bevor irgendetwas den Browser verlässt; dieser Screen
 * sieht ausschließlich Klartext, den es nur hier gibt.
 *
 * **Ein Screen statt zweier Bäume.** §7 sieht für "Alle" getrennte Bäume unter
 * `screens/senior` und `screens/advanced` vor. Solange die beiden Fassungen
 * dieselben Elemente in derselben Reihenfolge zeigten, wären das zwei Kopien,
 * die auseinanderlaufen; die Dichtetokens tragen den Größenunterschied bereits.
 * Getrennt wird, sobald die einfache Ansicht wirklich weniger zeigt — mit den
 * Slices, die ihr etwas zum Weglassen geben (Fristen, Zuständigkeit,
 * Unteraufgaben). Was §7 für die einfache Ansicht ausdrücklich verlangt, steht
 * schon hier: Vor dem Löschen wird gefragt.
 */

function Ladeanzeige({ text }: { text: string }) {
  return (
    <p className={stile.hinweis} role="status">
      {text}
    </p>
  )
}

type ZeilenModus = 'anzeigen' | 'aendern' | 'loeschen'

/** Eine Aufgabe in der Liste, in einem ihrer drei Zustände. */
function Aufgabenzeile({
  aufgabe,
  gesperrt,
  aufHaken,
  aufSpeichern,
  aufLoeschen,
}: {
  aufgabe: Aufgabe
  gesperrt: boolean
  aufHaken: (erledigt: boolean) => void
  /** `false`, wenn nichts gespeichert wurde. Die Zeile bleibt dann offen. */
  aufSpeichern: (titel: string, beschreibung: string) => Promise<boolean>
  aufLoeschen: () => void
}) {
  const [modus, setzeModus] = useState<ZeilenModus>('anzeigen')
  const [titel, setzeTitel] = useState(aufgabe.titel)
  const [beschreibung, setzeBeschreibung] = useState(aufgabe.beschreibung)

  function beginneAendern() {
    setzeTitel(aufgabe.titel)
    setzeBeschreibung(aufgabe.beschreibung)
    setzeModus('aendern')
  }

  async function speichern(ereignis: FormEvent) {
    ereignis.preventDefault()

    // Nur bei Erfolg zu. Ging es schief, steht die Meldung darüber und der
    // eingetippte Text noch da — §5 verlangt, dass eine abgelehnte Änderung
    // sichtbar bleibt, und ein geleertes Formular wäre das Gegenteil davon.
    if (await aufSpeichern(titel, beschreibung)) {
      setzeModus('anzeigen')
    }
  }

  if (modus === 'aendern') {
    return (
      <li className={stile.zeile}>
        <form className={stile.formular} onSubmit={(ereignis) => void speichern(ereignis)}>
          <div className={stile.feld}>
            <label htmlFor={`titel-${aufgabe.id}`}>Titel</label>
            <input
              id={`titel-${aufgabe.id}`}
              className={stile.eingabe}
              value={titel}
              onChange={(ereignis) => setzeTitel(ereignis.target.value)}
              required
              autoFocus
            />
          </div>

          <div className={stile.feld}>
            <label htmlFor={`beschreibung-${aufgabe.id}`}>Beschreibung</label>
            <textarea
              id={`beschreibung-${aufgabe.id}`}
              className={stile.eingabe}
              rows={3}
              value={beschreibung}
              onChange={(ereignis) => setzeBeschreibung(ereignis.target.value)}
            />
          </div>

          <div className={stile.aktionen}>
            {/*
              `required` allein liesse einen Titel aus lauter Leerzeichen durch;
              der Dienst weist ihn dann ab, und die Meldung landet über der
              Liste, weit weg von dieser Zeile. Gesperrt zu sein ist die
              ehrlichere Antwort: Was nicht gespeichert werden kann, lässt sich
              gar nicht erst abschicken.
            */}
            <Button type="submit" disabled={gesperrt || titel.trim() === ''}>
              Speichern
            </Button>
            <Button variante="sekundaer" onClick={() => setzeModus('anzeigen')}>
              Abbrechen
            </Button>
          </div>
        </form>
      </li>
    )
  }

  if (modus === 'loeschen') {
    return (
      <li className={stile.zeile}>
        {/*
          §5: Löschen gewinnt endgültig, die Datenbank weist eine Auferstehung
          ab. Das gehört vor die Aktion gesagt und nicht danach.
        */}
        <p>
          „{aufgabe.titel}" wirklich löschen? Gelöschte Aufgaben kommen nicht zurück.
        </p>
        <div className={stile.aktionen}>
          <Button
            onClick={() => {
              setzeModus('anzeigen')
              aufLoeschen()
            }}
            disabled={gesperrt}
          >
            Endgültig löschen
          </Button>
          <Button variante="sekundaer" onClick={() => setzeModus('anzeigen')}>
            Abbrechen
          </Button>
        </div>
      </li>
    )
  }

  return (
    <li className={stile.zeile}>
      <Checkbox
        checked={aufgabe.erledigt}
        disabled={gesperrt}
        onChange={(ereignis) => aufHaken(ereignis.target.checked)}
        label={aufgabe.titel}
      />

      {aufgabe.beschreibung === '' ? null : (
        <p className={stile.beschreibung}>{aufgabe.beschreibung}</p>
      )}

      <div className={stile.aktionen}>
        {/*
          Beide Schaltflächen tragen den Titel zum Vorlesen mit. Ohne ihn hörte
          eine blinde Person in einer Liste von zwanzig Aufgaben zwanzigmal
          „Ändern" und wüsste nie, welche gemeint ist (§7).

          Das Trennzeichen ist ein Doppelpunkt und kein Leerzeichen: Die
          Berechnung des zugänglichen Namens schneidet den Rand jedes Textknotens
          ab, ein führendes Leerzeichen fiele also weg und beide Teile klebten
          aneinander.
        */}
        <Button variante="sekundaer" onClick={beginneAendern} vorleseText={`: „${aufgabe.titel}"`}>
          Ändern
        </Button>
        <Button
          variante="sekundaer"
          onClick={() => setzeModus('loeschen')}
          vorleseText={`: „${aufgabe.titel}"`}
        >
          Löschen
        </Button>
      </div>
    </li>
  )
}

function Aufgabenbereich({ fall }: { fall: LesbarerFall }) {
  const { zustand, legeAn, schreibe, hakeAb, loesche } = useAufgaben(fall)

  const [neuerTitel, setzeNeuerTitel] = useState('')
  const [laeuft, setzeLaeuft] = useState(false)
  const [fehler, setzeFehler] = useState<string | null>(null)

  /**
   * §5: Abgelehnte Änderungen werden nie stillschweigend verworfen. Deshalb
   * läuft jede Mutation durch diese eine Stelle, und was hier ankommt, steht
   * danach als Meldung auf dem Bildschirm.
   *
   * @returns ob es geklappt hat. Wer etwas eingetippt hat, behält es sonst.
   */
  async function fuehreAus(arbeit: () => Promise<void>): Promise<boolean> {
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

  async function anlegen(ereignis: FormEvent) {
    ereignis.preventDefault()

    const titel = neuerTitel

    if (await fuehreAus(() => legeAn(titel))) {
      setzeNeuerTitel('')
    }
  }

  return (
    <>
      <Card>
        <form className={stile.formular} onSubmit={(ereignis) => void anlegen(ereignis)}>
          <div className={stile.feld}>
            <label htmlFor="neue-aufgabe">Neue Aufgabe</label>
            <input
              id="neue-aufgabe"
              className={stile.eingabe}
              value={neuerTitel}
              onChange={(ereignis) => setzeNeuerTitel(ereignis.target.value)}
              required
            />
          </div>

          <Button type="submit" volleBreite disabled={laeuft || neuerTitel.trim() === ''}>
            Aufgabe hinzufügen
          </Button>
        </form>
      </Card>

      {fehler === null ? null : (
        <p className={stile.hinweis} role="alert">
          {fehler}
        </p>
      )}

      {zustand.status === 'laedt' ? <Ladeanzeige text="Ihre Aufgaben werden geladen…" /> : null}

      {zustand.status === 'fehler' ? (
        <p className={stile.hinweis} role="alert">
          Ihre Aufgaben sind gerade nicht abrufbar. {zustand.nachricht}
        </p>
      ) : null}

      {zustand.status === 'bereit' ? (
        <>
          {zustand.aufgaben.length === 0 ? (
            <p className={stile.hinweis}>
              Hier ist noch nichts. Tragen Sie oben ein, was zu tun ist.
            </p>
          ) : (
            <ul className={stile.liste}>
              {zustand.aufgaben.map((aufgabe) => (
                <Aufgabenzeile
                  key={aufgabe.id}
                  aufgabe={aufgabe}
                  gesperrt={laeuft}
                  aufHaken={(erledigt) => void fuehreAus(() => hakeAb(aufgabe, erledigt))}
                  aufSpeichern={(titel, beschreibung) =>
                    fuehreAus(() => schreibe(aufgabe, { titel, beschreibung }))
                  }
                  aufLoeschen={() => void fuehreAus(() => loesche(aufgabe))}
                />
              ))}
            </ul>
          )}

          {/*
            §3.7: Nicht entschlüsselbare Items verschwinden still — sie gehören
            in aller Regel einer anderen Person. Einen Zähler dafür gibt es
            ausschließlich im Dev-Modus; `import.meta.env.DEV` ist zur Bauzeit
            bekannt, der Zweig fällt im Produktionsbündel ganz weg.
          */}
          {import.meta.env.DEV && zustand.uebersprungen > 0 ? (
            <p className={stile.hinweis}>
              Entwicklungsmodus: {zustand.uebersprungen} Einträge übersprungen, weil sie sich
              nicht entschlüsseln ließen.
            </p>
          ) : null}
        </>
      ) : null}
    </>
  )
}

export function Alle() {
  const { zustand } = useCase()

  if (zustand.status === 'laedt') {
    return (
      <main className={stile.seite}>
        <Ladeanzeige text="Ihre Daten werden geladen…" />
      </main>
    )
  }

  // Ohne Fall ist die App gesperrt (§7). Die Fallweiche steht auf der
  // Startseite, und dorthin gehört auch, wer hier direkt hereinkommt.
  if (zustand.status === 'kein-fall') {
    return <Navigate to="/" replace />
  }

  return (
    <main className={stile.seite}>
      <div className={stile.kopf}>
        <h1>Alle Aufgaben</h1>
        <p className={stile.hinweis}>
          <Link to="/">Zurück</Link>
        </p>
      </div>

      {zustand.status === 'fehler' ? (
        <p className={stile.hinweis} role="alert">
          Ihre Aufgaben sind gerade nicht abrufbar. {zustand.nachricht}
        </p>
      ) : zustand.aktiver.zustand === 'gesperrt' ? (
        <p className={stile.hinweis} role="alert">
          Dieser Fall ist auf diesem Gerät gesperrt. {zustand.aktiver.grund}
        </p>
      ) : (
        <Aufgabenbereich fall={zustand.aktiver} />
      )}
    </main>
  )
}
