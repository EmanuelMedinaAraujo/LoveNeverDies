import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { alsNachricht } from '../../../core/fehler.ts'
import { useAufgaben } from '../../../hooks/useAufgaben.ts'
import { useCase } from '../../../hooks/useCase.ts'
import type { Aufgabenknoten } from '../../../services/aufgabenbaum.ts'
import { fallBeschriftung } from '../../../services/fallbeschriftung.ts'
import type { Fall, LesbarerFall } from '../../../services/fallService.ts'
import { istSeedAufgabe } from '../../../services/fragebaumService.ts'
import { fristlage, fristText, heuteIso, type Fristlage } from '../../../services/fristen.ts'
import { darfAbhaken, istZugewiesen, zuweisungText } from '../../../services/zuweisung.ts'
import { Badge, type Badgelage } from '../../../ui/Badge/Badge.tsx'
import { Checkbox } from '../../../ui/Checkbox/Checkbox.tsx'
import { Klapp } from '../../../ui/Klapp/Klapp.tsx'
import { Detailziel, Gruppe, Liste, Zeile } from '../../../ui/Liste/Liste.tsx'
import { KeinFall } from '../../shared/KeinFall/KeinFall.tsx'
import { fallLadeText } from '../../shared/Ladeanzeige/FallLadeanzeige.tsx'
import { Abgelehnt, Uebernahmen } from '../../shared/Meldungen/Meldungen.tsx'
import { Vorsorgebereich } from '../../shared/Vorsorgefragen/Vorsorgebereich.tsx'
import stile from './Start.module.css'

/**
 * Der Tab "Start": H1 "Meine Aufgaben" (DESIGN.md §7).
 *
 * Der Screen wird das, was er verspricht: Hier steht nur, was der angemeldeten
 * Person zugewiesen ist. Alles andere steht in "Alle", einen Fingertipp weiter.
 *
 * Gefiltert wird clientseitig, nach dem Entschlüsseln (§3.3). Die Zuweisung
 * liegt im Payload; der Server kann nach ihr nicht filtern und soll es auch
 * nicht können. Das ist keine Einschränkung, mit der man leben muss, sondern
 * genau der Punkt: "Der Server weiß, wer zu wem gehört. Er weiß nichts über den
 * Inhalt."
 *
 * Unteraufgaben stehen mit in der Liste. Eine Familie teilt eine Aufgabe
 * auf: Die Bank ruft der eine an, zum Standesamt geht die andere, und wessen
 * Name an der Unteraufgabe steht, muss sie auf seinem Start-Screen finden. Sie
 * nennt dabei ihre Elternaufgabe, damit "Termin machen" nicht ohne Zusammenhang
 * dasteht.
 *
 * Die erweiterte Fassung dieses Tabs (§7). Die einfache steht daneben in
 * `screens/einfach/Start` und zeigt weniger: Sie schweigt über die
 * Zuständigkeit, weil dieser Screen ohnehin nur zeigt, was der angemeldeten
 * Person gehört. Welche der beiden gerendert wird, entscheidet `app/App.tsx`
 * am Modus aus dem Onboarding.
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
  if (lage.art === 'unverzueglich') {
    return 'knapp'
  }

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
 * Aus dem Baum die Aufgaben dieser Person: Wurzeln und Unteraufgaben (§7).
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

/**
 * Die Beschriftung des Auf-/Zuklappers für erledigte Aufgaben (§7).
 *
 * Dieselbe kleine Funktion wie in `screens/einfach/Bausteine.tsx`: Beide
 * Ansichten brauchen sie, aber es gibt keine gemeinsame Datei für die
 * erweiterte Ansicht, aus der heraus man sie teilen könnte (§9).
 */
function erledigtSchalter(anzahl: number): { titel: string; offenText: string } {
  const wort = anzahl === 1 ? 'erledigte Aufgabe' : 'erledigte Aufgaben'

  return { titel: `${anzahl} ${wort} anzeigen`, offenText: `${anzahl} ${wort} ausblenden` }
}

