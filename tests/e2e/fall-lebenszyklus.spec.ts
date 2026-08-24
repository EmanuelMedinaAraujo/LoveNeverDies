import { expect, test, type Page } from '@playwright/test'
import { gotoVerlaesslich } from './helpers.ts'

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
   */
  test.setTimeout(120_000)

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

  await test.step('Profil und Geräte ist von dort erreichbar', async () => {
    await page.getByRole('link', { name: 'Profil und Geräte' }).click()

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
    await expect(page.getByRole('listitem').filter({ hasText: 'Dieses Gerät' })).toBeVisible()

    await page.getByRole('link', { name: 'Zurück' }).click()
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
     * Die Aufgaben der Juristinnen kommen unzugewiesen in den Fall (§8): Wer
     * sie übernimmt, entscheidet die Familie. Start zeigt deshalb genau nichts,
     * obwohl der Fall gerade vierzig Aufgaben bekommen hat, und sagt, wo man
     * eine findet.
     */
    await expect(page.getByText(/Ihnen ist gerade nichts zugewiesen/)).toBeVisible()
  })

  /**
   * Wie viele Aufgaben der Rechtskatalog mitgebracht hat (§8).
   *
   * Gezählt statt aus dem Katalog importiert: Die Zahl ändert sich mit jedem
   * `npm run import:content`, und dieser Test soll davon nichts wissen.
   *
   * Gezählt werden Zeilen und nicht Häkchen: Eine Aufgabe mit
   * Unteraufgaben hat kein eigenes Häkchen (§7), steht aber als Zeile da.
   */
  let katalogZeilen = 0

  await test.step('der neue Fall bringt die Aufgaben der Juristinnen mit', async () => {
    // §8: "Ein neu angelegter Trauerfall ist nicht mehr leer." Instanziiert hat
    // ihn die Fallanlage, verschlüsselt wie jedes andere Item.
    await page.getByRole('link', { name: 'Alle Aufgaben' }).click()

    await expect(page).toHaveURL(/\/alle$/)
    await expect(page.getByRole('heading', { name: 'Alle Aufgaben' })).toBeVisible()

    await expect(
      page.getByRole('checkbox', { name: 'Ausschlagung der Erbschaft prüfen' }),
    ).toBeVisible()

    katalogZeilen = await page.getByRole('listitem').count()
    expect(katalogZeilen).toBeGreaterThan(1)

    /*
     * §7: "Blockierte Aufgaben erscheinen ausgegraut mit 'Zuerst: ...'." Der
     * Katalog sagt, dass das Standesamt die Todesbescheinigung braucht, und
     * die ist am ersten Tag noch offen.
     */
    // `.first()`: Mehrere Katalogaufgaben warten auf dieselbe Todesbescheinigung.
    await expect(
      page.getByText('Zuerst: Ärztliche Todesbescheinigung ausstellen lassen').first(),
    ).toBeVisible()

    /*
     * §7: Fristen sind sichtbar, als Badge mit der Restzeit. Der Sterbefall
     * liegt in diesem Test Jahre zurück, also ist die Drei-Tage-Frist aus
     * § 28 PStG abgelaufen, und das Badge sagt genau das, statt bei null
     * stehen zu bleiben. Gerechnet wird es bei jedem Rendern, gespeichert nie
     * (§8); deshalb steht hier ein Muster und keine Zahl.
     */
    await expect(page.getByText(/überfällig/)).toBeVisible()

    // §8: Wo das Gesetz keine Frist nennt, erfindet die App keine.
    await expect(page.getByText('Frist ab Ihrer Kenntnis')).toBeVisible()

    // Und beim Neuladen steht dieselbe Liste: kein zweiter Satz, keine
    // Duplikate. Die IDs sind deterministisch, das Anlegen ist idempotent (§8).
    await gotoVerlaesslich(page, '/alle')
    await expect(page.getByRole('listitem')).toHaveCount(katalogZeilen)
  })

  await test.step('das Aufgabendetail zeigt die juristische Arbeit (§7, §8)', async () => {
    /*
     * Der Screen, an dem §8 sichtbar wird: Rechtsgrundlage, Quelle, zuständige
     * Stelle und Frist stehen im Item, beim Instanziieren aus dem Katalog
     * kopiert und seither mit der Aufgabe gealtert.
     */
    await page
      .getByRole('link', { name: /^Details.*Sterbefall beim Standesamt anzeigen/ })
      .click()

    await expect(
      page.getByRole('heading', { name: 'Sterbefall beim Standesamt anzeigen' }),
    ).toBeVisible()

    // `exact`, weil derselbe Paragraph auch im Hinweistext steht.
    await expect(page.getByText('§ 28 PStG', { exact: true })).toBeVisible()
    await expect(page.getByText('Standesamt des Sterbeortes', { exact: true })).toBeVisible()
    await expect(page.getByText('Todesbescheinigung', { exact: true })).toBeVisible()
    await expect(
      page.getByRole('link', { name: 'https://www.gesetze-im-internet.de/pstg/__28.html' }),
    ).toBeVisible()

    /*
     * Das Fristende wird gerechnet und nirgends gespeichert (§8): 15. März 2024
     * plus die drei Tage aus § 28 PStG. Keine Zeile trägt dieses Datum: Es
     * entsteht aus `{fristTage, fristAb}` und dem Sterbedatum des Falls.
     */
    await expect(page.getByText(/endet am 18. März 2024/)).toBeVisible()
    // Zweimal auf dem Schirm: als Badge neben dem Titel und in der Fristzeile.
    await expect(page.getByText(/überfällig/).first()).toBeVisible()

    // §7: "Zuerst: ..." auch hier, und der Weg dorthin ist ein Link.
    await expect(
      page.getByRole('link', { name: 'Ärztliche Todesbescheinigung ausstellen lassen' }),
    ).toBeVisible()
  })

  await test.step('eine unzugewiesene Aufgabe lässt sich übernehmen (§7)', async () => {
    /*
     * Bis hierher gehört diese Aufgabe niemandem: Sie kommt aus dem Katalog,
     * und §7 lässt nur bearbeiten, wem sie zugewiesen ist. Also erst
     * eintragen: Das ist die Reservierung, mit der eine Familie sich die
     * Arbeit teilt.
     */
    await expect(page.getByText('Zuständig: Niemand')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Unteraufgabe hinzufügen' })).toBeDisabled()

    const uebernommen = gespeichert(page, 'PATCH')
    await page.getByRole('button', { name: 'Übernehmen' }).click()
    await uebernommen

    await expect(page.getByText('Zuständig: Sie')).toBeVisible()
  })

  await test.step('Unteraufgaben sind eigene Zeilen und tragen den Abschluss (§7)', async () => {
    const ausDemKatalog = page.getByRole('checkbox', {
      name: 'Sterbeurkunden in ausreichender Zahl bestellen',
    })

    // Die Unteraufgabe aus dem Katalog ist eine eigene Zeile mit eigener UUID.
    await expect(ausDemKatalog).toBeVisible()
    await expect(ausDemKatalog).not.toBeChecked()

    // Und die Elternaufgabe hat kein eigenes Häkchen mehr.
    await expect(page.getByRole('checkbox', { name: 'Diese Aufgabe ist erledigt' })).toHaveCount(0)
    await expect(page.getByText('Offen: 0 von 1 Unteraufgaben erledigt.')).toBeVisible()

    /*
     * Eine Unteraufgabe ist eine Zeile wie jede andere und trägt deshalb ihre
     * eigene Zuweisung (§7), die der Elternaufgabe gilt für sie nicht. Genau
     * das ist der Punkt: Die Bank ruft der eine an, zum Standesamt geht die
     * andere. Abgehakt wird sie also erst, nachdem jemand sich eingetragen hat.
     */
    await expect(ausDemKatalog).toBeDisabled()

    await page
      .getByRole('link', { name: /^Zuständigkeit ändern.*Sterbeurkunden in ausreichender Zahl/ })
      .click()

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
    await page.getByLabel('Neue Aufgabe').fill('Sterbeurkunde beantragen')
    await page.getByRole('button', { name: 'Aufgabe hinzufügen' }).click()

    await expect(page.getByRole('checkbox', { name: 'Sterbeurkunde beantragen' })).toBeVisible()

    await page.getByLabel('Neue Aufgabe').fill('Konten kündigen')
    await page.getByRole('button', { name: 'Aufgabe hinzufügen' }).click()

    await expect(page.getByRole('listitem')).toHaveCount(katalogZeilen + 2)
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

    await expect(page.getByRole('listitem')).toHaveCount(katalogZeilen + 2)

    // Hinter dem Katalog: Der steht in der Reihenfolge der Juristinnen vorn
    // (§8), selbst angelegte Aufgaben folgen in ihrer Anlagereihenfolge.
    await expect(page.getByRole('listitem').nth(katalogZeilen)).toContainText(
      'Sterbeurkunde beantragen',
    )
    await expect(page.getByRole('listitem').last()).toContainText('Konten kündigen')

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
    await expect(page.getByRole('listitem')).toHaveCount(katalogZeilen + 1)
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
    await expect(page.getByText('Sechs Ausfertigungen, Standesamt Freiburg')).toBeVisible()

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

      // Kein `goto`, kein `reload`: Der zweite Tab bekommt es von selbst mit.
      await expect(
        zweiterTab.getByRole('checkbox', { name: 'Konto der Sparkasse kündigen' }),
      ).toBeVisible()

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
    await expect(page.getByRole('listitem')).toHaveCount(katalogZeilen)
  })

  await test.step('eine gelöschte Katalogaufgabe kommt nicht wieder', async () => {
    /*
     * §8: Der Katalog initialisiert, mehr nicht. Danach ist es ein
     * gewöhnliches Item. Der Tombstone steht im Bestand (§5), und die
     * Instanziierung beim nächsten Laden übergeht ihn. Käme die Aufgabe wieder,
     * wäre "löschen" bei genau diesen Aufgaben eine Lüge.
     */
    // Auch das Löschen ist Bearbeiten (§7): erst eintragen, dann löschen.
    const uebernommen = gespeichert(page, 'PATCH')
    await page
      .getByRole('button', { name: /^Übernehmen.*Ausschlagung der Erbschaft prüfen/ })
      .click()
    await uebernommen

    const geloescht = gespeichert(page, 'PATCH')
    await page.getByRole('button', { name: /^Löschen.*Ausschlagung der Erbschaft prüfen/ }).click()
    await page.getByRole('button', { name: 'Endgültig löschen' }).click()
    await geloescht

    await gotoVerlaesslich(page, '/alle')

    await expect(
      page.getByRole('checkbox', { name: 'Ausschlagung der Erbschaft prüfen' }),
    ).toHaveCount(0)
    await expect(page.getByRole('listitem')).toHaveCount(katalogZeilen - 1)
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
    await expect(
      page.getByText('Unteraufgabe von „Sterbefall beim Standesamt anzeigen“'),
    ).toBeVisible()

    /*
     * Was niemand übernommen hat, steht hier nicht, es steht in "Alle".
     * Geprüft am Detaillink und nicht am Titel: Der Titel taucht auf Start noch
     * einmal auf, im "Zuerst: ..." der Aufgabe, die auf ihn wartet (§7).
     */
    await expect(
      page.getByRole('link', { name: /^Details.*Ärztliche Todesbescheinigung/ }),
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

    await expect(page.getByRole('heading', { name: 'Für wen?' })).toBeVisible()
    await expect(page.getByText('Hans Weber', { exact: true })).toBeVisible()
  })

  await test.step('ein unbekannter Pfad landet auf der Startseite', async () => {
    await page.goto('/irgendwas-das-es-nicht-gibt')
    await expect(page).toHaveURL(/\/$/)
  })
})
