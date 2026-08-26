import { useState, type FormEvent, type ReactNode } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router-dom'
import { alsNachricht } from '../../../core/fehler.ts'
import { useAufgaben } from '../../../hooks/useAufgaben.ts'
import { useCase } from '../../../hooks/useCase.ts'
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
import {
  BAUPLAENE,
  istAnfechtungAufgabe,
  istAusschlagungAufgabe,
  istErbscheinAufgabe,
  istSeedAufgabe,
  stammtAus,
} from '../../../services/fragebaumService.ts'
import type { Katalogherkunft } from '../../../services/aufgabenService.ts'
import {
  darfAbhaken,
  darfBearbeiten,
  type Zugewiesene,
  type Zuweisung,
} from '../../../services/zuweisung.ts'
import { Button } from '../../../ui/Button/Button.tsx'
import { Checkbox } from '../../../ui/Checkbox/Checkbox.tsx'
import { Zurueck } from '../../../ui/Zurueck/Zurueck.tsx'
import {
  GerichtNachschlagen,
  istGerichtStelle,
} from '../../shared/Gericht/GerichtNachschlagen.tsx'
import { aktualisiereNotizMitGericht } from '../../../services/gerichtService.ts'
import type { Nachlassgericht } from '../../../types/gericht.ts'
import { Dokumente } from '../../shared/Dokumente/Dokumente.tsx'
import { fallLadeText } from '../../shared/Ladeanzeige/FallLadeanzeige.tsx'
import { Uebernahmen } from '../../shared/Meldungen/Meldungen.tsx'
import { Zuweisungsfeld } from '../../shared/Zuweisung/Zuweisungsfeld.tsx'
import {
  AnfechtungInfo,
  AusschlagungInfo,
  ErbscheinInfo,
} from '../../shared/Erbe/ErbscheinInfo.tsx'
import { Fristzeile } from '../Bausteine.tsx'
import stile from '../einfach.module.css'
import type { InhaltZeile } from '../../../core/db/inhalte.ts'

/**
 * Das Aufgabendetail in der einfachen Ansicht (DESIGN.md §7, §8).
 *
 * Ganzseitig wie drüben, mit demselben Weg hinein und demselben Weg zurück.
 * Weniger steht darauf, und das Weniger ist ausgewählt und nicht gekürzt:
 *
 * - **Die Zuständigkeit ist dasselbe Feld wie drüben, nur grösser gesetzt.**
 *   Wer eingetragen ist, steht über den Schaltflächen statt daneben, und die
 *   gehen über die volle Breite: Zwei kleine Kästen nebeneinander sind auf
 *   diesem Screen kein Angebot, sondern eine Hürde.
 * - **Unteraufgaben ohne eigene Wege.** Sie werden hier abgehakt und hier
 *   gelöscht; die erweiterte Ansicht verlinkt von jeder in ihr eigenes Detail,
 *   und das ist genau die verschachtelte Navigation, auf die §7 hier
 *   verzichtet.
 *
 * Vor jeder Handlung, die sich nicht zurücknehmen lässt, steht eine Frage: vor
 * dem Löschen einer Aufgabe, vor dem Löschen einer Unteraufgabe, vor dem
 * Löschen eines Dokuments und vor "Für alle sichtbar machen" (§3.7, §5, §7).
 */

function Ladeanzeige({ text }: { text: string }) {
  return (
    <p className={stile.hinweis} role="status">
      {text}
    </p>
  )
}

function mitFett(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|\[gruen:[^\]]+\]|\[rot:[^\]]+\])/g).map((teil, nummer) => {
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
    if (teil.startsWith('[rot:') && teil.endsWith(']')) {
      return (
        <span key={nummer} className={stile.rot}>
          {mitFett(teil.slice(5, -1))}
        </span>
      )
    }
    return teil
  })
}

function aktuelleBeschreibung(aufgabe: Aufgabendatensatz): string {
  if (
    istAusschlagungAufgabe(aufgabe) ||
    istErbscheinAufgabe(aufgabe) ||
    istAnfechtungAufgabe(aufgabe)
  ) {
    return ''
  }
  return aufgabe.beschreibung
}

function aktuellerKatalog(
  katalog: Katalogherkunft | null,
  aufgabe?: Aufgabendatensatz,
): Katalogherkunft | null {
  if (katalog === null && !aufgabe) {
    return null
  }
  if (
    (aufgabe && istAusschlagungAufgabe(aufgabe)) ||
    (katalog && stammtAus(katalog, 'ausschlagung'))
  ) {
    return BAUPLAENE.ausschlagung.katalog
  }
  if (
    (aufgabe && istErbscheinAufgabe(aufgabe)) ||
    (katalog && stammtAus(katalog, 'erbschein'))
  ) {
    return BAUPLAENE.erbschein.katalog
  }
  if (
    (aufgabe && istAnfechtungAufgabe(aufgabe)) ||
    (katalog && stammtAus(katalog, 'anfechtung'))
  ) {
    return BAUPLAENE.anfechtung.katalog
  }
  return katalog
}

