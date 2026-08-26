import { test as setup } from '@playwright/test'
import { clerk, setupClerkTestingToken } from '@clerk/testing/playwright'
import { ansichtErweitert } from './helpers.ts'
import { authDatei, testpersonAdresse, type Projektname } from './nutzer.ts'

/**
 * Meldet die Testperson dieses Browser-Projekts einmal an und legt den
 * Sitzungszustand ab. Alle Specs des zugehoerigen Projekts starten damit
 * bereits angemeldet (DESIGN.md §7). Jeder Test, der sich selbst neu
 * anmeldete, teilte sich sonst eine Sitzung mit allen parallel laufenden.
 *
 * Laeuft einmal je Browser-Projekt: Die Setup-Projekte heissen
 * `setup-<projekt>`, daraus faellt ab, welche Person und welche Ablage gemeint
 * sind (tests/e2e/nutzer.ts). Jedes Projekt braucht eine eigene Person, sonst
 * kollidieren die Trauerfaelle. Die Begruendung steht in `nutzer.ts`.
 *
 * `clerk.signIn` mit `emailAddress` sucht die Person ueber Clerks Backend-API
 * und meldet sie per Ticket an: kein Passwort, kein Bestaetigungscode, keine
 * echten E-Mails. Siehe tests/e2e/README.md fuer die Einrichtung.
 *
 * `setupClerkTestingToken` legt den Testing Token aus `clerk.setup.ts` in
 * diese Seite. Er umgeht Clerks Bot-Schutz; ohne ihn haengt eine Anmeldung im
 * Captcha fest, das in einer Testumgebung niemand loest.
 */
setup('Testperson anmelden', async ({ page }, testInfo) => {
  const projekt = testInfo.project.name.replace(/^setup-/, '') as Projektname
  const email = testpersonAdresse(projekt)

  /*
   * §7: Die Ansichtswahl steht vor der Fallweiche. Sie wird hier getroffen und
   * wandert mit dem `storageState` in jedes Spec dieses Projekts.
   */
  await ansichtErweitert(page.context())
  await setupClerkTestingToken({ page })

  await page.goto('/')
  await clerk.signIn({ page, emailAddress: email })
  await page.goto('/')

  await page.context().storageState({ path: authDatei(projekt) })
})
