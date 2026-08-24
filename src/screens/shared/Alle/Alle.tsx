import { useState, type FormEvent } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { alsNachricht } from '../../../core/fehler.ts'
import { useAufgaben } from '../../../hooks/useAufgaben.ts'
import { useCase } from '../../../hooks/useCase.ts'
import { sortiereNachFrist, type Aufgabenknoten } from '../../../services/aufgabenbaum.ts'
import type { LesbarerFall } from '../../../services/fallService.ts'
import { fristlage, fristText, heuteIso, type Fristlage } from '../../../services/fristen.ts'
import { Badge, type Badgelage } from '../../../ui/Badge/Badge.tsx'
import { Button } from '../../../ui/Button/Button.tsx'
import { Card } from '../../../ui/Card/Card.tsx'
import { Checkbox } from '../../../ui/Checkbox/Checkbox.tsx'
import type { Erinnerungsdaten } from '../../../hooks/useErinnerungen.ts'
import { darfBearbeiten, istFrei, zuweisungText } from '../../../services/zuweisung.ts'
import { Abgelehnt, Uebernahmen } from '../Meldungen/Meldungen.tsx'
import stile from './Alle.module.css'

/**
 * Der Tab "Alle": alle Aufgaben des Falls (DESIGN.md §7).
 *
 * Anlegen, abhaken, umbenennen, löschen, und nach jedem Neuladen stimmt der
 * Stand, weil nichts davon nur lokal passiert. Verschlüsselt wird im
 * `aufgabenService`, bevor irgendetwas den Browser verlässt; dieser Screen
 * sieht ausschließlich Klartext, den es nur hier gibt.
 *
 * Ein Screen statt zweier Bäume: §7 sieht für "Alle" getrennte Bäume unter
 * `screens/senior` und `screens/advanced` vor. Solange die beiden Fassungen
 * dieselben Elemente in derselben Reihenfolge zeigten, wären das zwei Kopien,
 * die auseinanderlaufen; die Dichtetokens tragen den Größenunterschied bereits.
 * Getrennt wird, sobald die einfache Ansicht wirklich weniger zeigt; das ist
 * der Slice #17. Was §7 für die einfache Ansicht ausdrücklich verlangt, steht
 * schon hier: Vor dem Löschen wird gefragt.
 *
 * Die Liste zeigt Wurzelaufgaben: Unteraufgaben stehen im Aufgabendetail,
 * unter der Aufgabe, zu der sie gehören (§7); hier zählt nur, wie viele davon
 * erledigt sind. Eine flache Liste aus vierzig Aufgaben und ihren
 * Unteraufgaben wäre nicht mehr zu lesen, und die Reihenfolge der Juristinnen
 * ginge darin unter.
 */

function Ladeanzeige({ text }: { text: string }) {
  return (
    <p className={stile.hinweis} role="status">
      {text}
    </p>
  )
}

type ZeilenModus = 'anzeigen' | 'aendern' | 'loeschen'

/** Wie dringend eine Frist aussieht (§12). Ab drei Tagen wird es knapp. */
function badgelage(lage: Fristlage): Badgelage {
  if (lage.art !== 'datum') {
    return 'ruhig'
  }

  return lage.restTage < 0 ? 'abgelaufen' : lage.restTage <= 3 ? 'knapp' : 'ruhig'
}

