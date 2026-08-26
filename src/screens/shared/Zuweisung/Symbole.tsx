/**
 * Die drei Zustände der Zuständigkeit als Strichzeichnung (DESIGN.md §7).
 *
 * Dieselbe Machart wie in der unteren Leiste: `currentColor`, keine Füllung,
 * `aria-hidden`. Vorgelesen wird der Name daneben, und der steht immer da —
 * ein Icon allein ist bei dieser Zielgruppe eine Vermutung, kein Wegweiser.
 */

const gemeinsam = {
  width: '1.25em',
  height: '1.25em',
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.75,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
  focusable: false,
} as const

/** Eine Person: eine oder mehrere namentlich genannte kümmern sich. */
export function SymbolPerson() {
  return (
    <svg {...gemeinsam}>
      <circle cx="12" cy="8.2" r="3.6" />
      <path d="M5 19.4c0-3.1 3.1-5 7-5s7 1.9 7 5" />
    </svg>
  )
}

/** Zwei Personen: "Alle" ist ein eigener Wert, keine Liste aller Namen (§7). */
export function SymbolAlleLeute() {
  return (
    <svg {...gemeinsam}>
      <circle cx="9.4" cy="8.6" r="3.2" />
      <path d="M3 19.4c0-2.9 2.9-4.6 6.4-4.6s6.4 1.7 6.4 4.6" />
      <path d="M16.4 6.1a3.2 3.2 0 0 1 0 6.1M17.6 15.2c2.2.5 3.6 1.8 3.6 3.7" />
    </svg>
  )
}

/** Niemand: dieselbe Person, nur als offene Stelle mit einem Plus daneben. */
export function SymbolFrei() {
  return (
    <svg {...gemeinsam}>
      <circle cx="10.4" cy="8.2" r="3.6" />
      <path d="M3.4 19.4c0-3.1 3.1-5 7-5 .7 0 1.4.1 2 .2" />
      <path d="M18 14.6v5.2M15.4 17.2h5.2" />
    </svg>
  )
}
