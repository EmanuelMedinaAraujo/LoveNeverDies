import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

/**
 * Läuft nur im jsdom-Projekt (vitest.config.ts).
 *
 * `cleanup` von Hand: Testing Library hängt sich selbst nur ein, wenn das
 * Testframework `afterEach` global bereitstellt. Vitest tut das ohne
 * `globals: true` nicht — ohne diesen Aufruf sammelten sich die gerenderten
 * Bäume im selben `document`, und `getByRole` fände ab dem zweiten Test
 * jeweils mehrere Treffer.
 */
afterEach(() => {
  cleanup()
})
