import { describe, expect, it } from 'vitest'
import { entschluessele, erzeugeAesSchluessel, verschluessele } from '../../src/core/crypto/aead.ts'
import { bytesText, sha256 } from '../../src/core/crypto/bytes.ts'
import { freigabeNachricht, tresorCommitment } from '../../src/core/crypto/commitment.ts'
import { entpackeDek, erzeugeDek, wrappeDek } from '../../src/core/crypto/dek.ts'
import { DOMAIN_SEPARATION } from '../../src/core/crypto/domain.ts'
import { erzeugeKemSchluesselpaar, kapsele } from '../../src/core/crypto/kem.ts'
import { teileGeheimnis } from '../../src/core/crypto/shamir.ts'
import {
  erzeugeSignaturSchluesselpaar,
  verifiziere,
  type SignaturSchluesselpaar,
} from '../../src/core/crypto/sign.ts'
import type { InhaltZeile } from '../../src/core/db/inhalte.ts'
import type { VaultShareZeile } from '../../src/core/db/tresor.ts'
import {
  erstelleFreigabe,
  fallPayloadMitSterbedatum,
  rekonstruiereTresorschluessel,
  umzuwrappendeTresorItems,
  TodesfallFehler,
  TresorOeffnenFehler,
  type Freigabezeile,
} from '../../src/services/todesfallService.ts'

/**
 * Freigeben und Öffnen (DESIGN.md §3.5, §10).
 *
 * Die beiden Hälften des heikelsten Ablaufs im Projekt, jede für sich
 * prüfbar: Eine Freigabe entsteht auf dem Gerät eines Angehörigen und prüft
 * ihren eigenen Share, bevor irgendetwas hinausgeht. Das Öffnen setzt zusammen,
 * was ankam, und misst das Ergebnis am `vault_commitment`, nicht am Zähler.
 */

const FALL = '11111111-1111-4111-8111-111111111111'
const KID = `case_${FALL}:1`
const GERAET = '22222222-2222-4222-8222-222222222222'
const BERND = 'user_bernd'
const CLARA = 'user_clara'
const DORIS = 'user_doris'

function identitaet(signatur: SignaturSchluesselpaar = erzeugeSignaturSchluesselpaar()) {
  const kem = erzeugeKemSchluesselpaar()

  return { kem, signatur, pkKem: kem.oeffentlich }
}

/** Ein Share, an ein Gerät gewrappt, mit seinem Klartext-Hash daneben. */
async function shareZeile(
  teil: Uint8Array,
  pkKem: Uint8Array,
  userId = BERND,
  shareIndex = 1,
  hashUeber: Uint8Array = teil,
): Promise<VaultShareZeile> {
  const kapselung = kapsele(pkKem)

  return {
    fallId: FALL,
    userId,
    geraeteId: GERAET,
    shareIndex,
    shareHash: await sha256(hashUeber),
    kemCt: kapselung.kemCt,
    wrappedShare: await verschluessele(kapselung.geteiltesGeheimnis, teil),
  }
}

