import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Navigate, useLocation, useNavigate, useParams } from 'react-router-dom'
import { alsNachricht } from '../../../core/fehler.ts'
import { useAnsichtsmodus } from '../../../hooks/useAnsichtsmodus.ts'
import { useAufgaben, type Aufgabendaten } from '../../../hooks/useAufgaben.ts'
import { useCase } from '../../../hooks/useCase.ts'
import type { Fragebaumergebnis } from '../../../services/aufgabenService.ts'
import type { LesbarerFall } from '../../../services/fallService.ts'
import {
  BAUPLAENE,
  infoText,
  notizAus,
  statusText,
  WURZEL,
  knoten as knotenMit,
} from '../../../services/fragebaumService.ts'
import type { Fragebaumknoten, Infothema } from '../../../types/fragebaum.ts'
import type { GerichtLookupErgebnis, Nachlassgericht } from '../../../types/gericht.ts'
import { findeNachlassgericht } from '../../../services/gerichtService.ts'
import { Badge } from '../../../ui/Badge/Badge.tsx'
import { Button } from '../../../ui/Button/Button.tsx'
import { Gerichtskarte } from '../../../ui/Gerichtskarte/Gerichtskarte.tsx'
import { Zurueck } from '../../../ui/Zurueck/Zurueck.tsx'
import { KeinFall } from '../KeinFall/KeinFall.tsx'
import { fallLadeText } from '../Ladeanzeige/FallLadeanzeige.tsx'
import stile from './Fragebaum.module.css'

/**
 * Der Erbe-Fragebaum: eine Frage, eine Seite (ERBE_DESIGN.md §3).
 *
 * Der gegangene Pfad steht im `state` des Routers und damit im History-Eintrag
 * des Browsers — nicht in der Adresse, nicht in `sessionStorage` und nirgends
 * im Fall. Daraus folgt zweierlei: Der Zurück-Knopf des Browsers führt zur
 * vorigen Frage (auf einem Telefon der Knopf, den Menschen tatsächlich
 * benutzen), und wer neu auf eine Frage kommt — geteilter Link, neuer Tab,
 * wieder geöffnete App — bringt keinen Pfad mit und fängt von vorn an. Ein
 * halb gegangener Pfad ist keine Tatsache über das Erbe von irgendwem, und
 * eine Antwort von vorgestern, die heute stillschweigend weitergilt, ist
 * schlechter als die Frage noch einmal zu stellen (ADR-0002).
 *
 * Ein Renderer für beide Ansichten, kein zweiter Screen-Baum (§7): Bei 80
 * Ergebnistexten wären zwei Fassungen desselben Rechtstextes zwei Fassungen,
 * die auseinanderlaufen.
 */

type Pfadstatus = { pfad?: string[] } | null

function Ladeanzeige({ text }: { text: string }) {
  return (
    <p className={stile.hinweis} role="status">
      {text}
    </p>
  )
}

/**
 * Ein aufklappbarer Bereich.
 *
 * Kein Dialog: Einen gibt es in dieser App sonst nirgends, und eine eigene
 * Adresse machte aus dem Zurück-Knopf, der zur vorigen Frage führen soll,
 * einen, der die Erläuterung schließt.
 */
function Klapp({
  titel,
  offenText,
  children,
}: {
  titel: string
  offenText?: string
  children: ReactNode
}) {
  const [offen, setzeOffen] = useState(false)

  return (
    <div className={stile.klapp}>
      <Button
        variante="text"
        className={stile.klappKnopf}
        aria-expanded={offen}
        onClick={() => setzeOffen((vorher) => !vorher)}
      >
        <span>{offen ? (offenText ?? titel) : titel}</span>
        <svg
          className={[stile.klappPfeil, offen ? stile.klappPfeilOffen : ''].filter(Boolean).join(' ')}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </Button>
      {offen ? children : null}
    </div>
  )
}