/** Eine Zeile auf Start: abhaken, hineingehen, mehr nicht. */
function Startzeile({
  eintrag,
  lage,
  gesperrt,
  darfHaken,
  ichUserId,
  aufHaken,
}: {
  eintrag: Eintrag
  lage: Fristlage
  gesperrt: boolean
  /** §7: Bearbeiten darf nur, wem die Aufgabe zugewiesen ist. */
  darfHaken: boolean
  ichUserId: string
  /** @returns ob die Änderung angehängt wurde. Sonst nimmt die Zeile sie zurück. */
  aufHaken: (erledigt: boolean) => Promise<boolean>
}) {
  const { knoten, unter } = eintrag
  const { aufgabe, unteraufgaben, istBlatt, erledigt: giltAlsErledigt, blockiertVon } = knoten

  // Wie in "Alle": Das Häkchen folgt dem Finger und gibt die Führung erst ab,
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
  const blockiert = blockiertVon.length > 0

  /*
   * Alles, was frueher als eigener Absatz unter dem Titel stand, steht jetzt
   * in einer Zeile nebeneinander. Auf Start faellt die Zustaendigkeit dabei
   * meistens weg: Dieser Screen zeigt, was mir zugewiesen ist, und "Sie" unter
   * jeder einzelnen Zeile ist eine Auskunft, die niemand gesucht hat. Steht
   * jemand anders mit darunter, sagt sie wieder etwas, und dann steht sie da.
   */
  const zustaendig = zuweisungText(aufgabe.assignee, ichUserId)

  const meta: ReactNode[] = []

  if (unter !== null) {
    meta.push(<span key="unter">Teil von „{unter}“</span>)
  }

  if (!istBlatt) {
    meta.push(
      <span key="stand">
        {unteraufgaben.filter((eins) => eins.erledigt).length}/{unteraufgaben.length} erledigt
      </span>,
    )
  }

  if (blockiert) {
    meta.push(
      <span key="zuerst" className={stile.zuerst}>
        Zuerst: {blockiertVon.map((offen) => offen.titel).join(', ')}
      </span>,
    )
  }

  if (zustaendig !== 'Sie') {
    meta.push(<span key="wer">{zustaendig}</span>)
  }

  return (
    <Zeile className={blockiert ? stile.wartet : undefined}>
      <div className={stile.spalte}>
        {/*
          Kein Kästchen, wo niemand abhaken darf (§7): Ein graues ist eine
          Einladung, die nicht gilt. Wer zuständig ist, steht in der Zeile
          darunter, und der Weg dahin führt über die Aufgabe selbst.
        */}
        {istBlatt && darfHaken ? (
          <Checkbox
            abhaken
            checked={erledigt}
            disabled={gesperrt}
            onChange={(ereignis) => void haken(ereignis.target.checked)}
            label={aufgabe.titel}
            nurKaestchen
          />
        ) : (
          /*
           * Eine Aufgabe mit Unteraufgaben hat kein eigenes Haekchen; abgehakt
           * wird im Detail, Kind fuer Kind. Ohne Kaestchen davor bekaeme ihr
           * Titel eine andere Einrueckung als die der Blaetter, und die Liste
           * saehe aus, als waeren zwei Listen ineinandergeschoben.
           */
          <p
            className={[stile.titelohne, giltAlsErledigt ? stile.fertig : null]
              .filter(Boolean)
              .join(' ')}
          >
            {aufgabe.titel}
          </p>
        )}

        {meta.length === 0 && badge === null ? null : (
          <p className={stile.meta}>
            {badge === null ? null : <Badge lage={badgelage(lage)}>{badge}</Badge>}
            {meta}
          </p>
        )}
      </div>

      {/*
        Die eine Aufgabe, die noch aus dem Katalog kommt (ADR-0001), hat keine
        eigene Detailseite: Ihr Ergebnis steht im Fragebaum. Erkannt wird sie
        an ihrer Herkunft, nicht am Titel (ERBE_DESIGN.md §9).
      */}
      <Detailziel
        ziel={istSeedAufgabe(aufgabe.katalog) ? '/erbe/fragebaum' : `/aufgabe/${aufgabe.id}`}
        titel={aufgabe.titel}
      />
    </Zeile>
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
   * sitzt, soll schnell auf den Fragebaum aufmerksam werden.
   */
  const seedKnoten = zustand.baum.find((knoten) => istSeedAufgabe(knoten.aufgabe.katalog)) ?? null
  const seedOffen = seedKnoten !== null && !seedKnoten.erledigt

  const persoenlich = meineAufgaben(zustand.baum, ich.userId)
  // Ohne die Seed-Aufgabe: Sie steht oben für sich, nicht noch einmal in der
  // persönlichen Liste darunter.
  const persoenlichOhneSeed = persoenlich.filter(
    (eintrag) => seedKnoten === null || eintrag.knoten.aufgabe.id !== seedKnoten.aufgabe.id,
  )
  const offenePersoenlich = persoenlichOhneSeed.filter((eintrag) => !eintrag.knoten.erledigt)
  // §7: Erledigtes steht am Ende der Liste und zu Anfang eingeklappt.
  const erledigtePersoenlich = persoenlichOhneSeed.filter((eintrag) => eintrag.knoten.erledigt)

  /*
   * "Weitere Aufgaben": ein Ausschnitt aus dem allgemeinen Bestand, ergänzt,
   * solange die Seite durch persönliche Aufgaben noch nicht gut gefüllt ist.
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
          .filter((knoten) => !knoten.erledigt && !bereitsGezeigt.has(knoten.aufgabe.id))
          .slice(0, ZIEL_ANZAHL - offenePersoenlich.length)

  // Wirklich gar keine offene Aufgabe mehr, weder persönlich noch allgemein.
  const allesErledigt = !seedOffen && offenePersoenlich.length === 0 && weitere.length === 0

  function zeile(eintrag: Eintrag) {
    return (
      <Startzeile
        key={eintrag.knoten.aufgabe.id}
        eintrag={eintrag}
        lage={fristlage(eintrag.knoten.aufgabe.katalog, fristbezug, heute)}
        gesperrt={laeuft}
        darfHaken={darfAbhaken(eintrag.knoten.aufgabe.assignee, ich.userId)}
        ichUserId={ich.userId}
        aufHaken={(erledigt: boolean) => fuehreAus(() => hakeAb(eintrag.knoten.aufgabe, erledigt))}
      />
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

      {abgelehnt.length === 0 ? null : (
        <Abgelehnt aenderungen={abgelehnt} aufBestaetigen={bestaetige} />
      )}

      {
        // Ein leerer Cache und ein laufender erster Abruf sind nicht dasselbe
        // wie "keine offene Aufgabe" (§5).
        zustand.laedtNetz && zustand.aufgaben.length === 0 ? (
          <Ladeanzeige text="Ihre Aufgaben werden geladen…" />
        ) : allesErledigt && erledigtePersoenlich.length === 0 ? (
          <p className={stile.hinweis}>Sie haben alle Aufgaben erledigt.</p>
        ) : (
          <>
            {seedKnoten === null || !seedOffen ? null : (
              <Liste>{zeile({ knoten: seedKnoten, unter: null })}</Liste>
            )}

            {offenePersoenlich.length === 0 ? null : (
              <Liste>{offenePersoenlich.map((eintrag) => zeile(eintrag))}</Liste>
            )}

            {erledigtePersoenlich.length === 0 ? null : (
              <Klapp {...erledigtSchalter(erledigtePersoenlich.length)}>
                <Liste>{erledigtePersoenlich.map((eintrag) => zeile(eintrag))}</Liste>
              </Klapp>
            )}

            {weitere.length === 0 ? null : (
              <Gruppe titel="Weitere Aufgaben">
                <Liste>{weitere.map((knoten) => zeile({ knoten, unter: null }))}</Liste>
              </Gruppe>
            )}
          </>
        )
      }
    </>
  )
}

/**
 * Der Kopf: die H1 aus §7 und darunter, um wessen Fall es geht (§2).
 *
 * Ohne Navigationsreihe. Die Wege nach Erbe, Alle und Profil stehen jetzt in
 * der unteren Leiste (§7), und der Freigabe-Hinweis aus §3.6 sitzt dort am
 * Profil-Tab. Zwei Orte für dieselbe Auskunft wären zwei Orte, an denen sie
 * auseinanderlaufen kann.
 */
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
      ) : zustand.aktiver.status === 'vorsorge' ? (
        /*
         * §2, §3.5: Ein Vorsorgefall hat keine Aufgaben — kein Sterbedatum,
         * kein Rechtskatalog. Wer vorsorgt, läse hier für immer "Für Sie ist
         * gerade nichts eingetragen". An dieser Stelle stehen deshalb die
         * Vorsorgefragen: der erste Screen nach dem Öffnen, und das Einzige,
         * was in diesem Fall zu tun ist.
         */
        <Vorsorgebereich fall={zustand.aktiver} />
      ) : (
        <MeineAufgaben fall={zustand.aktiver} />
      )}
    </main>
  )
}