/** Ein Abschnitt: Überschrift, darunter der Inhalt, darüber eine Haarlinie. */
function Abschnitt({ titel, children }: { titel: string; children: ReactNode }) {
  return (
    <section className={stile.abschnitt}>
      <h2>{titel}</h2>
      {children}
    </section>
  )
}

/**
 * Der Titel dieser Aufgabe (DESIGN.md §7, §3.5).
 *
 * Ein Feld, ein Knopf, ein Verb — wie alles in dieser Ansicht.
 *
 * Nur bei selbst angelegten Aufgaben. Der Titel einer Katalogaufgabe ist
 * Rechtstext (§8) und steht in der Inhaltsschicht.
 */
function Titelfeld({
  titel,
  gesperrt,
  aufSpeichern,
}: {
  titel: string
  gesperrt: boolean
  /** @returns ob gespeichert wurde. Sonst bleibt das Feld, wie es ist. */
  aufSpeichern: (titel: string) => Promise<boolean>
}) {
  const [eingabe, setzeEingabe] = useState(titel)
  const [gespeichert, setzeGespeichert] = useState(titel)

  // Was der Bestand bringt, gewinnt, aber erst, wenn er sich wirklich geändert
  // hat: dieselbe Überlegung wie bei den Notizen.
  if (gespeichert !== titel) {
    setzeGespeichert(titel)
    setzeEingabe(titel)
  }

  async function speichere(ereignis: FormEvent) {
    ereignis.preventDefault()
    await aufSpeichern(eingabe.trim())
  }

  return (
    <Abschnitt titel="Wie soll die Aufgabe heissen?">
      <form className={stile.formular} onSubmit={(ereignis) => void speichere(ereignis)}>
        <div className={stile.feld}>
          <label htmlFor="aufgabe-titel">Titel</label>
          <input
            id="aufgabe-titel"
            className={stile.eingabe}
            value={eingabe}
            onChange={(ereignis) => setzeEingabe(ereignis.target.value)}
            required
          />
        </div>

        <Button
          type="submit"
          volleBreite
          disabled={gesperrt || eingabe.trim() === '' || eingabe.trim() === titel}
        >
          Titel speichern
        </Button>
      </form>
    </Abschnitt>
  )
}

