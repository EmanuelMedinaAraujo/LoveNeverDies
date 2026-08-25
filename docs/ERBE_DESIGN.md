# Erbe: Fragebaum, Erbstatus, Aufgaben

Ergänzung zu `DESIGN.md` für den Tab **Erbe**. Was hier steht, gilt zusätzlich zu §7
(Oberfläche), §8 (Rechtsinhalte) und §3.7 (Private Items); wo dieses Dokument etwas
anders regelt, steht der Grund dabei.

Die Frage, mit der jeder Nachlass anfängt, ist nicht "welche Aufgaben habe ich", sondern
"bin ich überhaupt Erbe". Sie ist rechtlich verzweigt, sie hängt an Umständen, die nur
die betroffene Person kennt, und sie ist die Voraussetzung dafür, dass irgendeine der
folgenden Aufgaben Sinn ergibt. Der Fragebaum stellt sie.

---

## 1. Abgrenzung

Der Fragebaum gehört zum **Trauerfall**. Ein Vorsorgefall hat laut §2 keine Aufgaben und
keine Erben; dort erscheint er nicht.

Er ist eine **Auskunft an eine Person über ihre eigene Lage**, keine gemeinsame Arbeit am
Nachlass. Alles, was er hervorbringt — die Antworten, das Ergebnis, der Erbstatus, die
Aufgaben — liegt deshalb privat unter `K_p` (§3.7) und nicht unter `K_c`. Zwei
Geschwister, die denselben Fall teilen, gehen den Baum getrennt und sehen voneinander
nichts davon.

Das ist keine Vorsichtsmaßnahme, sondern der Gegenstand selbst: Ob jemand ausschlagen
will, ob jemand ein Testament anficht, ob jemand überhaupt Erbe ist — das sind Fragen,
bei denen die Familie die interessierte Partei ist und nicht der Verbündete.

---

## 2. Der Inhalt

141 Knoten, 80 Ergebnisse, maximale Tiefe 9. Die Quelle ist ein Export aus einem
Entscheidungsbaum-Werkzeug, gepflegt von den Juristinnen.

**Die Struktur bleibt wörtlich.** Wiederholte Teilbäume bleiben wiederholt. Der
Ausschlagungstext steht zehnmal im Datenmodul, der Teilbaum "Gibt es lebende Kinder,
Enkel oder Urenkel des Verstorbenen?" achtmal, "Sie sind wahrscheinlich kein Erbe"
fünfunddreißigmal. Ein Knotengraph mit geteilten Ids wäre kürzer und wäre die falsche
Wahl: Die Juristinnen pflegen einen Baum, nicht einen Graphen, und zwei Pfade, die heute
denselben Text zeigen, dürfen ihn morgen unterschiedlich zeigen, ohne dass jemand erst
eine Verweisstruktur auflösen muss.

Der Export wird beim Übertragen ins Datenmodul normalisiert, und nur dort:

| Im Export | Im Datenmodul |
| --- | --- |
| `Yes` / `No` | `Ja` / `Nein` |
| `/n`, gelegentlich `n/` | Zeilenumbruch |
| `(Eingabefeld zum Suchen)` als Fließtext | die Komponente aus §8 |
| `(button um Aufgabe zu erstellen …)` als Fließtext | die Aktion aus §7 |
| `ℹ …` als Geschwisterzeile | `info` am Knoten |

**Genau eine Kette wird zusammengelegt**: `Wollen Sie das Erbe haben?` → einzige Antwort
`Ja oder Nein` → Seite, die nur aus dem Hinweis über Schulden besteht → `Ja` / `Nein`.
Das ist ein Artefakt des Werkzeugs und keine Absicht; daraus wird eine Seite mit der
Frage, dem Hinweis und zwei Antworten.

Andere Knoten mit nur einer Antwort bleiben eigene Seiten. Ihre einzige Antwort heißt
"Weiter zu Fragen über das Erbe" oder "Das Nachlassgericht hat sich gemeldet" und
bedeutet "ich habe das gelesen". Eine solche Seite wegzulegen hieße, eine Seite zu
löschen, auf der jemand stehen bleiben soll — darunter die, die den Knopf "Aufgabe
erstellen" trägt.

Der Quelltext des Exports wird **nicht** eingecheckt.

---

## 3. Seiten und Navigation

Eine Frage, eine Seite, eine Adresse: `/erbe/fragebaum/:knotenId`.

Der zurückgelegte Pfad steht im `state` des Routers und damit in dem Eintrag, den der
Browser für diese Seite in seiner History hält. Nicht in der Adresse, nicht in
`localStorage`, nicht in `sessionStorage` und nirgends im Fall. Daraus folgt:

- Der **Zurück-Knopf des Browsers** führt zur vorigen Frage. Auf einem Telefon ist das
  der Knopf, den Menschen tatsächlich benutzen; ein nur eingebautes "Zurück" wäre eine
  Falle.
- Wer **neu auf eine Frage kommt** — ein geteilter Link, ein Lesezeichen, ein neuer Tab,
  die wieder geöffnete App —, bringt keinen Pfad mit und fängt von vorn an. Aus der
  Mitte heraus so zu tun, als sei etwas beantwortet, wäre die schlechtere Antwort.
- Ein **Neuladen derselben Seite** behält den Pfad, weil der Browser den History-Eintrag
  samt `state` wiederherstellt. Das ist Verhalten des Browsers und keine Ablage der App;
  mit dem Tab ist es weg.

Kein Zwischenstand wird gespeichert, weder lokal noch im Fall. Ein halb gegangener Pfad
ist keine Tatsache über das Erbe von irgendwem, und eine Antwort von vorgestern, die
heute stillschweigend weitergilt, ist schlechter als die Frage noch einmal zu stellen.

**Gestaltung.** Die Seiten des Fragebaums sind nicht in Karten gefasst: eine Frage, ihre
Antworten darunter als Liste, sonst nichts. Eine Karte trennt Dinge voneinander, und auf
einer Seite, die aus genau einer Sache besteht, trennt sie nichts. Die bestehenden Karten
der Erbe-Seite bleiben, wie sie sind; dort stehen tatsächlich mehrere Gegenstände
nebeneinander.

---

## 4. Zwei Ansichten

Ein Renderer, der auf `modus` verzweigt, keine getrennten Screen-Bäume. §7 begründet das
für `Erbe` und `Profil` bereits: Dort liegen die unumkehrbaren Abläufe, und zwei
Fassungen desselben Rechtstextes, die auseinanderlaufen, wären ein Risiko ohne Gegenwert.
Beim Fragebaum wiegt das schwerer als dort, weil es hier 80 Ergebnistexte sind.

In der einfachen Ansicht bekommen die langen Ergebnisse einen Vorspann und den Rest hinter
"Mehr anzeigen" — **dieselben Worte, weniger Wand**. Umformuliert wird nichts. §8 sagt
"Erfunden wird nichts", und eine in eigene Worte gefasste Ausschlagungsfrist ist genau
das, wovor der Satz warnt.

Eine sprachlich vereinfachte Fassung der Fragen ist vorgesehen, wird aber von den
Juristinnen geschrieben und nicht hier.

---

## 5. Infoknoten

Knoten mit `info` tragen im Kopf einen `ℹ`-Knopf, der eine Erläuterung an Ort und Stelle
aufklappt. Kein Dialog, keine eigene Adresse: Ein Dialog käme in dieser App sonst
nirgends vor, und eine eigene Adresse machte aus dem Zurück-Knopf, der zur vorigen Frage
führen soll, einen, der die Erläuterung schließt.

**Die Erläuterungen fehlen noch.** Der Export nennt an diesen dreizehn Stellen nur das
Thema — "Infos zu Erbschein", "Infobutton mit was ist Nachlassgericht" —, nicht den Text.
Es gibt also zwei Themen und keinen Inhalt dazu. Der Knopf steht trotzdem da und sagt,
dass die Erläuterung noch von den Juristinnen ergänzt wird; ein plausibel klingender
Absatz über den Erbschein wäre hier das Schlimmste von allem, weil er aussähe wie geprüft
(§8: "Erfunden wird nichts").

---

## 6. Ergebnis und Erbstatus

### Was gespeichert wird

Am Ergebnis — und nur dort — wird ein Datensatz in das private Konfigurations-Item unter
`K_p` geschrieben (§3.7): der gegangene Pfad, das erreichte Ergebnis, der abgeleitete
Erbstatus und der Zeitpunkt.

Dasselbe Item trägt bereits das eigene `kenntnisAm` (§8). Es ist der Ort, den diese App
für "eine Auskunft über mich, die meine Geschwister nichts angeht" schon hat: pro Person,
pro Fall, an die eigenen Geräte gewrappt, für alle anderen eine Zeile, die ihr Client
still verwirft.

### Der Erbstatus

