# ADR-0003: Keine Rechtsgrundlagen und keine Quelllinks an Aufgaben

**Status:** angenommen · 2026-08-25

## Kontext

Jede Aufgabe trug bis hierher zwei Felder, die aus `DESIGN.md` §8 stammen und die beide
Aufgaben-Screens gerendert haben:

- `rechtsgrundlage` — der Paragraph, etwa `§ 1944 BGB`, als Zeile unter „Rechtsgrundlage"
  im Abschnitt „Rechtliches",
- `quelleUrl` — ein Link auf die Gesetzesseite, in der erweiterten Ansicht als Zeile
  „Quelle" mit der vollen URL als Linktext.

ADR-0001 hat den Katalogbestand auf eine Aufgabe reduziert und die Rechtsangaben der drei
vom Fragebaum erzeugten Aufgaben nach `src/services/fragebaumService.ts` verschoben. Dort
standen sie zuletzt: `§ 2259 BGB`, `§ 1944 BGB`, `§ 2082 BGB`, jeweils mit einem Link nach
`gesetze-im-internet.de`.

Ein Bildschirm, der zu einer Handlung einen Paragraphen nennt und daneben die Fundstelle
verlinkt, ist der Form nach eine Rechtsauskunft. Dieses Projekt darf keine geben. Dass die
Angaben inhaltlich zutreffen mögen, ändert daran nichts: Es geht nicht um ihre Richtigkeit,
sondern darum, wonach der Screen aussieht.

## Entscheidung

**`rechtsgrundlage` und `quelleUrl` entfallen vollständig** — in der Quelltabelle, im Typ,
im Item-Payload, im Fragebaum und in beiden Aufgaben-Screens.

Der Abschnitt „Rechtliches" in der erweiterten Ansicht heißt jetzt „Das gilt dafür", wie er
in der einfachen Ansicht schon hieß. Ein Abschnitt namens „Rechtliches" ohne Rechtsangaben
trüge das Signal weiter, das gerade entfernt wird.

## Begründung

Was bleibt, ist das, wonach jemand handelt: die **Frist**, die **zuständige Stelle**, die
**benötigten Dokumente** und der **Hinweis** in Alltagssprache. Wer wissen will, in welcher
Frist er die Erbschaft ausschlagen kann, braucht „sechs Wochen ab Ihrer Kenntnis von Anfall
und Berufungsgrund" und die Adresse des Nachlassgerichts. Die Fundstelle dazu braucht
niemand, der handelt — sie steht dort für jemanden, der prüft, und dieser Screen ist nicht
für Prüfung gemacht.

Die Hinweise bleiben unverändert. Sie sind Orientierung in Alltagssprache und tragen keine
Zitate; der Ausschlagungshinweis ist die wertvollste Zeile der App.

## Folgen

- Der Import verlangt zu einer Frist **keine Rechtsgrundlage mehr**. Die harte Regel aus
  §8 („eine Zahl ohne Paragraph ist eine Behauptung") fällt damit weg. Was bleibt, ist die
  Rechenbarkeit: `frist_tage` ohne `frist_ab` und `frist_ab` ohne `frist_tage` brechen den
  Import weiterhin ab, denn eine Frist, die ab nichts läuft, ist nicht anzeigbar.
- `catalog.de.json` und damit `catalog_version` ändern sich. Bestehende Fälle behalten die
  Angaben in ihren Item-Payloads: Die Items sind Ende-zu-Ende-verschlüsselt, keine
  Migration erreicht sie (§8). Gerendert werden sie nicht mehr, denn `herkunftAus` liest
  die beiden Felder nicht mehr aus dem Payload.
- Die Datenbank wird für diese Änderung zurückgesetzt. Das Projekt hat noch keine Nutzer.

## Verworfene Alternativen

- **Nur die Anzeige entfernen, die Daten behalten** — samt Importregel. Hätte den Schutz
  „keine Frist ohne Fundstelle" erhalten. Verworfen: Die Paragraphen lägen weiter im
  ausgelieferten Bundle und im Payload jedes Falls, und die Regel schützte etwas, das
  niemand mehr zu sehen bekommt.
- **Nur `rechtsgrundlage` entfernen, `quelleUrl` behalten.** Eine Zeile „Quelle:
  https://www.gesetze-im-internet.de/bgb/\_\_1944.html" ist dasselbe Signal in anderer
  Form.
