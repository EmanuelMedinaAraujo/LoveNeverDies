import { useState, type FormEvent, type ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
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
import { Detailziel, Liste, Zeile } from '../../../ui/Liste/Liste.tsx'
import type { Erinnerungsdaten } from '../../../hooks/useErinnerungen.ts'
import {
  darfAbhaken,
  darfBearbeiten,
  istFrei,
  zuweisungText,
} from '../../../services/zuweisung.ts'
import { fallLadeText } from '../../shared/Ladeanzeige/FallLadeanzeige.tsx'
import { Abgelehnt, Uebernahmen } from '../../shared/Meldungen/Meldungen.tsx'
import stile from './Alle.module.css'

/**
 * Der Tab "Alle": alle Aufgaben des Falls (DESIGN.md §7).
 *
 * Anlegen, abhaken, umbenennen, löschen, und nach jedem Neuladen stimmt der
 * Stand, weil nichts davon nur lokal passiert. Verschlüsselt wird im
 * `aufgabenService`, bevor irgendetwas den Browser verlässt; dieser Screen
 * sieht ausschließlich Klartext, den es nur hier gibt.
 *
 * Die erweiterte Fassung dieses Tabs (§7). Die einfache steht daneben in
 * `screens/einfach/Alle`; getrennt sind sie, seit die einfache wirklich
 * weniger zeigt und nicht bloß größer gesetzt ist. Hier steht alles, was eine
 * Familie zum Verteilen braucht: sortieren, ändern, löschen, übernehmen,
 * freigeben — vier Aktionen unter jeder Zeile, ohne eine einzige Aufgabe zu
 * öffnen.
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

type ZeilenModus = 'anzeigen' | 'aendern' | 'loeschen' | 'freigeben'

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
  aufFuerAlleSichtbar,
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
  /** Wrappt den DEK von `K_p` auf `K_c` und macht die Aufgabe damit sichtbar (§3.7). */
  aufFuerAlleSichtbar: () => void
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
      <Zeile className={stile.formularzeile}>
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
      </Zeile>
    )
  }

  if (modus === 'freigeben') {
    return (
      <Zeile className={stile.formularzeile}>
        {/*
          §3.7: Freigeben wrappt den DEK von `K_p` auf `K_c`. Einen Weg zurück
          gibt es nicht: Der Fallschlüssel liegt bei allen, und was einmal
          darunter lag, hat jedes Mitglied beim nächsten Delta gesehen. Das
          gehört vor die Aktion gesagt und nicht danach.
        */}
        <p>
          „{aufgabe.titel}" für alle sichtbar machen? Danach sehen alle Mitglieder des Falls
          diese Aufgabe. Zurücknehmen lässt sich das nicht.
        </p>
        <div className={stile.aktionen}>
          <Button
            onClick={() => {
              setzeModus('anzeigen')
              aufFuerAlleSichtbar()
            }}
            disabled={gesperrt}
          >
            Für alle sichtbar machen
          </Button>
          <Button variante="sekundaer" onClick={() => setzeModus('anzeigen')}>
            Abbrechen
          </Button>
        </div>
      </Zeile>
    )
  }

  if (modus === 'loeschen') {
    return (
      <Zeile className={stile.formularzeile}>
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
      </Zeile>
    )
  }

  const badge = fristText(lage)
  const blockiert = blockiertVon.length > 0

  /*
   * "Bearbeiten darf nur, wem sie zugewiesen ist." Wer nicht darunter steht,
   * sieht die Aufgabe vollständig und findet statt der Schaltflächen den einen
   * Weg, der ihm offensteht: sie übernehmen.
   */
  const darfAendern = darfBearbeiten(aufgabe.assignee, ichUserId)
  const darfHaken = darfAbhaken(aufgabe.assignee, ichUserId)

  /*
   * Was früher als vier eigene Absätze unter dem Titel stand, steht jetzt in
   * einer Zeile nebeneinander. Die Beschreibung ist dabei ganz aus der Liste
   * verschwunden: Sie ist ein ganzer Absatz Fließtext, sie steht im Detail,
   * und in einer Liste von zwanzig Aufgaben macht sie aus jeder Zeile einen
   * Block, durch den man scrollt, statt ihn zu lesen.
   */
  const meta: ReactNode[] = []

  if (!istBlatt) {
    meta.push(
      <span key="stand">
        {unteraufgaben.filter((eins) => eins.erledigt).length}/{unteraufgaben.length} erledigt
      </span>,
    )
  }

  meta.push(<span key="wer">{zuweisungText(aufgabe.assignee, ichUserId)}</span>)

  if (blockiert) {
    meta.push(
      <span key="zuerst" className={stile.zuerst}>
        Zuerst: {blockiertVon.map((offen) => offen.titel).join(', ')}
      </span>,
    )
  }

  return (
    <Zeile className={blockiert ? stile.wartet : undefined}>
      <div className={stile.spalte}>
        {istBlatt ? (
          <Checkbox
            checked={erledigt}
            disabled={gesperrt || !darfHaken}
            onChange={(ereignis) => void haken(ereignis.target.checked)}
            label={aufgabe.titel}
          />
        ) : (
          <p
            className={[stile.titelohne, giltAlsErledigt ? stile.fertig : null]
              .filter(Boolean)
              .join(' ')}
          >
            {aufgabe.titel}
          </p>
        )}

        <p className={stile.meta}>
          {badge === null ? null : <Badge lage={badgelage(lage)}>{badge}</Badge>}

          {/*
            §3.7: Eine private Aufgabe sieht sonst aus wie jede andere, und
            genau das ist die Gefahr: Wer nicht sieht, dass die Geschwister sie
            nicht sehen, schreibt dort etwas hinein, das er für geteilt hält.
          */}
          {aufgabe.privat ? <Badge lage="hinweis">Nur für mich</Badge> : null}

          {meta}
        </p>

        {/*
          Die Aktionen als Text und nicht als vier umrandete Kästen: In einer
          Liste ist die Aufgabe die Sache, und die Schaltflächen sind das, was
          man mit ihr tun kann. Jede trägt den Titel zum Vorlesen mit — ohne
          ihn hörte eine blinde Person in einer Liste von zwanzig Aufgaben
          zwanzigmal "Ändern" und wüsste nie, welche gemeint ist.

          Das Trennzeichen ist ein Doppelpunkt und kein Leerzeichen: Die
          Berechnung des zugänglichen Namens schneidet den Rand jedes
          Textknotens ab, ein führendes Leerzeichen fiele also weg und beide
          Teile klebten aneinander.
        */}
        <div className={stile.aktionen}>
          {darfAendern ? (
            <>
              <Button
                variante="text"
                className={stile.leise}
                onClick={beginneAendern}
                vorleseText={`: „${aufgabe.titel}"`}
              >
                Ändern
              </Button>
              <Button
                variante="text"
                className={stile.leise}
                onClick={() => setzeModus('loeschen')}
                vorleseText={`: „${aufgabe.titel}"`}
              >
                Löschen
              </Button>
            </>
          ) : (
            <Button
              variante="text"
              disabled={gesperrt}
              onClick={aufUebernehmen}
              vorleseText={`: „${aufgabe.titel}"`}
            >
              Übernehmen
            </Button>
          )}

          {/*
            §7: "Eine Reservierung ist von jedem wieder lösbar, nicht nur von
            der reservierenden Person." In einer Familie fällt jemand aus, und
            eine Aufgabe, die niemand mehr freigeben kann, blockiert eine
            gesetzliche Frist.
          */}
          {istFrei(aufgabe.assignee) ? null : (
            <Button
              variante="text"
              className={stile.leise}
              disabled={gesperrt}
              onClick={aufFreigeben}
              vorleseText={`: „${aufgabe.titel}"`}
            >
              Freigeben
            </Button>
          )}

          {/* §3.7: "genau eine Aktion 'Für alle sichtbar machen'". */}
          {aufgabe.privat ? (
            <Button
              variante="text"
              disabled={gesperrt}
              onClick={() => setzeModus('freigeben')}
              vorleseText={`: „${aufgabe.titel}"`}
            >
              Für alle sichtbar machen
            </Button>
          ) : null}
        </div>
      </div>

      <Detailziel ziel={`/aufgabe/${aufgabe.id}`} titel={aufgabe.titel} />
    </Zeile>
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
    gibFuerAlleFrei,
    fristbezug,
  } = useAufgaben(fall)

  const [neuerTitel, setzeNeuerTitel] = useState('')
  const [nurFuerMich, setzeNurFuerMich] = useState(false)
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

    if (await fuehreAus(() => legeAn(titel, null, nurFuerMich))) {
      setzeNeuerTitel('')
      /*
       * Der Schalter fällt mit zurück. Er ist eine Angabe zu dieser einen
       * Aufgabe und keine Einstellung: Stünde er stehen, wäre die nächste
       * Aufgabe unbemerkt ebenfalls privat, und niemand sähe sie: die eine
       * Verwechslung, die §3.7 teuer bezahlt.
       */
      setzeNurFuerMich(false)
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

          {/*
            §7: "ein Schalter 'Nur für mich' auf der Aufgabe". Er steht beim
            Anlegen und nicht danach: Umgekehrt ginge es nicht, denn eine
            geteilte Aufgabe nachträglich privat zu machen hiesse, sie den
            anderen wieder wegzunehmen, und gesehen haben sie sie längst (§5).
          */}
          <Checkbox
            checked={nurFuerMich}
            onChange={(ereignis) => setzeNurFuerMich(ereignis.target.checked)}
            label="Nur für mich"
          />

          <p className={stile.hinweis}>
            {nurFuerMich
              ? 'Diese Aufgabe sehen nur Sie, auf Ihren eigenen Geräten. Sie können sie später für alle sichtbar machen.'
              : 'Diese Aufgabe sehen alle Mitglieder des Falls.'}
          </p>

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

              <Liste>
                {(sortierung === 'frist'
                  ? sortiereNachFrist(zustand.baum, fristbezug, heute)
                  : zustand.baum
                ).map((knoten) => (
                  <Aufgabenzeile
                    key={knoten.aufgabe.id}
                    knoten={knoten}
                    lage={fristlage(knoten.aufgabe.katalog, fristbezug, heute)}
                    gesperrt={laeuft}
                    ichUserId={ich.userId}
                    aufHaken={(erledigt) => fuehreAus(() => hakeAb(knoten.aufgabe, erledigt))}
                    aufSpeichern={(titel, beschreibung) =>
                      fuehreAus(() => schreibe(knoten.aufgabe, { titel, beschreibung }))
                    }
                    aufLoeschen={() => void fuehreAus(() => loesche(knoten.aufgabe))}
                    aufUebernehmen={() => void fuehreAus(() => uebernimm(knoten.aufgabe))}
                    aufFreigeben={() => void fuehreAus(() => gibFrei(knoten.aufgabe))}
                    aufFuerAlleSichtbar={() =>
                      void fuehreAus(() => gibFuerAlleFrei(knoten.aufgabe))
                    }
                  />
                ))}
              </Liste>
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

  if (zustand.status === 'laedt' || zustand.status === 'schluessel-erneuerung') {
    return (
      <main className={stile.seite}>
        <Ladeanzeige text={fallLadeText(zustand.status)} />
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