/** Eine Angabe aus dem Katalog: Etikett, darunter der Wert. */
function Angabe({ was, children }: { was: string; children: ReactNode }) {
  return (
    <div>
      <dt className={stile.etikett}>{was}</dt>
      <dd className={stile.wert}>{children}</dd>
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
 * Was für diese Aufgabe gilt (§8).
 *
 * Fehlt eine Angabe, steht sie nicht da. Ein "keine Frist" wäre eine Aussage,
 * die der Katalog nicht trifft: Fehlt eine gesetzliche Frist, bleibt das Feld
 * leer, erfunden wird nichts.
 *
 * Kein Paragraph und kein Quelllink (ADR-0003): Eine Zeile "§ 1944 BGB" liest
 * sich wie eine Rechtsberatung, und die gibt diese App nicht. Was bleibt, ist
 * das, wonach jemand handelt — Frist, Stelle, Dokumente, Hinweis.
 */
function Angaben({
  aufgabe,
  lage,
  aufGerichtGefunden,
  gesperrt,
}: {
  aufgabe: Aufgabendatensatz
  lage: Fristlage
  aufGerichtGefunden?: (gericht: Nachlassgericht, plz: string) => Promise<void>
  gesperrt?: boolean
}) {
  const katalog = aktuellerKatalog(aufgabe.katalog, aufgabe)

  if (katalog === null) {
    return null
  }

  const dokumente = katalog.benoetigteDokumente.filter((eintrag) => eintrag.trim() !== '')
  if (istAnfechtungAufgabe(aufgabe)) {
    return (
      <Abschnitt titel="Zuständige Stelle">
        <div className={stile.angaben}>
          {katalog.zustaendigeStelle === '' ? null : (
            <div>
              <span className={stile.wert}>{katalog.zustaendigeStelle}</span>
              {istGerichtStelle(katalog.zustaendigeStelle) ? (
                <GerichtNachschlagen
                  initialNotiz={aufgabe.notizen}
                  aufGerichtGefunden={aufGerichtGefunden}
                  gesperrt={gesperrt}
                />
              ) : null}
            </div>
          )}
          <div className={stile.prozedurText}>
            <p style={{ margin: 0 }}>
              <strong>Wie fechte ich ein Testament an?</strong>
            </p>
            <p style={{ margin: 'var(--dichte-abstand-klein) 0 0 0' }}>
              Es gibt zwei Möglichkeiten:
            </p>
            <ul className={stile.punkte}>
              <li>schriftlicher Antrag an das Nachlassgericht</li>
              <li>persönlich beim Nachlassgericht</li>
            </ul>
            <p style={{ margin: 'var(--dichte-abstand-klein) 0 0 0' }}>
              Hinweis: Bei persönlichem Erscheinen vereinbaren Sie vorher einen Termin beim Nachlassgericht.
            </p>
          </div>
        </div>
      </Abschnitt>
    )
  }

  if (istAusschlagungAufgabe(aufgabe)) {
    return (
      <Abschnitt titel="Zuständige Stelle">
        <div className={stile.angaben}>
          {katalog.zustaendigeStelle === '' ? null : (
            <div>
              <span className={stile.wert}>{katalog.zustaendigeStelle}</span>
              {istGerichtStelle(katalog.zustaendigeStelle) ? (
                <GerichtNachschlagen
                  initialNotiz={aufgabe.notizen}
                  aufGerichtGefunden={aufGerichtGefunden}
                  gesperrt={gesperrt}
                />
              ) : null}
            </div>
          )}
        </div>
      </Abschnitt>
    )
  }

  if (istErbscheinAufgabe(aufgabe)) {
    return (
      <Abschnitt titel="Zuständige Stelle">
        <div className={stile.angaben}>
          {katalog.zustaendigeStelle === '' ? null : (
            <div>
              <span className={stile.wert}>{katalog.zustaendigeStelle}</span>
              {istGerichtStelle(katalog.zustaendigeStelle) ? (
                <GerichtNachschlagen
                  initialNotiz={aufgabe.notizen}
                  aufGerichtGefunden={aufGerichtGefunden}
                  gesperrt={gesperrt}
                />
              ) : null}
            </div>
          )}
          <div className={stile.prozedurText}>
            <p style={{ margin: 0 }}>
              <strong>Wie beantrage ich einen Erbschein?</strong>
            </p>
            <p style={{ margin: 'var(--dichte-abstand-klein) 0 0 0' }}>
              Zwei Möglichkeiten:
            </p>
            <p className={stile.gruen} style={{ margin: 'var(--dichte-abstand-klein) 0 0 0' }}>
              Über ein Notariat:
            </p>
            <ul className={stile.punkte}>
              <li>telefonisch oder online Termin vereinbaren</li>
              <li>Antrag und notwendigen Dokumente mitbringen</li>
              <li>der Notar nimmt die eidesstattliche Versicherung entgegen und leitet den Antrag an das Nachlassgericht weiter</li>
              <li>das Nachlassgericht wird sich bei Ihnen melden</li>
            </ul>
            <p className={stile.gruen} style={{ margin: 'var(--dichte-abstand-klein) 0 0 0' }}>
              Über das Nachlassgericht:
            </p>
            <ul className={stile.punkte}>
              <li>Termin telefonisch vereinbaren</li>
              <li>den schriftlichen Antrag und die notwendigen Dokumente zum persönlichen Termin mitbringen</li>
              <li>beim Termin werden Sie eine eidesstattliche Versicherung abgeben, welche bestätigt, dass der Inhalt der oben genannten Dokumente der Wahrheit entspricht</li>
              <li>das Nachlassgericht wird sich bei Ihnen melden</li>
            </ul>
            <p style={{ margin: 'var(--dichte-abstand-klein) 0 0 0' }}>
              <strong>Notar oder Nachlassgericht:</strong><br />
              <strong>Notar:</strong> Sie erhalten schneller einen Termin<br />
              <strong>Nachlassgericht:</strong> Ihnen fallen keine zusätzlichen Kosten an
            </p>
          </div>
        </div>
      </Abschnitt>
    )
  }

  const schritte = katalog.unteraufgaben.filter((eintrag) => eintrag.trim() !== '')

  return (
    <Abschnitt titel="Das gilt dafür">
      <dl className={stile.angaben}>
        {lage.art === 'datum' ? (
          <Angabe was="Frist">
            endet am {datumText(lage.ende)} ({fristText(lage)})
          </Angabe>
        ) : null}

        {/*
          Fristen nach Tod stehen in der Fristzeile der Zeile; eine Frist nach
          der eigenen Kenntnis steht dagegen hier, weil sie kein Datum ist,
          sondern eine Erklärung (§8).
        */}
        {lage.art === 'unverzueglich' ? (
          <Angabe was="Frist">
            unverzüglich (ohne schuldhaftes Zögern)
          </Angabe>
        ) : null}

        {lage.art === 'ab-kenntnis' && !istAnfechtungAufgabe(aufgabe) ? (
          /*
            §8: Ohne Kenntnisdatum wird kein Ende gerechnet und keines
            geschätzt. Die Frist hängt an einem Tag, den nur diese Person kennt.
          */
          <Angabe was="Frist">
            6 Wochen ({katalog.fristTage ?? 42} Tage) ab dem Fristbeginn: Im Normalfall (gesetzliche
            Erbfolge) ab dem Moment, in dem Sie von Tod und Erbschaft erfahren; bei Testament
            oder Erbvertrag erst ab offizieller Eröffnung durch das Nachlassgericht. Tragen Sie
            das Datum unten ein.
          </Angabe>
        ) : null}

        {katalog.zustaendigeStelle === '' ? null : (
          <Angabe was="Dorthin geht es">
            <div>
              <span className={stile.zustaendigeStelle}>{katalog.zustaendigeStelle}</span>
              {istGerichtStelle(katalog.zustaendigeStelle) ? (
                <GerichtNachschlagen
                  initialNotiz={aufgabe.notizen}
                  aufGerichtGefunden={aufGerichtGefunden}
                  gesperrt={gesperrt}
                />
              ) : null}
            </div>
          </Angabe>
        )}

        {istAnfechtungAufgabe(aufgabe) || istAusschlagungAufgabe(aufgabe) || istErbscheinAufgabe(aufgabe) ? null : (
          <>
            {dokumente.length === 0 ? null : (
              <Angabe was="Das brauchen Sie dafür">
                <ul className={stile.punkte}>
                  {dokumente.map((dokument) => (
                    <li key={dokument}>{dokument}</li>
                  ))}
                </ul>
              </Angabe>
            )}

            {schritte.length === 0 ? null : (
              <Angabe was="Das ist zu tun">
                <ol className={stile.punkte}>
                  {schritte.map((schritt) => (
                    <li key={schritt}>{schritt}</li>
                  ))}
                </ol>
              </Angabe>
            )}

            {katalog.hinweis === '' ? null : <Angabe was="Hinweis">{katalog.hinweis}</Angabe>}
          </>
        )}
      </dl>
    </Abschnitt>
  )
}

/**
 * Das eigene Kenntnisdatum (§8, #12).
 *
 * Die Ausschlagungsfrist nach § 1944 BGB knüpft an die Kenntnis des jeweiligen
 * Erben an: Eine Witwe, die am Sterbetag danebenstand, und ein Bruder, der drei
 * Wochen später vom Notar erfährt, haben verschiedene Fristenden. Das Datum
 * liegt privat unter `K_p` (§3.7) und wird von jeder Person selbst eingetragen.
 *
 * Ohne Bearbeitungssperre, anders als alles andere auf diesem Screen: Hier
 * ändert niemand die Aufgabe. Wer sein eigenes Kenntnisdatum erst eintragen
 * dürfte, nachdem er eine Aufgabe übernommen hat, sähe seine eigene
 * gesetzliche Frist nicht.
 */
function Kenntnisdatum({
  kenntnisAm,
  lage,
  gesperrt,
  aufSpeichern,
  hinweis,
}: {
  kenntnisAm: string | null
  lage: Fristlage
  gesperrt: boolean
  aufSpeichern: (datum: string | null) => Promise<boolean>
  hinweis?: string
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
    <Abschnitt titel="Wann haben Sie davon erfahren?">
      <p className={stile.hinweis}>
        {hinweis ??
          'An welchem Tag haben Sie von der Erbschaft erfahren bzw. das Testament erhalten? Ab diesem Tag läuft Ihre Frist. Das Datum sehen nur Sie: Jede und jeder trägt den eigenen Tag ein.'}
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
            wirkliche. Der Dienst weist es ausserdem ab (§8).
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

        <div className={stile.knoepfe}>
          <Button
            type="submit"
            volleBreite
            disabled={gesperrt || eingabe === (kenntnisAm ?? '')}
          >
            Datum speichern
          </Button>

          {kenntnisAm === null ? null : (
            <Button
              volleBreite
              variante="sekundaer"
              disabled={gesperrt}
              onClick={() => void aufSpeichern(null)}
            >
              Datum entfernen
            </Button>
          )}
        </div>
      </form>
    </Abschnitt>
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
  /** Eine Unteraufgabe hat ihre eigene Zuweisung (§7). */
  ichUserId: string
  aufHaken: (erledigt: boolean) => Promise<boolean>
  aufLoeschen: () => void
}) {
  const [fragt, setzeFragt] = useState(false)

  // Das Häkchen folgt dem Finger und gibt die Führung erst ab, wenn der
  // Bestand nachgezogen hat (§5).
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

  const darfAendern = darfBearbeiten(unteraufgabe.assignee, ichUserId)
  const darfHaken = darfAbhaken(unteraufgabe.assignee, ichUserId)

  if (fragt) {
    return (
      <li className={[stile.eintrag, stile.frage].join(' ')}>
        <p>„{unteraufgabe.titel}“ wirklich löschen? Gelöschtes kommt nicht zurück.</p>
        <div className={stile.knoepfe}>
          <Button
            volleBreite
            onClick={() => {
              setzeFragt(false)
              aufLoeschen()
            }}
            disabled={gesperrt}
          >
            Ja, löschen
          </Button>
          <Button volleBreite variante="sekundaer" onClick={() => setzeFragt(false)}>
            Abbrechen
          </Button>
        </div>
      </li>
    )
  }

  return (
    <li className={stile.eintrag}>
      {/*
        Wer nicht abhaken darf, sieht kein Kästchen: Ein graues ist eine
        Einladung, die nicht gilt.
      */}
      {darfHaken ? (
        <Checkbox
          abhaken
          checked={erledigt}
          disabled={gesperrt}
          onChange={(ereignis) => void haken(ereignis.target.checked)}
          label={unteraufgabe.titel}
        />
      ) : (
        <p className={erledigt ? stile.fertig : stile.titel}>{unteraufgabe.titel}</p>
      )}

      {darfAendern ? (
        <Button
          variante="text"
          className={[stile.gefahr, stile.zeilenaktion].join(' ')}
          onClick={() => setzeFragt(true)}
          vorleseText={`: „${unteraufgabe.titel}“`}
        >
          Löschen
        </Button>
      ) : null}
    </li>
  )
}

function Detail({
  knoten,
  fall,
  fristbezug,
  ich,
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
  /** Der Bestand als Ciphertext; die Dokumente lesen daraus ihre Zeilen (§7). */
  zeilen: InhaltZeile[]
  /** Stösst eine Sync-Runde an: Dokumente gehen nicht durch die Queue (§5). */
  aktualisiere: () => void
  aktionen: {
    gesperrt: boolean
    hakeAb: (aufgabe: Aufgabendatensatz, erledigt: boolean) => Promise<boolean>
    schreibeNotizen: (notizen: string) => Promise<boolean>
    /** Benennt eine selbst angelegte Aufgabe um (§7). */
    speichereTitel: (titel: string) => Promise<boolean>
    legeUnteraufgabeAn: (titel: string) => Promise<boolean>
    loesche: (aufgabe: Aufgabendatensatz) => void
    loescheDiese: () => void
    weiseZu: (zuweisung: Zuweisung) => void
    /** Wrappt den DEK von `K_p` auf `K_c` (§3.7). */
    gibFuerAlleFrei: () => void
    speichereKenntnisAm: (datum: string | null) => Promise<boolean>
    speichereAnfechtungKenntnisAm: (datum: string | null) => Promise<boolean>
  }
}) {
  const { aufgabe, unteraufgaben, istBlatt, erledigt, blockiertVon } = knoten
  const lage = fristlage(aufgabe.katalog, fristbezug, heuteIso(), aufgabe.fristAm)

  const [notizen, setzeNotizen] = useState(aufgabe.notizen)
  const [gespeicherteNotizen, setzeGespeicherteNotizen] = useState(aufgabe.notizen)
  const [neueUnteraufgabe, setzeNeueUnteraufgabe] = useState('')
  const [fragt, setzeFragt] = useState<null | 'freigabe' | 'loeschen'>(null)

  // Was der Bestand bringt, gewinnt, aber erst, wenn er sich wirklich geändert
  // hat. Sonst überschriebe jede Türklingel den halb getippten Satz.
  if (gespeicherteNotizen !== aufgabe.notizen) {
    setzeGespeicherteNotizen(aufgabe.notizen)
    setzeNotizen(aufgabe.notizen)
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

  async function speichereGerichtNotiz(gericht: Nachlassgericht, plz: string) {
    const neueNotizen = aktualisiereNotizMitGericht(notizen, gericht, plz)
    setzeNotizen(neueNotizen)
    await aktionen.schreibeNotizen(neueNotizen)
  }

  /*
   * §7: "Bearbeiten darf nur, wem sie zugewiesen ist." Gesperrt sind die
   * Notizen, neue Schritte und das Löschen, nicht das Lesen und nicht die
   * Zuständigkeit selbst.
   */
  const darfAendern = darfBearbeiten(aufgabe.assignee, ich.userId)

  return (
    <>
      <div className={stile.kopf}>
        <h1>{aufgabe.titel}</h1>

        {/* §3.7: Wer die Aufgabe öffnet, soll sofort sehen, wer sie sonst noch sieht. */}
        {aufgabe.privat ? <p className={stile.hinweis}>Nur für mich</p> : null}

        <Fristzeile lage={lage} />

        {/* §7: Blockierte Aufgaben benennen, worauf sie warten. */}
        {blockiertVon.length === 0 ? null : (
          <p className={stile.hinweis}>
            Zuerst: {blockiertVon.map((offen) => offen.titel).join(', ')}
          </p>
        )}
      </div>

      <div className={[stile.abschnitt, stile.ohnelinie].join(' ')}>
        {istErbscheinAufgabe(aufgabe) ? (
          <ErbscheinInfo />
        ) : istAnfechtungAufgabe(aufgabe) ? (
          <AnfechtungInfo />
        ) : istAusschlagungAufgabe(aufgabe) ? (
          <>
            <p className={stile.hinweisText}>
              <strong className={stile.rot}>Hinweis:</strong> Wer Gegenstände aus dem Nachlass verkauft, verschenkt oder nutzt, nimmt das
              Erbe automatisch an. Danach kann das Erbe nicht mehr abgelehnt werden.
            </p>
            <AusschlagungInfo />
          </>
        ) : aktuelleBeschreibung(aufgabe) === '' ? null : (
          <p className={stile.beschreibung}>{mitFett(aktuelleBeschreibung(aufgabe))}</p>
        )}

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
          <p className={stile.hinweis} role="status">
            {aufgabe.erledigt ? 'Erledigt.' : 'Offen. Abhaken können Sie sie in der Liste.'}
          </p>
        ) : (
          /*
           * §7: Eine Aufgabe mit Unteraufgaben hat kein eigenes Häkchen. Sie
           * gilt genau dann als erledigt, wenn alle Kinder es sind.
           */
          <p role="status">
            {erledigt
              ? `Erledigt: alle ${unteraufgaben.length} Schritte sind abgehakt.`
              : `Offen: ${unteraufgaben.filter((unter) => unter.erledigt).length} von ${
                  unteraufgaben.length
                } Schritten erledigt.`}
          </p>
        )}
      </div>

      {/*
        Die eine Aufgabe, die noch aus dem Katalog kommt (ADR-0001), führt in
        den Fragebaum. Erkannt wird sie an ihrer Herkunft und nicht am Titel:
        Wer sie umbenennt, soll den Weg dorthin nicht verlieren.
      */}
      {istSeedAufgabe(aufgabe.katalog) ? <ZumFragebaum /> : null}

      {/*
        Der Titel steht oben und nicht am Ende: Eine selbst angelegte Aufgabe
        lässt sich hier umbenennen (§7).
      */}
      {aufgabe.katalog === null ? (
        <Titelfeld
          titel={aufgabe.titel}
          gesperrt={aktionen.gesperrt || !darfAendern}
          aufSpeichern={aktionen.speichereTitel}
        />
      ) : null}

      <Angaben
        aufgabe={aufgabe}
        lage={lage}
        aufGerichtGefunden={speichereGerichtNotiz}
        gesperrt={aktionen.gesperrt || !darfAendern}
      />

      {/*
        §8: Nur bei den Fristen, die an der eigenen Kenntnis hängen. Bei allen
        anderen gäbe es nichts einzutragen.
      */}
      {aufgabe.katalog?.fristAb === 'kenntnis' ? (
        <Kenntnisdatum
          kenntnisAm={fristbezug.kenntnisAm}
          lage={lage}
          gesperrt={aktionen.gesperrt}
          aufSpeichern={aktionen.speichereKenntnisAm}
        />
      ) : istAnfechtungAufgabe(aufgabe) || aufgabe.katalog?.fristAb === 'anfechtungskenntnis' ? (
        <Kenntnisdatum
          kenntnisAm={fristbezug.anfechtungKenntnisAm}
          lage={lage}
          gesperrt={aktionen.gesperrt}
          aufSpeichern={aktionen.speichereAnfechtungKenntnisAm}
          hinweis="An welchem Tag haben Sie von dem Grund der möglichen Anfechtung erfahren? Ab diesem Tag laufen die 365 Tage dieser Frist. Das Datum sehen nur Sie: Jedes Mitglied trägt sein eigenes ein, und dieselbe Aufgabe hat deshalb für jeden ein anderes Ende."
        />
      ) : null}

      {/* §7: "genau eine Aktion 'Für alle sichtbar machen'". */}
      {aufgabe.privat ? (
        <Abschnitt titel="Wer sieht das?">
          <p>Diese Aufgabe sehen nur Sie, auf Ihren eigenen Geräten.</p>

          {fragt === 'freigabe' ? (
            <div className={stile.frage}>
              {/*
                Freigeben wrappt den DEK von `K_p` auf `K_c` (§3.7). Einen Weg
                zurück gibt es nicht: Der Fallschlüssel liegt bei allen, und was
                einmal darunter lag, hat jedes Mitglied beim nächsten Delta
                gesehen. Das gehört vor die Aktion gesagt und nicht danach.
              */}
              <p>Danach sehen alle Angehörigen diese Aufgabe. Das lässt sich nicht zurücknehmen.</p>
              <div className={stile.knoepfe}>
                <Button
                  volleBreite
                  disabled={aktionen.gesperrt}
                  onClick={() => {
                    setzeFragt(null)
                    aktionen.gibFuerAlleFrei()
                  }}
                >
                  Ja, für alle sichtbar machen
                </Button>
                <Button volleBreite variante="sekundaer" onClick={() => setzeFragt(null)}>
                  Abbrechen
                </Button>
              </div>
            </div>
          ) : (
            <Button
              volleBreite
              variante="sekundaer"
              disabled={aktionen.gesperrt}
              onClick={() => setzeFragt('freigabe')}
            >
              Für alle sichtbar machen
            </Button>
          )}
        </Abschnitt>
      ) : null}

      {/*
        §7: Die Zuweisung ist eine Bearbeitungssperre, kein Zugriffsschutz (§3.3,
        §11). Sie steht deshalb offen für jede:n — auch das Freigeben, denn in
        einer Familie fällt jemand aus, und eine Aufgabe, die niemand mehr
        freigeben kann, blockiert eine gesetzliche Frist.
      */}
      <Abschnitt titel="Wer kümmert sich?">
        <Zuweisungsfeld
          gross
          zuweisung={aufgabe.assignee}
          ich={ich}
          gesperrt={aktionen.gesperrt}
          aufSetzen={aktionen.weiseZu}
        />
      </Abschnitt>

      <Abschnitt titel="Schritte">
        {unteraufgaben.length === 0 ? (
          <p className={stile.hinweis}>Noch keine. Ein Schritt teilt die Arbeit auf.</p>
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

        {aufgabe.privat ? (
          /*
           * §3.7: Private Aufgaben sind immer Wurzelaufgaben. Ein Schritt
           * darunter läge unter `K_c` und stünde bei den anderen ohne
           * Elternaufgabe auf der Wurzelebene — und verriete nebenbei, dass es
           * hier etwas gibt, das sie nicht sehen.
           */
          <p className={stile.hinweis}>
            Eine Aufgabe nur für Sie steht für sich. Machen Sie sie für alle sichtbar, wenn Sie
            sie aufteilen möchten.
          </p>
        ) : aufgabe.parentId === null ? (
          <form
            className={stile.formular}
            onSubmit={(ereignis) => void legeUnteraufgabeAn(ereignis)}
          >
            <div className={stile.feld}>
              <label htmlFor="neue-unteraufgabe">Ein Schritt mehr</label>
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
              Schritt hinzufügen
            </Button>
          </form>
        ) : (
          // Eine Ebene, keine Verschachtelung (§7).
          <p className={stile.hinweis}>
            Diese Aufgabe ist selbst ein Schritt. Tiefer gliedert die App nicht.
          </p>
        )}
      </Abschnitt>

      {/*
        §7: "Dokument abfotografieren": Die Sterbeurkunde gehört an die
        Aufgabe, für die sie gebraucht wird.
      */}
      <Dokumente
        flach
        fall={fall}
        aufgabeId={aufgabe.id}
        zeilen={zeilen}
        aktualisiere={aktualisiere}
        darfAendern={darfAendern}
      />

      <Abschnitt titel="Notizen">
        <form className={stile.formular} onSubmit={(ereignis) => void speichereNotizen(ereignis)}>
          <div className={stile.feld}>
            <label htmlFor="notizen">Was Sie sich merken möchten</label>
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
      </Abschnitt>

      {/*
        §5: Löschen gewinnt endgültig, die Datenbank weist eine Auferstehung ab.
        Das gehört vor die Aktion gesagt und nicht danach.
      */}
      {darfAendern ? (
        <Abschnitt titel="Aufgabe löschen">
          {fragt === 'loeschen' ? (
            <div className={stile.frage}>
              <p>„{aufgabe.titel}“ wirklich löschen? Gelöschtes kommt nicht zurück.</p>
              <div className={stile.knoepfe}>
                <Button
                  volleBreite
                  disabled={aktionen.gesperrt}
                  onClick={() => {
                    setzeFragt(null)
                    aktionen.loescheDiese()
                  }}
                >
                  Ja, löschen
                </Button>
                <Button volleBreite variante="sekundaer" onClick={() => setzeFragt(null)}>
                  Abbrechen
                </Button>
              </div>
            </div>
          ) : (
            <Button
              volleBreite
              variante="sekundaer"
              className={stile.gefahrknopf}
              disabled={aktionen.gesperrt}
              onClick={() => setzeFragt('loeschen')}
            >
              Diese Aufgabe löschen
            </Button>
          )}
        </Abschnitt>
      ) : null}
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
    setzeAnfechtungKenntnisAm,
  } = useAufgaben(fall)

  const navigate = useNavigate()

  const [laeuft, setzeLaeuft] = useState(false)
  const [fehler, setzeFehler] = useState<string | null>(null)

  /** §5: Was hier ankommt, steht danach als Meldung auf dem Bildschirm. */
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

  if (zustand.status === 'laedt') {
    return <Ladeanzeige text="Ihre Aufgaben werden geladen…" />
  }

  const knoten = knotenZu(zustand.aufgaben, id)

  if (knoten === null) {
    /*
     * Ein leerer Cache und ein laufender erster Abruf sind nicht dasselbe wie
     * eine gelöschte Aufgabe (§5).
     */
    return zustand.laedtNetz ? (
      <Ladeanzeige text="Ihre Aufgaben werden geladen…" />
    ) : (
      <p className={stile.warnung} role="alert">
        Diese Aufgabe gibt es nicht mehr. Gelöschtes kommt nicht zurück.
      </p>
    )
  }

  return (
    <>
      {fehler === null ? null : (
        <p className={stile.warnung} role="alert">
          {fehler}
        </p>
      )}

      {zustand.netzfehler === null ? null : (
        <p className={stile.warnung} role="alert">
          Ihre Aufgaben sind gerade nicht abrufbar. {zustand.netzfehler}
        </p>
      )}

      {uebernahmen.length === 0 ? null : (
        <Uebernahmen
          form="flach"
          uebernahmen={uebernahmen}
          aufBestaetigen={bestaetigeUebernahmen}
        />
      )}

      {/*
        `key`: Der Screen bleibt beim Wechsel von einer Aufgabe zur nächsten an
        derselben Stelle im Baum, und React behielte sonst den Zustand des
        Formulars. Ein angefangener Notizentwurf stünde dann im Feld der anderen
        Aufgabe.
      */}
      <Detail
        key={knoten.aufgabe.id}
        knoten={knoten}
        fall={fall}
        fristbezug={fristbezug}
        ich={ich}
        zeilen={zeilen}
        aktualisiere={aktualisiere}
        aktionen={{
          gesperrt: laeuft,
          weiseZu: (zuweisung) => void fuehreAus(() => weiseZu(knoten.aufgabe, zuweisung)),
          hakeAb: (aufgabe, erledigt) => fuehreAus(() => hakeAb(aufgabe, erledigt)),
          schreibeNotizen: (notizen) => fuehreAus(() => schreibe(knoten.aufgabe, { notizen })),
          speichereTitel: (titel) => fuehreAus(() => schreibe(knoten.aufgabe, { titel })),
          legeUnteraufgabeAn: (titel) => fuehreAus(() => legeAn(titel, knoten.aufgabe.id)),
          loesche: (aufgabe) => void fuehreAus(() => loesche(aufgabe)),
          /*
            Nach dem Löschen steht dieser Screen vor einer Aufgabe, die es nicht
            mehr gibt. Statt "Diese Aufgabe gibt es nicht mehr" zu zeigen — was
            richtig, aber ratlos wäre — geht es zurück in die Liste, aus der man
            gekommen ist.
          */
          loescheDiese: () =>
            void fuehreAus(async () => {
              await loesche(knoten.aufgabe)
              navigate('/alle')
            }),
          gibFuerAlleFrei: () => void fuehreAus(() => gibFuerAlleFrei(knoten.aufgabe)),
          speichereKenntnisAm: (datum) => fuehreAus(() => setzeKenntnisAm(datum)),
          speichereAnfechtungKenntnisAm: (datum) =>
            fuehreAus(() => setzeAnfechtungKenntnisAm(datum)),
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
        <Zurueck ziel="/alle" />
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
      <Zurueck ziel="/alle" />

      {zustand.status === 'fehler' ? (
        <p className={stile.warnung} role="alert">
          Ihre Aufgaben sind gerade nicht abrufbar. {zustand.nachricht}
        </p>
      ) : zustand.aktiver.zustand === 'gesperrt' ? (
        <p className={stile.warnung} role="alert">
          Dieser Fall ist auf diesem Gerät gesperrt. {zustand.aktiver.grund}
        </p>
      ) : (
        <Aufgabenbereich fall={zustand.aktiver} id={id} />
      )}
    </main>
  )
}
