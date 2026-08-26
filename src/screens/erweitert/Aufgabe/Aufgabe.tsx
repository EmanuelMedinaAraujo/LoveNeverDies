import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'
import type { InhaltZeile } from '../../../core/db/inhalte.ts'
import { alsNachricht } from '../../../core/fehler.ts'
import { useAufgaben, type Neuangaben } from '../../../hooks/useAufgaben.ts'
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
import { Badge, type Badgelage } from '../../../ui/Badge/Badge.tsx'
import { Button } from '../../../ui/Button/Button.tsx'
import { Card } from '../../../ui/Card/Card.tsx'
import { Checkbox } from '../../../ui/Checkbox/Checkbox.tsx'
import { Dialog } from '../../../ui/Dialog/Dialog.tsx'
import { Detailziel, Liste, Zeile } from '../../../ui/Liste/Liste.tsx'
import { Zurueck } from '../../../ui/Zurueck/Zurueck.tsx'
import {
  GerichtNachschlagen,
  istGerichtStelle,
} from '../../shared/Gericht/GerichtNachschlagen.tsx'
import { aktualisiereNotizMitGericht } from '../../../services/gerichtService.ts'
import type { Nachlassgericht } from '../../../types/gericht.ts'
import {
  darfAbhaken,
  darfBearbeiten,
  zuweisungText,
  type Zugewiesene,
  type Zuweisung,
} from '../../../services/zuweisung.ts'
import { Uebernahmen } from '../../shared/Meldungen/Meldungen.tsx'
import { Dokumente } from '../../shared/Dokumente/Dokumente.tsx'
import { fallLadeText } from '../../shared/Ladeanzeige/FallLadeanzeige.tsx'
import { Zuweisungsfeld } from '../../shared/Zuweisung/Zuweisungsfeld.tsx'
import {
  AnfechtungInfo,
  AusschlagungInfo,
  ErbscheinInfo,
} from '../../shared/Erbe/ErbscheinInfo.tsx'
import stile from './Aufgabe.module.css'

/**
 * Das ganzseitige Aufgabendetail (DESIGN.md §7, §8).
 *
 * Der Screen mit allem, was an einer Aufgabe hängt: die Frist, die zuständige
 * Stelle, die benötigten Dokumente, Notizen, Unteraufgaben und wovon die
 * Aufgabe abhängt. Alles davon steht im Item selbst, beim Instanziieren aus
 * dem Katalog kopiert (§8) und seither mit der Aufgabe gealtert. Was hier zu
 * lesen ist, ist der Stand, nach dem jemand gehandelt hat, und nicht der von
 * heute.
 *
 * Das Fristende steht nirgends gespeichert: Es wird bei jedem Rendern aus
 * `{fristTage, fristAb}` und dem Sterbedatum gerechnet (§8, `fristen.ts`).
 *
 * Unteraufgaben sind eigene Zeilen. Abgehakt wird jede für sich; die
 * Elternaufgabe hat dann kein eigenes Häkchen mehr und gilt genau dann als
 * erledigt, wenn alle Kinder es sind (§7). Eine neue kommt über ein Plus an
 * der Karte hinzu, und jede Zeile führt in ihr eigenes Detail — dieselbe Form
 * wie in "Alle", damit eine Unteraufgabe nicht aussieht wie eine andere Art
 * Sache, nur weil sie unter einer Aufgabe steht.
 *
 * **Zwei Dinge speichern von selbst: die Frist und die Notizen.** Ein Feld mit
 * einer Schaltfläche daneben ist eine Zusage, die man einlösen muss; wer den
 * Tag einträgt und weiterscrollt, hat ihn nicht eingetragen. Auf einem Telefon
 * passiert genau das, weil die Tastatur die Schaltfläche verdeckt, die man
 * danach hätte drücken sollen (§5, §7).
 *
 * **Gelöscht wird oben rechts, nach Rückfrage im Dialog.** Es ist die einzige
 * Aktion in diesem Screen, die etwas wegnimmt, und sie stand vorher als
 * Abschnitt unter den Notizen — ganz unten auf einer Seite, die leicht dreimal
 * so hoch ist wie ein Telefon.
 *
 * Die erweiterte Fassung dieses Screens (§7). Die einfache steht daneben in
 * `screens/einfach/Aufgabe`; sie zeigt dieselbe Aufgabe mit weniger darauf —
 * ohne Namensliste in der Zuweisung und ohne den Weg von jeder
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
/**
 * Die obere Leiste: der Weg zurück links, Platz für eine Aktion rechts.
 *
 * Rechts steht in diesem Screen genau eine, und es ist die einzige, die etwas
 * wegnimmt: Löschen. Sie stand vorher als Abschnitt unter den Notizen — ganz
 * unten auf einer Seite, die mit Frist, Zuständigkeit, Unteraufgaben und
 * Dokumenten leicht dreimal so hoch ist wie ein Telefon. Wer eine Aufgabe
 * wegwerfen will, scrollte an allem vorbei, was sie ausmacht.
 *
 * Oben rechts ist auf einem Telefon die Ecke, in der eine Aktion zu dem steht,
 * was der Bildschirm gerade zeigt. Dass sie ausgerechnet dort steht, macht sie
 * nicht harmloser: Die Rückfrage kommt als Dialog, mit dem Titel der Aufgabe
 * darin, und "Endgültig löschen" steht nicht dort, wo eben noch "Löschen"
 * stand.
 */
function Kopfleiste({ aktion }: { aktion?: ReactNode }) {
  return (
    <div className={stile.leiste}>
      <Zurueck ziel="/alle" />
      {aktion}
    </div>
  )
}

/** Das Plus an einer Karte: „hier kommt eine dazu". */
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

/** Der Mülleimer oben rechts. */
function Muelleimer() {
  return (
    <svg
      className={stile.muelleimer}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 7h16M10 4h4M6 7l1 13h10l1-13M10 11v6M14 11v6" />
    </svg>
  )
}