/**
 * `**fett**` aus der Inhaltsdatei als `<strong>` und `[gruen:text]` als farbiger Span.
 *
 * Die Ueberschriften einer Aufzaehlung — "1. Frist", "Aussehen", "Nur fuer
 * Pflichtteilsberechtigte:" — stehen mitten in einem Absatz, der seine
 * Umbrueche behalten muss (`pre-wrap`). Ein eigenes Feld je Zeile machte aus
 * jedem der 80 Ergebnistexte eine Struktur, die die Juristinnen pflegen
 * muessten; zwei Sternchen sind das, was sie ohnehin schreiben.
 *
 * Bewusst kein Markdown: Fett und Akzentgrün sind die einzigen Auszeichnungen,
 * die hier vorkommen, und eine Bibliothek dafuer brächte Ueberschriften, Links
 * und Listen mit, die in diesen Texten nichts zu suchen haben.
 */
function mitFett(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|\[gruen:[^\]]+\])/g).map((teil, nummer) => {
    if (teil.startsWith('**') && teil.endsWith('**')) {
      return <strong key={nummer}>{mitFett(teil.slice(2, -2))}</strong>
    }
    if (teil.startsWith('[gruen:') && teil.endsWith(']')) {
      return (
        <span key={nummer} className={stile.gruen}>
          {mitFett(teil.slice(7, -1))}
        </span>
      )
    }
    return teil
  })
}

/** Derselbe Text ohne die Formatierungs-Tags: fuer die Ueberschrift, die schon fett ist. */
function ohneFett(text: string): string {
  return text.replaceAll('**', '').replaceAll(/\[gruen:([^\]]+)\]/g, '$1')
}

/**
 * Die erste Zeile als Ueberschrift, der Rest als Fliesstext.
 *
 * Die Inhaltsdatei fuehrt einen einzigen Text je Knoten und kein eigenes Feld
 * fuer den Titel: Bei 141 Knoten waere das ein zweites Feld, das an 137 von
 * ihnen leer stuende. Die erste Zeile ist die Ueberschrift — auf einer Frage
 * ("Wie erkenne ich ein Testament?") wie auf einem Ergebnis ("Sie wollen das
 * Erbe nicht (Ausschlagung)"), und beide Seiten sehen dadurch gleich aus.
 */
function geteilt(text: string): [ueberschrift: string, rest: string] {
  const [erste, ...weitere] = text.split('\n')

  return [ohneFett(erste ?? ''), weitere.join('\n')]
}

/**
 * Ein langer Text, in der einfachen Ansicht gekuerzt (§4).
 *
 * Gekuerzt und nicht umformuliert: §8 sagt "Erfunden wird nichts", und eine in
 * eigene Worte gefasste Ausschlagungsfrist ist genau das, wovor der Satz warnt.
 * Der Vorspann ist deshalb die erste Zeile des Originals und kein Resuemee.
 */
function Langtext({ text }: { text: string }) {
  const modus = useAnsichtsmodus()
  const [ganz, setzeGanz] = useState(false)
  const zeilen = text.split('\n')
  const kurz = modus === 'einfach' && zeilen.length > 2 && !ganz

  if (!kurz) {
    return <p className={stile.text}>{mitFett(text)}</p>
  }

  return (
    <>
      <p className={stile.text}>{mitFett(zeilen[0] ?? '')}</p>
      <Button variante="text" onClick={() => setzeGanz(true)}>
        Mehr anzeigen
      </Button>
    </>
  )
}

/**
 * Die zuständige Stelle ermitteln (ERBE_DESIGN.md §8).
 *
 * Ermittelt aus der eingegebenen 5-stelligen PLZ das zuständige Nachlassgericht
 * aus dem bundesweiten Datensatz aller 611 Gerichte.
 */
