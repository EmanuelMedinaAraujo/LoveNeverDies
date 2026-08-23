import { useEffect, useState } from 'react'
import { DUNKEL, HELL, type Farbpalette } from '../ui/farben.ts'

/**
 * Licht oder Dunkel, nach Systemeinstellung (DESIGN.md §7, §12).
 *
 * CSS erledigt das für alles, was die App selbst zeichnet — dieser Hook ist für
 * den einen Verbraucher da, der die Palette als JavaScript-Werte braucht:
 * Clerks `appearance`.
 */

const ABFRAGE = '(prefers-color-scheme: dark)'

export type Farbschema = 'hell' | 'dunkel'

export function useFarbschema(): { schema: Farbschema; palette: Farbpalette } {
  const [dunkel, setDunkel] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(ABFRAGE).matches,
  )

  useEffect(() => {
    const abfrage = window.matchMedia(ABFRAGE)
    const beiWechsel = (ereignis: MediaQueryListEvent) => setDunkel(ereignis.matches)

    abfrage.addEventListener('change', beiWechsel)
    return () => abfrage.removeEventListener('change', beiWechsel)
  }, [])

  return { schema: dunkel ? 'dunkel' : 'hell', palette: dunkel ? DUNKEL : HELL }
}
