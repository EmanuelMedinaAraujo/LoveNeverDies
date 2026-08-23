import type { Page } from '@playwright/test'

/**
 * `page.goto`, robust gegen einen bekannten Uhr-Jitter: Der allererste
 * Supabase-Request nach einem frisch geladenen Clerk-Token scheitert manchmal
 * mit "JWT not yet valid", weil dessen `nbf` auf dieselbe Sekunde faellt wie
 * die PostgREST-Pruefung (tests/e2e/README.md) — kein Bug, keine
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