function Gerichtssuche({
  plz,
  setzePlz,
  setzeGericht,
}: {
  plz: string
  setzePlz: (wert: string) => void
  setzeGericht: (wert: Nachlassgericht | null) => void
}) {
  const [ergebnis, setzeErgebnis] = useState<GerichtLookupErgebnis | null>(() => {
    if (plz.trim().length === 5) {
      return findeNachlassgericht(plz)
    }
    return null
  })

  function suche(suchPlz: string) {
    const res = findeNachlassgericht(suchPlz)
    setzeErgebnis(res)
    if (res.status === 'gefunden') {
      setzeGericht(res.gericht)
    } else {
      setzeGericht(null)
    }
  }

  function handlePlzChange(neuePlz: string) {
    setzePlz(neuePlz)
    const trimmed = neuePlz.trim()
    if (trimmed.length === 5) {
      suche(trimmed)
    } else if (trimmed.length === 0) {
      setzeErgebnis(null)
      setzeGericht(null)
    }
  }

  return (
    <Klapp titel="Zuständige Stelle ermitteln">
      <div className={stile.feld}>
        <label htmlFor="fragebaum-plz">
          Wo war der letzte Wohnort der verstorbenen Person? (Postleitzahl)
        </label>
        {/*
          Eingabe und Knopf stehen nebeneinander: Der Knopf gehoert zu dieser
          einen Eingabe, und eine eigene Zeile darunter liest sich wie ein
          Schritt weiter. Bei grosser Schrift bricht die Zeile um (§7).
        */}
        <div className={stile.sucheZeile}>
          <input
            id="fragebaum-plz"
            className={stile.eingabe}
            inputMode="numeric"
            value={plz}
            onChange={(ereignis) => handlePlzChange(ereignis.target.value)}
            placeholder="z. B. 74199"
            maxLength={5}
          />
          <Button variante="sekundaer" onClick={() => suche(plz)}>
            Gericht suchen
          </Button>
        </div>
      </div>

      {ergebnis?.status === 'gefunden' ? <Gerichtskarte gericht={ergebnis.gericht} /> : null}

      {ergebnis?.status === 'mehrdeutig' ? (
        <div className={stile.gerichtHinweis}>
          <p>{ergebnis.hinweis}</p>
          <a
            className={stile.gerichtLink}
            href={ergebnis.linkUrl}
            target="_blank"
            rel="noreferrer"
          >
            Zuständiges Gericht im Justizportal ermitteln ↗
          </a>
        </div>
      ) : null}

      {ergebnis?.status === 'nicht_gefunden' || ergebnis?.status === 'ungueltig' ? (
        <p className={stile.gerichtHinweis}>{ergebnis.hinweis}</p>
      ) : null}
    </Klapp>
  )
}

/**
 * Die Erläuterung zu einem Begriff der Frage (§5).
 *
 * Sie steht bei der Frage und nicht unter den Antworten: Wer "Nachlassgericht"
 * nicht kennt, braucht die Erklärung, bevor er antwortet, und nicht danach.
 */
function Infoknopf({ thema }: { thema: Infothema }) {
  const info = infoText(thema)

  return (
    <Klapp titel={info.frage}>
      <p className={stile.klappInhalt}>{info.text}</p>
    </Klapp>
  )
}

