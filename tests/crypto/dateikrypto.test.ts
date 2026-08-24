import { describe, expect, it, vi } from 'vitest'
import { textBytes, bytesText } from '../../src/core/crypto/bytes'
import { erzeugeDek } from '../../src/core/crypto/dek'
import {
  DateikryptoFehler,
  direkteDateikrypto,
  fuehreAuftragAus,
  type Kryptoantwort,
  type Kryptoauftrag,
} from '../../src/core/crypto/dateikrypto'
import { workerDateikrypto } from '../../src/core/crypto/workerDateikrypto'

/**
 * Dateikryptographie und ihr Weg in den Worker (DESIGN.md §7).
 *
 * Zwei Sorten Zusage stehen hier nebeneinander. Die eine ist kryptographisch:
 * eine Datei kommt heraus, wie sie hineinging, und unter einem fremden
 * Schlüssel gar nicht. Die andere ist das Protokoll: Antworten finden ihren
 * Auftrag, ein Fehlschlag reist als Feld statt als Wurf, und ein abgestürzter
 * Worker lässt niemanden warten.
 */

const INHALT = textBytes('Sterbeurkunde, eingescannt.')

describe('fuehreAuftragAus', () => {
  it('verschlüsselt und entschlüsselt dieselben Bytes', async () => {
    const dek = erzeugeDek()

    const verschluesselt = await fuehreAuftragAus({
      nummer: 7,
      was: 'verschluesseln',
      schluessel: dek,
      daten: INHALT,
    })

    expect(verschluesselt.ok).toBe(true)
    expect(verschluesselt.nummer).toBe(7)

    if (!verschluesselt.ok) {
      throw new Error('Das Verschlüsseln ist gescheitert.')
    }

    const zurueck = await fuehreAuftragAus({
      nummer: 8,
      was: 'entschluesseln',
      schluessel: dek,
      daten: verschluesselt.daten,
    })

    if (!zurueck.ok) {
      throw new Error('Das Entschlüsseln ist gescheitert.')
    }

    expect(bytesText(zurueck.daten)).toBe('Sterbeurkunde, eingescannt.')
  })

  it('meldet einen Fehlschlag als Antwort und nicht als Wurf', async () => {
    const verschluesselt = await fuehreAuftragAus({
      nummer: 1,
      was: 'verschluesseln',
      schluessel: erzeugeDek(),
      daten: INHALT,
    })

    if (!verschluesselt.ok) {
      throw new Error('Das Verschlüsseln ist gescheitert.')
    }

    // Ein fremder Schlüssel: der GCM-Tag passt nicht.
    const zurueck = await fuehreAuftragAus({
      nummer: 2,
      was: 'entschluesseln',
      schluessel: erzeugeDek(),
      daten: verschluesselt.daten,
    })

    expect(zurueck).toMatchObject({ nummer: 2, ok: false })
    expect(zurueck.ok ? '' : zurueck.fehler).toMatch(/GCM-Tag/)
  })
})

describe('direkteDateikrypto', () => {
  it('ist derselbe Envelope wie jeder andere Payload', async () => {
    const krypto = direkteDateikrypto()
    const dek = erzeugeDek()

    const blob = await krypto.verschluessele(dek, INHALT)

    expect(bytesText(await krypto.entschluessele(dek, blob))).toBe(
      'Sterbeurkunde, eingescannt.',
    )

    // Ein Nulleffekt, aber er muss da sein: Der Port verspricht ihn.
    expect(() => krypto.schliesse()).not.toThrow()
  })
})

/**
 * Ein Worker-Doppel: Es stellt zu, was `postMessage` bekommt, und antwortet
 * über denselben Weg wie der echte, mit derselben Verzögerung um einen Tick.
 */
function attrappe() {
  const hoerer = new Map<string, ((ereignis: unknown) => void)[]>()
  const auftraege: Kryptoauftrag[] = []
  let beendet = 0

  const worker = {
    postMessage(auftrag: Kryptoauftrag) {
      auftraege.push(auftrag)
    },
    addEventListener(typ: string, hoere: (ereignis: unknown) => void) {
      hoerer.set(typ, [...(hoerer.get(typ) ?? []), hoere])
    },
    terminate() {
      beendet += 1
    },
  }

  function melde(typ: string, ereignis: unknown) {
    for (const hoere of hoerer.get(typ) ?? []) {
      hoere(ereignis)
    }
  }

  return {
    worker: worker as unknown as Worker,
    auftraege,
    beendetMal: () => beendet,
    antworte: (antwort: Kryptoantwort) => melde('message', { data: antwort }),
    stuerzeAb: () => melde('error', {}),
  }
}