/**
 * Ein gesperrtes Feld, das auf einen Fingertipp sagt, warum es gesperrt ist.
 *
 * §7 sperrt das Bearbeiten an der Zuweisung, und die steht in der
 * Zuständigkeitskarte — einmal, nicht als Erklärung neben jedem Feld. Bis
 * hierher hiess das aber: Wer auf das Datumsfeld tippt, bekommt gar nichts.
 * Ein Feld, das auf nichts reagiert, sieht auf einem Telefon aus wie ein
 * kaputtes Feld, nicht wie ein gesperrtes, und der Grund steht drei Karten
 * weiter unten.
 *
 * Der Satz erscheint deshalb erst auf den Tipp hin: Wer nichts anfassen will,
 * liest ihn nie; wer es versucht, bekommt genau dann die Antwort, in der er
 * die Frage gestellt hat. Als `role="alert"`, damit eine Vorlesestimme ihn
 * mitbekommt, ohne dass der Fokus springt.
 *
 * Der Tipp landet auf dieser Hülle und nicht auf dem Feld: Ein `disabled`
 * Bedienelement bekommt in keinem Browser ein Klickereignis, und ob es zum
 * Elternelement durchgeht, ist von Browser zu Browser verschieden. Die CSS
 * nimmt dem gesperrten Feld deshalb die `pointer-events`, und der Tipp trifft
 * die Hülle.
 */
function Sperre({
  gesperrt,
  wer,
  children,
}: {
  gesperrt: boolean
  /** Wem die Aufgabe gerade gehört, für den Satz. */
  wer: string
  children: ReactNode
}) {
  const [gefragt, setzeGefragt] = useState(false)

  if (!gesperrt) {
    return children
  }

  return (
    <div className={stile.sperre} onClick={() => setzeGefragt(true)}>
      {children}

      {gefragt ? (
        <p className={stile.warnung} role="alert">
          {wer === 'Niemand zugewiesen'
            ? 'Weisen Sie sich die Aufgabe erst zu, um sie zu bearbeiten.'
            : `Zuständig: ${wer}. Zum Bearbeiten übernehmen Sie die Aufgabe unter „Zuständigkeit“`}
        </p>
      ) : null}
    </div>
  )
}

/** Das Kreuz, das ein Feld wieder leert. */
function Kreuz() {
  return (
    <svg
      className={stile.kreuz}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="m6 6 12 12M18 6 6 18" />
    </svg>
  )
}

/** Wo ein Feld zwischen "getippt" und "liegt auf dem Server" gerade steht. */
type Speicherstand = 'ruht' | 'wartet' | 'gespeichert'

/**
 * Speichert von selbst, kurz nachdem jemand aufgehört hat zu tippen (§5, §7).
 *
 * Ein Feld mit einer Schaltfläche daneben ist eine Zusage, die man einlösen
 * muss: Wer den Tag einträgt und weiterscrollt, hat ihn nicht eingetragen. Auf
 * einem Telefon passiert genau das, weil die Tastatur die Schaltfläche
 * verdeckt, die man danach hätte drücken sollen. Die Frist, die dann fehlt,
 * ist die eine Angabe, wegen der dieser Screen überhaupt da ist (§8).
 *
 * Genau ein Versuch je Wert, und das ist der Unterschied zwischen "speichert
 * von selbst" und einer Schleife: Weist der Server die Änderung ab, bleibt der
 * getippte Wert stehen und der gespeicherte daneben — die Bedingung "es gibt
 * etwas zu speichern" bliebe für immer wahr, und der Screen versuchte es alle
 * 800 ms erneut. Wer weiterkommen will, ändert etwas; das ist ein neuer Wert
 * und damit ein neuer Versuch.
 *
 * @param eingabe was im Feld steht.
 * @param gespeichert was im Bestand steht.
 * @param gesperrt solange eine andere Mutation läuft. Dann wird gewartet, statt
 * zwei Änderungen ineinander zu schieben.
 */
function useAutospeichern(
  eingabe: string,
  gespeichert: string,
  gesperrt: boolean,
  speichere: () => void,
): Speicherstand {
  /*
   * Die Funktion kommt bei jedem Rendern neu herein: Die Screens schreiben sie
   * inline. Im Ref gelesen, hängt der Wecker unten nicht an ihrer Identität und
   * fängt nicht bei jedem Tastendruck von vorn an.
   */
  const speichereRef = useRef(speichere)

  useEffect(() => {
    speichereRef.current = speichere
  })

  const versucht = useRef<string | null>(null)
  const [stand, setzeStand] = useState<Speicherstand>('ruht')

  useEffect(() => {
    if (eingabe === gespeichert) {
      // Angekommen. Ob das eigene Tippen der Grund war oder eine Änderung von
      // einem anderen Gerät, spielt für die Meldung keine Rolle: Beides heisst,
      // dass hier nichts mehr aussteht.
      const gerade = versucht.current
      versucht.current = null
      setzeStand(gerade === null ? 'ruht' : 'gespeichert')
      return
    }

    if (gesperrt || versucht.current === eingabe) {
      return
    }

    setzeStand('wartet')

    const wecker = setTimeout(() => {
      versucht.current = eingabe
      speichereRef.current()
    }, 800)

    return () => clearTimeout(wecker)
  }, [eingabe, gespeichert, gesperrt])

  return stand
}

