import { expect, test } from '@playwright/test'
import { gotoVerlaesslich, zeilen } from './helpers.ts'

/**
 * Profil → Geräte (DESIGN.md §3.6, §7): unabhängig davon, ob schon ein Fall
 * existiert, deshalb keine Reihenfolge zu tests/e2e/fall-lebenszyklus.spec.ts.
 * Was hier zählt, ist ausschließlich das eine Testgerät aus auth.setup.ts.
 */

test('zeigt die eigene Person', async ({ page }) => {
  await gotoVerlaesslich(page, '/profil')

  await expect(page.getByRole('heading', { name: 'Sie' })).toBeVisible()
})

test('zeigt dieses Gerät mit Prüfcode und kann es umbenennen', async ({ page }) => {
  await gotoVerlaesslich(page, '/profil')

  /*
   * "Dieses Gerät · Prüfcode" und nicht bloss "Dieses Gerät": Unter den
   * Geräten steht auch der Weg "Dieses Gerät freischalten lassen", und jeder
   * frühere Testlauf hat eine weitere Zeile hinterlassen — jeder
   * Browserkontext ist ein eigenes Gerät (§3.1). Eindeutig ist nur die eine
   * Zeile, die sich selbst meint und ihren Prüfcode zeigt.
   */
  const zeile = zeilen(page).filter({ hasText: 'Dieses Gerät · Prüfcode' })
  await expect(zeile).toBeVisible()
  await expect(zeile).toContainText(/Prüfcode \d{3} \d{3}/)

  await zeile.getByRole('button', { name: /umbenennen/i }).click()

  /*
   * Ab hier nicht mehr über `zeile`: Die Zeile tauscht ihren Inhalt gegen das
   * Eingabefeld, und mit ihm verschwindet das "Dieses Gerät · Prüfcode", an
   * dem der Filter hängt. Offen ist ohnehin genau eine Zeile.
   */
  await page.getByLabel('Name dieses Geräts').fill('Mein Testgerät')
  await page.getByRole('button', { name: 'Speichern' }).click()

  await expect(zeile).toContainText('Mein Testgerät')
})
