import { describe, expect, it } from 'vitest'
import { erzeugeAesSchluessel } from '../../src/core/crypto/aead'
import { sha256 } from '../../src/core/crypto/bytes'
import { erzeugeKemSchluesselpaar } from '../../src/core/crypto/kem'
import type {
  GeraeteschluesselTabelle,
  GeraeteschluesselZeile,
} from '../../src/core/db/geraeteschluessel'
import type { InhaltZeile } from '../../src/core/db/inhalte'
import type { MitgliederTabelle, MitgliedZeile } from '../../src/core/db/mitglieder'
import type { ResplitShareInput, TresorTabelle } from '../../src/core/db/tresor'
import {
  berechneTresorSchwelle,
  mutationTresorAnlegen,
  tresorItemsAusZeilen,
  verteileShares,
} from '../../src/services/tresorService'

function mockDb() {
  const mitglieder: MitgliedZeile[] = []
  const geraete: GeraeteschluesselZeile[] = []
  let gespeicherteShares: ResplitShareInput[] = []
  let gespeichertesN: number | null = null
  let gespeichertesK: number | null = null

  const mitgliederDb: MitgliederTabelle = {
    imFall: () => Promise.resolve(mitglieder),
  }

  const geraeteDb: GeraeteschluesselTabelle = {
    fuerBenutzer: (userId) => Promise.resolve(geraete.filter((g) => g.userId === userId)),
    nachId: (id) => Promise.resolve(geraete.find((g) => g.id === id) ?? null),
    finde: () => Promise.reject(new Error('nicht gebraucht')),
    legeAn: () => Promise.reject(new Error('nicht gebraucht')),
    benenneUm: () => Promise.reject(new Error('nicht gebraucht')),
  }

  const tresorDb: TresorTabelle = {
    wrapFuerGeraet: () => Promise.resolve(null),
    legeWrapAn: () => Promise.reject(new Error('nicht gebraucht')),
    sharesFuerFall: () => Promise.resolve([]),
    resplitVault: (_fallId, n, k, shares) => {
      gespeichertesN = n
      gespeichertesK = k
      gespeicherteShares = shares
      return Promise.resolve()
    },
  }

  return {
    mitglieder,
    geraete,
    mitgliederDb,
    geraeteDb,
    tresorDb,
    getShares: () => gespeicherteShares,
    getN: () => gespeichertesN,
    getK: () => gespeichertesK,
  }
}

describe('berechneTresorSchwelle (§3.5)', () => {
  it('gibt k = null bei n = 0 zurück', () => {
    expect(berechneTresorSchwelle(0)).toEqual({ n: 0, k: null })
  })

  it('gibt k = 1 bei n = 1 zurück', () => {
    expect(berechneTresorSchwelle(1)).toEqual({ n: 1, k: 1 })
  })

  it('berechnet k = ⌈2n/3⌉ für n >= 2', () => {
    expect(berechneTresorSchwelle(2)).toEqual({ n: 2, k: 2 }) // ⌈4/3⌉ = 2
    expect(berechneTresorSchwelle(3)).toEqual({ n: 3, k: 2 }) // ⌈6/3⌉ = 2
    expect(berechneTresorSchwelle(4)).toEqual({ n: 4, k: 3 }) // ⌈8/3⌉ = 3
    expect(berechneTresorSchwelle(5)).toEqual({ n: 5, k: 4 }) // ⌈10/3⌉ = 4
    expect(berechneTresorSchwelle(6)).toEqual({ n: 6, k: 4 }) // ⌈12/3⌉ = 4
  })
})

