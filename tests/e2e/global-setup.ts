import { clerkSetup } from '@clerk/testing/playwright'

/**
 * Holt einmal je Testlauf einen Testing Token von Clerks Backend-API (braucht
 * `CLERK_SECRET_KEY`, siehe .env.test). Der Token umgeht Clerks Bot-Schutz
 * (Cloudflare Turnstile, build/csp.ts). Ohne ihn haengt jede Anmeldung im
 * Captcha fest, das in einer Testumgebung niemand loesen kann.
 */
export default async function globalSetup() {
  await clerkSetup()
}
