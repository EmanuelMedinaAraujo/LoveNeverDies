import { useState } from 'react'
import { Link } from 'react-router-dom'
import { alsNachricht } from '../../../core/fehler.ts'
import { useAufgaben } from '../../../hooks/useAufgaben.ts'
import { useCase } from '../../../hooks/useCase.ts'
import type { Aufgabenknoten } from '../../../services/aufgabenbaum.ts'
import { fallBeschriftung } from '../../../services/fallbeschriftung.ts'
import type { Fall, LesbarerFall } from '../../../services/fallService.ts'
import { fristlage, fristText, heuteIso, type Fristlage } from '../../../services/fristen.ts'
import { istZugewiesen, zuweisungText } from '../../../services/zuweisung.ts'
import { Badge, type Badgelage } from '../../../ui/Badge/Badge.tsx'
import { Checkbox } from '../../../ui/Checkbox/Checkbox.tsx'
import { KeinFall } from '../KeinFall/KeinFall.tsx'
import { Abgelehnt, Uebernahmen } from '../Meldungen/Meldungen.tsx'
import stile from './Start.module.css'

/**
 * Der Tab „Start": H1 „Meine Aufgaben" (DESIGN.md §7).
 *
 * Der Screen wird das, was er verspricht — hier steht nur, was der angemeldeten
 * Person zugewiesen ist. Alles andere steht in „Alle", einen Fingertipp weiter.
 *
 * **Gefiltert wird clientseitig, nach dem Entschlüsseln** (§3.3). Die Zuweisung
 * liegt im Payload; der Server kann nach ihr nicht filtern und soll es auch
 * nicht können. Das ist keine Einschränkung, mit der man leben muss, sondern
 * genau der Punkt: „Der Server weiß, wer zu wem gehört. Er weiß nichts über den
 * Inhalt."
 *
 * **Unteraufgaben stehen mit in der Liste.** Eine Familie teilt eine Aufgabe
 * auf — die Bank ruft der eine an, zum Standesamt geht die andere —, und wessen
 * Name an der Unteraufgabe steht, muss sie auf seinem Start-Screen finden. Sie
 * nennt dabei ihre Elternaufgabe, damit „Termin machen" nicht ohne Zusammenhang
 * dasteht.
 *
 * **Ein Screen statt zweier Bäume.** §7 sieht für „Start" getrennte Bäume unter
 * `screens/senior` und `screens/advanced` vor; getrennt wird, sobald die
 * einfache Ansicht wirklich weniger zeigt — das ist der Slice #17. Bis dahin
 * tragen die Dichtetokens den Größenunterschied, wie in „Alle" und im
 * Aufgabendetail.
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

/** Eine Aufgabe auf Start, mit ihrer Elternaufgabe, falls sie eine hat. */
type Eintrag = {
  knoten: Aufgabenknoten
  /** Der Titel der Elternaufgabe, oder `null` bei einer Wurzelaufgabe. */
  unter: string | null
}

/**
 * Aus dem Baum die Aufgaben dieser Person — Wurzeln und Unteraufgaben (§7).
 *
 * Die Reihenfolge des Baums bleibt: die der Juristinnen (§8), und eine
 * Unteraufgabe steht direkt hinter ihrer Elternaufgabe, auch wenn nur eine von
 * beiden zugewiesen ist.
 */
function meineAufgaben(baum: Aufgabenknoten[], userId: string): Eintrag[] {
  const eintraege: Eintrag[] = []

  for (const knoten of baum) {
    if (istZugewiesen(knoten.aufgabe.assignee, userId)) {
      eintraege.push({ knoten, unter: null })
    }

    for (const unteraufgabe of knoten.unteraufgaben) {
      if (istZugewiesen(unteraufgabe.assignee, userId)) {
        eintraege.push({
          knoten: {
            aufgabe: unteraufgabe,
            unteraufgaben: [],
            istBlatt: true,
            erledigt: unteraufgabe.erledigt,
            // Abhängigkeiten hängen an der Wurzel (§7, `aufgabenbaum.ts`); eine
            // Unteraufgabe trägt keine eigenen.
            blockiertVon: [],
          },
          unter: knoten.aufgabe.titel,
        })
      }
    }
  }

  return eintraege
}

