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
import { VORSORGEFRAGEN } from '../../src/content/vorsorgefragen'
import {
  antwortZuFrage,
  berechneTresorSchwelle,
  checklistenstand,
  freieEintraege,
  mutationTresorAendern,
  mutationTresorAnlegen,
  tresorItemsAusZeilen,
  verteileShares,
  type TresorItem,
} from '../../src/services/tresorService'

function mockDb() {
  const mitglieder: MitgliedZeile[] = []
  const geraete: GeraeteschluesselZeile[] = []
  let gespeicherteShares: ResplitShareInput[] = []
  let gespeichertesN: number | null = null
  let gespeichertesK: number | null = null

  const mitgliederDb: MitgliederTabelle = {
    imFall: () => Promise.resolve(mitglieder),
    verlasseFall: () => Promise.reject(new Error('nicht gebraucht')),
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
    uebergibShare: () => Promise.reject(new Error('nicht gebraucht')),
    freigabenFuerFall: () => Promise.resolve([]),
    sendeFreigabe: () => Promise.reject(new Error('nicht gebraucht')),
    oeffneTresor: () => Promise.reject(new Error('nicht gebraucht')),
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

  it('trägt die Frage-Kennung durch das Verschlüsseln und wieder heraus', async () => {
    const kv = erzeugeAesSchluessel()
    const fallId = 'fall-1'

    const mutation = await mutationTresorAnlegen(
      fallId,
      kv,
      'Haben Sie ein Testament? Wenn ja, wo befindet es sich?',
      'Im Bankschließfach.',
      'testament',
    )
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

    const [item] = await tresorItemsAusZeilen([zeile], kv)
    if (item === undefined) throw new Error('Das Item fehlt.')
    expect(item.frageId).toBe('testament')

    // Ein frei angelegter Eintrag hat keine: `null`, nicht `undefined`.
    const frei = await mutationTresorAnlegen(fallId, kv, 'Bankkonto', 'DE123')
    if (frei.op !== 'anlegen') throw new Error('Muss anlegen sein')
    const [freiesItem] = await tresorItemsAusZeilen(
      [{ ...zeile, id: frei.itemId, wrappedDek: frei.wrappedDek, payload: frei.payload }],
      kv,
    )
    expect(freiesItem?.frageId).toBeNull()
  })

  it('behält beim Ändern den DEK und die Frage-Kennung', async () => {
    const kv = erzeugeAesSchluessel()
    const fallId = 'fall-1'

    const angelegt = await mutationTresorAnlegen(
      fallId,
      kv,
      'Haben Sie ein Testament?',
      'Im Schrank.',
      'testament',
    )
    if (angelegt.op !== 'anlegen') throw new Error('Muss anlegen sein')

    const zeile: InhaltZeile = {
      id: angelegt.itemId,
      fallId,
      seq: 1,
      art: 'item',
      geloescht: false,
      imTresor: true,
      kid: `vault_${fallId}`,
      wrappedDek: angelegt.wrappedDek,
      payload: angelegt.payload,
      geaendertAm: '2026-08-24T12:00:00Z',
    }

    const [item] = await tresorItemsAusZeilen([zeile], kv)
    if (item === undefined) throw new Error('Das Item fehlt.')

    const geaendert = await mutationTresorAendern(item, item.titel, 'Im Bankschließfach.')
    expect(geaendert.op).toBe('aendern')
    if (geaendert.op !== 'aendern') throw new Error('Muss aendern sein')
    expect(geaendert.itemId).toBe(angelegt.itemId)

    // Derselbe `wrappedDek` wie vorher: Ein Edit kostet genau eine Spalte (§5).
    const [nachher] = await tresorItemsAusZeilen(
      [{ ...zeile, payload: geaendert.payload, geaendertAm: '2026-08-25T09:00:00Z' }],
      kv,
    )
    expect(nachher?.inhalt).toBe('Im Bankschließfach.')
    expect(nachher?.frageId).toBe('testament')
  })

  it('nimmt bei zwei Antworten auf dieselbe Frage die jüngere', () => {
    const basis: TresorItem = {
      id: 'item-1',
      titel: 'Haben Sie ein Testament?',
      inhalt: 'Im Schrank.',
      frageId: 'testament',
      dek: new Uint8Array(32),
      geaendertAm: '2026-08-24T12:00:00Z',
    }

    const items: TresorItem[] = [
      basis,
      { ...basis, id: 'item-2', inhalt: 'Im Bankschließfach.', geaendertAm: '2026-08-25T09:00:00Z' },
      { ...basis, id: 'item-3', frageId: null, inhalt: 'Etwas anderes.' },
    ]

    expect(antwortZuFrage(items, 'testament')?.id).toBe('item-2')
    expect(antwortZuFrage(items, 'bestattung')).toBeNull()
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

describe('Freie Einträge und Checklistenstand (§3.5)', () => {
  function item(ueberschreibung: Partial<TresorItem> = {}): TresorItem {
    return {
      id: 'item-1',
      titel: 'Bankverbindung',
      inhalt: '',
      frageId: null,
      dek: new Uint8Array([9]),
      geaendertAm: '2026-08-24T12:00:00Z',
      ...ueberschreibung,
    }
  }

  it('liest die freien Einträge in der Reihenfolge ihrer Entstehung', () => {
    const zuerst = item({ id: 'item-1' })
    const danach = item({ id: 'item-2' })

    // Auch verdreht hereingereicht: `uuidv7` trägt die Zeit in der Kennung.
    expect(freieEintraege([danach, zuerst]).map((eintrag) => eintrag.id)).toEqual([
      'item-1',
      'item-2',
    ])
  })

  it('lässt die Antworten auf Checklistenfragen draussen', () => {
    // Sonst stünde dieselbe Auskunft zweimal auf dem Bildschirm: einmal unter
    // ihrer Frage, einmal ohne sie und ohne Feld zum Ändern.
    const frei = item({ id: 'item-3' })

    expect(freieEintraege([item({ id: 'item-2', frageId: 'testament' }), frei])).toEqual([frei])
  })

  it('zählt nur beantwortete Checklistenfragen', () => {
    const stand = checklistenstand([
      item({ id: 'item-1', frageId: 'testament', inhalt: 'Im Ordner im Flur.' }),
      item({ id: 'item-2', frageId: 'abos', inhalt: 'Zeitung, Fitnessstudio' }),
    ])

    expect(stand).toEqual({ beantwortet: 2, gesamt: VORSORGEFRAGEN.length })
  })

  it('zählt eine geleerte Antwort nicht mit', () => {
    /*
     * Es gibt sie: Wer eine Antwort wieder leert, hinterlässt eine Zeile ohne
     * Auskunft. Sie als beantwortet zu zählen wäre die eine Zahl, die nach dem
     * Löschen steigt.
     */
    const stand = checklistenstand([item({ id: 'item-1', frageId: 'testament', inhalt: '   ' })])

    expect(stand.beantwortet).toBe(0)
  })

  it('zählt eine Antwort auf eine Frage, die es nicht mehr gibt, nicht mit', () => {
    // "3 von 8" soll eine Auskunft über die Liste sein, die auf dem Bildschirm
    // steht — nicht über die Zeilen, die im Tresor liegen.
    const stand = checklistenstand([
      item({ id: 'item-1', frageId: 'sachversicherungen', inhalt: 'Kfz bei der Allianz' }),
    ])

    expect(stand.beantwortet).toBe(0)
  })

  it('findet die Antwort auf eine Checklistenfrage über deren Kennung', () => {
    const testament = item({ id: 'item-3', frageId: 'testament', inhalt: 'Im Ordner im Flur.' })

    expect(antwortZuFrage([item({ frageId: 'abos' }), testament], 'testament')).toEqual(testament)
  })
})
