import { useEffect, useRef, useState } from 'react'

/**
 * Scannt einen QR-Code über die Gerätekamera (Punkt 5 der Kopplungs-Anforderungen).
 *
 * Genutzt wird ausschließlich die native `BarcodeDetector`-Web-API. Sie liest
 * direkt aus dem `<video>`-Element; ein eigener Canvas-Frame-Grab wäre hier
 * eine zweite, selbst gebaute Bildverarbeitung für etwas, das der Browser
 * schon kann, wo er es kann.
 *
 * Bewusst ohne Fallback-Bibliothek (z. B. jsQR) für Browser ohne
 * `BarcodeDetector` (vor allem Safari/iOS, Stand 2026): Das Scannen ist in
 * dieser App ausdrücklich nur die bequemere Alternative zum Eintippen
 * (§6) und niemals der einzige Weg. Eine zusätzliche, dauerhaft
 * mitgeschleppte Dekodierbibliothek allein für die Geräte, denen die
 * native API fehlt, wiegt schwerer als der Bequemlichkeitsgewinn; wo sie
 * fehlt, bleibt der Hinweistext, und der Kopplungscode lässt sich weiterhin
 * von Hand eingeben.
 */

/**
 * `BarcodeDetector` steht (Stand TypeScript 5.9) in keiner der `lib.dom.d.ts`.
 * Nur das Nötigste hier deklariert, nicht die volle Spezifikation.
 */
declare global {
  interface BarcodeDetectorTreffer {
    rawValue: string
  }

  interface Window {
    BarcodeDetector?: {
      new (options?: { formats: string[] }): {
        detect: (quelle: CanvasImageSource) => Promise<BarcodeDetectorTreffer[]>
      }
    }
  }
}

export type ScanZustand =
  | { status: 'nicht-unterstuetzt' }
  | { status: 'startet' }
  | { status: 'aktiv' }
  | { status: 'fehler'; nachricht: string }

/** Wie oft je Sekunde ein Kamerabild auf einen QR-Code hin geprüft wird. */
const ABSTAND_MS = 300

export type Scandaten = {
  zustand: ScanZustand
  /** Ans `<video>`-Element der aufrufenden Seite zu hängen. */
  videoRef: React.RefObject<HTMLVideoElement | null>
}

/** Ob dieser Browser überhaupt scannen kann, ohne dafür die Kamera zu fragen. */
export function scannenUnterstuetzt(): boolean {
  return typeof window !== 'undefined' && window.BarcodeDetector !== undefined
}

/** Eine verständliche deutsche Meldung zu dem, was beim Kamerazugriff schiefging. */
function fehlermeldung(fehler: unknown): string {
  if (fehler instanceof DOMException && fehler.name === 'NotAllowedError') {
    return 'Der Zugriff auf die Kamera wurde nicht erlaubt. Bitte erlauben Sie ihn in den Einstellungen des Browsers, oder tippen Sie den Code stattdessen ein.'
  }

  if (fehler instanceof DOMException && fehler.name === 'NotFoundError') {
    return 'Dieses Gerät hat keine nutzbare Kamera. Bitte tippen Sie den Code stattdessen ein.'
  }

  return 'Die Kamera war nicht zu öffnen. Bitte tippen Sie den Code stattdessen ein.'
}

/**
 * Öffnet die Kamera und ruft `onErkannt` mit dem Text des ersten erkannten
 * QR-Codes auf, solange `aktiv` steht.
 *
 * Die Kamera wird sauber wieder freigegeben: bei jedem Abräumen des Effekts,
 * also beim Ausschalten (`aktiv` wird `false`) ebenso wie beim Unmount. Ein
 * Stream, der offenbleibt, ist ein bekanntes Bug-Muster, und außerdem eine
 * Kamera, die für die einladende Person sichtbar weiterläuft, nachdem sie die
 * Scan-Ansicht längst geschlossen hat.
 *
 * `onErkannt` wird höchstens einmal pro Aktivierung gerufen: Sobald ein Code
 * erkannt ist, hält der Takt an. Die aufrufende Seite entscheidet, was mit dem
 * Text geschieht (hier: dieselbe Normalisierung wie eine getippte Eingabe).
 */
export function useQrScanner(aktiv: boolean, onErkannt: (wert: string) => void): Scandaten {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const [zustand, setzeZustand] = useState<ScanZustand>(
    scannenUnterstuetzt() ? { status: 'startet' } : { status: 'nicht-unterstuetzt' },
  )

  /*
   * In einer Ref, nicht in den Abhängigkeiten des Effekts: `onErkannt` ist bei
   * jedem Rendern der aufrufenden Seite eine neue Funktion. Stünde sie in den
   * Abhängigkeiten, risse jeder Tastendruck woanders auf dem Screen die Kamera
   * neu auf. Die Zuweisung selbst steht in einem eigenen Effekt: Ein Schreiben
   * auf eine Ref gehört nicht in den Render-Durchlauf.
   */
  const onErkanntRef = useRef(onErkannt)
  useEffect(() => {
    onErkanntRef.current = onErkannt
  })

  useEffect(() => {
    if (!aktiv || !scannenUnterstuetzt()) {
      return
    }

    let abgeraeumt = false
    let stream: MediaStream | null = null
    let takt: ReturnType<typeof setInterval> | null = null
    // Das Video-Element dieses Laufs, festgehalten statt beim Abräumen erneut
    // aus der Ref gelesen: Die Ref kann sich bis dahin längst geändert haben.
    let videoElement: HTMLVideoElement | null = null

    function stoppeTakt() {
      if (takt !== null) {
        clearInterval(takt)
        takt = null
      }
    }

    void (async () => {
      setzeZustand({ status: 'startet' })

      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
          audio: false,
        })

        if (abgeraeumt) {
          stream.getTracks().forEach((spur) => spur.stop())
          return
        }

        const video = videoRef.current

        if (video === null || window.BarcodeDetector === undefined) {
          stream.getTracks().forEach((spur) => spur.stop())
          return
        }

        videoElement = video
        video.srcObject = stream
        await video.play()

        if (abgeraeumt) {
          return
        }

        const detector = new window.BarcodeDetector({ formats: ['qr_code'] })

        setzeZustand({ status: 'aktiv' })

        takt = setInterval(() => {
          void (async () => {
            const aktuellesVideo = videoRef.current

            if (aktuellesVideo === null) {
              return
            }

            try {
              const treffer = await detector.detect(aktuellesVideo)
              const erster = treffer[0]

              if (!abgeraeumt && erster !== undefined) {
                // Der Takt hält an, sobald etwas erkannt ist: Ohne diesen Stopp
                // riefe der nächste Frame `onErkannt` ein zweites Mal auf,
                // während die aufrufende Seite noch mit dem ersten Treffer
                // beschäftigt ist.
                stoppeTakt()
                onErkanntRef.current(erster.rawValue)
              }
            } catch {
              // Ein einzelner missglückter Frame ist kein Fehler für die
              // Oberfläche: Der nächste Takt versucht es erneut.
            }
          })()
        }, ABSTAND_MS)
      } catch (fehler) {
        if (!abgeraeumt) {
          setzeZustand({ status: 'fehler', nachricht: fehlermeldung(fehler) })
        }
      }
    })()

    return () => {
      abgeraeumt = true
      stoppeTakt()

      if (stream !== null) {
        stream.getTracks().forEach((spur) => spur.stop())
      }

      if (videoElement !== null) {
        videoElement.srcObject = null
      }
    }
  }, [aktiv])

  return { zustand, videoRef }
}
