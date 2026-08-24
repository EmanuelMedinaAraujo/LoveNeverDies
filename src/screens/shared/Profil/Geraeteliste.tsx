import { useState } from 'react'
import { useGeraete } from '../../../hooks/useGeraete.ts'
import type { Geraet } from '../../../services/geraeteService.ts'
import { gruppierterPruefcode } from '../../../services/kopplungService.ts'
import { Button } from '../../../ui/Button/Button.tsx'
import stile from './Profil.module.css'

/**
 * Profil → Geräte (DESIGN.md §3.6, §7).
 *
 * "Dieses Gerät · iPhone von Anna · Prüfcode 481 253". Mehr passiert hier
 * bewusst nicht: Gebraucht wird der Prüfcode erst beim Koppeln, wenn zwei
 * Menschen ihn am Telefon vergleichen. Ablesbar sein muss er ab jetzt.
 */

/*
 * Die Gruppierung steht im `kopplungService`. Dieselben sechs Ziffern zeigt
 * die andere Seite beim Koppeln, und sie müssen dort gleich aussehen (§3.6).
 */

function Zeile({
  geraet,
  umbenennen,
}: {
  geraet: Geraet
  umbenennen: (id: string, label: string) => Promise<void>
}) {
  const [entwurf, setzeEntwurf] = useState<string | null>(null)
  const [laeuft, setzeLaeuft] = useState(false)
  const [fehler, setzeFehler] = useState<string | null>(null)

  async function speichere() {
    if (entwurf === null || entwurf.trim() === '') {
      return
    }

    setzeLaeuft(true)
    setzeFehler(null)

    try {
      await umbenennen(geraet.id, entwurf)
      setzeEntwurf(null)
    } catch (ursache) {
      // Ohne diesen Zweig verschwände ein gescheitertes Umbenennen spurlos:
      // Das Feld bliebe offen, der Knopf wieder bedienbar, und nichts sagte,
      // dass der eingetippte Name nirgends angekommen ist.
      setzeFehler(ursache instanceof Error ? ursache.message : String(ursache))
    } finally {
      setzeLaeuft(false)
    }
  }

  return (
    <li className={stile.geraet}>
      <div className={stile.geraetKopf}>
        {geraet.diesesGeraet ? <span className={stile.badge}>Dieses Gerät</span> : null}
        <span className={stile.label}>{geraet.label}</span>
      </div>

      <p className={stile.pruefcode}>
        Prüfcode{' '}
        {/* Zum Vorlesen die Ziffern einzeln: Screenreader machen aus "481 253"
            sonst zwei Zahlwörter, und verglichen werden Ziffern. */}
        <span aria-hidden="true">{gruppierterPruefcode(geraet.pruefcode)}</span>
        <span className="nur-vorlesen">{[...geraet.pruefcode].join(' ')}</span>
      </p>

      {entwurf === null ? (
        <Button
          variante="sekundaer"
          onClick={() => setzeEntwurf(geraet.label)}
          vorleseText={`Gerät ${geraet.label} umbenennen`}
        >
          Umbenennen
        </Button>
      ) : (
        <div className={stile.umbenennen}>
          <label className="nur-vorlesen" htmlFor={`geraetename-${geraet.id}`}>
            Name dieses Geräts
          </label>
          <input
            id={`geraetename-${geraet.id}`}
            className={stile.eingabe}
            value={entwurf}
            onChange={(ereignis) => setzeEntwurf(ereignis.target.value)}
            autoFocus
          />
          <div className={stile.knoepfe}>
            <Button onClick={() => void speichere()} disabled={laeuft || entwurf.trim() === ''}>
              Speichern
            </Button>
            <Button
              variante="sekundaer"
              onClick={() => {
                setzeEntwurf(null)
                setzeFehler(null)
              }}
              disabled={laeuft}
            >
              Abbrechen
            </Button>
          </div>

          {fehler === null ? null : (
            <p className={stile.hinweis} role="alert">
              Der neue Name ist nicht angekommen. {fehler}
            </p>
          )}
        </div>
      )}
    </li>
  )
}

export function Geraeteliste() {
  const { zustand, umbenennen } = useGeraete()

  if (zustand.status === 'laedt') {
    return (
      <p className={stile.hinweis} role="status">
        Ihre Geräte werden geladen…
      </p>
    )
  }

  if (zustand.status === 'fehler') {
    return (
      <p className={stile.hinweis} role="alert">
        Ihre Geräte sind gerade nicht abrufbar. {zustand.nachricht}
      </p>
    )
  }

  if (zustand.geraete.length === 0) {
    // Nach einer erfolgreichen Anmeldung steht hier immer mindestens dieses
    // Gerät. Leer heißt: Die Registrierung kam nicht durch, kein Grund für
    // eine Fehlermeldung, aber auch keiner, eine leere Liste zu behaupten.
    return (
      <p className={stile.hinweis} role="status">
        Dieses Gerät ist noch nicht angemeldet. Sobald eine Verbindung besteht, holt die App das
        nach.
      </p>
    )
  }

  return (
    <ul className={stile.geraete}>
      {zustand.geraete.map((geraet) => (
        <Zeile key={geraet.id} geraet={geraet} umbenennen={umbenennen} />
      ))}
    </ul>
  )
}
