# Handoff: Erbe-Fragebaum fertigstellen

**Branch:** `erbe-fragebaum` · **Stand:** `badc4ce` · **Datum:** 2026-08-25

Der Fragebaum ist gebaut und funktioniert in der Oberfläche. Was fehlt, ist genau eine
Sache, und es ist die wichtigste: **Das Ergebnis wird meistens nicht gespeichert.** Diese
Datei sagt, was geprüft ist, was der Fehler ist und wo er sitzt.

Wenn die Arbeit erledigt ist, gehört diese Datei gelöscht.

---

## 1. Wo der Branch steht

| Prüfung | Ergebnis |
| --- | --- |
| `npm run typecheck` | sauber |
| `npm run lint` | sauber (siehe §5, Stolperstein 1) |
| `npm test` | **1397 bestanden, 120 Dateien** |
| `npm run test:e2e` | **4 gescheitert, 6 bestanden** — siehe §2 |

`origin/main` ist bereits eingemergt (`badc4ce`, konfliktfrei). Das war nötig und hat
geholfen: Vor dem Merge war `personal_key_wraps` nach einem vollen Durchlauf **leer**,
weil `049bc67 fix: gleichzeitige Geraeteregistrierungen buendeln (#21)` fehlte. Danach
werden private Items grundsätzlich geschrieben. Der in §2 beschriebene Fehler ist ein
anderer und besteht weiter.

Nach dem Merge gilt Node `>=22.0.0 <26.0.0`; `npm ci` ist gelaufen.

---

## 2. Der Fehler: das Ergebnis geht still verloren

**Symptom.** `tests/e2e/fall-lebenszyklus.spec.ts:304`. Nach einem vollständigen Durchlauf
steht auf `/erbe` nicht das Ergebnis, sondern weiterhin die Einladung „Fragebaum starten".
Keine Fehlermeldung. In vier Läufen ist das jedes Mal passiert; von fünf vollständigen
Durchläufen wurde genau einer gespeichert.

**Kein Umgebungsproblem.** Der Test scheitert auch isoliert, mit einem einzigen Projekt
und ohne parallele Last:

```bash
npx supabase db reset && node --env-file=.env.test node_modules/@playwright/test/cli.js test --project=mobile-webkit tests/e2e/fall-lebenszyklus.spec.ts
```

**Beweis aus dem Trace.** Im Playwright-Trace des isolierten Laufs stehen **neun GETs auf
`rest/v1/personal_key_wraps` und kein einziger POST**. Die Tabelle ist danach leer. Die App
hat also nie versucht, den persönlichen Schlüssel anzulegen — der Schreibweg bricht ab,
bevor irgendein Netzaufruf passiert.

**Die Ursache.** Der Riegel, der das Schreiben freigibt, und der Riegel, der das Schreiben
verbietet, fragen nicht dasselbe ab.

- [`src/hooks/useAufgaben.ts:647`](src/hooks/useAufgaben.ts) —
  `fragebaumGeladen = sync.gecacht && privatGeprueft`. `privatGeprueft`
  ([Zeile 348](src/hooks/useAufgaben.ts), gesetzt in
  [Zeile 382](src/hooks/useAufgaben.ts)) wartet auf `identitaet` und `geraeteId` aus
  `useGeraeteanmeldung`.
- [`src/hooks/useAufgaben.ts:575`](src/hooks/useAufgaben.ts) — `holePersoenlichenSchluessel`
  wirft aber zusätzlich, wenn `ich.userId === ''`. Und `ich` kommt aus `useAuth()`, einer
  **anderen** Quelle, die noch leer sein kann, wenn die Geräteanmeldung längst durch ist:

  ```ts
  if (identitaet === null || geraeteId === null || ich.userId === '') {
    throw new AufgabenFehler('Ohne angemeldetes Gerät geht das nicht.')
  }
  ```

  Dieser Wurf passiert **vor** jedem Netzaufruf — daher der fehlende POST. Dieselbe
  Meldung ist im vollen E2E-Lauf auch sichtbar als Alert aufgetaucht.

