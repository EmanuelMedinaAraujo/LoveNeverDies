/**
 * Die Texte des Nachlass-Bereichs (DESIGN.md §3.5, §8).
 *
 * Sie stehen hier und nicht in den Screens, aus demselben Grund wie die
 * Vorsorgefragen: Der Wortlaut ist abgestimmt, er wiederholt sich an mehreren
 * Stellen — die Checklistenerklärung steht vor dem Formular und noch einmal
 * über der Übersicht —, und wer ihn ändert, soll ihn an einer Stelle ändern.
 *
 * Struktur statt langer Strings mit Zeilenumbrüchen: Eine Aufzählung ist hier
 * eine Aufzählung und wird als `ul` gesetzt (`types/infotext.ts`).
 */

import type { Infotext } from '../types/infotext.ts'

/**
 * Was auf der Seite „Aufgabe erstellen" über der Schaltfläche steht.
 *
 * Der Satz erklärt, was eine Aufgabe in einem Vorsorgefall überhaupt ist:
 * keine gesetzliche Frist und keine Behörde, sondern eine Bitte an die
 * Angehörigen. Ohne ihn stünde dort eine Schaltfläche und die Frage, wozu.
 */
export const AUFGABEN_EINLEITUNG =
  'In diesem Bereich können Sie Ihren Angehörigen persönliche Bitten und kleine Aufgaben mitgeben.'

/** Was eine Nachlass-Checkliste ist, vor dem Formular und über der Übersicht. */
export const CHECKLISTE_ERKLAERUNG: Infotext = {
  titel: 'Was bedeutet das?',
  abschnitte: [
    {
      art: 'absatz',
      text: 'Eine Nachlass-Checkliste ist eine digitale Übersicht, in der Nutzer vorsorglich alle wichtigen Informationen für den Todesfall hinterlegen. Über das Formular in der App erfassen Vorsorgende zentrale Details, damit Angehörige im Ernstfall organisatorisch entlastet werden und nicht lange suchen müssen.',
    },
  ],
}