describe('erstelleFreigabe: was auf dem Gerät des Angehörigen passiert (§3.5)', () => {
  it('entpackt, prüft, verschlüsselt unter K_c und signiert zweifach', async () => {
    const ich = identitaet()
    const kc = erzeugeAesSchluessel()
    const kv = erzeugeAesSchluessel()
    const zeile = await shareZeile(kv, ich.pkKem)

    const freigabe = await erstelleFreigabe(
      { id: FALL, kid: KID, kc },
      ich,
      GERAET,
      BERND,
      zeile,
    )

    expect(freigabe).toMatchObject({ caseId: FALL, userId: BERND, geraeteId: GERAET, kid: KID })

    // Der Share liegt jetzt unter K_c: Jedes Mitglied kann ihn lesen, der
    // Server nicht.
    expect(Array.from(await entschluessele(kc, freigabe.releasedShare))).toEqual(Array.from(kv))

    // Und die Signatur bindet Fall, Person, kid und den Hash des Blobs (§3.2).
    expect(
      verifiziere(
        freigabe.signatur,
        DOMAIN_SEPARATION.vaultRelease,
        await freigabeNachricht({
          caseId: FALL,
          userId: BERND,
          kid: KID,
          releasedShare: freigabe.releasedShare,
        }),
        ich.signatur.oeffentlich,
      ),
    ).toBe(true)
  })

  it('bricht bei einem kaputten Wrap ab, bevor irgendetwas hinausgeht', async () => {
    const ich = identitaet()
    const kv = erzeugeAesSchluessel()

    // Der Wrap trägt etwas anderes, als `share_hash` behauptet: genau der
    // Fall, den §3.5 vor dem Hochladen abfangen will.
    const zeile = await shareZeile(erzeugeAesSchluessel(), ich.pkKem, BERND, 1, kv)

    await expect(
      erstelleFreigabe({ id: FALL, kid: KID, kc: erzeugeAesSchluessel() }, ich, GERAET, BERND, zeile),
    ).rejects.toThrow(TodesfallFehler)
  })

  it('bricht ab, wenn der Wrap an ein anderes Gerät gerichtet war', async () => {
    const ich = identitaet()
    const zeile = await shareZeile(erzeugeAesSchluessel(), identitaet().pkKem)

    await expect(
      erstelleFreigabe({ id: FALL, kid: KID, kc: erzeugeAesSchluessel() }, ich, GERAET, BERND, zeile),
    ).rejects.toThrow(TodesfallFehler)
  })
})