**Warum der Wiederholungsversuch nicht greift.** Der `catch` in
[`src/screens/shared/Fragebaum/Fragebaum.tsx`](src/screens/shared/Fragebaum/Fragebaum.tsx)
setzt `geschrieben.current = false` zurück, damit der nächste Lauf es erneut versucht. Nur
läuft der Effekt nie wieder: Seine Abhängigkeiten sind
[`[entschieden, pfad, speichereFragebaum]`](src/screens/shared/Fragebaum/Fragebaum.tsx:322),
und im Moment des Fehlschlags ändert sich keine davon. `speichereFragebaum` wechselt seine
Identität erst, wenn `ich.userId` eintrifft — und bis dahin hat die Person längst „Zurück
zur Übersicht" geklickt und die Komponente ist ausgehängt. Das Ergebnis ist weg, ohne dass
irgendwo etwas steht.

Der vorige Durchgang hat diesen Fehler als behoben gemeldet. Das Zeitfenster ist kleiner
geworden, geschlossen ist es nicht.

**Vorschlag.** Zwei Teile, beide klein:

1. Den Freigabe-Riegel dasselbe abfragen lassen wie den Verbots-Riegel — `ich.userId` mit
   in `fragebaumGeladen` aufnehmen (oder `holePersoenlichenSchluessel` auf die Anmeldung
   warten lassen, statt zu werfen).
2. Den Wiederholungsversuch von der Abhängigkeitsidentität lösen. Solange ein Ergebnis
   nicht abgelegt ist, muss es abgelegt *werden*, und nicht darauf angewiesen sein, dass
   zufällig eine `useCallback`-Identität wechselt, während die Seite noch offen ist.

Beim Prüfen: `personal_key_wraps` muss nach einem Durchlauf Zeilen haben, und unter
`items` muss ein Eintrag mit einem persönlichen `kid` stehen (kein `case_…`-Präfix):

```bash
docker exec supabase_db_LoveNeverDies psql -U postgres -d postgres -c "select count(*) from personal_key_wraps;" -c "select case_id, split_part(kid,':',1) as kid_art, count(*) from items where not deleted group by 1,2;"
```

---

## 3. Zwei Tests, die nichts prüfen

