/**
 * Die beiden Symbole der Wege im Nachlass-Bereich (DESIGN.md §7).
 *
 * Strichzeichnungen in `currentColor` wie in der unteren Leiste, damit die
 * Karte sie ohne einen zweiten Satz Dateien einfaerbt. Sie sind
 * `aria-hidden`: Vorgelesen wird die Ueberschrift daneben, und die steht
 * immer da.
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

/** Eine Aufgabe: ein Zettel mit einem Haken. Eine Bitte an die Angehoerigen. */
export function SymbolAufgabe() {
  return (
    <svg {...gemeinsam}>
      <path d="M8 4.5H6.4A1.9 1.9 0 0 0 4.5 6.4v13.2a1.9 1.9 0 0 0 1.9 1.9h11.2a1.9 1.9 0 0 0 1.9-1.9V6.4a1.9 1.9 0 0 0-1.9-1.9H16" />
      <rect x="8" y="2.6" width="8" height="3.8" rx="1.4" />
      <path d="m8.8 13.4 2.2 2.2 4.2-4.2" />
    </svg>
  )
}

/** Die Checkliste: ein Blatt mit Zeilen. Was hinterlegt wird, ist Text. */
export function SymbolCheckliste() {
  return (
    <svg {...gemeinsam}>
      <path d="M13.6 2.8H6.9A1.9 1.9 0 0 0 5 4.7v14.6a1.9 1.9 0 0 0 1.9 1.9h10.2a1.9 1.9 0 0 0 1.9-1.9V8.2z" />
      <path d="M13.6 2.8v5.4H19" />
      <path d="M8.6 12.6h6.8M8.6 16.4h4.6" />
    </svg>
  )
}
