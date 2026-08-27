import { useEffect } from 'react'
import type { SprachagentStatus } from '../../types/fragebaum.ts'
import stile from './SprachagentBlase.module.css'

export interface SprachagentBlaseProps {
  status: SprachagentStatus
  isMuted: boolean
  lautstaerke?: number
  fehler?: string | null
  onPauseToggle: () => void
  onStop: () => void
  onRetry?: () => void
}

export function SprachagentBlase({
  status,
  isMuted,
  lautstaerke = 0,
  fehler = null,
  onPauseToggle,
  onStop,
  onRetry,
}: SprachagentBlaseProps) {
  // Tastatursteuerung: Escape beendet das Gespräch, Leertaste toggelt Stummschaltung
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        onStop()
      } else if (e.key === ' ' && e.target === document.body) {
        e.preventDefault()
        onPauseToggle()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onStop, onPauseToggle])

  const istHoeren = status === 'listening'
  const istSprechen = status === 'speaking'
  const istPausiert = status === 'paused' || isMuted
  const istVerbinden = status === 'connecting'
  const istFehler = status === 'error' || fehler !== null

  // Dynamische 3D-Skalierung des Orbs basierend auf der Lautstärke
  const scale = Math.min(1.22, 1 + lautstaerke * 0.25)
  const transformStyle = {
    transform: `scale(${scale})`,
  }

  let orbKlasse = stile.orb
  if (istFehler) {
    orbKlasse = `${stile.orb} ${stile.orbFehler}`
  } else if (istPausiert) {
    orbKlasse = `${stile.orb} ${stile.orbPausiert}`
  } else if (istSprechen) {
    orbKlasse = `${stile.orb} ${stile.orbSprechen}`
  } else if (istHoeren) {
    orbKlasse = `${stile.orb} ${stile.orbHoeren}`
  }

  return (
    <div
      className={stile.overlay}
      role="dialog"
      aria-modal="true"
      aria-label="Fragebaum Sprachassistent"
    >
      {/* Oberer Bereich: Verbindungs-Statusanzeige oben statt unten */}
      <div className={stile.kopf}>
        {istVerbinden && !fehler ? (
          <div className={stile.statusHinweisWrapper}>
            <span className={stile.statusPulsPunkt} />
            <p className={stile.statusHinweis}>Verbindung wird aufgebaut…</p>
          </div>
        ) : null}
      </div>

      <div className={stile.zentrum}>
        <div className={stile.orbContainer}>
          {/* Optische Hör- und Sprech-Indikator-Wellen */}
          {istHoeren ? <div className={stile.hoerenWelle} /> : null}
          {istSprechen ? <div className={stile.sprechenWelle} /> : null}

          {/* Der fotorealistische 3D Metallic Orb */}
          <div
            className={orbKlasse}
            style={transformStyle}
            onClick={istFehler ? onRetry : onPauseToggle}
            role="button"
            tabIndex={0}
            aria-label={
              istFehler
                ? 'Erneut versuchen'
                : istPausiert
                  ? 'Mikrofon einschalten'
                  : 'Mikrofon stummschalten'
            }
          >
            <div className={stile.orbGlanz} />
          </div>
        </div>

        {/* Fehlerbox direkt im Overlay */}
        {istFehler && fehler ? (
          <div className={stile.fehlerBox} role="alert">
            <h3 className={stile.fehlerTitel}>Verbindungsfehler</h3>
            <p className={stile.fehlerText}>{fehler}</p>
            <div className={stile.fehlerAktionen}>
              {onRetry ? (
                <button
                  type="button"
                  className={stile.fehlerKnopfSekundaer}
                  onClick={onRetry}
                >
                  Erneut versuchen
                </button>
              ) : null}
              <button
                type="button"
                className={stile.fehlerKnopfPrimaer}
                onClick={onStop}
              >
                Schließen
              </button>
            </div>
          </div>
        ) : null}
      </div>

      {/* Ausschließlich die beiden runden Knöpfe: Mute & Stop */}
      <div className={stile.knopfreihe}>
        {/* Runder Mute / Pause Knopf */}
        <button
          type="button"
          className={`${stile.kreisKnopf} ${stile.stummKnopf} ${istPausiert ? stile.stummKnopfAktiv : ''}`}
          onClick={onPauseToggle}
          disabled={istFehler}
          aria-label={istPausiert ? 'Mikrofon einschalten' : 'Mikrofon stummschalten'}
        >
          {istPausiert ? (
            <svg
              width="22"
              height="22"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <line x1="1" y1="1" x2="23" y2="23" />
              <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6" />
              <path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23" />
              <line x1="12" y1="19" x2="12" y2="23" />
              <line x1="8" y1="23" x2="16" y2="23" />
            </svg>
          ) : (
            <svg
              width="22"
              height="22"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
              <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
              <line x1="12" y1="19" x2="12" y2="22" />
              <line x1="8" y1="23" x2="16" y2="23" />
            </svg>
          )}
        </button>

        {/* Runder Stop / Beenden Knopf */}
        <button
          type="button"
          className={`${stile.kreisKnopf} ${stile.beendenKnopf}`}
          onClick={onStop}
          aria-label="Sprachdialog beenden"
        >
          <svg
            className={stile.telefonIcon}
            viewBox="0 0 24 24"
            fill="currentColor"
            width="22"
            height="22"
            aria-hidden="true"
          >
            <path d="M6.62 10.79a15.053 15.053 0 006.59 6.59l2.2-2.2a1 1 0 011.01-.24c1.12.37 2.33.57 3.58.57a1 1 0 011 1V20a1 1 0 01-1 1A17 17 0 013 4a1 1 0 011-1h3.5a1 1 0 011 1c0 1.25.2 2.46.57 3.58a1 1 0 01-.24 1.01l-2.21 2.2z" />
          </svg>
        </button>
      </div>
    </div>
  )
}
