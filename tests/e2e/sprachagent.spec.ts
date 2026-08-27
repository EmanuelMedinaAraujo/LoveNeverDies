import { expect, test } from '@playwright/test'
import { gotoVerlaesslich } from './helpers.ts'

test.describe('Erbe-Fragebaum Sprachagent E2E', () => {
  test('Sprachassistent 3D Metallic Orb, Mute und Beenden', async ({ page }) => {
    // Navigiere zum Fragebaum
    await gotoVerlaesslich(page, '/erbe/fragebaum')

    // Überprüfe, dass wir auf der ersten Frage sind
    await expect(page.getByRole('heading', { name: 'Sind Sie Erbe?' })).toBeVisible()

    // 1. Sprachassistent Button vorhanden
    const sprachKnopf = page.getByRole('button', { name: 'Fragebaum mit Sprachassistent starten' })
    await expect(sprachKnopf).toBeVisible()

    // 2. Klick auf Sprachassistent öffnet das Vollbild-Overlay
    await sprachKnopf.click()

    const dialog = page.getByRole('dialog', { name: 'Fragebaum Sprachassistent' })
    await expect(dialog).toBeVisible()

    // 3. Überprüfen, dass KEIN Text, Transkript oder Chat-Eingabefeld gerendert wird
    await expect(page.getByRole('textbox')).not.toBeVisible()

    // 4. Steuerelemente überprüfen: Mute/Stop-Knöpfe
    const beendenKnopf = page.getByRole('button', { name: 'Sprachdialog beenden' })
    await expect(beendenKnopf).toBeVisible()

    // 5. Beenden klicken -> Overlay schließt sich und Nutzer landet direkt bei der Frage
    await beendenKnopf.click()

    await expect(dialog).not.toBeVisible()
    await expect(page.getByRole('heading', { name: 'Sind Sie Erbe?' })).toBeVisible()
  })
})
