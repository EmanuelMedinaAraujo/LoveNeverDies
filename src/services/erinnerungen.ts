/**
 * Lokale Erinnerungen an Fristen (DESIGN.md §7).
 *
 * "Rein lokal, aus entschlüsselten Fristen, nach jeder Synchronisation neu
 * geplant." Ein Server-Push ist hier nicht weggelassen, sondern unmöglich: Die
 * Fristangaben liegen verschlüsselt im Payload, der Server sieht `{fristTage,
 * fristAb}` nie (§3.3). Wer erinnert werden soll, muss die Frist selbst
 * ausrechnen, und das kann nur ein Gerät mit `K_c`.
 *
 * Dieses Modul plant und weiss nichts von Timern oder Benachrichtigungen:
 * Aufgaben und eine Uhrzeit hinein, Termine heraus. Die Umsetzung steht in
 * `hooks/useErinnerungen.ts`, und die Trennung ist der Grund, warum sich die
 * Regeln unten prüfen lassen, ohne die Zeit anzuhalten.
 */

import type { Aufgabenknoten } from './aufgabenbaum'
import { fristlage, heuteIso, type Fristbezug } from './fristen'

/**
 * Wie viele Tage vor dem Fristende erinnert wird.
 *
 * Absteigend, damit die Termine je Aufgabe in der Reihenfolge entstehen, in der
 * sie fällig werden. Vier Erinnerungen sind für eine gesetzliche Frist nicht zu
 * viel: Die letzte kommt am Fristtag selbst, und wer bis dahin nichts getan
 * hat, hat noch einen Tag.
 */
export const ERINNERUNGSTAGE = [7, 3, 1, 0] as const

/**
 * Wie weit im Voraus überhaupt geplant wird.
 *
 * `setTimeout` trägt knapp 25 Tage (`2^31 - 1` Millisekunden); ein längerer
 * Vorlauf feuerte sofort statt später. Was über diesen Horizont hinausreicht,
 * plant der nächste Abgleich, und der kommt lange vorher.
 */
const HORIZONT_TAGE = 21

/** Zu welcher Stunde erinnert wird. Vormittags, nicht nachts. */
const STUNDE = 9

const TAG_MS = 86_400_000

export type Erinnerung = {
  itemId: string
  titel: string
  /** Zeitpunkt als Millisekunden seit Epoch, lokale Vormittagsstunde. */
  wann: number
  /** Was in der Benachrichtigung steht. */
  text: string
}

/**
 * Der Vormittag des Tages, der `vorlauf` Tage vor `ende` liegt, in der
 * Zeitzone des Geräts.
 *
 * Gerechnet wird das Fristende in UTC (`fristen.ts`), erinnert wird in der Zeit
 * des Geräts: Eine Benachrichtigung soll morgens ankommen, wo jemand sitzt, und
 * nicht um vier Uhr früh.
 */
function terminZeit(ende: string, vorlauf: number): number {
  const [jahr, monat, tag] = ende.split('-').map(Number)

  return new Date(jahr ?? 0, (monat ?? 1) - 1, (tag ?? 1) - vorlauf, STUNDE).getTime()
}

function text(titel: string, vorlauf: number): string {
  if (vorlauf === 0) {
    return `„${titel}" ist heute fällig.`
  }

  return vorlauf === 1
    ? `„${titel}" ist morgen fällig.`
    : `„${titel}" ist in ${vorlauf} Tagen fällig.`
}

/**
 * Die Termine, die dieses Gerät jetzt einplanen soll.
 *
 * Übergangen wird, was keine Erinnerung verdient: erledigte Aufgaben (auch die
 * abgeleitet erledigten, §7), Aufgaben ohne gesetzliche Frist, Fristen ab
 * Kenntnis ohne eingetragenes Kenntnisdatum (§8, #12) und alles, was in der
 * Vergangenheit liegt.
 *
 * Wer sein Kenntnisdatum einträgt, bekommt die Termine dazu: Die Aufgabe hat
 * von da an ein Fristende, und der Plan entsteht bei jedem neuen Baum neu.
 *
 * Blockierte Aufgaben bleiben ausdrücklich drin. Eine Frist läuft weiter,
 * gleich ob eine andere Aufgabe noch aussteht: Das ist eher ein Grund für die
 * Erinnerung als einer dagegen.
 *
 * @param jetzt die aktuelle Zeit: als Parameter, damit diese Funktion rein
 * bleibt.
 */
export function planeErinnerungen(
  baum: Aufgabenknoten[],
  bezug: Fristbezug,
  jetzt: Date,
): Erinnerung[] {
  const ab = jetzt.getTime()
  const bis = ab + HORIZONT_TAGE * TAG_MS

  const heute = heuteIso(jetzt)

  const termine: Erinnerung[] = []

  for (const knoten of baum) {
    if (knoten.erledigt) {
      continue
    }

    const lage = fristlage(knoten.aufgabe.katalog, bezug, heute, knoten.aufgabe.fristAm)

    if (lage.art !== 'datum') {
      continue
    }

    for (const vorlauf of ERINNERUNGSTAGE) {
      const wann = terminZeit(lage.ende, vorlauf)

      if (wann > ab && wann <= bis) {
        termine.push({
          itemId: knoten.aufgabe.id,
          titel: knoten.aufgabe.titel,
          wann,
          text: text(knoten.aufgabe.titel, vorlauf),
        })
      }
    }
  }

  return termine.sort((links, rechts) => links.wann - rechts.wann)
}
