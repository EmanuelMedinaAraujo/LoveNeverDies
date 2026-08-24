import { expect, test, type Page } from '@playwright/test'
import { gotoVerlaesslich } from './helpers.ts'

/**
 * Wartet darauf, dass eine Änderung den Server erreicht hat (DESIGN.md §5).
 *
 * Seit dem Delta-Sync ist „sichtbar" nicht mehr dasselbe wie „gespeichert":
 * Jede Mutation wird sofort angezeigt und geht über die Offline-Queue hinaus —
 * das ist der Sinn der Queue. Wer unmittelbar danach neu lädt, muss also
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
 * **Ein einziger Test, nicht mehrere.** Jeder Playwright-`test()` bekommt einen
 * frischen Browserkontext und damit eine leere IndexedDB — und die Geräte-
 * identität liegt in IndexedDB (keystore.ts), nicht im von `auth.setup.ts`
 * gesicherten `storageState` (das deckt nur Cookies und localStorage ab). Zwei
 * separate Tests wären zwei verschiedene Geräte: Das zweite bekäme den Fall
 * zwar über die Mitgliedschaft zu sehen, aber gesperrt — sein Schlüssel liegt
 * für keinen Wrap dieses Falls vor (`Für dieses Gerät liegt noch kein
 * Schlüssel zu diesem Fall vor`). `test.step` haelt dagegen alles im selben
 * Kontext, also demselben Geraet, so wie eine reale Sitzung es auch waere.
 */
