/**
 * Die Fragen, die im Vorsorgefall von Anfang an dastehen (DESIGN.md §3.5).
 *
 * Wer vorsorgt, hat keine Aufgaben: Der Fall hat kein Sterbedatum und keinen
 * Rechtskatalog (§2). Was er hat, sind acht Auskünfte, die den Angehörigen im
 * Ernstfall die Suche ersparen — wo die Papiere liegen, welche Verträge laufen,
 * was mit der Bestattung sein soll. Sie stehen deshalb auf dem ersten Screen
 * und nicht hinter einer Schaltfläche.
 *
 * Rechtstext, also aus der Inhaltsschicht und nicht aus dem Screen (§8). Der
 * Wortlaut kommt von den Juristinnen und bleibt wörtlich; die Zeilenumbrüche
 * sind die des gelieferten Textes.
 *
 * Die Antworten liegen im Tresor, unter `K_v` wie jeder andere Inhalt dort
 * (§3.5): eine Zeile je beantworteter Frage, verbunden über {@link
 * Vorsorgefrage.id}. Eine unbeantwortete Frage hat keine Zeile — der Tresor
 * trägt keine leeren Hüllen.
 */

import type { Vorsorgefrage } from '../types/vorsorgefrage.ts'

export const VORSORGEFRAGEN: Vorsorgefrage[] = [
  {
    id: 'dokumente',
    frage:
      'Wo befinden sich die folgenden Dokumente: Personalausweis und/oder Reisepass; Nachweis über den letzten Wohnsitz, Rentennummer (falls vorhanden); Geburtsurkunde, Heiratsurkunde, Scheidungsurteil',
  },
  {
    id: 'vollmacht',
    frage: 'Gibt es eine postmortale Vollmacht? Wenn ja an wen und für was?',
  },
  {
    id: 'vertraege',
    frage:
      'Haben Sie Verträge, die noch laufen? Wenn ja, welche? Wo befinden sie sich (wenn sie schriftlich verfasst worden sind)\nBeispiel: Mietvertrag, Wasser, Strom, Kfz usw.',
  },
  {
    id: 'abos',
    frage: 'Haben Sie Abonnements oder Mitgliedschaften?',
  },
  {
    id: 'testament',
    frage: 'Haben Sie ein Testament? Wenn ja, wo befindet es sich?',
  },
  {
    id: 'versicherungen',
    frage:
      'Haben Sie eine Versicherung? Wenn ja, was für eine Versicherung – Lebensversicherung, Unfallversicherung, Rentenversicherung, Krankenkasse. Wo befindet sie sich?',
  },
  {
    id: 'sachversicherungen',
    frage:
      'Haben Sie Versicherungen für bestimmte Gegenstände?\nSachversicherungen wie zB Kfz-Versicherung',
  },
  {
    id: 'bestattung',
    frage: 'Haben Sie Wünsche für Ihre Beerdigung oder die Bestattung?',
  },
]
