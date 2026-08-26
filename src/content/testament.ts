/**
 * Was beim Verfassen eines Testaments zu beachten ist (DESIGN.md §3.5, §8).
 *
 * Der Text hängt an der Testamentfrage der Nachlass-Checkliste: Wer dort
 * einträgt, dass es kein Testament gibt, steht vor der nächsten Frage — wie
 * denn eines entsteht. Er steht deshalb hinter der Frage und nicht neben ihr:
 * Wer sein Testament längst im Ordner liegen hat, soll ihn nicht wegblättern
 * müssen (§7).
 *
 * Rechtstext, also aus der Inhaltsschicht und nicht aus dem Screen. Der
 * Wortlaut kommt von den Juristinnen und bleibt wörtlich; gegliedert wird er,
 * umformuliert nicht.
 */

import type { Infotext } from '../types/infotext.ts'

/** Die Überschrift der Seite. Der Infokasten darunter trägt seinen eigenen Titel. */
export const TESTAMENT_TITEL = 'So verfassen Sie ein Testament'

/** Die Frage unter dem Antwortfeld zum Testament, über der Schaltfläche. */
export const TESTAMENT_FRAGE = 'Sie haben kein Testament? Möchten Sie eines verfassen?'

export const TESTAMENT_VERFASSEN: Infotext = {
  titel: 'Was zu beachten ist',
  abschnitte: [
    { art: 'zwischentitel', text: 'Aussehen' },
    {
      art: 'punkte',
      punkte: [
        'handschriftlich von der verstorbenen Person geschrieben',
        'die Unterschrift der verstorbenen Person und das Datum stehen unter dem Text',
        'das Wort „Testament“ ist nicht notwendig',
        'ein Testament kann auf einem beliebigen Material geschrieben sein',
      ],
    },
    { art: 'zwischentitel', text: 'Inhalt' },
    {
      art: 'absatz',
      text: 'Das Testament macht in irgendeiner Form deutlich, wie das Vermögen aufgeteilt werden soll.',
    },
  ],
}
