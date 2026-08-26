import { useState } from 'react'
import { findeNachlassgericht } from '../../../services/gerichtService.ts'
import type { GerichtLookupErgebnis } from '../../../types/gericht.ts'
import { Button } from '../../../ui/Button/Button.tsx'
import { Gerichtskarte } from '../../../ui/Gerichtskarte/Gerichtskarte.tsx'
import stile from './GerichtNachschlagen.module.css'

/** Prüft, ob eine Behördenangabe ein Nachlassgericht oder Amtsgericht benennt. */
export function istGerichtStelle(stelle: string): boolean {
  const s = stelle.toLowerCase()
  return s.includes('nachlassgericht') || s.includes('amtsgericht')
}

/**
 * Klappbare Suche nach dem zuständigen Gericht direkt an einer Aufgabe.
 */
export function GerichtNachschlagen() {
  const [offen, setzeOffen] = useState(false)
  const [plz, setzePlz] = useState('')
  const [ergebnis, setzeErgebnis] = useState<GerichtLookupErgebnis | null>(null)

  function suche(eingabe: string) {
    setzeErgebnis(findeNachlassgericht(eingabe))
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

  if (!offen) {
    return (
      <div className={stile.container}>
        <Button
          variante="text"
          onClick={() => setzeOffen(true)}
          aria-expanded={false}
        >
          Zuständiges Gericht ermitteln (PLZ)
        </Button>
      </div>
    )
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
          aria-label="Postleitzahl für Gerichtssuche"
        />
        <Button variante="sekundaer" onClick={() => suche(plz)}>
          Suchen
        </Button>
        <Button
          variante="text"
          onClick={() => {
            setzeOffen(false)
            setzeErgebnis(null)
            setzePlz('')
          }}
          aria-expanded={true}
        >
          Schließen
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