/** Eine Aufgabe in der Liste, in einem ihrer drei Zustände. */
function Aufgabenzeile({
  knoten,
  lage,
  gesperrt,
  ichUserId,
  aufHaken,
  aufSpeichern,
  aufLoeschen,
  aufUebernehmen,
  aufFreigeben,
}: {
  knoten: Aufgabenknoten
  lage: Fristlage
  gesperrt: boolean
  /** Die angemeldete Person. Ob sie bearbeiten darf, entscheidet die Zuweisung (§7). */
  ichUserId: string
  /** @returns ob die Änderung angehängt wurde. Sonst nimmt die Zeile sie zurück. */
  aufHaken: (erledigt: boolean) => Promise<boolean>
  /** `false`, wenn nichts gespeichert wurde. Die Zeile bleibt dann offen. */
  aufSpeichern: (titel: string, beschreibung: string) => Promise<boolean>
  aufLoeschen: () => void
  aufUebernehmen: () => void
  aufFreigeben: () => void
}) {
  const { aufgabe, unteraufgaben, istBlatt, erledigt: giltAlsErledigt, blockiertVon } = knoten

  const [modus, setzeModus] = useState<ZeilenModus>('anzeigen')
  const [titel, setzeTitel] = useState(aufgabe.titel)
  const [beschreibung, setzeBeschreibung] = useState(aufgabe.beschreibung)

  /*
   * Das Häkchen folgt dem Finger und nicht dem Rundlauf.
   *
   * Angewandt wird eine Mutation sofort, aber eine Ebene tiefer, in der Queue,
   * und der Weg dorthin kostet ein paar Millisekunden: verschlüsseln, anhängen,
   * überlagern, wieder entschlüsseln. Eine kontrollierte Checkbox liest in
   * dieser Zeit noch `aufgabe.erledigt`, und React setzt sie beim nächsten
   * Rendern auf den alten Wert zurück. Sichtbar, und auf einem Telefon der
   * Anlass, ein zweites Mal zu tippen: §5 nennt genau das als den Grund für
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
   * gar nicht so weit (kein Platz in IndexedDB, kein IndexedDB), dann bleibt
   * `aufgabe.erledigt`, wie es war, der Abgleich oben findet keinen
   * Unterschied, und das Häkchen stünde für den Rest der Sitzung auf einem
   * Wert, den niemand gespeichert hat. Die Meldung darüber sagte "ging nicht",
   * das Kästchen daneben sagte "erledigt", und §5 verlangt das Gegenteil von
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
    // eingetippte Text noch da: §5 verlangt, dass eine abgelehnte Änderung
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
          "{aufgabe.titel}" wirklich löschen? Gelöschte Aufgaben kommen nicht zurück.
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

  const badge = fristText(lage)
  const blockiert = blockiertVon.length > 0

  /*
   * §7: "Bearbeiten darf nur, wem sie zugewiesen ist." Wer nicht darunter
   * steht, sieht die Aufgabe vollständig (Titel, Frist, Stand) und findet
   * statt der Schaltflächen den einen Weg, der ihm offensteht: sie übernehmen.
   */
  const darfAendern = darfBearbeiten(aufgabe.assignee, ichUserId)

  return (
    <li className={[stile.zeile, blockiert ? stile.blockiert : null].filter(Boolean).join(' ')}>
      <div className={stile.titelzeile}>
        {istBlatt ? (
          <Checkbox
            checked={erledigt}
            disabled={gesperrt || !darfAendern}
            onChange={(ereignis) => void haken(ereignis.target.checked)}
            label={aufgabe.titel}
          />
        ) : (
          /*
           * §7: Eine Aufgabe mit Unteraufgaben hat kein eigenes Häkchen. Statt
           * eines Kästchens, das nichts speichert, steht hier der Stand ihrer
           * Kinder, und abgehakt wird im Aufgabendetail, Kind für Kind.
           */
          <p className={stile.titel}>{aufgabe.titel}</p>
        )}

        {badge === null ? null : <Badge lage={badgelage(lage)}>{badge}</Badge>}
      </div>

      {istBlatt ? null : (
        <p className={stile.beschreibung}>
          {giltAlsErledigt
            ? `Erledigt: alle ${unteraufgaben.length} Unteraufgaben sind abgehakt.`
            : `${unteraufgaben.filter((unter) => unter.erledigt).length} von ${unteraufgaben.length} Unteraufgaben erledigt`}
        </p>
      )}

      {/*
        §7: "Blockierte Aufgaben erscheinen ausgegraut mit 'Zuerst: …'."
        Ausgegraut ist die Zeile, gesperrt ist sie nicht: Die Abhängigkeit kommt
        aus dem Katalog und ist ein Rat, kein Gesetz. Wer die Sache erledigt
        hat, muss das eintragen können, ohne erst eine andere Aufgabe abhaken
        zu müssen, die er gar nicht erledigt hat.
      */}
      {blockiert ? (
        <p className={stile.hinweis}>
          Zuerst: {blockiertVon.map((offen) => offen.titel).join(', ')}
        </p>
      ) : null}

      {aufgabe.beschreibung === '' ? null : (
        <p className={stile.beschreibung}>{aufgabe.beschreibung}</p>
      )}

      <p className={stile.hinweis}>Zuständig: {zuweisungText(aufgabe.assignee, ichUserId)}</p>

      <div className={stile.aktionen}>
        {/*
          Der Weg ins ganzseitige Detail (§7). Der Titel geht zum Vorlesen mit,
          aus demselben Grund wie bei den Schaltflächen daneben.
        */}
        <Link className={stile.detaillink} to={`/aufgabe/${aufgabe.id}`}>
          Details
          <span className="nur-vorlesen">: "{aufgabe.titel}"</span>
        </Link>

        {/*
          Jede Schaltfläche trägt den Titel zum Vorlesen mit. Ohne ihn hörte
          eine blinde Person in einer Liste von zwanzig Aufgaben zwanzigmal
          "Ändern" und wüsste nie, welche gemeint ist (§7).

          Das Trennzeichen ist ein Doppelpunkt und kein Leerzeichen: Die
          Berechnung des zugänglichen Namens schneidet den Rand jedes Textknotens
          ab, ein führendes Leerzeichen fiele also weg und beide Teile klebten
          aneinander.
        */}
        {darfAendern ? (
          <>
            <Button
              variante="sekundaer"
              onClick={beginneAendern}
              vorleseText={`: "${aufgabe.titel}"`}
            >
              Ändern
            </Button>
            <Button
              variante="sekundaer"
              onClick={() => setzeModus('loeschen')}
              vorleseText={`: "${aufgabe.titel}"`}
            >
              Löschen
            </Button>
          </>
        ) : (
          <Button
            disabled={gesperrt}
            onClick={aufUebernehmen}
            vorleseText={`: "${aufgabe.titel}"`}
          >
            Übernehmen
          </Button>
        )}

        {/*
          §7: "Eine Reservierung ist von jedem wieder lösbar, nicht nur von der
          reservierenden Person." In einer Familie fällt jemand aus, und eine
          Aufgabe, die niemand mehr freigeben kann, blockiert eine gesetzliche
          Frist.
        */}
        {istFrei(aufgabe.assignee) ? null : (
          <Button
            variante="sekundaer"
            disabled={gesperrt}
            onClick={aufFreigeben}
            vorleseText={`: "${aufgabe.titel}"`}
          >
            Freigeben
          </Button>
        )}
      </div>
    </li>
  )
}

