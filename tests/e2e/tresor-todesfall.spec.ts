import { expect, test, type Browser, type Page } from '@playwright/test'
import { clerk, setupClerkTestingToken } from '@clerk/testing/playwright'
import { TRESORPERSONEN, tresorperson, type Tresorrolle } from './nutzer.ts'
import { ansichtEinfach, ansichtErweitert, fuelleDatum, gotoVerlaesslich, zeilen } from './helpers.ts'
import { HANDY, einloesenUndBestaetigen, pruefcodeVon, wertUnter } from './kopplungHelfer.ts'

/**
 * Der Tresor von der Vorsorge bis zum Nachlass (DESIGN.md §3.5).
 *
 * Der eine Ablauf dieser App, der von Hand kaum zu prüfen ist: Er braucht zwei
 * Menschen, zwei Geräte und einen Todesfall dazwischen. Elke sorgt vor und
 * legt etwas in den Tresor; Frank ist der Angehörige, an dessen Gerät der
 * Schlüsselanteil hängt. Erst er kann bestätigen, und erst er kann öffnen.
 *
 * Warum eigene Kontexte und nicht Tabs: Die Geräteidentität liegt in IndexedDB
 * (`core/crypto/keystore.ts`), und die teilen sich zwei Tabs desselben
 * Kontexts. Ein Schlüsselanteil hängt an einem Gerät — zwei Tabs wären ein
 * Gerät, und der ganze Ablauf hätte nichts zu teilen.
 *
 * **Frank sitzt in der einfachen Ansicht.** §7 sieht sie für die Person vor,
 * die zwei Tage nach einem Todesfall vor dem Telefon sitzt, und genau die
 * bestätigt hier einen Todesfall. Der Tab Erbe ist in beiden Ansichten
 * derselbe Screen; dass er es bleibt, stand bislang nirgends geprüft.
 *
 * Drei Zusagen hängen an diesem Spec, jede davon ein Fehlerbericht:
 *
 * 1. "Todesfall bestätigen" ist in der einfachen Ansicht erreichbar.
 * 2. Nach dem Öffnen wird der Fall zum Trauerfall, **ohne Seitenwechsel**.
 *    Vorher musste man den Tab verlassen und zurückkommen, damit der Screen
 *    den neuen Stand zeigte.
 * 3. Was im Tresor lag, ist danach zu lesen — auf `/erbe/tresor`, und nicht
 *    als Aufgabe zwischen den Aufgaben.
 */

/**
 * Ein frisches Gerät mit angemeldeter Person.
 *
 * Gewartet wird bis zur Geräteliste in Profil und nicht nur bis zur Anmeldung:
 * Die Geräteanmeldung läuft still im Hintergrund (§7) und muss durch sein,
 * bevor irgendetwas einen Kopplungscode anfordert oder einen Schlüsselanteil
 * bekommt.
 */
async function neuesGeraet(
  browser: Browser,
  rolle: Tresorrolle,
  ansicht: 'einfach' | 'erweitert',
): Promise<Page> {
  const kontext = await browser.newContext(HANDY)

  if (ansicht === 'einfach') {
    await ansichtEinfach(kontext)
  } else {
    await ansichtErweitert(kontext)
  }

  const seite = await kontext.newPage()

  await setupClerkTestingToken({ page: seite })
  await seite.goto('/')
  await clerk.signIn({ page: seite, emailAddress: tresorperson(rolle) })

  await gotoVerlaesslich(seite, '/profil')
  await expect(zeilen(seite).filter({ hasText: 'Dieses Gerät · Prüfcode' })).toBeVisible()

  return seite
}

/**
 * Die Edge Function `vault-release` muss erreichbar sein (§3.5, §9).
 *
 * `supabase start` bringt sie **nicht** mit: Der Edge-Runtime-Container laeuft,
 * antwortet aber mit 404, bis `supabase functions serve --no-verify-jwt`
 * daneben laeuft (supabase/README.md). Ohne diesen Vorabcheck scheitert der
 * Test dreissig Sekunden spaeter an "Die Freigabe wurde nicht angenommen:
 * Edge Function returned a non-2xx status code" -- eine Meldung, die nach
 * einem Fehler in der App aussieht und keiner ist.
 *
 * Erwartet wird 401 und nicht 200: Ohne Anmeldung wird nichts freigegeben, und
 * genau das ist der Beweis, dass die Funktion antwortet.
 */
test.beforeAll(async () => {
  const antwort = await fetch('http://127.0.0.1:54321/functions/v1/vault-release', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  }).catch(() => null)

  if (antwort === null || antwort.status === 404) {
    throw new Error(
      'Die Edge Function `vault-release` antwortet nicht. `supabase start` serviert sie nicht mit; ' +
        'starte daneben `npx supabase functions serve --no-verify-jwt` (siehe tests/e2e/README.md).',
    )
  }
})

