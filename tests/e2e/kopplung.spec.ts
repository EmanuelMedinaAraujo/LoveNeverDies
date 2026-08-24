import { devices, expect, test, type Browser, type Locator, type Page } from '@playwright/test'
import { clerk } from '@clerk/testing/playwright'
import { kopplungsperson, type Kopplungsrolle } from './nutzer.ts'
import { gotoVerlaesslich } from './helpers.ts'

/**
 * Die Kopplung aus DESIGN.md §6, von Hand nicht sinnvoll zu prüfen: Sie
 * braucht zwei Menschen, die gleichzeitig auf zwei Geräte schauen und einen
 * Prüfcode vergleichen. Genau das macht dieser Test — nur eben in zwei
 * Browserkontexten statt in zwei Wohnzimmern.
 *
 * **Warum eigene Kontexte und nicht Tabs.** Die Geräteidentität liegt in
 * IndexedDB (core/crypto/keystore.ts), und die teilen sich zwei Tabs desselben
 * Kontexts. Zwei Tabs wären ein Gerät, und die Kopplung hätte nichts zu tun.
 * Ein eigener Kontext ist ein eigenes Gerät — das ist hier der ganze Punkt.
 *
 * **Warum eigene Personen** (tests/e2e/nutzer.ts): Die Kopplung verändert ihre
 * Teilnehmer bleibend. Wer beitritt, hat danach einen Fall, und
 * fall-lebenszyklus.spec.ts setzt bei seinen Personen voraus, dass sie keinen
 * haben.
 *
 * **Warum überall iPhone 13.** Mobile-first (README.md): Der Kopplungscode und
 * der Prüfcode stehen absichtlich groß auf dem Schirm, weil sie am Telefon
 * vorgelesen werden. Ob das auf 390 px auch wirklich lesbar bleibt, prüft nur
 * ein Test, der auf 390 px läuft. `browser.newContext()` erbt das `use` des
 * Projekts nicht, deshalb steht das Gerät hier ausdrücklich.
 */

/*
 * Die Kontextoptionen von `devices['iPhone 13']`, einzeln aufgezählt.
 *
 * Nicht der ganze Eintrag: Der trägt zusätzlich `defaultBrowserType`, und das
 * ist eine Angabe für den Launcher und keine Kontextoption — `newContext`
 * wiese sie zurück. Welche Engine startet, steht ohnehin im Projekt.
 */
const { viewport, userAgent, deviceScaleFactor, isMobile, hasTouch } = devices['iPhone 13']
const HANDY = { viewport, userAgent, deviceScaleFactor, isMobile, hasTouch }

/**
 * Ein frisches Gerät mit angemeldeter Person, bereit für §6.
 *
 * Gewartet wird bis zur Geräteliste in Profil und nicht nur bis zur
 * Anmeldung: Die Geräteanmeldung läuft still im Hintergrund (§7) und muss
 * durch sein, bevor irgendetwas einen Kopplungscode anfordert —
 * `erzeuge_kopplungscode` verlangt ein Gerät, das der Person gehört.
 */
async function neuesGeraet(browser: Browser, rolle: Kopplungsrolle): Promise<Page> {
  const kontext = await browser.newContext(HANDY)
  const seite = await kontext.newPage()

  await seite.goto('/')
  await clerk.signIn({ page: seite, emailAddress: kopplungsperson(rolle) })

  await gotoVerlaesslich(seite, '/profil')
  await expect(seite.getByRole('listitem').filter({ hasText: 'Dieses Gerät' })).toBeVisible()

  return seite
}

/**
 * Der Wert unter einer Überschrift — der erste Absatz danach.
 *
 * Über die Überschrift und nicht über die CSS-Klasse: Die Klassennamen kommen
 * aus CSS-Modulen und tragen im Build einen Hash, an dem sich nichts festmachen
 * lässt. Die Überschriften stehen dagegen so im Screen, wie die Person sie
 * liest.
 */
function wertUnter(seite: Page, ueberschrift: string): Locator {
  return seite
    .getByRole('heading', { name: ueberschrift, exact: true })
    .locator('xpath=following-sibling::p[1]')
}

/**
 * Die sichtbaren Ziffern eines Prüfcodes, „537 383".
 *
 * Ausdrücklich der `aria-hidden`-Teil: Daneben steht dieselbe Zahl noch einmal
 * für Screenreader, Ziffer für Ziffer getrennt (`nur-vorlesen`). `textContent`
 * des ganzen Absatzes lieferte beides hintereinander.
 */
async function pruefcodeVon(seite: Page, ueberschrift: string): Promise<string> {
  const sichtbar = wertUnter(seite, ueberschrift).locator('span[aria-hidden="true"]')

  await expect(sichtbar).toHaveText(/^\d{3} \d{3}$/)

  return (await sichtbar.textContent()) ?? ''
}

