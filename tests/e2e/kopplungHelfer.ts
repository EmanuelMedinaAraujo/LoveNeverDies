import { devices, expect, type Locator, type Page } from '@playwright/test'

/**
 * Was `kopplung.spec.ts` und `tresor-todesfall.spec.ts` sich teilen.
 *
 * Beide brauchen zwei Menschen gleichzeitig auf zwei Geraeten und beide gehen
 * durch die Kopplung aus §6, um dorthin zu kommen. Zweimal geschrieben waeren
 * es zwei Fassungen desselben Ablaufs, die sich mit der Zeit unterscheiden --
 * und der Unterschied faellt dann als Fehlschlag in dem Spec auf, das gar
 * nichts mit der Kopplung zu tun hat.
 */

/*
 * Die Kontextoptionen von `devices['iPhone 13']`, einzeln aufgezaehlt.
 *
 * Nicht der ganze Eintrag: Der traegt zusaetzlich `defaultBrowserType`, und das
 * ist eine Angabe fuer den Launcher und keine Kontextoption -- `newContext`
 * wiese sie zurueck. Welche Engine startet, steht im Projekt.
 */
const { viewport, userAgent, deviceScaleFactor, isMobile, hasTouch } = devices['iPhone 13']
export const HANDY = { viewport, userAgent, deviceScaleFactor, isMobile, hasTouch }

/**
 * Der Wert unter einer Ueberschrift: der erste Absatz danach.
 *
 * Ueber die Ueberschrift und nicht ueber die CSS-Klasse: Die Klassennamen
 * kommen aus CSS-Modulen und tragen im Build einen Hash, an dem sich nichts
 * festmachen laesst. Die Ueberschriften stehen dagegen so im Screen, wie die
 * Person sie liest.
 */
export function wertUnter(seite: Page, ueberschrift: string): Locator {
  return seite
    .getByRole('heading', { name: ueberschrift, exact: true })
    .locator('xpath=following-sibling::p[1]')
}

/**
 * Die sichtbaren Ziffern eines Pruefcodes, "537 383".
 *
 * Ausdruecklich der `aria-hidden`-Teil: Daneben steht dieselbe Zahl noch einmal
 * fuer Screenreader, Ziffer fuer Ziffer getrennt (`nur-vorlesen`).
 * `textContent` des ganzen Absatzes lieferte beides hintereinander.
 */
export async function pruefcodeVon(seite: Page, ueberschrift: string): Promise<string> {
  const sichtbar = wertUnter(seite, ueberschrift).locator('span[aria-hidden="true"]')

  await expect(sichtbar).toHaveText(/^\d{3} \d{3}$/)

  return (await sichtbar.textContent()) ?? ''
}

/**
 * Die Einloesung von §6, Schritt 4 bis 6, auf der einladenden Seite: Code
 * eingeben, Pruefcode vergleichen, bestaetigen.
 *
 * Der Vergleich ist keine Formalie, sondern der einzige Schutz gegen einen
 * Server, der beim Rendezvous fremde Schluessel unterschiebt (§3.6). Deshalb
 * bekommt diese Funktion den Pruefcode der Gegenseite herein und prueft ihn,
 * bevor sie klickt. Genau so soll es auch am Telefon laufen.
 */
export async function einloesenUndBestaetigen(
  seite: Page,
  code: string,
  erwartet: { ueberschrift: string; name: string; email: string; pruefcode: string },
): Promise<void> {
  await seite.getByLabel('Kopplungscode').fill(code)
  await seite.getByRole('button', { name: 'Weiter' }).click()

  await expect(seite.getByRole('heading', { name: erwartet.ueberschrift })).toBeVisible()

  await expect(wertUnter(seite, 'Wer da ist')).toHaveText(erwartet.name)
  await expect(seite.getByText(erwartet.email)).toBeVisible()

  expect(await pruefcodeVon(seite, 'Prüfcode')).toBe(erwartet.pruefcode)

  await seite.getByRole('button', { name: 'Prüfcode stimmt überein — bestätigen' }).click()
}