/**
 * Warten, bis die Fallweiche steht (§7).
 *
 * Sie erscheint erst, wenn die Fallliste geladen ist, und die lädt erst, wenn
 * die Geräteanmeldung durch ist — sie läuft still im Hintergrund und ist nach
 * einem frischen Laden nicht sofort fertig. Wer vorher auf "Vorsorge anlegen"
 * tippt, bekommt "Ohne angemeldetes Gerät lässt sich kein Fall anlegen".
 */
async function fallweiche(seite: Page): Promise<void> {
  await gotoVerlaesslich(seite, '/')

  await expect(seite.getByRole('heading', { name: 'Willkommen', level: 1 })).toBeVisible({
    timeout: 60_000,
  })
}

/**
 * Der Tab Erbe, über die untere Leiste — so wie jemand ihn erreicht.
 *
 * Zuerst auf Start: Die Leiste steht nur unter den vier Hauptscreens (§7), und
 * `/koppeln` ist keiner davon. Von dort aus wäre sie nicht anzuklicken.
 */
async function zumErbe(seite: Page): Promise<void> {
  await gotoVerlaesslich(seite, '/')
  await seite.getByRole('navigation', { name: 'Hauptbereiche' }).getByRole('link', { name: 'Erbe' }).click()

  await expect(seite.getByRole('heading', { name: 'Erbe & Tresor', level: 1 })).toBeVisible({
    timeout: 30_000,
  })
}

