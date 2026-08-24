import { describe, expect, it, vi } from 'vitest'
import { freigabeNachricht } from '../../src/core/crypto/commitment.ts'
import { DOMAIN_SEPARATION } from '../../src/core/crypto/domain.ts'
import {
  erzeugeSignaturSchluesselpaar,
  pkSigBytes,
  signiere,
  type SignaturSchluesselpaar,
} from '../../src/core/crypto/sign.ts'
import { alsBytea } from '../../src/core/db/bytea.ts'
import {
  leseFreigabeanfrage,
  nimmFreigabeAn,
  type Freigabezugang,
} from '../../supabase/functions/vault-release/freigabe.ts'

/**
 * Die Edge Function `vault-release` (DESIGN.md §3.5, §9, §10).
 *
 * §10 verlangt genau diese Fälle: Die Function weist eine Freigabe ab, wenn
 * eine der beiden Signaturen falsch ist, wenn `device_id` einer anderen Person
 * gehört oder wenn die Mitgliedschaft fehlt, jeweils ohne eine Zeile zu
 * schreiben. Zudem nimmt sie die `user_id` aus dem geprüften Token, nie aus dem
 * Request-Body.
 *
 * Geprüft wird die Entscheidungslogik, nicht die Deno-Laufzeit: `index.ts`
 * setzt Datenbank und HTTP daneben, diese Datei entscheidet.
 */

const FALL = '11111111-1111-4111-8111-111111111111'
const GERAET = '22222222-2222-4222-8222-222222222222'
const BERND = 'user_bernd'
const CLARA = 'user_clara'
const KID = `case_${FALL}:1`

const RELEASED_SHARE = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])

const paar: SignaturSchluesselpaar = erzeugeSignaturSchluesselpaar()
const fremdesPaar: SignaturSchluesselpaar = erzeugeSignaturSchluesselpaar()

async function signatur(
  schluessel: SignaturSchluesselpaar = paar,
  userId = BERND,
  kid = KID,
): Promise<Uint8Array> {
  return signiere(
    DOMAIN_SEPARATION.vaultRelease,
    await freigabeNachricht({ caseId: FALL, userId, kid, releasedShare: RELEASED_SHARE }),
    schluessel.geheim,
  )
}

/** Ein Zugang, der alles durchlässt und jeden Schreibvorgang mitschreibt. */
function zugang(
  ueberschreibung: Partial<Freigabezugang> = {},
  pkSig: Uint8Array = pkSigBytes(paar.oeffentlich),
): Freigabezugang & { schreibe: ReturnType<typeof vi.fn> } {
  const schreibe = vi.fn().mockResolvedValue(undefined)

  return {
    geraet: vi.fn().mockResolvedValue({ userId: BERND, pkSig }),
    istMitglied: vi.fn().mockResolvedValue(true),
    schreibe,
    ...ueberschreibung,
    // Nach dem Spread, damit ein überschriebener Zugang trotzdem dieselbe
    // beobachtbare Schreibfunktion behält.
    ...(ueberschreibung.schreibe === undefined ? { schreibe } : {}),
  } as Freigabezugang & { schreibe: ReturnType<typeof vi.fn> }
}

async function anfrage(ueberschreibung: Record<string, unknown> = {}) {
  return {
    caseId: FALL,
    deviceId: GERAET,
    kid: KID,
    releasedShare: alsBytea(RELEASED_SHARE),
    signatur: alsBytea(await signatur()),
    ...ueberschreibung,
  }
}

describe('vault-release: was durchkommt (§3.5)', () => {
  it('nimmt eine gültig signierte Freigabe an und schreibt genau eine Zeile', async () => {
    const zu = zugang()

    const ergebnis = await nimmFreigabeAn(leseFreigabeanfrage(await anfrage()), BERND, zu)

    expect(ergebnis.status).toBe(200)
    expect(zu.schreibe).toHaveBeenCalledTimes(1)
    // Der `kid` muss in die Zeile: `vault_releases.kid` ist `not null`, und
    // ohne ihn wüsste das öffnende Gerät nicht, unter welcher Generation der
    // Blob liegt (§3.4, §3.5).
    expect(zu.schreibe).toHaveBeenCalledWith({
      caseId: FALL,
      userId: BERND,
      geraeteId: GERAET,
      kid: KID,
      releasedShare: RELEASED_SHARE,
      signatur: expect.any(Uint8Array),
    })
  })

  it('signiert wird über die Kennung aus dem Token, nicht über die aus dem Body', async () => {
    const zu = zugang()

    // Der Body behauptet, die Freigabe gehöre Clara. Die Function sieht ihn
    // gar nicht erst an: Sie prüft die Signatur über BERND aus dem Token, und
    // die passt.
    const ergebnis = await nimmFreigabeAn(
      leseFreigabeanfrage(await anfrage({ userId: CLARA })),
      BERND,
      zu,
    )

    expect(ergebnis.status).toBe(200)
    expect(zu.schreibe).toHaveBeenCalledWith(expect.objectContaining({ userId: BERND }))
  })
})