**Der Doppelschreib-Test ist wirkungslos.**
[`tests/screens/Fragebaum.test.tsx:262`](tests/screens/Fragebaum.test.tsx)
(„schreibt genau einmal, auch wenn währenddessen neu gerendert wird") besteht auch dann,
wenn man den Riegel `geschrieben` ([Zeile 254](src/screens/shared/Fragebaum/Fragebaum.tsx))
**vollständig entfernt** — nachgemessen, alle 28 Tests grün. Grund: Der gemockte
`useAufgaben` gibt bei jedem Rendern *dieselbe* `speichereFragebaum`-Funktion zurück. Damit
ändert sich keine Abhängigkeit, der Effekt läuft ohnehin nur einmal, und der Fall, den der
Test beschreibt, tritt nie ein. Der Mock müsste je Rendern eine neue Identität liefern —
genau das tut der echte Hook, sobald geschrieben wurde.

**Für den Wiederholungsversuch gibt es gar keinen Test.** Kein Test lässt
`speichereFragebaum` scheitern. `geschrieben.current = false` im `catch` ist ungedeckt.

Was dagegen **wirklich gedeckt ist**: der `fragebaumGeladen`-Riegel. Entfernt man ihn,
scheitern zwei Tests. Der Teil ist in Ordnung.

---

## 4. Kleinere Funde

**`fragebaumGeladen` wird nur an einer Stelle benutzt** —
[`Fragebaum.tsx:269`](src/screens/shared/Fragebaum/Fragebaum.tsx). Dagegen lesen
[`Erbe.tsx:536`](src/screens/shared/Erbe/Erbe.tsx) und
[`Profil.tsx:76`](src/screens/shared/Profil/Profil.tsx) `fragebaum` roh. Solange `K_p`
unterwegs ist, zeigen beide den „noch nicht durchlaufen"-Zweig: Profil blendet die Zeile
aus, Erbe lädt aktiv zum Neubeginn ein, obwohl ein Ergebnis gespeichert ist. Kein
Datenverlust, aber genau die Verwechslung, vor der die Kommentare im Branch selbst warnen.
`Erbstatus` wartet nur auf `zustand.status !== 'laedt'`, also auf `sync.gecacht`, nicht auf
`privatGeprueft`.

**Die dreizehn ℹ-Knoten tragen Platzhaltertext.** Unverändert aus dem vorigen Durchgang:
Der Export der Juristinnen nennt an diesen Stellen nur das Thema, nicht die Erläuterung.
Siehe `infoText` in [`src/services/fragebaumService.ts`](src/services/fragebaumService.ts).
Hier wird nichts erfunden — der Text muss von den Juristinnen kommen.

---

## 5. Stolpersteine in dieser Umgebung

1. **`npm run lint` meldet 515 Fehler, die keine sind.** Alle lauten
   `Parsing error: No tsconfigRootDir was set`. Ursache ist ein fremder Worktree unter
   `.claude/worktrees/frontend-design-guidance-7810a9`, der im Repo liegt und tseslint zwei
   Wurzelkandidaten zeigt. In einem sauberen Checkout desselben Commits läuft ESLint mit
   Exit 0 durch. Nicht am Branch herumreparieren.

2. **Zwei E2E-Tests können hier nicht laufen.** `kopplung.spec.ts` braucht
   `E2E_CLERK_USER_EMAIL_KOPPLUNG_A` und `…_C`; beide fehlen in `.env.test` (kein einziger
   `KOPPLUNG`-Eintrag). Das ist unabhängig von diesem Branch und war vorher schon so. Siehe
   `tests/e2e/README.md`.

3. **Port 4173 vor jedem E2E-Lauf prüfen.** `reuseExistingServer` greift stillschweigend
   einen fremden Preview-Server ab, und dann testet man den Build eines anderen Worktrees:

   ```bash
   lsof -nP -iTCP:4173 -sTCP:LISTEN
   ```

4. **Die Lebenszyklus-Tests sind über Wiederholungen nicht idempotent.** `supabase db reset`
   läuft einmal je Lauf, nicht je Versuch. Ein `retry #1` trifft deshalb auf die Daten des
   ersten Versuchs und scheitert dann an anderer Stelle („Dieser Fall ist auf diesem Gerät
   gesperrt"). **Nur der erste Versuch ist aussagekräftig.**

5. **Kaltstart-Rennen bei der Geräteanmeldung.** Im ersten Test eines Laufs erscheint
   gelegentlich „Ohne angemeldetes Gerät lässt sich kein Fall anlegen." Das ist echtes
   Flackern und nicht der Fehler aus §2 — dieser tritt auch dann auf, wenn die
   Geräteanmeldung sauber durchgelaufen ist.

6. **Clerk drosselt.** Nach etwa zehn Läufen in einer Stunde scheitert die Anmelde-Vorstufe.
   Dann eine Pause einlegen; das ist kein Fehler der App.

---

## 6. Fertig ist es, wenn

- [ ] `fall-lebenszyklus.spec.ts:304` besteht im **ersten** Versuch, auf beiden Projekten.
- [ ] `personal_key_wraps` trägt nach einem Durchlauf Zeilen, und unter `items` steht ein
      Eintrag mit persönlichem `kid`.
- [ ] Ein fehlgeschlagenes Speichern wird wiederholt und nicht still verworfen.
- [ ] Der Doppelschreib-Test scheitert, wenn man den Riegel entfernt (§3).
- [ ] Ein Test deckt den Wiederholungsversuch nach einem Fehlschlag ab.
- [ ] `Erbe` und `Profil` warten auf `fragebaumGeladen` (§4).
- [ ] `npm run typecheck`, `npm test` und `npm run test:e2e` sind grün — abzüglich der
      beiden `kopplung`-Tests aus §5.
- [ ] Diese Datei ist gelöscht.
