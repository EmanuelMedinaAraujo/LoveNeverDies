import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { Navigate, useSearchParams } from 'react-router-dom'
import { alsNachricht } from '../../../core/fehler.ts'
import { useAufgaben, type Neuangaben } from '../../../hooks/useAufgaben.ts'
import { useCase } from '../../../hooks/useCase.ts'
import { sortiereNachFrist, type Aufgabenknoten } from '../../../services/aufgabenbaum.ts'
import type { LesbarerFall } from '../../../services/fallService.ts'
import { istSeedAufgabe } from '../../../services/fragebaumService.ts'
import { fristlage, fristText, heuteIso, type Fristlage } from '../../../services/fristen.ts'
import { Badge, type Badgelage } from '../../../ui/Badge/Badge.tsx'
import { Card } from '../../../ui/Card/Card.tsx'
import { Checkbox } from '../../../ui/Checkbox/Checkbox.tsx'
import { Button } from '../../../ui/Button/Button.tsx'
import { Dialog } from '../../../ui/Dialog/Dialog.tsx'
import { Klapp } from '../../../ui/Klapp/Klapp.tsx'
import { Detailziel, Liste, Zeile } from '../../../ui/Liste/Liste.tsx'
import type { Erinnerungsdaten } from '../../../hooks/useErinnerungen.ts'
import { darfAbhaken, zuweisungText } from '../../../services/zuweisung.ts'
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
 * weniger zeigt und nicht bloß größer gesetzt ist. Hier wird sortiert und
 * abgehakt, mehr nicht: Ändern, Löschen, Übernehmen und Freigeben stehen im
 * Aufgabendetail, einen Fingertipp weiter. Vier Schaltflächen unter jeder von
 * zwanzig Zeilen sind vier Gelegenheiten, in einer Liste etwas zu löschen,
 * das man nur ansehen wollte.
 *
 * Angelegt wird hinter einem Plus oben rechts, in einem Dialog. Das Formular
 * stand vorher als Karte über der Liste — ein Feld, ein Schalter, ein Satz
 * Erklärung und eine Schaltfläche, jedes Mal, wenn jemand diesen Screen
 * öffnete, und geöffnet wird er, um nachzusehen, was zu tun ist. Im Dialog ist
 * dafür Platz für mehr als den Titel: Beschreibung, Frist und Zuständigkeit
 * sind Angaben, die man beim Aufschreiben im Kopf hat und die man sonst
 * zweimal sucht.
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