/** Legt einen Trauerfall an und wartet, bis er auf dem Startscreen steht. */
async function trauerfallAnlegen(seite: Page, name: string, datum: string): Promise<void> {
  await gotoVerlaesslich(seite, '/todesfall')

  await seite.getByLabel('Name der verstorbenen Person').fill(name)
  await seite.getByLabel('Sterbedatum').fill(datum)
  await seite.getByRole('button', { name: 'Fall anlegen' }).click()

  await expect(seite).toHaveURL(/\/$/)
  await expect(seite.getByRole('heading', { name: new RegExp(name) })).toBeVisible()
}

/**
 * Die Einlösung von §6, Schritt 4 bis 6, auf der einladenden Seite: Code
 * eingeben, Prüfcode vergleichen, bestätigen.
 *
 * Der Vergleich ist keine Formalie, sondern der einzige Schutz gegen einen
 * Server, der beim Rendezvous fremde Schlüssel unterschiebt (§3.6) — deshalb
 * bekommt diese Funktion den Prüfcode der Gegenseite herein und prüft ihn,
 * bevor sie klickt. Genau so soll es auch am Telefon laufen.
 */
async function einloesenUndBestaetigen(
  seite: Page,
  code: string,
  erwartet: { ueberschrift: string; name: string; email: string; pruefcode: string },
): Promise<void> {
  await gotoVerlaesslich(seite, '/koppeln')

  await seite.getByLabel('Kopplungscode').fill(code)
  await seite.getByRole('button', { name: 'Weiter' }).click()

  await expect(seite.getByRole('heading', { name: erwartet.ueberschrift })).toBeVisible()

  await expect(wertUnter(seite, 'Wer da ist')).toHaveText(erwartet.name)
  await expect(seite.getByText(erwartet.email)).toBeVisible()

  expect(await pruefcodeVon(seite, 'Prüfcode')).toBe(erwartet.pruefcode)

  await seite.getByRole('button', { name: 'Prüfcode stimmt überein — bestätigen' }).click()
}

test('Angehörige einladen: beide Seiten sehen denselben Prüfcode', async ({ browser }) => {
  /*
   * Drei Geräte, jedes mit eigener Schlüsselerzeugung (ML-KEM-768 + ML-DSA-65),
   * dazu zwei vollständige Kopplungen und ein Fall. Die Voreinstellung von 30
   * Sekunden reicht dafür auf keiner Maschine.
   */
  test.setTimeout(180_000)

  const anna = await neuesGeraet(browser, 'a')
  const bernd = await neuesGeraet(browser, 'b')

  try {
    await test.step('Anna legt einen Fall mit einer Aufgabe an', async () => {
      await trauerfallAnlegen(anna, 'Margarete Vogt', '2024-06-02')

      await anna.getByRole('link', { name: 'Alle Aufgaben' }).click()
      await anna.getByLabel('Neue Aufgabe').fill('Grabstein aussuchen')
      await anna.getByRole('button', { name: 'Aufgabe hinzufügen' }).click()

      await expect(anna.getByRole('checkbox', { name: 'Grabstein aussuchen' })).toBeVisible()
    })

    let code = ''
    let pruefcode = ''

    await test.step('Bernd hat keinen Fall und holt sich einen Kopplungscode', async () => {
      await gotoVerlaesslich(bernd, '/')
      await expect(bernd.getByRole('heading', { name: 'Willkommen' })).toBeVisible()

      await bernd.getByRole('button', { name: 'Ich wurde eingeladen' }).click()
      await expect(bernd).toHaveURL(/\/beitreten$/)

      code = (await wertUnter(bernd, 'Ihr Kopplungscode').textContent()) ?? ''

      // §6: acht Zeichen, und O/0/I/1 kommen nicht vor — verwechselbar am
      // Telefon. Angezeigt wird in zwei Vierergruppen.
      expect(code).toMatch(/^[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}$/)

      pruefcode = await pruefcodeVon(bernd, 'Ihr Prüfcode')

      await expect(bernd.getByText('Warten auf die Bestätigung…')).toBeVisible()
    })

    await test.step('Anna gibt den Code ein und sieht Bernd und denselben Prüfcode', async () => {
      await einloesenUndBestaetigen(anna, code, {
        ueberschrift: 'Zum Fall hinzufügen?',
        name: 'Bernd Claasen',
        email: kopplungsperson('b'),
        pruefcode,
      })
    })

    await test.step('Bernd wird freigeschaltet, ohne neu zu laden', async () => {
      /*
       * Der Kern von §6, Schritt 7: „schaltet innerhalb von Sekunden frei". Es
       * steht bewusst kein `goto` und kein `reload` dazwischen — die Wache aus
       * useKopplung.ts merkt es von selbst und navigiert danach auf `/`.
       */
      await expect(bernd.getByText('Sie gehören jetzt zum Fall.')).toBeVisible({ timeout: 30_000 })

      await expect(bernd).toHaveURL(/\/$/, { timeout: 30_000 })
      await expect(bernd.getByRole('heading', { name: /Margarete Vogt/ })).toBeVisible()
    })

    await test.step('Bernd liest die Aufgaben entschlüsselt', async () => {
      /*
       * Der Beweis, dass nicht nur die Mitgliedschaft, sondern der Schlüssel
       * angekommen ist: Der Titel liegt verschlüsselt auf dem Server, und ohne
       * den Fallschlüssel stünde hier „Für dieses Gerät liegt noch kein
       * Schlüssel zu diesem Fall vor".
       */
      await bernd.getByRole('link', { name: 'Alle Aufgaben' }).click()

      await expect(bernd.getByRole('checkbox', { name: 'Grabstein aussuchen' })).toBeVisible()
    })

    await test.step('auch Bernd darf einladen, obwohl er den Fall nicht angelegt hat', async () => {
      /*
       * §6: „Jedes Mitglied darf einladen." Nicht nur, wer den Fall angelegt
       * hat — sonst hinge eine Familie an einer einzigen Person.
       */
      const doris = await neuesGeraet(browser, 'd')

      try {
        await gotoVerlaesslich(doris, '/beitreten')

        const dorisCode = (await wertUnter(doris, 'Ihr Kopplungscode').textContent()) ?? ''
        const dorisPruefcode = await pruefcodeVon(doris, 'Ihr Prüfcode')

        await einloesenUndBestaetigen(bernd, dorisCode, {
          ueberschrift: 'Zum Fall hinzufügen?',
          name: 'Doris Engel',
          email: kopplungsperson('d'),
          pruefcode: dorisPruefcode,
        })

        await expect(doris.getByText('Sie gehören jetzt zum Fall.')).toBeVisible({
          timeout: 30_000,
        })
        await expect(doris.getByRole('heading', { name: /Margarete Vogt/ })).toBeVisible({
          timeout: 30_000,
        })
      } finally {
        await doris.context().close()
      }
    })
  } finally {
    await anna.context().close()
    await bernd.context().close()
  }
})

