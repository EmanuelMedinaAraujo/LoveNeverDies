import { expect, test, type Page } from '@playwright/test'
import { gotoVerlaesslich, zeilen } from './helpers.ts'

/**
 * Wartet darauf, dass eine Änderung den Server erreicht hat (DESIGN.md §5).
 *
 * Seit dem Delta-Sync ist "sichtbar" nicht mehr dasselbe wie "gespeichert":
 * Jede Mutation wird sofort angezeigt und geht über die Offline-Queue hinaus.
 * Das ist der Sinn der Queue. Wer unmittelbar danach neu lädt, muss also
 * abwarten, sonst prüft er den Server auf etwas, das noch unterwegs ist.
 *
 * Gewartet wird auf den Schreibvorgang selbst und nicht auf eine feste Zeit:
 * Eine Sekundenzahl wäre auf einer langsamen Maschine zu kurz und auf jeder
 * anderen verschenkte Zeit.
 */
function gespeichert(page: Page, methode: 'POST' | 'PATCH'): Promise<unknown> {
  return page.waitForResponse(
    (antwort) =>
      antwort.url().includes('/rest/v1/items') &&
      antwort.request().method() === methode &&
      antwort.ok(),
  )
}

/**
 * Den ganzen Weg aus DESIGN.md §7 einmal durch: ohne Fall → Trauerfall anlegen
 * → der angelegte Fall erscheint überall, wo er auftauchen soll.
 *
 * Ein einziger Test, nicht mehrere. Jeder Playwright-`test()` bekommt einen
 * frischen Browserkontext und damit eine leere IndexedDB. Die Geräte-
 * identität liegt in IndexedDB (keystore.ts), nicht im von `auth.setup.ts`
 * gesicherten `storageState` (das deckt nur Cookies und localStorage ab). Zwei
 * separate Tests wären zwei verschiedene Geräte: Das zweite bekäme den Fall
 * zwar über die Mitgliedschaft zu sehen, aber gesperrt: Sein Schlüssel liegt
 * für keinen Wrap dieses Falls vor (`Für dieses Gerät liegt noch kein
 * Schlüssel zu diesem Fall vor`). `test.step` haelt dagegen alles im selben
 * Kontext, also demselben Geraet, so wie eine reale Sitzung es auch waere.
 */