/** Was unter einem Feld steht, das von selbst speichert. */
function Speichermeldung({ stand }: { stand: Speicherstand }) {
  if (stand === 'ruht') {
    return null
  }

  return (
    <p className={stile.hinweis} role="status">
      {stand === 'wartet' ? 'Wird gespeichert…' : 'Gespeichert.'}
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
 * Frist, zuständige Stelle, Dokumente, Hinweis.
 *
 * Fehlt eine Angabe, steht sie nicht da. Ein "keine Frist" wäre eine Aussage,
 * die der Katalog nicht trifft: Fehlt eine gesetzliche Frist, bleibt das Feld
 * leer, erfunden wird nichts (§8).
 *
 * Kein Paragraph und kein Quelllink (ADR-0003): Eine Zeile "§ 1944 BGB" und ein
 * Link auf the Gesetzesseite lesen sich wie eine Rechtsberatung, und die gibt
 * diese App nicht. Deshalb heißt der Abschnitt auch nicht mehr "Rechtliches".
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
      <Card titel="Zuständige Stelle">
        <div className={stile.angaben}>
          {katalog.zustaendigeStelle === '' ? null : (
            <div>
              <span>{katalog.zustaendigeStelle}</span>
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
      </Card>
    )
  }

  if (istAusschlagungAufgabe(aufgabe)) {
    return (
      <Card titel="Zuständige Stelle">
        <div className={stile.angaben}>
          {katalog.zustaendigeStelle === '' ? null : (
            <div>
              <span>{katalog.zustaendigeStelle}</span>
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
      </Card>
    )
  }

  if (istErbscheinAufgabe(aufgabe)) {
    return (
      <Card titel="Zuständige Stelle">
        <div className={stile.angaben}>
          {katalog.zustaendigeStelle === '' ? null : (
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
      </Card>
    )
  }

  const schritte = katalog.unteraufgaben.filter((eintrag) => eintrag.trim() !== '')

  return (
    <Card titel="Das gilt dafür">
      <dl className={stile.angaben}>
        {/*
          §8: Nur bei gesetzten Fristen. Aufgaben ohne Frist tragen "ohne
          Frist" als Badge am Titel (§12); hier stünde sonst eine doppelte
          Auskunft.
        */}
        {lage.art === 'datum' ? (
          <Angabe was="Frist">
            endet am {datumText(lage.ende)} ({fristText(lage)})
          </Angabe>
        ) : null}

        {lage.art === 'unverzueglich' ? (
          <Angabe was="Frist">
            unverzüglich (ohne schuldhaftes Zögern)
          </Angabe>
        ) : null}

        {lage.art === 'ab-kenntnis' && !istAnfechtungAufgabe(aufgabe) ? (
          /*
            §8: Ohne Kenntnisdatum wird kein Ende gerechnet und keines
            geschätzt. Der Satz benennt den Grund, statt eine leere Angabe
            stehen zu lassen: Die Frist hängt an einem Tag, den nur diese
            Person kennt.
          */
          <Angabe was="Frist">
            Diese Frist läuft ab <em>Ihrer</em> Kenntnis und beträgt 6 Wochen ({katalog.fristTage} Tage):
            Im Normalfall (gesetzliche Erbfolge) ab dem Moment, in dem Sie erfahren, dass die Person
            gestorben ist und Sie gesetzlich erben; bei Testament oder Erbvertrag erst ab der offiziellen
            Eröffnung und Mitteilung durch das Nachlassgericht. Tragen Sie das Datum unten ein, dann
            rechnet die App das genaue Ende aus.
          </Angabe>
        ) : null}

        {katalog.zustaendigeStelle === '' ? null : (
          <Angabe was="Zuständige Stelle">
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
              <Angabe was="Benötigte Dokumente">
                <ul className={stile.punkte}>
                  {dokumente.map((dokument) => (
                    <li key={dokument}>{dokument}</li>
                  ))}
                </ul>
              </Angabe>
            )}

            {schritte.length === 0 ? null : (
              <Angabe was="Diese Schritte gehören dazu">
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
    </Card>
  )
}

/**
 * Eine Unteraufgabe: abhaken, oder in ihr eigenes Detail (§7).
 *
 * Dieselbe Zeile wie in "Alle", mit denselben Teilen: Häkchen links, der Weg
 * ins Detail über die ganze Zeile, ein Winkel am Ende, der ihn ansagt. Vorher
 * standen darunter zwei Textaktionen, "Zuständigkeit ändern" und "Löschen".
 * Die erste war ein Link ins Detail, der etwas Engeres versprach, als er tat —
 * dort steht die Zuständigkeit, aber auch die Frist, die Beschreibung, die
 * Dokumente. Die zweite war die einzige Aktion in dieser Liste, die etwas
 * wegnimmt, und sie stand unter jeder Zeile.
 *
 * Gelöscht wird jetzt in der Aufgabe selbst, oben rechts, wie bei jeder
 * anderen auch: ein Weg statt zweier, und der Weg dorthin führt an dem vorbei,
 * was gleich verschwindet.
 */
function Unteraufgabenzeile({
  unteraufgabe,
  gesperrt,
  ichUserId,
  aufHaken,
}: {
  unteraufgabe: Aufgabendatensatz
  gesperrt: boolean
  /** Die angemeldete Person. Eine Unteraufgabe hat ihre eigene Zuweisung (§7). */
  ichUserId: string
  aufHaken: (erledigt: boolean) => Promise<boolean>
}) {
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

  /*
   * Eine Unteraufgabe ist eine Zeile wie jede andere (§7) und trägt deshalb
   * ihre eigene Zuweisung. Eine Familie teilt sich eine Aufgabe auf: Die Bank
   * ruft der eine an, zum Standesamt geht die andere, und wer nicht
   * eingetragen ist, hakt hier nichts ab.
   */
  const darfHaken = darfAbhaken(unteraufgabe.assignee, ichUserId)

  return (
    <Zeile>
      <div className={stile.unterspalte}>
        {/*
          Wer nicht abhaken darf, sieht kein Kästchen. Ein graues Kästchen ist
          eine Einladung, die nicht gilt; der Titel allein sagt dasselbe, ohne
          etwas anzubieten.
        */}
        {darfHaken ? (
          <Checkbox
            abhaken
            checked={erledigt}
            disabled={gesperrt}
            onChange={(ereignis) => void haken(ereignis.target.checked)}
            label={unteraufgabe.titel}
            nurKaestchen
          />
        ) : (
          <p className={erledigt ? stile.fertig : undefined}>{unteraufgabe.titel}</p>
        )}

        <p className={stile.hinweis}>{zuweisungText(unteraufgabe.assignee, ichUserId)}</p>
      </div>

      <Detailziel ziel={`/aufgabe/${unteraufgabe.id}`} titel={unteraufgabe.titel} />
    </Zeile>
  )
}

/**
 * Das Formular für eine Unteraufgabe, in einem Dialog (§7).
 *
 * Dasselbe Muster und dieselben Felder wie das Plus über der Aufgabenliste,
 * und aus demselben Grund: Das Formular stand als Feld samt Schaltfläche unter
 * der Liste, also unter etwas, das mit jeder Unteraufgabe länger wird. Wer die
 * dritte hinzufügen wollte, scrollte an den ersten beiden vorbei; wer nur
 * nachsehen wollte, was noch offen ist, scrollte am Formular vorbei.
 *
 * Beschreibung und Frist stehen auch hier: Eine Unteraufgabe ist eine Zeile
 * wie jede andere (§7) und hat ihre eigene Frist — "Sterbeurkunden bestellen"
 * bis Freitag, "Termin machen" bis übermorgen. Sie sind der Grund, warum
 * Unteraufgaben eigene Zeilen sind und keine Liste im Payload.
 *
 * Was hier fehlt, ist der Schalter "Nur für mich" — und zwar zwingend: §3.7
 * legt private Aufgaben immer auf die Wurzelebene. Eine private Unteraufgabe
 * läge unter `K_p`, und dieselbe Elternaufgabe hätte für ihre Besitzerin drei
 * Kinder und für alle anderen zwei; der abgeleitete Abschluss zeigte der einen
 * "erledigt" und der anderen "offen". Es gibt hier deshalb keinen Schalter,
 * über den jemand das verlangen könnte.
 */
function NeueUnteraufgabe({
  gesperrt,
  aufSchliessen,
  aufAnlegen,
}: {
  gesperrt: boolean
  aufSchliessen: () => void
  /** `false`, wenn nichts gespeichert wurde. Der Dialog bleibt dann offen. */
  aufAnlegen: (titel: string, angaben: Neuangaben) => Promise<boolean>
}) {
  const [titel, setzeTitel] = useState('')
  const [beschreibung, setzeBeschreibung] = useState('')
  const [fristAm, setzeFristAm] = useState('')

  /*
   * `required` allein liesse einen Titel aus lauter Leerzeichen durch; der
   * Dienst weist ihn dann ab, und die Meldung landet weit weg von diesem Feld.
   */
  const bereit = !gesperrt && titel.trim() !== ''
  const formularId = 'neue-unteraufgabe-formular'

  async function anlegen(ereignis: FormEvent) {
    ereignis.preventDefault()

    const gespeichert = await aufAnlegen(titel, {
      beschreibung: beschreibung.trim(),
      fristAm: fristAm === '' ? null : fristAm,
    })

    if (gespeichert) {
      aufSchliessen()
    }
  }

  return (
    <Dialog
      titel="Neue Unteraufgabe"
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
          <label htmlFor="neue-unteraufgabe">Was ist zu tun?</label>
          <input
            id="neue-unteraufgabe"
            className={stile.eingabe}
            value={titel}
            onChange={(ereignis) => setzeTitel(ereignis.target.value)}
            required
            autoFocus
          />
        </div>

        <div className={stile.feld}>
          <label htmlFor="neue-unteraufgabe-beschreibung">Beschreibung (optional)</label>
          <textarea
            id="neue-unteraufgabe-beschreibung"
            className={stile.eingabe}
            rows={3}
            value={beschreibung}
            onChange={(ereignis) => setzeBeschreibung(ereignis.target.value)}
          />
        </div>

        <div className={stile.feld}>
          <label htmlFor="neue-unteraufgabe-frist">Erledigt bis (optional)</label>
          <input
            id="neue-unteraufgabe-frist"
            type="date"
            className={stile.eingabe}
            value={fristAm}
            onChange={(ereignis) => setzeFristAm(ereignis.target.value)}
          />
        </div>

        <Button type="submit" volleBreite disabled={!bereit}>
          Unteraufgabe speichern
        </Button>
      </form>
    </Dialog>
  )
}

/**
 * Die selbst gesetzte Frist dieser Aufgabe (§7).
 *
 * Sie gehört der Aufgabe und nicht der Person: Wer sich mit den Geschwistern
 * auf einen Tag einigt, meint diesen Tag für alle. Das unterscheidet sie vom
 * Kenntnisdatum darunter, das ausdrücklich privat ist (§3.7, #12).
 *
 * Sie ersetzt die gesetzliche Frist nicht, sie tritt daneben: Angezeigt wird
 * die frühere von beiden (`fristen.ts`). Ein selbst eingetragener späterer Tag
 * darf eine Ausschlagungsfrist nicht vom Bildschirm nehmen — das ist der eine
 * Fehler, den §8 teuer nennt. Dass beides gilt, steht in der Karte und nicht
 * nur im Code: Wer ein Datum einträgt und daraufhin ein anderes im Badge
 * liest, hält das sonst für einen Defekt.
 */
function Eigenefrist({
  fristAm,
  gesetzlich,
  laeuft,
  darfAendern,
  zustaendig,
  aufSpeichern,
}: {
  /** Das eingetragene Datum, oder `null`. */
  fristAm: string | null
  /** Die gesetzliche Frist derselben Aufgabe, ohne die eigene gerechnet (§8). */
  gesetzlich: Fristlage
  /**
   * Ob gerade eine Mutation unterwegs ist. Sie hält das Autospeichern an, aber
   * nicht das Feld: Ein Eingabefeld, das für den Moment eines Rundlaufs
   * `disabled` wird, verliert den Fokus, und die Schreibmarke steht danach
   * nirgends. Wer weitertippt, während gespeichert wird, tippt weiter.
   */
  laeuft: boolean
  /** §7: Bearbeiten darf nur, wem die Aufgabe zugewiesen ist. */
  darfAendern: boolean
  /** Wem sie gerade gehört, für den Satz hinter dem gesperrten Feld. */
  zustaendig: string
  /** @returns ob gespeichert wurde. Sonst bleibt das Feld, wie es ist. */
  aufSpeichern: (datum: string | null) => Promise<boolean>
}) {
  const [eingabe, setzeEingabe] = useState(fristAm ?? '')
  const [gespeichert, setzeGespeichert] = useState(fristAm)

  // Was der Bestand bringt, gewinnt, aber erst, wenn er sich wirklich geändert
  // hat: dieselbe Überlegung wie bei den Notizen und beim Kenntnisdatum.
  if (gespeichert !== fristAm) {
    setzeGespeichert(fristAm)
    setzeEingabe(fristAm ?? '')
  }

  const stand = useAutospeichern(eingabe, fristAm ?? '', laeuft || !darfAendern, () => {
    void aufSpeichern(eingabe === '' ? null : eingabe)
  })

  return (
    /*
       Der Titel und das Feld stehen in einer Zeile. "Frist" ist ein Wort, und
       eine Überschrift über einem einzeiligen Datumsfeld machte aus einer
       Angabe zwei Zeilen — auf einem Screen, der ohnehin sechs Karten hoch
       ist. Der Name für die Vorlesestimme steht trotzdem am Feld: Sie liest
       die Kartenüberschrift nicht mit vor (§7).

       Ein erklärender Satz steht nicht mehr da. "Frist" über einem Datumsfeld
       beantwortet die Frage "bis wann?" von selbst.
    */
    <Card
      titel="Frist"
      neben={
        <Sperre gesperrt={!darfAendern} wer={zustaendig}>
          <div className={stile.fristzeile}>
            <input
              id="frist-am"
              type="date"
              className={stile.eingabe}
              aria-label="Frist"
              value={eingabe}
              disabled={!darfAendern}
              onChange={(ereignis) => setzeEingabe(ereignis.target.value)}
            />

            {/*
              Das Feld leeren geht auf jedem Telefon anders und auf manchem
              gar nicht; deshalb gibt es den Weg auch als Schaltfläche. Sie
              steht rechts *in* der Zeile und nicht als eigener Kasten
              darunter: Sie gehört zu diesem einen Feld.

              Sie erscheint, sobald etwas im Feld steht — auch wenn es noch
              nicht gespeichert ist. Das Kreuz leert, was man sieht; alles
              andere wäre die Frage, welchen der beiden Stände es meint.
            */}
            {eingabe === '' || !darfAendern ? null : (
              <Button
                variante="text"
                className={stile.entfernen}
                disabled={laeuft}
                vorleseText="Frist entfernen"
                onClick={() => {
                  setzeEingabe('')

                  // Nur, wenn wirklich etwas gespeichert ist: Ein halb
                  // getipptes Datum wegzunehmen ist keine Änderung.
                  if (fristAm !== null) {
                    void aufSpeichern(null)
                  }
                }}
              >
                <Kreuz />
              </Button>
            )}
          </div>
        </Sperre>
      }
    >
      {gesetzlich.art === 'datum' ? (
        <p className={stile.hinweis}>
          Für diese Aufgabe gilt schon eine gesetzliche Frist bis zum{' '}
          {datumText(gesetzlich.ende)}. Ihr eigenes Datum ersetzt sie nicht: Angezeigt wird die
          frühere der beiden.
        </p>
      ) : gesetzlich.art === 'unverzueglich' ? (
        <p className={stile.hinweis}>
          Diese Aufgabe ist unverzüglich zu erledigen, also ohne schuldhaftes Zögern. Das bleibt
          so, gleich welches Datum Sie hier eintragen.
        </p>
      ) : null}

      <Speichermeldung stand={stand} />
    </Card>
  )
}

/**
 * Der Titel dieser Aufgabe (DESIGN.md §7, §3.5).
 *
 * Bis hierher liess sich ein Titel nur beim Anlegen setzen und danach nie
 * wieder ändern — ein Vertipper stand für immer in der Liste.
 *
 * Nur bei selbst angelegten Aufgaben. Der Titel einer Katalogaufgabe ist
 * Rechtstext (§8): Er steht in der Inhaltsschicht, gilt für alle Fälle
 * gleich, und was hier stünde, wäre eine Änderung an einer Kopie davon.
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
  // hat: dieselbe Überlegung wie bei den Notizen und bei der Frist.
  if (gespeichert !== titel) {
    setzeGespeichert(titel)
    setzeEingabe(titel)
  }

  async function speichere(ereignis: FormEvent) {
    ereignis.preventDefault()
    await aufSpeichern(eingabe.trim())
  }

  return (
    <Card titel="Titel">
      <p className={stile.hinweis}>
        Wie soll diese Aufgabe heissen? Alle Mitglieder des Falls sehen denselben Titel.
      </p>

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

        {/*
          `required` allein liesse einen Titel aus lauter Leerzeichen durch;
          der Dienst weist ihn dann ab, und die Meldung landet weit weg von
          diesem Feld (§5).
        */}
        <Button
          type="submit"
          volleBreite
          disabled={gesperrt || eingabe.trim() === '' || eingabe.trim() === titel}
        >
          Titel speichern
        </Button>
      </form>
    </Card>
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
    <Card titel="Ihr Kenntnisdatum">
      <p>
        An welchem Tag haben Sie von der Erbschaft erfahren (bzw. an welchem Tag hat das
        Nachlassgericht das Testament eröffnet)? Ab diesem Tag laufen
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
    legeUnteraufgabeAn: (titel: string, angaben: Neuangaben) => Promise<boolean>
    weiseZu: (zuweisung: Zuweisung) => void
    /** Wrappt den DEK von `K_p` auf `K_c` (§3.7). */
    gibFuerAlleFrei: () => void
    /** Legt das eigene Kenntnisdatum ab oder ändert es (§8, #12). */
    speichereKenntnisAm: (datum: string | null) => Promise<boolean>
    /** Setzt die selbst gewählte Frist dieser Aufgabe, oder entfernt sie (§7). */
    speichereFrist: (datum: string | null) => Promise<boolean>
    /** Benennt eine selbst angelegte Aufgabe um (§7). */
    speichereTitel: (titel: string) => Promise<boolean>
    aufLoeschen: () => void
  }
}) {
  const { aufgabe, unteraufgaben, istBlatt, erledigt, blockiertVon } = knoten
  const heute = heuteIso()
  const lage = fristlage(aufgabe.katalog, fristbezug, heute, aufgabe.fristAm)
  /*
   * Ohne die eigene Frist: Die Karte "Frist" erklärt damit, was daneben noch
   * gilt. Aus `lage` allein wäre das nicht zu lesen — dort steht bereits die
   * frühere der beiden, und welche das ist, ist genau die Frage.
   */
  const gesetzlicheFrist = fristlage(aufgabe.katalog, fristbezug, heute)
  const badge = fristText(lage)

  const [notizen, setzeNotizen] = useState(aufgabe.notizen)
  const [gespeicherteNotizen, setzeGespeicherteNotizen] = useState(aufgabe.notizen)
  const [legtUnteraufgabeAn, setzeLegtUnteraufgabeAn] = useState(false)
  const [fragtFreigabe, setzeFragtFreigabe] = useState(false)

  // Was der Bestand bringt, gewinnt, aber erst, wenn er sich wirklich
  // geändert hat. Sonst überschriebe jede Türklingel den halb getippten Satz.
  if (gespeicherteNotizen !== aufgabe.notizen) {
    setzeGespeicherteNotizen(aufgabe.notizen)
    setzeNotizen(aufgabe.notizen)
  }

  async function speichereGerichtNotiz(gericht: Nachlassgericht, plz: string) {
    const neueNotizen = aktualisiereNotizMitGericht(notizen, gericht, plz)
    setzeNotizen(neueNotizen)
    await aktionen.schreibeNotizen(neueNotizen)
  }

  const fertigeKinder = unteraufgaben.filter((unter) => unter.erledigt).length

  /*
   * §7: "Bearbeiten darf nur, wem sie zugewiesen ist." Gesperrt sind die
   * Notizen, neue Unteraufgaben und das Löschen, nicht das Lesen und nicht die
   * Zuweisung selbst. Wer nicht eingetragen ist, soll die
   * Rechtsgrundlage sehen und sich eintragen können; alles andere wäre eine
   * Mauer vor einer Aufgabe, die vielleicht gerade dringend ist.
   */
  const darfAendern = darfBearbeiten(aufgabe.assignee, ich.userId)
  const zustaendig = zuweisungText(aufgabe.assignee, ich.userId)

  const notizenStand = useAutospeichern(
    notizen,
    aufgabe.notizen,
    aktionen.gesperrt || !darfAendern,
    () => {
      void aktionen.schreibeNotizen(notizen)
    },
  )

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


        {/*
          Ob die Aufgabe erledigt ist, ist das Erste, was jemand hier wissen
          will — und deshalb steht es beim Titel. Abgehakt wird sie hier
          trotzdem nicht: Das eigene Häkchen im Detail und dasselbe Häkchen in
          der Liste sind zwei Wege zu einer Handlung, und einer davon liegt
          zwei Tipps tiefer. Es bleibt der in der Übersicht.
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
          <p className={stile.hinweis} role="status">
            {aufgabe.erledigt ? 'Erledigt.' : 'Offen. Abhaken können Sie sie in der Liste.'}
          </p>
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
        Beim Erbschein, der Testamentsanfechtung und der Ausschlagung
        stehen die Hintergrundinformationen als einklappbare Bereiche da.
      */}
      {istErbscheinAufgabe(aufgabe) ? (
        <ErbscheinInfo />
      ) : istAnfechtungAufgabe(aufgabe) ? (
        <AnfechtungInfo />
      ) : istAusschlagungAufgabe(aufgabe) ? (
        <>
          <p className={stile.hinweisKasten}>
            <strong className={stile.rot}>Hinweis:</strong> Wer Gegenstände aus dem Nachlass verkauft, verschenkt oder nutzt, nimmt das
            Erbe automatisch an. Danach kann das Erbe nicht mehr abgelehnt werden.
          </p>
          <AusschlagungInfo />
        </>
      ) : aktuelleBeschreibung(aufgabe) === '' ? null : (
        <p className={stile.anriss}>{mitFett(aktuelleBeschreibung(aufgabe))}</p>
      )}

      {/*
        Die eine Aufgabe, die noch aus dem Katalog kommt (ADR-0001), führt in
        den Fragebaum. Erkannt wird sie an ihrer Herkunft und nicht am Titel:
        Wer sie umbenennt, soll den Weg dorthin nicht verlieren.
      */}
      {istSeedAufgabe(aufgabe.katalog) ? <ZumFragebaum /> : null}

      {/*
        Der Titel steht ganz oben unter der Überschrift und nicht am Ende:
        Eine selbst angelegte Aufgabe lässt sich hier umbenennen (§7).
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
        lage={gesetzlicheFrist}
        aufGerichtGefunden={speichereGerichtNotiz}
        gesperrt={aktionen.gesperrt || !darfAendern}
      />

      {/*
        §7: Eine Frist lässt sich für jede Aufgabe eintragen, auch für eine
        selbst angelegte ohne Rechtsgrundlage. Gesperrt ist sie wie alles
        andere, was die Aufgabe ändert: Bearbeiten darf, wem sie zugewiesen ist.
      */}
      <Eigenefrist
        fristAm={aufgabe.fristAm}
        gesetzlich={gesetzlicheFrist}
        laeuft={aktionen.gesperrt}
        darfAendern={darfAendern}
        zustaendig={zustaendig}
        aufSpeichern={aktionen.speichereFrist}
      />

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
        <Card titel="Sichtbarkeit">
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
      ) : null}

      {/*
        §7: Die Zuweisung ist eine Bearbeitungssperre, kein Zugriffsschutz: Der
        Server kann eine Regel nicht durchsetzen, die er nicht lesen kann (§3.3,
        §11). Sie steht deshalb offen für jede:n: übernehmen und freigeben.
      */}
      <Card titel="Zuständigkeit">
        <Zuweisungsfeld
          zuweisung={aufgabe.assignee}
          ich={ich}
          gesperrt={aktionen.gesperrt}
          aufSetzen={aktionen.weiseZu}
        />
      </Card>

      {/*
        Eine Ebene, keine Verschachtelung (§7). Auf einer Unteraufgabe steht
        der Abschnitt deshalb gar nicht mehr: Vorher stand dort eine leere
        Karte mit dem Satz "Tiefer gliedert die App nicht" — eine Überschrift,
        eine Fläche und ein Absatz, um mitzuteilen, dass es hier nichts gibt.
        Das ist keine Auskunft, nach der jemand gesucht hat; es ist eine Karte,
        an der er vorbeiscrollt, um an die Dokumente zu kommen.

        Eine private Aufgabe teilt sich ebenfalls nicht auf (§3.7) — dort
        bleibt der Abschnitt aber stehen, mit dem Weg dorthin: Sie *kann*
        Unteraufgaben bekommen, sobald sie für alle sichtbar ist.
      */}
      {aufgabe.parentId !== null ? null : (
        <Card
          titel="Unteraufgaben"
          neben={
            aufgabe.privat ? null : (
              <Button
                variante="text"
                className={stile.plusknopf}
                disabled={aktionen.gesperrt || !darfAendern}
                onClick={() => setzeLegtUnteraufgabeAn(true)}
                vorleseText="Neue Unteraufgabe"
              >
                <Plus />
              </Button>
            )
          }
        >
          {unteraufgaben.length === 0 ? (
            <p className={stile.hinweis}>Noch keine. Eine Unteraufgabe teilt die Arbeit auf.</p>
          ) : (
            <Liste className={stile.unterliste}>
              {unteraufgaben.map((unteraufgabe) => (
                <Unteraufgabenzeile
                  key={unteraufgabe.id}
                  unteraufgabe={unteraufgabe}
                  gesperrt={aktionen.gesperrt}
                  ichUserId={ich.userId}
                  aufHaken={(gewuenscht) => aktionen.hakeAb(unteraufgabe, gewuenscht)}
                />
              ))}
            </Liste>
          )}

          {aufgabe.privat ? (
            /*
             * §3.7: Private Aufgaben sind immer Wurzelaufgaben. Eine
             * Unteraufgabe darunter läge unter `K_c` und wäre für die anderen
             * eine Aufgabe ohne Elternaufgabe: Sie stünde bei ihnen auf der
             * Wurzelebene und verriete nebenbei, dass es hier etwas gibt, das
             * sie nicht sehen. Wer aufteilen will, macht die Aufgabe zuerst
             * für alle sichtbar.
             */
            <p className={stile.hinweis}>
              Eine private Aufgabe steht für sich. Machen Sie sie für alle sichtbar, wenn Sie sie
              aufteilen möchten.
            </p>
          ) : null}

          {legtUnteraufgabeAn ? (
            <NeueUnteraufgabe
              gesperrt={aktionen.gesperrt}
              aufSchliessen={() => setzeLegtUnteraufgabeAn(false)}
              aufAnlegen={aktionen.legeUnteraufgabeAn}
            />
          ) : null}
        </Card>
      )}

      {/*
        §7: "Dokument abfotografieren": Die Sterbeurkunde gehört an die
        Aufgabe, für die sie gebraucht wird, und nicht in eine Ablage irgendwo
        sonst in der App.
      */}
      <Dokumente
        fall={fall}
        aufgabeId={aufgabe.id}
        zeilen={zeilen}
        aktualisiere={aktualisiere}
        darfAendern={darfAendern}
        zustaendig={zustaendig}
      />

      {/*
        Notizen speichern von selbst, wie die Frist darüber. Sie sind das Feld,
        in dem am längsten getippt wird -- eine Telefonnummer, ein Aktenzeichen,
        der Satz, den man dem Amt sagen wollte --, und damit das, bei dem eine
        vergessene Schaltfläche am meisten kostet.
      */}
      <Card titel="Notizen">
        <Sperre gesperrt={!darfAendern} wer={zustaendig}>
          <div className={stile.feld}>
            <label htmlFor="notizen">Ihre Notizen zu dieser Aufgabe</label>
            <textarea
              id="notizen"
              className={stile.eingabe}
              rows={4}
              value={notizen}
              /*
                Nur die Zuweisung sperrt das Feld, nicht die laufende Mutation:
                Ein `disabled` fuer die Dauer eines Rundlaufs nimmt mitten im
                Satz den Fokus weg, und die Schreibmarke steht danach nirgends.
              */
              disabled={!darfAendern}
              onChange={(ereignis) => setzeNotizen(ereignis.target.value)}
            />
          </div>
        </Sperre>

        <Speichermeldung stand={notizenStand} />
      </Card>

      {/*
        Löschen unten auf der Seite (§7): Dieselbe Aktion wie oben rechts im
        Kopf, hier als breite Schaltfläche am Ende der Seite.
      */}
      {darfAendern ? (
        <Button
          variante="sekundaer"
          className={stile.gefahrknopf}
          disabled={aktionen.gesperrt}
          onClick={aktionen.aufLoeschen}
          volleBreite
        >
          {aufgabe.parentId !== null ? 'Unteraufgabe löschen' : 'Aufgabe löschen'}
        </Button>
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
  } = useAufgaben(fall)

  const navigate = useNavigate()

  const [laeuft, setzeLaeuft] = useState(false)
  const [fehler, setzeFehler] = useState<string | null>(null)
  const [fragtLoeschen, setzeFragtLoeschen] = useState(false)

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
    return (
      <>
        <Kopfleiste />
        <Ladeanzeige text="Ihre Aufgaben werden geladen…" />
      </>
    )
  }

  const knoten = knotenZu(zustand.aufgaben, id)

  if (knoten === null) {
    /*
     * Ein leerer Cache und ein laufender erster Abruf sind nicht dasselbe wie
     * eine gelöschte Aufgabe (§5). Erst wenn der Abruf durch ist, darf hier
     * "gibt es nicht mehr" stehen.
     */
    return (
      <>
        <Kopfleiste />
        {zustand.laedtNetz ? (
          <Ladeanzeige text="Ihre Aufgaben werden geladen…" />
        ) : (
          <p className={stile.hinweis} role="alert">
            Diese Aufgabe gibt es nicht mehr. Gelöschte Aufgaben kommen nicht zurück.
          </p>
        )}
      </>
    )
  }

  /*
   * §7: "Bearbeiten darf nur, wem sie zugewiesen ist." Wer nicht eingetragen
   * ist, sieht die Aufgabe vollständig und findet in ihr den Weg, sie zu
   * übernehmen -- aber keinen, sie den anderen wegzunehmen.
   */
  const darfLoeschen = darfBearbeiten(knoten.aufgabe.assignee, ich.userId)

  /*
   * Nach dem Löschen stünde dieser Screen vor einer Aufgabe, die es nicht
   * mehr gibt. Statt "Diese Aufgabe gibt es nicht mehr" zu zeigen -- was
   * richtig, aber ratlos wäre -- geht es zurück in die Liste, aus der man
   * gekommen ist. Bei einer Unteraufgabe ebenso: Ihre Elternaufgabe steht
   * dort, einen Tipp weiter, und der Weg dorthin ist derselbe.
   */
  const zuLoeschen = knoten.aufgabe

  function loescheDiese() {
    setzeFragtLoeschen(false)

    void fuehreAus(async () => {
      await loesche(zuLoeschen)
      navigate('/alle')
    })
  }

  return (
    <>
      <Kopfleiste
        aktion={
          darfLoeschen ? (
            <Button
              variante="text"
              className={stile.loeschen}
              disabled={laeuft}
              onClick={() => setzeFragtLoeschen(true)}
              vorleseText={
                knoten.aufgabe.parentId !== null
                  ? `Unteraufgabe löschen: „${knoten.aufgabe.titel}“`
                  : `Aufgabe löschen: „${knoten.aufgabe.titel}“`
              }
            >
              <Muelleimer />
            </Button>
          ) : null
        }
      />

      {/*
        §5: "Löschen gewinnt endgültig, die Datenbank weist eine Auferstehung
        ab." Das gehört vor die Aktion gesagt und nicht danach — und in einem
        Dialog, weil die Frage sonst dort stünde, wo eben noch die Schaltfläche
        war, und ein zweiter Tipp an derselben Stelle sie beantwortet hätte,
        bevor jemand sie gelesen hat.
      */}
      {fragtLoeschen ? (
        <Dialog
          titel={knoten.aufgabe.parentId !== null ? 'Unteraufgabe löschen' : 'Aufgabe löschen'}
          aufSchliessen={() => setzeFragtLoeschen(false)}
        >
          <p>„{knoten.aufgabe.titel}“ wirklich löschen? Gelöschtes kommt nicht zurück.</p>

          {knoten.unteraufgaben.length === 0 ? null : (
            <p className={stile.hinweis}>
              {knoten.unteraufgaben.length === 1
                ? 'Die Unteraufgabe darunter bleibt bestehen und steht danach für sich.'
                : `Die ${knoten.unteraufgaben.length} Unteraufgaben darunter bleiben bestehen und stehen danach für sich.`}
            </p>
          )}

          <div className={stile.aktionen}>
            <Button className={stile.gefahr} disabled={laeuft} onClick={loescheDiese}>
              Endgültig löschen
            </Button>
            <Button variante="sekundaer" onClick={() => setzeFragtLoeschen(false)}>
              Abbrechen
            </Button>
          </div>
        </Dialog>
      ) : null}

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
        etwa über einen "Zuerst: …"-Link oder aus einer Unteraufgabe heraus, an
        derselben Stelle im Baum, und React behielte sonst den Zustand der
        Felder. Ein angefangener Notizentwurf stünde dann im Feld der anderen
        Aufgabe — und würde dort, weil die Notizen von selbst speichern, nach
        800 ms an der falschen Zeile landen, ohne dass jemand etwas gedrückt
        hätte. Seit dem Autospeichern ist diese Zeile keine Ordnungsliebe mehr,
        sondern das, was den Fehler verhindert.
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
          legeUnteraufgabeAn: (titel, angaben) =>
            fuehreAus(() => legeAn(titel, knoten.aufgabe.id, false, angaben)),
          gibFuerAlleFrei: () => void fuehreAus(() => gibFuerAlleFrei(knoten.aufgabe)),
          speichereKenntnisAm: (datum) => fuehreAus(() => setzeKenntnisAm(datum)),
          speichereFrist: (datum) =>
            fuehreAus(() => schreibe(knoten.aufgabe, { fristAm: datum })),
          speichereTitel: (titel) => fuehreAus(() => schreibe(knoten.aufgabe, { titel })),
          aufLoeschen: () => setzeFragtLoeschen(true),
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
        <Kopfleiste />
        <Ladeanzeige text={fallLadeText(zustand.status)} />
      </main>
    )
  }

  // Ohne Fall ist die App gesperrt (§7), und ohne ID gibt es nichts zu zeigen.
  if (zustand.status === 'kein-fall' || id === undefined) {
    return <Navigate to="/" replace />
  }

  /*
   * Die obere Leiste bringt der `Aufgabenbereich` selbst mit: Nur dort ist
   * bekannt, ob es eine Aufgabe zu löschen gibt und ob diese Person sie
   * bearbeiten darf. In den Fehlerzweigen steht sie ohne Aktion.
   */
  return (
    <main className={stile.seite}>
      {zustand.status === 'fehler' ? (
        <>
          <Kopfleiste />
          <p className={stile.hinweis} role="alert">
            Ihre Aufgaben sind gerade nicht abrufbar. {zustand.nachricht}
          </p>
        </>
      ) : zustand.aktiver.zustand === 'gesperrt' ? (
        <>
          <Kopfleiste />
          <p className={stile.hinweis} role="alert">
            Dieser Fall ist auf diesem Gerät gesperrt. {zustand.aktiver.grund}
          </p>
        </>
      ) : (
        <Aufgabenbereich fall={zustand.aktiver} id={id} />
      )}
    </main>
  )
}
