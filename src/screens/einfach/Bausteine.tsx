import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import type { Aufgabenknoten } from '../../services/aufgabenbaum.ts'
import { datumText, fristText, type Fristlage } from '../../services/fristen.ts'
import { istSeedAufgabe } from '../../services/fragebaumService.ts'
import { Checkbox } from '../../ui/Checkbox/Checkbox.tsx'
import stile from './einfach.module.css'

/**
 * Was "Start" und "Alle" in der einfachen Ansicht gemeinsam haben (DESIGN.md §7).
 *
 * Beide Screens zeigen dieselbe Aufgabenzeile: Titel mit Häkchen, darunter die
 * Frist in Worten, darunter der eine Weg hinein. Zweimal geschrieben wären es
 * zwei Zeilen, die sich mit der Zeit unterscheiden — und der Unterschied fiele
 * ausgerechnet der Person auf, für die diese Ansicht gemacht ist.
 */

/** Die Frist als ganzer Satz, mit der Farbe, die zu ihr gehört (§12). */
export function Fristzeile({ lage }: { lage: Fristlage }) {
  const text = fristText(lage)

  if (text === null) {
    return null
  }

  const klasse =
    lage.art === 'unverzueglich'
      ? [stile.frist, stile.knapp].join(' ')
      : lage.art !== 'datum'
        ? stile.frist
        : lage.restTage < 0
          ? [stile.frist, stile.abgelaufen].join(' ')
          : lage.restTage <= 3
            ? [stile.frist, stile.knapp].join(' ')
            : stile.frist

  /*
   * Bei einer Frist ab der eigenen Kenntnis ist der Text schon ein ganzer
   * Satz ("Frist ab Ihrer Kenntnis"); ein "Frist: " davor sagte es zweimal.
   */
  return (
    <p className={klasse}>
      {lage.art === 'datum'
        ? `Frist: ${datumText(lage.ende)}, ${text}`
        : lage.art === 'unverzueglich'
          ? `Frist: ${text}`
          : text}
    </p>
  )
}

/** Der Winkel am Ende von „Öffnen“. */
function Winkel() {
  return (
    <svg
      className={stile.winkel}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m9 5 7 7-7 7" />
    </svg>
  )
}

/**
 * Eine Aufgabe in der Liste: abhaken, hineingehen, mehr nicht.
 *
 * Hineingehen tut die ganze Zeile: "Oeffnen" legt seine
 * Trefferflaeche ueber sie. Das Haekchen liegt darueber und faengt seinen Tipp
 * vorher ab, und die Beschriftung des Haekchens laesst Tipps durch
 * (`nurKaestchen`). Damit gilt in der ganzen Liste dieselbe Regel: Das
 * Kaestchen hakt ab, alles andere fuehrt ins Detail. Vorher hakte ein Tipp auf
 * den Titel die Aufgabe ab -- die haeufigste Stelle der Zeile fuer die
 * seltenere der beiden Absichten.
 *
 * Alles andere — umbenennen, löschen, übernehmen, freigeben — steht in der
 * Aufgabe selbst. In der erweiterten Ansicht liegt es als Reihe von
 * Textaktionen unter jeder Zeile; das ist dort richtig, weil man sich dann
 * durch vierzig Aufgaben arbeiten kann, ohne eine einzige zu öffnen. Hier
 * wären es vier Wörter unter jedem Titel, von denen drei fast nie gebraucht
 * werden, und eines davon löscht.
 */