/** Wonach die Liste sortiert ist (§7, §8). */
type Sortierung = 'reihenfolge' | 'frist'

/**
 * Die Erinnerungen, sobald es welche zu planen gibt (§7).
 *
 * Gefragt wird erst, wenn eine Frist im Fall steht: Eine Systemabfrage beim
 * ersten Start, bevor die App überhaupt etwas zu melden hätte, beantworten die
 * meisten Menschen mit "nein", und dann ist die Tür für immer zu.
 */
function Erinnerungshinweis({ erinnerungen }: { erinnerungen: Erinnerungsdaten }) {
  if (erinnerungen.geplant === 0 || erinnerungen.erlaubnis === 'nicht-verfuegbar') {
    return null
  }

  if (erinnerungen.erlaubnis === 'ungefragt') {
    return (
      <Card>
        <p>
          Sollen wir Sie an die Fristen erinnern? Die Erinnerungen entstehen auf diesem Gerät;
          über den Server geht dabei nichts.
        </p>
        <Button variante="sekundaer" onClick={() => void erinnerungen.frage()}>
          Erinnerungen einschalten
        </Button>
      </Card>
    )
  }

  return erinnerungen.erlaubnis === 'erteilt' ? (
    <p className={stile.hinweis}>
      {erinnerungen.geplant === 1
        ? 'Eine Erinnerung ist auf diesem Gerät eingeplant.'
        : `${erinnerungen.geplant} Erinnerungen sind auf diesem Gerät eingeplant.`}
    </p>
  ) : null
}

