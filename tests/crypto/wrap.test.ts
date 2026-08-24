import { describe, expect, it } from 'vitest'
import { AeadFehler } from '../../src/core/crypto/aead'
import { erzeugeKemSchluesselpaar } from '../../src/core/crypto/kem'
import {
  erzeugeSignaturSchluesselpaar,
  pkSigBytes,
  signaturSchluesselAusBytes,
} from '../../src/core/crypto/sign'
import {
  WrapFehler,
  entpackeSchluessel,
  wrappeSchluessel,
  type Wrap,
} from '../../src/core/crypto/wrap'

/**
 * Fallschlüssel-Wraps (DESIGN.md §3.2, §3.6).
 *
 * Die Signatur wehrt genau einen Angriff ab: ein Mitglied, das einen formal
 * gültigen Wrap eines *falschen* `K_c` einstellt und ein Gerät damit dauerhaft
 * aussperrt. Der GCM-Tag erkennt Beschädigung, nicht die falsche Absicht.
 * Deshalb wird hier geprüft, dass die Signatur vor dem Entpacken läuft und
 * dass sie an Fall, `kid` und Empfängergerät gebunden ist.
 */

const FALL = '11111111-2222-3333-4444-555555555555'
const KID = `case_${FALL}:1`
const GERAET = '99999999-8888-7777-6666-555555555555'

function geraet() {
  const kem = erzeugeKemSchluesselpaar()
  const signatur = erzeugeSignaturSchluesselpaar()

  return { kem, signatur, pkSig: pkSigBytes(signatur.oeffentlich) }
}

const K_C = Uint8Array.from({ length: 32 }, (_, i) => i)

async function frischerWrap() {
  const empfaenger = geraet()
  const absender = geraet()

  const wrap = await wrappeSchluessel(
    K_C,
    { geraeteId: GERAET, pkKem: empfaenger.kem.oeffentlich },
    { fallId: FALL, kid: KID },
    absender.signatur.geheim,
  )

  return { empfaenger, absender, wrap }
}

function entpacke(
  wrap: Wrap,
  empfaenger: ReturnType<typeof geraet>,
  absenderPkSig: Uint8Array,
  kontext = { fallId: FALL, kid: KID, geraeteId: GERAET },
) {
  return entpackeSchluessel(
    wrap,
    kontext,
    empfaenger.kem.geheim,
    signaturSchluesselAusBytes(absenderPkSig),
  )
}

describe('Ein Wrap für das eigene Gerät', () => {
  it('gibt denselben Schlüssel wieder her', async () => {
    const { empfaenger, absender, wrap } = await frischerWrap()

    await expect(entpacke(wrap, empfaenger, absender.pkSig)).resolves.toEqual(K_C)
  })

  it('trägt den Schlüssel nirgends im Klartext', async () => {
    // Der ganze Zweck: Was auf dem Server liegt, enthält `K_c` nicht.
    const { wrap } = await frischerWrap()

    expect([...wrap.wrappedKey].join(',')).not.toContain([...K_C].join(','))
  })
})