test('Trauerfall anlegen', async ({ page }) => {
  /*
   * Mehr als die üblichen 30 Sekunden, weil dieser eine Test absichtlich der
   * ganze Lebenszyklus ist (siehe oben) und mit jedem Slice länger wird: Er
   * erzeugt einmal die Geräteschlüssel, legt einen Fall an und navigiert danach
   * ein gutes Dutzend Mal wirklich neu. Auf einem langsameren Browser reicht
   * die Voreinstellung dafür nicht. Die Zusagen je Schritt hängen weiterhin an
   * `expect.timeout` aus der Konfiguration; hier steht nur die Summe.
   *
   * Bemessen nach WebKit auf dem Handy-Viewport, dem langsamsten der drei
   * Projekte: Dort lief der Test zuletzt genau in die 120 Sekunden, und zwar
   * im letzten Schritt an einem frischen Seitenaufbau — die Schlüsselerzeugung
   * war noch bei "Einen Moment bitte…". Der Puffer ist Absicht: Sechs Worker
   * teilen sich eine Maschine, und ein knapp bemessenes Limit macht aus dem
   * Test einen Zufallsgenerator.
   */
  test.setTimeout(240_000)

  await test.step('ohne Fall steht die Fallweiche aus §7', async () => {
    await gotoVerlaesslich(page, '/')

    // Nicht mehr die Anmeldung: der gespeicherte Sitzungszustand aus
    // auth.setup.ts hat bereits gegriffen.
    await expect(page.getByRole('heading', { name: 'Willkommen' })).toBeVisible()

    await expect(
      page.getByRole('button', { name: 'Ein Todesfall ist eingetreten' }),
    ).toBeEnabled()
    // Seit Slice #14 offen: Der Weg führt auf /vorsorge und die Vorsorgeanlage (§2, §3.5).
    await expect(
      page.getByRole('button', { name: 'Ich möchte für später vorsorgen' }),
    ).toBeEnabled()
    // Seit §6 offen: Der Weg fuehrt auf /beitreten und den Kopplungscode.
    await expect(page.getByRole('button', { name: 'Ich wurde eingeladen' })).toBeEnabled()
  })

  await test.step('Profil ist über die untere Leiste erreichbar (§7)', async () => {
    await page.getByRole('navigation', { name: 'Hauptbereiche' }).getByRole('link', { name: 'Profil' }).click()

    await expect(page).toHaveURL(/\/profil$/)
    await expect(page.getByRole('heading', { name: 'Profil' })).toBeVisible()

    /*
     * Warten, bis dieses Gerät in der Liste steht, und zwar nicht nur der
     * Vollständigkeit halber: Die Geräteanmeldung läuft still im Hintergrund
     * (§7) und braucht erst die Schlüsselerzeugung, dann einen Rundlauf zum
     * Server. Die Fallanlage im nächsten Schritt setzt sie voraus und scheitert
     * sonst mit "Ohne angemeldetes Gerät lässt sich kein Fall anlegen".
     *
     * Der Screen sagt an dieser einen Stelle, dass die Anmeldung durch ist;
     * das Formular unter /todesfall sagt es nirgends.
     */
    await expect(zeilen(page).filter({ hasText: 'Dieses Gerät · Prüfcode' })).toBeVisible()

    await page.getByRole('navigation', { name: 'Hauptbereiche' }).getByRole('link', { name: 'Start' }).click()
    await expect(page).toHaveURL(/\/$/)
  })

  await test.step('legt einen Vorsorgefall an und prüft den versiegelten Tresor (§2, §3.5)', async () => {
    await page.getByRole('button', { name: 'Ich möchte für später vorsorgen' }).click()
    await expect(page).toHaveURL(/\/vorsorge$/)
    await expect(page.getByRole('heading', { name: 'Für später vorsorgen' })).toBeVisible()

    await page.getByLabel('Ihr Name').fill('Erika Mustermann')
    await page.getByRole('button', { name: 'Vorsorge anlegen' }).click()

    await expect(page).toHaveURL(/\/erbe$/, { timeout: 15_000 })
    await expect(page.getByRole('heading', { name: 'Erbe & Tresor' })).toBeVisible()
    await expect(page.getByText('Erika Mustermann · Vorsorge')).toBeVisible()
    await expect(page.getByText('Versiegelt', { exact: true })).toBeVisible()
    await expect(
      page.getByText(/Der Tresor ist versiegelt, kann aber noch von niemandem geöffnet werden/),
    ).toBeVisible()
  })

  await test.step('befüllt den Tresor und löscht den Eintrag wieder (§3.5)', async () => {
    await page.getByRole('button', { name: 'Inhalt in Tresor legen' }).click()

    await page.getByLabel('Titel').fill('Bankschließfach')
    await page.getByLabel('Inhalt / Notiz').fill('Schlüssel im Arbeitszimmer')
    
    const angelegt = gespeichert(page, 'POST')
    await page.getByRole('button', { name: 'Im Tresor speichern' }).click()
    await angelegt

    await expect(page.getByText('Bankschließfach')).toBeVisible()
    await expect(page.getByText('Schlüssel im Arbeitszimmer')).toBeVisible()

    const geloescht = gespeichert(page, 'PATCH')
    await page.getByRole('button', { name: '"Bankschließfach" löschen' }).click()
    await geloescht

    await expect(page.getByText('Der Tresor ist noch leer.')).toBeVisible()
  })

  await test.step('löscht den Vorsorgefall samt Tresor (§3.5)', async () => {
    await page.getByRole('button', { name: 'Vorsorge löschen' }).click()
    await expect(
      page.getByText(/Möchten Sie diesen Vorsorgefall samt Tresor wirklich unwiderruflich löschen/),
    ).toBeVisible()

    await page.getByRole('button', { name: 'Ja, Vorsorge löschen' }).click()
    await expect(page).toHaveURL(/\/$/)

    // Wieder im Zustand ohne Fall
    await expect(page.getByRole('heading', { name: 'Willkommen' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Ein Todesfall ist eingetreten' })).toBeEnabled()
  })

  await test.step('legt einen Trauerfall an', async () => {
    await page.getByRole('button', { name: 'Ein Todesfall ist eingetreten' }).click()

    await expect(page).toHaveURL(/\/todesfall$/)

    await page.getByLabel('Name der verstorbenen Person').fill('Hans Weber')
    await page.getByLabel('Sterbedatum').fill('2024-03-15')
    await page.getByRole('button', { name: 'Fall anlegen' }).click()

    await expect(page).toHaveURL(/\/$/)

    // §7: Start heisst "Meine Aufgaben"; um wessen Fall es geht, steht darunter.
    await expect(page.getByRole('heading', { name: 'Meine Aufgaben' })).toBeVisible()
    await expect(page.getByText('Hans Weber · Trauerfall seit 15. März 2024')).toBeVisible()
  })

  await test.step('ein zweiter Besuch von /todesfall legt keinen zweiten Fall an', async () => {
    // Todesfall.tsx: "Wer schon einen Fall hat, legt hier keinen zweiten an."
    await page.goto('/todesfall')
    await expect(page).toHaveURL(/\/$/)
    await expect(page.getByRole('heading', { name: 'Meine Aufgaben' })).toBeVisible()
    await expect(page.getByText('Hans Weber · Trauerfall seit 15. März 2024')).toBeVisible()
  })

  await test.step('Start ist leer, solange nichts zugewiesen ist (§7)', async () => {
    /*
     * Die eine Aufgabe, die der Katalog noch mitbringt (ADR-0001), kommt
     * unzugewiesen in den Fall: Wer sie übernimmt, entscheidet die Familie.
     * Start zeigt deshalb nichts und sagt, wo man eine findet.
     */
    await expect(page.getByText(/Ihnen ist gerade nichts zugewiesen/)).toBeVisible()
  })

  /**
   * Wie viele Zeilen der Fall von selbst mitbringt (§8, ADR-0001).
   *
   * Gezählt statt aus dem Katalog importiert: Die Zahl ändert sich mit jedem
   * `npm run import:content`, und dieser Test soll davon nichts wissen.
   */
  let katalogZeilen = 0

  await test.step('der neue Fall bringt die Aufgabe zum Fragebaum mit (ADR-0001)', async () => {
    /*
     * Seit ADR-0001 steht im Katalog genau ein Eintrag. Er führt in den
     * Erbe-Fragebaum, und alle weiteren Aufgaben entstehen dort oder von Hand.
     */
    await page.getByRole('navigation', { name: 'Hauptbereiche' }).getByRole('link', { name: 'Alle' }).click()

    await expect(page).toHaveURL(/\/alle$/)
    await expect(page.getByRole('heading', { name: 'Alle Aufgaben' })).toBeVisible()

    // `exact`, weil derselbe Titel im Vorlesetext der Zeilenaktionen steht (§7).
    await expect(page.getByText('Klären ob Sie Erbe sind', { exact: true })).toBeVisible()

    katalogZeilen = await zeilen(page).count()
    expect(katalogZeilen).toBe(1)

    // Und beim Neuladen steht dieselbe Liste: kein zweiter Satz, keine
    // Duplikate. Die IDs sind deterministisch, das Anlegen ist idempotent (§8).
    await gotoVerlaesslich(page, '/alle')
    await expect(zeilen(page)).toHaveCount(katalogZeilen)
  })

  await test.step('die Katalogaufgabe führt in den Fragebaum (ERBE_DESIGN.md §9)', async () => {
    await page.getByRole('link', { name: /^Details.*Klären ob Sie Erbe sind/ }).click()

    await expect(page.getByRole('heading', { name: 'Klären ob Sie Erbe sind' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Fragebaum starten' })).toBeVisible()

    /*
     * Sie hat kein eigenes Häkchen (ERBE_DESIGN.md §9): Sie ist geteilt, ihr
     * Ergebnis liegt privat, und ein gespeichertes Häkchen hakte sie für alle
     * ab. Der Stand kommt aus dem eigenen Ergebnis und steht als Satz da.
     */
    await expect(page.getByRole('checkbox', { name: 'Diese Aufgabe ist erledigt' })).toHaveCount(0)
    await expect(page.getByText(/Offen, solange Sie den Fragebaum nicht durchlaufen haben/)).toBeVisible()
  })

  /*
   * Der Erbe-Fragebaum (ERBE_DESIGN.md §3, §6, §10).
   *
   * Hier und nicht in einer eigenen Datei: Jedes Browser-Projekt hat genau eine
   * Testperson (tests/e2e/nutzer.ts), und ein zweiter Test sähe den Fall dieses
   * hier — gesperrt, weil sein Gerät für keinen Wrap dieses Falls einen
   * Schlüssel hält. Dieselbe Überlegung, aus der dieser Test überhaupt aus
   * `test.step` besteht.
   *
   * Geprüft wird das, was nur im echten Browser zu prüfen ist: dass der
   * Zurück-Knopf zur vorigen Frage führt und ein Neuladen den Durchlauf von
   * vorn beginnen lässt. Beides hängt an der History und nicht am Zustand einer
   * Komponente.
   */
  await test.step('Erbe lädt in den Fragebaum ein, solange kein Ergebnis vorliegt (§10)', async () => {
    // Der vorige Schritt endet im ganzseitigen Aufgabendetail (§7), und das
    // trägt keine untere Leiste.
    await gotoVerlaesslich(page, '/erbe')

    await expect(page).toHaveURL(/\/erbe$/)
    await expect(page.getByRole('heading', { name: 'Ihr Erbstatus' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Fragebaum starten' })).toBeVisible()
  })

  await test.step('jede Frage ist eine eigene Seite (§3)', async () => {
    await page.getByRole('button', { name: 'Fragebaum starten' }).click()

    await expect(page).toHaveURL(/\/erbe\/fragebaum\/\w+$/)
    await expect(page.getByRole('heading', { name: 'Sind Sie Erbe?' })).toBeVisible()

    await page.getByRole('button', { name: 'Ja', exact: true }).click()

    await expect(page.getByRole('heading', { name: 'Haben Sie ein Testament gefunden?' })).toBeVisible()
  })

  await test.step('der Zurück-Knopf des Browsers führt zur vorigen Frage (§3)', async () => {
    // Auf einem Telefon der Knopf, den Menschen tatsächlich benutzen. Deshalb
    // steht der Pfad in der History und nicht im Zustand einer Komponente.
    await page.goBack()

    await expect(page.getByRole('heading', { name: 'Sind Sie Erbe?' })).toBeVisible()

    await page.goForward()

    await expect(page.getByRole('heading', { name: 'Haben Sie ein Testament gefunden?' })).toBeVisible()
  })

  await test.step('ein neuer Aufruf derselben Frage beginnt von vorn (§3)', async () => {
    /*
     * Ein geteilter Link, ein Lesezeichen, die wieder geöffnete App: Ohne Pfad
     * im `state` gibt es keinen Durchlauf, zu dem die Seite gehört, und ein
     * halb gegangener Pfad ist keine Tatsache über das Erbe von irgendwem.
     *
     * Ein `page.reload()` täte das ausdrücklich *nicht*, und ein `goto` auf
     * dieselbe Adresse auch nicht: Beides stellt denselben History-Eintrag
     * samt `state` wieder her. Das ist Verhalten des Browsers und keine Ablage
     * der App — mit dem Tab ist der Pfad weg. Deshalb erst weg und dann hin,
     * so wie jemand, der den Link von woanders aufruft.
     */
    const frage = new URL(page.url()).pathname

    await gotoVerlaesslich(page, '/')
    await gotoVerlaesslich(page, frage)

    await expect(page.getByRole('heading', { name: 'Sind Sie Erbe?' })).toBeVisible()
  })

  await test.step('ein Ergebnis wird gespeichert und erscheint in Erbe (§6, §10)', async () => {
    await page.getByRole('button', { name: 'Nein', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Gibt es ein Testament?' })).toBeVisible()

    await page.getByRole('button', { name: 'Nein', exact: true }).click()

    await expect(page.getByText('Sie sind kein Erbe.')).toBeVisible()

    await page.getByRole('button', { name: 'Zurück zur Übersicht' }).click()

    await expect(page).toHaveURL(/\/erbe$/)
    await expect(page.getByText('Sie sind kein Erbe.')).toBeVisible()
    await expect(page.getByText(/Nur für Sie sichtbar/)).toBeVisible()
  })

  await test.step('der Status steht im Profil und sonst nirgends (§6)', async () => {
    await page
      .getByRole('navigation', { name: 'Hauptbereiche' })
      .getByRole('link', { name: 'Profil' })
      .click()

    await expect(page).toHaveURL(/\/profil$/)

    // `exact`, sonst trifft "Kein Erbe" auch den Ergebnissatz "Sie sind kein
    // Erbe.": `getByText` vergleicht als Teilzeichenkette ohne Rücksicht auf
    // Gross- und Kleinschreibung.
    await expect(zeilen(page).filter({ hasText: 'Erbstatus' })).toContainText('Kein Erbe')
  })

  await test.step('die Ausschlagungs-Aufgabe entsteht privat und trägt ihre Frist (§7)', async () => {
    /*
     * Der Weg, an dem §8 seit ADR-0001 hängt: Die Rechtsangaben stehen nicht
     * mehr im Katalog, sondern am Bauplan der Aufgabe, die der Baum erzeugt.
     * Ohne `{fristTage, fristAb}` rechnete die Ausschlagungsfrist nicht — die
     * eine Frist in dieser App, deren Versäumnis den ganzen Nachlass kostet.
     */
    await gotoVerlaesslich(page, '/erbe')
    await page.getByRole('button', { name: 'Fragebaum erneut durchlaufen' }).click()

    await page.getByRole('button', { name: 'Ja', exact: true }).click()
    await page.getByRole('button', { name: 'Ja', exact: true }).click()
    await page.getByRole('button', { name: 'Weiter zu Fragen über das Erbe' }).click()
    await page.getByRole('button', { name: 'Ja', exact: true }).click()

    // §2: Die Kette "Ja oder Nein" ist zusammengelegt — Frage, Hinweis und
    // beide Antworten stehen auf einer Seite.
    await expect(page.getByRole('heading', { name: 'Wollen Sie das Erbe haben?' })).toBeVisible()
    await expect(page.getByText(/Schulden des Verstorbenen/)).toBeVisible()

    await page.getByRole('button', { name: 'Nein, ich will das Erbe nicht' }).click()

    await expect(page.getByText(/Ausschlagung/).first()).toBeVisible()

    // Das eigene Kenntnisdatum, dieselbe Ablage wie im Aufgabendetail (§8).
    await page.getByLabel(/informiert/).fill('2024-03-15')

    const angelegt = gespeichert(page, 'POST')
    await page.getByRole('button', { name: 'Aufgabe erstellen' }).click()
    await angelegt

    await expect(page.getByRole('button', { name: 'Aufgabe öffnen' })).toBeVisible()

    await page.getByRole('button', { name: 'Aufgabe öffnen' }).click()

    await expect(page.getByRole('heading', { name: 'Erbe ausschlagen' })).toBeVisible()

    // §8: Rechtsgrundlage, zuständige Stelle und Quelle stehen im Item.
    await expect(page.getByText('§ 1944 BGB', { exact: true })).toBeVisible()
    await expect(
      page.getByRole('link', { name: 'https://www.gesetze-im-internet.de/bgb/__1944.html' }),
    ).toBeVisible()

    // 15. März 2024 plus die 42 Tage aus § 1944 BGB, gerechnet und nirgends
    // gespeichert (§8).
    await expect(page.getByText(/26. April 2024/)).toBeVisible()

    // §3.7: privat. Sie steht in "Alle" nur für diese Person — geprüft wird
    // hier, dass sie überhaupt dort auftaucht; dass niemand sonst sie sieht,
    // prüft `privatService.test.ts` gegen den echten Ciphertext.
    await gotoVerlaesslich(page, '/alle')
    await expect(page.getByText('Erbe ausschlagen', { exact: true })).toBeVisible()
  })

  await test.step('ein zweiter Durchlauf überschreibt das Ergebnis nicht (§6)', async () => {
    // Der Durchlauf davor hat ebenfalls nicht überschrieben: Gespeichert ist
    // weiterhin "Kein Erbe" aus dem ersten.
    await gotoVerlaesslich(page, '/erbe')

    await page.getByRole('button', { name: 'Fragebaum erneut durchlaufen' }).click()

    await expect(page.getByRole('heading', { name: 'Sind Sie Erbe?' })).toBeVisible()

    await page.getByRole('button', { name: 'Nein', exact: true }).click()
    await page.getByRole('button', { name: 'Ich weiß es nicht' }).click()

    // Das Ergebnis dieses Durchlaufs steht da, das gespeicherte bleibt.
    await expect(page.getByText(/Ihr gespeichertes Ergebnis bleibt/)).toBeVisible()
    await expect(
      page.getByRole('button', { name: 'Gespeichertes Ergebnis ersetzen' }),
    ).toBeVisible()
  })

  await test.step('legt die Aufgabe an, an der die folgenden Schritte hängen', async () => {
    /*
     * Bis ADR-0001 kam sie aus dem Katalog. Jetzt legt der Test sie selbst an:
     * Was hier geprüft wird — Zuweisung, Unteraufgaben, Notizen, Löschen — sind
     * Eigenschaften jeder Aufgabe und nie welche des Katalogs gewesen.
     *
     * Die Rechtsangaben aus §8 prüft der Fragebaum-Schritt weiter oben an der
     * Ausschlagungs-Aufgabe: Sie ist seit ADR-0001 die Aufgabe, die
     * `{fristTage, fristAb}`, Rechtsgrundlage und Quelle trägt.
     */
    await gotoVerlaesslich(page, '/alle')

    const angelegt = gespeichert(page, 'POST')
    await page.getByLabel('Neue Aufgabe').fill('Sterbefall beim Standesamt anzeigen')
    await page.getByRole('button', { name: 'Aufgabe hinzufügen' }).click()
    await angelegt

    await expect(
      page.getByRole('checkbox', { name: 'Sterbefall beim Standesamt anzeigen' }),
    ).toBeVisible()

    // Wer eine Aufgabe anlegt, ist eingetragen (§7). Für den nächsten Schritt
    // muss sie wieder frei sein.
    const freigegeben = gespeichert(page, 'PATCH')
    await page
      .getByRole('button', { name: /^Freigeben.*Sterbefall beim Standesamt anzeigen/ })
      .click()
    await freigegeben
  })

  await test.step('eine unzugewiesene Aufgabe lässt sich übernehmen (§7)', async () => {
    /*
     * Die Aufgabe gehört gerade niemandem, und §7 lässt nur bearbeiten, wem
     * sie zugewiesen ist. Also erst eintragen: Das ist die Reservierung, mit
     * der eine Familie sich die Arbeit teilt.
     */
    await page.getByRole('link', { name: /^Details.*Sterbefall beim Standesamt anzeigen/ }).click()
    await expect(
      page.getByRole('heading', { name: 'Sterbefall beim Standesamt anzeigen' }),
    ).toBeVisible()

    await expect(page.getByText('Zuständig: Niemand')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Unteraufgabe hinzufügen' })).toBeDisabled()

    const uebernommen = gespeichert(page, 'PATCH')
    await page.getByRole('button', { name: 'Übernehmen' }).click()
    await uebernommen

    await expect(page.getByText('Zuständig: Sie')).toBeVisible()
  })

  await test.step('Unteraufgaben sind eigene Zeilen und tragen den Abschluss (§7)', async () => {
    const angelegteUnteraufgabe = gespeichert(page, 'POST')
    await page.getByLabel('Neue Unteraufgabe').fill('Sterbeurkunden in ausreichender Zahl bestellen')
    await page.getByRole('button', { name: 'Unteraufgabe hinzufügen' }).click()
    await angelegteUnteraufgabe

    const unteraufgabe = page.getByRole('checkbox', {
      name: 'Sterbeurkunden in ausreichender Zahl bestellen',
    })

    // §7: Eine Unteraufgabe ist eine eigene Zeile mit eigener UUID und keine
    // Liste im Payload der Elternaufgabe.
    await expect(unteraufgabe).toBeVisible()
    await expect(unteraufgabe).not.toBeChecked()

    // Und die Elternaufgabe hat kein eigenes Häkchen mehr.
    await expect(page.getByRole('checkbox', { name: 'Diese Aufgabe ist erledigt' })).toHaveCount(0)
    await expect(page.getByText('Offen: 0 von 1 Unteraufgaben erledigt.')).toBeVisible()

    /*
     * Eine Unteraufgabe ist eine Zeile wie jede andere und trägt deshalb ihre
     * eigene Zuweisung (§7), die der Elternaufgabe gilt für sie nicht. Genau
     * das ist der Punkt: Die Bank ruft der eine an, zum Standesamt geht die
     * andere. Abgehakt wird sie also erst, nachdem jemand sich eingetragen hat.
     */
    // Wer sie anlegt, ist eingetragen (§7); für die Gegenprobe wird sie frei
    // gegeben und wieder übernommen.
    await page
      .getByRole('link', { name: /^Zuständigkeit ändern.*Sterbeurkunden in ausreichender Zahl/ })
      .click()

    const unteraufgabeFrei = gespeichert(page, 'PATCH')
    await page.getByRole('button', { name: 'Freigeben' }).click()
    await unteraufgabeFrei

    const unteraufgabeUebernommen = gespeichert(page, 'PATCH')
    await page.getByRole('button', { name: 'Übernehmen' }).click()
    await unteraufgabeUebernommen

    await page.getByRole('link', { name: 'Zurück zu allen Aufgaben' }).click()
    await page
      .getByRole('link', { name: /^Details.*Sterbefall beim Standesamt anzeigen/ })
      .click()

    const abgehakt = gespeichert(page, 'PATCH')
    await page.getByRole('checkbox', { name: 'Sterbeurkunden in ausreichender Zahl bestellen' }).check()
    await abgehakt

    // §7: Sind alle Kinder erledigt, gilt die Aufgabe zwingend als erledigt.
    await expect(page.getByText('Erledigt: alle 1 Unteraufgaben sind abgehakt.')).toBeVisible()

    // Eine weitere Unteraufgabe macht sie wieder offen. Das ist der Weg, den
    // §7 anbietet, wenn inhaltlich noch etwas fehlt.
    const angelegt = gespeichert(page, 'POST')
    await page.getByLabel('Neue Unteraufgabe').fill('Sechs Ausfertigungen abholen')
    await page.getByRole('button', { name: 'Unteraufgabe hinzufügen' }).click()
    await angelegt

    await expect(page.getByText('Offen: 1 von 2 Unteraufgaben erledigt.')).toBeVisible()

    // Der abgeleitete Abschluss überlebt das Neuladen, weil er nirgends
    // gespeichert ist: Er entsteht bei jedem Rendern neu.
    await gotoVerlaesslich(page, '/alle')
    await page
      .getByRole('link', { name: /^Details.*Sterbefall beim Standesamt anzeigen/ })
      .click()
    await expect(page.getByText('Offen: 1 von 2 Unteraufgaben erledigt.')).toBeVisible()

    // Wieder aufgeräumt: die eigene Unteraufgabe weg, das Häkchen zurück.
    const geloescht = gespeichert(page, 'PATCH')
    await page.getByRole('button', { name: /^Löschen.*Sechs Ausfertigungen abholen/ }).click()
    await page.getByRole('button', { name: 'Endgültig löschen' }).click()
    await geloescht

    const zurueckgenommen = gespeichert(page, 'PATCH')
    await page
      .getByRole('checkbox', { name: 'Sterbeurkunden in ausreichender Zahl bestellen' })
      .uncheck()
    await zurueckgenommen
  })

  /** Der Zeilenstand, bevor die frei angelegten Aufgaben dazukommen. */
  let grundZeilen = 0

  await test.step('Notizen überleben das Neuladen', async () => {
    const gesichert = gespeichert(page, 'PATCH')
    await page.getByLabel(/Notizen/).fill('Termin am Montag um 9 Uhr')
    await page.getByRole('button', { name: 'Notizen speichern' }).click()
    await gesichert

    await gotoVerlaesslich(page, '/alle')
    await page
      .getByRole('link', { name: /^Details.*Sterbefall beim Standesamt anzeigen/ })
      .click()

    await expect(page.getByLabel(/Notizen/)).toHaveValue('Termin am Montag um 9 Uhr')

    await page.getByRole('link', { name: 'Zurück zu allen Aufgaben' }).click()
    await expect(page).toHaveURL(/\/alle$/)
  })

  await test.step('legt im Tab "Alle" eine Aufgabe an', async () => {
    /*
     * Der Stand vor diesem Schritt, gezählt statt gerechnet: Was bis hierher
     * entstanden ist — die Katalogaufgabe, die Elternaufgabe, ihre
     * Unteraufgabe — soll dieser Schritt nicht nachrechnen müssen.
     */
    grundZeilen = await zeilen(page).count()

    await page.getByLabel('Neue Aufgabe').fill('Sterbeurkunde beantragen')
    await page.getByRole('button', { name: 'Aufgabe hinzufügen' }).click()

    await expect(page.getByRole('checkbox', { name: 'Sterbeurkunde beantragen' })).toBeVisible()

    await page.getByLabel('Neue Aufgabe').fill('Konten kündigen')
    await page.getByRole('button', { name: 'Aufgabe hinzufügen' }).click()

    await expect(zeilen(page)).toHaveCount(grundZeilen + 2)
  })

  await test.step('die Reihenfolge bleibt, wenn eine Aufgabe geändert wird', async () => {
    /*
     * `seq` steigt bei jedem Schreibvorgang (§4) und taugt deshalb nicht als
     * Anzeigereihenfolge. Danach sortiert wanderte die gerade abgehakte
     * Aufgabe ans Ende. Sortiert wird über die UUIDv7 der Zeile.
     */
    const abgehakt = gespeichert(page, 'PATCH')
    await page.getByRole('checkbox', { name: 'Sterbeurkunde beantragen' }).check()
    await abgehakt

    await gotoVerlaesslich(page, '/alle')

    await expect(zeilen(page)).toHaveCount(grundZeilen + 2)

    // Hinter dem Katalog: Der steht in der Reihenfolge der Juristinnen vorn
    // (§8), selbst angelegte Aufgaben folgen in ihrer Anlagereihenfolge.
    await expect(zeilen(page).nth(grundZeilen)).toContainText('Sterbeurkunde beantragen')
    await expect(zeilen(page).last()).toContainText('Konten kündigen')

    /*
     * Aufgeräumt, damit die folgenden Schritte wieder mit genau einer selbst
     * angelegten Aufgabe arbeiten und abgewartet, bis der Tombstone
     * draußen ist. `toHaveCount` ist schon erfüllt, sobald die Queue die
     * Mutation überlagert hat (§5); die PATCH-Antwort kommt später. Ohne dieses
     * Warten löste sie im nächsten Schritt das dortige `gespeichert(...)` aus,
     * die Navigation käme dem eigentlichen Schreibvorgang zuvor, und der
     * Schritt prüfte einen Server, der die Änderung nie gesehen hat.
     */
    const geloescht = gespeichert(page, 'PATCH')
    await page.getByRole('button', { name: /^Löschen.*Konten kündigen/ }).click()
    await page.getByRole('button', { name: 'Endgültig löschen' }).click()
    await expect(zeilen(page)).toHaveCount(grundZeilen + 1)
    await geloescht
  })

  await test.step('nimmt das Haekchen zurueck und setzt es wieder; beides ueberlebt das Neuladen', async () => {
    /*
     * Der eigentliche Punkt des Slices: Der Stand liegt nicht im Speicher des
     * Tabs, sondern verschlüsselt auf dem Server. Neu geladen wird über eine
     * echte Navigation und nicht über `page.reload()`: Dieselbe Absicherung
     * gegen den JWT-Jitter aus helpers.ts greift dann mit.
     *
     * Beide Richtungen, weil das Häkchen aus dem vorigen Schritt noch steht:
     * Ein zweites `check()` wäre ein Klick, der nichts tut, und der Schritt
     * prüfte am Ende nur, dass sich nichts geändert hat.
     */
    const kaestchen = page.getByRole('checkbox', { name: 'Sterbeurkunde beantragen' })

    const zurueckgenommen = gespeichert(page, 'PATCH')
    await kaestchen.uncheck()
    await expect(kaestchen).not.toBeChecked()
    await zurueckgenommen

    await gotoVerlaesslich(page, '/alle')
    await expect(page.getByRole('checkbox', { name: 'Sterbeurkunde beantragen' })).not.toBeChecked()

    const abgehakt = gespeichert(page, 'PATCH')
    await page.getByRole('checkbox', { name: 'Sterbeurkunde beantragen' }).check()

    // Sofort sichtbar, noch bevor irgendetwas das Gerät verlassen hat (§5).
    await expect(page.getByRole('checkbox', { name: 'Sterbeurkunde beantragen' })).toBeChecked()

    await abgehakt
    await gotoVerlaesslich(page, '/alle')

    await expect(page.getByRole('checkbox', { name: 'Sterbeurkunde beantragen' })).toBeChecked()
  })

  await test.step('benennt sie um und gibt ihr eine Beschreibung', async () => {
    await page.getByRole('button', { name: /^Ändern.*Sterbeurkunde beantragen/ }).click()

    await page.getByLabel('Titel').fill('Sterbeurkunde abholen')
    await page.getByLabel('Beschreibung').fill('Sechs Ausfertigungen, Standesamt Freiburg')
    await page.getByRole('button', { name: 'Speichern' }).click()

    await expect(page.getByRole('checkbox', { name: 'Sterbeurkunde abholen' })).toBeVisible()

    /*
     * Die Beschreibung steht nicht in der Liste, sondern nur im Detail: Sie
     * ist ein ganzer Absatz Fließtext, und in einer Liste von zwanzig
     * Aufgaben macht sie aus jeder Zeile einen Block (Alle.tsx). Gespeichert
     * ist sie trotzdem, und genau das prüft dieser Umweg.
     */
    await page.getByRole('link', { name: /^Details.*Sterbeurkunde abholen/ }).click()
    await expect(page.getByText('Sechs Ausfertigungen, Standesamt Freiburg')).toBeVisible()
    await page.getByRole('link', { name: 'Zurück zu allen Aufgaben' }).click()

    // Das Häkchen überlebt das Umbenennen: Geändert wird der Payload, und der
    // trägt beides.
    await expect(page.getByRole('checkbox', { name: 'Sterbeurkunde abholen' })).toBeChecked()
  })

  await test.step('ein zweiter Tab sieht die Änderung, ohne neu zu laden', async () => {
    /*
     * Die Türklingel aus §5: Eine Realtime-Subscription auf die `cases`-Zeile,
     * deren `version` der Trigger bei jeder Inhaltsänderung mithebt. Was sich
     * geändert hat, holt danach das Delta. Die Klingel trägt keine Nutzlast.
     *
     * Zweiter Tab und nicht zweiter Browser: Beide Seiten teilen sich den
     * Kontext und damit IndexedDB, also auch die Geräteidentität aus §3.1. Ein
     * eigener Kontext wäre ein zweites Gerät, für das kein Wrap dieses Falls
     * vorliegt; es sähe den Fall gesperrt. Was zwei wirklich getrennte Geräte
     * angeht, hängt an der Kopplung und gehört dorthin. Der Weg, um den es hier
     * geht von der Änderung über Trigger, Klingel und Delta bis zum Bildschirm, ist derselbe.
     */
    const zweiterTab = await page.context().newPage()

    try {
      await gotoVerlaesslich(zweiterTab, '/alle')
      await expect(zweiterTab.getByRole('checkbox', { name: 'Sterbeurkunde abholen' })).toBeVisible()

      const angelegt = gespeichert(page, 'POST')
      await page.getByLabel('Neue Aufgabe').fill('Konto der Sparkasse kündigen')
      await page.getByRole('button', { name: 'Aufgabe hinzufügen' }).click()
      await angelegt

      /*
       * Kein `goto`, kein `reload`: Der zweite Tab bekommt es von selbst mit.
       *
       * Länger als die 15 Sekunden aus der Konfiguration, weil hier als
       * einziger Stelle im Test ein zweiter Dienst im Weg steht: Der Weg geht
       * über den Trigger in Postgres, Supabase Realtime als eigenen Prozess,
       * das Delta zurück und das Entschlüsseln im Tab. Sechs Worker teilen
       * sich dabei eine Maschine. Ausbleiben darf die Klingel trotzdem nicht,
       * deshalb eine größere Zusage und kein weicheres Kriterium.
       */
      await expect(
        zweiterTab.getByRole('checkbox', { name: 'Konto der Sparkasse kündigen' }),
      ).toBeVisible({ timeout: 30_000 })

      // Und wieder aufgeräumt, damit der nächste Schritt eine Aufgabe vorfindet.
      const geloescht = gespeichert(page, 'PATCH')
      await page.getByRole('button', { name: /^Löschen.*Konto der Sparkasse kündigen/ }).click()
      await page.getByRole('button', { name: 'Endgültig löschen' }).click()
      await geloescht
    } finally {
      await zweiterTab.close()
    }
  })

  await test.step('löscht sie nach einer Rückfrage, und sie bleibt fort', async () => {
    await page.getByRole('button', { name: /^Löschen.*Sterbeurkunde abholen/ }).click()

    // §5: Löschen gewinnt endgültig. Das steht vor der Aktion auf dem Schirm.
    await expect(page.getByText('kommen nicht zurück')).toBeVisible()
    await page.getByRole('button', { name: 'Endgültig löschen' }).click()

    await expect(page.getByRole('checkbox', { name: 'Sterbeurkunde abholen' })).toHaveCount(0)

    await gotoVerlaesslich(page, '/alle')
    await expect(page.getByRole('checkbox', { name: 'Sterbeurkunde abholen' })).toHaveCount(0)
    await expect(zeilen(page)).toHaveCount(grundZeilen)
  })

  await test.step('eine gelöschte Katalogaufgabe kommt nicht wieder', async () => {
    /*
     * §8: Der Katalog initialisiert, mehr nicht. Danach ist es ein
     * gewöhnliches Item. Der Tombstone steht im Bestand (§5), und die
     * Instanziierung beim nächsten Laden übergeht ihn. Käme die Aufgabe wieder,
     * wäre "löschen" bei genau dieser Aufgabe eine Lüge.
     *
     * Seit ADR-0001 ist es genau eine: die, die in den Fragebaum führt.
     */
    // Auch das Löschen ist Bearbeiten (§7): erst eintragen, dann löschen.
    const uebernommen = gespeichert(page, 'PATCH')
    await page.getByRole('button', { name: /^Übernehmen.*Klären ob Sie Erbe sind/ }).click()
    await uebernommen

    const geloescht = gespeichert(page, 'PATCH')
    await page.getByRole('button', { name: /^Löschen.*Klären ob Sie Erbe sind/ }).click()
    await page.getByRole('button', { name: 'Endgültig löschen' }).click()
    await geloescht

    await gotoVerlaesslich(page, '/alle')

    await expect(page.getByText('Klären ob Sie Erbe sind', { exact: true })).toHaveCount(0)
    await expect(zeilen(page)).toHaveCount(grundZeilen - 1)
  })

  await test.step('Start zeigt genau die eigenen Aufgaben (§7)', async () => {
    /*
     * Der Screen aus §7, jetzt mit Inhalt: Übernommen wurden die Aufgabe beim
     * Standesamt und eine ihrer Unteraufgaben, und genau die beiden stehen
     * hier. Gefiltert wird clientseitig, nach dem Entschlüsseln (§3.3): Der
     * Server kann nach `assignee` nicht filtern, weil er ihn nicht lesen kann.
     */
    await gotoVerlaesslich(page, '/')

    await expect(page.getByRole('heading', { name: 'Meine Aufgaben' })).toBeVisible()
    // `exact`, weil der Titel auch im Hinweis der Unteraufgabe darunter steht.
    await expect(
      page.getByText('Sterbefall beim Standesamt anzeigen', { exact: true }),
    ).toBeVisible()

    // Eine zugewiesene Unteraufgabe steht mit da und nennt ihre Elternaufgabe.
    await expect(
      page.getByRole('checkbox', { name: 'Sterbeurkunden in ausreichender Zahl bestellen' }),
    ).toBeVisible()
    await expect(page.getByText('Teil von „Sterbefall beim Standesamt anzeigen“')).toBeVisible()

    /*
     * Was niemand übernommen hat, steht hier nicht, es steht in "Alle". Dafür
     * eine eigens angelegte und gleich wieder freigegebene Aufgabe: Die
     * Katalogaufgabe, die diese Rolle früher hatte, ist im vorigen Schritt
     * gelöscht worden.
     */
    await gotoVerlaesslich(page, '/alle')

    const unbesetzt = gespeichert(page, 'POST')
    await page.getByLabel('Neue Aufgabe').fill('Nachlassverzeichnis erstellen')
    await page.getByRole('button', { name: 'Aufgabe hinzufügen' }).click()
    await unbesetzt

    const freigegeben = gespeichert(page, 'PATCH')
    await page
      .getByRole('button', { name: /^Freigeben.*Nachlassverzeichnis erstellen/ })
      .click()
    await freigegeben

    await gotoVerlaesslich(page, '/')

    await expect(
      page.getByRole('link', { name: /^Details.*Nachlassverzeichnis erstellen/ }),
    ).toHaveCount(0)
  })

  await test.step('eine Reservierung lässt sich wieder lösen (§7)', async () => {
    await gotoVerlaesslich(page, '/alle')

    const freigegeben = gespeichert(page, 'PATCH')
    await page
      .getByRole('button', { name: /^Freigeben.*Sterbefall beim Standesamt anzeigen/ })
      .click()
    await freigegeben

    await expect(
      page.getByRole('button', { name: /^Übernehmen.*Sterbefall beim Standesamt anzeigen/ }),
    ).toBeVisible()

    // Und damit ist sie von Start verschwunden. Die Unteraufgabe bleibt, denn
    // sie trägt ihre eigene Zuweisung.
    await gotoVerlaesslich(page, '/')
    await expect(
      page.getByText('Sterbefall beim Standesamt anzeigen', { exact: true }),
    ).toHaveCount(0)
    await expect(
      page.getByRole('checkbox', { name: 'Sterbeurkunden in ausreichender Zahl bestellen' }),
    ).toBeVisible()
  })

  await test.step('der Fall steht in Profil unter "Für wen?"', async () => {
    await page.goto('/profil')

    /*
     * "Für wen?" ist keine Überschrift mehr, sondern die Beschriftung einer
     * Zeile in der Gruppe "Fall" (Profil.tsx). Geprüft wird deshalb die
     * Gruppe und darin die Zeile, die den Namen trägt.
     */
    await expect(page.getByRole('heading', { name: 'Fall', exact: true })).toBeVisible()
    await expect(zeilen(page).filter({ hasText: 'Für wen?' })).toContainText('Hans Weber')
  })

  await test.step('ein unbekannter Pfad landet auf der Startseite', async () => {
    await page.goto('/irgendwas-das-es-nicht-gibt')
    await expect(page).toHaveURL(/\/$/)
  })
})
