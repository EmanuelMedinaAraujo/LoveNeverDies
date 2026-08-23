import { describe, expect, it } from 'vitest'
import { useAnsichtsmodus } from '../../src/hooks/useAnsichtsmodus.ts'

/**
 * In diesem Stand steht der Modus fest (DESIGN.md §7): Das Onboarding, das die
 * Wahl trifft, gibt es noch nicht. Der Hook ruft nichts aus React auf, deshalb
 * braucht dieser Test kein Rendering.
 */
describe('useAnsichtsmodus', () => {
  it('steht auf "erweitert", solange das Onboarding fehlt', () => {
    expect(useAnsichtsmodus()).toBe('erweitert')
  })
})