test('zweites Gerät freischalten', async ({ browser }) => {
  test.setTimeout(180_000)

  const handy = await neuesGeraet(browser, 'c')
  const tablet = await browser.newContext(HANDY).then((kontext) => kontext.newPage())

  try {
    await test.step('das erste Gerät legt einen Fall an', async () => {
      await trauerfallAnlegen(handy, 'Friedrich Kaiser', '2023-11-20')
    })

    await test.step('dieselbe Person auf einem zweiten Gerät sieht den Fall gesperrt', async () => {
      /*
       * Eigener Kontext, also eigene IndexedDB und damit ein zweiter
       * Geräteschlüssel — für den liegt kein Wrap dieses Falls vor. Die
       * Mitgliedschaft ist da, der Schlüssel nicht: genau die Lage, die §3.6
       * mit „Freigabe nötig" benennt.
       */
      await tablet.goto('/')
      await clerk.signIn({ page: tablet, emailAddress: kopplungsperson('c') })

      await gotoVerlaesslich(tablet, '/profil')
      await expect(tablet.getByText('Freigabe nötig')).toBeVisible()
    })

    let code = ''
    let pruefcode = ''

    await test.step('das zweite Gerät holt sich einen Code über Profil', async () => {
      await tablet.getByRole('link', { name: 'Dieses Gerät freischalten lassen' }).click()

      await expect(tablet).toHaveURL(/\/geraet-freischalten$/)
      await expect(tablet.getByRole('heading', { name: 'Dieses Gerät freischalten' })).toBeVisible()

      code = (await wertUnter(tablet, 'Ihr Kopplungscode').textContent()) ?? ''
      pruefcode = await pruefcodeVon(tablet, 'Ihr Prüfcode')
    })

    await test.step('das erste Gerät gibt frei', async () => {
      /*
       * Derselbe Screen wie beim Beitritt, aber mit der Frage „Gerät
       * freischalten?" — welcher Zweck gilt, sagt der Code und nicht die
       * Person, die ihn eingibt (Koppeln.tsx).
       */
      await einloesenUndBestaetigen(handy, code, {
        ueberschrift: 'Gerät freischalten?',
        name: 'Clara Dietrich',
        email: kopplungsperson('c'),
        pruefcode,
      })
    })

    await test.step('das zweite Gerät kann den Fall danach lesen', async () => {
      await expect(tablet.getByText('Dieses Gerät ist freigeschaltet.')).toBeVisible({
        timeout: 30_000,
      })

      await expect(tablet.getByRole('heading', { name: /Friedrich Kaiser/ })).toBeVisible({
        timeout: 30_000,
      })

      // Und die Freigabe ist damit erledigt — der Hinweis aus Profil ist fort.
      await gotoVerlaesslich(tablet, '/profil')
      await expect(tablet.getByText('Freigabe nötig')).toBeHidden()
    })
  } finally {
    await handy.context().close()
    await tablet.context().close()
  }
})