describe('rekonstruiereTresorschluessel: das Proof-Gate (§3.5, §10)', () => {
  /** Baut die Freigabezeilen, wie sie in `vault_releases` stehen. */
  async function freigaben(
    kc: Uint8Array,
    teile: [userId: string, teil: Uint8Array][],
    kid = KID,
  ): Promise<Freigabezeile[]> {
    return Promise.all(
      teile.map(async ([userId, teil]) => ({
        userId,
        kid,
        releasedShare: await verschluessele(kc, teil),
      })),
    )
  }

  async function hashes(teile: [userId: string, teil: Uint8Array][]) {
    return new Map(
      await Promise.all(
        teile.map(async ([userId, teil]) => [userId, await sha256(teil)] as const),
      ),
    )
  }

  it('läuft bei k = 1 ohne Shamir: der Share ist bereits K_v', async () => {
    const kc = erzeugeAesSchluessel()
    const kv = erzeugeAesSchluessel()
    const teile: [string, Uint8Array][] = [[BERND, kv]]

    const ergebnis = await rekonstruiereTresorschluessel({
      freigaben: await freigaben(kc, teile),
      shareHashes: await hashes(teile),
      k: 1,
      commitment: await tresorCommitment(kv),
      fallschluessel: async () => kc,
    })

    expect(Array.from(ergebnis.kv)).toEqual(Array.from(kv))
    expect(Array.from(ergebnis.proof)).toEqual(Array.from(await tresorCommitment(kv)))
    expect(ergebnis.fehlerhafte).toEqual([])
  })

  it('setzt bei k = 2 aus zwei von drei Teilen zusammen', async () => {
    const kc = erzeugeAesSchluessel()
    const kv = erzeugeAesSchluessel()
    const [einer, zweiter] = await teileGeheimnis(kv, 3, 2)
    const teile: [string, Uint8Array][] = [
      [BERND, einer ?? new Uint8Array()],
      [CLARA, zweiter ?? new Uint8Array()],
    ]

    const ergebnis = await rekonstruiereTresorschluessel({
      freigaben: await freigaben(kc, teile),
      shareHashes: await hashes(teile),
      k: 2,
      commitment: await tresorCommitment(kv),
      fallschluessel: async () => kc,
    })

    expect(Array.from(ergebnis.kv)).toEqual(Array.from(kv))
  })

  it('benennt die Person, deren Share an seinem Hash scheitert', async () => {
    const kc = erzeugeAesSchluessel()
    const kv = erzeugeAesSchluessel()
    const [einer, zweiter, dritter] = await teileGeheimnis(kv, 3, 2)
    const echte: [string, Uint8Array][] = [
      [BERND, einer ?? new Uint8Array()],
      [CLARA, zweiter ?? new Uint8Array()],
      [DORIS, dritter ?? new Uint8Array()],
    ]

    // Doris lädt einen korrekt signierten, inhaltlich falschen Share hoch. Der
    // Zähler stieg dadurch, die Rekonstruktion besteht er nicht (§3.5).
    const hochgeladen: [string, Uint8Array][] = [
      echte[0] ?? [BERND, new Uint8Array()],
      echte[1] ?? [CLARA, new Uint8Array()],
      [DORIS, erzeugeAesSchluessel()],
    ]

    const ergebnis = await rekonstruiereTresorschluessel({
      freigaben: await freigaben(kc, hochgeladen),
      shareHashes: await hashes(echte),
      k: 2,
      commitment: await tresorCommitment(kv),
      fallschluessel: async () => kc,
    })

    expect(Array.from(ergebnis.kv)).toEqual(Array.from(kv))
    expect(ergebnis.fehlerhafte).toEqual([DORIS])
  })

  it('scheitert benennbar, wenn nach dem Aussortieren zu wenige übrig sind', async () => {
    const kc = erzeugeAesSchluessel()
    const kv = erzeugeAesSchluessel()
    const [einer, zweiter] = await teileGeheimnis(kv, 2, 2)
    const echte: [string, Uint8Array][] = [
      [BERND, einer ?? new Uint8Array()],
      [CLARA, zweiter ?? new Uint8Array()],
    ]
    const hochgeladen: [string, Uint8Array][] = [
      echte[0] ?? [BERND, new Uint8Array()],
      [CLARA, erzeugeAesSchluessel()],
    ]

    const fehler = await rekonstruiereTresorschluessel({
      freigaben: await freigaben(kc, hochgeladen),
      shareHashes: await hashes(echte),
      k: 2,
      commitment: await tresorCommitment(kv),
      fallschluessel: async () => kc,
    }).catch((ursache: unknown) => ursache)

    expect(fehler).toBeInstanceOf(TresorOeffnenFehler)
    expect((fehler as TresorOeffnenFehler).fehlerhafte).toEqual([CLARA])
    expect((fehler as TresorOeffnenFehler).gueltige).toBe(1)
    expect((fehler as TresorOeffnenFehler).noetig).toBe(2)
  })

  it('zählt eine Freigabe als fehlerhaft, deren kid dieses Gerät nicht kennt', async () => {
    const kc = erzeugeAesSchluessel()
    const kv = erzeugeAesSchluessel()
    const teile: [string, Uint8Array][] = [[BERND, kv]]

    const fehler = await rekonstruiereTresorschluessel({
      freigaben: await freigaben(kc, teile, `case_${FALL}:7`),
      shareHashes: await hashes(teile),
      k: 1,
      commitment: await tresorCommitment(kv),
      // Dieses Gerät kennt die siebte Generation nicht (§3.4).
      fallschluessel: async (kid) => (kid === KID ? kc : null),
    }).catch((ursache: unknown) => ursache)

    expect(fehler).toBeInstanceOf(TresorOeffnenFehler)
    expect((fehler as TresorOeffnenFehler).fehlerhafte).toEqual([BERND])
  })

  it('entschlüsselt jede Freigabe mit dem K_c ihrer eigenen Generation', async () => {
    const alterKc = erzeugeAesSchluessel()
    const neuerKc = erzeugeAesSchluessel()
    const kv = erzeugeAesSchluessel()
    const teile: [string, Uint8Array][] = [[BERND, kv]]

    const ergebnis = await rekonstruiereTresorschluessel({
      // Bernds Freigabe liegt noch unter der ersten Generation, der Fall steht
      // schon auf der zweiten (§3.4).
      freigaben: await freigaben(alterKc, teile, `case_${FALL}:1`),
      shareHashes: await hashes(teile),
      k: 1,
      commitment: await tresorCommitment(kv),
      fallschluessel: async (kid) => (kid === `case_${FALL}:1` ? alterKc : neuerKc),
    })

    expect(Array.from(ergebnis.kv)).toEqual(Array.from(kv))
  })

  it('weist einen rekonstruierten Schlüssel ab, der nicht zum Commitment passt', async () => {
    const kc = erzeugeAesSchluessel()
    const kv = erzeugeAesSchluessel()
    const teile: [string, Uint8Array][] = [[BERND, kv]]

    await expect(
      rekonstruiereTresorschluessel({
        freigaben: await freigaben(kc, teile),
        shareHashes: await hashes(teile),
        k: 1,
        commitment: await tresorCommitment(erzeugeAesSchluessel()),
        fallschluessel: async () => kc,
      }),
    ).rejects.toThrow(TodesfallFehler)
  })

  it('zählt zwei Freigaben nur, soweit es Hashes zu ihnen gibt', async () => {
    const kc = erzeugeAesSchluessel()
    const kv = erzeugeAesSchluessel()

    const fehler = await rekonstruiereTresorschluessel({
      freigaben: await freigaben(kc, [[DORIS, kv]]),
      shareHashes: new Map(),
      k: 1,
      commitment: await tresorCommitment(kv),
      fallschluessel: async () => kc,
    }).catch((ursache: unknown) => ursache)

    expect(fehler).toBeInstanceOf(TresorOeffnenFehler)
    expect((fehler as TresorOeffnenFehler).fehlerhafte).toEqual([DORIS])
  })
})

