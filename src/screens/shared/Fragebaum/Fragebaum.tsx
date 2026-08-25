import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Navigate, useLocation, useNavigate, useParams } from 'react-router-dom'
import { alsNachricht } from '../../../core/fehler.ts'
import { useAnsichtsmodus } from '../../../hooks/useAnsichtsmodus.ts'
import { useAufgaben } from '../../../hooks/useAufgaben.ts'
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
import { Badge } from '../../../ui/Badge/Badge.tsx'
import { Button } from '../../../ui/Button/Button.tsx'
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
        aria-expanded={offen}
        onClick={() => setzeOffen((vorher) => !vorher)}
      >
        {offen ? (offenText ?? titel) : titel}
      </Button>
      {offen ? children : null}
    </div>
  )
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
    return <p className={stile.text}>{text}</p>
  }

  return (
    <>
      <p className={stile.text}>{zeilen[0]}</p>
      <Button variante="text" onClick={() => setzeGanz(true)}>
        Mehr anzeigen
      </Button>
    </>
  )
}

/**
 * Die zuständige Stelle ermitteln (§8).
 *
 * Die Suche ist noch keine und sagt das. Ein Gerichtsname, der für jemanden in
 * Hamburg schlicht falsch ist und unkommentiert dasteht, ist etwas, wonach
 * jemand handelt.
 */
const STELLE = 'Nachlassgericht München'

function Gerichtssuche({
  plz,
  setzePlz,
  stelle,
  setzeStelle,
}: {
  plz: string
  setzePlz: (wert: string) => void
  stelle: string
  setzeStelle: (wert: string) => void
}) {
  return (
    <Klapp titel="Zuständige Stelle ermitteln" offenText="Zuständige Stelle ermitteln (schließen)">
      <div className={stile.feld}>
        <label htmlFor="fragebaum-plz">
          Wo war der letzte Wohnort der verstorbenen Person? (Postleitzahl)
        </label>
        <input
          id="fragebaum-plz"
          className={stile.eingabe}
          inputMode="numeric"
          value={plz}
          onChange={(ereignis) => setzePlz(ereignis.target.value)}
          placeholder="z. B. 80331"
        />
      </div>
      <Button variante="sekundaer" onClick={() => setzeStelle(STELLE)}>
        Gericht suchen
      </Button>
      {stelle === '' ? null : <p className={stile.klappInhalt}>{stelle}</p>}
      <p className={stile.platzhalter}>
        Diese Suche ist noch keine: Sie antwortet immer „{STELLE}“, unabhängig von Ihrer
        Eingabe. Die richtige Stelle finden Sie bis dahin beim Amtsgericht am letzten Wohnort.
        Ihre Eingabe wird trotzdem in die Aufgabe übernommen.
      </p>
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
}: {
  knoten: Fragebaumknoten
  fall: LesbarerFall
  pfad: string[]
}) {
  const navigate = useNavigate()
  const text = knoten.text.replaceAll('{person}', fall.personName)

  return (
    <>
      <div className={stile.kopf}>
        <p className={stile.schritt}>Frage {pfad.length}</p>
        <h1 className={stile.frage}>{text}</h1>
        {knoten.hinweis === undefined ? null : <p className={stile.hinweis}>{knoten.hinweis}</p>}
      </div>

      {knoten.info === undefined ? null : <Infoknopf thema={knoten.info} />}

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
    </>
  )
}

function Ergebnisseite({
  knoten,
  fall,
  pfad,
}: {
  knoten: Fragebaumknoten
  fall: LesbarerFall
  pfad: string[]
}) {
  const navigate = useNavigate()
  const {
    fragebaum,
    fragebaumGeladen,
    speichereFragebaum,
    fragebaumAufgabe,
    legeFragebaumAufgabeAn,
    setzeKenntnisAm,
    fristbezug,
  } = useAufgaben(fall)

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
  const [fehler, setzeFehler] = useState<string | null>(null)
  const [plz, setzePlz] = useState('')
  const [stelle, setzeStelle] = useState('')
  const [anfechtungAm, setzeAnfechtungAm] = useState('')
  const [kenntnis, setzeKenntnis] = useState(fristbezug.kenntnisAm ?? '')

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
   * Der Effekt läuft erneut, wenn `speichereFragebaum` seine Identität wechselt
   * — und das tut es genau dann, wenn die Geräteanmeldung durch ist. Ohne
   * angemeldetes Gerät gibt es keinen `K_p`, und der erste Versuch fällt beim
   * Aufbau der Seite regelmässig in diese Lücke. `geschrieben` sorgt dafür,
   * dass am Ende trotzdem genau einmal geschrieben wird.
   */
  useEffect(() => {
    if (entschieden === null || entschieden.vorher !== null || geschrieben.current) {
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

        if (aktuell) {
          setzeFehler(alsNachricht(ursache))
        }
      }
    })()

    return () => {
      aktuell = false
    }
  }, [entschieden, pfad, speichereFragebaum])

  /*
   * Das gespeicherte Ergebnis, aber nur, wenn es ein anderes ist als dieses
   * hier (§6). Wer denselben Weg ein zweites Mal geht, kommt zum selben
   * Schluss, und ein "Ihr gespeichertes Ergebnis bleibt: Erbe" auf der Seite
   * "Sie sind Erbe" wäre eine Warnung vor einem Widerspruch, den es nicht gibt.
   */
  const vorher = entschieden?.vorher ?? null
  const abweichend = vorher !== null && vorher.knotenId !== knoten.id ? vorher : null

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
      await legeFragebaumAufgabeAn(vorlage, notizAus({ plz, stelle, anfechtungAm }))

      if (kenntnis !== '' && knoten.kenntnisdatum === true) {
        await setzeKenntnisAm(kenntnis)
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
      </div>

      <Langtext text={knoten.text.replaceAll('{person}', fall.personName)} />

      {knoten.info === undefined ? null : <Infoknopf thema={knoten.info} />}

      {knoten.gericht === true ? (
        <Gerichtssuche plz={plz} setzePlz={setzePlz} stelle={stelle} setzeStelle={setzeStelle} />
      ) : null}

      {knoten.kenntnisdatum === true ? (
        <div className={stile.feld}>
          <label htmlFor="fragebaum-kenntnis">
            Wann hat das Nachlassgericht Sie über die Erbschaft informiert?
          </label>
          <input
            id="fragebaum-kenntnis"
            type="date"
            className={stile.eingabe}
            value={kenntnis}
            onChange={(ereignis) => setzeKenntnis(ereignis.target.value)}
          />
          <p className={stile.hinweis}>
            Ohne dieses Datum kann die Frist nicht berechnet werden. Sie können es auch später
            in der Aufgabe eintragen.
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
            Die Frist beträgt ein Jahr ab diesem Tag. Sie wird nicht ausgerechnet: Dieser Tag
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
      {pfad.length > 1 ? (
        <Button variante="text" className={stile.zurueck} onClick={() => navigate(-1)}>
          Zurück
        </Button>
      ) : null}

      {knoten.art === 'frage' ? (
        <Frageseite knoten={knoten} fall={fall} pfad={pfad} />
      ) : (
        <Ergebnisseite knoten={knoten} fall={fall} pfad={pfad} />
      )}
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
