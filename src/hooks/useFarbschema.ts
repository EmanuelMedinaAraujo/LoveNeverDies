import { useEffect, useState } from 'react'
import { DUNKEL, HELL, type Farbpalette } from '../ui/farben.ts'
import { useAnsicht } from './useAnsichtsmodus.ts'

/**
 * Licht oder Dunkel (DESIGN.md §7, §12).
 *
 * CSS erledigt das für alles, was die App selbst zeichnet. Dieser Hook ist für
 * den einen Verbraucher da, der die Palette als JavaScript-Werte braucht:
 * Clerks `appearance`.
 *
 * Der Override aus Profil gewinnt gegen die Systemeinstellung, genauso wie
 * `data-farbschema` in `ui/tokens.css` gegen `prefers-color-scheme` gewinnt
 * (§7). Ohne diese Zeile stünde das Anmeldeformular als einziger Teil der App
 * in der Farbe, die das Betriebssystem vorgibt, und wer die App dunkel gestellt
 * hat, bekäme sie hell.
 */

const ABFRAGE = '(prefers-color-scheme: dark)'

export type Farbschema = 'hell' | 'dunkel'

export function useFarbschema(): { schema: Farbschema; palette: Farbpalette } {
  const { darstellung } = useAnsicht()

  const [dunkel, setDunkel] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(ABFRAGE).matches,
  )

  useEffect(() => {
    const abfrage = window.matchMedia(ABFRAGE)
    const beiWechsel = (ereignis: MediaQueryListEvent) => setDunkel(ereignis.matches)

    abfrage.addEventListener('change', beiWechsel)
    return () => abfrage.removeEventListener('change', beiWechsel)
  }, [])

  const istDunkel = darstellung === 'system' ? dunkel : darstellung === 'dunkel'

  return { schema: istDunkel ? 'dunkel' : 'hell', palette: istDunkel ? DUNKEL : HELL }
}