function Frageseite({
  knoten,
  fall,
  pfad,
  aufgaben,
}: {
  knoten: Fragebaumknoten
  fall: LesbarerFall
  pfad: string[]
  aufgaben: Aufgabendaten
}) {
  const navigate = useNavigate()
  const { fragebaumAufgabe, legeFragebaumAufgabeAn } = aufgaben
  const [plz, setzePlz] = useState('')
  const [gericht, setzeGericht] = useState<Nachlassgericht | null>(null)
  const [fehler, setzeFehler] = useState<string | null>(null)
  const [disclaimerGesehen, setzeDisclaimerGesehen] = useState(false)

  const text = knoten.text.replaceAll('{person}', fall.personName)
  /*
   * Vier Fragen tragen unter der Ueberschrift noch einen Fliesstext mit
   * Aufzaehlung — "Wie erkenne ich ein Testament?" und die Schritte nach einem
   * gefundenen Testament. In der Ueberschrift stuenden die Punkte sonst als ein
   * einziger langer Satz: `.frage` haelt die Umbrueche der Inhaltsdatei nicht.
   */
  const [ueberschrift, rest] = geteilt(text)

  const vorlage = knoten.aufgabe
  const vorhandene = vorlage === undefined ? null : fragebaumAufgabe(vorlage)

  async function aufgabeAnlegen() {
    if (vorlage === undefined) {
      return
    }

    try {
      await legeFragebaumAufgabeAn(
        vorlage,
        notizAus({ plz, gericht }),
        knoten.text.replaceAll('{person}', fall.personName),
      )
    } catch (ursache) {
      setzeFehler(alsNachricht(ursache))
    }
  }

  return (
    <>
      <div className={stile.kopf}>
        <p className={stile.schritt}>Frage {pfad.length}</p>
        {knoten.hinweis === undefined ? null : (
          <p className={stile.hinweisKasten}>{knoten.hinweis}</p>
        )}
        {knoten.info === undefined ? null : <Infoknopf thema={knoten.info} />}
        <h1 className={stile.frage}>{ueberschrift}</h1>
        {rest === '' ? null : <p className={stile.text}>{mitFett(rest)}</p>}
      </div>

      {knoten.gericht === true ? (
        <Gerichtssuche
          plz={plz}
          setzePlz={setzePlz}
          setzeGericht={setzeGericht}
        />
      ) : null}

      {fehler === null ? null : (
        <p className={stile.warnung} role="alert">
          {fehler}
        </p>
      )}

      {vorlage === undefined ? null : (
        <div className={stile.aktionen}>
          {vorhandene === null ? (
            <Button volleBreite onClick={() => void aufgabeAnlegen()}>
              Aufgabe erstellen
            </Button>
          ) : (
            <>
              <p className={stile.hinweis}>
                Sie haben diese Aufgabe bereits angelegt. Sie steht unter „{BAUPLAENE[vorlage].titel}“
                und ist nur für Sie sichtbar.
              </p>
              <Button volleBreite onClick={() => navigate(`/aufgabe/${vorhandene.id}`)}>
                Aufgabe öffnen
              </Button>
            </>
          )}
        </div>
      )}

      <ul className={stile.antworten}>
        {knoten.antworten.map((antwort) => (
          <li key={`${antwort.ziel}-${antwort.text}`}>
            <button
              type="button"
              className={stile.antwort}
              onClick={() =>
                navigate(`/erbe/fragebaum/${antwort.ziel}`, {
                  state: { pfad: [...pfad, antwort.ziel] },
                })
              }
            >
              {antwort.text}
            </button>
          </li>
        ))}
      </ul>

      {knoten.disclaimer !== undefined && !disclaimerGesehen ? (
        <div
          className={stile.overlayHintergrund}
          role="dialog"
          aria-modal="true"
          aria-labelledby="disclaimer-titel"
          aria-describedby="disclaimer-text"
        >
          <div className={stile.overlayKarte}>
            <h2 id="disclaimer-titel" className={stile.overlayTitel}>
              Rechtlicher Hinweis
            </h2>
            <p id="disclaimer-text" className={stile.overlayText}>
              {knoten.disclaimer}
            </p>
            <Button
              volleBreite
              onClick={() => setzeDisclaimerGesehen(true)}
            >
              Verstanden
            </Button>
          </div>
        </div>
      ) : null}
    </>
  )
}

/**
 * Die Wartezeiten zwischen den Versuchen, ein Ergebnis abzulegen — in
 * Millisekunden, ein Eintrag je Wiederholung (ERBE_DESIGN.md §6).
 *
 * Ein Durchlauf, der bis zum Ergebnis gegangen ist, ist die einzige Aussage
 * über den eigenen Erbstatus, die es gibt; sie am ersten Fehlschlag zu
 * verlieren, wäre der schlechteste aller Ausgänge. Der erste Versuch scheitert
 * am ehesten daran, dass gerade noch etwas unterwegs ist — die Geräteanmeldung,
 * der Sitzungstoken, das Netz —, und dagegen hilft nichts als warten und es
 * noch einmal tun.
 *
 * Endlich und nicht endlos: Sechs Versuche über gut sieben Sekunden decken das
 * Warten ab. Was danach noch scheitert, scheitert an etwas, das von selbst
 * nicht vergeht, und dann steht die Meldung auf der Seite, statt dass im
 * Hintergrund weiter jemand klopft.
 */
const WIEDERHOLUNGEN = [200, 500, 1000, 2000, 4000]