/** Wie dringend eine Frist aussieht (§12). Ab drei Tagen wird es knapp. */
function badgelage(lage: Fristlage): Badgelage {
  if (lage.art === 'unverzueglich') {
    return 'knapp'
  }

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
}: {
  knoten: Aufgabenknoten
  lage: Fristlage
  gesperrt: boolean
  /** Die angemeldete Person. Ob sie abhaken darf, entscheidet die Zuweisung (§7). */
  ichUserId: string
  /** @returns ob die Änderung angehängt wurde. Sonst nimmt die Zeile sie zurück. */
  aufHaken: (erledigt: boolean) => Promise<boolean>
}) {
  const { aufgabe, unteraufgaben, istBlatt, erledigt: giltAlsErledigt, blockiertVon } = knoten

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

  const badge = fristText(lage)
  const blockiert = blockiertVon.length > 0

  /*
   * "Abhaken darf nur, wem sie zugewiesen ist." Wer nicht darunter steht,
   * sieht die Aufgabe vollständig und findet im Detail den einen Weg, der ihm
   * offensteht: sie übernehmen.
   */
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
        {/*
          Titel links, Badges rechts. Vorher standen sie in der Metazeile
          darunter, vor "0/1 erledigt" und "Sie", und wanderten damit von Zeile
          zu Zeile: In einer Liste, in der jede zweite Aufgabe eine Frist trägt
          und jede dritte privat ist, stand das rote Badge mal an dritter, mal
          an erster Stelle. Am rechten Rand steht es in jeder Zeile an
          derselben Stelle, und wer die Liste nach Fristen durchsieht, liest
          eine Spalte statt zwanzig verschiedener Positionen.
        */}
        <div className={stile.titelzeile}>
          {/*
            Kein Kästchen, wo niemand abhaken darf (§7): Ein graues ist eine
            Einladung, die nicht gilt. Wer zuständig ist, steht in der Zeile
            darunter, und der Weg dahin führt über die Aufgabe selbst.
          */}
          {istBlatt && darfHaken ? (
            <Checkbox
              abhaken
              checked={erledigt}
              disabled={gesperrt}
              onChange={(ereignis) => void haken(ereignis.target.checked)}
              label={aufgabe.titel}
              nurKaestchen
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

          <p className={stile.badges}>
            {badge === null ? null : <Badge lage={badgelage(lage)}>{badge}</Badge>}

            {/*
              §3.7: Eine private Aufgabe sieht sonst aus wie jede andere, und
              genau das ist die Gefahr: Wer nicht sieht, dass die Geschwister
              sie nicht sehen, schreibt dort etwas hinein, das er für geteilt
              hält.
            */}
            {aufgabe.privat ? <Badge lage="hinweis">Nur für mich</Badge> : null}
          </p>
        </div>

        <p className={stile.meta}>{meta}</p>
      </div>

      {/*
        Die eine Aufgabe, die noch aus dem Katalog kommt (ADR-0001), hat keine
        eigene Detailseite: Ihr Ergebnis steht im Fragebaum. Erkannt wird sie
        an ihrer Herkunft, nicht am Titel (ERBE_DESIGN.md §9).
      */}
      <Detailziel
        ziel={istSeedAufgabe(aufgabe.katalog) ? '/erbe/fragebaum' : `/aufgabe/${aufgabe.id}`}
        titel={aufgabe.titel}
      />
    </Zeile>
  )
}

/** Wonach die Liste sortiert ist (§7, §8). */
type Sortierung = 'reihenfolge' | 'frist'

/**
 * Die Beschriftung des Auf-/Zuklappers für erledigte Aufgaben (§7).
 *
 * Dieselbe kleine Funktion wie in `screens/erweitert/Start/Start.tsx` und in
 * `screens/einfach/Bausteine.tsx`: Für die erweiterte Ansicht gibt es keine
 * gemeinsame Datei, aus der heraus man sie teilen könnte (§9).
 */
function erledigtSchalter(anzahl: number): { titel: string; offenText: string } {
  const wort = anzahl === 1 ? 'erledigte Aufgabe' : 'erledigte Aufgaben'

  return { titel: `${anzahl} ${wort} anzeigen`, offenText: `${anzahl} ${wort} ausblenden` }
}

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

/** Das Plus rechts neben dem Seitentitel: „hier kommt eine dazu". */
function Plus() {
  return (
    <svg
      className={stile.plus}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M12 5v14M5 12h14" />
    </svg>
  )
}

/**
 * Der Seitenkopf: der Titel, rechts daneben Platz für genau eine Aktion.
 *
 * Er steht in einer eigenen Komponente, weil dieser Screen ihn an drei Stellen
 * zeigt — mit Liste, mit Fehlermeldung, mit gesperrtem Fall — und nur in der
 * ersten etwas darin steht. Ein `h1`, der an zwei von drei Stellen fehlte,
 * wäre für eine Vorlesestimme eine Seite ohne Überschrift.
 */
function Kopf({ aktion }: { aktion?: ReactNode }) {
  return (
    <div className={stile.kopf}>
      <h1>Alle Aufgaben</h1>
      {aktion}
    </div>
  )
}

/**
 * Das Formular zum Anlegen, in einem Dialog (§7).
 *
 * Vorher stand es als Karte über der Liste: ein Feld, ein Schalter, ein Satz
 * Erklärung und eine Schaltfläche, jedes Mal, wenn jemand diesen Screen
 * öffnete — und geöffnet wird er, um nachzusehen, was zu tun ist. Jetzt steht
 * dort ein Plus, und wer es antippt, bekommt das ganze Formular statt nur des
 * Titelfelds: Beschreibung, Frist und Zuständigkeit sind Angaben, die man
 * beim Aufschreiben im Kopf hat und die man sonst zweimal sucht — einmal beim
 * Anlegen, einmal im Detail.
 *
 * Speichern steht oben rechts *und* am Ende des Formulars. Oben, weil dort
 * jedes Telefon es hat und weil es erreichbar bleibt, sobald jemand nach unten
 * scrollt; unten, weil wer von oben nach unten ausfüllt, unten aufhört und
 * nicht wieder hochsehen soll.
 */
export function NeueAufgabe({
  gesperrt,
  aufSchliessen,
  aufAnlegen,
}: {
  gesperrt: boolean
  aufSchliessen: () => void
  /** `false`, wenn nichts gespeichert wurde. Der Dialog bleibt dann offen. */
  aufAnlegen: (titel: string, nurFuerMich: boolean, angaben: Neuangaben) => Promise<boolean>
}) {
  const [titel, setzeTitel] = useState('')
  const [beschreibung, setzeBeschreibung] = useState('')
  const [fristAm, setzeFristAm] = useState('')
  const [nurFuerMich, setzeNurFuerMich] = useState(false)

  /*
   * `required` allein liesse einen Titel aus lauter Leerzeichen durch; der
   * Dienst weist ihn dann ab, und die Meldung landet weit weg von diesem Feld.
   * Was nicht gespeichert werden kann, lässt sich hier gar nicht erst
   * abschicken.
   */
  const bereit = !gesperrt && titel.trim() !== ''

  async function anlegen(ereignis: FormEvent) {
    ereignis.preventDefault()

    const gespeichert = await aufAnlegen(titel, nurFuerMich, {
      beschreibung: beschreibung.trim(),
      fristAm: fristAm === '' ? null : fristAm,
    })

    if (gespeichert) {
      aufSchliessen()
    }
  }

  /*
   * Die Schaltfläche oben steht ausserhalb des `form` und findet es über
   * `form={…}`: Ein zweites Formular um sie herum wäre ein zweites Ziel für
   * die Eingabetaste, und der Dialog hätte dann zwei Wege zu speichern, von
   * denen einer die Felder nicht kennt.
   */
  const formularId = 'neue-aufgabe-formular'

  return (
    <Dialog
      titel="Neue Aufgabe"
      aufSchliessen={aufSchliessen}
      kopfaktion={
        <Button variante="text" type="submit" form={formularId} disabled={!bereit}>
          Speichern
        </Button>
      }
    >
      <form
        id={formularId}
        className={stile.formular}
        onSubmit={(ereignis) => void anlegen(ereignis)}
      >
        <div className={stile.feld}>
          <label htmlFor="neue-aufgabe">Was ist zu tun?</label>
          <input
            id="neue-aufgabe"
            className={stile.eingabe}
            value={titel}
            onChange={(ereignis) => setzeTitel(ereignis.target.value)}
            required
            autoFocus
          />
        </div>

        <div className={stile.feld}>
          <label htmlFor="neue-aufgabe-beschreibung">Beschreibung (optional)</label>
          <textarea
            id="neue-aufgabe-beschreibung"
            className={stile.eingabe}
            rows={3}
            value={beschreibung}
            onChange={(ereignis) => setzeBeschreibung(ereignis.target.value)}
          />
        </div>

        {/*
          §7: Eine Frist lässt sich für jede Aufgabe eintragen, auch für eine
          selbst angelegte ohne Rechtsgrundlage. Sie gehört der Aufgabe und
          nicht der Person: Alle Mitglieder des Falls sehen dasselbe Datum.
        */}
        <div className={stile.feld}>
          <label htmlFor="neue-aufgabe-frist">Erledigt bis (optional)</label>
          <input
            id="neue-aufgabe-frist"
            type="date"
            className={stile.eingabe}
            value={fristAm}
            onChange={(ereignis) => setzeFristAm(ereignis.target.value)}
          />
        </div>

        {/*
          §7: "ein Schalter 'Nur für mich' auf der Aufgabe" — und genau einer.
          Daneben stand bis hierher noch "Ich übernehme das", und zwei Haken
          untereinander lasen sich wie zwei Fragen zu derselben Sache: Wer
          sieht das, und wem gehört es? Die zweite stellt sich beim Anlegen
          nicht. Wer etwas aufschreibt, meint sich selbst; die Aufgabe ist
          damit eingetragen, und in der Aufgabe selbst steht der Weg, sie
          wieder freizugeben (§7).

          Er steht beim Anlegen und nicht danach: Umgekehrt ginge es nicht,
          denn eine geteilte Aufgabe nachträglich privat zu machen hiesse, sie
          den anderen wieder wegzunehmen, und gesehen haben sie sie längst (§5).
        */}
        <Checkbox
          checked={nurFuerMich}
          onChange={(ereignis) => setzeNurFuerMich(ereignis.target.checked)}
          label="Nur für mich"
        />

        {/*
          §3.7: Der erklärende Satz steht nur beim angehakten Schalter. Dass
          eine Aufgabe alle Mitglieder des Falls sehen, ist der Normalfall und
          braucht keine Ansage; dass eine Aufgabe *niemand sonst* sieht, ist
          genau die Auskunft, ohne die jemand dort etwas hineinschreibt, das er
          für geteilt hält.
        */}
        {nurFuerMich ? (
          <p className={stile.hinweis}>
            Diese Aufgabe sehen nur Sie, auf Ihren eigenen Geräten. Sie können sie später für
            alle sichtbar machen.
          </p>
        ) : null}

        <Button type="submit" volleBreite disabled={!bereit}>
          Aufgabe speichern
        </Button>
      </form>
    </Dialog>
  )
}

function Aufgabenbereich({ fall }: { fall: LesbarerFall }) {
  const {
    zustand,
    erinnerungen,
    abgelehnt,
    bestaetige,
    legeAn,
    hakeAb,
    ich,
    uebernahmen,
    bestaetigeUebernahmen,
    fristbezug,
  } = useAufgaben(fall)

  /*
   * §2, §3.5: Ein Vorsorgefall hat kein Sterbedatum und damit keine einzige
   * Frist. "Nach Frist" sortierte dort eine Liste, in der jede Zeile denselben
   * leeren Wert trägt — eine Wahl, die sichtbar nichts tut. Sie steht deshalb
   * gar nicht erst da.
   */
  const mitFristen = fall.status !== 'vorsorge'

  /*
   * Der Query-Parameter `?neu=1` öffnet den Anlegen-Dialog beim Laden der
   * Seite. So springt der Nachlass-Screen hierher und öffnet den Dialog in
   * einem Schritt. Der Parameter wird sofort aus der URL entfernt, damit ein
   * Neuladen der Seite den Dialog nicht erneut öffnet.
   */
  const [suchParams, setzeSuchParams] = useSearchParams()

  const [legtAn, setzeLegtAn] = useState(() => suchParams.get('neu') === '1')
  const [sortierung, setzeSortierung] = useState<Sortierung>('reihenfolge')
  const [laeuft, setzeLaeuft] = useState(false)
  const [fehler, setzeFehler] = useState<string | null>(null)

  useEffect(() => {
    if (suchParams.has('neu')) {
      suchParams.delete('neu')
      setzeSuchParams(suchParams, { replace: true })
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * §5: Abgelehnte Änderungen werden nie stillschweigend verworfen. Deshalb
   * läuft jede Mutation durch diese eine Stelle, und was hier ankommt, steht
   * danach als Meldung auf dem Bildschirm.
   *
   * @returns ob es geklappt hat. Wer etwas eingetippt hat, behält es sonst.
   */
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

  /*
   * Einmal je Rendern, nicht einmal je Zeile: Ein Fall mit vierzig Aufgaben
   * fragte sonst vierzigmal nach dem heutigen Tag und geriete um Mitternacht
   * an zwei verschiedene Antworten in derselben Liste.
   */
  const heute = heuteIso()

  /** Eine Zeile, gleich ob sie in der offenen oder der erledigten Gruppe steht. */
  function zeile(knoten: Aufgabenknoten) {
    return (
      <Aufgabenzeile
        key={knoten.aufgabe.id}
        knoten={knoten}
        lage={fristlage(knoten.aufgabe.katalog, fristbezug, heute, knoten.aufgabe.fristAm)}
        gesperrt={laeuft}
        ichUserId={ich.userId}
        aufHaken={(erledigt) => fuehreAus(() => hakeAb(knoten.aufgabe, erledigt))}
      />
    )
  }

  return (
    <>
      {/*
        §7: Der Weg zum Anlegen steht oben rechts im Seitenkopf und nicht als
        Karte über der Liste. Wer diesen Screen öffnet, will fast immer sehen,
        was zu tun ist, und nicht etwas hinzufügen; ein Plus kostet dabei eine
        Zeile Höhe, ein Formular kostet den halben Bildschirm.
      */}
      <Kopf
        aktion={
          <Button
            variante="text"
            className={stile.plusknopf}
            onClick={() => setzeLegtAn(true)}
            vorleseText="Neue Aufgabe"
          >
            <Plus />
          </Button>
        }
      />

      {legtAn ? (
        <NeueAufgabe
          gesperrt={laeuft}
          aufSchliessen={() => setzeLegtAn(false)}
          aufAnlegen={(titel, nurFuerMich, angaben) =>
            fuehreAus(() => legeAn(titel, null, nurFuerMich, angaben))
          }
        />
      ) : null}

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
              {mitFristen ? (
                <div className={stile.sortierzeile}>
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
              ) : null}

              {/*
                §7: Erledigte Aufgaben stehen am Ende der Liste und zu Anfang
                eingeklappt — unabhängig von der gewählten Sortierung, die
                innerhalb jeder der beiden Gruppen weiterhin gilt.
              */}
              {(() => {
                const sortiert =
                  mitFristen && sortierung === 'frist'
                    ? sortiereNachFrist(zustand.baum, fristbezug, heute)
                    : zustand.baum
                const offene = sortiert.filter((knoten) => !knoten.erledigt)
                const erledigte = sortiert.filter((knoten) => knoten.erledigt)

                return (
                  <>
                    {offene.length === 0 ? null : (
                      <Liste>{offene.map((knoten) => zeile(knoten))}</Liste>
                    )}

                    {erledigte.length === 0 ? null : (
                      <Klapp {...erledigtSchalter(erledigte.length)}>
                        <Liste>{erledigte.map((knoten) => zeile(knoten))}</Liste>
                      </Klapp>
                    )}
                  </>
                )
              })()}
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
        <Kopf />
        <Ladeanzeige text={fallLadeText(zustand.status)} />
      </main>
    )
  }

  // Ohne Fall ist die App gesperrt (§7). Die Fallweiche steht auf der
  // Startseite, und dorthin gehört auch, wer hier direkt hereinkommt.
  if (zustand.status === 'kein-fall') {
    return <Navigate to="/" replace />
  }

  /*
   * Der Kopf steht in den beiden Fehlerzweigen ohne Aktion und im Regelfall
   * mit: Ein Plus über einer Meldung, dass die Aufgaben nicht abrufbar sind,
   * wäre eine Einladung, etwas zu schreiben, das gerade nirgends hinkommt.
   * Deshalb bringt der `Aufgabenbereich` seinen Kopf selbst mit.
   */
  return (
    <main className={stile.seite}>
      {zustand.status === 'fehler' ? (
        <>
          <Kopf />
          <p className={stile.hinweis} role="alert">
            Ihre Aufgaben sind gerade nicht abrufbar. {zustand.nachricht}
          </p>
        </>
      ) : zustand.aktiver.zustand === 'gesperrt' ? (
        <>
          <Kopf />
          <p className={stile.hinweis} role="alert">
            Dieser Fall ist auf diesem Gerät gesperrt. {zustand.aktiver.grund}
          </p>
        </>
      ) : (
        <Aufgabenbereich fall={zustand.aktiver} />
      )}
    </main>
  )
}
