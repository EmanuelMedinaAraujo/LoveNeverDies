import { useState, type FormEvent, type ReactNode } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'
import type { InhaltZeile } from '../../../core/db/inhalte.ts'
import { alsNachricht } from '../../../core/fehler.ts'
import { useAufgaben } from '../../../hooks/useAufgaben.ts'
import { useCase } from '../../../hooks/useCase.ts'
import { useMitglieder } from '../../../hooks/useMitglieder.ts'
import type { Aufgabe as Aufgabendatensatz } from '../../../services/aufgabenService.ts'
import { knotenZu, type Aufgabenknoten } from '../../../services/aufgabenbaum.ts'
import type { LesbarerFall } from '../../../services/fallService.ts'
import {
  datumText,
  fristlage,
  fristText,
  heuteIso,
  type Fristbezug,
  type Fristlage,
} from '../../../services/fristen.ts'
import { istSeedAufgabe } from '../../../services/fragebaumService.ts'
import { Badge, type Badgelage } from '../../../ui/Badge/Badge.tsx'
import { Button } from '../../../ui/Button/Button.tsx'
import { Card } from '../../../ui/Card/Card.tsx'
import { Gruppe } from '../../../ui/Liste/Liste.tsx'
import { Checkbox } from '../../../ui/Checkbox/Checkbox.tsx'
import {
  benenne,
  darfBearbeiten,
  type Zugewiesene,
  type Zuweisung,
} from '../../../services/zuweisung.ts'
import { Uebernahmen } from '../../shared/Meldungen/Meldungen.tsx'
import { Dokumente } from '../../shared/Dokumente/Dokumente.tsx'
import { fallLadeText } from '../../shared/Ladeanzeige/FallLadeanzeige.tsx'
import { Zuweisungsfeld } from '../../shared/Zuweisung/Zuweisungsfeld.tsx'
import stile from './Aufgabe.module.css'

/**
 * Das ganzseitige Aufgabendetail (DESIGN.md §7, §8).
 *
 * Der Screen, an dem die juristische Arbeit sichtbar wird: Rechtsgrundlage und
 * Quelle, die Frist, die zuständige Stelle, die benötigten Dokumente, Notizen,
 * Unteraufgaben und wovon die Aufgabe abhängt. Alles davon steht im Item selbst,
 * beim Instanziieren aus dem Katalog kopiert (§8) und seither mit der Aufgabe
 * gealtert. Was hier zu lesen ist, ist der Rechtsstand, nach dem jemand
 * gehandelt hat, und nicht der von heute.
 *
 * Das Fristende steht nirgends gespeichert: Es wird bei jedem Rendern aus
 * `{fristTage, fristAb}` und dem Sterbedatum gerechnet (§8, `fristen.ts`).
 *
 * Unteraufgaben sind eigene Zeilen. Abgehakt wird jede für sich; die
 * Elternaufgabe hat dann kein eigenes Häkchen mehr und gilt genau dann als
 * erledigt, wenn alle Kinder es sind (§7).
 *
 * Die erweiterte Fassung dieses Screens (§7). Die einfache steht daneben in
 * `screens/einfach/Aufgabe`; sie zeigt dieselbe Aufgabe mit weniger darauf —
 * ohne Quelle, ohne Namensliste in der Zuweisung und ohne den Weg von jeder
 * Unteraufgabe in ihr eigenes Detail, denn genau das ist die verschachtelte
 * Navigation, auf die §7 dort verzichtet. Die Dokumente teilen sich beide
 * (`screens/shared/Dokumente`): Ein Foto wird vor dem Hochladen verschlüsselt,
 * und eine zweite Stelle, die das tun muss, vergisst es irgendwann.
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

/** Eine Angabe aus dem Katalog, oder nichts, wenn sie leer ist. */
function Angabe({ was: bezeichnung, children }: { was: string; children: ReactNode }) {
  return (
    <div className={stile.angabe}>
      <dt>{bezeichnung}</dt>
      <dd>{children}</dd>
    </div>
  )
}

