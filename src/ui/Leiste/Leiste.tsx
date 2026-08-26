import type { ReactNode } from 'react'
import { NavLink } from 'react-router-dom'
import { SymbolAlle, SymbolErbe, SymbolProfil, SymbolStart } from './Symbole.tsx'
import stile from './Leiste.module.css'

/**
 * Die untere Leiste: Start · Alle · Erbe · Profil (DESIGN.md §7).
 *
 * Sie ist der einzige Ort für Navigation. Vorher trug jeder Screen seine eigene
 * Reihe Textlinks, und die Reihen waren pro Screen verschieden benannt und
 * verschieden sortiert. Am Telefon führt das zu „bei mir steht da was anderes",
 * und genau das schließt §7 aus: In beiden Ansichten dieselbe Struktur.
 *
 * Fixiert am unteren Rand, weil dort der Daumen liegt. Die Beschriftung steht
 * immer unter dem Symbol; ein Icon allein wäre bei dieser Zielgruppe eine
 * Vermutung. Die Trefferfläche ist die ganze Zelle, mindestens 44 × 44 px, und
 * `safe-area-inset-bottom` hält sie über dem Home-Indicator.
 */

type TabProps = {
  zu: string
  /** `true` nur beim Wurzelpfad: Sonst wäre „Start" auf jedem Screen aktiv. */
  genau?: boolean
  beschriftung: string
  symbol: ReactNode
  /** Der Freigabe-Hinweis aus §3.6, sichtbar als Punkt am Symbol. */
  hinweis?: string | undefined
}

function Tab({ zu, genau = false, beschriftung, symbol, hinweis }: TabProps) {
  return (
    <li className={stile.zelle}>
      <NavLink
        to={zu}
        end={genau}
        /*
         * Der Hinweis gehört in den Namen des Tabs, nicht daneben: Vorgelesen
         * wird sonst „Profil" und danach, irgendwann, ein zweiter Text. Die
         * sichtbare Beschriftung steht im Namen drin, wie WCAG 2.5.3 es
         * verlangt.
         */
        aria-label={hinweis === undefined ? beschriftung : `${beschriftung}, ${hinweis}`}
        className={({ isActive }) => [stile.tab, isActive ? stile.aktiv : null].filter(Boolean).join(' ')}
      >
        <span className={stile.symbol}>{symbol}</span>
        <span className={stile.beschriftung}>{beschriftung}</span>
        {hinweis === undefined ? null : <span className={stile.punkt} aria-hidden="true" />}
      </NavLink>
    </li>
  )
}

type LeisteProps = {
  /**
   * §3.6: Dieses Gerät wartet auf seine Freigabe. Der Hinweis gehört an den
   * Profil-Tab, weil die Freigabe dort geschieht.
   */
  freigabeNoetig?: boolean
  /**
   * §3.5: Der aktive Fall ist der eigene Vorsorgefall. Dann steht „Nachlass"
   * an erster Stelle und „Start" gar nicht.
   *
   * Die Entscheidung trifft `Rahmen` über `istVorsorgende` und nicht diese
   * Datei: Die Leiste liegt in `src/ui` und weiß nichts über Fälle (§9).
   */
  vorsorge?: boolean
}

export function Leiste({ freigabeNoetig = false, vorsorge = false }: LeisteProps) {
  const profil = (
    <Tab
      zu="/profil"
      beschriftung="Profil"
      symbol={<SymbolProfil />}
      hinweis={freigabeNoetig ? 'Freigabe nötig' : undefined}
    />
  )

  if (vorsorge) {
    return (
      <nav className={stile.leiste} aria-label="Hauptbereiche">
        <ul className={stile.tabs}>
          <Tab zu="/nachlass" beschriftung="Nachlass" symbol={<SymbolErbe />} />
          <Tab zu="/alle" beschriftung="Alle" symbol={<SymbolAlle />} />
          {profil}
        </ul>
      </nav>
    )
  }

  return (
    <nav className={stile.leiste} aria-label="Hauptbereiche">
      <ul className={stile.tabs}>
        <Tab zu="/" genau beschriftung="Start" symbol={<SymbolStart />} />
        <Tab zu="/alle" beschriftung="Alle" symbol={<SymbolAlle />} />
        <Tab zu="/erbe" beschriftung="Erbe" symbol={<SymbolErbe />} />
        {profil}
      </ul>
    </nav>
  )
}