test('Vorsorge, Todesfall bestätigen, Tresor öffnen, Nachlass lesen', async ({ browser }) => {
  /*
   * Zwei Geräte mit eigener Schlüsselerzeugung (ML-KEM-768 + ML-DSA-65), eine
   * Kopplung, ein Shamir-Split und eine Rekonstruktion. Die Voreinstellung von
   * 30 Sekunden reicht dafür auf keiner Maschine.
   */
  test.setTimeout(240_000)

  const elke = await neuesGeraet(browser, 'vorsorgend', 'erweitert')
  const frank = await neuesGeraet(browser, 'angehoerig', 'einfach')

  try {
    await test.step('Elke legt einen Vorsorgefall an und füllt den Tresor', async () => {
      await fallweiche(elke)
      await elke.getByRole('button', { name: 'Ich möchte für später vorsorgen' }).click()

      await elke.getByLabel('Ihr Name').fill('Elke Fischer')

      /*
       * Mehr als ein Versuch, und das ist kein Zittern im Test: `useCase` und
       * damit `useGeraeteanmeldung` haengen an der Komponente, nicht an der
       * App. Ein frisch aufgeschlagener Screen faengt die Geraeteanmeldung neu
       * an, und wer in dieser einen Sekunde auf "Vorsorge anlegen" tippt,
       * bekommt "Ohne angemeldetes Geraet laesst sich kein Fall anlegen".
       * Dieselbe Kante trifft eine Person mit schnellem Finger; der Screen
       * sollte den Knopf so lange sperren. Bis dahin haelt der Test es aus.
       */
      await expect(async () => {
        await elke.getByRole('button', { name: 'Vorsorge anlegen' }).click()
        await expect(elke).toHaveURL(/\/erbe$/, { timeout: 10_000 })
      }).toPass({ timeout: 60_000 })

      await elke.getByRole('button', { name: 'Inhalt in Tresor legen' }).click()
      await elke.getByLabel('Titel').fill('Zugang Sparkasse')
      await elke.getByLabel('Inhalt / Notiz').fill('Kennwort liegt im blauen Umschlag.')
      await elke.getByRole('button', { name: 'Im Tresor speichern' }).click()

      await expect(elke.getByText('Zugang Sparkasse')).toBeVisible()

      // §3.5: Ohne Angehörige kann niemand öffnen. Genau das steht dort auch.
      await expect(
        elke.getByText(/Der Tresor ist versiegelt, kann aber noch von niemandem geöffnet werden/),
      ).toBeVisible()
    })

    let code = ''
    let pruefcode = ''

    await test.step('Frank holt sich einen Kopplungscode', async () => {
      await fallweiche(frank)
      await frank.getByRole('button', { name: 'Ich wurde eingeladen' }).click()

      code = (await wertUnter(frank, 'Ihr Kopplungscode').textContent()) ?? ''
      pruefcode = await pruefcodeVon(frank, 'Ihr Prüfcode')

      expect(code).toMatch(/^[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}$/)
    })

    await test.step('Elke nimmt ihn auf und verteilt damit die Schlüsselanteile', async () => {
      await gotoVerlaesslich(elke, '/koppeln')
      await einloesenUndBestaetigen(elke, code, {
        ueberschrift: 'Zum Fall hinzufügen?',
        name: `${TRESORPERSONEN.angehoerig.vorname} ${TRESORPERSONEN.angehoerig.nachname}`,
        email: tresorperson('angehoerig'),
        pruefcode,
      })

      /*
       * Erst warten, dann weiterklicken: Die Bestätigung schreibt Mitgliedschaft
       * und Fallschlüssel-Wrap in einem Zug (§6). Wer die Seite vorher verlässt,
       * bricht den laufenden Request ab — und der Fall hätte dann kein Mitglied,
       * ohne dass irgendwo etwas fehlschlüge.
       */
      await expect(elke.getByRole('heading', { name: 'Fertig', level: 1 })).toBeVisible({
        timeout: 60_000,
      })
      await expect(frank.getByText('Sie gehören jetzt zum Fall.')).toBeVisible({
        timeout: 60_000,
      })

      /*
       * §3.5: Mit einem Mitglied ist n = 1 und k = 1. Der Re-Split läuft von
       * selbst an, sobald `vault_resplit_pending` steht
       * (`useTresor`); hier wird nur gewartet, bis er durch ist.
       */
      await zumErbe(elke)
      await expect(
        elke.getByText(/Solange nur 1 Angehörige:r hinterlegt ist/),
      ).toBeVisible({ timeout: 60_000 })
    })

    await test.step('Frank sieht "Todesfall bestätigen" — in der einfachen Ansicht', async () => {
      /*
       * Der erste der drei Fehlerberichte. Der Tab Erbe ist in beiden Ansichten
       * derselbe Screen (`screens/shared/Erbe`); dass er es bleibt, prüft von
       * hier an dieser Schritt.
       */
      await zumErbe(frank)

      await expect(
        frank.getByRole('button', { name: 'Todesfall bestätigen' }),
      ).toBeVisible({ timeout: 60_000 })
    })

    await test.step('Frank bestätigt, und der Zähler zieht ohne Seitenwechsel nach', async () => {
      await frank.getByRole('button', { name: 'Todesfall bestätigen' }).click()
      await frank.getByRole('button', { name: 'Ja, Todesfall bestätigen' }).click()

      /*
       * Kein `goto` und kein `reload` dazwischen: Der Zähler steht auf 1 von 1,
       * und "Tresor öffnen" erscheint auf demselben Bildschirm.
       */
      await expect(frank.getByText('1 von 1 Freigaben')).toBeVisible({ timeout: 30_000 })
      await expect(frank.getByRole('button', { name: 'Tresor öffnen' })).toBeVisible()
      await expect(frank.getByText('Sie haben den Todesfall bereits bestätigt.')).toBeVisible()
    })

    await test.step('Frank öffnet den Tresor, und der Fall wird ohne Seitenwechsel zum Trauerfall', async () => {
      await frank.getByRole('button', { name: 'Tresor öffnen' }).click()
      await fuelleDatum(frank.getByLabel('Sterbedatum'), '2026-03-15')
      await frank.getByRole('button', { name: 'Tresor jetzt öffnen' }).click()

      /*
       * Der zweite Fehlerbericht: Vorher blieb der Screen auf "Vorsorge"
       * stehen, bis jemand den Tab verliess und zurueckkam. Deshalb steht hier
       * bewusst kein `goto`.
       */
      await expect(frank.getByText(/· Trauerfall/)).toBeVisible({ timeout: 60_000 })
      await expect(frank.getByRole('link', { name: /Nachlass-Tresor/ })).toBeVisible()
    })

    await test.step('Frank liest, was Elke hinterlegt hat', async () => {
      await frank.getByRole('link', { name: /Nachlass-Tresor/ }).click()

      await expect(frank.getByRole('heading', { name: 'Nachlass-Tresor', level: 1 })).toBeVisible()

      // Zugeklappt: Der Titel steht da, der Inhalt kommt auf Tippen.
      await expect(frank.getByText('Zugang Sparkasse')).toBeVisible()
      await expect(frank.getByText('Kennwort liegt im blauen Umschlag.')).not.toBeVisible()

      await frank.getByText('Zugang Sparkasse').click()
      await expect(frank.getByText('Kennwort liegt im blauen Umschlag.')).toBeVisible()
    })

    await test.step('und findet ihn nicht als Aufgabe zwischen den Aufgaben', async () => {
      /*
       * Der dritte Fehlerbericht: Nach dem Oeffnen liegt der Tresor-Eintrag
       * unter `K_c` und ohne `in_vault`. Er trug einen Titel, und mehr pruefte
       * `lesePayload` nicht -- die Notiz stand danach in "Alle", mit Haekchen
       * und mit "Loeschen".
       */
      await frank.getByRole('link', { name: 'Zurück' }).click()
      await frank
        .getByRole('navigation', { name: 'Hauptbereiche' })
        .getByRole('link', { name: 'Alle' })
        .click()

      await expect(frank.getByRole('heading', { name: 'Alle Aufgaben', level: 1 })).toBeVisible()
      await expect(
        frank.getByRole('main').getByText('Zugang Sparkasse'),
      ).toHaveCount(0)
    })
  } finally {
    await elke.context().close()
    await frank.context().close()
  }
})
