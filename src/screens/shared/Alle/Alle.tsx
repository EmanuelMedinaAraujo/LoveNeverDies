import { useState, type FormEvent } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { alsNachricht } from '../../../core/fehler.ts'
import { useAufgaben } from '../../../hooks/useAufgaben.ts'
import { useCase } from '../../../hooks/useCase.ts'
import type { AbgelehnteAenderung, Aufgabe } from '../../../services/aufgabenService.ts'
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
  /** @returns ob die Änderung angehängt wurde. Sonst nimmt die Zeile sie zurück. */
  aufHaken: (erledigt: boolean) => Promise<boolean>
  /** `false`, wenn nichts gespeichert wurde. Die Zeile bleibt dann offen. */
  aufSpeichern: (titel: string, beschreibung: string) => Promise<boolean>
  aufLoeschen: () => void
}) {
  const [modus, setzeModus] = useState<ZeilenModus>('anzeigen')
  const [titel, setzeTitel] = useState(aufgabe.titel)
  const [beschreibung, setzeBeschreibung] = useState(aufgabe.beschreibung)

  /*
   * Das Häkchen folgt dem Finger und nicht dem Rundlauf.
   *
   * Angewandt wird eine Mutation sofort — aber eine Ebene tiefer, in der Queue,
   * und der Weg dorthin kostet ein paar Millisekunden: verschlüsseln, anhängen,
   * überlagern, wieder entschlüsseln. Eine kontrollierte Checkbox liest in
   * dieser Zeit noch `aufgabe.erledigt`, und React setzt sie beim nächsten
   * Rendern auf den alten Wert zurück. Sichtbar, und auf einem Telefon der
   * Anlass, ein zweites Mal zu tippen — §5 nennt genau das als den Grund für
   * die optimistische Anzeige.
   *
   * Die Führung gibt die Zeile ab, sobald der Bestand nachgezogen hat: auch
   * dann, wenn er die Änderung zurücknimmt, weil der Server sie verworfen hat.
   */
  const [erledigt, setzeErledigt] = useState(aufgabe.erledigt)
  const [zuletztGesehen, setzeZuletztGesehen] = useState(aufgabe.erledigt)

  if (zuletztGesehen !== aufgabe.erledigt) {
    setzeZuletztGesehen(aufgabe.erledigt)
    setzeErledigt(aufgabe.erledigt)
  }

  /**
   * Nimmt das Häkchen zurück, wenn die Mutation nie angehängt wurde.
   *
   * Der Bestand zieht nur nach, wenn etwas in der Queue gelandet ist. Kam es
   * gar nicht so weit — kein Platz in IndexedDB, kein IndexedDB —, dann bleibt
   * `aufgabe.erledigt`, wie es war, der Abgleich oben findet keinen
   * Unterschied, und das Häkchen stünde für den Rest der Sitzung auf einem
   * Wert, den niemand gespeichert hat. Die Meldung darüber sagte „ging nicht",
   * das Kästchen daneben sagte „erledigt", und §5 verlangt das Gegenteil von
   * genau dieser Zweideutigkeit.
   */
  async function haken(gewuenscht: boolean) {
    setzeErledigt(gewuenscht)

    if (!(await aufHaken(gewuenscht))) {
      setzeErledigt(aufgabe.erledigt)
    }
  }

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
        checked={erledigt}
        disabled={gesperrt}
        onChange={(ereignis) => void haken(ereignis.target.checked)}
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

/** Wie die drei Operationen heissen, wenn eine Mitteilung von ihnen erzählt. */
const WAS: Record<AbgelehnteAenderung['was'], string> = {
  anlegen: 'Anlegen',
  aendern: 'Ändern',
  loeschen: 'Löschen',
}

/**
 * Was der Server verworfen hat (§5).
 *
 * „Abgelehnte Mutationen werden nie stillschweigend verworfen, sondern mit
 * ihrem entschlüsselten Inhalt als Mitteilung angezeigt." Beides steht hier:
 * die Zahl, weil drei verlorene Änderungen etwas anderes sind als eine, und der
 * Titel, weil „eine Änderung konnte nicht gespeichert werden" niemandem sagt,
 * was er noch einmal tippen muss.
 *
 * Weg geht die Mitteilung nur, wenn jemand sie zur Kenntnis nimmt. Ein
 * Zeitablauf wäre wieder das stille Verschwinden, das §5 ausschliesst.
 */
function Abgelehnt({
  aenderungen,
  aufBestaetigen,
}: {
  aenderungen: AbgelehnteAenderung[]
  aufBestaetigen: () => void
}) {
  return (
    <Card>
      <p role="alert">
        {aenderungen.length === 1
          ? 'Eine Änderung konnte nicht gespeichert werden.'
          : `${aenderungen.length} Änderungen konnten nicht gespeichert werden.`}
      </p>

      <ul className={stile.liste}>
        {aenderungen.map((aenderung, stelle) => (
          <li key={`${aenderung.itemId}:${stelle}`} className={stile.hinweis}>
            {/*
              Ohne Titel bleibt es beim Vorgang. Das passiert, wenn die Zeile
              inzwischen ein Tombstone ist — dann gibt es keinen DEK mehr, unter
              dem sich der Payload lesen liesse (§5).
            */}
            {aenderung.titel === ''
              ? `${WAS[aenderung.was]} einer Aufgabe: ${aenderung.grund}`
              : `${WAS[aenderung.was]} von „${aenderung.titel}“: ${aenderung.grund}`}
          </li>
        ))}
      </ul>

      <Button variante="sekundaer" onClick={aufBestaetigen}>
        Verstanden
      </Button>
    </Card>
  )
}

function Aufgabenbereich({ fall }: { fall: LesbarerFall }) {
  const { zustand, abgelehnt, bestaetige, legeAn, schreibe, hakeAb, loesche } = useAufgaben(fall)

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

      {abgelehnt.length === 0 ? null : (
        <Abgelehnt aenderungen={abgelehnt} aufBestaetigen={bestaetige} />
      )}

      {/*
        §5: „Die Ladeanzeige bezieht sich auf den Netzwerk-Fetch, nicht auf das
        Entschlüsseln." Sie steht deshalb, solange es nichts zu zeigen gibt —
        erst bis der Cache gelesen ist, danach so lange der erste Abruf läuft.

        **Für die Runden danach gibt es bewusst keine.** Die Türklingel läutet
        im geteilten Fall im Sekundentakt; eine Zeile, die dabei erscheint und
        wieder verschwindet, verschöbe die Liste unter dem Finger, der gerade
        ein Häkchen setzen will, und eine Vorlesestimme sagte alle paar Sekunden
        „wird aktualisiert". Der Sinn der Türklingel ist, dass ihr niemand
        zusehen muss.
      */}
      {zustand.status === 'laedt' ? <Ladeanzeige text="Ihre Aufgaben werden geladen…" /> : null}

      {zustand.status === 'bereit' ? (
        <>
          {/*
            Der Netzfehler nimmt die Liste nicht weg. Was gecacht ist, stimmte
            zum Zeitpunkt des letzten Abrufs; ein leerer Bildschirm behauptete
            stattdessen, es gebe nichts.
          */}
          {zustand.netzfehler === null ? null : (
            <p className={stile.hinweis} role="alert">
              Ihre Aufgaben sind gerade nicht abrufbar. {zustand.netzfehler}
            </p>
          )}

          {zustand.aufgaben.length === 0 ? (
            // Ein leerer Cache und ein laufender erster Abruf sind nicht
            // dasselbe wie ein leerer Fall. „Hier ist noch nichts" wäre in
            // diesem Moment eine Behauptung, die der Abruf gleich widerlegt.
            zustand.laedtNetz ? (
              <Ladeanzeige text="Ihre Aufgaben werden geladen…" />
            ) : (
              <p className={stile.hinweis}>
                Hier ist noch nichts. Tragen Sie oben ein, was zu tun ist.
              </p>
            )
          ) : (
            <ul className={stile.liste}>
              {zustand.aufgaben.map((aufgabe) => (
                <Aufgabenzeile
                  key={aufgabe.id}
                  aufgabe={aufgabe}
                  gesperrt={laeuft}
                  aufHaken={(erledigt) => fuehreAus(() => hakeAb(aufgabe, erledigt))}
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
