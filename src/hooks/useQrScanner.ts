import { useEffect, useRef, useState } from 'react'

/**
 * Scannt einen QR-Code über die Gerätekamera (Punkt 5 der Kopplungs-Anforderungen).
 *
 * Zwei Wege, in dieser Reihenfolge:
 *
 * 1. `BarcodeDetector`, wo der Browser ihn mitbringt (Chrome, Edge, Android).
 *    Er liest direkt aus dem `<video>`-Element und dekodiert dort, wo das
 *    Betriebssystem es ohnehin am besten kann.
 * 2. `jsQR` sonst, aus einem Einzelbild auf einem Canvas.
 *
 * Der zweite Weg ist der Grund, warum diese Datei nicht mehr so aussieht wie
 * vorher. Safari kennt `BarcodeDetector` bis heute nicht — auf dem iPhone,
 * also auf genau den Geräten, an denen zwei Menschen nebeneinander sitzen und
 * einen Code scannen wollen, stand deshalb "Scannen wird auf diesem Gerät
 * nicht unterstützt". Ein Knopf, der nichts kann als das zu melden, ist kein
 * zweiter Weg, sondern eine Sackgasse mit Beschriftung.
 *
 * Die Dekodierbibliothek liegt hinter einem dynamischen `import`: Wer einen
 * Browser mit `BarcodeDetector` benutzt, lädt sie nie, und wer nicht scannt,
 * lädt sie auch dann nicht, wenn sein Browser sie bräuchte. Sie kommt erst mit
 * dem Tippen auf "Code scannen".
 *
 * Das Scannen bleibt in beiden Fällen die bequemere Alternative zum Eintippen
 * (§6) und niemals der einzige Weg: Ohne Kamera, ohne Erlaubnis oder ohne
 * beides steht der Code weiterhin zum Abtippen daneben.
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

/**
 * Ob dieses Gerät überhaupt scannen kann, ohne dafür die Kamera zu fragen.
 *
 * Gefragt wird nach der Kamera und nicht nach dem Dekodierer: Den bringt die
 * App seit dem `jsQR`-Zweig selbst mit. `getUserMedia` fehlt dagegen wirklich,
 * wenn die Seite nicht über HTTPS läuft — dann nimmt der Browser die ganze
 * `mediaDevices`-Schnittstelle weg, und kein Dekodierer der Welt bekommt ein
 * Bild.
 */
export function scannenUnterstuetzt(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    typeof navigator.mediaDevices?.getUserMedia === 'function'
  )
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

/** Liest ein Einzelbild aus dem Video, oder `null`, solange keines dasteht. */
function bildDaten(video: HTMLVideoElement, leinwand: HTMLCanvasElement): ImageData | null {
  const breite = video.videoWidth
  const hoehe = video.videoHeight

  // Vor dem ersten Bild steht dort 0 × 0. `getImageData` würfe darauf.
  if (breite === 0 || hoehe === 0) {
    return null
  }

  leinwand.width = breite
  leinwand.height = hoehe

  /*
   * `willReadFrequently`: Genau das tut dieser Takt, dreimal je Sekunde. Ohne
   * den Hinweis legt der Browser die Leinwand auf die Grafikkarte und liest
   * jedes Bild wieder zurück.
   */
  const pinsel = leinwand.getContext('2d', { willReadFrequently: true })

  if (pinsel === null) {
    return null
  }

  pinsel.drawImage(video, 0, 0, breite, hoehe)

  return pinsel.getImageData(0, 0, breite, hoehe)
}

/**
 * Der Dekodierer dieses Laufs: der eingebaute, sonst `jsQR`.
 *
 * Gibt eine Funktion zurück, die ein Videobild auf einen QR-Code hin ansieht
 * und seinen Text zurückgibt — oder `null`, wenn keiner darin war.
 */
async function dekodierer(): Promise<(video: HTMLVideoElement) => Promise<string | null>> {
  if (typeof window !== 'undefined' && window.BarcodeDetector !== undefined) {
    const detector = new window.BarcodeDetector({ formats: ['qr_code'] })

    return async (video) => (await detector.detect(video))[0]?.rawValue ?? null
  }

  const { default: jsQR } = await import('jsqr')
  const leinwand = document.createElement('canvas')

  return async (video) => {
    const bild = bildDaten(video, leinwand)

    if (bild === null) {
      return null
    }

    /*
     * `dontInvert`: Ein Kopplungs-QR-Code ist dunkel auf hell, wie er aus
     * `ui/QrCode` herauskommt. Die anderen Modi versuchen dasselbe Bild ein
     * zweites Mal invertiert und kosten je Takt so viel wie der erste
     * Durchgang.
     */
    return jsQR(bild.data, bild.width, bild.height, { inversionAttempts: 'dontInvert' })?.data ?? null
  }
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
        /*
         * Der Dekodierer zuerst und die Kamera danach: Der dynamische Import
         * kann fehlschlagen (kein Netz beim ersten Scan, eine Datei, die der
         * Cache nicht hat), und dann soll keine Kamera angegangen sein, die
         * gleich wieder ausgeht.
         */
        const erkenne = await dekodierer()

        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
          audio: false,
        })

        if (abgeraeumt) {
          stream.getTracks().forEach((spur) => spur.stop())
          return
        }

        const video = videoRef.current

        if (video === null) {
          stream.getTracks().forEach((spur) => spur.stop())
          return
        }

        videoElement = video
        video.srcObject = stream
        await video.play()

        if (abgeraeumt) {
          return
        }

        setzeZustand({ status: 'aktiv' })

        takt = setInterval(() => {
          void (async () => {
            const aktuellesVideo = videoRef.current

            if (aktuellesVideo === null) {
              return
            }

            try {
              const wert = await erkenne(aktuellesVideo)

              if (!abgeraeumt && wert !== null) {
                // Der Takt hält an, sobald etwas erkannt ist: Ohne diesen Stopp
                // riefe der nächste Frame `onErkannt` ein zweites Mal auf,
                // während die aufrufende Seite noch mit dem ersten Treffer
                // beschäftigt ist.
                stoppeTakt()
                onErkanntRef.current(wert)
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
