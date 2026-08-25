import { expect, test, type Browser, type Page } from '@playwright/test'
import { clerk, setupClerkTestingToken } from '@clerk/testing/playwright'
import { kopplungsperson, type Kopplungsrolle } from './nutzer.ts'
import { ansichtErweitert, gotoVerlaesslich, zeilen } from './helpers.ts'
import {
  HANDY,
  einloesenUndBestaetigen,
  pruefcodeVon,
  wertUnter,
} from './kopplungHelfer.ts'

/**
 * Die Kopplung aus DESIGN.md §6, von Hand nicht sinnvoll zu prüfen: Sie
 * braucht zwei Menschen, die gleichzeitig auf zwei Geräte schauen und einen
 * Prüfcode vergleichen. Genau das macht dieser Test, nur eben in zwei
 * Browserkontexten statt in zwei Wohnzimmern.
 *
 * Warum eigene Kontexte und nicht Tabs: Die Geräteidentität liegt in
 * IndexedDB (core/crypto/keystore.ts), und die teilen sich zwei Tabs desselben
 * Kontexts. Zwei Tabs wären ein Gerät, und die Kopplung hätte nichts zu tun.
 * Ein eigener Kontext ist ein eigenes Gerät: Das ist hier der ganze Punkt.
 *
 * Warum eigene Personen (tests/e2e/nutzer.ts): Die Kopplung verändert ihre
 * Teilnehmer bleibend. Wer beitritt, hat danach einen Fall, und
 * fall-lebenszyklus.spec.ts setzt bei seinen Personen voraus, dass sie keinen
 * haben.
 *
 * Warum überall iPhone 13. Mobile-first (README.md): Der Kopplungscode und
 * der Prüfcode stehen absichtlich groß auf dem Schirm, weil sie am Telefon
 * vorgelesen werden. Ob das auf 390 px auch wirklich lesbar bleibt, prüft nur
 * ein Test, der auf 390 px läuft. `browser.newContext()` erbt das `use` des
 * Projekts nicht, deshalb steht das Gerät hier ausdrücklich.
 */

/**
 * Ein frisches Gerät mit angemeldeter Person, bereit für §6.
 *
 * Gewartet wird bis zur Geräteliste in Profil und nicht nur bis zur
 * Anmeldung: Die Geräteanmeldung läuft still im Hintergrund (§7) und muss
 * durch sein, bevor irgendetwas einen Kopplungscode anfordert:
 * `erzeuge_kopplungscode` verlangt ein Gerät, das der Person gehört.
 */
async function neuesGeraet(browser: Browser, rolle: Kopplungsrolle): Promise<Page> {
  const kontext = await browser.newContext(HANDY)
  await ansichtErweitert(kontext)

  const seite = await kontext.newPage()

  await setupClerkTestingToken({ page: seite })
  await seite.goto('/')
  await clerk.signIn({ page: seite, emailAddress: kopplungsperson(rolle) })

  await gotoVerlaesslich(seite, '/profil')
  await expect(zeilen(seite).filter({ hasText: 'Dieses Gerät · Prüfcode' })).toBeVisible()

  return seite
}

/**
 * Der Startscreen zeigt diesen Fall (§7).
 *
 * Die H1 heißt seit dem Start-Screen "Meine Aufgaben" und nicht mehr nach der
 * verstorbenen Person; um wessen Fall es geht, steht als Beschriftung darunter
 * (§2). Geprüft wird beides: Die Überschrift sagt, dass der Screen steht, der
 * Name sagt, dass es der richtige Fall ist. Für die Kopplung zählt der Name:
 * Wer beitritt, muss hinterher *diesen* Fall sehen.
 */
async function startscreenZeigt(seite: Page, name: string): Promise<void> {
  await expect(seite.getByRole('heading', { name: 'Meine Aufgaben', level: 1 })).toBeVisible({
    timeout: 30_000,
  })
  await expect(seite.getByText(new RegExp(name)).first()).toBeVisible({ timeout: 30_000 })
}