/** Eine Zeile auf Start: abhaken, hineingehen — mehr nicht. */
function Startzeile({
  eintrag,
  lage,
  gesperrt,
  ichUserId,
  aufHaken,
}: {
  eintrag: Eintrag
  lage: Fristlage
  gesperrt: boolean
  ichUserId: string
  /** @returns ob die Änderung angehängt wurde. Sonst nimmt die Zeile sie zurück. */
  aufHaken: (erledigt: boolean) => Promise<boolean>
}) {
  const { knoten, unter } = eintrag
  const { aufgabe, unteraufgaben, istBlatt, erledigt: giltAlsErledigt, blockiertVon } = knoten

  // Wie in „Alle": Das Häkchen folgt dem Finger und gibt die Führung erst ab,
  // wenn der Bestand nachgezogen hat (§5).
  const [erledigt, setzeErledigt] = useState(aufgabe.erledigt)
  const [zuletztGesehen, setzeZuletztGesehen] = useState(aufgabe.erledigt)

  if (zuletztGesehen !== aufgabe.erledigt) {
    setzeZuletztGesehen(aufgabe.erledigt)
    setzeErledigt(aufgabe.erledigt)
  }

  async function haken(gewuenscht: boolean) {
    setzeErledigt(gewuenscht)

    if (!(await aufHaken(gewuenscht))) {
      setzeErledigt(aufgabe.erledigt)
    }
  }

  const badge = fristText(lage)

  return (
    <li className={[stile.zeile, blockiertVon.length > 0 ? stile.blockiert : null].filter(Boolean).join(' ')}>
      <div className={stile.titelzeile}>
        {istBlatt ? (
          <Checkbox
            checked={erledigt}
            disabled={gesperrt}
            onChange={(ereignis) => void haken(ereignis.target.checked)}
            label={aufgabe.titel}
          />
        ) : (
          <p className={stile.titel}>{aufgabe.titel}</p>
        )}

        {badge === null ? null : <Badge lage={badgelage(lage)}>{badge}</Badge>}
      </div>

      {unter === null ? null : (
        <p className={stile.hinweis}>Unteraufgabe von „{unter}“</p>
      )}

      {istBlatt ? null : (
        <p className={stile.hinweis}>
          {giltAlsErledigt
            ? `Erledigt: alle ${unteraufgaben.length} Unteraufgaben sind abgehakt.`
            : `${unteraufgaben.filter((unter) => unter.erledigt).length} von ${unteraufgaben.length} Unteraufgaben erledigt`}
        </p>
      )}

      {/* §7: Blockierte Aufgaben erscheinen ausgegraut mit „Zuerst: …". */}
      {blockiertVon.length === 0 ? null : (
        <p className={stile.hinweis}>
          Zuerst: {blockiertVon.map((offen) => offen.titel).join(', ')}
        </p>
      )}

      {/*
        Auch auf dem eigenen Start-Screen steht dabei, wem die Aufgabe gehört:
        Bei „Alle" und bei geteilten Aufgaben ist das der Unterschied zwischen
        „ich mache das" und „das macht schon jemand".
      */}
      <p className={stile.hinweis}>Zuständig: {zuweisungText(aufgabe.assignee, ichUserId)}</p>

      <Link className={stile.detaillink} to={`/aufgabe/${aufgabe.id}`}>
        Details
        <span className="nur-vorlesen">: „{aufgabe.titel}"</span>
      </Link>
    </li>
  )
}

function MeineAufgaben({ fall }: { fall: LesbarerFall }) {
  const {
    zustand,
    abgelehnt,
    bestaetige,
    hakeAb,
    ich,
    uebernahmen,
    bestaetigeUebernahmen,
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

  const heute = heuteIso()
  const eintraege = meineAufgaben(zustand.baum, ich.userId)

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

      {abgelehnt.length === 0 ? null : (
        <Abgelehnt aenderungen={abgelehnt} aufBestaetigen={bestaetige} />
      )}

      {eintraege.length === 0 ? (
        // Ein leerer Cache und ein laufender erster Abruf sind nicht dasselbe
        // wie „Ihnen ist nichts zugewiesen" (§5).
        zustand.laedtNetz && zustand.aufgaben.length === 0 ? (
          <Ladeanzeige text="Ihre Aufgaben werden geladen…" />
        ) : (
          /*
            Ohne Link: „Alle Aufgaben" steht als Weg schon im Kopf dieses
            Screens, und zwei gleich benannte Links auf derselben Seite sind für
            eine Vorlesestimme zwei Ziele mit demselben Namen (§7).
          */
          <p className={stile.hinweis}>
            Ihnen ist gerade nichts zugewiesen. Über „Alle Aufgaben" können Sie eine
            übernehmen.
          </p>
        )
      ) : (
        <ul className={stile.liste}>
          {eintraege.map((eintrag) => (
            <Startzeile
              key={eintrag.knoten.aufgabe.id}
              eintrag={eintrag}
              lage={fristlage(eintrag.knoten.aufgabe.katalog, fall.sterbedatum, heute)}
              gesperrt={laeuft}
              ichUserId={ich.userId}
              aufHaken={(erledigt: boolean) =>
                fuehreAus(() => hakeAb(eintrag.knoten.aufgabe, erledigt))
              }
            />
          ))}
        </ul>
      )}
    </>
  )
}

