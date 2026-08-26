/**
 * Die Fragen der Nachlass-Checkliste (DESIGN.md §3.5).
 *
 * Wer vorsorgt, hat keine Aufgabenliste aus dem Rechtskatalog: Der Fall hat
 * kein Sterbedatum und keinen Katalog (§2). Was er hat, sind acht Auskünfte,
 * die den Angehörigen im Ernstfall die Suche ersparen — wo die Papiere liegen,
 * welche Verträge laufen, was mit der Bestattung sein soll.
 *
 * Rechtstext, also aus der Inhaltsschicht und nicht aus dem Screen (§8). Der
 * Wortlaut kommt von den Juristinnen und bleibt wörtlich; die Zeilenumbrüche
 * sind die des gelieferten Textes.
 *
 * Die Antworten liegen im Tresor, unter `K_v` wie jeder andere Inhalt dort
 * (§3.5): eine Zeile je beantworteter Frage, verbunden über {@link
 * Vorsorgefrage.id}. Eine unbeantwortete Frage hat keine Zeile — der Tresor
 * trägt keine leeren Hüllen.
 *
 * Die Reihenfolge ist die des Formulars und nicht alphabetisch oder nach
 * Wichtigkeit: Sie führt von den Papieren, die jeder hat, über die laufenden
 * Verpflichtungen bis zu dem, was persönlich wird. Wer oben anfängt, kommt
 * ins Schreiben, bevor die schwerste Frage kommt.
 */

import type { Vorsorgefrage } from '../types/vorsorgefrage.ts'

export const VORSORGEFRAGEN: Vorsorgefrage[] = [
  {
    id: 'dokumente',
    frage:
      'Wo befinden sich die folgenden Dokumente: Personalausweis und/oder Reisepass, Nachweis über den letzten Wohnsitz, Rentennummer (falls vorhanden), Geburtsurkunde, Heiratsurkunde, Scheidungsurteil?',
  },
  {
    id: 'vertraege',
    frage:
      'Haben Sie Verträge, die noch laufen? Wenn ja, welche? Wo befinden sie sich (falls sie schriftlich verfasst worden sind)?\nBeispiel: Mietvertrag, Strom, Kfz usw.',
  },
  {
    id: 'abos',
    frage: 'Haben Sie Abonnements oder Mitgliedschaften?',
  },
  {
    id: 'testament',
    frage: 'Haben Sie ein Testament? Wenn ja, wo ist es?',
    anschluss: 'testament',
  },
  {
    id: 'versicherungen',
    frage:
      'Haben Sie eine Versicherung? Wenn ja – was für eine Versicherung? Wo befindet sie sich?\nBeispiel: Lebensversicherung, Unfallversicherung, Rentenversicherung.',
  },
  {
    id: 'vorsorgevollmacht',
    frage: 'Haben Sie eine Vorsorgevollmacht? Wenn ja, wo ist sie?',
    erlaeuterung:
      'Eine Vorsorgevollmacht bedeutet die Bestimmung einer Vertrauensperson für rechtliche, finanzielle und organisatorische Entscheidungen.',
  },
  {
    id: 'onlinedienste',
    frage:
      'Erstellen Sie eine Übersicht zu Online-Diensten, bei denen Sie ein Benutzerkonto haben. Führen Sie zudem die zugehörigen Benutzernamen und Passwörter auf.',
  },
  {
    id: 'bestattung',
    frage: 'Wünsche für Ihre Bestattung',
    erlaeuterung:
      'Wie stellen Sie sich Ihren Abschied vor? Hier können Sie Ihren Angehörigen liebevoll Orientierung geben – von der Bestattungsart bis hin zum Rahmen der Trauerfeier.',
  },
]