/** Legt einen Trauerfall an und wartet, bis er auf dem Startscreen steht. */
async function trauerfallAnlegen(seite: Page, name: string, datum: string): Promise<void> {
  await gotoVerlaesslich(seite, '/todesfall')

  await seite.getByLabel('Name der verstorbenen Person').fill(name)
  await seite.getByLabel('Sterbedatum').fill(datum)
  await seite.getByRole('button', { name: 'Fall anlegen' }).click()

  await expect(seite).toHaveURL(/\/$/)
  await startscreenZeigt(seite, name)
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

      await anna.getByRole('navigation', { name: 'Hauptbereiche' }).getByRole('link', { name: 'Alle' }).click()
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

      // §6: acht Zeichen, und O/0/I/1 kommen nicht vor, da verwechselbar am
      // Telefon. Angezeigt wird in zwei Vierergruppen.
      expect(code).toMatch(/^[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}$/)

      pruefcode = await pruefcodeVon(bernd, 'Ihr Prüfcode')

      await expect(bernd.getByText('Warten auf die Bestätigung…')).toBeVisible()
    })

    await test.step('Anna gibt den Code ein und sieht Bernd und denselben Prüfcode', async () => {
      await gotoVerlaesslich(anna, '/koppeln')
      await einloesenUndBestaetigen(anna, code, {
        ueberschrift: 'Zum Fall hinzufügen?',
        name: 'Bernd Claasen',
        email: kopplungsperson('b'),
        pruefcode,
      })
    })

    await test.step('Bernd wird freigeschaltet, ohne neu zu laden', async () => {
      /*
       * Der Kern von §6, Schritt 7: "schaltet innerhalb von Sekunden frei". Es
       * steht bewusst kein `goto` und kein `reload` dazwischen. Die Wache aus
       * useKopplung.ts merkt es von selbst und navigiert danach auf `/`.
       */
      await expect(bernd.getByText('Sie gehören jetzt zum Fall.')).toBeVisible({ timeout: 30_000 })

      await expect(bernd).toHaveURL(/\/$/, { timeout: 30_000 })
      await startscreenZeigt(bernd, 'Margarete Vogt')
    })

    await test.step('Bernd liest die Aufgaben entschlüsselt', async () => {
      /*
       * Der Beweis, dass nicht nur die Mitgliedschaft, sondern der Schlüssel
       * angekommen ist: Der Titel liegt verschlüsselt auf dem Server, und ohne
       * den Fallschlüssel stünde hier "Für dieses Gerät liegt noch kein
       * Schlüssel zu diesem Fall vor".
       */
      await bernd.getByRole('navigation', { name: 'Hauptbereiche' }).getByRole('link', { name: 'Alle' }).click()

      await expect(bernd.getByRole('checkbox', { name: 'Grabstein aussuchen' })).toBeVisible()
    })

    await test.step('auch Bernd darf einladen, obwohl er den Fall nicht angelegt hat', async () => {
      /*
       * §6: "Jedes Mitglied darf einladen." Nicht nur, wer den Fall angelegt
       * hat. Sonst hinge eine Familie an einer einzigen Person.
       */
      const doris = await neuesGeraet(browser, 'd')

      try {
        await gotoVerlaesslich(doris, '/beitreten')

        const dorisCode = (await wertUnter(doris, 'Ihr Kopplungscode').textContent()) ?? ''
        const dorisPruefcode = await pruefcodeVon(doris, 'Ihr Prüfcode')

        await gotoVerlaesslich(bernd, '/koppeln')

        await einloesenUndBestaetigen(bernd, dorisCode, {
          ueberschrift: 'Zum Fall hinzufügen?',
          name: 'Doris Engel',
          email: kopplungsperson('d'),
          pruefcode: dorisPruefcode,
        })

        await expect(doris.getByText('Sie gehören jetzt zum Fall.')).toBeVisible({
          timeout: 30_000,
        })
        await startscreenZeigt(doris, 'Margarete Vogt')
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
  const tablet = await browser.newContext(HANDY).then(async (kontext) => {
    await ansichtErweitert(kontext)
    return kontext.newPage()
  })

  try {
    await test.step('das erste Gerät legt einen Fall an', async () => {
      await trauerfallAnlegen(handy, 'Friedrich Kaiser', '2023-11-20')
    })

    await test.step('dieselbe Person auf einem zweiten Gerät sieht den Fall gesperrt', async () => {
      /*
       * Eigener Kontext, also eigene IndexedDB und damit ein zweiter
       * Geräteschlüssel: Für den liegt kein Wrap dieses Falls vor. Die
       * Mitgliedschaft ist da, der Schlüssel nicht: genau die Lage, die §3.6
       * mit "Freigabe nötig" benennt.
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
       * Derselbe Screen wie beim Beitritt, aber mit der Frage "Gerät
       * freischalten?" Welcher Zweck gilt, sagt der Code und nicht die
       * Person, die ihn eingibt (Koppeln.tsx).
       */
      await gotoVerlaesslich(handy, '/koppeln')
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

      await startscreenZeigt(tablet, 'Friedrich Kaiser')

      // Und die Freigabe ist damit erledigt. Der Hinweis aus Profil ist fort.
      await gotoVerlaesslich(tablet, '/profil')
      await expect(tablet.getByText('Freigabe nötig')).toBeHidden()
    })
  } finally {
    await handy.context().close()
    await tablet.context().close()
  }
})