export function Aufgabenzeile({
  knoten,
  lage,
  gesperrt,
  darfHaken,
  unter = null,
  zustaendig = null,
  aufHaken,
}: {
  knoten: Aufgabenknoten
  lage: Fristlage
  gesperrt: boolean
  /** §7: Bearbeiten darf nur, wem die Aufgabe zugewiesen ist. */
  darfHaken: boolean
  /** Der Titel der Elternaufgabe, wenn diese Zeile eine Unteraufgabe ist. */
  unter?: string | null
  /**
   * Wer eingetragen ist, wenn es nicht die angemeldete Person ist. Sonst
   * `null`: Ein graues Kästchen ohne Erklärung sieht aus wie ein Fehler der
   * App, und die Erklärung dazu ist genau dieser Satz.
   */
  zustaendig?: string | null
  /** @returns ob die Änderung angehaengt wurde. Sonst nimmt die Zeile sie zurück. */
  aufHaken: (erledigt: boolean) => Promise<boolean>
}) {
  const { aufgabe, unteraufgaben, istBlatt, erledigt: giltAlsErledigt, blockiertVon } = knoten

  /*
   * Das Häkchen folgt dem Finger und gibt die Führung erst ab, wenn der
   * Bestand nachgezogen hat (§5) — dieselbe Überlegung wie in der erweiterten
   * Ansicht, und aus demselben Grund: Ein Kästchen, das nach dem Tippen wieder
   * aufspringt, ist der Anlass, ein zweites Mal zu tippen.
   */
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

  return (
    <li className={stile.eintrag}>
      {/*
        Titel und Weg hinein stehen nebeneinander: Der Link steht damit dort,
        wo der Daumen ohnehin schon ist, und die Zeile bleibt eine Zeile,
        statt unter jedem Titel noch eine eigene Reihe zu bekommen.
      */}
      <div className={stile.kopfzeile}>
        {istBlatt ? (
          <Checkbox
            className={stile.kopftitel}
            abhaken
            checked={erledigt}
            disabled={gesperrt || !darfHaken}
            onChange={(ereignis) => void haken(ereignis.target.checked)}
            label={aufgabe.titel}
            nurKaestchen
          />
        ) : (
          <p
            className={[stile.titel, stile.kopftitel, giltAlsErledigt ? stile.fertig : null]
              .filter(Boolean)
              .join(' ')}
          >
            {aufgabe.titel}
          </p>
        )}

        {/*
          Die eine Aufgabe, die noch aus dem Katalog kommt (ADR-0001), hat keine
          eigene Detailseite: Ihr Ergebnis steht im Fragebaum, nicht in einem
          Titel- und Beschreibungsfeld. Erkannt wird sie an ihrer Herkunft und
          nicht am Titel, damit eine umbenannte Aufgabe den Weg dorthin nicht
          verliert (§7, ERBE_DESIGN.md §9).
        */}
        <Link
          className={stile.weiter}
          to={istSeedAufgabe(aufgabe.katalog) ? '/erbe/fragebaum' : `/aufgabe/${aufgabe.id}`}
        >
          {istSeedAufgabe(aufgabe.katalog) ? 'Fragebaum starten' : 'Öffnen'}
          <span className="nur-vorlesen">: „{aufgabe.titel}“</span>
          <Winkel />
        </Link>
      </div>

      {unter === null ? null : <p className={stile.hinweis}>Gehört zu „{unter}“</p>}

      {zustaendig === null ? null : <p className={stile.hinweis}>{zustaendig}</p>}

      {istBlatt ? null : (
        <p className={stile.hinweis}>
          {unteraufgaben.filter((eins) => eins.erledigt).length} von {unteraufgaben.length}{' '}
          Schritten erledigt
        </p>
      )}

      <Fristzeile lage={lage} />

      {/* §3.7: Wer nicht sieht, dass die Geschwister diese Aufgabe nicht sehen,
          schreibt etwas hinein, das er für geteilt hält. */}
      {aufgabe.privat ? <p className={stile.hinweis}>Nur für mich</p> : null}

      {/* §7: Blockierte Aufgaben benennen, worauf sie warten. */}
      {blockiertVon.length === 0 ? null : (
        <p className={stile.hinweis}>
          Zuerst: {blockiertVon.map((offen) => offen.titel).join(', ')}
        </p>
      )}

    </li>
  )
}

/**
 * Ein Abschnitt: Überschrift, darunter der Inhalt, darüber eine Haarlinie.
 *
 * Dieselbe Form wie in `screens/einfach/Aufgabe/Aufgabe.tsx`, hier exportiert:
 * "Start" und "Alle" brauchen sie beide für den Abschnitt "Weitere Aufgaben"
 * (§7).
 */
export function Abschnitt({ titel, children }: { titel: string; children: ReactNode }) {
  return (
    <section className={stile.abschnitt}>
      <h2>{titel}</h2>
      {children}
    </section>
  )
}

/**
 * Die Beschriftung des Auf-/Zuklappers für erledigte Aufgaben (§7).
 *
 * Eine Funktion und keine Konstante, weil die Zahl mitgezählt werden soll:
 * "1 erledigte Aufgabe" und nicht "1 erledigte Aufgaben".
 */
export function erledigtSchalter(anzahl: number): { titel: string; offenText: string } {
  const wort = anzahl === 1 ? 'erledigte Aufgabe' : 'erledigte Aufgaben'

  return { titel: `${anzahl} ${wort} anzeigen`, offenText: `${anzahl} ${wort} ausblenden` }
}
