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
  titel: 'Wie beantrage ich einen Erbschein?',
  abschnitte: [
    {
      art: 'absatz',
      text: 'Zwei Möglichkeiten:\n[gruen:Über ein Notariat:]',
    },
    {
      art: 'punkte',
      punkte: [
        'telefonisch oder online Termin vereinbaren',
        'Antrag und notwendigen Dokumente mitbringen',
        'der Notar nimmt die eidesstattliche Versicherung entgegen und leitet den Antrag an das Nachlassgericht weiter',
        'das Nachlassgericht wird sich bei Ihnen melden',
      ],
    },
    {
      art: 'absatz',
      text: '[gruen:Über das Nachlassgericht:]',
    },
    {
      art: 'punkte',
      punkte: [
        'Termin telefonisch vereinbaren',
        'den schriftlichen Antrag und die notwendigen Dokumente zum persönlichen Termin mitbringen',
        'beim Termin werden Sie eine eidesstattliche Versicherung abgeben, welche bestätigt, dass der Inhalt der oben genannten Dokumente der Wahrheit entspricht',
        'das Nachlassgericht wird sich bei Ihnen melden',
      ],
    },
    { art: 'zwischentitel', text: 'Notar oder Nachlassgericht:' },
    {
      art: 'punkte',
      punkte: [
        'Notar: Sie erhalten schneller einen Termin',
        'Nachlassgericht: Ihnen fallen keine zusätzlichen Kosten an',
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

export const TESTAMENTSANFECHTUNG: Infotext = {
  titel: 'Informationen zur Testamentsanfechtung',
  abschnitte: [
    { art: 'zwischentitel', text: '1. Was ist das?' },
    {
      art: 'absatz',
      text: 'Eine Testamentsanfechtung bedeutet, dass ein Testament nachträglich für ungültig erklärt wird, weil beim Verfassen etwas grundlegend schiefgelaufen ist.',
    },
    { art: 'zwischentitel', text: '2. Wer darf anfechten?' },
    {
      art: 'absatz',
      text: 'Pflichtteilsberechtigte: Kind, Ehegatte, Elternteil',
    },
    {
      art: 'punkte',
      punkte: [
        'Elternteile dürfen nur anfechten, wenn die Abkömmlinge der verstorbenen Person bereits verstorben sind.',
        'Enkel dürfen nur anfechten, wenn das Elternteil, das Kind der verstorbenen Person ist, bereits verstorben ist.',
      ],
    },
    {
      art: 'absatz',
      text: 'Jeder, der bei gesetzlicher Erbfolge Erbe wäre.\nJeder, den ein vorheriges Testament zum Erben einsetzt.',
    },
    { art: 'zwischentitel', text: '3. Welche Gründe rechtfertigen eine Anfechtung?' },
    {
      art: 'punkte',
      punkte: [
        'Verschreiben oder Versprechen: Die verstorbene Person wollte eigentlich etwas anderes schreiben, als am Ende im Testament steht.',
        'Bedeutungsfehler: Die verstorbene Person nutzt einen Begriff, versteht dessen rechtliche oder tatsächliche Bedeutung aber falsch.',
        'Falsche Beweggründe: Die verstorbene Person hat sich über die Zukunft oder über Tatsachen geirrt.',
        'Drohung: Das Testament wurde nur verfasst, weil jemand die verstorbene Person unrechtmäßig unter Druck gesetzt oder bedroht hat.',
        'Täuschung: Das Testament wurde nur verfasst, weil jemand die verstorbene Person getäuscht hat.',
      ],
    },
    {
      art: 'absatz',
      text: '**Nur für Pflichtteilsberechtigte:**',
    },
    {
      art: 'punkte',
      punkte: [
        'Die verstorbene Person hat beim Erstellen des Testaments nicht an Ehegatte, Elternteil oder Kind gedacht. Es kann aber davon ausgegangen werden, dass diese Person nach ihrem Willen Erbe werden sollte.',
        'Die verstorbene Person wusste beim Verfassen nicht, dass es noch ein Kind gibt (zum Beispiel ein erst später geborenes Kind).',
      ],
    },
    { art: 'zwischentitel', text: '4. Folge der Anfechtung' },
    {
      art: 'punkte',
      punkte: [
        'Das Testament wird ganz oder teilweise ungültig.',
        'Es gilt dann entweder das ältere Testament oder das Erbrecht nach dem Gesetz.',
      ],
    },
    { art: 'zwischentitel', text: '5. Frist' },
    {
      art: 'absatz',
      text: 'Frist: 1 Jahr\nDie Frist beginnt, sobald Sie von dem Grund für die Anfechtung erfahren haben (siehe Schritt 3).',
    },
    { art: 'zwischentitel', text: '6. Kosten' },
    {
      art: 'punkte',
      punkte: [
        'Durch die Anfechtung entstehen Kosten.',
        'Die Kosten werden gemildert oder entfallen bei wirksamer Anfechtung.',
      ],
    },
  ],
}

export const AUSSCHLAGUNG: Infotext = {
  titel: 'Sie wollen das Erbe nicht (Ausschlagung)',
  abschnitte: [
    { art: 'zwischentitel', text: '1. Frist' },
    {
      art: 'absatz',
      text: 'Die Frist beträgt 6 Wochen.\nFristbeginn:\n[gruen:Normalfall (gesetzliche Erbfolge):] Die Frist läuft ab dem Moment, in dem Sie erfahren, dass die Person gestorben ist und Sie gesetzlich erben.\n[gruen:Testament oder Erbvertrag:] Gibt es ein Testament, läuft die Frist erst los, wenn das Nachlassgericht Ihnen dieses Testament offiziell eröffnet und mitgeteilt hat – selbst wenn Sie vorher schon von dem Dokument wissen.',
    },
    { art: 'zwischentitel', text: '2. Wie können Sie das Erbe ablehnen?' },
    {
      art: 'absatz',
      text: 'Sie haben dafür zwei Möglichkeiten:\n[gruen:1. Über ein Notariat:]',
    },
    {
      art: 'punkte',
      punkte: [
        'Termin bei einem Notar vereinbaren',
        'Antrag auf Ausschlagung stellen',
        'Notar beurkundet den Antrag und schickt ihn an das Nachlassgericht',
      ],
    },
    {
      art: 'absatz',
      text: '[gruen:2. Persönlich beim Gericht:]',
    },
    {
      art: 'punkte',
      punkte: [
        'telefonisch Termin beim Nachlassgericht vereinbaren',
        'persönlich beim Nachlassgericht erscheinen',
      ],
    },
    {
      art: 'absatz',
      text: '**Notar oder Nachlassgericht:**',
    },
    {
      art: 'punkte',
      punkte: [
        'Beim Notar erhalten Sie schneller und sicher innerhalb der Frist einen Termin',
        'Beim Nachlassgericht fallen Ihnen keine zusätzlichen Kosten an',
      ],
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