/**
 * Der Weg in den Erbe-Fragebaum (ERBE_DESIGN.md §9).
 *
 * Er steht hier im Screen und nicht im Payload der Aufgabe: Der Fragebaum ist
 * eine Sache dieser App und keine Angabe der Juristinnen, und eine URL im
 * verschlüsselten Payload wäre ein Link, der beim nächsten Umbau der Routen
 * ins Leere zeigt, ohne dass jemand ihn findet.
 */
function ZumFragebaum() {
  const navigate = useNavigate()

  return (
    <Button volleBreite onClick={() => navigate('/erbe/fragebaum')}>
      Fragebaum starten
    </Button>
  )
}

/**
 * Frist, Rechtsgrundlage, Quelle, zuständige Stelle, Dokumente, Hinweis.
 *
 * Fehlt eine Angabe, steht sie nicht da. Eine leere Zeile "Rechtsgrundlage: -"
 * sähe aus wie eine Lücke im Gesetz, und ein "keine Frist" wäre eine Aussage,
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
    <Gruppe titel="Rechtliches">
      <Card>

      <dl className={stile.angaben}>
        {lage.art === 'datum' ? (
          <Angabe was="Frist">
            endet am {datumText(lage.ende)} ({fristText(lage)})
          </Angabe>
        ) : null}

        {lage.art === 'ab-kenntnis' ? (
          /*
            §8: Ohne Kenntnisdatum wird kein Ende gerechnet und keines
            geschätzt. Der Satz benennt den Grund, statt eine leere Angabe
            stehen zu lassen: Die Frist hängt an einem Tag, den nur diese
            Person kennt.
          */
          <Angabe was="Frist">
            Diese Frist läuft ab <em>Ihrer</em> Kenntnis: {katalog.fristTage} Tage ab dem Tag, an
            dem Sie von Anfall und Berufungsgrund erfahren haben. Tragen Sie ihn unten ein, dann
            rechnet die App das Ende aus.
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
    </Gruppe>
  )
}

