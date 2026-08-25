/**
 * Die vier Symbole der unteren Leiste (DESIGN.md §7).
 *
 * Strichzeichnungen in `currentColor`, damit der aktive Tab sie ohne einen
 * zweiten Satz Dateien einfaerben kann. Keine Fuellungen: Bei 78-jaehrigen
 * Augen auf einem Handy traegt die Kontur weiter als die Flaeche.
 *
 * Die Symbole sind `aria-hidden`. Vorgelesen wird die Beschriftung daneben,
 * und die steht immer da: Ein Icon allein ist bei dieser Zielgruppe eine
 * Vermutung, kein Wegweiser (§7).
 */

const gemeinsam = {
  width: '1.5em',
  height: '1.5em',
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.75,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
  focusable: false,
} as const

/** Start: ein abgehaktes Kaestchen. Der Screen zeigt, was ich zu tun habe. */
export function SymbolStart() {
  return (
    <svg {...gemeinsam}>
      <rect x="3.5" y="3.5" width="17" height="17" rx="4.5" />
      <path d="m8 12.2 2.7 2.7L16 9.4" />
    </svg>
  )
}

/** Erbe: ein Schluessel. Der Tresor ist der Gegenstand dieses Tabs (§3.5). */
export function SymbolErbe() {
  return (
    <svg {...gemeinsam}>
      <circle cx="6.9" cy="12" r="3.6" />
      <path d="M10.5 12H21M17.2 12v3.2M20.6 12v2.4" />
    </svg>
  )
}

/** Alle: eine Liste mit Punkten. Alle Aufgaben des Falls, nicht nur meine. */
export function SymbolAlle() {
  return (
    <svg {...gemeinsam}>
      <path d="M4.6 6.6h.01M4.6 12h.01M4.6 17.4h.01" />
      <path d="M9.2 6.6h10.2M9.2 12h10.2M9.2 17.4h10.2" />
    </svg>
  )
}

/** Profil: eine Person. */
export function SymbolProfil() {
  return (
    <svg {...gemeinsam}>
      <circle cx="12" cy="8.2" r="3.6" />
      <path d="M5.2 19.8c0-3.2 3-5.4 6.8-5.4s6.8 2.2 6.8 5.4" />
    </svg>
  )
}
