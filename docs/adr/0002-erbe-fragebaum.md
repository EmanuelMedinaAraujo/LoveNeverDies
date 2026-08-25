# ADR-0002: Erbe-Fragebaum

**Status:** angenommen · 2026-08-25

## Kontext

Die erste Frage nach einem Todesfall ist nicht "welche Aufgaben habe ich", sondern "bin ich
überhaupt Erbe". Die Juristinnen haben sie als Entscheidungsbaum ausgearbeitet: 141 Knoten,
80 Ergebnisse, Tiefe 9.

Die ausführliche Beschreibung steht in `ERBE_DESIGN.md`. Hier stehen nur die
Entscheidungen, die sich nicht von selbst verstehen.

## Entscheidungen

### Die Baumstruktur bleibt wörtlich, samt Wiederholungen

Der Ausschlagungstext steht zehnmal im Datenmodul, mehrere Teilbäume achtmal. Ein
Knotengraph mit geteilten Ids wäre kürzer.

Die Juristinnen pflegen einen **Baum**. Zwei Pfade, die heute denselben Text zeigen, dürfen
ihn morgen unterschiedlich zeigen; mit geteilten Ids müsste dafür erst eine
Verweisstruktur aufgelöst werden, und zwar von jemandem, der Erbrecht kann und nicht
TypeScript.

### Alles, was der Baum hervorbringt, ist privat

Antworten, Ergebnis, Erbstatus und die drei erzeugten Aufgaben liegen unter `K_p` (§3.7),
nicht unter `K_c`.

Bei Fragen wie Ausschlagung, Anfechtung und Erbenstellung ist die Familie die interessierte
Partei. §3.7 führt die Erbausschlagung selbst als Beispiel dafür an.

Der Preis wird bewusst getragen: Die Familie sieht nicht, dass jemand ein Testament
abgeliefert hat, und keine geteilte Aufgabe darf von einer der drei abhängen.

### Kein Zwischenstand wird gespeichert

Geschrieben wird ausschließlich am Ergebnis. Der Pfad liegt im `state` des
History-Eintrags: Wer neu auf eine Frage kommt — geteilter Link, neuer Tab, wieder
geöffnete App —, fängt von vorn an. Ein Neuladen derselben Seite behält ihn, weil der
Browser den Eintrag samt `state` wiederherstellt; mit dem Tab ist er weg.

Ein halb gegangener Pfad ist keine Tatsache über das Erbe von irgendwem. Eine Antwort von
vorgestern, die heute stillschweigend weitergilt, ist schlechter als die Frage noch einmal
zu stellen.

### Der erste Durchlauf gilt, das Überschreiben ist ein eigener Knopf

Spätere Durchläufe zeigen ihr Ergebnis, überschreiben aber nicht. Auf der Ergebnisseite
steht, was gespeichert bleibt, daneben "Gespeichertes Ergebnis ersetzen".

Ein zweites Ergebnis still zu verwerfen wäre eine App, die es besser weiß. Es automatisch
zu übernehmen wäre eine App, in der neugieriges Durchklicken den eigenen Rechtsstand
umschreibt.

### Das "erledigt" der Seed-Aufgabe wird abgeleitet

Die Aufgabe *"Klären, ob Sie Erbe sind"* ist geteilt, ihr Erledigt-Zustand kommt aber aus
dem eigenen, privaten Ergebnis und wird nicht gespeichert.

Sonst hakte Anna sie ab und Bert, der den Baum nie gegangen ist, sähe seine Aufgabe
erledigt. §7 leitet `erledigt` bereits bei Aufgaben mit Unteraufgaben ab; §8 zeigt an den
Fristen, dass dieselbe geteilte Aufgabe jedem Mitglied etwas anderes zeigen darf, solange
das Unterschiedliche privat liegt.

### Ein Renderer für beide Ansichten

Kein getrennter Screen-Baum wie bei `Start`, `Aufgabe`, `Alle`. §7 begründet das für `Erbe`
bereits; bei 80 Ergebnistexten wiegt es schwerer. In der einfachen Ansicht wird gekürzt
angezeigt, nicht umformuliert — §8: "Erfunden wird nichts."

### Die Suche nach dem Nachlassgericht ist ein sichtbarer Platzhalter

Sie antwortet immer "Nachlassgericht München" und sagt dabei, dass sie noch keine echte
Suche ist. Ein unkommentiert falscher Gerichtsname ist etwas, wonach jemand handelt. Die
Eingabe wandert trotzdem in die Aufgabe, damit sie nicht verloren ist.

## Folgen

- Der Rechtskatalog wird auf eine Aufgabe reduziert; siehe ADR-0001.
- `kenntnisAm` bekommt eine zweite Eingabestelle im Fragebaum, dieselbe Ablage wie bisher.
- Das private Konfigurations-Item trägt neben `kenntnisAm` künftig den Fragebaum-Datensatz.
