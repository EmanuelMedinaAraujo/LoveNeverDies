import { useState } from 'react'
import { Link } from 'react-router-dom'
import { alsNachricht } from '../../../core/fehler.ts'
import { useAufgaben } from '../../../hooks/useAufgaben.ts'
import { useCase } from '../../../hooks/useCase.ts'
import type { Aufgabenknoten } from '../../../services/aufgabenbaum.ts'
import { fallBeschriftung } from '../../../services/fallbeschriftung.ts'
import type { Fall, LesbarerFall } from '../../../services/fallService.ts'
import { fristlage, heuteIso } from '../../../services/fristen.ts'
import { istZugewiesen } from '../../../services/zuweisung.ts'
import { KeinFall } from '../../shared/KeinFall/KeinFall.tsx'
import { fallLadeText } from '../../shared/Ladeanzeige/FallLadeanzeige.tsx'
import { Abgelehnt, Uebernahmen } from '../../shared/Meldungen/Meldungen.tsx'
import { Aufgabenzeile } from '../Bausteine.tsx'
import stile from '../einfach.module.css'

/**
 * Der Tab "Start" in der einfachen Ansicht (DESIGN.md §7).
 *
 * Derselbe Screen wie in der erweiterten Ansicht, und derselbe Platz in der
 * unteren Leiste: "Die Navigationsstruktur bleibt in beiden Modi identisch,
 * damit Angehörige einander am Telefon helfen können." Wer hier sitzt, sieht
 * dasselbe, es steht nur weniger davon da.
 *
 * Weggelassen ist, was eine Auskunft über andere ist: Wer zuständig ist, steht
 * hier nicht — dieser Screen zeigt ausschließlich, was der angemeldeten Person
 * zugewiesen ist, und "Sie" unter jeder Zeile ist eine Antwort auf eine Frage,
 * die niemand gestellt hat. Geblieben ist, was jemand am Küchentisch braucht:
 * der Titel, das Häkchen, die Frist und der Weg hinein.
 *
 * Gefiltert wird clientseitig, nach dem Entschlüsseln (§3.3) — wie drüben,
 * denn der Server kann nach einer Zuweisung nicht filtern, die er nicht lesen
 * kann, und soll es auch nicht können.
 */

function Ladeanzeige({ text }: { text: string }) {
  return (
    <p className={stile.hinweis} role="status">
      {text}
    </p>
  )
}

/** Eine Aufgabe auf Start, mit ihrer Elternaufgabe, falls sie eine hat. */
type Eintrag = {
  knoten: Aufgabenknoten
  unter: string | null
}

/**
 * Aus dem Baum die Aufgaben dieser Person: Wurzeln und Unteraufgaben (§7).
 *
 * Eine Familie teilt sich eine Aufgabe auf: Die Bank ruft der eine an, zum
 * Standesamt geht die andere. Wessen Name an der Unteraufgabe steht, muss sie
 * hier finden, und sie nennt dabei ihre Elternaufgabe, damit "Termin machen"
 * nicht ohne Zusammenhang dasteht.
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
            // Abhängigkeiten hängen an der Wurzel (§7, `aufgabenbaum.ts`).
            blockiertVon: [],
          },
          unter: knoten.aufgabe.titel,
        })
      }
    }
  }

  return eintraege
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
    fristbezug,
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

      {abgelehnt.length === 0 ? null : (
        <Abgelehnt form="flach" aenderungen={abgelehnt} aufBestaetigen={bestaetige} />
      )}

      {eintraege.length === 0 ? (
        // Ein leerer Cache und ein laufender erster Abruf sind nicht dasselbe
        // wie "Ihnen ist nichts zugewiesen" (§5).
        zustand.laedtNetz && zustand.aufgaben.length === 0 ? (
          <Ladeanzeige text="Ihre Aufgaben werden geladen…" />
        ) : (
          <p className={stile.hinweis}>
            Für Sie ist gerade nichts eingetragen. Unten in der Leiste finden Sie unter „Alle“
            alle Aufgaben.
          </p>
        )
      ) : (
        <ul className={stile.liste}>
          {eintraege.map((eintrag) => (
            <Aufgabenzeile
              key={eintrag.knoten.aufgabe.id}
              knoten={eintrag.knoten}
              unter={eintrag.unter}
              lage={fristlage(eintrag.knoten.aufgabe.katalog, fristbezug, heute)}
              gesperrt={laeuft}
              darfHaken
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

/** Die H1 aus §7 und darunter, um wessen Fall es geht (§2). */
function Kopf({ fall }: { fall: Fall | null }) {
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
    </div>
  )
}

export function Start() {
  const { zustand } = useCase()

  if (zustand.status === 'laedt' || zustand.status === 'schluessel-erneuerung') {
    return (
      <main className={stile.seite}>
        <Ladeanzeige text={fallLadeText(zustand.status)} />
      </main>
    )
  }

  // Ohne Fall ist die App gesperrt: ein Screen, drei Schaltflächen (§7).
  if (zustand.status === 'kein-fall') {
    return <KeinFall />
  }

  return (
    <main className={stile.seite}>
      <Kopf fall={zustand.status === 'fehler' ? null : zustand.aktiver} />

      {zustand.status === 'fehler' ? (
        <p className={stile.warnung} role="alert">
          Ihre Fälle sind gerade nicht abrufbar. {zustand.nachricht}
        </p>
      ) : zustand.aktiver.zustand === 'gesperrt' ? (
        <>
          <p className={stile.warnung} role="alert">
            Dieser Fall ist auf diesem Gerät gesperrt. {zustand.aktiver.grund}
          </p>
          {/*
            §3.6: Ein neues Gerät sieht den Fall und liest nichts, bis ein
            anderes Mitglied `K_c` an seinen öffentlichen Schlüssel wrappt.
          */}
          <p>
            <Link className={stile.weiter} to="/geraet-freischalten">
              Dieses Gerät freischalten lassen
            </Link>
          </p>
        </>
      ) : (
        <MeineAufgaben fall={zustand.aktiver} />
      )}
    </main>
  )
}
