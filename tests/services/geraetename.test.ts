import { describe, expect, it } from 'vitest'
import { standardGeraetename } from '../../src/services/geraetename'

/**
 * Nahtstelle: der Name, unter dem ein Gerät zum ersten Mal in der Liste steht
 * (DESIGN.md §3.6).
 *
 * Er ist eine Vermutung und darf eine bleiben — die Person kann ihn in Profil
 * ändern. Wofür er da ist: „Prüfcode 481 253" allein sagt am Telefon nicht,
 * welches Gerät gemeint ist. „iPhone von Anna" schon.
 */

const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1'
const IPAD =
  'Mozilla/5.0 (iPad; CPU OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/604.1'
const MAC =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36'
const ANDROID =
  'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36'
const WINDOWS =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36'

describe('Der vorgeschlagene Gerätename', () => {
  it('nennt Gerät und Person, so wie §3.6 es zeigt', () => {
    expect(standardGeraetename(IPHONE, 'Anna Müller')).toBe('iPhone von Anna')
  })

  it('unterscheidet die gängigen Geräte', () => {
    expect(standardGeraetename(IPAD, 'Anna')).toBe('iPad von Anna')
    expect(standardGeraetename(MAC, 'Anna')).toBe('Mac von Anna')
    expect(standardGeraetename(ANDROID, 'Anna')).toBe('Android-Telefon von Anna')
    expect(standardGeraetename(WINDOWS, 'Anna')).toBe('Windows-PC von Anna')
  })

  it('hält ein iPad für ein iPad und nicht für einen Mac', () => {
    // Beide tragen "Mac OS X" im User-Agent. Die Reihenfolge der Prüfungen
    // entscheidet, und sie ist leicht falsch herum geschrieben.
    expect(standardGeraetename(IPAD, 'Anna')).not.toContain('Mac')
  })

  it('nimmt bei einer E-Mail-Adresse den Teil davor', () => {
    // Clerk lässt beide Namensfelder leer, wenn sich jemand nur mit einer
    // Adresse registriert; dann ist der Anzeigename die Adresse. "iPhone von
    // anna@example.de" wäre ein Wort zu viel für einen Namen.
    expect(standardGeraetename(IPHONE, 'anna@example.de')).toBe('iPhone von anna')
  })

  it('lässt das "von" weg, wenn es keinen Namen gibt', () => {
    expect(standardGeraetename(IPHONE, '   ')).toBe('iPhone')
  })

  it('sagt bei einem unbekannten User-Agent schlicht "Gerät"', () => {
    expect(standardGeraetename('Etwas ganz Neues/1.0', 'Anna')).toBe('Gerät von Anna')
  })
})
