/**
 * Die Erklärtexte hinter dem Erbstatus "Erbe" (ERBE_DESIGN.md §10).
 *
 * Wer erbt, steht vor zwei Fragen, die der Fragebaum nicht mehr stellt:
 * Brauche ich einen Erbschein, und erbe ich allein oder mit anderen? Beides
 * sind Auskünfte und keine Aufgaben — bis auf den Erbschein, den man
 * beantragen kann, und dafür gibt es den Bauplan in `fragebaumService.ts`.
 *
 * Rechtstext, also aus der Inhaltsschicht und nicht aus dem Screen
 * (DESIGN.md §8). Der Wortlaut kommt von den Juristinnen und bleibt wörtlich;
 * gegliedert wird er, umformuliert nicht.
 */

import type { Infoabschnitt, Infotext } from '../types/infotext.ts'

/** Was ein Erbschein ist, wofür er gebraucht wird und was er kostet. */
export const ERBSCHEIN: Infotext = {
  titel: 'Erbschein',
  abschnitte: [
    { art: 'zwischentitel', text: '1. Was ist ein Erbschein?' },
    {
      art: 'absatz',
      text: 'Eine amtliche Urkunde, die bestätigt, wer erbt und zu welchem Anteil.',
    },
    { art: 'zwischentitel', text: '2. Wofür wird er gebraucht?' },
    {
      art: 'punkte',
      punkte: [
        'Grundbuchamt (Immobilien und Grundstücke)',
        'Um über Konten des Verstorbenen zu verfügen (außer es bestand eine Vollmacht bereits vor dem Tod)',
        'Handelsregister',
        'Um bestimmte Verträge zu kündigen',
        'Um Versicherungen zu kündigen',
      ],
    },
    { art: 'zwischentitel', text: '3. Nicht nötig wenn:' },
    {
      art: 'punkte',
      punkte: ['Erbvertrag vorliegt', 'Notariell beurkundetes Testament'],
    },
    { art: 'zwischentitel', text: '4. Kosten' },
    {
      art: 'absatz',
      text: 'Der Erbschein kostet Geld. Der Betrag ist abhängig vom Nachlass.',
    },
  ],
}

/** Die Frage unter dem Erbschein-Text, über den beiden Knöpfen. */
export const ERBSCHEIN_FRAGE = 'Möchten Sie einen Erbschein beantragen?'

/**
 * Der Weg zum Erbschein.
 *
 * Er steht nicht im aufgeklappten Text, sondern nur in der Aufgabe: Wer noch
 * überlegt, ob er einen Erbschein braucht, braucht die Terminfrage nicht; wer
 * "Ja" gesagt hat, braucht genau sie als Nächstes.
 */
export const ERBSCHEIN_ANTRAG: Infotext = {
  titel: 'Wie beantragen Sie einen Erbschein?',
  abschnitte: [
    {
      art: 'punkte',
      punkte: [
        'Beim Notar oder beim Nachlassgericht',
        'Anrufen oder online Termin vereinbaren - die Stellen erklären Ihnen die weiteren Schritte',
      ],
    },
    { art: 'zwischentitel', text: 'Notar oder Nachlassgericht' },
    {
      art: 'punkte',
      punkte: [
        'Beim Notar erhalten Sie schneller und sicher innerhalb der First einen Termin',
        'Beim Nachlassgericht fallen Ihnen keine zusätzlichen Kosten an',
      ],
    },
  ],
}

export const ERBENGEMEINSCHAFT: Infotext = {
  titel: 'Erbengemeinschaft',
  abschnitte: [
    {
      art: 'absatz',
      text: 'Die Erbengemeinschaft ist eine Gruppe von Personen, die gemeinsam den Nachlass einer verstorbenen Person erben. Sie bildet sich sofort mit dem Tod des Erblassers.',
    },
    { art: 'zwischentitel', text: 'Hinweise' },
    {
      art: 'absatz',
      text: '1. Der Nachlass (zum Beispiel das Geld, das Auto usw.) gehört der gesamten Gruppe.',
    },
    {
      art: 'absatz',
      text: '2. Den Nachlass muss man gemeinsam verwalten. Wichtige Entscheidungen müssen einstimmig getroffen werden.',
    },
    {
      art: 'absatz',
      text: '3. Die Gemeinschaft ist eine Übergangslösung. Am Ende steht die Aufteilung, bei der jeder seinen festen Anteil bekommt.',
    },
  ],
}

export const ALLEINERBE: Infotext = {
  titel: 'Alleinerbe',
  abschnitte: [
    {
      art: 'absatz',
      text: 'Als Alleinerbe tritt man das ganze Erbe an. Sowohl das gesamte Vermögen als auch alle Schulden gehen auf den Erben über.',
    },
  ],
}

/** Der gefüllte Punkt vor jedem Aufzählungspunkt (§7). */
const PUNKT = '•'

/**
 * Ein Infotext als Fließtext, für Felder, die keine Struktur tragen.
 *
 * Die Beschreibung einer Aufgabe ist ein String, und dort landet der Erbschein
 * beim Anlegen. Damit dieselbe Aufzählung nicht zweimal getippt wird — einmal
 * strukturiert für die Seite und einmal als Text für die Aufgabe —, entsteht
 * der Text hier aus derselben Quelle. Zwei Fassungen desselben Rechtstextes
 * sind zwei Fassungen, die auseinanderlaufen (ERBE_DESIGN.md §2).
 */
export function alsText(...texte: Infotext[]): string {
  return texte.map(einText).join('\n\n')
}

function einText(text: Infotext): string {
  const zeilen: string[] = [text.titel]

  for (const abschnitt of text.abschnitte) {
    // Eine Leerzeile vor jeder Zwischenueberschrift: Sie ist der Anfang von
    // etwas Neuem, und ohne Luft davor liest sie sich als Fortsetzung.
    if (abschnitt.art === 'zwischentitel') {
      zeilen.push('')
    }

    zeilen.push(abschnittText(abschnitt))
  }

  return zeilen.join('\n')
}

function abschnittText(abschnitt: Infoabschnitt): string {
  switch (abschnitt.art) {
    case 'absatz':
    case 'zwischentitel':
      return abschnitt.text
    case 'punkte':
      return abschnitt.punkte.map((punkt) => `${PUNKT} ${punkt}`).join('\n')
  }
}
