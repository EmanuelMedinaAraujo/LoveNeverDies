import { clerkSetup } from '@clerk/testing/playwright'
import { test as setup } from '@playwright/test'
import { stelleTestpersonenSicher } from './clerkPersonen.ts'

/**
 * Der Clerk-Teil des Setups, als eigenes Projekt (Clerk: "Testing with
 * Playwright").
 *
 * `clerkSetup()` holt einmal je Lauf einen Testing Token von Clerks
 * Backend-API (braucht `CLERK_SECRET_KEY`, siehe .env.test). Der Token umgeht
 * Clerks Bot-Schutz (Cloudflare Turnstile, build/csp.ts); ohne ihn haengt jede
 * Anmeldung im Captcha fest, das in einer Testumgebung niemand loest.
 *
 * **Warum ein Projekt und kein `globalSetup`.** Vorher stand der Aufruf in
 * einem funktionsbasierten `globalSetup`. Das laeuft in einem eigenen Prozess,
 * und die Variablen, die `clerkSetup()` setzt (`CLERK_FAPI`,
 * `CLERK_TESTING_TOKEN`), kommen dort bei den Workern nie an. Solange nur
 * `clerk.signIn` benutzt wurde, fiel das nicht auf -- das geht ueber die
 * Backend-API und braucht beides nicht. `setupClerkTestingToken()`, das die
 * Specs jetzt benutzen, braucht es sehr wohl und scheiterte mit "Clerk Frontend
 * API URL is required". Clerks eigene Anleitung nennt genau diesen Fall.
 *
 * `mode: 'serial'`, wie dort vorgeschrieben: Bei voller Parallelitaet liefe das
 * Setup sonst mehrfach nebeneinander.
 */
setup.describe.configure({ mode: 'serial' })

setup('Clerk vorbereiten', async () => {
  await clerkSetup()

  /*
   * Die Personen, die die Specs voraussetzen, gibt es danach mit Sicherheit.
   * Sie von Hand im Dashboard anzulegen war der eine Schritt der Einrichtung,
   * den niemand vergisst, bis er ihn vergisst -- und der Fehler danach heisst
   * nicht "die Person fehlt", sondern "Anmeldung fehlgeschlagen".
   */
  await stelleTestpersonenSicher()
})
