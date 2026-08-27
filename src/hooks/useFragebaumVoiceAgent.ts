/**
 * React Hook zur Steuerung des ElevenLabs Conversational AI Sprachagenten
 * für den Erbe-Fragebaum mit iOS/WebKit Audio-Unlock und robuster Fehlerbehandlung.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { Conversation } from '@elevenlabs/client'
import { WURZEL, knoten as holeKnoten } from '../services/fragebaumService.ts'
import {
  extrahiereFaktenAusSprache,
  findeFolgeknoten,
  formatiereSprachausgabe,
  type SyncFragebaumNodeArgs,
} from '../services/voiceAgentService.ts'
import type { SprachagentStatus } from '../types/fragebaum.ts'

export type { SprachagentStatus }

export interface VoiceAgentOptions {
  agentId?: string
  personName?: string
  startKnotenId?: string
  startPfad?: string[]
  onNodeChange?: (nodeId: string, pfad: string[], isComplete: boolean) => void
  onComplete?: (nodeId: string, pfad: string[]) => void
  onAutoEnd?: (nodeId: string, pfad: string[]) => void
}

type ActiveConversation = Awaited<ReturnType<typeof Conversation.startSession>>

let sharedAudioContext: AudioContext | null = null

/**
 * Erzeugt oder liefert einen gemeinsamen AudioContext für WebKit/iOS.
 */
export function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null
  const AudioContextClass =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!AudioContextClass) return null
  if (!sharedAudioContext || sharedAudioContext.state === 'closed') {
    try {
      sharedAudioContext = new AudioContextClass()
    } catch (e) {
      console.warn('AudioContext konnte nicht erzeugt werden:', e)
    }
  }
  return sharedAudioContext
}

/**
 * Entsperrt den WebKit/iOS AudioContext synchron in einer Benutzergeste.
 * Spielt einen 1-Sample Silent Buffer ab, um das WebKit-Audiosystem zu aktivieren.
 */
export async function unlockAudioContext(): Promise<boolean> {
  if (typeof window === 'undefined') return false
  try {
    const ctx = getAudioContext()
    if (ctx) {
      if (ctx.state === 'suspended') {
        await ctx.resume()
      }
      const buffer = ctx.createBuffer(1, 1, 22050)
      const source = ctx.createBufferSource()
      source.buffer = buffer
      source.connect(ctx.destination)
      source.start(0)
    }

    // Zusätzlicher HTML5-Audio Unlock für älteres Mobile Safari
    const audio = new Audio('data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=')
    audio.volume = 0.01
    const p = audio.play()
    if (p !== undefined) {
      p.catch(() => {
        // Ignorieren falls blockiert
      })
    }
    return true
  } catch (err) {
    console.warn('iOS AudioContext Unlock fehlgeschlagen:', err)
    return false
  }
}

