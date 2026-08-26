import { useEffect, useState, type FormEvent } from 'react'
import { Navigate, useSearchParams } from 'react-router-dom'
import { alsNachricht } from '../../../core/fehler.ts'
import { useAufgaben } from '../../../hooks/useAufgaben.ts'
import { useCase } from '../../../hooks/useCase.ts'
import type { Erinnerungsdaten } from '../../../hooks/useErinnerungen.ts'
import type { Aufgabenknoten } from '../../../services/aufgabenbaum.ts'
import type { LesbarerFall } from '../../../services/fallService.ts'
import { fristlage, heuteIso } from '../../../services/fristen.ts'
import {
  darfAbhaken,
  darfBearbeiten,
  istFrei,
  zuweisungText,
} from '../../../services/zuweisung.ts'
import { Button } from '../../../ui/Button/Button.tsx'
import { Checkbox } from '../../../ui/Checkbox/Checkbox.tsx'
import { Klapp } from '../../../ui/Klapp/Klapp.tsx'
import { fallLadeText } from '../../shared/Ladeanzeige/FallLadeanzeige.tsx'
import { Abgelehnt, Uebernahmen } from '../../shared/Meldungen/Meldungen.tsx'
import { Aufgabenzeile, erledigtSchalter } from '../Bausteine.tsx'
import stile from '../einfach.module.css'

/**
 * Der Tab "Alle" in der einfachen Ansicht (DESIGN.md §7).
 *
 * Dieselben Aufgaben wie drüben, in derselben Reihenfolge — der der
 * Juristinnen (§8). Was fehlt, fehlt mit Absicht:
 *
 * - **Kein Sortierfeld.** Die empfohlene Reihenfolge beginnt mit dem, was in
 *   den ersten Tagen ansteht; ein zweites Ranking daneben ist eine Frage, die
 *   niemand stellt, während eine Frist läuft.
 * - **Keine Zeilenaktionen.** Ändern, Löschen, Übernehmen und Freigeben stehen
 *   in der Aufgabe selbst. In einer Liste wären es vier Wörter unter jedem
 *   Titel, von denen eines löscht.
 * - **Ein Formular, das man aufmacht.** Solange niemand etwas hinzufügen will,
 *   steht dort eine Schaltfläche mit einem Verb und kein Feld.
 *
 * Private Aufgaben gibt es hier wie drüben (§3.7): "Der Anlass, eine
 * Erbausschlagung zu erwägen, ohne dass die Geschwister es erfahren, trifft die
 * 78-jährige Witwe mindestens so hart wie den 40-jährigen Sohn. Und sie ist die
 * Person, die in der einfachen Ansicht sitzt." Sie entstehen über den Schalter
 * "Nur für mich"; freigegeben werden sie in der Aufgabe, mit genau einer
 * Aktion.
 */

