import { describe, expect, it } from 'vitest'
import { erzeugeAesSchluessel, verschluessele } from '../../src/core/crypto/aead'
import { textBytes } from '../../src/core/crypto/bytes'
import { DekFehler, entpackeDek, erzeugeDek, wrappeDek } from '../../src/core/crypto/dek'

/**
 * Der DEK pro Item (DESIGN.md §3.1, §3.2).
 *
 * Die Kette ist zweistufig, und das ist ihr ganzer Zweck: `payload` liegt unter
 * dem DEK, der DEK unter `K_c`. Eine Rotation von `K_c` (§3.4) wrappt danach
 * 32 Byte neu und laesst den Payload unberuehrt: Bei einer 15-MB-Datei ist das
 * der Unterschied zwischen wenigen Kilobyte und einem neuen Upload.
 */

describe('erzeugeDek', () => {
  it('liefert 32 Byte', () => {
    expect(erzeugeDek()).toHaveLength(32)
  })

  it('liefert bei jedem Aufruf einen anderen', () => {
    // Ein DEK aendert sich nie (§3.1). Zwei Items, die sich denselben teilten,
    // liessen sich nur noch gemeinsam rotieren und gemeinsam freigeben.
    const dek = erzeugeDek()

    expect(Array.from(erzeugeDek())).not.toEqual(Array.from(dek))
  })
})

describe('wrappeDek und entpackeDek', () => {
  it('gibt denselben DEK zurueck', async () => {
    const kc = erzeugeAesSchluessel()
    const dek = erzeugeDek()

    const zurueck = await entpackeDek(kc, await wrappeDek(kc, dek))

    expect(Array.from(zurueck)).toEqual(Array.from(dek))
  })

  it('laesst K_c aus dem Wrap nicht ablesen', async () => {
    const kc = erzeugeAesSchluessel()
    const gewrappt = await wrappeDek(kc, erzeugeDek())

    // Der Envelope traegt Kopf, Nonce und 48 Byte Nutzlast (§3.2), nichts,
    // worin der Fallschluessel oder der DEK im Klartext stuende.
    expect(gewrappt).toHaveLength(2 + 2 + 12 + 32 + 16)
    expect(Array.from(gewrappt)).not.toEqual(expect.arrayContaining(Array.from(kc)))
  })

  it('weist einen DEK falscher Laenge zurueck', async () => {
    // Ein zu kurzer Schluessel waere schwaecher, als das Format verspricht,
    // und faellt spaeter erst beim Importieren auf, dann aber ohne Bezug zu
    // der Stelle, an der er entstanden ist.
    await expect(wrappeDek(erzeugeAesSchluessel(), new Uint8Array(16))).rejects.toThrow(DekFehler)
  })

  it('entpackt nichts mit dem falschen Fallschluessel', async () => {
    const gewrappt = await wrappeDek(erzeugeAesSchluessel(), erzeugeDek())

    await expect(entpackeDek(erzeugeAesSchluessel(), gewrappt)).rejects.toThrow(/GCM-Tag/)
  })

  it('weist etwas zurueck, das entschluesselt kein DEK ist', async () => {
    // Der GCM-Tag passt, der Inhalt ist trotzdem keiner: eine beschaedigte oder
    // aus einer fremden Spalte verwechselte Zeile. Ohne Pruefung ginge daraus
    // ein AES-Schluessel falscher Laenge hervor, und der Fehler faende sich
    // erst beim Entschluesseln des Payloads wieder.
    const kc = erzeugeAesSchluessel()
    const kein = await verschluessele(kc, textBytes('kein Schluessel'))

    await expect(entpackeDek(kc, kein)).rejects.toThrow(DekFehler)
  })
})
