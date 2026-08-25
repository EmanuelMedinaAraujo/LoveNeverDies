# ADR-0001: Rechtskatalog auf eine Aufgabe reduziert

**Status:** angenommen · 2026-08-25

## Kontext

`DESIGN.md` §8 beschreibt einen von Juristinnen gepflegten Rechtskatalog: zehn Aufgaben in
`src/content/rechtskatalog.de.csv`, über `npm run import:content` nach
`src/content/catalog.de.json` übersetzt und beim Übergang in den Trauerfall in den Fall
instanziiert.

Der **Inhalt** dieser zehn Einträge wird als überwiegend unzuverlässig zurückgezogen.
Die Einschätzung kommt aus dem Projekt, nicht aus einer Prüfung in diesem Repository; sie
ist der Anlass dieser Entscheidung und nicht ihr Ergebnis. Ein Rechtsinhalt, dem man nicht traut, ist schlimmer
als keiner: Er steht im Fall, trägt Fristen und Rechtsgrundlagen, und niemand prüft ihn
nach, gerade weil er aussieht, als sei er geprüft.

Zu unterscheiden sind drei Dinge, die im Code alle "Katalog" heißen:

1. der **Inhalt** — die zehn Zeilen,
2. die **Mechanik** — Importweg, `K_cat`, deterministische Ids `UUIDv5(HMAC)`,
   `cases.catalog_version`, `instanziiereKatalog`,
3. das **`katalog`-Feld an der Aufgabe** — `fristTage`, `fristAb`, Rechtsgrundlage,
   zuständige Stelle, Hinweis, Quelle.

## Entscheidung

**Der Inhalt wird zurückgezogen. Mechanik und Feld bleiben.**

Der Katalog behält genau einen Eintrag: die Aufgabe *"Klären, ob Sie Erbe sind"*, die auf
den Fragebaum führt. Alle übrigen Aufgaben entstehen künftig durch Menschen oder durch den
Fragebaum.

## Begründung

Die Mechanik zu entfernen wäre teuer und brächte nichts. Sie leistet zwei Dinge, die
weiterhin gebraucht werden:

- **Genau einmal anlegen.** Zwei Geräte derselben Person, die gleichzeitig
  synchronisieren, legen die Seed-Aufgabe sonst zweimal an. Die deterministische Id mit
  `on conflict do nothing` löst das ohne Server-Koordination — und der Server kann hier
  nicht koordinieren, weil er die Items nicht lesen kann.
- **Rechtsangaben an der Aufgabe.** Die vom Fragebaum erzeugte Ausschlagungs-Aufgabe muss
  `42 / kenntnis` und `§ 1944 BGB` tragen, sonst rechnet die Frist nicht und die
  Erinnerungen fallen aus. Das Feld dafür existiert bereits und wird von beiden
  Aufgaben-Screens gerendert.

## Folgen

- `depends_on` verschwindet vollständig; es gab nur Verweise zwischen entfernten
  Einträgen (`erbschein-pruefen` und `erbschaftsteuer-anzeigen` auf
  `erbausschlagung-pruefen`). Diese Verweise wären ohnehin unzulässig geworden: Die
  Ausschlagungs-Aufgabe aus dem Fragebaum ist privat, und nach §3.7 darf nichts von einer
  privaten Aufgabe abhängen.
- **Bestehende Trauerfälle behalten ihre zehn Aufgaben.** Der Katalog initialisiert nur
  (§8); die Items sind Ende-zu-Ende-verschlüsselt, keine Migration erreicht sie. Ein Fall,
  der vor dieser Änderung entstanden ist, kann daher die alte Ausschlagungs-Aufgabe *und*
  eine neue private aus dem Fragebaum enthalten.
- `catalog_version` bleibt eine Herkunftsangabe und verliert an Aussagekraft, solange der
  Katalog aus einem Eintrag besteht.
- §8 in `DESIGN.md` wird auf das reduziert, was bleibt.

## Verworfene Alternativen

- **Nur die zwei vom Baum erzeugten Einträge entfernen.** Ließe acht Einträge stehen,
  deren Inhalt aus demselben Grund fragwürdig ist.
- **Katalog samt Mechanik löschen.** Nähme der Seed-Aufgabe die Idempotenz und der
  Ausschlagung ihre Frist; siehe oben.