function Ladeanzeige({ text }: { text: string }) {
  return (
    <p className={stile.hinweis} role="status">
      {text}
    </p>
  )
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
      <div className={stile.frage}>
        <p>Sollen wir Sie an die Fristen erinnern?</p>
        <Button volleBreite variante="sekundaer" onClick={() => void erinnerungen.frage()}>
          Ja, erinnern Sie mich
        </Button>
      </div>
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

/**
 * Das Formular zum Anlegen, hinter einer Schaltfläche (§7).
 *
 * Zu ist der Normalzustand: Wer diesen Screen öffnet, will fast immer sehen,
 * was zu tun ist, und nicht etwas hinzufügen.
 */
function NeueAufgabe({
  gesperrt,
  aufAnlegen,
  anfangsOffen = false,
}: {
  gesperrt: boolean
  /** `false`, wenn nichts gespeichert wurde. Das Formular bleibt dann offen. */
  aufAnlegen: (titel: string, nurFuerMich: boolean) => Promise<boolean>
  /** Formular beim ersten Rendern schon öffnen (z.B. von `?neu=1`). */
  anfangsOffen?: boolean
}) {
  const [offen, setzeOffen] = useState(anfangsOffen)
  const [titel, setzeTitel] = useState('')
  const [nurFuerMich, setzeNurFuerMich] = useState(false)

  function schliesse() {
    setzeOffen(false)
    setzeTitel('')
    /*
     * §3.7: Der Schalter fällt mit zurück. Er ist eine Angabe zu dieser einen
     * Aufgabe und keine Einstellung: Bliebe er stehen, wäre die nächste
     * Aufgabe unbemerkt ebenfalls privat, und niemand sähe sie.
     */
    setzeNurFuerMich(false)
  }

  async function anlegen(ereignis: FormEvent) {
    ereignis.preventDefault()

    if (await aufAnlegen(titel, nurFuerMich)) {
      schliesse()
    }
  }

  if (!offen) {
    return (
      <Button volleBreite onClick={() => setzeOffen(true)}>
        Aufgabe hinzufügen
      </Button>
    )
  }

  return (
    <form className={stile.formular} onSubmit={(ereignis) => void anlegen(ereignis)}>
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

      {/*
        §7: "ein Schalter 'Nur für mich' auf der Aufgabe". Er steht beim Anlegen
        und nicht danach: Umgekehrt ginge es nicht, denn eine geteilte Aufgabe
        nachträglich privat zu machen hiesse, sie den anderen wieder
        wegzunehmen, und gesehen haben sie sie längst (§5).
      */}
      <Checkbox
        checked={nurFuerMich}
        onChange={(ereignis) => setzeNurFuerMich(ereignis.target.checked)}
        label="Nur für mich"
      />

      <p className={stile.hinweis}>
        {nurFuerMich
          ? 'Diese Aufgabe sehen nur Sie. Sie können sie später für alle sichtbar machen.'
          : 'Diese Aufgabe sehen alle Angehörigen in diesem Fall.'}
      </p>

      <div className={stile.knoepfe}>
        {/*
          `required` allein liesse einen Titel aus lauter Leerzeichen durch;
          der Dienst weist ihn dann ab, und die Meldung landet weit weg von
          diesem Feld. Was nicht gespeichert werden kann, lässt sich hier gar
          nicht erst abschicken.
        */}
        <Button type="submit" volleBreite disabled={gesperrt || titel.trim() === ''}>
          Aufgabe speichern
        </Button>
        <Button volleBreite variante="sekundaer" onClick={schliesse}>
          Abbrechen
        </Button>
      </div>
    </form>
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

  const [laeuft, setzeLaeuft] = useState(false)
  const [fehler, setzeFehler] = useState<string | null>(null)

  /**
   * §5: Abgelehnte Änderungen werden nie stillschweigend verworfen. Deshalb
   * läuft jede Mutation durch diese eine Stelle, und was hier ankommt, steht
   * danach als Meldung auf dem Bildschirm.
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
    const darfAendern = darfBearbeiten(knoten.aufgabe.assignee, ich.userId)

    return (
      <Aufgabenzeile
        key={knoten.aufgabe.id}
        knoten={knoten}
        lage={fristlage(knoten.aufgabe.katalog, fristbezug, heute, knoten.aufgabe.fristAm)}
        gesperrt={laeuft}
        darfHaken={darfAbhaken(knoten.aufgabe.assignee, ich.userId)}
        /*
         * §7: "Bearbeiten darf nur, wem sie zugewiesen ist." Steht
         * jemand anders darunter oder niemand, sagt die Zeile das,
         * statt ein graues Kästchen ohne Grund zu zeigen.
         */
        zustaendig={
          darfAendern
            ? null
            : istFrei(knoten.aufgabe.assignee)
              ? 'Dafür ist noch niemand eingetragen. Öffnen Sie die Aufgabe, um sie zu übernehmen.'
              : `Zuständig: ${zuweisungText(knoten.aufgabe.assignee, ich.userId)}`
        }
        aufHaken={(erledigt) => fuehreAus(() => hakeAb(knoten.aufgabe, erledigt))}
      />
    )
  }

  /*
   * Der Query-Parameter `?neu=1` öffnet das Anlege-Formular beim Laden der
   * Seite — so springt der Nachlass-Screen hierher und öffnet das Formular
   * in einem Schritt. Der Parameter wird sofort aus der URL entfernt.
   */
  const [suchParams, setzeSuchParams] = useSearchParams()
  const [anfangsOffen] = useState(() => suchParams.get('neu') === '1')

  useEffect(() => {
    if (suchParams.has('neu')) {
      suchParams.delete('neu')
      setzeSuchParams(suchParams, { replace: true })
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <NeueAufgabe
        gesperrt={laeuft}
        aufAnlegen={(titel, nurFuerMich) => fuehreAus(() => legeAn(titel, null, nurFuerMich))}
        anfangsOffen={anfangsOffen}
      />

      {fehler === null ? null : (
        <p className={stile.warnung} role="alert">
          {fehler}
        </p>
      )}

      {uebernahmen.length === 0 ? null : (
        <Uebernahmen
          form="flach"
          uebernahmen={uebernahmen}
          aufBestaetigen={bestaetigeUebernahmen}
        />
      )}

      {abgelehnt.length === 0 ? null : (
        <Abgelehnt form="flach" aenderungen={abgelehnt} aufBestaetigen={bestaetige} />
      )}

      {/*
        §5: "Die Ladeanzeige bezieht sich auf den Netzwerk-Fetch, nicht auf das
        Entschlüsseln." Sie steht deshalb, solange es nichts zu zeigen gibt:
        erst bis der Cache gelesen ist, danach so lange der erste Abruf läuft.
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
            <p className={stile.warnung} role="alert">
              Ihre Aufgaben sind gerade nicht abrufbar. {zustand.netzfehler}
            </p>
          )}

          <Erinnerungshinweis erinnerungen={erinnerungen} />

          {zustand.baum.length === 0 ? (
            // Ein leerer Cache und ein laufender erster Abruf sind nicht
            // dasselbe wie ein leerer Fall (§5).
            zustand.laedtNetz ? (
              <Ladeanzeige text="Ihre Aufgaben werden geladen…" />
            ) : (
              <p className={stile.hinweis}>
                Hier ist noch nichts. Über „Aufgabe hinzufügen“ tragen Sie ein, was zu tun ist.
              </p>
            )
          ) : (
            // §7: Erledigte Aufgaben stehen am Ende der Liste und zu Anfang
            // eingeklappt — nicht weg, nur nicht im Weg.
            (() => {
              const offene = zustand.baum.filter((knoten) => !knoten.erledigt)
              const erledigte = zustand.baum.filter((knoten) => knoten.erledigt)

              return (
                <>
                  {offene.length === 0 ? null : (
                    <ul className={stile.liste}>{offene.map((knoten) => zeile(knoten))}</ul>
                  )}

                  {erledigte.length === 0 ? null : (
                    <Klapp {...erledigtSchalter(erledigte.length)}>
                      <ul className={stile.liste}>{erledigte.map((knoten) => zeile(knoten))}</ul>
                    </Klapp>
                  )}
                </>
              )
            })()
          )}
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
        <p className={stile.warnung} role="alert">
          Ihre Aufgaben sind gerade nicht abrufbar. {zustand.nachricht}
        </p>
      ) : zustand.aktiver.zustand === 'gesperrt' ? (
        <p className={stile.warnung} role="alert">
          Dieser Fall ist auf diesem Gerät gesperrt. {zustand.aktiver.grund}
        </p>
      ) : (
        <Aufgabenbereich fall={zustand.aktiver} />
      )}
    </main>
  )
}
