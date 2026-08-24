import { useState, type FormEvent, type ReactNode } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import { alsNachricht } from '../../../core/fehler.ts'
import { useAufgaben } from '../../../hooks/useAufgaben.ts'
import { useCase } from '../../../hooks/useCase.ts'
import type { Aufgabe as Aufgabendatensatz } from '../../../services/aufgabenService.ts'
import { knotenZu, type Aufgabenknoten } from '../../../services/aufgabenbaum.ts'
import type { LesbarerFall } from '../../../services/fallService.ts'
import { datumText, fristlage, fristText, heuteIso, type Fristlage } from '../../../services/fristen.ts'
import { Badge, type Badgelage } from '../../../ui/Badge/Badge.tsx'
import { Button } from '../../../ui/Button/Button.tsx'
import { Card } from '../../../ui/Card/Card.tsx'
import { Checkbox } from '../../../ui/Checkbox/Checkbox.tsx'
import stile from './Aufgabe.module.css'

/**
 * Das ganzseitige Aufgabendetail (DESIGN.md §7, §8).
 *
 * Der Screen, an dem die juristische Arbeit sichtbar wird: Rechtsgrundlage und
 * Quelle, die Frist, die zuständige Stelle, die benötigten Dokumente, Notizen,
 * Unteraufgaben und wovon die Aufgabe abhängt. Alles davon steht im Item selbst
 * — beim Instanziieren aus dem Katalog kopiert (§8) und seither mit der Aufgabe
 * gealtert. Was hier zu lesen ist, ist der Rechtsstand, nach dem jemand
 * gehandelt hat, und nicht der von heute.
 *
 * **Das Fristende steht nirgends gespeichert.** Es wird bei jedem Rendern aus
 * `{fristTage, fristAb}` und dem Sterbedatum gerechnet (§8, `fristen.ts`).
 *
 * **Unteraufgaben sind eigene Zeilen.** Abgehakt wird jede für sich; die
 * Elternaufgabe hat dann kein eigenes Häkchen mehr und gilt genau dann als
 * erledigt, wenn alle Kinder es sind (§7).
 *
 * **Ein Screen statt zweier Bäume.** §7 sieht für `Aufgabe` getrennte Bäume
 * unter `screens/senior` und `screens/advanced` vor. Getrennt wird, sobald die
 * einfache Ansicht wirklich weniger zeigt — das ist der Slice #17, und bis
 * dahin wären zwei Kopien nur zwei Stellen, an denen eine Rechtsgrundlage
 * fehlen kann. Die Dichtetokens tragen den Größenunterschied bereits, und was
 * §7 für die einfache Ansicht ausdrücklich verlangt, steht schon hier: Vor dem
 * Löschen wird gefragt.
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
  if (lage.art !== 'datum') {
    return 'ruhig'
  }

  return lage.restTage < 0 ? 'abgelaufen' : lage.restTage <= 3 ? 'knapp' : 'ruhig'
}

/** Eine Angabe aus dem Katalog — oder nichts, wenn sie leer ist. */
function Angabe({ was: bezeichnung, children }: { was: string; children: ReactNode }) {
  return (
    <div className={stile.angabe}>
      <dt>{bezeichnung}</dt>
      <dd>{children}</dd>
    </div>
  )
}

/**
 * Frist, Rechtsgrundlage, Quelle, zuständige Stelle, Dokumente, Hinweis.
 *
 * Fehlt eine Angabe, steht sie nicht da. Eine leere Zeile „Rechtsgrundlage: —"
 * sähe aus wie eine Lücke im Gesetz, und ein „keine Frist" wäre eine Aussage,
 * die der Katalog nicht trifft: Fehlt eine gesetzliche Frist, bleibt das Feld
 * leer, erfunden wird nichts (§8).
 */