function Ergebnisseite({
  knoten,
  fall,
  pfad,
  aufgaben,
}: {
  knoten: Fragebaumknoten
  fall: LesbarerFall
  pfad: string[]
  aufgaben: Aufgabendaten
}) {
  const navigate = useNavigate()
  const {
    fragebaum,
    fragebaumGeladen,
    speichereFragebaum,
    fragebaumAufgabe,
    legeFragebaumAufgabeAn,
    setzeKenntnisAm,
    setzeAnfechtungKenntnisAm,
    fristbezug,
  } = aufgaben

  /*
   * Was gespeichert war, bevor dieser Durchlauf etwas schrieb — festgehalten in
   * dem Moment, in dem es überhaupt etwas auszusagen gibt (§6).
   *
   * Nicht schon beim ersten Rendern: Da ist `K_p` noch unterwegs, jedes private
   * Item unlesbar und `fragebaum` deshalb `null`. Wer daraus auf "noch nichts
   * gespeichert" schlösse, überschriebe genau das Ergebnis, das ein früherer
   * Durchlauf festgehalten hat.
   *
   * `null` heisst "noch nicht nachgesehen", `{ vorher: null }` heisst
   * "nachgesehen, da war nichts".
   */
  const [entschieden, setzeEntschieden] = useState<{ vorher: Fragebaumergebnis | null } | null>(
    null,
  )
  /** Ob dieser Durchlauf sein Ergebnis schon abgelegt hat. */
  const geschrieben = useRef(false)
  /**
   * Der wievielte Versuch gerade dran ist (§6).
   *
   * Er steht im Zustand und nicht in einem Ref, weil genau das den Effekt
   * erneut anstösst: Ein Wiederholungsversuch darf nicht davon abhängen, dass
   * zufällig `speichereFragebaum` seine Identität wechselt, solange die Seite
   * noch offen ist. Tut er es doch, ist das Ergebnis weg, sobald jemand
   * „Zurück zur Übersicht" klickt.
   */
  const [versuch, setzeVersuch] = useState(0)
  const zeitgeber = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [fehler, setzeFehler] = useState<string | null>(null)
  const [plz, setzePlz] = useState('')
  const [gericht, setzeGericht] = useState<Nachlassgericht | null>(null)
  const [anfechtungAm, setzeAnfechtungAm] = useState('')
  const [kenntnis, setzeKenntnis] = useState(fristbezug.kenntnisAm ?? '')
  /*
   * Ein Ergebnis mit mehreren Absaetzen fuehrt seine erste Zeile als
   * Ueberschrift, genau wie eine Frage. Ein einzeiliges Ergebnis ("Sie sind
   * Erbe.") bekommt keine: Ueber ihm stuende eine Ueberschrift ohne Text
   * darunter, und der Badge traegt die Seite dort schon.
   */
  const [ueberschrift, rest] = geteilt(knoten.text.replaceAll('{person}', fall.personName))

  /*
   * Sobald der Bestand steht und `K_p` geklärt ist: einmal nachsehen.
   *
   * Beim Rendern und nicht in einem Effekt — dasselbe Muster, mit dem das
   * Aufgabendetail sein Häkchen nachzieht. Es konvergiert: Der Zustand wechselt
   * genau einmal von "noch nicht nachgesehen" zu einem Wert und danach nie
   * wieder von selbst.
   */
  if (entschieden === null && fragebaumGeladen) {
    setzeEntschieden({ vorher: fragebaum })
  }

  /*
   * Der erste Durchlauf schreibt sich selbst, ein späterer nicht (§6).
   *
   * Losgehen darf es erst, wenn `fragebaumGeladen` steht — also Bestand, `K_p`
   * und Anmeldung. Scheitert es trotzdem, zählt `versuch` hoch und der Effekt
   * läuft von selbst erneut; er wartet nicht darauf, dass `speichereFragebaum`
   * seine Identität wechselt. `geschrieben` sorgt dafür, dass am Ende trotzdem
   * genau einmal geschrieben wird.
   */
  useEffect(() => {
    if (
      entschieden === null ||
      (entschieden.vorher !== null && entschieden.vorher.status !== null) ||
      geschrieben.current
    ) {
      return
    }

    /*
     * Der Riegel fällt *vor* dem `await` und nicht danach.
     *
     * Das Schreiben stösst über die Queue ein neues Rendern an, und damit
     * wechselt `speichereFragebaum` seine Identität — der Effekt liefe ein
     * zweites Mal, während der erste Lauf noch in der Verschlüsselung steht.
     * Das Ergebnis wären zwei Konfigurations-Items derselben Person, von denen
     * eines gewinnt und das andere still danebenliegt; ein danach eingetragenes
     * Kenntnisdatum landete womöglich im unterlegenen (§3.7).
     */
    geschrieben.current = true

    let aktuell = true

    void (async () => {
      try {
        await speichereFragebaum(pfad)

        if (aktuell) {
          setzeFehler(null)
        }
      } catch (ursache) {
        // Zurück auf offen: Der häufigste Grund ist die Geräteanmeldung, die
        // noch läuft, und dann soll der nächste Lauf es erneut versuchen.
        geschrieben.current = false

        if (!aktuell) {
          return
        }

        setzeFehler(alsNachricht(ursache))

        const warten = WIEDERHOLUNGEN[versuch]

        if (warten !== undefined) {
          zeitgeber.current = setTimeout(() => setzeVersuch(versuch + 1), warten)
        }
      }
    })()

    return () => {
      aktuell = false
    }
  }, [entschieden, pfad, speichereFragebaum, versuch])

  /*
   * Der ausstehende Wiederholungsversuch stirbt mit der Seite.
   *
   * Eigener Effekt ohne Abhängigkeiten: Der Zeitgeber überlebt absichtlich
   * jeden erneuten Lauf des Effekts darüber — abgeräumt wird er erst, wenn es
   * niemanden mehr gibt, dem das Ergebnis gehört.
   */
  useEffect(
    () => () => {
      if (zeitgeber.current !== null) {
        clearTimeout(zeitgeber.current)
      }
    },
    [],
  )

  /*
   * Das gespeicherte Ergebnis, aber nur, wenn es ein anderes ist als dieses
   * hier (§6). Wer denselben Weg ein zweites Mal geht, kommt zum selben
   * Schluss, und ein "Ihr gespeichertes Ergebnis bleibt: Erbe" auf der Seite
   * "Sie sind Erbe" wäre eine Warnung vor einem Widerspruch, den es nicht gibt.
   */
  const vorher = entschieden?.vorher ?? null
  const abweichend =
    vorher !== null && vorher.status !== null && vorher.knotenId !== knoten.id ? vorher : null

  const vorlage = knoten.aufgabe
  const vorhandene = vorlage === undefined ? null : fragebaumAufgabe(vorlage)

  async function ersetzen() {
    try {
      await speichereFragebaum(pfad, true)
      geschrieben.current = true
      setzeEntschieden({ vorher: null })
    } catch (ursache) {
      setzeFehler(alsNachricht(ursache))
    }
  }

  async function aufgabeAnlegen() {
    if (vorlage === undefined) {
      return
    }

    try {
      /*
       * Der Ergebnistext wandert mit in die Aufgabe (§7): Genau er stand über
       * dem Knopf, und wer ihn dort gelesen hat, soll ihn in der Aufgabe
       * wiederfinden, statt den Baum noch einmal gehen zu müssen.
       */
      await legeFragebaumAufgabeAn(
        vorlage,
        notizAus({ plz, gericht, anfechtungAm }),
        knoten.text.replaceAll('{person}', fall.personName),
      )

      if (kenntnis !== '' && knoten.kenntnisdatum === true) {
        await setzeKenntnisAm(kenntnis)
      }

      if (anfechtungAm !== '' && knoten.anfechtungsdatum === true) {
        await setzeAnfechtungKenntnisAm(anfechtungAm)
      }
    } catch (ursache) {
      setzeFehler(alsNachricht(ursache))
    }
  }

  return (
    <>
      <div className={stile.kopf}>
        <p className={stile.schritt}>Ergebnis</p>
        {knoten.status === undefined ? null : (
          <div className={stile.statusZeile}>
            <Badge lage="hinweis">{statusText(knoten.status)}</Badge>
          </div>
        )}
        {rest === '' ? null : <h1 className={stile.frage}>{ueberschrift}</h1>}
      </div>

      {knoten.ausschlagungshinweis !== true ? null : (
        <p className={stile.warnung}>
          Hinweis: Wer Gegenstände aus dem Nachlass verkauft, verschenkt oder nutzt, nimmt das
          Erbe automatisch an. Danach kann das Erbe nicht mehr abgelehnt werden.
        </p>
      )}

      <Langtext text={rest === '' ? ueberschrift : rest} />

      {knoten.info === undefined ? null : <Infoknopf thema={knoten.info} />}

      {knoten.gericht === true ? (
        <Gerichtssuche
          plz={plz}
          setzePlz={setzePlz}
          setzeGericht={setzeGericht}
        />
      ) : null}

      {knoten.kenntnisdatum === true ? (
        <div className={stile.feld}>
          <label htmlFor="fragebaum-kenntnis">
            Datum des Fristbeginns (Kenntnis der Erbschaft bzw. Testamentseröffnung)
          </label>
          <input
            id="fragebaum-kenntnis"
            type="date"
            className={stile.eingabe}
            value={kenntnis}
            onChange={(ereignis) => setzeKenntnis(ereignis.target.value)}
          />
          <p className={stile.hinweis}>
            Die Frist beträgt 6 Wochen ab diesem Tag. Ohne dieses Datum kann die Frist nicht
            berechnet werden. Sie können es auch später in der Aufgabe eintragen oder ändern.
          </p>
        </div>
      ) : null}

      {knoten.anfechtungsdatum === true ? (
        <div className={stile.feld}>
          <label htmlFor="fragebaum-anfechtung">Wann haben Sie von diesem Grund erfahren?</label>
          <input
            id="fragebaum-anfechtung"
            type="date"
            className={stile.eingabe}
            value={anfechtungAm}
            onChange={(ereignis) => setzeAnfechtungAm(ereignis.target.value)}
          />
          <p className={stile.hinweis}>
            Die Frist beträgt ein Jahr ab diesem Tag und wird automatisch berechnet. Dieser Tag
            ist ein anderer als Ihre Kenntnis von Anfall und Berufungsgrund. Das Datum wird in
            die Aufgabe übernommen.
          </p>
        </div>
      ) : null}

      {fehler === null ? null : (
        <p className={stile.warnung} role="alert">
          {fehler}
        </p>
      )}

      <div className={stile.aktionen}>
        {vorlage === undefined ? null : vorhandene === null ? (
          <Button volleBreite onClick={() => void aufgabeAnlegen()}>
            Aufgabe erstellen
          </Button>
        ) : (
          <>
            <p className={stile.hinweis}>
              Sie haben diese Aufgabe bereits angelegt. Sie steht unter „{BAUPLAENE[vorlage].titel}“
              und ist nur für Sie sichtbar.
            </p>
            <Button volleBreite onClick={() => navigate(`/aufgabe/${vorhandene.id}`)}>
              Aufgabe öffnen
            </Button>
          </>
        )}

        {/*
          §6: Der erste Durchlauf gilt. Ein zweites Ergebnis still zu verwerfen
          wäre eine App, die es besser weiß; es automatisch zu übernehmen
          wäre eine, in der neugieriges Durchklicken den eigenen Rechtsstand
          umschreibt. Der Knopf sagt beides laut.
        */}
        {abweichend === null ? null : (
          <>
            <p className={stile.hinweis}>
              Ihr gespeichertes Ergebnis bleibt:{' '}
              {abweichend.status === null ? 'ohne Erbstatus' : statusText(abweichend.status)}.
              Dieser Durchlauf ändert daran nichts.
            </p>
            <Button variante="sekundaer" volleBreite onClick={() => void ersetzen()}>
              Gespeichertes Ergebnis ersetzen
            </Button>
          </>
        )}

        <Button variante="sekundaer" volleBreite onClick={() => navigate('/erbe')}>
          Zurück zur Übersicht
        </Button>
      </div>
    </>
  )
}

