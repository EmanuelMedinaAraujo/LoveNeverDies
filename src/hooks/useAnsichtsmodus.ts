/**
 * Einfach oder Erweitert (DESIGN.md §7).
 *
 * Die Wahl trifft das Onboarding, noch bevor die Fallweiche kommt — damit alle
 * folgenden Screens bereits im gewählten Modus erscheinen. Das Onboarding gibt
 * es in diesem Stand noch nicht, also steht der Modus fest.
 *
 * Der Rückgabewert landet als `data-dichte` auf der Wurzel und schaltet damit
 * die Dichtetokens in `ui/tokens.css` um. Die Primitiven lesen ausschließlich
 * diese Tokens; ein Umschalter kostet später keine Neuverkabelung.
 */

export type Ansichtsmodus = 'einfach' | 'erweitert'

export function useAnsichtsmodus(): Ansichtsmodus {
  return 'erweitert'
}