function Rechtliches({ aufgabe, lage }: { aufgabe: Aufgabendatensatz; lage: Fristlage }) {
  const katalog = aufgabe.katalog

  if (katalog === null) {
    return null
  }

  const dokumente = katalog.benoetigteDokumente.filter((eintrag) => eintrag.trim() !== '')

  return (
    <Card className={stile.abschnitt}>
      <h2>Rechtliches</h2>

      <dl className={stile.angaben}>
        {lage.art === 'datum' ? (
          <Angabe was="Frist">
            endet am {datumText(lage.ende)} ({fristText(lage)})
          </Angabe>
        ) : null}

        {lage.art === 'ab-kenntnis' ? (
          <Angabe was="Frist">
            {katalog.fristTage} Tage ab Ihrer Kenntnis. Ihr Kenntnisdatum steht noch nicht fest,
            deshalb rechnet die App hier kein Ende aus.
          </Angabe>
        ) : null}

        {katalog.rechtsgrundlage === '' ? null : (
          <Angabe was="Rechtsgrundlage">{katalog.rechtsgrundlage}</Angabe>
        )}

        {katalog.zustaendigeStelle === '' ? null : (
          <Angabe was="Zuständige Stelle">{katalog.zustaendigeStelle}</Angabe>
        )}

        {dokumente.length === 0 ? null : (
          <Angabe was="Benötigte Dokumente">
            <ul className={stile.punkte}>
              {dokumente.map((dokument) => (
                <li key={dokument}>{dokument}</li>
              ))}
            </ul>
          </Angabe>
        )}

        {katalog.hinweis === '' ? null : <Angabe was="Hinweis">{katalog.hinweis}</Angabe>}

        {katalog.quelleUrl === '' ? null : (
          <Angabe was="Quelle">
            {/*
              `rel="noreferrer"` und ein neues Fenster: Die Quelle ist eine
              fremde Seite, und wer sie öffnet, soll die Aufgabe nicht
              verlieren.
            */}
            <a href={katalog.quelleUrl} target="_blank" rel="noreferrer">
              {katalog.quelleUrl}
            </a>
          </Angabe>
        )}
      </dl>
    </Card>
  )
}

