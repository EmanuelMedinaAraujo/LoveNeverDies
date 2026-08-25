/**
 * Die Symbole der beiden Wege hinter dem Status "Erbe" (ERBE_DESIGN.md §10).
 *
 * Dieselbe Machart wie die Symbole der unteren Leiste (DESIGN.md §7):
 * Strichzeichnungen in `currentColor`, keine Füllungen, `aria-hidden`.
 * Vorgelesen wird die Beschriftung daneben, und die steht immer da — ein Icon
 * allein ist bei dieser Zielgruppe eine Vermutung und kein Wegweiser.
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

/** Erbschein: ein Dokument mit umgeknickter Ecke. */
export function SymbolUrkunde() {
  return (
    <svg {...gemeinsam}>
      <path d="M13.6 3.5H6.8A1.8 1.8 0 0 0 5 5.3v13.4a1.8 1.8 0 0 0 1.8 1.8h10.4a1.8 1.8 0 0 0 1.8-1.8V8.6z" />
      <path d="M13.4 3.6v4.2a1 1 0 0 0 1 1h4.3" />
      <path d="M8.4 13h7.2M8.4 16.4h4.6" />
    </svg>
  )
}

/** Erbengemeinschaft bzw. Alleinerbe: zwei Personen, eine davon im Vordergrund. */
export function SymbolPersonen() {
  return (
    <svg {...gemeinsam}>
      <circle cx="9.4" cy="9.2" r="3.2" />
      <path d="M3.4 19.8c0-2.9 2.7-4.8 6-4.8s6 1.9 6 4.8" />
      <circle cx="17.6" cy="7.4" r="2.2" />
      <path d="M16.8 14.6c2.6 0 3.8 1.8 3.8 4.6" />
    </svg>
  )
}

/** Alleinerbe: eine Person. */
export function SymbolPerson() {
  return (
    <svg {...gemeinsam}>
      <circle cx="12" cy="8.2" r="3.6" />
      <path d="M5.2 19.8c0-3.2 3-5.4 6.8-5.4s6.8 2.2 6.8 5.4" />
    </svg>
  )
}

/** Der Pfeil am Status: zeigt nach unten, aufgeklappt nach oben. */
export function SymbolPfeil() {
  return (
    <svg {...gemeinsam} width="1.25em" height="1.25em">
      <path d="m7 10 5 5 5-5" />
    </svg>
  )
}