export function useFragebaumVoiceAgent({
  agentId = (import.meta.env?.VITE_ELEVENLABS_AGENT_ID as string | undefined) ?? '',
  personName = 'die verstorbene Person',
  startKnotenId = WURZEL,
  startPfad = [WURZEL],
  onNodeChange,
  onComplete,
  onAutoEnd,
}: VoiceAgentOptions = {}) {
  const [status, setzeStatus] = useState<SprachagentStatus>('idle')
  const [knotenId, setzeKnotenId] = useState<string>(startKnotenId)
  const [pfad, setzePfad] = useState<string[]>(startPfad)
  const [isComplete, setzeIsComplete] = useState<boolean>(false)
  const [isMuted, setzeIsMuted] = useState<boolean>(false)
  const [lautstaerke, setzeLautstaerke] = useState<number>(0)
  const [nachricht, setzeNachricht] = useState<string>('')
  const [liveText, setzeLiveText] = useState<string>('')
  const [letzterSprecher, setzeLetzterSprecher] = useState<'ai' | 'user'>('ai')
  const [frageText, setzeFrageText] = useState<string>('')
  const [antwortOptionen, setzeAntwortOptionen] = useState<string[]>([])
  const [fehler, setzeFehler] = useState<string | null>(null)

  // Referenzen für Session, Timer und Animation
  const conversationRef = useRef<ActiveConversation | null>(null)
  const animFrameRef = useRef<number | null>(null)
  const autoEndTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const connectionTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const knotenIdRef = useRef<string>(startKnotenId)
  const pfadRef = useRef<string[]>(startPfad)
  const isCompleteRef = useRef<boolean>(false)
  const onNodeChangeRef = useRef(onNodeChange)
  const onCompleteRef = useRef(onComplete)
  const onAutoEndRef = useRef(onAutoEnd)

  // Globaler iOS Audio Unlock bei erster Interaktion (touchstart / click)
  useEffect(() => {
    if (typeof window === 'undefined') return
    const unlock = () => {
      void unlockAudioContext()
    }
    const ereignisse = ['touchstart', 'touchend', 'click', 'pointerdown'] as const
    ereignisse.forEach((e) => {
      window.addEventListener(e, unlock, { capture: true, once: true, passive: true })
    })
    return () => {
      ereignisse.forEach((e) => {
        window.removeEventListener(e, unlock, { capture: true })
      })
    }
  }, [])

  useEffect(() => {
    onNodeChangeRef.current = onNodeChange
    onCompleteRef.current = onComplete
    onAutoEndRef.current = onAutoEnd
  }, [onNodeChange, onComplete, onAutoEnd])

  const stoppeAutoEndTimer = useCallback(() => {
    if (autoEndTimerRef.current !== null) {
      clearTimeout(autoEndTimerRef.current)
      autoEndTimerRef.current = null
    }
  }, [])

  const stoppeConnectionTimeout = useCallback(() => {
    if (connectionTimeoutRef.current !== null) {
      clearTimeout(connectionTimeoutRef.current)
      connectionTimeoutRef.current = null
    }
  }, [])

  const stopVolumeMonitoring = useCallback(() => {
    if (animFrameRef.current !== null) {
      cancelAnimationFrame(animFrameRef.current)
      animFrameRef.current = null
    }
    setzeLautstaerke(0)
  }, [])

  // Audio-Volumen Animation Loop (nur nach erfolgreichem Connect und fehlertolerant)
  const startVolumeMonitoring = useCallback(() => {
    stopVolumeMonitoring()
    const updateVolume = () => {
      if (conversationRef.current) {
        try {
          const conv = conversationRef.current as unknown as {
            getInputVolume?: () => number
            getOutputVolume?: () => number
          }
          const inputVol = typeof conv.getInputVolume === 'function' ? conv.getInputVolume() : 0
          const outputVol = typeof conv.getOutputVolume === 'function' ? conv.getOutputVolume() : 0
          const maxVol = Math.max(inputVol, outputVol)
          setzeLautstaerke(Math.min(1, Math.max(0, maxVol)))

          if (inputVol > 0.05) {
            // Nutzer spricht noch -> AutoEnd aufschieben
            stoppeAutoEndTimer()
          }
        } catch {
          // Ignorieren falls Pegelmessung nicht verfügbar
        }
      }
      animFrameRef.current = requestAnimationFrame(updateVolume)
    }
    animFrameRef.current = requestAnimationFrame(updateVolume)
  }, [stoppeAutoEndTimer, stopVolumeMonitoring])

  // Startet den 3-Sekunden-Timer zum automatischen Beenden, wenn das Ende erreicht wurde
  const starteAutoEndTimerFallsFertig = useCallback(() => {
    stoppeAutoEndTimer()
    if (!isCompleteRef.current) return

    autoEndTimerRef.current = setTimeout(() => {
      stopVolumeMonitoring()
      if (conversationRef.current) {
        try {
          conversationRef.current.endSession?.()
        } catch {
          // Ignorieren
        }
        conversationRef.current = null
      }
      setzeStatus('idle')
      onAutoEndRef.current?.(knotenIdRef.current, pfadRef.current)
    }, 3000)
  }, [stoppeAutoEndTimer, stopVolumeMonitoring])

  const aktualisiereKnoten = useCallback(
    (neueKnotenId: string, neuerPfad: string[], fertig = false) => {
      knotenIdRef.current = neueKnotenId
      pfadRef.current = neuerPfad
      setzeKnotenId(neueKnotenId)
      setzePfad(neuerPfad)

      const k = holeKnoten(neueKnotenId)
      const istErgebnis = fertig || k?.art === 'ergebnis'
      isCompleteRef.current = istErgebnis
      setzeIsComplete(istErgebnis)

      if (k) {
        const formatierterText = formatiereSprachausgabe(k, personName)
        setzeNachricht(formatierterText)
        setzeFrageText(formatierterText)
        setzeLiveText(formatierterText)
        setzeLetzterSprecher('ai')
        setzeAntwortOptionen(k.art === 'frage' ? k.antworten.map((a) => a.text) : [])

        if (istErgebnis) {
          onCompleteRef.current?.(neueKnotenId, neuerPfad)
        }
      }

      onNodeChangeRef.current?.(neueKnotenId, neuerPfad, istErgebnis)
    },
    [personName],
  )

  // Tool-Handler für ElevenLabs Client Tool
  const handleClientToolSync = useCallback(
    (args: SyncFragebaumNodeArgs) => {
      const { nodeId, path, isComplete: fertig } = args
      const k = holeKnoten(nodeId)
      const istErgebnis = fertig || k?.art === 'ergebnis'
      aktualisiereKnoten(nodeId, path, istErgebnis)
      return 'Knoten erfolgreich synchronisiert. Wiederhole die Frage nicht, sondern warte auf die Antwort des Nutzers.'
    },
    [aktualisiereKnoten],
  )

  // Startet den Sprachdialog mit synchronem iOS Audio-Unlock vor der Session
  const starteSitzung = useCallback(
    async (initKnotenId = knotenIdRef.current, initPfad = pfadRef.current) => {
      stoppeAutoEndTimer()
      stoppeConnectionTimeout()
      setzeFehler(null)
      setzeStatus('connecting')
      knotenIdRef.current = initKnotenId
      pfadRef.current = initPfad
      isCompleteRef.current = false
      setzeKnotenId(initKnotenId)
      setzePfad(initPfad)
      setzeIsComplete(false)

      // 1) iOS/WebKit Audio-Unlock SOFORT synchron in der Geste anstoßen
      void unlockAudioContext()

      const k = holeKnoten(initKnotenId)
      if (k) {
        const text = formatiereSprachausgabe(k, personName)
        setzeNachricht(text)
        setzeFrageText(text)
        setzeLiveText(text)
        setzeLetzterSprecher('ai')
        setzeAntwortOptionen(k.art === 'frage' ? k.antworten.map((a) => a.text) : [])
      }

      // Prüfe Browser-Unterstützung für Audio/Mikrofon
      if (typeof window === 'undefined') {
        return
      }

      if (!navigator?.mediaDevices?.getUserMedia) {
        setzeFehler('Mikrofonzugriff wird von diesem Browser oder auf ungesicherten Verbindungen (HTTP) nicht unterstützt.')
        setzeStatus('error')
        return
      }

      // Falls keine echte Agent ID vorliegt: Simulierter Modus
      if (!agentId || agentId.trim() === '') {
        setzeFehler('Keine ElevenLabs Agent ID hinterlegt (VITE_ELEVENLABS_AGENT_ID fehlt).')
        setzeStatus('error')
        return
      }

      // 15-Sekunden Timeout-Schutz gegen endloses "connecting"
      connectionTimeoutRef.current = setTimeout(() => {
        if (conversationRef.current === null) {
          console.error('ElevenLabs Verbindungstimeout nach 15 Sekunden')
          setzeFehler('Zeitüberschreitung beim Verbindungsaufbau mit dem Sprachassistenten. Bitte prüfen Sie Ihre Verbindung.')
          setzeStatus('error')
        }
      }, 15000)

      try {
        // Vor startSession nochmals sicherstellen, dass AudioContext aktiv ist
        await unlockAudioContext()

        // Conversation.startSession fordert Mikrofon selbst an (kein doppelter getUserMedia nötig)
        const conv = await Conversation.startSession({
          agentId,
          clientTools: {
            syncFragebaumNode: async (params: Record<string, unknown>) =>
              handleClientToolSync(params as unknown as SyncFragebaumNodeArgs),
          },
          onConnect: () => {
            stoppeConnectionTimeout()
            setzeFehler(null)
            setzeStatus('listening')
            startVolumeMonitoring()
          },
          onDisconnect: () => {
            stoppeConnectionTimeout()
            setzeStatus('idle')
            stopVolumeMonitoring()
            stoppeAutoEndTimer()
          },
          onError: (err: unknown) => {
            stoppeConnectionTimeout()
            console.error('ElevenLabs Conversation Error:', err)
            let nachrichtFehler = 'Fehler bei der Sprachverbindung.'
            if (typeof err === 'string') {
              nachrichtFehler = err
            } else if (err instanceof Error) {
              nachrichtFehler = err.message
            } else if (typeof err === 'object' && err !== null && 'message' in err) {
              nachrichtFehler = String((err as { message: unknown }).message)
            }
            setzeFehler(nachrichtFehler)
            setzeStatus('error')
            stopVolumeMonitoring()
            stoppeAutoEndTimer()
          },
          onModeChange: ({ mode }: { mode: 'speaking' | 'listening' }) => {
            setzeStatus(mode === 'speaking' ? 'speaking' : 'listening')
            if (mode === 'listening' && isCompleteRef.current) {
              // Agent hat zu Ende gesprochen und wir sind am Ergebnis: 3-Sekunden-Timer für AutoEnd
              starteAutoEndTimerFallsFertig()
            }
          },
          onMessage: ({ message, source }: { message: string; source: 'user' | 'ai' }) => {
            setzeLetzterSprecher(source)
            setzeLiveText(message)
            if (source === 'user') {
              stoppeAutoEndTimer()
              // Kontext & Fakten prüfen
              const fakten = extrahiereFaktenAusSprache(message)
              if (fakten.istErbe || fakten.hatTestament || fakten.willErbe || fakten.verwandtschaft) {
                const folge = findeFolgeknoten(knotenIdRef.current, message)
                if (folge) {
                  aktualisiereKnoten(folge.zielId, [...pfadRef.current, folge.zielId])
                }
              }
            } else if (source === 'ai') {
              setzeNachricht(message)
              if (isCompleteRef.current) {
                starteAutoEndTimerFallsFertig()
              }
            }
          },
        })

        conversationRef.current = conv
      } catch (err: unknown) {
        stoppeConnectionTimeout()
        console.error('Konnte Sprachagent nicht starten:', err)
        let nachrichtFehler = 'Mikrofonzugriff verweigert oder Verbindung fehlgeschlagen.'
        if (err instanceof Error) {
          if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
            nachrichtFehler = 'Mikrofonzugriff wurde verweigert. Bitte erlauben Sie den Zugriff in den iOS/Browser-Einstellungen.'
          } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
            nachrichtFehler = 'Kein Mikrofon gefunden. Bitte schließen Sie ein Mikrofon an.'
          } else {
            nachrichtFehler = err.message || 'Verbindung zum Sprachassistenten fehlgeschlagen.'
          }
        } else if (typeof err === 'string') {
          nachrichtFehler = err
        }
        setzeFehler(nachrichtFehler)
        setzeStatus('error')
        stopVolumeMonitoring()
        stoppeAutoEndTimer()
      }
    },
    [
      agentId,
      handleClientToolSync,
      personName,
      startVolumeMonitoring,
      stopVolumeMonitoring,
      aktualisiereKnoten,
      stoppeAutoEndTimer,
      stoppeConnectionTimeout,
      starteAutoEndTimerFallsFertig,
    ],
  )

  // Beendet die Sitzung und liefert den finalen Stand zurück
  const beendeSitzung = useCallback(() => {
    stoppeConnectionTimeout()
    stoppeAutoEndTimer()
    stopVolumeMonitoring()
    if (conversationRef.current) {
      try {
        conversationRef.current.endSession?.()
      } catch {
        // Ignorieren
      }
      conversationRef.current = null
    }
    setzeStatus('idle')
    return {
      knotenId: knotenIdRef.current,
      pfad: pfadRef.current,
      isComplete: holeKnoten(knotenIdRef.current)?.art === 'ergebnis',
    }
  }, [stopVolumeMonitoring, stoppeAutoEndTimer, stoppeConnectionTimeout])

  // Pausiert / schaltet stumm
  const togglestumm = useCallback(() => {
    stoppeAutoEndTimer()
    const conv = conversationRef.current as unknown as { setMuted?: (muted: boolean) => void } | null
    if (status === 'paused') {
      conv?.setMuted?.(false)
      setzeIsMuted(false)
      setzeStatus('listening')
    } else {
      conv?.setMuted?.(true)
      setzeIsMuted(true)
      setzeStatus('paused')
    }
  }, [status, stoppeAutoEndTimer])

  // Manuelle/Simulierte Antwortverarbeitung (z. B. für Tests oder Tastatur-Antworten im Sprachmodus)
  const verarbeiteAntwort = useCallback(
    (antwortText: string) => {
      stoppeAutoEndTimer()
      setzeLetzterSprecher('user')
      setzeLiveText(antwortText)
      const aktuell = holeKnoten(knotenIdRef.current)
      if (!aktuell || aktuell.art !== 'frage') {
        return
      }

      const folge = findeFolgeknoten(knotenIdRef.current, antwortText)
      if (folge) {
        const neuerPfad = [...pfadRef.current, folge.zielId]
        aktualisiereKnoten(folge.zielId, neuerPfad)
      }
    },
    [aktualisiereKnoten, stoppeAutoEndTimer],
  )

  // Cleanup bei Unmount
  useEffect(() => {
    return () => {
      stoppeConnectionTimeout()
      stoppeAutoEndTimer()
      stopVolumeMonitoring()
      if (conversationRef.current) {
        try {
          conversationRef.current.endSession?.()
        } catch {
          // Ignorieren
        }
      }
    }
  }, [stopVolumeMonitoring, stoppeAutoEndTimer, stoppeConnectionTimeout])

  return {
    status,
    knotenId,
    pfad,
    isComplete,
    isMuted,
    lautstaerke,
    nachricht,
    liveText,
    letzterSprecher,
    frageText,
    antwortOptionen,
    fehler,
    starteSitzung,
    beendeSitzung,
    togglestumm,
    verarbeiteAntwort,
    aktualisiereKnoten,
  }
}