/** Der Kopf: die H1 aus §7 und darunter, um wessen Fall es geht (§2). */
function Kopf({ fall, freigabeNoetig }: { fall: Fall | null; freigabeNoetig: boolean }) {
  return (
    <div className={stile.kopf}>
      <h1>Meine Aufgaben</h1>

      {fall === null || fall.zustand === 'gesperrt' ? null : (
        <p className={stile.hinweis}>
          {fall.sterbedatum === null
            ? fall.personName
            : fallBeschriftung(fall.personName, fall.sterbedatum)}
        </p>
      )}

      {/*
        Die untere Leiste aus §7 — Start · Erbe · Alle · Profil — kommt mit den
        Screens, die sie verbindet. Zwei davon gibt es, und die beiden Wege
        stehen so lange hier.
      */}
      <p className={stile.hinweis}>
        <Link to="/alle">Alle Aufgaben</Link>
      </p>
      {/*
        §3.6 verlangt den Badge „in der unteren Leiste“, sobald ein Gerät auf
        seine Freigabe wartet. Die Leiste gibt es noch nicht (§7); bis dahin
        steht er an dem einen Link, der nach Profil führt — dort geschieht die
        Freigabe. Der Hinweis muss dort stehen, wo ohnehin hingesehen wird.
      */}
      <p className={stile.hinweis}>
        <Link to="/profil">Profil und Geräte</Link>{' '}
        {freigabeNoetig ? <Badge lage="hinweis">Freigabe nötig</Badge> : null}
      </p>
    </div>
  )
}

export function Start() {
  const { zustand } = useCase()

  if (zustand.status === 'laedt') {
    return (
      <main className={stile.seite}>
        <Ladeanzeige text="Ihre Daten werden geladen…" />
      </main>
    )
  }

  // Ohne Fall ist die App gesperrt: ein Screen, drei Schaltflächen (§7).
  if (zustand.status === 'kein-fall') {
    return <KeinFall />
  }

  /*
   * Ein gesperrter Fall in der Liste heißt: Dieses Gerät wartet auf eine
   * Freigabe (§3.6). Das ist lokal ablesbar — die Wraps fremder Geräte sind es
   * nicht (§4), also kann nur das wartende Gerät selbst den Hinweis zeigen.
   */
  const freigabeNoetig =
    zustand.status === 'bereit' && zustand.faelle.some((eintrag) => eintrag.zustand === 'gesperrt')

  return (
    <main className={stile.seite}>
      <Kopf
        fall={zustand.status === 'fehler' ? null : zustand.aktiver}
        freigabeNoetig={freigabeNoetig}
      />

      {zustand.status === 'fehler' ? (
        <p className={stile.hinweis} role="alert">
          Ihre Fälle sind gerade nicht abrufbar. {zustand.nachricht}
        </p>
      ) : zustand.aktiver.zustand === 'gesperrt' ? (
        <>
          <p className={stile.hinweis} role="alert">
            Dieser Fall ist auf diesem Gerät gesperrt. {zustand.aktiver.grund}
          </p>
          {/*
            §3.6: Ein neues Gerät sieht den Fall und liest nichts, bis ein
            anderes Mitglied `K_c` an seinen öffentlichen Schlüssel wrappt. Der
            Weg dorthin gehört an diese Stelle und nicht drei Klicks entfernt.
          */}
          <p className={stile.hinweis}>
            <Link to="/geraet-freischalten">Dieses Gerät freischalten lassen</Link>
          </p>
        </>
      ) : (
        <MeineAufgaben fall={zustand.aktiver} />
      )}
    </main>
  )
}
