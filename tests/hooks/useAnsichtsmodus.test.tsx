import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { ansichtSchreiben, ansichtZuruecksetzen } from '../../src/core/storage/ansicht.ts'
import { useAnsicht, useAnsichtsmodus } from '../../src/hooks/useAnsichtsmodus.ts'

/**
 * Die Ansichtswahl und die beiden Overrides (DESIGN.md §7).
 *
 * Geprüft wird, was §7 zusagt: "Einfach" gilt, solange niemand gewählt hat;
 * die Wahl überlebt einen Neustart; und ein Umschalten wirkt sofort — also
 * auch in einer Komponente, die den Hook schon gerendert hat, und nicht erst
 * nach dem nächsten Laden.
 */

beforeEach(() => {
  localStorage.clear()
  ansichtZuruecksetzen()
})

describe('useAnsichtsmodus', () => {
  it('steht auf "einfach", solange niemand gewählt hat', () => {
    const { result } = renderHook(() => useAnsichtsmodus())

    expect(result.current).toBe('einfach')
  })

  it('meldet die offene Wahl als null, damit das Onboarding fragen kann', () => {
    const { result } = renderHook(() => useAnsicht())

    expect(result.current.modus).toBeNull()
  })

  it('nimmt die Wahl an und behält sie', () => {
    const { result } = renderHook(() => useAnsicht())

    act(() => result.current.waehleModus('erweitert'))

    expect(result.current.modus).toBe('erweitert')

    // Ein neuer Start liest denselben Speicher.
    ansichtZuruecksetzen()
    expect(renderHook(() => useAnsicht()).result.current.modus).toBe('erweitert')
  })

  it('erreicht mit einer Änderung alle, die gerade zusehen', () => {
    /*
     * §7: "Der Modus lässt sich in Profil umschalten und wirkt sofort auf
     * Start, Aufgabe und Alle." Profil schreibt, die Wurzel liest — und beide
     * rendern in derselben Runde denselben Wert.
     */
    const profil = renderHook(() => useAnsicht())
    const wurzel = renderHook(() => useAnsichtsmodus())

    act(() => profil.result.current.waehleModus('erweitert'))

    expect(wurzel.result.current).toBe('erweitert')
  })

  it('steht bei Textgröße und Darstellung auf "Systemeinstellung folgen"', () => {
    const { result } = renderHook(() => useAnsicht())

    expect(result.current.textgroesse).toBe('system')
    expect(result.current.darstellung).toBe('system')

    act(() => result.current.waehleTextgroesse('gross'))
    act(() => result.current.waehleDarstellung('dunkel'))

    expect(result.current.textgroesse).toBe('gross')
    expect(result.current.darstellung).toBe('dunkel')
  })

  it('lässt die anderen Einstellungen stehen, wenn eine sich ändert', () => {
    ansichtSchreiben({ modus: 'erweitert', textgroesse: 'gross' })

    const { result } = renderHook(() => useAnsicht())
    act(() => result.current.waehleDarstellung('hell'))

    expect(result.current).toMatchObject({
      modus: 'erweitert',
      textgroesse: 'gross',
      darstellung: 'hell',
    })
  })
})
