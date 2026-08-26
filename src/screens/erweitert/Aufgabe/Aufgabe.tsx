import { useState, type FormEvent, type ReactNode } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'
import type { InhaltZeile } from '../../../core/db/inhalte.ts'
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
import { Badge, type Badgelage } from '../../../ui/Badge/Badge.tsx'
import { Button } from '../../../ui/Button/Button.tsx'
import { Card } from '../../../ui/Card/Card.tsx'
import { Checkbox } from '../../../ui/Checkbox/Checkbox.tsx'
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
 * erledigt, wenn alle Kinder es sind (§7).
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
              <span>{katalog.zustaendigeStelle}</span>
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

        {istErbscheinAufgabe(aufgabe) ? (
          <>
            <Angabe was="Wie beantragen Sie einen Erbschein?">
              <ul className={stile.punkte}>
                <li>Beim Notar oder beim Nachlassgericht</li>
                <li>Anrufen oder online Termin vereinbaren - die Stellen erklären Ihnen die weiteren Schritte</li>
              </ul>
            </Angabe>
            <Angabe was="Notar oder Nachlassgericht:">
              <p className={stile.prozedurText}>
                <strong>Notar:</strong> Sie erhalten schneller und innerhalb der Frist einen Termin<br />
                <strong>Nachlassgericht:</strong> Ihnen fallen keine zusätzlichen Kosten an
              </p>
            </Angabe>
          </>
        ) : istAnfechtungAufgabe(aufgabe) || istAusschlagungAufgabe(aufgabe) ? null : (
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
  const darfHaken = darfAbhaken(unteraufgabe.assignee, ichUserId)

  return (
    <li className={stile.zeile}>
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
        />
      ) : (
        <p className={erledigt ? stile.fertig : undefined}>{unteraufgabe.titel}</p>
      )}
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
  gesperrt,
  aufSpeichern,
}: {
  /** Das eingetragene Datum, oder `null`. */
  fristAm: string | null
  /** Die gesetzliche Frist derselben Aufgabe, ohne die eigene gerechnet (§8). */
  gesetzlich: Fristlage
  gesperrt: boolean
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

  async function speichere(ereignis: FormEvent) {
    ereignis.preventDefault()
    await aufSpeichern(eingabe === '' ? null : eingabe)
  }

  return (
    <Card titel="Frist">
      <p>
        Bis wann soll diese Aufgabe erledigt sein? Das Datum gehört zur Aufgabe: Alle Mitglieder
        des Falls sehen dasselbe.
      </p>

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

      <form className={stile.formular} onSubmit={(ereignis) => void speichere(ereignis)}>
        <div className={stile.feld}>
          <label htmlFor="frist-am">Erledigt bis</label>
          <input
            id="frist-am"
            type="date"
            className={stile.eingabe}
            value={eingabe}
            onChange={(ereignis) => setzeEingabe(ereignis.target.value)}
          />
        </div>

        <Button type="submit" volleBreite disabled={gesperrt || eingabe === (fristAm ?? '')}>
          Frist speichern
        </Button>
      </form>

      {fristAm === null ? null : (
        <Button variante="sekundaer" disabled={gesperrt} onClick={() => void aufSpeichern(null)}>
          Frist entfernen
        </Button>
      )}
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
    legeUnteraufgabeAn: (titel: string) => Promise<boolean>
    loesche: (aufgabe: Aufgabendatensatz) => void
    weiseZu: (zuweisung: Zuweisung) => void
    /** Wrappt den DEK von `K_p` auf `K_c` (§3.7). */
    gibFuerAlleFrei: () => void
    /** Legt das eigene Kenntnisdatum ab oder ändert es (§8, #12). */
    speichereKenntnisAm: (datum: string | null) => Promise<boolean>
    /** Setzt die selbst gewählte Frist dieser Aufgabe, oder entfernt sie (§7). */
    speichereFrist: (datum: string | null) => Promise<boolean>
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
  const [neueUnteraufgabe, setzeNeueUnteraufgabe] = useState('')
  const [fragtFreigabe, setzeFragtFreigabe] = useState(false)

  // Was der Bestand bringt, gewinnt, aber erst, wenn er sich wirklich
  // geändert hat. Sonst überschriebe jede Türklingel den halb getippten Satz.
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

  const fertigeKinder = unteraufgaben.filter((unter) => unter.erledigt).length

  /*
   * §7: "Bearbeiten darf nur, wem sie zugewiesen ist." Gesperrt sind die
   * Notizen, neue Unteraufgaben und das Löschen, nicht das Lesen und nicht die
   * Zuweisung selbst. Wer nicht eingetragen ist, soll die
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
        gesperrt={aktionen.gesperrt || !darfAendern}
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

      <Card titel="Unteraufgaben">
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
      />

      <Card titel="Notizen">
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
     * "gibt es nicht mehr" stehen.
     */
    return zustand.laedtNetz ? (
      <Ladeanzeige text="Ihre Aufgaben werden geladen…" />
    ) : (
      <p className={stile.hinweis} role="alert">
        Diese Aufgabe gibt es nicht mehr. Gelöschte Aufgaben kommen nicht zurück.
      </p>
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
          speichereFrist: (datum) =>
            fuehreAus(() => schreibe(knoten.aufgabe, { fristAm: datum })),
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