test('Trauerfall anlegen', async ({ page }) => {
  /*
   * Mehr als die üblichen 30 Sekunden, weil dieser eine Test absichtlich der
   * ganze Lebenszyklus ist (siehe oben) und mit jedem Slice länger wird: Er
   * erzeugt einmal die Geräteschlüssel, legt einen Fall an und navigiert danach
   * ein gutes Dutzend Mal wirklich neu — auf einem langsameren Browser reicht
   * die Voreinstellung dafür nicht. Die Zusagen je Schritt hängen weiterhin an
   * `expect.timeout` aus der Konfiguration; hier steht nur die Summe.
   */
  test.setTimeout(90_000)

  await test.step('ohne Fall steht die Fallweiche aus §7', async () => {
    await gotoVerlaesslich(page, '/')

    // Nicht mehr die Anmeldung: der gespeicherte Sitzungszustand aus
    // auth.setup.ts hat bereits gegriffen.
    await expect(page.getByRole('heading', { name: 'Willkommen' })).toBeVisible()

    await expect(
      page.getByRole('button', { name: 'Ein Todesfall ist eingetreten' }),
    ).toBeEnabled()
    await expect(
      page.getByRole('button', { name: 'Ich möchte für später vorsorgen' }),
    ).toBeDisabled()
    await expect(page.getByRole('button', { name: 'Ich wurde eingeladen' })).toBeDisabled()
  })

  await test.step('Profil und Geräte ist von dort erreichbar', async () => {
    await page.getByRole('link', { name: 'Profil und Geräte' }).click()

    await expect(page).toHaveURL(/\/profil$/)
    await expect(page.getByRole('heading', { name: 'Profil' })).toBeVisible()

    /*
     * Warten, bis dieses Gerät in der Liste steht — und zwar nicht nur der
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

  await test.step('legt einen Trauerfall an', async () => {
    await page.getByRole('button', { name: 'Ein Todesfall ist eingetreten' }).click()

    await expect(page).toHaveURL(/\/todesfall$/)

    await page.getByLabel('Name der verstorbenen Person').fill('Hans Weber')
    await page.getByLabel('Sterbedatum').fill('2024-03-15')
    await page.getByRole('button', { name: 'Fall anlegen' }).click()

    await expect(page).toHaveURL(/\/$/)
    await expect(
      page.getByRole('heading', { name: 'Hans Weber · Trauerfall seit 15. März 2024' }),
    ).toBeVisible()
  })

  await test.step('ein zweiter Besuch von /todesfall legt keinen zweiten Fall an', async () => {
    // Todesfall.tsx: "Wer schon einen Fall hat, legt hier keinen zweiten an."
    await page.goto('/todesfall')
    await expect(page).toHaveURL(/\/$/)
    await expect(
      page.getByRole('heading', { name: 'Hans Weber · Trauerfall seit 15. März 2024' }),
    ).toBeVisible()
  })

  /**
   * Wie viele Aufgaben der Rechtskatalog mitgebracht hat (§8).
   *
   * Gezählt statt aus dem Katalog importiert: Die Zahl ändert sich mit jedem
   * `npm run import:content`, und dieser Test soll davon nichts wissen.
   */
  let ausDemKatalog = 0

  await test.step('der neue Fall bringt die Aufgaben der Juristinnen mit', async () => {
    // §8: „Ein neu angelegter Trauerfall ist nicht mehr leer." Instanziiert hat
    // ihn die Fallanlage, verschlüsselt wie jedes andere Item.
    await page.getByRole('link', { name: 'Alle Aufgaben' }).click()

    await expect(page).toHaveURL(/\/alle$/)
    await expect(page.getByRole('heading', { name: 'Alle Aufgaben' })).toBeVisible()

    await expect(
      page.getByRole('checkbox', { name: 'Ausschlagung der Erbschaft prüfen' }),
    ).toBeVisible()

    ausDemKatalog = await page.getByRole('checkbox').count()
    expect(ausDemKatalog).toBeGreaterThan(1)

    // Und beim Neuladen steht dieselbe Liste: kein zweiter Satz, keine
    // Duplikate. Die IDs sind deterministisch, das Anlegen ist idempotent (§8).
    await gotoVerlaesslich(page, '/alle')
    await expect(page.getByRole('checkbox')).toHaveCount(ausDemKatalog)
  })

  await test.step('legt im Tab "Alle" eine Aufgabe an', async () => {
    await page.getByLabel('Neue Aufgabe').fill('Sterbeurkunde beantragen')
    await page.getByRole('button', { name: 'Aufgabe hinzufügen' }).click()

    await expect(page.getByRole('checkbox', { name: 'Sterbeurkunde beantragen' })).toBeVisible()

    await page.getByLabel('Neue Aufgabe').fill('Konten kündigen')
    await page.getByRole('button', { name: 'Aufgabe hinzufügen' }).click()

    await expect(page.getByRole('checkbox')).toHaveCount(ausDemKatalog + 2)
  })

  await test.step('die Reihenfolge bleibt, wenn eine Aufgabe geändert wird', async () => {
    /*
     * `seq` steigt bei jedem Schreibvorgang (§4) und taugt deshalb nicht als
     * Anzeigereihenfolge — danach sortiert wanderte die gerade abgehakte
     * Aufgabe ans Ende. Sortiert wird über die UUIDv7 der Zeile.
     */
    const abgehakt = gespeichert(page, 'PATCH')
    await page.getByRole('checkbox', { name: 'Sterbeurkunde beantragen' }).check()
    await abgehakt

    await gotoVerlaesslich(page, '/alle')

    await expect(page.getByRole('checkbox')).toHaveCount(ausDemKatalog + 2)

    // Hinter dem Katalog: Der steht in der Reihenfolge der Juristinnen vorn
    // (§8), selbst angelegte Aufgaben folgen in ihrer Anlagereihenfolge.
    await expect(page.getByRole('listitem').nth(ausDemKatalog)).toContainText(
      'Sterbeurkunde beantragen',
    )
    await expect(page.getByRole('listitem').last()).toContainText('Konten kündigen')

    // Aufgeräumt, damit die folgenden Schritte wieder mit genau einer selbst
    // angelegten Aufgabe arbeiten.
    await page.getByRole('button', { name: /^Löschen.*Konten kündigen/ }).click()
    await page.getByRole('button', { name: 'Endgültig löschen' }).click()
    await expect(page.getByRole('checkbox')).toHaveCount(ausDemKatalog + 1)
  })

  await test.step('nimmt das Haekchen zurueck und setzt es wieder; beides ueberlebt das Neuladen', async () => {
    /*
     * Der eigentliche Punkt des Slices: Der Stand liegt nicht im Speicher des
     * Tabs, sondern verschlüsselt auf dem Server. Neu geladen wird über eine
     * echte Navigation und nicht über `page.reload()` — dieselbe Absicherung
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
     * geändert hat, holt danach das Delta — die Klingel trägt keine Nutzlast.
     *
     * **Zweiter Tab und nicht zweiter Browser.** Beide Seiten teilen sich den
     * Kontext und damit IndexedDB, also auch die Geräteidentität aus §3.1. Ein
     * eigener Kontext wäre ein zweites Gerät, für das kein Wrap dieses Falls
     * vorliegt; es sähe den Fall gesperrt. Was zwei wirklich getrennte Geräte
     * angeht, hängt an der Kopplung und gehört dorthin. Der Weg, um den es hier
     * geht — Änderung → Trigger → Klingel → Delta → Bildschirm — ist derselbe.
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
    await expect(page.getByRole('checkbox')).toHaveCount(ausDemKatalog)
  })

  await test.step('eine gelöschte Katalogaufgabe kommt nicht wieder', async () => {
    /*
     * §8: Der Katalog initialisiert, mehr nicht — danach ist es ein
     * gewöhnliches Item. Der Tombstone steht im Bestand (§5), und die
     * Instanziierung beim nächsten Laden übergeht ihn. Käme die Aufgabe wieder,
     * wäre „löschen" bei genau diesen Aufgaben eine Lüge.
     */
    const geloescht = gespeichert(page, 'PATCH')
    await page.getByRole('button', { name: /^Löschen.*Ausschlagung der Erbschaft prüfen/ }).click()
    await page.getByRole('button', { name: 'Endgültig löschen' }).click()
    await geloescht

    await gotoVerlaesslich(page, '/alle')

    await expect(
      page.getByRole('checkbox', { name: 'Ausschlagung der Erbschaft prüfen' }),
    ).toHaveCount(0)
    await expect(page.getByRole('checkbox')).toHaveCount(ausDemKatalog - 1)
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