describe('Nach dem Öffnen (§3.5)', () => {
  it('wrappt die Tresor-DEKs von K_v auf K_c um und lässt alles andere liegen', async () => {
    const kv = erzeugeAesSchluessel()
    const kc = erzeugeAesSchluessel()
    const dek = erzeugeDek()

    const tresorZeile: InhaltZeile = {
      id: 'item-1',
      fallId: FALL,
      seq: 4,
      art: 'item',
      geloescht: false,
      imTresor: true,
      kid: `vault_${FALL}`,
      wrappedDek: await wrappeDek(kv, dek),
      payload: new Uint8Array([1]),
      geaendertAm: '2026-08-24T10:00:00Z',
    }

    const umwraps = await umzuwrappendeTresorItems(
      [
        tresorZeile,
        { ...tresorZeile, id: 'item-2', imTresor: false },
        { ...tresorZeile, id: 'item-3', geloescht: true },
      ],
      kv,
      kc,
      KID,
    )

    expect(umwraps).toHaveLength(1)
    expect(umwraps[0]).toMatchObject({ itemId: 'item-1', kid: KID })
    expect(Array.from(await entpackeDek(kc, umwraps[0]?.wrappedDek ?? new Uint8Array()))).toEqual(
      Array.from(dek),
    )
  })

  it('überspringt ein Tresor-Item, dessen DEK sich nicht entpacken lässt', async () => {
    const kv = erzeugeAesSchluessel()

    const umwraps = await umzuwrappendeTresorItems(
      [
        {
          id: 'item-1',
          fallId: FALL,
          seq: 4,
          art: 'item',
          geloescht: false,
          imTresor: true,
          kid: `vault_${FALL}`,
          wrappedDek: await wrappeDek(erzeugeAesSchluessel(), erzeugeDek()),
          payload: new Uint8Array([1]),
          geaendertAm: '2026-08-24T10:00:00Z',
        },
      ],
      kv,
      erzeugeAesSchluessel(),
      KID,
    )

    expect(umwraps).toEqual([])
  })

  it('schreibt das Sterbedatum verschlüsselt in den Fall-Payload', async () => {
    const kc = erzeugeAesSchluessel()

    const payload = await fallPayloadMitSterbedatum(kc, 'Hans Weber', '2026-05-12')

    expect(JSON.parse(bytesText(await entschluessele(kc, payload)))).toEqual({
      personName: 'Hans Weber',
      sterbedatum: '2026-05-12',
    })
  })

  it('weist ein Sterbedatum zurück, das kein Kalendertag ist', async () => {
    await expect(
      fallPayloadMitSterbedatum(erzeugeAesSchluessel(), 'Hans Weber', '2026-02-30'),
    ).rejects.toThrow(TodesfallFehler)
  })
})