describe('vault-release: was abgewiesen wird, ohne eine Zeile zu schreiben (§3.5, §10)', () => {
  it('weist eine Signatur ab, die über eine andere Kennung läuft', async () => {
    const zu = zugang()

    // Die Signatur läuft über CLARA, das Token sagt BERND. Genau so sähe der
    // Versuch aus, eine fremde Freigabe unter eigenem Namen einzustellen.
    const ergebnis = await nimmFreigabeAn(
      leseFreigabeanfrage(await anfrage({ signatur: alsBytea(await signatur(paar, CLARA)) })),
      BERND,
      zu,
    )

    expect(ergebnis.status).toBe(403)
    expect(zu.schreibe).not.toHaveBeenCalled()
  })

  it('weist eine Signatur ab, die zu einem anderen Signaturschlüssel gehört', async () => {
    const zu = zugang()

    const ergebnis = await nimmFreigabeAn(
      leseFreigabeanfrage(await anfrage({ signatur: alsBytea(await signatur(fremdesPaar)) })),
      BERND,
      zu,
    )

    expect(ergebnis.status).toBe(403)
    expect(zu.schreibe).not.toHaveBeenCalled()
  })

  it('weist eine Signatur ab, in der nur die ML-DSA-Hälfte stimmt', async () => {
    const zu = zugang()

    // Zusammengesetzt heisst: beide müssen verifizieren (§3.2). Die
    // Ed25519-Hälfte kommt aus einem fremden Paar, die ML-DSA-Hälfte ist echt.
    const echt = await signatur()
    const fremd = await signatur(fremdesPaar)
    const gemischt = new Uint8Array(echt)
    gemischt.set(fremd.subarray(fremd.length - 64), gemischt.length - 64)

    const ergebnis = await nimmFreigabeAn(
      leseFreigabeanfrage(await anfrage({ signatur: alsBytea(gemischt) })),
      BERND,
      zu,
    )

    expect(ergebnis.status).toBe(403)
    expect(zu.schreibe).not.toHaveBeenCalled()
  })

  it('weist eine Freigabe ab, deren kid nachträglich verdreht wurde', async () => {
    const zu = zugang()

    // Der `kid` steht in der Signatur, damit ihn niemand verdrehen und eine
    // gültige Freigabe so unlesbar machen kann (§3.5).
    const ergebnis = await nimmFreigabeAn(
      leseFreigabeanfrage(await anfrage({ kid: `case_${FALL}:2` })),
      BERND,
      zu,
    )

    expect(ergebnis.status).toBe(403)
    expect(zu.schreibe).not.toHaveBeenCalled()
  })

  it('weist eine Freigabe ab, deren Share unterwegs verändert wurde', async () => {
    const zu = zugang()

    const ergebnis = await nimmFreigabeAn(
      leseFreigabeanfrage(await anfrage({ releasedShare: alsBytea(new Uint8Array([9, 9, 9])) })),
      BERND,
      zu,
    )

    expect(ergebnis.status).toBe(403)
    expect(zu.schreibe).not.toHaveBeenCalled()
  })

  it('weist ab, wenn das Gerät einer anderen Person gehört', async () => {
    const zu = zugang({ geraet: vi.fn().mockResolvedValue({ userId: CLARA, pkSig: pkSigBytes(paar.oeffentlich) }) })

    const ergebnis = await nimmFreigabeAn(leseFreigabeanfrage(await anfrage()), BERND, zu)

    expect(ergebnis.status).toBe(403)
    expect(zu.schreibe).not.toHaveBeenCalled()
  })

  it('weist ab, wenn es das Gerät gar nicht gibt', async () => {
    const zu = zugang({ geraet: vi.fn().mockResolvedValue(null) })

    const ergebnis = await nimmFreigabeAn(leseFreigabeanfrage(await anfrage()), BERND, zu)

    expect(ergebnis.status).toBe(403)
    expect(zu.schreibe).not.toHaveBeenCalled()
  })

  it('weist ab, wenn die Mitgliedschaft fehlt', async () => {
    const zu = zugang({ istMitglied: vi.fn().mockResolvedValue(false) })

    const ergebnis = await nimmFreigabeAn(leseFreigabeanfrage(await anfrage()), BERND, zu)

    expect(ergebnis.status).toBe(403)
    expect(zu.schreibe).not.toHaveBeenCalled()
  })

  it('prüft die Mitgliedschaft, bevor irgendeine Signatur gerechnet wird', async () => {
    const zu = zugang({ istMitglied: vi.fn().mockResolvedValue(false) })

    await nimmFreigabeAn(leseFreigabeanfrage(await anfrage()), BERND, zu)

    expect(zu.istMitglied).toHaveBeenCalledWith(FALL, BERND)
  })
})

describe('vault-release: der Request-Body (§9)', () => {
  it('weist einen Body zurück, dem ein Feld fehlt', () => {
    expect(() => leseFreigabeanfrage({ caseId: FALL })).toThrow(/deviceId/i)
  })

  it('weist einen Body zurück, der gar keiner ist', () => {
    expect(() => leseFreigabeanfrage('nichts')).toThrow()
  })

  it('weist ein Feld zurück, das nicht als bytea-Hex kodiert ist', () => {
    expect(() =>
      leseFreigabeanfrage({
        caseId: FALL,
        deviceId: GERAET,
        kid: KID,
        releasedShare: 'kein hex',
        signatur: alsBytea(new Uint8Array([1])),
      }),
    ).toThrow(/releasedShare/i)
  })
})
