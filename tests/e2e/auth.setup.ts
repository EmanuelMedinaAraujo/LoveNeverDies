import { test as setup } from '@playwright/test'
import { clerk } from '@clerk/testing/playwright'

const AUTH_FILE = 'tests/e2e/.auth/user.json'

/**
 * Meldet die dedizierte Testperson einmal an und legt den Sitzungszustand ab.
 * Alle Specs im Projekt "mobile-chromium" starten damit bereits angemeldet
 * (DESIGN.md §7) — jeder Test, der sich selbst neu anmeldet, teilte sich sonst
 * eine Sitzung mit allen anderen parallel laufenden Tests.
 *
 * `clerk.signIn` mit `emailAddress` sucht die Person ueber Clerks Backend-API
 * und meldet sie per Ticket an — kein Passwort, kein Bestaetigungscode, keine
 * echten E-Mails. Siehe tests/e2e/README.md fuer die Einrichtung der Person.
 */
setup('Testperson anmelden', async ({ page }) => {
  const email = process.env.E2E_CLERK_USER_EMAIL

  if (!email) {
    throw new Error(
      'E2E_CLERK_USER_EMAIL fehlt. Siehe tests/e2e/README.md, um eine Testperson anzulegen und in .env.test einzutragen.',
    )
  }

  await page.goto('/')
  await clerk.signIn({ page, emailAddress: email })
  await page.goto('/')

  await page.context().storageState({ path: AUTH_FILE })
})
