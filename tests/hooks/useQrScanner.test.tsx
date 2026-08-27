import { act, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useQrScanner } from '../../src/hooks/useQrScanner.ts'

/** Der Fallback-Dekodierer für Browser ohne `BarcodeDetector` (Safari/iOS). */
const jsQR = vi.fn<() => { data: string } | null>(() => null)
vi.mock('jsqr', () => ({ default: (...args: unknown[]) => jsQR(...(args as [])) }))

/**
 * Scannt einen QR-Code über die Gerätekamera (Punkt 5 der Kopplungs-Anforderungen).
 *
 * Weder eine echte Kamera noch `BarcodeDetector` gibt es in jsdom; beide
 * werden hier nachgebaut, im selben Stil wie `navigator.onLine` in
 * `useDokumente.test.tsx`. Geprüft wird, was dieser Hook selbst entscheidet:
 * dass er ohne Kamera-Schnittstelle gar nicht erst fragt, dass er ohne
 * `BarcodeDetector` auf `jsQR` ausweicht statt aufzugeben (Safari/iOS), dass
 * ein erkannter Code den Takt anhält und genau einmal gemeldet wird, dass der
 * Stream beim Abräumen wirklich stoppt (Kamera-Leaks sind ein bekanntes
 * Bug-Muster), und dass ein Berechtigungsfehler zu einem verständlichen Satz
 * wird.
 *
 * Ein kleiner Wrapper statt `renderHook`: Der Hook hängt sich per Ref an ein
 * `<video>`-Element, und das gibt es nur, wenn wirklich etwas gerendert wird.
 */

const stoppeSpur = vi.fn()
const GEFAKTER_STREAM = {
  getTracks: () => [{ stop: stoppeSpur }],
} as unknown as MediaStream

const getUserMedia = vi.fn()
const detect = vi.fn()

class GefakterBarcodeDetector {
  detect(...args: unknown[]) {
    return detect(...args)
  }
}

function setzeBarcodeDetector(vorhanden: boolean) {
  Object.defineProperty(window, 'BarcodeDetector', {
    configurable: true,
    value: vorhanden ? GefakterBarcodeDetector : undefined,
  })
}

function Wrapper({ aktiv, onErkannt }: { aktiv: boolean; onErkannt: (wert: string) => void }) {
  const { zustand, videoRef } = useQrScanner(aktiv, onErkannt)

  return (
    <div>
      <p data-testid="zustand">{JSON.stringify(zustand)}</p>
      <video ref={videoRef} data-testid="video" />
    </div>
  )
}

function zustandAus(): unknown {
  return JSON.parse(screen.getByTestId('zustand').textContent ?? 'null')
}