describe('workerDateikrypto', () => {
  it('erzeugt den Worker erst beim ersten Auftrag und dann nur einmal', async () => {
    const doppel = attrappe()
    const erzeuge = vi.fn(() => doppel.worker)
    const krypto = workerDateikrypto(erzeuge)

    expect(erzeuge).not.toHaveBeenCalled()

    const erste = krypto.verschluessele(erzeugeDek(), INHALT)
    const zweite = krypto.entschluessele(erzeugeDek(), INHALT)

    expect(erzeuge).toHaveBeenCalledTimes(1)
    expect(doppel.auftraege.map((auftrag) => auftrag.was)).toEqual([
      'verschluesseln',
      'entschluesseln',
    ])

    doppel.antworte({ nummer: doppel.auftraege[1]!.nummer, ok: true, daten: textBytes('zwei') })
    doppel.antworte({ nummer: doppel.auftraege[0]!.nummer, ok: true, daten: textBytes('eins') })

    // Die Antworten kommen in umgekehrter Reihenfolge zurück und finden
    // trotzdem ihren Auftrag, dafür ist die Nummer da.
    expect(bytesText(await erste)).toBe('eins')
    expect(bytesText(await zweite)).toBe('zwei')
  })

  it('macht aus einer abgelehnten Antwort einen DateikryptoFehler', async () => {
    const doppel = attrappe()
    const krypto = workerDateikrypto(() => doppel.worker)

    const laeuft = krypto.entschluessele(erzeugeDek(), INHALT)

    doppel.antworte({ nummer: doppel.auftraege[0]!.nummer, ok: false, fehler: 'Der GCM-Tag passt nicht.' })

    await expect(laeuft).rejects.toBeInstanceOf(DateikryptoFehler)
  })

  it('lässt nach einem Absturz niemanden warten', async () => {
    const doppel = attrappe()
    const krypto = workerDateikrypto(() => doppel.worker)

    const laeuft = krypto.verschluessele(erzeugeDek(), INHALT)

    doppel.stuerzeAb()

    await expect(laeuft).rejects.toThrow(/abgestürzt/)
    expect(doppel.beendetMal()).toBe(1)
  })

  it('baut nach einem Absturz beim nächsten Auftrag einen neuen Worker auf', async () => {
    const erster = attrappe()
    const zweiter = attrappe()
    const erzeuge = vi.fn(() => (erzeuge.mock.calls.length === 1 ? erster.worker : zweiter.worker))
    const krypto = workerDateikrypto(erzeuge)

    await expect(
      (() => {
        const laeuft = krypto.verschluessele(erzeugeDek(), INHALT)
        erster.stuerzeAb()
        return laeuft
      })(),
    ).rejects.toThrow(/abgestürzt/)

    const wieder = krypto.verschluessele(erzeugeDek(), INHALT)
    zweiter.antworte({ nummer: zweiter.auftraege[0]!.nummer, ok: true, daten: textBytes('geht') })

    expect(bytesText(await wieder)).toBe('geht')
    expect(erzeuge).toHaveBeenCalledTimes(2)
  })

  it('beendet den Worker sofort, wenn nichts mehr läuft', async () => {
    const doppel = attrappe()
    const krypto = workerDateikrypto(() => doppel.worker)

    const laeuft = krypto.verschluessele(erzeugeDek(), INHALT)
    doppel.antworte({ nummer: doppel.auftraege[0]!.nummer, ok: true, daten: textBytes('da') })
    await laeuft

    krypto.schliesse()

    expect(doppel.beendetMal()).toBe(1)
  })

  it('lässt einen laufenden Auftrag zu Ende gehen, statt ihn wegzuwerfen', async () => {
    const doppel = attrappe()
    const krypto = workerDateikrypto(() => doppel.worker)

    const laeuft = krypto.verschluessele(erzeugeDek(), INHALT)

    // Der Screen verschwindet mitten in der Verschlüsselung. Dahinter steht
    // eine Datei, die gleich hochgeladen wird. Die Promise-Kette lebt weiter,
    // auch wenn niemand mehr hinsieht.
    krypto.schliesse()

    expect(doppel.beendetMal()).toBe(0)

    doppel.antworte({ nummer: doppel.auftraege[0]!.nummer, ok: true, daten: textBytes('fertig') })

    expect(bytesText(await laeuft)).toBe('fertig')
    expect(doppel.beendetMal()).toBe(1)
  })
})
