import { expect, test } from '@playwright/test'
import { gotoVerlaesslich } from './helpers.ts'

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

  const zeile = page.getByRole('listitem').filter({ hasText: 'Dieses Gerät' })
  await expect(zeile).toBeVisible()
  await expect(zeile.getByText('Prüfcode')).toBeVisible()

  await zeile.getByRole('button', { name: /umbenennen/i }).click()

  const eingabe = zeile.getByLabel('Name dieses Geräts')
  await eingabe.fill('Mein Testgerät')
  await zeile.getByRole('button', { name: 'Speichern' }).click()

  await expect(zeile.getByText('Mein Testgerät', { exact: true })).toBeVisible()
})