describe('Die Signatur läuft vor dem Entpacken', () => {
  it('weist einen veränderten wrapped_key ab', async () => {
    const { empfaenger, absender, wrap } = await frischerWrap()

    const verbogen = { ...wrap, wrappedKey: Uint8Array.from(wrap.wrappedKey) }
    verbogen.wrappedKey[verbogen.wrappedKey.length - 1] ^= 0x01

    // WrapFehler, nicht AeadFehler: Ein abgewiesener Wrap wird gar nicht erst
    // entschlüsselt.
    await expect(entpacke(verbogen, empfaenger, absender.pkSig)).rejects.toThrow(WrapFehler)
  })

  it('weist einen veränderten kem_ct ab', async () => {
    const { empfaenger, absender, wrap } = await frischerWrap()

    const verbogen = { ...wrap, kemCt: Uint8Array.from(wrap.kemCt) }
    verbogen.kemCt[0] ^= 0x01

    await expect(entpacke(verbogen, empfaenger, absender.pkSig)).rejects.toThrow(WrapFehler)
  })

  it('weist einen Wrap ab, den ein anderes Gerät signiert hat', async () => {
    // Genau der Angriff aus §3.6: Ein Mitglied stellt einen formal gültigen
    // Wrap ein. Verifiziert wird gegen `wrapped_by`; passt die Signatur nicht
    // zu diesem Gerät, wird nichts entpackt.
    const { empfaenger, wrap } = await frischerWrap()
    const fremder = geraet()

    await expect(entpacke(wrap, empfaenger, fremder.pkSig)).rejects.toThrow(WrapFehler)
  })

  it('weist einen Wrap ab, der für ein anderes Gerät gilt', async () => {
    const { empfaenger, absender, wrap } = await frischerWrap()

    await expect(
      entpacke(wrap, empfaenger, absender.pkSig, {
        fallId: FALL,
        kid: KID,
        geraeteId: '00000000-0000-0000-0000-000000000000',
      }),
    ).rejects.toThrow(WrapFehler)
  })

  it('weist einen Wrap ab, der zu einem anderen Fall gehört', async () => {
    const { empfaenger, absender, wrap } = await frischerWrap()

    await expect(
      entpacke(wrap, empfaenger, absender.pkSig, {
        fallId: '00000000-0000-0000-0000-000000000000',
        kid: KID,
        geraeteId: GERAET,
      }),
    ).rejects.toThrow(WrapFehler)
  })

  it('weist einen Wrap ab, der unter einem anderen kid steht', async () => {
    // Ohne `kid` in der Signatur ließe sich der Wrap einer alten Generation als
    // der einer neuen einstellen (§3.4).
    const { empfaenger, absender, wrap } = await frischerWrap()

    await expect(
      entpacke(wrap, empfaenger, absender.pkSig, {
        fallId: FALL,
        kid: `case_${FALL}:2`,
        geraeteId: GERAET,
      }),
    ).rejects.toThrow(WrapFehler)
  })
})

describe('Ein Wrap für ein fremdes Gerät', () => {
  it('lässt sich mit dem falschen geheimen Schlüssel nicht entpacken', async () => {
    // Die Signatur stimmt, sie sagt nichts darüber, wer lesen darf. Bemerkt
    // wird der Irrtum am GCM-Tag, weil ML-KEM implizit verwirft (§3.1).
    const { absender, wrap } = await frischerWrap()
    const anderer = geraet()

    await expect(entpacke(wrap, anderer, absender.pkSig)).rejects.toThrow(AeadFehler)
  })
})

describe('Ein entpackter Schlüssel', () => {
  it('muss 32 Byte lang sein', async () => {
    const empfaenger = geraet()
    const absender = geraet()

    await expect(
      wrappeSchluessel(
        new Uint8Array(16),
        { geraeteId: GERAET, pkKem: empfaenger.kem.oeffentlich },
        { fallId: FALL, kid: KID },
        absender.signatur.geheim,
      ),
    ).rejects.toThrow(WrapFehler)
  })
})

describe('signaturSchluesselAusBytes', () => {
  it('macht aus `pk_sig` wieder die beiden Hälften', () => {
    const { signatur, pkSig } = geraet()

    expect(signaturSchluesselAusBytes(pkSig)).toEqual(signatur.oeffentlich)
  })

  it('weist eine falsche Länge zurück', () => {
    // `pk_sig` kommt aus einer Datenbankspalte. Eine zu kurze Zeile stillzulegen
    // wäre schlimmer als sie abzuweisen: Die Signaturprüfung liefe dann über
    // abgeschnittene Bytes und schlüge unerklärlich fehl.
    expect(() => signaturSchluesselAusBytes(new Uint8Array(100))).toThrow()
  })
})