function Aufgabenbereich({ fall }: { fall: LesbarerFall }) {
  const {
    zustand,
    erinnerungen,
    abgelehnt,
    bestaetige,
    legeAn,
    schreibe,
    hakeAb,
    loesche,
    ich,
    uebernimm,
    gibFrei,
    uebernahmen,
    bestaetigeUebernahmen,
  } = useAufgaben(fall)

  const [neuerTitel, setzeNeuerTitel] = useState('')
  const [sortierung, setzeSortierung] = useState<Sortierung>('reihenfolge')
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

  /*
   * Einmal je Rendern, nicht einmal je Zeile: Ein Fall mit vierzig Aufgaben
   * fragte sonst vierzigmal nach dem heutigen Tag und geriete um Mitternacht
   * an zwei verschiedene Antworten in derselben Liste.
   */
  const heute = heuteIso()

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

      {uebernahmen.length === 0 ? null : (
        <Uebernahmen uebernahmen={uebernahmen} aufBestaetigen={bestaetigeUebernahmen} />
      )}

      {abgelehnt.length === 0 ? null : (
        <Abgelehnt aenderungen={abgelehnt} aufBestaetigen={bestaetige} />
      )}

      {/*
        §5: "Die Ladeanzeige bezieht sich auf den Netzwerk-Fetch, nicht auf das
        Entschlüsseln." Sie steht deshalb, solange es nichts zu zeigen gibt:
        erst bis der Cache gelesen ist, danach so lange der erste Abruf läuft.

        Für die Runden danach gibt es bewusst keine: Die Türklingel läutet
        im geteilten Fall im Sekundentakt; eine Zeile, die dabei erscheint und
        wieder verschwindet, verschöbe die Liste unter dem Finger, der gerade
        ein Häkchen setzen will, und eine Vorlesestimme sagte alle paar Sekunden
        "wird aktualisiert". Der Sinn der Türklingel ist, dass ihr niemand
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

          <Erinnerungshinweis erinnerungen={erinnerungen} />

          {zustand.baum.length === 0 ? (
            // Ein leerer Cache und ein laufender erster Abruf sind nicht
            // dasselbe wie ein leerer Fall. "Hier ist noch nichts" wäre in
            // diesem Moment eine Behauptung, die der Abruf gleich widerlegt.
            zustand.laedtNetz ? (
              <Ladeanzeige text="Ihre Aufgaben werden geladen…" />
            ) : (
              <p className={stile.hinweis}>
                Hier ist noch nichts. Tragen Sie oben ein, was zu tun ist.
              </p>
            )
          ) : (
            <>
              {/*
                §7: "Fristen sind sichtbar: als Badges und in sortierten
                Listen." Die Voreinstellung bleibt die Reihenfolge der
                Juristinnen (§8); sie beginnt mit dem, was in den ersten Tagen
                ansteht, und das ist für die meisten der bessere Weg durch die
                Liste als ein Fristenranking.
              */}
              <div className={stile.feld}>
                <label htmlFor="sortierung">Sortierung</label>
                <select
                  id="sortierung"
                  className={stile.eingabe}
                  value={sortierung}
                  onChange={(ereignis) => setzeSortierung(ereignis.target.value as Sortierung)}
                >
                  <option value="reihenfolge">Empfohlene Reihenfolge</option>
                  <option value="frist">Nach Frist</option>
                </select>
              </div>

              <ul className={stile.liste}>
                {(sortierung === 'frist'
                  ? sortiereNachFrist(zustand.baum, fall.sterbedatum, heute)
                  : zustand.baum
                ).map((knoten) => (
                  <Aufgabenzeile
                    key={knoten.aufgabe.id}
                    knoten={knoten}
                    lage={fristlage(knoten.aufgabe.katalog, fall.sterbedatum, heute)}
                    gesperrt={laeuft}
                    ichUserId={ich.userId}
                    aufHaken={(erledigt) => fuehreAus(() => hakeAb(knoten.aufgabe, erledigt))}
                    aufSpeichern={(titel, beschreibung) =>
                      fuehreAus(() => schreibe(knoten.aufgabe, { titel, beschreibung }))
                    }
                    aufLoeschen={() => void fuehreAus(() => loesche(knoten.aufgabe))}
                    aufUebernehmen={() => void fuehreAus(() => uebernimm(knoten.aufgabe))}
                    aufFreigeben={() => void fuehreAus(() => gibFrei(knoten.aufgabe))}
                  />
                ))}
              </ul>
            </>
          )}

          {/*
            §3.7: Nicht entschlüsselbare Items verschwinden still: Sie gehören
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
          <Link to="/">Zurück</Link> · <Link to="/erbe">Erbe & Tresor</Link> ·{' '}
          <Link to="/profil">Profil</Link>
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
