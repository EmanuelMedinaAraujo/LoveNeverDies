import { useState } from 'react'
import {
  extrahierePlzAusNotiz,
  findeNachlassgericht,
} from '../../../services/gerichtService.ts'
import type { GerichtLookupErgebnis, Nachlassgericht } from '../../../types/gericht.ts'
import { Button } from '../../../ui/Button/Button.tsx'
import { Gerichtskarte } from '../../../ui/Gerichtskarte/Gerichtskarte.tsx'
import stile from './GerichtNachschlagen.module.css'

/** Prüft, ob eine Behördenangabe ein Nachlassgericht oder Amtsgericht benennt. */
export function istGerichtStelle(stelle: string): boolean {
  const s = stelle.toLowerCase()
  return s.includes('nachlassgericht') || s.includes('amtsgericht')
}

export type GerichtNachschlagenProps = {
  initialNotiz?: string | undefined
  aufGerichtGefunden?: ((gericht: Nachlassgericht, plz: string) => void | Promise<void>) | undefined
  gesperrt?: boolean | undefined
}

/**
 * Suche nach dem zuständigen Gericht direkt an einer Aufgabe.
 * In Aufgaben ist das Suchwerkzeug immer ausgeklappt.
 */
export function GerichtNachschlagen({
  initialNotiz = '',
  aufGerichtGefunden,
  gesperrt = false,
}: GerichtNachschlagenProps = {}) {
  const [plz, setzePlz] = useState(() => extrahierePlzAusNotiz(initialNotiz) ?? '')
  const [ergebnis, setzeErgebnis] = useState<GerichtLookupErgebnis | null>(() => {
    const extracted = extrahierePlzAusNotiz(initialNotiz)
    if (extracted && extracted.length === 5) {
      return findeNachlassgericht(extracted)
    }
    return null
  })
  const [zuletztGeseheneNotiz, setzeZuletztGeseheneNotiz] = useState(initialNotiz)

  if (initialNotiz !== zuletztGeseheneNotiz) {
    setzeZuletztGeseheneNotiz(initialNotiz)
    const extracted = extrahierePlzAusNotiz(initialNotiz)
    if (extracted && extracted.length === 5) {
      setzePlz(extracted)
      setzeErgebnis(findeNachlassgericht(extracted))
    }
  }

  function suche(eingabe: string) {
    const res = findeNachlassgericht(eingabe)
    setzeErgebnis(res)
    if (res.status === 'gefunden') {
      void aufGerichtGefunden?.(res.gericht, res.plz)
    }
  }

  function handlePlzChange(neuePlz: string) {
    setzePlz(neuePlz)
    const trimmed = neuePlz.trim()
    if (trimmed.length === 5) {
      suche(trimmed)
    } else if (trimmed.length === 0) {
      setzeErgebnis(null)
    }
  }

  return (
    <div className={stile.container}>
      <div className={stile.sucheZeile}>
        <input
          className={stile.eingabe}
          inputMode="numeric"
          value={plz}
          onChange={(e) => handlePlzChange(e.target.value)}
          placeholder="PLZ z. B. 74199"
          maxLength={5}
          disabled={gesperrt}
          aria-label="Postleitzahl für Gerichtssuche"
        />
        <Button
          variante="sekundaer"
          disabled={gesperrt || plz.trim() === ''}
          onClick={() => suche(plz)}
        >
          Suchen
        </Button>
      </div>

      {ergebnis?.status === 'gefunden' ? <Gerichtskarte gericht={ergebnis.gericht} /> : null}

      {ergebnis?.status === 'mehrdeutig' ? (
        <div className={stile.hinweis}>
          <p style={{ margin: 0 }}>{ergebnis.hinweis}</p>
          <a
            className={stile.link}
            href={ergebnis.linkUrl}
            target="_blank"
            rel="noreferrer"
          >
            Justizportal öffnen ↗
          </a>
        </div>
      ) : null}

      {ergebnis?.status === 'nicht_gefunden' || ergebnis?.status === 'ungueltig' ? (
        <p className={stile.hinweis}>{ergebnis.hinweis}</p>
      ) : null}
    </div>
  )
}