function Seite({ fall, knotenId }: { fall: LesbarerFall; knotenId: string }) {
  const navigate = useNavigate()
  const location = useLocation()
  const pfad = (location.state as Pfadstatus)?.pfad
  const knoten = knotenMit(knotenId)
  const [abbrechenOffen, setzeAbbrechenOffen] = useState(false)
  const dialogRef = useRef<HTMLDivElement | null>(null)

  /*
   * Der Sync-Stream hängt hier und nicht an der Ergebnisseite (§6).
   *
   * Diese Komponente überlebt den ganzen Durchlauf: Die Fragen wechseln nur
   * den `:knotenId`, und React Router lässt sie dabei stehen. Die
   * Ergebnisseite dagegen entsteht erst mit der letzten Antwort — dort
   * beginnend, müsste sie in dem Moment, in dem das Ergebnis abzulegen ist,
   * erst den Bestand aus der lokalen Ablage lesen und `K_p` vom Server holen.
   * Wer dann sofort auf „Zurück zur Übersicht" tippt, nimmt der Seite den
   * Boden weg, bevor sie schreiben durfte, und der Durchlauf ist verloren,
   * ohne dass irgendwo etwas steht. Von der ersten Frage an mitzulaufen kostet
   * denselben einen Stream und ist bis zur letzten Antwort längst warm.
   */
  const aufgaben = useAufgaben(fall)

  useEffect(() => {
    if (!abbrechenOffen) {
      return
    }

    function onKeyDown(ereignis: KeyboardEvent) {
      if (ereignis.key === 'Escape') {
        setzeAbbrechenOffen(false)
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [abbrechenOffen])

  /*
   * Ohne Pfad im `state` gibt es keinen Durchlauf, zu dem diese Seite gehört:
   * ein geteilter Link, ein Lesezeichen, ein neuer Tab. Dann fängt der Baum von
   * vorn an, statt aus der Mitte heraus so zu tun, als wäre etwas beantwortet.
   */
  if (knoten === null || pfad === undefined || pfad.at(-1) !== knotenId) {
    return <Navigate to="/erbe/fragebaum" replace />
  }

  return (
    <main className={stile.seite}>
      {/*
        Auch auf der ersten Frage: Dort gibt es keine vorige, und dann führt
        der Knopf zurück in den Tab Erbe. Vorher stand auf der ersten Frage
        gar keiner, und der Screen liegt nicht im `Rahmen` -- wer hier landete,
        kam nur mit dem Browser wieder heraus.
      */}
      <div className={stile.navigation}>
        <Zurueck ziel="/erbe" />
        <Button
          variante="text"
          className={stile.abbrechenKnopf}
          onClick={() => setzeAbbrechenOffen(true)}
        >
          Abbrechen
        </Button>
      </div>

      {knoten.art === 'frage' ? (
        <Frageseite knoten={knoten} fall={fall} pfad={pfad} aufgaben={aufgaben} />
      ) : (
        <Ergebnisseite knoten={knoten} fall={fall} pfad={pfad} aufgaben={aufgaben} />
      )}

      {abbrechenOffen ? (
        <div
          className={stile.dialogHintergrund}
          onClick={(ereignis) => {
            if (ereignis.target === ereignis.currentTarget) {
              setzeAbbrechenOffen(false)
            }
          }}
        >
          <div
            ref={dialogRef}
            className={stile.dialog}
            role="dialog"
            aria-modal="true"
            aria-labelledby="abbrechen-dialog-titel"
          >
            <h2 id="abbrechen-dialog-titel" className={stile.dialogTitel}>
              Fragebaum abbrechen?
            </h2>
            <p className={stile.dialogText}>
              Möchten Sie die Befragung wirklich abbrechen? Ihr bisheriger Fortschritt wird nicht
              gespeichert.
            </p>
            <div className={stile.dialogAktionen}>
              <Button volleBreite onClick={() => navigate('/erbe')}>
                Ja, abbrechen
              </Button>
              <Button
                variante="sekundaer"
                volleBreite
                onClick={() => setzeAbbrechenOffen(false)}
              >
                Nein, weiter ausfüllen
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  )
}

export function Fragebaum() {
  const { zustand } = useCase()
  const { knotenId } = useParams()

  if (zustand.status === 'laedt' || zustand.status === 'schluessel-erneuerung') {
    return (
      <main className={stile.seite}>
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
        <p className={stile.warnung} role="alert">
          Der Fall war nicht zu laden: {zustand.nachricht}
        </p>
      </main>
    )
  }

  const fall = zustand.aktiver

  if (fall.zustand === 'gesperrt') {
    return (
      <main className={stile.seite}>
        <p className={stile.warnung} role="alert">
          Dieser Fall ist auf diesem Gerät gesperrt: {fall.grund}
        </p>
      </main>
    )
  }

  /*
   * Der Einstieg. Er ersetzt den Eintrag in der History, statt einen zweiten
   * anzulegen: Sonst führte der Zurück-Knopf von der ersten Frage auf eine
   * Adresse, die sofort wieder auf die erste Frage weiterleitet.
   */
  if (knotenId === undefined) {
    return <Navigate to={`/erbe/fragebaum/${WURZEL}`} replace state={{ pfad: [WURZEL] }} />
  }

  return <Seite fall={fall} knotenId={knotenId} />
}