beforeEach(() => {
  vi.clearAllMocks()
  getUserMedia.mockResolvedValue(GEFAKTER_STREAM)
  detect.mockResolvedValue([])
  jsQR.mockReturnValue(null)

  /*
   * jsdom malt nicht: `getContext` gibt dort `null` zurück, und ohne Bild
   * käme der `jsQR`-Zweig nie bis zum Dekodierer. Nachgebaut wird genau das,
   * was der Hook davon benutzt.
   */
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    drawImage: vi.fn(),
    getImageData: () => ({ data: new Uint8ClampedArray(4), width: 1, height: 1 }),
  } as unknown as CanvasRenderingContext2D)
  Object.defineProperty(HTMLVideoElement.prototype, 'videoWidth', {
    configurable: true,
    value: 1,
  })
  Object.defineProperty(HTMLVideoElement.prototype, 'videoHeight', {
    configurable: true,
    value: 1,
  })

  Object.defineProperty(globalThis.navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia },
  })

  vi.spyOn(HTMLVideoElement.prototype, 'play').mockResolvedValue(undefined)
  setzeBarcodeDetector(true)
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('useQrScanner', () => {
  it('fragt gar nicht erst, wenn es keine Kamera-Schnittstelle gibt', () => {
    /*
     * Ohne HTTPS nimmt der Browser `mediaDevices` ganz weg. Dann hilft auch
     * kein mitgebrachter Dekodierer, und der Screen sagt es, statt eine
     * Kamera zu öffnen, die es nicht gibt.
     */
    Object.defineProperty(globalThis.navigator, 'mediaDevices', {
      configurable: true,
      value: undefined,
    })

    render(<Wrapper aktiv={true} onErkannt={vi.fn()} />)

    expect(zustandAus()).toEqual({ status: 'nicht-unterstuetzt' })
    expect(getUserMedia).not.toHaveBeenCalled()
  })

  it('weicht ohne BarcodeDetector auf jsQR aus, statt aufzugeben (Safari/iOS)', async () => {
    /*
     * Der Grund für den zweiten Weg: Auf dem iPhone stand hier vorher
     * „Scannen wird auf diesem Gerät nicht unterstützt" — auf genau den
     * Geräten, an denen zwei Menschen nebeneinandersitzen und scannen wollen.
     */
    vi.useFakeTimers({ shouldAdvanceTime: true })
    setzeBarcodeDetector(false)
    jsQR.mockReturnValue({ data: 'K4M7QP2X' })
    const onErkannt = vi.fn()

    render(<Wrapper aktiv={true} onErkannt={onErkannt} />)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(300)
    })

    expect(getUserMedia).toHaveBeenCalledTimes(1)
    expect(onErkannt).toHaveBeenCalledExactlyOnceWith('K4M7QP2X')
  })

  it('bleibt aus, solange nicht gescannt werden soll', () => {
    render(<Wrapper aktiv={false} onErkannt={vi.fn()} />)

    expect(getUserMedia).not.toHaveBeenCalled()
  })

  it('öffnet die Kamera und meldet einen erkannten Code genau einmal', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    detect.mockResolvedValue([{ rawValue: 'K4M7QP2X' }])
    const onErkannt = vi.fn()

    render(<Wrapper aktiv={true} onErkannt={onErkannt} />)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(300)
    })

    expect(zustandAus()).toEqual({ status: 'aktiv' })
    expect(onErkannt).toHaveBeenCalledExactlyOnceWith('K4M7QP2X')

    // Der Takt hält nach dem Treffer an: Ein zweiter Durchlauf riefe
    // `onErkannt` erneut auf, während die aufrufende Seite den ersten Treffer
    // noch verarbeitet.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_200)
    })

    expect(onErkannt).toHaveBeenCalledTimes(1)
  })

  it('gibt die Kamera wieder frei, wenn die Scan-Ansicht schließt', async () => {
    const { rerender, unmount } = render(<Wrapper aktiv={true} onErkannt={vi.fn()} />)

    await waitFor(() => expect(zustandAus()).toEqual({ status: 'aktiv' }))

    expect(getUserMedia).toHaveBeenCalledTimes(1)
    expect(stoppeSpur).not.toHaveBeenCalled()

    rerender(<Wrapper aktiv={false} onErkannt={vi.fn()} />)
    expect(stoppeSpur).toHaveBeenCalled()

    stoppeSpur.mockClear()
    unmount()
    // Beim ersten Aufräumen war die Kamera schon aus (`aktiv=false`); ein
    // zweiter Stopp beim Unmount käme nicht mehr, weil dort nichts mehr läuft.
    expect(stoppeSpur).not.toHaveBeenCalled()
  })

  it('nennt einen verständlichen Grund, wenn die Kamera nicht erlaubt wurde', async () => {
    getUserMedia.mockRejectedValue(new DOMException('nope', 'NotAllowedError'))

    render(<Wrapper aktiv={true} onErkannt={vi.fn()} />)

    await waitFor(() =>
      expect(zustandAus()).toMatchObject({
        status: 'fehler',
        nachricht: expect.stringContaining('nicht erlaubt'),
      }),
    )
  })

  it('nennt einen verständlichen Grund, wenn es keine Kamera gibt', async () => {
    getUserMedia.mockRejectedValue(new DOMException('nope', 'NotFoundError'))

    render(<Wrapper aktiv={true} onErkannt={vi.fn()} />)

    await waitFor(() =>
      expect(zustandAus()).toMatchObject({
        status: 'fehler',
        nachricht: expect.stringContaining('keine nutzbare Kamera'),
      }),
    )
  })
})