/** Eine Unteraufgabe: abhaken, oder nach Rückfrage löschen. */
function Unteraufgabenzeile({
  unteraufgabe,
  gesperrt,
  aufHaken,
  aufLoeschen,
}: {
  unteraufgabe: Aufgabendatensatz
  gesperrt: boolean
  aufHaken: (erledigt: boolean) => Promise<boolean>
  aufLoeschen: () => void
}) {
  const [fragt, setzeFragt] = useState(false)

  // Dieselbe Überlegung wie in "Alle": Das Häkchen folgt dem Finger und gibt
  // die Führung erst ab, wenn der Bestand nachgezogen hat (§5).
  const [erledigt, setzeErledigt] = useState(unteraufgabe.erledigt)
  const [zuletztGesehen, setzeZuletztGesehen] = useState(unteraufgabe.erledigt)

  if (zuletztGesehen !== unteraufgabe.erledigt) {
    setzeZuletztGesehen(unteraufgabe.erledigt)
    setzeErledigt(unteraufgabe.erledigt)
  }

  async function haken(gewuenscht: boolean) {
    setzeErledigt(gewuenscht)

    if (!(await aufHaken(gewuenscht))) {
      setzeErledigt(unteraufgabe.erledigt)
    }
  }

  if (fragt) {
    return (
      <li className={stile.zeile}>
        <p>„{unteraufgabe.titel}" wirklich löschen? Gelöschte Aufgaben kommen nicht zurück.</p>
        <div className={stile.aktionen}>
          <Button
            onClick={() => {
              setzeFragt(false)
              aufLoeschen()
            }}
            disabled={gesperrt}
          >
            Endgültig löschen
          </Button>
          <Button variante="sekundaer" onClick={() => setzeFragt(false)}>
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
        label={unteraufgabe.titel}
      />
      <div className={stile.aktionen}>
        <Button
          variante="sekundaer"
          onClick={() => setzeFragt(true)}
          vorleseText={`: „${unteraufgabe.titel}"`}
        >
          Löschen
        </Button>
      </div>
    </li>
  )
}

function Detail({
  knoten,
  fall,
  aktionen,
}: {
  knoten: Aufgabenknoten
  fall: LesbarerFall
  aktionen: {
    gesperrt: boolean
    hakeAb: (aufgabe: Aufgabendatensatz, erledigt: boolean) => Promise<boolean>
    schreibeNotizen: (notizen: string) => Promise<boolean>
    legeUnteraufgabeAn: (titel: string) => Promise<boolean>
    loesche: (aufgabe: Aufgabendatensatz) => void
  }
}) {
  const { aufgabe, unteraufgaben, istBlatt, erledigt, blockiertVon } = knoten
  const lage = fristlage(aufgabe.katalog, fall.sterbedatum, heuteIso())
  const badge = fristText(lage)

  const [notizen, setzeNotizen] = useState(aufgabe.notizen)
  const [gespeicherteNotizen, setzeGespeicherteNotizen] = useState(aufgabe.notizen)
  const [neueUnteraufgabe, setzeNeueUnteraufgabe] = useState('')

  // Was der Bestand bringt, gewinnt — aber erst, wenn er sich wirklich
  // geändert hat. Sonst überschriebe jede Türklingel den halb getippten Satz.
  if (gespeicherteNotizen !== aufgabe.notizen) {
    setzeGespeicherteNotizen(aufgabe.notizen)
    setzeNotizen(aufgabe.notizen)
  }

  const [eigenesHaken, setzeEigenesHaken] = useState(aufgabe.erledigt)
  const [zuletztGesehen, setzeZuletztGesehen] = useState(aufgabe.erledigt)

  if (zuletztGesehen !== aufgabe.erledigt) {
    setzeZuletztGesehen(aufgabe.erledigt)
    setzeEigenesHaken(aufgabe.erledigt)
  }

  async function haken(gewuenscht: boolean) {
    setzeEigenesHaken(gewuenscht)

    if (!(await aktionen.hakeAb(aufgabe, gewuenscht))) {
      setzeEigenesHaken(aufgabe.erledigt)
    }
  }

  async function speichereNotizen(ereignis: FormEvent) {
    ereignis.preventDefault()
    await aktionen.schreibeNotizen(notizen)
  }

  async function legeUnteraufgabeAn(ereignis: FormEvent) {
    ereignis.preventDefault()

    if (await aktionen.legeUnteraufgabeAn(neueUnteraufgabe)) {
      setzeNeueUnteraufgabe('')
    }
  }

  const fertigeKinder = unteraufgaben.filter((unter) => unter.erledigt).length

  return (
    <>
      <div className={stile.kopf}>
        <div className={stile.titelzeile}>
          <h1>{aufgabe.titel}</h1>
          {badge === null ? null : <Badge lage={badgelage(lage)}>{badge}</Badge>}
        </div>

        {/*
          §7: Blockierte Aufgaben benennen, worauf sie warten. Die Namen sind
          Links — wer sie liest, will meistens gleich dorthin.
        */}
        {blockiertVon.length === 0 ? null : (
          <p className={stile.hinweis}>
            Zuerst:{' '}
            {blockiertVon.map((offen, stelle) => (
              <span key={offen.id}>
                {stelle === 0 ? null : ', '}
                <Link to={`/aufgabe/${offen.id}`}>{offen.titel}</Link>
              </span>
            ))}
          </p>
        )}

        <p className={stile.hinweis}>
          <Link to="/alle">Zurück zu allen Aufgaben</Link>
        </p>
      </div>

      {aufgabe.beschreibung === '' ? null : (
        <Card className={stile.abschnitt}>
          <p>{aufgabe.beschreibung}</p>
        </Card>
      )}

      <Rechtliches aufgabe={aufgabe} lage={lage} />

      <Card className={stile.abschnitt}>
        <h2>Erledigt?</h2>

        {istBlatt ? (
          <Checkbox
            checked={eigenesHaken}
            disabled={aktionen.gesperrt}
            onChange={(ereignis) => void haken(ereignis.target.checked)}
            label="Diese Aufgabe ist erledigt"
          />
        ) : (
          /*
           * §7: Eine Aufgabe mit Unteraufgaben hat kein eigenes Häkchen. Sie
           * gilt genau dann als erledigt, wenn alle Kinder es sind — und dann
           * zwingend. Fehlt inhaltlich noch etwas, kommt eine Unteraufgabe
           * dazu; das ist ehrlicher als eine Aufgabe, die trotz erledigter
           * Kinder offen aussieht.
           */
          <p role="status">
            {erledigt
              ? `Erledigt: alle ${unteraufgaben.length} Unteraufgaben sind abgehakt.`
              : `Offen: ${fertigeKinder} von ${unteraufgaben.length} Unteraufgaben erledigt.`}
          </p>
        )}
      </Card>

      <Card className={stile.abschnitt}>
        <h2>Unteraufgaben</h2>

        {unteraufgaben.length === 0 ? (
          <p className={stile.hinweis}>Noch keine. Eine Unteraufgabe teilt die Arbeit auf.</p>
        ) : (
          <ul className={stile.liste}>
            {unteraufgaben.map((unteraufgabe) => (
              <Unteraufgabenzeile
                key={unteraufgabe.id}
                unteraufgabe={unteraufgabe}
                gesperrt={aktionen.gesperrt}
                aufHaken={(gewuenscht) => aktionen.hakeAb(unteraufgabe, gewuenscht)}
                aufLoeschen={() => aktionen.loesche(unteraufgabe)}
              />
            ))}
          </ul>
        )}

        {/*
          Eine Ebene, keine Verschachtelung (§7): Unter einer Unteraufgabe gibt
          es nichts mehr anzulegen.
        */}
        {aufgabe.parentId === null ? (
          <form className={stile.formular} onSubmit={(ereignis) => void legeUnteraufgabeAn(ereignis)}>
            <div className={stile.feld}>
              <label htmlFor="neue-unteraufgabe">Neue Unteraufgabe</label>
              <input
                id="neue-unteraufgabe"
                className={stile.eingabe}
                value={neueUnteraufgabe}
                onChange={(ereignis) => setzeNeueUnteraufgabe(ereignis.target.value)}
                required
              />
            </div>

            <Button
              type="submit"
              volleBreite
              disabled={aktionen.gesperrt || neueUnteraufgabe.trim() === ''}
            >
              Unteraufgabe hinzufügen
            </Button>
          </form>
        ) : (
          <p className={stile.hinweis}>
            Diese Aufgabe ist selbst eine Unteraufgabe. Tiefer gliedert die App nicht.
          </p>
        )}
      </Card>

      <Card className={stile.abschnitt}>
        <h2>Notizen</h2>

        <form className={stile.formular} onSubmit={(ereignis) => void speichereNotizen(ereignis)}>
          <div className={stile.feld}>
            <label htmlFor="notizen">Ihre Notizen zu dieser Aufgabe</label>
            <textarea
              id="notizen"
              className={stile.eingabe}
              rows={4}
              value={notizen}
              onChange={(ereignis) => setzeNotizen(ereignis.target.value)}
            />
          </div>

          <Button type="submit" volleBreite disabled={aktionen.gesperrt || notizen === aufgabe.notizen}>
            Notizen speichern
          </Button>
        </form>
      </Card>
    </>
  )
}

function Aufgabenbereich({ fall, id }: { fall: LesbarerFall; id: string }) {
  const { zustand, schreibe, hakeAb, legeAn, loesche } = useAufgaben(fall)

  const [laeuft, setzeLaeuft] = useState(false)
  const [fehler, setzeFehler] = useState<string | null>(null)

  /** §5: Was hier ankommt, steht danach als Meldung auf dem Bildschirm. */
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

  if (zustand.status === 'laedt') {
    return <Ladeanzeige text="Ihre Aufgaben werden geladen…" />
  }

  const knoten = knotenZu(zustand.aufgaben, id)

  if (knoten === null) {
    /*
     * Ein leerer Cache und ein laufender erster Abruf sind nicht dasselbe wie
     * eine gelöschte Aufgabe (§5). Erst wenn der Abruf durch ist, darf hier
     * „gibt es nicht mehr" stehen.
     */
    return zustand.laedtNetz ? (
      <Ladeanzeige text="Ihre Aufgaben werden geladen…" />
    ) : (
      <>
        <p className={stile.hinweis} role="alert">
          Diese Aufgabe gibt es nicht mehr. Gelöschte Aufgaben kommen nicht zurück.
        </p>
        <p className={stile.hinweis}>
          <Link to="/alle">Zurück zu allen Aufgaben</Link>
        </p>
      </>
    )
  }

  return (
    <>
      {fehler === null ? null : (
        <p className={stile.hinweis} role="alert">
          {fehler}
        </p>
      )}

      {zustand.netzfehler === null ? null : (
        <p className={stile.hinweis} role="alert">
          Ihre Aufgaben sind gerade nicht abrufbar. {zustand.netzfehler}
        </p>
      )}

      {/*
        `key`: Der Screen bleibt beim Wechsel von einer Aufgabe zur nächsten —
        über einen „Zuerst: …"-Link — an derselben Stelle im Baum, und React
        behielte sonst den Zustand des Formulars. Ein angefangener, noch nicht
        gespeicherter Notizentwurf stünde dann im Feld der anderen Aufgabe und
        landete beim nächsten „Notizen speichern" an der falschen Zeile.
      */}
      <Detail
        key={knoten.aufgabe.id}
        knoten={knoten}
        fall={fall}
        aktionen={{
          gesperrt: laeuft,
          hakeAb: (aufgabe, erledigt) => fuehreAus(() => hakeAb(aufgabe, erledigt)),
          schreibeNotizen: (notizen) => fuehreAus(() => schreibe(knoten.aufgabe, { notizen })),
          legeUnteraufgabeAn: (titel) => fuehreAus(() => legeAn(titel, knoten.aufgabe.id)),
          loesche: (aufgabe) => void fuehreAus(() => loesche(aufgabe)),
        }}
      />
    </>
  )
}

export function Aufgabe() {
  const { id } = useParams()
  const { zustand } = useCase()

  if (zustand.status === 'laedt') {
    return (
      <main className={stile.seite}>
        <Ladeanzeige text="Ihre Daten werden geladen…" />
      </main>
    )
  }

  // Ohne Fall ist die App gesperrt (§7), und ohne ID gibt es nichts zu zeigen.
  if (zustand.status === 'kein-fall' || id === undefined) {
    return <Navigate to="/" replace />
  }

  return (
    <main className={stile.seite}>
      {zustand.status === 'fehler' ? (
        <p className={stile.hinweis} role="alert">
          Ihre Aufgaben sind gerade nicht abrufbar. {zustand.nachricht}
        </p>
      ) : zustand.aktiver.zustand === 'gesperrt' ? (
        <p className={stile.hinweis} role="alert">
          Dieser Fall ist auf diesem Gerät gesperrt. {zustand.aktiver.grund}
        </p>
      ) : (
        <Aufgabenbereich fall={zustand.aktiver} id={id} />
      )}
    </main>
  )
}
