import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  VORGABE,
  ansichtAbonnieren,
  ansichtLesen,
  ansichtSchreiben,
  ansichtZuruecksetzen,
} from '../../../src/core/storage/ansicht.ts'

/**
 * Der Speicher hinter der Ansichtswahl (DESIGN.md §7).
 *
 * Drei Zusagen: Die Vorgabe steht auf "noch nicht gefragt" und
 * "Systemeinstellung folgen"; was einmal gewählt wurde, überlebt den Neustart;
 * und nichts von beidem hält die App an, wenn im Speicher Unsinn steht oder es
 * gar keinen gibt.
 *
 * Die Datei heißt `.tsx` und läuft damit unter jsdom (`vitest.config.ts`): Es
 * geht um `localStorage`, und den gibt es im node-Projekt nicht.
 */

beforeEach(() => {
  localStorage.clear()
  ansichtZuruecksetzen()
})

describe('ansichtLesen', () => {
  it('gibt die Vorgabe, solange nichts gespeichert ist', () => {
    expect(ansichtLesen()).toEqual(VORGABE)
    expect(VORGABE.modus).toBeNull()
    expect(VORGABE.textgroesse).toBe('system')
    expect(VORGABE.darstellung).toBe('system')
  })

  it('liest, was geschrieben wurde', () => {
    ansichtSchreiben({ modus: 'einfach', textgroesse: 'sehr-gross' })
    ansichtZuruecksetzen()

    expect(ansichtLesen()).toEqual({
      modus: 'einfach',
      textgroesse: 'sehr-gross',
      darstellung: 'system',
    })
  })

  it('fällt bei kaputtem oder fremdem Inhalt auf die Vorgabe zurück', () => {
    /*
     * Ein halb geschriebenes JSON, ein fremder Eintrag unter demselben
     * Schlüssel, ein Wert aus einer älteren Fassung: nichts davon darf die App
     * anhalten. Im Zweifel fragt das Onboarding eben noch einmal.
     */
    for (const roh of ['{kaputt', '"nur ein string"', '{"modus":"riesig"}', 'null']) {
      localStorage.setItem('lnd.ansicht', roh)
      ansichtZuruecksetzen()

      expect(ansichtLesen()).toEqual(VORGABE)
    }
  })

  it('behält gültige Felder, wenn ein anderes unbrauchbar ist', () => {
    localStorage.setItem('lnd.ansicht', JSON.stringify({ modus: 'einfach', darstellung: 'lila' }))
    ansichtZuruecksetzen()

    expect(ansichtLesen()).toEqual({
      modus: 'einfach',
      textgroesse: 'system',
      darstellung: 'system',
    })
  })
})

describe('ansichtSchreiben', () => {
  it('meldet jede Änderung an alle Abonnenten', () => {
    const melde = vi.fn()
    const abbestellen = ansichtAbonnieren(melde)

    ansichtSchreiben({ modus: 'erweitert' })
    expect(melde).toHaveBeenCalledTimes(1)

    abbestellen()
    ansichtSchreiben({ modus: 'einfach' })
    expect(melde).toHaveBeenCalledTimes(1)
  })

  it('gilt für diese Sitzung, auch wenn der Speicher nichts annimmt', () => {
    /*
     * Safari im privaten Modus wirft beim Schreiben. Die Wahl gilt trotzdem,
     * sie überlebt nur den nächsten Start nicht; eine Fehlermeldung darüber
     * wäre eine Warnung ohne Handlungsmöglichkeit (vgl. `persist.ts`).
     */
    const setzen = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError')
    })

    expect(() => ansichtSchreiben({ modus: 'einfach' })).not.toThrow()
    expect(ansichtLesen().modus).toBe('einfach')

    setzen.mockRestore()
  })
})
