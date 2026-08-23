import { expect, test } from '@playwright/test'
import { gotoVerlaesslich } from './helpers.ts'

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

  await test.step('legt im Tab "Alle" eine Aufgabe an', async () => {
    await page.getByRole('link', { name: 'Alle Aufgaben' }).click()

    await expect(page).toHaveURL(/\/alle$/)
    await expect(page.getByRole('heading', { name: 'Alle Aufgaben' })).toBeVisible()
    await expect(page.getByText('Hier ist noch nichts')).toBeVisible()

    await page.getByLabel('Neue Aufgabe').fill('Sterbeurkunde beantragen')
    await page.getByRole('button', { name: 'Aufgabe hinzufügen' }).click()

    await expect(page.getByRole('checkbox', { name: 'Sterbeurkunde beantragen' })).toBeVisible()

    await page.getByLabel('Neue Aufgabe').fill('Konten kündigen')
    await page.getByRole('button', { name: 'Aufgabe hinzufügen' }).click()

    await expect(page.getByRole('checkbox')).toHaveCount(2)
  })

  await test.step('die Reihenfolge bleibt, wenn eine Aufgabe geändert wird', async () => {
    /*
     * `seq` steigt bei jedem Schreibvorgang (§4) und taugt deshalb nicht als
     * Anzeigereihenfolge — danach sortiert wanderte die gerade abgehakte
     * Aufgabe ans Ende. Sortiert wird über die UUIDv7 der Zeile.
     */
    await page.getByRole('checkbox', { name: 'Sterbeurkunde beantragen' }).check()

    await gotoVerlaesslich(page, '/alle')

    await expect(page.getByRole('checkbox')).toHaveCount(2)
    await expect(page.getByRole('listitem').first()).toContainText('Sterbeurkunde beantragen')
    await expect(page.getByRole('listitem').last()).toContainText('Konten kündigen')

    // Aufgeräumt, damit die folgenden Schritte wieder mit genau einer Aufgabe
    // arbeiten.
    await page.getByRole('button', { name: /^Löschen.*Konten kündigen/ }).click()
    await page.getByRole('button', { name: 'Endgültig löschen' }).click()
    await expect(page.getByRole('checkbox')).toHaveCount(1)
  })

  await test.step('hakt sie ab, und nach dem Neuladen ist sie noch abgehakt', async () => {
    /*
     * Der eigentliche Punkt des Slices: Der Stand liegt nicht im Speicher des
     * Tabs, sondern verschlüsselt auf dem Server. Neu geladen wird über eine
     * echte Navigation und nicht über `page.reload()` — dieselbe Absicherung
     * gegen den JWT-Jitter aus helpers.ts greift dann mit.
     */
    await page.getByRole('checkbox', { name: 'Sterbeurkunde beantragen' }).check()
    await expect(page.getByRole('checkbox', { name: 'Sterbeurkunde beantragen' })).toBeChecked()

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

  await test.step('löscht sie nach einer Rückfrage, und sie bleibt fort', async () => {
    await page.getByRole('button', { name: /^Löschen.*Sterbeurkunde abholen/ }).click()

    // §5: Löschen gewinnt endgültig. Das steht vor der Aktion auf dem Schirm.
    await expect(page.getByText('kommen nicht zurück')).toBeVisible()
    await page.getByRole('button', { name: 'Endgültig löschen' }).click()

    await expect(page.getByText('Hier ist noch nichts')).toBeVisible()

    await gotoVerlaesslich(page, '/alle')
    await expect(page.getByText('Hier ist noch nichts')).toBeVisible()
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