| Ergebnis | Status |
| --- | --- |
| Sie sind Erbe. | **Erbe** |
| Sie könnten nach der gesetzlichen Erbfolge Erbe sein. | **Wahrscheinlich Erbe** |
| Sie sind wahrscheinlich kein Erbe. | **Wahrscheinlich kein Erbe** |
| Sie sind kein Erbe. | **Kein Erbe** |
| Sie wollen das Erbe nicht (Ausschlagung) | **Noch Erbe** |
| Informationen zur Testamentsanfechtung | **Kein Erbe** |
| Nach den Angaben lässt sich noch nicht sicher sagen … | kein Status |
| Übrige (reine Auskünfte) | kein Status |

"Noch Erbe" bei der Ausschlagung ist keine Ungenauigkeit: Wer ausschlagen will, ist es bis
zur wirksamen Ausschlagung noch, und genau deshalb läuft ihm eine Frist.

Der Status erscheint als eine Zeile in **Profil**, und nur die Person selbst sieht ihn.

### Der erste Durchlauf gilt

Spätere Durchläufe überschreiben **nicht**. Sie zeigen ihr Ergebnis, und wenn es ein
anderes ist als das gespeicherte, steht auf der Ergebnisseite, was bleibt:

> Ihr gespeichertes Ergebnis bleibt: *Erbe*.

Daneben steht ein Knopf **"Gespeichertes Ergebnis ersetzen"**. Er ersetzt den ganzen
Datensatz, nicht nur den Status.

Führt der zweite Weg zu demselben Ergebnis, steht davon nichts da: Eine Warnung vor einem
Widerspruch, den es nicht gibt, ist eine Warnung zu viel.

Warum beides: Wer den Baum ein zweites Mal geht, tut das meist, weil er die erste Antwort
für falsch hält. Ein zweites Ergebnis still zu verwerfen wäre eine App, die es besser
weiß. Es automatisch zu übernehmen wäre eine App, in der ein neugieriges Durchklicken den
eigenen Rechtsstand umschreibt. Der Knopf sagt beides laut.

---

## 7. Aufgaben aus dem Baum

Drei Ergebnisse tragen einen Knopf **"Aufgabe erstellen"**:

| Ergebnis | Aufgabe | Frist |
| --- | --- | --- |
| Testament abgeben | Testament beim Nachlassgericht abliefern | keine Tagesfrist (unverzüglich, § 2259 BGB) |
| Ausschlagung | Erbe ausschlagen | 42 Tage ab **Kenntnis** (§ 1944 BGB) |
| Testamentsanfechtung | Testament anfechten | 1 Jahr ab Kenntnis des Anfechtungsgrundes |

**Alle drei sind privat** (`K_p`) und **auf die anlegende Person zugewiesen**.

Privat auch das Testament, obwohl mehrere Angehörige je eines besitzen können und jede:r
seines abliefern soll: Es ist eine Handlung, die man für sich tut und die einen
strafrechtlich betrifft, wenn man sie unterlässt. Zwei Folgen, die dazugehören und nicht
übersehen werden sollen:

- Die Familie sieht nicht, dass ein Testament abgeliefert wurde.
- Keine geteilte Aufgabe darf von einer der drei abhängen (§3.7). Umgekehrt ist erlaubt.

**Höchstens eine je Person und Art.** Ein zweiter Druck auf den Knopf legt nichts Neues
an, sondern führt zur vorhandenen Aufgabe ("Aufgabe öffnen"). Erkannt wird sie an ihrer
Herkunft aus dem Baum, nicht am Titel: Eine umbenannte Aufgabe soll keine zweite
erzeugen. Für die beiden ohnehin privaten Arten fällt das zusammen; man sieht nur seine
eigenen.

**Die Aufgaben tragen ihre Fristangaben selbst** — `fristTage`, `fristAb`, zuständige
Stelle — im selben `katalog`-Feld, das §8 dafür vorsieht. Paragraph und Quelllink tragen
sie seit ADR-0003 nicht mehr. Ohne das rechnete die Ausschlagungsfrist nicht, und die Ausschlagungsfrist ist
die eine Frist in dieser App, deren Versäumnis den ganzen Nachlass kostet.

Das Feld "Wann hat das Nachlassgericht Sie über die Erbschaft informiert?" schreibt in das
bestehende `kenntnisAm` (§8). Es ist dasselbe Datum, dieselbe Ablage, und wer es hier
einträgt, sieht die Frist unmittelbar an der Aufgabe stehen.

---

## 8. Zuständige Stelle ermitteln

Drei Seiten brauchen das zuständige Nachlassgericht. Sie zeigen eine aufklappbare Karte
**"Zuständige Stelle ermitteln"** mit der Frage nach dem letzten Wohnort und einem
Eingabefeld für die Postleitzahl.

