/**
 * React Hook zur Steuerung des Sprachagenten für den Erbe-Fragebaum.
 *
 * Unterstützt sowohl ElevenLabs Conversational AI als auch native Web Speech API
 * (SpeechSynthesis und SpeechRecognition auf Deutsch) mit automatischer
 * Lautstärke- und Orb-Animation.
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

interface WebSpeechRecognitionEvent {
  resultIndex: number
  results: {
    length: number
    [index: number]: {
      isFinal: boolean
      [index: number]: {
        transcript: string
      }
    }
  }
}

interface WebSpeechRecognitionErrorEvent {
  error: string
  message?: string
}

interface WebSpeechRecognitionInstance {
  lang: string
  continuous: boolean
  interimResults: boolean
  maxAlternatives: number
  onstart: (() => void) | null
  onresult: ((event: WebSpeechRecognitionEvent) => void) | null
  onerror: ((event: WebSpeechRecognitionErrorEvent) => void) | null
  onend: (() => void) | null
  start: () => void
  stop: () => void
  abort: () => void
}

type SpeechRecognitionConstructor = new () => WebSpeechRecognitionInstance

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

  // Referenzen für Session, Audio, Timer und Zustand
  const conversationRef = useRef<ActiveConversation | null>(null)
  const speechSynthUtteranceRef = useRef<SpeechSynthesisUtterance | null>(null)
  const speechRecognitionRef = useRef<WebSpeechRecognitionInstance | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const mediaStreamRef = useRef<MediaStream | null>(null)
  const animFrameRef = useRef<number | null>(null)
  const speakingPulseIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const keepAliveIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const autoEndTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const statusRef = useRef<SprachagentStatus>('idle')
  const isMutedRef = useRef<boolean>(false)
  const knotenIdRef = useRef<string>(startKnotenId)
  const pfadRef = useRef<string[]>(startPfad)
  const isCompleteRef = useRef<boolean>(false)
  const personNameRef = useRef<string>(personName)
  const onNodeChangeRef = useRef(onNodeChange)
  const onCompleteRef = useRef(onComplete)
  const onAutoEndRef = useRef(onAutoEnd)

  useEffect(() => {
    statusRef.current = status
  }, [status])

  useEffect(() => {
    isMutedRef.current = isMuted
  }, [isMuted])

  useEffect(() => {
    personNameRef.current = personName
    onNodeChangeRef.current = onNodeChange
    onCompleteRef.current = onComplete
    onAutoEndRef.current = onAutoEnd
  }, [personName, onNodeChange, onComplete, onAutoEnd])

  const stoppeAutoEndTimer = useCallback(() => {
    if (autoEndTimerRef.current !== null) {
      clearTimeout(autoEndTimerRef.current)
      autoEndTimerRef.current = null
    }
  }, [])

  const stoppeSprechenAnimation = useCallback(() => {
    if (speakingPulseIntervalRef.current !== null) {
      clearInterval(speakingPulseIntervalRef.current)
      speakingPulseIntervalRef.current = null
    }
    if (keepAliveIntervalRef.current !== null) {
      clearInterval(keepAliveIntervalRef.current)
      keepAliveIntervalRef.current = null
    }
    setzeLautstaerke(0)
  }, [])

  const starteSprechenAnimation = useCallback(() => {
    stoppeSprechenAnimation()
    let step = 0
    speakingPulseIntervalRef.current = setInterval(() => {
      step += 0.25
      const wave = (Math.sin(step) + 1) / 2
      const randomJitter = (Math.random() - 0.5) * 0.2
      const vol = Math.min(1, Math.max(0.2, 0.35 + wave * 0.45 + randomJitter))
      setzeLautstaerke(vol)
    }, 90)
  }, [stoppeSprechenAnimation])

  const stoppeSprachausgabe = useCallback(() => {
    stoppeSprechenAnimation()
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      try {
        window.speechSynthesis.cancel()
      } catch {
        // Ignorieren
      }
    }
    speechSynthUtteranceRef.current = null
  }, [stoppeSprechenAnimation])

  const stoppeSpracherkennung = useCallback(() => {
    if (speechRecognitionRef.current) {
      try {
        speechRecognitionRef.current.onstart = null
        speechRecognitionRef.current.onresult = null
        speechRecognitionRef.current.onerror = null
        speechRecognitionRef.current.onend = null
        speechRecognitionRef.current.stop()
      } catch {
        // Ignorieren
      }
      speechRecognitionRef.current = null
    }
  }, [])

  const stoppeAudioContext = useCallback(() => {
    if (animFrameRef.current !== null) {
      cancelAnimationFrame(animFrameRef.current)
      animFrameRef.current = null
    }
    if (mediaStreamRef.current) {
      try {
        for (const track of mediaStreamRef.current.getTracks()) {
          track.stop()
        }
      } catch {
        // Ignorieren
      }
      mediaStreamRef.current = null
    }
    if (audioContextRef.current) {
      try {
        void audioContextRef.current.close()
      } catch {
        // Ignorieren
      }
      audioContextRef.current = null
    }
    setzeLautstaerke(0)
  }, [])

  // Startet den 3-Sekunden-Timer zum automatischen Beenden, wenn das Ende erreicht wurde
  const starteAutoEndTimerFallsFertig = useCallback(() => {
    stoppeAutoEndTimer()
    if (!isCompleteRef.current) return

    autoEndTimerRef.current = setTimeout(() => {
      stoppeSprachausgabe()
      stoppeSpracherkennung()
      stoppeAudioContext()
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
    }, 3200)
  }, [stoppeAutoEndTimer, stoppeSprachausgabe, stoppeSpracherkennung, stoppeAudioContext])

  // Aktualisiert den Knoten und Synchronisation
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
        const formatierterText = formatiereSprachausgabe(k, personNameRef.current)
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
    [],
  )

  // Startet das Mikrofon-Pegel-Monitoring via Web Audio API
  const starteMikrofonLautstaerke = useCallback((stream: MediaStream) => {
    if (typeof window === 'undefined') return
    try {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!AudioCtx) return

      const ctx = new AudioCtx()
      audioContextRef.current = ctx
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 256
      const source = ctx.createMediaStreamSource(stream)
      source.connect(analyser)

      const dataArray = new Uint8Array(analyser.frequencyBinCount)

      const updateVol = () => {
        if (statusRef.current === 'listening' && !isMutedRef.current) {
          analyser.getByteFrequencyData(dataArray)
          let sum = 0
          for (let i = 0; i < dataArray.length; i++) {
            sum += dataArray[i]!
          }
          const avg = sum / dataArray.length
          const normVol = Math.min(1, Math.max(0, avg / 128))
          setzeLautstaerke(normVol)
          if (normVol > 0.08) {
            stoppeAutoEndTimer()
          }
        }
        animFrameRef.current = requestAnimationFrame(updateVol)
      }
      animFrameRef.current = requestAnimationFrame(updateVol)
    } catch {
      // Web Audio nicht unterstützt oder blockiert
    }
  }, [stoppeAutoEndTimer])

  // Vorwärtsdeklaration für Rekursion
  const sprichTextRef = useRef<(text: string, onEnde?: () => void) => void>(() => {})
  const starteSpracherkennungRef = useRef<() => void>(() => {})

  // Verarbeitet die erkannte Antwort des Nutzers
  const verarbeiteNutzerAntwort = useCallback(
    (nutzerAntwort: string) => {
      stoppeSpracherkennung()
      stoppeAutoEndTimer()
      setzeLetzterSprecher('user')
      setzeLiveText(nutzerAntwort)

      const currentKnoten = holeKnoten(knotenIdRef.current)
      if (!currentKnoten) return

      // 1. Direkter Folgeknoten
      const folge = findeFolgeknoten(knotenIdRef.current, nutzerAntwort)
      if (folge) {
        const neuerPfad = [...pfadRef.current, folge.zielId]
        aktualisiereKnoten(folge.zielId, neuerPfad)
        const zielKnoten = holeKnoten(folge.zielId)
        if (zielKnoten) {
          const text = formatiereSprachausgabe(zielKnoten, personNameRef.current)
          sprichTextRef.current(text)
        }
        return
      }

      // 2. Faktenextraktion
      const fakten = extrahiereFaktenAusSprache(nutzerAntwort)
      if (fakten.istErbe || fakten.hatTestament || fakten.willErbe || fakten.verwandtschaft) {
        const folgeAusFakten = findeFolgeknoten(knotenIdRef.current, nutzerAntwort)
        if (folgeAusFakten) {
          const neuerPfad = [...pfadRef.current, folgeAusFakten.zielId]
          aktualisiereKnoten(folgeAusFakten.zielId, neuerPfad)
          const zielKnoten = holeKnoten(folgeAusFakten.zielId)
          if (zielKnoten) {
            const text = formatiereSprachausgabe(zielKnoten, personNameRef.current)
            sprichTextRef.current(text)
          }
          return
        }
      }

      // 3. Nicht verstanden
      if (currentKnoten.art === 'frage') {
        const optionen = currentKnoten.antworten.map((a) => a.text).join(' oder ')
        const hinweis = `Ich habe Sie nicht genau verstanden. Bitte antworten Sie mit: ${optionen}.`
        sprichTextRef.current(hinweis)
      }
    },
    [aktualisiereKnoten, stoppeAutoEndTimer, stoppeSpracherkennung],
  )

  // Startet native Spracherkennung
  const starteSpracherkennung = useCallback(() => {
    if (typeof window === 'undefined' || isMutedRef.current || isCompleteRef.current) return

    stoppeSpracherkennung()

    const SpeechRecognitionClass =
      (window as unknown as { SpeechRecognition?: SpeechRecognitionConstructor }).SpeechRecognition ||
      (window as unknown as { webkitSpeechRecognition?: SpeechRecognitionConstructor }).webkitSpeechRecognition

    if (!SpeechRecognitionClass) {
      return
    }

    try {
      const recognition = new SpeechRecognitionClass()
      recognition.lang = 'de-DE'
      recognition.continuous = false
      recognition.interimResults = true
      recognition.maxAlternatives = 1

      recognition.onstart = () => {
        if (!isMutedRef.current) {
          setzeStatus('listening')
        }
      }

      recognition.onresult = (event: WebSpeechRecognitionEvent) => {
        if (isMutedRef.current) return
        let interim = ''
        let finalTranscript = ''

        for (let i = event.resultIndex; i < event.results.length; ++i) {
          const res = event.results[i]
          if (res) {
            const trans = res[0]?.transcript ?? ''
            if (res.isFinal) {
              finalTranscript += trans
            } else {
              interim += trans
            }
          }
        }

        const userText = (finalTranscript || interim).trim()
        if (userText) {
          setzeLiveText(userText)
          setzeLetzterSprecher('user')
        }

        if (finalTranscript.trim()) {
          verarbeiteNutzerAntwort(finalTranscript.trim())
        }
      }

      recognition.onerror = (event: WebSpeechRecognitionErrorEvent) => {
        if (event.error === 'no-speech' && statusRef.current === 'listening' && !isMutedRef.current && !isCompleteRef.current) {
          setTimeout(() => {
            if (statusRef.current === 'listening' && !isMutedRef.current && !isCompleteRef.current) {
              starteSpracherkennungRef.current()
            }
          }, 400)
        }
      }

      recognition.onend = () => {
        if (statusRef.current === 'listening' && !isMutedRef.current && !isCompleteRef.current) {
          setTimeout(() => {
            if (statusRef.current === 'listening' && !isMutedRef.current && !isCompleteRef.current) {
              starteSpracherkennungRef.current()
            }
          }, 400)
        }
      }

      speechRecognitionRef.current = recognition
      recognition.start()
    } catch {
      // Spracherkennung konnte nicht initialisiert werden
    }
  }, [stoppeSpracherkennung, verarbeiteNutzerAntwort])

  starteSpracherkennungRef.current = starteSpracherkennung

  // Sprachtext-Ausgabe über Web Speech API
  const sprichText = useCallback(
    (textToSpeak: string, onEnde?: () => void) => {
      if (typeof window === 'undefined') return
      stoppeSprachausgabe()
      stoppeSpracherkennung()
      stoppeAutoEndTimer()

      if (window.speechSynthesis) {
        try {
          window.speechSynthesis.cancel()

          const utter = new SpeechSynthesisUtterance(textToSpeak)
          utter.lang = 'de-DE'
          utter.rate = 1.0
          utter.pitch = 1.0

          const voices = window.speechSynthesis.getVoices?.() ?? []
          const deVoice = voices.find((v) => v.lang.startsWith('de') || v.lang.includes('DE'))
          if (deVoice) {
            utter.voice = deVoice
          }

          utter.onstart = () => {
            if (isMutedRef.current) return
            setzeStatus('speaking')
            setzeLetzterSprecher('ai')
            starteSprechenAnimation()
          }

          utter.onend = () => {
            stoppeSprechenAnimation()
            if (isMutedRef.current) return

            if (isCompleteRef.current) {
              setzeStatus('listening')
              starteAutoEndTimerFallsFertig()
            } else {
              setzeStatus('listening')
              starteSpracherkennung()
            }
            onEnde?.()
          }

          utter.onerror = () => {
            stoppeSprechenAnimation()
            if (isMutedRef.current) return
            setzeStatus('listening')
            if (!isCompleteRef.current) {
              starteSpracherkennung()
            }
          }

          speechSynthUtteranceRef.current = utter
          window.speechSynthesis.speak(utter)

          // Chrome Keepalive Fix
          if (keepAliveIntervalRef.current !== null) {
            clearInterval(keepAliveIntervalRef.current)
          }
          keepAliveIntervalRef.current = setInterval(() => {
            if (window.speechSynthesis.speaking) {
              window.speechSynthesis.pause()
              window.speechSynthesis.resume()
            }
          }, 8000)
        } catch {
          setzeStatus('listening')
          starteSpracherkennung()
        }
      } else {
        setzeStatus('listening')
      }
    },
    [
      stoppeSprachausgabe,
      stoppeSpracherkennung,
      stoppeAutoEndTimer,
      starteSprechenAnimation,
      stoppeSprechenAnimation,
      starteAutoEndTimerFallsFertig,
      starteSpracherkennung,
    ],
  )

  sprichTextRef.current = sprichText

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

  // Startet den Sprachdialog
  const starteSitzung = useCallback(
    async (initKnotenId = knotenIdRef.current, initPfad = pfadRef.current) => {
      stoppeAutoEndTimer()
      stoppeSprachausgabe()
      stoppeSpracherkennung()
      setzeFehler(null)
      setzeStatus('connecting')
      knotenIdRef.current = initKnotenId
      pfadRef.current = initPfad
      isCompleteRef.current = false
      setzeKnotenId(initKnotenId)
      setzePfad(initPfad)
      setzeIsComplete(false)
      setzeIsMuted(false)
      isMutedRef.current = false

      const k = holeKnoten(initKnotenId)
      let initialText = ''
      if (k) {
        if (initKnotenId === WURZEL) {
          initialText =
            'Guten Tag. Ich begleite Sie gerne Schritt für Schritt durch den Fragebaum, um zu klären, welche Rechte, Pflichten und Fristen bezüglich des Erbes für Sie gelten. Zu Beginn: Wissen Sie bereits, ob Sie Erbe sind?'
        } else {
          initialText = formatiereSprachausgabe(k, personName)
        }
        setzeNachricht(initialText)
        setzeFrageText(initialText)
        setzeLiveText(initialText)
        setzeLetzterSprecher('ai')
        setzeAntwortOptionen(k.art === 'frage' ? k.antworten.map((a) => a.text) : [])
      }

      // Mikrofonzugriff für Pegelüberwachung
      if (typeof window !== 'undefined' && navigator?.mediaDevices?.getUserMedia) {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
          mediaStreamRef.current = stream
          starteMikrofonLautstaerke(stream)
        } catch {
          // Mikrofonzugriff nicht gewährt; fahre ohne Pegelanalyse fort
        }
      }

      // ElevenLabs Conversational AI versuchen, falls konfiguriert
      if (agentId && agentId.trim() !== '' && typeof window !== 'undefined' && navigator?.mediaDevices) {
        try {
          const conv = await Conversation.startSession({
            agentId,
            clientTools: {
              syncFragebaumNode: async (params: Record<string, unknown>) =>
                handleClientToolSync(params as unknown as SyncFragebaumNodeArgs),
            },
            onConnect: () => {
              setzeStatus('listening')
            },
            onDisconnect: () => {
              setzeStatus('idle')
              stoppeAutoEndTimer()
            },
            onError: (err: unknown) => {
              console.warn('ElevenLabs Error, wechsle auf Web Speech Engine:', err)
              conversationRef.current = null
              sprichText(initialText)
            },
            onModeChange: ({ mode }: { mode: 'speaking' | 'listening' }) => {
              setzeStatus(mode === 'speaking' ? 'speaking' : 'listening')
              if (mode === 'listening' && isCompleteRef.current) {
                starteAutoEndTimerFallsFertig()
              }
            },
            onMessage: ({ message, source }: { message: string; source: 'user' | 'ai' }) => {
              setzeLetzterSprecher(source)
              setzeLiveText(message)
              if (source === 'user') {
                stoppeAutoEndTimer()
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
          return
        } catch (err: unknown) {
          console.warn('ElevenLabs startSession fehlgeschlagen, wechsle auf Web Speech:', err)
        }
      }

      // Native Web Speech Ausgabe
      sprichText(initialText)
    },
    [
      agentId,
      handleClientToolSync,
      personName,
      aktualisiereKnoten,
      stoppeAutoEndTimer,
      stoppeSprachausgabe,
      stoppeSpracherkennung,
      starteMikrofonLautstaerke,
      sprichText,
      starteAutoEndTimerFallsFertig,
    ],
  )

  // Beendet die Sitzung und liefert den finalen Stand zurück
  const beendeSitzung = useCallback(() => {
    stoppeAutoEndTimer()
    stoppeSprachausgabe()
    stoppeSpracherkennung()
    stoppeAudioContext()
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
  }, [stoppeAutoEndTimer, stoppeSprachausgabe, stoppeSpracherkennung, stoppeAudioContext])

  // Pausiert / schaltet stumm
  const togglestumm = useCallback(() => {
    stoppeAutoEndTimer()
    const conv = conversationRef.current as unknown as { setMuted?: (muted: boolean) => void } | null
    if (statusRef.current === 'paused' || isMutedRef.current) {
      conv?.setMuted?.(false)
      setzeIsMuted(false)
      isMutedRef.current = false
      setzeStatus('listening')
      starteSpracherkennung()
    } else {
      conv?.setMuted?.(true)
      stoppeSprachausgabe()
      stoppeSpracherkennung()
      setzeIsMuted(true)
      isMutedRef.current = true
      setzeStatus('paused')
    }
  }, [stoppeAutoEndTimer, stoppeSprachausgabe, stoppeSpracherkennung, starteSpracherkennung])

  // Manuelle/Simulierte Antwortverarbeitung
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
        const zielKnoten = holeKnoten(folge.zielId)
        if (zielKnoten) {
          const text = formatiereSprachausgabe(zielKnoten, personNameRef.current)
          sprichText(text)
        }
      }
    },
    [aktualisiereKnoten, stoppeAutoEndTimer, sprichText],
  )

  // Cleanup bei Unmount
  useEffect(() => {
    return () => {
      stoppeAutoEndTimer()
      stoppeSprachausgabe()
      stoppeSpracherkennung()
      stoppeAudioContext()
      if (conversationRef.current) {
        try {
          conversationRef.current.endSession?.()
        } catch {
          // Ignorieren
        }
      }
    }
  }, [stoppeAutoEndTimer, stoppeSprachausgabe, stoppeSpracherkennung, stoppeAudioContext])

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
