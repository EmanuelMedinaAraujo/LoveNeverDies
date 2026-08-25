import { expect, type BrowserContext, type Locator, type Page } from '@playwright/test'

/**
 * Die Ansichtswahl aus §7 vorwegnehmen: erweitert.
 *
 * Sie steht im Onboarding vor der Fallweiche, und ohne getroffene Wahl kommt
 * niemand an ihr vorbei — auch kein Test. Gesetzt wird der Speicher direkt
 * und nicht ueber den Screen: Ein Klick auf "Weiter" am Anfang jeder Datei
 * pruefte die Ansichtswahl nicht besser (das tun die Screentests), waere aber
 * in jedem dieser Tests ein zusaetzlicher Schritt, der fehlschlagen kann.
 *
 * "erweitert", weil die Specs die erweiterte Fassung von Start, Aufgabe und
 * Alle bedienen: die Zeilenaktionen, das Sortierfeld, die Namensliste in der
 * Zuweisung.
 *
 * `addInitScript` laeuft vor jedem Laden dieses Kontexts. Im Setup landet der
 * Eintrag dadurch im gesicherten `storageState` und gilt fuer alle Specs des
 * Projekts; ein Kontext, den ein Spec selbst aufmacht, bekommt ihn hier.
 */
export async function ansichtErweitert(kontext: BrowserContext): Promise<void> {
  await kontext.addInitScript(() => {
    localStorage.setItem('lnd.ansicht', JSON.stringify({ modus: 'erweitert' }))
  })
}

/**
 * Dieselbe Wahl, aber "einfach".
 *
 * Genau ein Spec braucht sie: `tresor-todesfall.spec.ts` schickt die
 * angehoerige Person durch die einfache Ansicht, weil §7 sie fuer die Person
 * vorsieht, die zwei Tage nach einem Todesfall vor dem Telefon sitzt -- und
 * weil der Tab Erbe in beiden Ansichten derselbe Screen ist, ohne dass das
 * bisher irgendwo gepruefte war.
 */
export async function ansichtEinfach(kontext: BrowserContext): Promise<void> {
  await kontext.addInitScript(() => {
    localStorage.setItem('lnd.ansicht', JSON.stringify({ modus: 'einfach' }))
  })
}

/**
 * `page.goto`, robust gegen einen bekannten Uhr-Jitter: Der allererste
 * Supabase-Request nach einem frisch geladenen Clerk-Token scheitert manchmal
 * mit "JWT not yet valid", weil dessen `nbf` auf dieselbe Sekunde faellt wie
 * die PostgREST-Pruefung (tests/e2e/README.md): kein Bug, keine
 * Uhrenabweichung, nur zu knapp. Ein Reload holt ein neues Token und geht
 * durch. Ohne diese Kapselung bräuchte ein Retry des ganzen
 * `describe.serial`-Blocks her, und der legte in fall-lebenszyklus.spec.ts
 * beim zweiten Versuch einen zweiten Trauerfall an.
 */
export async function gotoVerlaesslich(page: Page, pfad: string): Promise<void> {
  for (let versuch = 1; versuch <= 3; versuch++) {
    await page.goto(pfad)

    const wurdeFehler = await page
      .getByText('nicht abrufbar')
      .waitFor({ state: 'visible', timeout: 4000 })
      .then(() => true)
      .catch(() => false)

    if (!wurdeFehler || versuch === 3) {
      return
    }
  }
}

/**
 * Die Listenzeilen eines Screens: alles unter `main`, ohne die untere Leiste.
 *
 * Die Leiste (§7) gibt ihre vier Bereiche als Liste aus, und `getByRole` sieht
 * die Seite ganz. Ungegrenzt zaehlte jede Zeilenpruefung "Start", "Erbe",
 * "Alle" und "Profil" mit, und ein `nth(...)` hinter der letzten Aufgabe
 * landete in der Navigation statt in der Liste. Wer Zeilen zaehlt, meint die
 * Liste im Screen und nicht die Wege aus ihm heraus.
 *
 * `main` und nicht die Liste selbst: Ein Screen hat mehrere Listen — Profil
 * eine je Gruppe —, ihre Klassennamen tragen im Build einen Hash, an dem sich
 * nichts festmachen laesst, und eine eigene Ueberschrift hat nicht jede.
 */
export function zeilen(seite: Page): Locator {
  return seite.getByRole('main').getByRole('listitem')
}

/**
 * Ein Datumsfeld fuellen und nachsehen, ob der Wert stehen blieb.
 *
 * Playwrights WebKit laesst einen frisch getippten Wert in einem
 * `input[type=date]` gelegentlich wieder fallen -- auf dem Handy-Projekt in
 * etwa jedem dritten Lauf, waehrend Chromium ihn haelt. Es ist keine Zusage
 * dieser App, sondern eine Kante der Engine, und ein Test, der daran
 * scheitert, meldet einen Fehler, den es nicht gibt.
 *
 * Deshalb wird gefuellt und geprueft, und noch einmal, wenn der Wert weg ist.
 * Die Pruefung ist der eigentliche Gewinn: Ohne sie faellt der Verlust erst
 * beim Absenden auf, und die Meldung heisst dann "die Seite hat nicht
 * gewechselt".
 */
export async function fuelleDatum(feld: Locator, wert: string): Promise<void> {
  await expect(async () => {
    await feld.fill(wert)
    await expect(feld).toHaveValue(wert, { timeout: 2000 })
  }).toPass({ timeout: 30_000 })
}