describe('verteileShares (§3.5)', () => {
  const PREPARER = 'user_preparer'
  const ANNA = 'user_anna'
  const BERND = 'user_bernd'
  const CLARA = 'user_clara'
  const FALL_ID = 'fall-1'

  it('verteilt bei n = 0 keine Shares und setzt k = null', async () => {
    const s = mockDb()
    s.mitglieder.push({ userId: PREPARER, beigetretenAm: '2026-08-24' })

    const kv = erzeugeAesSchluessel()
    const ergebnis = await verteileShares(
      s.tresorDb,
      s.mitgliederDb,
      s.geraeteDb,
      FALL_ID,
      kv,
      PREPARER,
    )

    expect(ergebnis).toEqual({ n: 0, k: null })
    expect(s.getN()).toBe(0)
    expect(s.getK()).toBeNull()
    expect(s.getShares()).toHaveLength(0)
  })

  it('erzeugt bei n = 1 einen Direktwrap ohne Shamir-Aufruf', async () => {
    const s = mockDb()
    s.mitglieder.push(
      { userId: PREPARER, beigetretenAm: '2026-08-24' },
      { userId: ANNA, beigetretenAm: '2026-08-24' },
    )

    const annasKem = erzeugeKemSchluesselpaar()
    s.geraete.push({
      id: 'geraet-anna-1',
      userId: ANNA,
      pkKem: annasKem.oeffentlich,
      pkSig: new Uint8Array(32),
      label: 'iPhone von Anna',
      angelegtAm: '2026-08-24',
    })

    const kv = erzeugeAesSchluessel()
    const ergebnis = await verteileShares(
      s.tresorDb,
      s.mitgliederDb,
      s.geraeteDb,
      FALL_ID,
      kv,
      PREPARER,
    )

    expect(ergebnis).toEqual({ n: 1, k: 1 })
    expect(s.getN()).toBe(1)
    expect(s.getK()).toBe(1)

    const shares = s.getShares()
    expect(shares).toHaveLength(1)
    expect(shares[0]?.userId).toBe(ANNA)
    expect(shares[0]?.shareIndex).toBe(1)

    // share_hash ist SHA-256(K_v)
    const erwarteterHash = await sha256(kv)
    expect(Array.from(shares[0]?.shareHash ?? [])).toEqual(Array.from(erwarteterHash))
  })

  it('verteilt bei n = 1 an alle Geräte desselben Angehörigen denselben Share', async () => {
    const s = mockDb()
    s.mitglieder.push(
      { userId: PREPARER, beigetretenAm: '2026-08-24' },
      { userId: ANNA, beigetretenAm: '2026-08-24' },
    )

    const g1 = erzeugeKemSchluesselpaar()
    const g2 = erzeugeKemSchluesselpaar()
    s.geraete.push(
      {
        id: 'geraet-anna-1',
        userId: ANNA,
        pkKem: g1.oeffentlich,
        pkSig: new Uint8Array(32),
        label: 'iPhone',
        angelegtAm: '2026-08-24',
      },
      {
        id: 'geraet-anna-2',
        userId: ANNA,
        pkKem: g2.oeffentlich,
        pkSig: new Uint8Array(32),
        label: 'iPad',
        angelegtAm: '2026-08-24',
      },
    )

    const kv = erzeugeAesSchluessel()
    await verteileShares(s.tresorDb, s.mitgliederDb, s.geraeteDb, FALL_ID, kv, PREPARER)

    const shares = s.getShares()
    expect(shares).toHaveLength(2)
    expect(shares.every((share) => share.userId === ANNA)).toBe(true)
    expect(shares.every((share) => share.shareIndex === 1)).toBe(true)
    // Beide Geräte haben denselben share_hash
    expect(Array.from(shares[0]?.shareHash ?? [])).toEqual(
      Array.from(shares[1]?.shareHash ?? []),
    )
  })

  it('erzeugt bei n >= 2 Shamir-Shares mit passendem share_hash', async () => {
    const s = mockDb()
    s.mitglieder.push(
      { userId: PREPARER, beigetretenAm: '2026-08-24' },
      { userId: ANNA, beigetretenAm: '2026-08-24' },
      { userId: BERND, beigetretenAm: '2026-08-24' },
      { userId: CLARA, beigetretenAm: '2026-08-24' },
    )

    const kemA = erzeugeKemSchluesselpaar()
    const kemB = erzeugeKemSchluesselpaar()
    const kemC = erzeugeKemSchluesselpaar()

    s.geraete.push(
      {
        id: 'g-anna',
        userId: ANNA,
        pkKem: kemA.oeffentlich,
        pkSig: new Uint8Array(32),
        label: 'A',
        angelegtAm: '2026-08-24',
      },
      {
        id: 'g-bernd',
        userId: BERND,
        pkKem: kemB.oeffentlich,
        pkSig: new Uint8Array(32),
        label: 'B',
        angelegtAm: '2026-08-24',
      },
      {
        id: 'g-clara',
        userId: CLARA,
        pkKem: kemC.oeffentlich,
        pkSig: new Uint8Array(32),
        label: 'C',
        angelegtAm: '2026-08-24',
      },
    )

    const kv = erzeugeAesSchluessel()
    const ergebnis = await verteileShares(
      s.tresorDb,
      s.mitgliederDb,
      s.geraeteDb,
      FALL_ID,
      kv,
      PREPARER,
    )

    expect(ergebnis).toEqual({ n: 3, k: 2 })
    expect(s.getN()).toBe(3)
    expect(s.getK()).toBe(2)

    const shares = s.getShares()
    expect(shares).toHaveLength(3)
    expect(shares.map((sh) => sh.shareIndex)).toEqual([1, 2, 3])
  })
})

describe('Tresor-Inhalte (§3.5)', () => {
  it('legt ein Item verschlüsselt unter K_v mit in_vault = true an und entschlüsselt es wieder', async () => {
    const kv = erzeugeAesSchluessel()
    const fallId = 'fall-1'

    const mutation = await mutationTresorAnlegen(fallId, kv, 'Bankkonto', 'IBAN: DE123456789')
    expect(mutation.op).toBe('anlegen')
    if (mutation.op !== 'anlegen') throw new Error('Muss anlegen sein')
    expect(mutation.imTresor).toBe(true)
    expect(mutation.kid).toBe(`vault_${fallId}`)

    const zeile: InhaltZeile = {
      id: mutation.itemId,
      fallId,
      seq: 1,
      art: 'item',
      geloescht: false,
      imTresor: true,
      kid: `vault_${fallId}`,
      wrappedDek: mutation.wrappedDek,
      payload: mutation.payload,
      geaendertAm: '2026-08-24T12:00:00Z',
    }

    const items = await tresorItemsAusZeilen([zeile], kv)
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      id: mutation.itemId,
      titel: 'Bankkonto',
      inhalt: 'IBAN: DE123456789',
    })
  })

  it('lässt sich mit einem falschen K_v nicht entschlüsseln und wird verworfen', async () => {
    const kv1 = erzeugeAesSchluessel()
    const kv2 = erzeugeAesSchluessel()
    const fallId = 'fall-1'

    const mutation = await mutationTresorAnlegen(fallId, kv1, 'Testament', 'Geheimes Testament')
    if (mutation.op !== 'anlegen') throw new Error('Muss anlegen sein')
    const zeile: InhaltZeile = {
      id: mutation.itemId,
      fallId,
      seq: 1,
      art: 'item',
      geloescht: false,
      imTresor: true,
      kid: `vault_${fallId}`,
      wrappedDek: mutation.wrappedDek,
      payload: mutation.payload,
      geaendertAm: '2026-08-24T12:00:00Z',
    }

    const items = await tresorItemsAusZeilen([zeile], kv2)
    expect(items).toHaveLength(0)
  })
})
