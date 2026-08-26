import { useState } from 'react'
import { Link } from 'react-router-dom'
import { alsNachricht } from '../../../core/fehler.ts'
import { useAufgaben } from '../../../hooks/useAufgaben.ts'
import { useCase } from '../../../hooks/useCase.ts'
import type { Aufgabenknoten } from '../../../services/aufgabenbaum.ts'
import { fallBeschriftung } from '../../../services/fallbeschriftung.ts'
import type { Fall, LesbarerFall } from '../../../services/fallService.ts'
import { istSeedAufgabe } from '../../../services/fragebaumService.ts'
import { fristlage, heuteIso } from '../../../services/fristen.ts'
import { darfAbhaken, istZugewiesen } from '../../../services/zuweisung.ts'
import { Klapp } from '../../../ui/Klapp/Klapp.tsx'
import { KeinFall } from '../../shared/KeinFall/KeinFall.tsx'
import { fallLadeText } from '../../shared/Ladeanzeige/FallLadeanzeige.tsx'
import { Abgelehnt, Uebernahmen } from '../../shared/Meldungen/Meldungen.tsx'
import { Abschnitt, Aufgabenzeile, erledigtSchalter } from '../Bausteine.tsx'
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

  /*
   * Die Fragebaum-Standardaufgabe steht immer oben, solange sie offen ist,
   * unabhängig davon, ob sie dieser Person zugewiesen ist: Wer neu in der App
   * sitzt, soll schnell auf den Fragebaum aufmerksam werden, und darauf zu
   * warten, dass jemand sie erst zuweist, wäre genau die Verzögerung, die
   * einen leeren Start-Screen überhaupt erst verwirrend macht.
   */
  const seedKnoten = zustand.baum.find((knoten) => istSeedAufgabe(knoten.aufgabe.katalog)) ?? null
  const seedOffen = seedKnoten !== null && !seedKnoten.erledigt

  const persoenlich = meineAufgaben(zustand.baum, ich.userId)
  // Ohne die Seed-Aufgabe: Sie steht oben für sich, nicht noch einmal in der
  // persönlichen Liste darunter.
  const persoenlichOhneSeed = persoenlich.filter(
    (eintrag) => seedKnoten === null || eintrag.knoten.aufgabe.id !== seedKnoten.aufgabe.id,
  )
  /*
   * §7: Auf Start steht nur, was jetzt getan werden kann. Eine Aufgabe, die
   * auf eine andere wartet, ist hier eine Zeile, an der man nichts machen
   * kann — und die Aufforderung, doch erst die andere zu suchen. Sie steht
   * weiterhin unter "Alle", mit ihrem "Zuerst: …" davor.
   */
  const offenePersoenlich = persoenlichOhneSeed.filter(
    (eintrag) => !eintrag.knoten.erledigt && eintrag.knoten.blockiertVon.length === 0,
  )
  // §7: Erledigtes steht am Ende der Liste und zu Anfang eingeklappt — nicht
  // weg, nur nicht im Weg.
  const erledigtePersoenlich = persoenlichOhneSeed.filter((eintrag) => eintrag.knoten.erledigt)

  /*
   * "Weitere Aufgaben": ein Ausschnitt aus dem allgemeinen Bestand, ergänzt,
   * solange die Seite durch persönliche Aufgaben noch nicht gut gefüllt ist.
   * Kein hartes Limit, sondern eine Zahl, die auf einen Blick reicht.
   */
  const ZIEL_ANZAHL = 5
  const bereitsGezeigt = new Set(persoenlichOhneSeed.map((eintrag) => eintrag.knoten.aufgabe.id))
  if (seedKnoten !== null) {
    bereitsGezeigt.add(seedKnoten.aufgabe.id)
  }
  const weitere =
    offenePersoenlich.length >= ZIEL_ANZAHL
      ? []
      : zustand.baum
          .filter(
            (knoten) =>
              !knoten.erledigt &&
              knoten.blockiertVon.length === 0 &&
              !bereitsGezeigt.has(knoten.aufgabe.id),
          )
          .slice(0, ZIEL_ANZAHL - offenePersoenlich.length)

  // Wirklich gar keine offene Aufgabe mehr, weder persönlich noch allgemein.
  const allesErledigt = !seedOffen && offenePersoenlich.length === 0 && weitere.length === 0

  /*
   * Nichts zu tun ist nicht dasselbe wie fertig: Wenn hier nur deshalb keine
   * Zeile steht, weil jede offene Aufgabe noch auf eine andere wartet, wäre
   * "Sie haben alle Aufgaben erledigt" schlicht falsch.
   */
  const wartetNoch =
    allesErledigt && zustand.baum.some((knoten) => !knoten.erledigt && knoten.blockiertVon.length > 0)

  function zeile(eintrag: Eintrag) {
    return (
      <Aufgabenzeile
        key={eintrag.knoten.aufgabe.id}
        knoten={eintrag.knoten}
        unter={eintrag.unter}
        lage={fristlage(eintrag.knoten.aufgabe.katalog, fristbezug, heute, eintrag.knoten.aufgabe.fristAm)}
        gesperrt={laeuft}
        darfHaken={darfAbhaken(eintrag.knoten.aufgabe.assignee, ich.userId)}
        aufHaken={(erledigt: boolean) => fuehreAus(() => hakeAb(eintrag.knoten.aufgabe, erledigt))}
      />
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

      {abgelehnt.length === 0 ? null : (
        <Abgelehnt form="flach" aenderungen={abgelehnt} aufBestaetigen={bestaetige} />
      )}

      {
        // Ein leerer Cache und ein laufender erster Abruf sind nicht dasselbe
        // wie "keine offene Aufgabe" (§5).
        zustand.laedtNetz && zustand.aufgaben.length === 0 ? (
          <Ladeanzeige text="Ihre Aufgaben werden geladen…" />
        ) : allesErledigt && erledigtePersoenlich.length === 0 ? (
          <p className={stile.hinweis}>
            {wartetNoch
              ? 'Gerade ist nichts zu tun: Die offenen Aufgaben warten noch auf andere. Unter „Alle“ sehen Sie, worauf.'
              : 'Sie haben alle Aufgaben erledigt.'}
          </p>
        ) : (
          <>
            {seedKnoten === null || !seedOffen ? null : (
              <ul className={stile.liste}>{zeile({ knoten: seedKnoten, unter: null })}</ul>
            )}

            {offenePersoenlich.length === 0 ? null : (
              <ul className={stile.liste}>{offenePersoenlich.map((eintrag) => zeile(eintrag))}</ul>
            )}

            {weitere.length === 0 ? null : (
              <Abschnitt titel="Weitere Aufgaben">
                <ul className={stile.liste}>
                  {weitere.map((knoten) => zeile({ knoten, unter: null }))}
                </ul>
              </Abschnitt>
            )}

            {/*
              Erledigtes steht ganz unten, hinter allem, was noch zu tun ist
              (§7): Wer die Startseite aufmacht, sucht die offene Aufgabe und
              nicht die abgehakte.
            */}
            {erledigtePersoenlich.length === 0 ? null : (
              <Klapp {...erledigtSchalter(erledigtePersoenlich.length)}>
                <ul className={stile.liste}>
                  {erledigtePersoenlich.map((eintrag) => zeile(eintrag))}
                </ul>
              </Klapp>
            )}
          </>
        )
      }
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