/** Eine Unteraufgabe: abhaken, oder nach Rückfrage löschen. */
function Unteraufgabenzeile({
  unteraufgabe,
  gesperrt,
  ichUserId,
  aufHaken,
  aufLoeschen,
}: {
  unteraufgabe: Aufgabendatensatz
  gesperrt: boolean
  /** Die angemeldete Person. Eine Unteraufgabe hat ihre eigene Zuweisung (§7). */
  ichUserId: string
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
        <p>"{unteraufgabe.titel}" wirklich löschen? Gelöschte Aufgaben kommen nicht zurück.</p>
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

  /*
   * Eine Unteraufgabe ist eine Zeile wie jede andere (§7) und trägt deshalb
   * ihre eigene Zuweisung. Eine Familie teilt sich eine Aufgabe auf: Die Bank
   * ruft der eine an, zum Standesamt geht die andere, und wer nicht
   * eingetragen ist, hakt hier nichts ab.
   */
  const darfAendern = darfBearbeiten(unteraufgabe.assignee, ichUserId)

  return (
    <li className={stile.zeile}>
      <Checkbox
        checked={erledigt}
        disabled={gesperrt || !darfAendern}
        onChange={(ereignis) => void haken(ereignis.target.checked)}
        label={unteraufgabe.titel}
      />
      <div className={stile.aktionen}>
        <Link className={stile.hinweis} to={`/aufgabe/${unteraufgabe.id}`}>
          Zuständigkeit ändern
          <span className="nur-vorlesen">: „{unteraufgabe.titel}"</span>
        </Link>
        {darfAendern ? (
          <Button
            variante="sekundaer"
            onClick={() => setzeFragt(true)}
            vorleseText={`: „${unteraufgabe.titel}"`}
          >
            Löschen
          </Button>
        ) : null}
      </div>
    </li>
  )
}

/**
 * Das eigene Kenntnisdatum (DESIGN.md §8, #12).
 *
 * Die Ausschlagungsfrist nach § 1944 BGB knüpft an die Kenntnis des jeweiligen
 * Erben von Anfall und Berufungsgrund an: Ein Sohn, der am Sterbetag anwesend
 * war, und ein Bruder, der drei Wochen später vom Notar erfährt, haben
 * verschiedene Fristenden. Das Datum liegt deshalb privat unter `K_p` (§3.7)
 * und wird von jeder Person selbst eingetragen.
 *
 * Ohne Bearbeitungssperre, anders als alles andere auf diesem Screen: Die
 * Zuweisung regelt, wer die *Aufgabe* ändern darf (§7). Hier ändert niemand
 * die Aufgabe. Wer sein eigenes Kenntnisdatum erst eintragen dürfte, nachdem
 * er eine Aufgabe übernommen hat, sähe seine eigene gesetzliche Frist nicht.
 */
function Kenntnisdatum({
  fristTage,
  kenntnisAm,
  lage,
  gesperrt,
  aufSpeichern,
}: {
  fristTage: number | null
  /** Das eingetragene Datum, oder `null`. */
  kenntnisAm: string | null
  /** Die Lage dieser Aufgabe, damit das gerechnete Ende danebensteht. */
  lage: Fristlage
  gesperrt: boolean
  aufSpeichern: (datum: string | null) => Promise<boolean>
}) {
  const [eingabe, setzeEingabe] = useState(kenntnisAm ?? '')
  const [gespeichert, setzeGespeichert] = useState(kenntnisAm)

  // Was der Bestand bringt, gewinnt, aber erst, wenn er sich wirklich geändert
  // hat: dieselbe Überlegung wie bei den Notizen.
  if (gespeichert !== kenntnisAm) {
    setzeGespeichert(kenntnisAm)
    setzeEingabe(kenntnisAm ?? '')
  }

  async function speichere(ereignis: FormEvent) {
    ereignis.preventDefault()
    await aufSpeichern(eingabe === '' ? null : eingabe)
  }

  return (
    <Gruppe titel="Ihr Kenntnisdatum">
      <Card>

      <p>
        An welchem Tag haben Sie erfahren, dass Sie Erbe sind? Ab diesem Tag laufen
        {fristTage === null ? ' die' : ` die ${fristTage}`} Tage dieser Frist. Das Datum sehen nur
        Sie: Jedes Mitglied trägt sein eigenes ein, und dieselbe Aufgabe hat deshalb für jeden ein
        anderes Ende.
      </p>

      {lage.art === 'datum' ? (
        <p role="status">
          Ihre Frist endet am {datumText(lage.ende)} ({fristText(lage)}).
        </p>
      ) : null}

      <form className={stile.formular} onSubmit={(ereignis) => void speichere(ereignis)}>
        <div className={stile.feld}>
          <label htmlFor="kenntnis-am">Tag Ihrer Kenntnis</label>
          {/*
            `max`: Ein Kenntnisdatum in der Zukunft gibt es nicht, und ein
            vertipptes Jahr ergäbe eine Frist, die viel später endet als die
            wirkliche. Der Dienst weist es ausserdem ab (§8); dieses Attribut
            ist die freundlichere von beiden Sperren.
          */}
          <input
            id="kenntnis-am"
            type="date"
            className={stile.eingabe}
            value={eingabe}
            max={heuteIso()}
            onChange={(ereignis) => setzeEingabe(ereignis.target.value)}
          />
        </div>

        <Button type="submit" volleBreite disabled={gesperrt || eingabe === (kenntnisAm ?? '')}>
          Kenntnisdatum speichern
        </Button>
      </form>

      {kenntnisAm === null ? null : (
        <Button
          variante="sekundaer"
          disabled={gesperrt}
          onClick={() => void aufSpeichern(null)}
        >
          Datum entfernen
        </Button>
      )}
      </Card>
    </Gruppe>
  )
}

function Detail({
  knoten,
  fall,
  fristbezug,
  ich,
  mitglieder,
  mitgliederfehler,
  zeilen,
  aktualisiere,
  aktionen,
}: {
  knoten: Aufgabenknoten
  fall: LesbarerFall
  /** Sterbedatum und eigenes Kenntnisdatum: woran die Fristen hängen (§8). */
  fristbezug: Fristbezug
  /** Die angemeldete Person, so wie sie in eine Zuweisung geschrieben wird (§7). */
  ich: Zugewiesene
  /** Die Mitglieder des Falls, benannt so gut es geht. */
  mitglieder: Zugewiesene[]
  /** Was beim Abruf der Mitglieder schiefging, oder `null`. */
  mitgliederfehler: string | null
  /** Der Bestand als Ciphertext; die Dokumente lesen daraus ihre Zeilen (§7). */
  zeilen: InhaltZeile[]
  /** Stösst eine Sync-Runde an: Dokumente gehen nicht durch die Queue (§5). */
  aktualisiere: () => void
  aktionen: {
    gesperrt: boolean
    hakeAb: (aufgabe: Aufgabendatensatz, erledigt: boolean) => Promise<boolean>
    schreibeNotizen: (notizen: string) => Promise<boolean>
    legeUnteraufgabeAn: (titel: string) => Promise<boolean>
    loesche: (aufgabe: Aufgabendatensatz) => void
    weiseZu: (zuweisung: Zuweisung) => void
    /** Wrappt den DEK von `K_p` auf `K_c` (§3.7). */
    gibFuerAlleFrei: () => void
    /** Legt das eigene Kenntnisdatum ab oder ändert es (§8, #12). */
    speichereKenntnisAm: (datum: string | null) => Promise<boolean>
  }
}) {
  const { aufgabe, unteraufgaben, istBlatt, erledigt, blockiertVon } = knoten
  const lage = fristlage(aufgabe.katalog, fristbezug, heuteIso())
  const badge = fristText(lage)

  const [notizen, setzeNotizen] = useState(aufgabe.notizen)
  const [gespeicherteNotizen, setzeGespeicherteNotizen] = useState(aufgabe.notizen)
  const [neueUnteraufgabe, setzeNeueUnteraufgabe] = useState('')
  const [fragtFreigabe, setzeFragtFreigabe] = useState(false)

  // Was der Bestand bringt, gewinnt, aber erst, wenn er sich wirklich
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

  /*
   * §7: "Bearbeiten darf nur, wem sie zugewiesen ist." Gesperrt sind das
   * Häkchen, die Notizen, neue Unteraufgaben und das Löschen, nicht das Lesen
   * und nicht die Zuweisung selbst. Wer nicht eingetragen ist, soll die
   * Rechtsgrundlage sehen und sich eintragen können; alles andere wäre eine
   * Mauer vor einer Aufgabe, die vielleicht gerade dringend ist.
   */
  const darfAendern = darfBearbeiten(aufgabe.assignee, ich.userId)

  return (
    <>
      <div className={stile.kopf}>
        <div className={stile.titelzeile}>
          <h1>{aufgabe.titel}</h1>
          {/* §3.7: Wer die Aufgabe öffnet, soll sofort sehen, wer sie sonst noch sieht. */}
          {aufgabe.privat ? <Badge lage="hinweis">Nur für mich</Badge> : null}
          {badge === null ? null : <Badge lage={badgelage(lage)}>{badge}</Badge>}
        </div>

        {/*
          §7: Blockierte Aufgaben benennen, worauf sie warten. Die Namen sind
          Links, und wer sie liest, will meistens gleich dorthin.
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

        {/*
          Ob die Aufgabe erledigt ist, ist das Erste, was jemand hier wissen
          will, und das Erste, was er tun will. Vorher stand das Häkchen in
          einem eigenen Kasten mit der Überschrift "Erledigt?", drei Abschnitte
          tiefer und hinter dem Rechtlichen. Jetzt steht es beim Titel.
        */}
        {/*
          Die Seed-Aufgabe hat kein eigenes Häkchen (ERBE_DESIGN.md §9): Sie
          ist geteilt, ihr Ergebnis liegt privat, und ein gespeichertes Häkchen
          hakte sie für alle ab. Anna wäre fertig und Bert, der den Fragebaum
          nie gegangen ist, sähe seine Aufgabe erledigt.
        */}
        {istSeedAufgabe(aufgabe.katalog) ? (
          <p className={stile.hinweis} role="status">
            {aufgabe.erledigt
              ? 'Erledigt: Sie haben den Fragebaum durchlaufen.'
              : 'Offen, solange Sie den Fragebaum nicht durchlaufen haben. Das entscheidet jede:r für sich.'}
          </p>
        ) : istBlatt ? (
          <Checkbox
            checked={eigenesHaken}
            disabled={aktionen.gesperrt || !darfAendern}
            onChange={(ereignis) => void haken(ereignis.target.checked)}
            label="Diese Aufgabe ist erledigt"
          />
        ) : (
          /*
           * §7: Eine Aufgabe mit Unteraufgaben hat kein eigenes Häkchen. Sie
           * gilt genau dann als erledigt, wenn alle Kinder es sind, und dann
           * zwingend. Fehlt inhaltlich noch etwas, kommt eine Unteraufgabe
           * dazu; das ist ehrlicher als eine Aufgabe, die trotz erledigter
           * Kinder offen aussieht.
           */
          <p className={stile.hinweis} role="status">
            {erledigt
              ? `Erledigt: alle ${unteraufgaben.length} Unteraufgaben sind abgehakt.`
              : `Offen: ${fertigeKinder} von ${unteraufgaben.length} Unteraufgaben erledigt.`}
          </p>
        )}
      </div>

      {/*
        Der erste Satz zur Sache. Er steht als Text da und nicht in einem
        Kasten: Ein Kasten sagt "hier fängt ein Abschnitt an", und das tut er
        hier nicht — er gehört zu dem Titel darüber.
      */}
      {aufgabe.beschreibung === '' ? null : (
        <p className={stile.anriss}>{aufgabe.beschreibung}</p>
      )}

      {/*
        Die eine Aufgabe, die noch aus dem Katalog kommt (ADR-0001), führt in
        den Fragebaum. Erkannt wird sie an ihrer Herkunft und nicht am Titel:
        Wer sie umbenennt, soll den Weg dorthin nicht verlieren.
      */}
      {istSeedAufgabe(aufgabe.katalog) ? <ZumFragebaum /> : null}

      <Rechtliches aufgabe={aufgabe} lage={lage} />

      {/*
        §8: Nur bei den Fristen, die an der eigenen Kenntnis hängen. Bei allen
        anderen gäbe es nichts einzutragen, und ein Feld ohne Wirkung wäre eine
        Frage, die niemand beantworten muss.
      */}
      {aufgabe.katalog?.fristAb === 'kenntnis' ? (
        <Kenntnisdatum
          fristTage={aufgabe.katalog.fristTage}
          kenntnisAm={fristbezug.kenntnisAm}
          lage={lage}
          gesperrt={aktionen.gesperrt}
          aufSpeichern={aktionen.speichereKenntnisAm}
        />
      ) : null}

      {/*
        §3.7: "genau eine Aktion 'Für alle sichtbar machen'". Der Abschnitt
        steht nur bei privaten Aufgaben: Bei allen anderen gäbe es nichts zu
        entscheiden und nichts zu erklären.
      */}
      {aufgabe.privat ? (
        <Gruppe titel="Sichtbarkeit">
          <Card>

          <p>
            Diese Aufgabe sehen nur Sie, auf Ihren eigenen Geräten. Die anderen Mitglieder des
            Falls laden sie zwar mit, können sie aber nicht lesen.
          </p>

          {fragtFreigabe ? (
            <>
              {/*
                Freigeben wrappt den DEK von `K_p` auf `K_c` (§3.7). Einen Weg
                zurück gibt es nicht: Der Fallschlüssel liegt bei allen.
              */}
              <p>
                Wirklich für alle sichtbar machen? Zurücknehmen lässt sich das nicht.
              </p>
              <div className={stile.aktionen}>
                <Button
                  disabled={aktionen.gesperrt}
                  onClick={() => {
                    setzeFragtFreigabe(false)
                    aktionen.gibFuerAlleFrei()
                  }}
                >
                  Für alle sichtbar machen
                </Button>
                <Button variante="sekundaer" onClick={() => setzeFragtFreigabe(false)}>
                  Abbrechen
                </Button>
              </div>
            </>
          ) : (
            <Button
              variante="sekundaer"
              disabled={aktionen.gesperrt}
              onClick={() => setzeFragtFreigabe(true)}
            >
              Für alle sichtbar machen
            </Button>
          )}
          </Card>
        </Gruppe>
      ) : null}

      {/*
        §7: Die Zuweisung ist eine Bearbeitungssperre, kein Zugriffsschutz: Der
        Server kann eine Regel nicht durchsetzen, die er nicht lesen kann (§3.3,
        §11). Sie steht deshalb offen für jede:n: übernehmen, freigeben,
        jemanden eintragen.
      */}
      <Gruppe titel="Zuständigkeit">
        <Card>

        <Zuweisungsfeld
          zuweisung={aufgabe.assignee}
          ich={ich}
          mitglieder={mitglieder}
          gesperrt={aktionen.gesperrt}
          aufSetzen={aktionen.weiseZu}
        />

        {darfAendern ? null : (
          <p className={stile.hinweis}>
            Diese Aufgabe ist Ihnen nicht zugewiesen. Sie können sie lesen; zum Ändern
            übernehmen Sie sie.
          </p>
        )}

        {/*
          Die Auswahl ist dann kürzer, als sie sein sollte; das gehört gesagt
          (§5). Übernehmen und Freigeben gehen trotzdem: Dafür braucht es nur
          die eigene Person, und die kommt aus der Anmeldung.
        */}
        {mitgliederfehler === null ? null : (
          <p className={stile.hinweis} role="alert">
            Die Mitglieder dieses Falls sind gerade nicht abrufbar. {mitgliederfehler}
          </p>
        )}
        </Card>
      </Gruppe>

      <Gruppe titel="Unteraufgaben">
        <Card>

        {unteraufgaben.length === 0 ? (
          <p className={stile.hinweis}>Noch keine. Eine Unteraufgabe teilt die Arbeit auf.</p>
        ) : (
          <ul className={stile.liste}>
            {unteraufgaben.map((unteraufgabe) => (
              <Unteraufgabenzeile
                key={unteraufgabe.id}
                unteraufgabe={unteraufgabe}
                gesperrt={aktionen.gesperrt}
                ichUserId={ich.userId}
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
        {aufgabe.privat ? (
          /*
           * §3.7: Private Aufgaben sind immer Wurzelaufgaben. Eine
           * Unteraufgabe darunter läge unter `K_c` und wäre für die anderen
           * eine Aufgabe ohne Elternaufgabe: Sie stünde bei ihnen auf der
           * Wurzelebene und verriete nebenbei, dass es hier etwas gibt, das
           * sie nicht sehen. Wer aufteilen will, macht die Aufgabe zuerst für
           * alle sichtbar.
           */
          <p className={stile.hinweis}>
            Eine private Aufgabe steht für sich. Machen Sie sie für alle sichtbar, wenn Sie sie
            aufteilen möchten.
          </p>
        ) : aufgabe.parentId === null ? (
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
              disabled={aktionen.gesperrt || !darfAendern || neueUnteraufgabe.trim() === ''}
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
      </Gruppe>

      {/*
        §7: "Dokument einfach abfotografieren": Die Sterbeurkunde gehört an die
        Aufgabe, für die sie gebraucht wird, und nicht in eine Ablage irgendwo
        sonst in der App.
      */}
      <Dokumente
        fall={fall}
        aufgabeId={aufgabe.id}
        zeilen={zeilen}
        aktualisiere={aktualisiere}
        darfAendern={darfAendern}
      />

      <Gruppe titel="Notizen">
        <Card>

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

          <Button
            type="submit"
            volleBreite
            disabled={aktionen.gesperrt || !darfAendern || notizen === aufgabe.notizen}
          >
            Notizen speichern
          </Button>
        </form>
        </Card>
      </Gruppe>
    </>
  )
}

function Aufgabenbereich({ fall, id }: { fall: LesbarerFall; id: string }) {
  const {
    zustand,
    schreibe,
    hakeAb,
    legeAn,
    loesche,
    ich,
    weiseZu,
    uebernahmen,
    bestaetigeUebernahmen,
    zeilen,
    aktualisiere,
    gibFuerAlleFrei,
    fristbezug,
    setzeKenntnisAm,
  } = useAufgaben(fall)

  const { userIds, fehler: mitgliederfehler } = useMitglieder(fall.id)

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

  /*
   * Die Kennungen kommen aus `memberships`, die Namen aus den Zuweisungen, die
   * schon im Fall liegen (§7). Sobald die Kopplung `profiles` mitbringt (#10),
   * kommen sie von dort; die Stelle, an der beides zusammenfindet, bleibt
   * dieselbe.
   */
  const mitglieder = benenne(
    userIds,
    zustand.aufgaben.map((aufgabe) => aufgabe.assignee),
    ich,
  )

  const knoten = knotenZu(zustand.aufgaben, id)

  if (knoten === null) {
    /*
     * Ein leerer Cache und ein laufender erster Abruf sind nicht dasselbe wie
     * eine gelöschte Aufgabe (§5). Erst wenn der Abruf durch ist, darf hier
     * "gibt es nicht mehr" stehen.
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

      {uebernahmen.length === 0 ? null : (
        <Uebernahmen uebernahmen={uebernahmen} aufBestaetigen={bestaetigeUebernahmen} />
      )}

      {/*
        `key`: Der Screen bleibt beim Wechsel von einer Aufgabe zur nächsten,
        etwa über einen "Zuerst: …"-Link, an derselben Stelle im Baum, und React
        behielte sonst den Zustand des Formulars. Ein angefangener, noch nicht
        gespeicherter Notizentwurf stünde dann im Feld der anderen Aufgabe und
        landete beim nächsten "Notizen speichern" an der falschen Zeile.
      */}
      <Detail
        key={knoten.aufgabe.id}
        knoten={knoten}
        fall={fall}
        fristbezug={fristbezug}
        ich={ich}
        mitglieder={mitglieder}
        mitgliederfehler={mitgliederfehler}
        zeilen={zeilen}
        aktualisiere={aktualisiere}
        aktionen={{
          gesperrt: laeuft,
          weiseZu: (zuweisung) => void fuehreAus(() => weiseZu(knoten.aufgabe, zuweisung)),
          hakeAb: (aufgabe, erledigt) => fuehreAus(() => hakeAb(aufgabe, erledigt)),
          schreibeNotizen: (notizen) => fuehreAus(() => schreibe(knoten.aufgabe, { notizen })),
          legeUnteraufgabeAn: (titel) => fuehreAus(() => legeAn(titel, knoten.aufgabe.id)),
          loesche: (aufgabe) => void fuehreAus(() => loesche(aufgabe)),
          gibFuerAlleFrei: () => void fuehreAus(() => gibFuerAlleFrei(knoten.aufgabe)),
          speichereKenntnisAm: (datum) => fuehreAus(() => setzeKenntnisAm(datum)),
        }}
      />
    </>
  )
}

export function Aufgabe() {
  const { id } = useParams()
  const { zustand } = useCase()

  if (zustand.status === 'laedt' || zustand.status === 'schluessel-erneuerung') {
    return (
      <main className={stile.seite}>
        <Ladeanzeige text={fallLadeText(zustand.status)} />
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