**Die Suche ist noch keine.** Sie antwortet immer "Nachlassgericht München", und das steht
sichtbar dabei. Ein Gerichtsname, der für jemanden in Hamburg schlicht falsch ist und
unkommentiert dasteht, ist etwas, wonach jemand handelt.

Eingegebene Postleitzahl und Antwort wandern in die Notizen der erzeugten Aufgabe, damit
die Eingabe nicht verloren ist, wenn die echte Suche nachkommt. Die echte Suche ist ein
eigener Vorgang und als Issue #22 erfasst.

---

## 9. Was aus dem Rechtskatalog wird

Der Katalog aus §8 hatte zehn Einträge. Ihr Inhalt gilt als überwiegend unzuverlässig und
wird zurückgezogen (ADR-0001). **Aufgaben entstehen künftig durch Menschen oder durch
diesen Baum, nicht durch eine Liste.**

Was bleibt, ist die Mechanik: der Importweg, `K_cat`, die deterministischen Ids aus
`UUIDv5(HMAC)`, `cases.catalog_version` und das `katalog`-Feld an der Aufgabe. Sie trägt
weiterhin zwei Dinge, die der Baum braucht — die Rechtsangaben an den erzeugten Aufgaben
(§7 oben) und ein Anlegen, das auch dann genau einmal geschieht, wenn zwei Geräte
gleichzeitig synchronisieren.

Der Katalog enthält deshalb noch **genau einen** Eintrag:

> **Klären, ob Sie Erbe sind**

Er wird wie bisher beim Übergang in den Trauerfall instanziiert, ist geteilt, und die
Aufgabendetails erkennen ihn an seiner `aufgabeId` und zeigen den Knopf "Fragebaum
starten".

**Sein "erledigt" wird abgeleitet, nicht gespeichert** — aus dem eigenen, privaten
Fragebaum-Ergebnis. Sonst hakte Anna ihn ab und Bert, der den Baum nie gegangen ist, sähe
seine Aufgabe erledigt. §7 leitet `erledigt` bereits bei Aufgaben mit Unteraufgaben ab,
und §8 zeigt an den Fristen, dass dieselbe geteilte Aufgabe jedem Mitglied etwas anderes
zeigen darf, solange das Unterschiedliche privat liegt und nichts synchronisiert wird.

`depends_on` verschwindet mit den Zeilen; es gab nur Verweise zwischen entfernten
Einträgen.

**Bestehende Trauerfälle behalten ihre zehn Aufgaben.** Der Katalog hat sie initialisiert,
mehr nicht (§8), und die Items sind Ende-zu-Ende-verschlüsselt: Es gibt keine Migration,
die sie erreichen könnte, und es soll auch keine geben.

---

## 10. Die Erbe-Seite

Im Trauerfall, von oben nach unten:

1. Kopf mit Person und Fallstand
2. **Erbstatus** — entweder "Noch nicht ermittelt" mit "Fragebaum starten", oder das
   gespeicherte Ergebnis mit dem Datum
3. die bestehenden Karten
4. ganz unten: **"Fragebaum erneut durchlaufen"**

Im Vorsorgefall bleibt die Seite unverändert.

---

## 11. Tests

- **Baumdaten**: jeder Knoten erreichbar, jede Antwort löst auf einen vorhandenen Knoten
  auf, kein Knoten ohne Antworten außer Ergebnissen, jedes Ergebnis auf genau einen
  Status oder auf keinen abgebildet.
- **Konfigurations-Item**: Schreiben am Ergebnis, `kenntnisAm` bleibt unberührt, zweiter
  Durchlauf überschreibt nicht, "Ersetzen" überschreibt.
- **Aufgaben**: privat, zugewiesen, Rechtsangaben gesetzt, zweiter Druck legt nichts an.
- **Seed-Aufgabe**: abgeleitetes "erledigt" folgt dem eigenen Ergebnis und nicht dem
  fremden.
- **Playwright**: ein Weg vom Start bis zu einem Ergebnis, mit dem Zurück-Knopf des
  Browsers und einem Direktaufruf ohne Pfad dazwischen, dazu die erzeugte
  Ausschlagungs-Aufgabe mit ihrer Frist.

  Als Schritte in `tests/e2e/fall-lebenszyklus.spec.ts` und nicht als eigene Datei: Jedes
  Browser-Projekt hat genau eine Testperson (`tests/e2e/nutzer.ts`), und ein zweiter Test
  sähe den Fall des ersten — gesperrt, weil sein Gerät für keinen Wrap dieses Falls einen
  Schlüssel hält.
