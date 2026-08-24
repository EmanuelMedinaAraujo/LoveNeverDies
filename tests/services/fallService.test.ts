import { describe, expect, it } from 'vitest'
import { textBytes } from '../../src/core/crypto/bytes'
import { erzeugeKemSchluesselpaar } from '../../src/core/crypto/kem'
import type { Geraeteidentitaet } from '../../src/core/crypto/keystore'
import { erzeugeSignaturSchluesselpaar, pkSigBytes } from '../../src/core/crypto/sign'
import type {
  FaelleTabelle,
  FallZeile,
  NeuerTrauerfall,
  NeuerVorsorgefall,
} from '../../src/core/db/faelle'
import type {
  SchluesselwrapTabelle,
  SchluesselwrapZeile,
} from '../../src/core/db/fallschluessel'
import type {
  GeraeteschluesselTabelle,
  GeraeteschluesselZeile,
} from '../../src/core/db/geraeteschluessel'
import type { InhalteTabelle, InhaltZeile, NeuerInhalt } from '../../src/core/db/inhalte'
import type { TresorTabelle, VaultKeyWrapZeile } from '../../src/core/db/tresor'
import { katalog as ausgelieferterKatalog } from '../../src/content/katalog'
import { aufgabenAusZeilen } from '../../src/services/aufgabenService'
import {
  FallFehler,
  ladeFaelle,
  legeTrauerfallAn,
  legeVorsorgefallAn,
  loescheVorsorgefall,
} from '../../src/services/fallService'

const ANGABEN = { personName: 'Hans Weber', sterbedatum: '2026-05-12' }

function identitaet(): Geraeteidentitaet {
  const kem = erzeugeKemSchluesselpaar()
  const signatur = erzeugeSignaturSchluesselpaar()

  return {
    kem,
    signatur,
    pkKem: kem.oeffentlich,
    pkSig: pkSigBytes(signatur.oeffentlich),
    fingerabdruck: new Uint8Array(32),
    pruefcode: '000000',
  }
}

/** Ein Server: vier Tabellen, keine Meinung. */
function server() {
  const faelleZeilen: FallZeile[] = []
  const wrapZeilen: SchluesselwrapZeile[] = []
  const vaultWrapZeilen: VaultKeyWrapZeile[] = []
  const geraeteZeilen: GeraeteschluesselZeile[] = []
  const itemZeilen: InhaltZeile[] = []

  const faelle: FaelleTabelle = {
    version(fallId) {
      return Promise.resolve(
        faelleZeilen.find((zeile) => zeile.id === fallId)?.version ?? null,
      )
    },

    legeTrauerfallAn(neu: NeuerTrauerfall) {
      faelleZeilen.push({
        id: neu.id,
        status: 'trauerfall',
        currentKid: neu.kidFall,
        keyGeneration: 1,
        version: 0,
        katalogVersion: neu.katalogVersion,
        payload: neu.payload,
        preparerId: null,
        vaultCommitment: null,
        vaultResplitPending: false,
        vaultK: null,
        vaultN: null,
        angelegtAm: '2026-08-23T12:00:00Z',
      })

      for (const [kid, wrap] of [
        [neu.kidFall, neu.wrapFall],
        [neu.kidKatalog, neu.wrapKatalog],
      ] as const) {
        wrapZeilen.push({
          ...wrap,
          fallId: neu.id,
          kid,
          geraeteId: neu.geraeteId,
          wrappedBy: neu.geraeteId,
        })
      }

      return Promise.resolve()
    },

    legeVorsorgefallAn(neu: NeuerVorsorgefall) {
      faelleZeilen.push({
        id: neu.id,
        status: 'vorsorge',
        currentKid: neu.kidFall,
        keyGeneration: 1,
        version: 0,
        katalogVersion: null,
        payload: neu.payload,
        preparerId: 'user_anna',
        vaultCommitment: neu.vaultCommitment,
        vaultResplitPending: false,
        vaultK: null,
        vaultN: 0,
        angelegtAm: '2026-08-23T12:00:00Z',
      })

      for (const [kid, wrap] of [
        [neu.kidFall, neu.wrapFall],
        [neu.kidKatalog, neu.wrapKatalog],
      ] as const) {
        wrapZeilen.push({
          ...wrap,
          fallId: neu.id,
          kid,
          geraeteId: neu.geraeteId,
          wrappedBy: neu.geraeteId,
        })
      }

      vaultWrapZeilen.push({
        fallId: neu.id,
        geraeteId: neu.geraeteId,
        kemCt: neu.vaultKemCt,
        wrappedKey: neu.vaultWrappedKey,
      })

      return Promise.resolve()
    },

    loescheVorsorgefall(fallId: string) {
      const idx = faelleZeilen.findIndex((f) => f.id === fallId)
      if (idx !== -1) {
        faelleZeilen.splice(idx, 1)
      }
      return Promise.resolve()
    },

    eigene: () => Promise.resolve(faelleZeilen),
  }

  const inhalte: InhalteTabelle = {
    seit: (fallId) => Promise.resolve(itemZeilen.filter((zeile) => zeile.fallId === fallId)),

    lege: (neu) => {
      itemZeilen.push(alsItem(neu))
      return Promise.resolve()
    },

    legeAlleNeuen: (neue) => {
      for (const neu of neue) {
        if (!itemZeilen.some((zeile) => zeile.id === neu.id)) {
          itemZeilen.push(alsItem(neu))
        }
      }
      return Promise.resolve()
    },

    schreibePayload: () => Promise.reject(new Error('nicht gebraucht')),
    loesche: () => Promise.reject(new Error('nicht gebraucht')),
  }

  const wraps: SchluesselwrapTabelle = {
    fuerGeraet: (fallId, geraeteId) =>
      Promise.resolve(
        wrapZeilen.filter((zeile) => zeile.fallId === fallId && zeile.geraeteId === geraeteId),
      ),
  }

  const tresor: TresorTabelle = {
    wrapFuerGeraet: (fallId, geraeteId) =>
      Promise.resolve(
        vaultWrapZeilen.find((zeile) => zeile.fallId === fallId && zeile.geraeteId === geraeteId) ??
          null,
      ),
    legeWrapAn: () => Promise.reject(new Error('nicht gebraucht')),
    sharesFuerFall: () => Promise.resolve([]),
    resplitVault: () => Promise.resolve(),
  }

  const geraete: GeraeteschluesselTabelle = {
    nachId: (id) => Promise.resolve(geraeteZeilen.find((zeile) => zeile.id === id) ?? null),
    finde: () => Promise.reject(new Error('nicht gebraucht')),
    legeAn: () => Promise.reject(new Error('nicht gebraucht')),
    fuerBenutzer: () => Promise.reject(new Error('nicht gebraucht')),
    benenneUm: () => Promise.reject(new Error('nicht gebraucht')),
  }

  function meldeGeraetAn(id: string, eigene: Geraeteidentitaet, userId = 'user_anna') {
    geraeteZeilen.push({
      id,
      userId,
      pkKem: eigene.pkKem,
      pkSig: eigene.pkSig,
      label: 'Testgerät',
      angelegtAm: '2026-08-23T12:00:00Z',
    })
  }

  return {
    faelle,
    inhalte,
    wraps,
    tresor,
    geraete,
    faelleZeilen,
    wrapZeilen,
    vaultWrapZeilen,
    itemZeilen,
    meldeGeraetAn,
  }
}

let naechsteSeq = 0

function alsItem(neu: NeuerInhalt): InhaltZeile {
  return {
    ...neu,
    seq: (naechsteSeq += 1),
    geloescht: false,
    imTresor: neu.imTresor ?? false,
    geaendertAm: '2026-08-23T12:00:00Z',
  }
}

const GERAET = 'a0000000-0000-4000-8000-000000000001'

async function angelegterFall() {
  const eigene = identitaet()
  const s = server()
  s.meldeGeraetAn(GERAET, eigene)

  const fall = await legeTrauerfallAn(s.faelle, s.inhalte, eigene, GERAET, ANGABEN)

  return { ...s, eigene, fall }
}

function neuGeladen(s: Awaited<ReturnType<typeof angelegterFall>>) {
  return ladeFaelle(s.faelle, s.wraps, s.geraete, s.eigene, GERAET, s.tresor)
}

describe('Einen Trauerfall anlegen (§2, §3.1)', () => {
  it('startet direkt in trauerfall', async () => {
    const { fall } = await angelegterFall()

    expect(fall).toMatchObject({
      zustand: 'lesbar',
      status: 'trauerfall',
      personName: 'Hans Weber',
      sterbedatum: '2026-05-12',
    })
  })

  it('vergibt beide kid aus der Fall-UUID', async () => {
    const { fall, wrapZeilen } = await angelegterFall()

    expect(fall.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(wrapZeilen.map((zeile) => zeile.kid).sort()).toEqual(
      [`case_${fall.id}:1`, `cat_${fall.id}`].sort(),
    )
  })

  it('legt K_c und K_cat ausschließlich als Wrap ab', async () => {
    const { fall, wrapZeilen } = await angelegterFall()

    expect(wrapZeilen).toHaveLength(2)
    expect(wrapZeilen.every((zeile) => zeile.wrappedBy === GERAET)).toBe(true)

    if (fall.zustand !== 'lesbar') {
      throw new Error('Der frisch angelegte Fall muss lesbar sein.')
    }

    const alles = wrapZeilen.flatMap((zeile) => [...zeile.kemCt, ...zeile.wrappedKey]).join(',')
    expect(alles).not.toContain([...fall.kc].join(','))
    expect(alles).not.toContain([...fall.kcat].join(','))
    expect([...fall.kc].join(',')).not.toBe([...fall.kcat].join(','))
  })

  it('schreibt Name und Sterbedatum nicht im Klartext', async () => {
    const { faelleZeilen } = await angelegterFall()

    const payload = faelleZeilen[0]?.payload ?? new Uint8Array()
    const alsText = [...payload].join(',')

    expect(alsText).not.toContain([...textBytes('Hans Weber')].join(','))
    expect(alsText).not.toContain([...textBytes('2026-05-12')].join(','))
  })

  it('friert den Katalogstand ein und legt die Aufgaben gleich mit an (§8)', async () => {
    const { fall, faelleZeilen, itemZeilen } = await angelegterFall()

    const katalog = ausgelieferterKatalog()

    expect(fall.katalogVersion).toBe(katalog.version)
    expect(faelleZeilen[0]?.katalogVersion).toBe(katalog.version)
    expect(itemZeilen).toHaveLength(
      katalog.aufgaben.reduce((summe, aufgabe) => summe + 1 + aufgabe.unteraufgaben.length, 0),
    )
    expect(itemZeilen.every((zeile) => zeile.fallId === fall.id)).toBe(true)
    expect(itemZeilen.every((zeile) => zeile.kid === fall.kid)).toBe(true)
  })

  it('legt die Katalogaufgaben verschlüsselt an — lesbar nur mit K_c', async () => {
    const { fall, itemZeilen } = await angelegterFall()

    const { aufgaben } = await aufgabenAusZeilen(itemZeilen, fall)

    const wurzeln = aufgaben.filter((aufgabe) => aufgabe.parentId === null)

    expect(wurzeln.map((aufgabe) => aufgabe.titel)).toEqual(
      ausgelieferterKatalog().aufgaben.map((aufgabe) => aufgabe.titel),
    )
    expect(wurzeln.every((aufgabe) => aufgabe.katalog !== null)).toBe(true)
  })

  it('legt den Fall an, auch wenn die Instanziierung scheitert', async () => {
    const eigene = identitaet()
    const s = server()
    s.meldeGeraetAn(GERAET, eigene)

    const inhalte = {
      ...s.inhalte,
      legeAlleNeuen: () => Promise.reject(new Error('Kein Netz.')),
    }

    const fall = await legeTrauerfallAn(s.faelle, inhalte, eigene, GERAET, ANGABEN)

    expect(fall.zustand).toBe('lesbar')
    expect(s.faelleZeilen).toHaveLength(1)
    expect(s.itemZeilen).toHaveLength(0)
  })

  it('weist einen leeren Namen zurück', async () => {
    const eigene = identitaet()
    const s = server()
    s.meldeGeraetAn(GERAET, eigene)

    await expect(
      legeTrauerfallAn(s.faelle, s.inhalte, eigene, GERAET, {
        personName: '   ',
        sterbedatum: '2026-05-12',
      }),
    ).rejects.toThrow(FallFehler)
  })

  it('weist ein Sterbedatum zurück, das keines ist', async () => {
    const eigene = identitaet()
    const s = server()
    s.meldeGeraetAn(GERAET, eigene)

    for (const sterbedatum of ['12.05.2026', '2026-13-01', '2026-02-30', '']) {
      await expect(
        legeTrauerfallAn(s.faelle, s.inhalte, eigene, GERAET, {
          personName: 'Hans Weber',
          sterbedatum,
        }),
      ).rejects.toThrow(FallFehler)
    }
  })
})

describe('Einen Vorsorgefall anlegen (§2, §3.5)', () => {
  it('legt Fall in vorsorge an: ohne Aufgaben, mit K_v und vault_commitment', async () => {
    const eigene = identitaet()
    const s = server()
    s.meldeGeraetAn(GERAET, eigene)

    const fall = await legeVorsorgefallAn(s.faelle, eigene, GERAET, {
      personName: 'Anna Müller',
    })

    expect(fall).toMatchObject({
      zustand: 'lesbar',
      status: 'vorsorge',
      personName: 'Anna Müller',
      sterbedatum: null,
      katalogVersion: null,
    })
    expect(fall.kv).not.toBeNull()
    expect(fall.vaultCommitment).not.toBeNull()

    expect(s.faelleZeilen).toHaveLength(1)
    expect(s.faelleZeilen[0]?.status).toBe('vorsorge')
    expect(s.faelleZeilen[0]?.katalogVersion).toBeNull()
    // Keine Aufgaben angelegt
    expect(s.itemZeilen).toHaveLength(0)

    // K_v liegt in vaultWrapZeilen
    expect(s.vaultWrapZeilen).toHaveLength(1)
    expect(s.vaultWrapZeilen[0]?.geraeteId).toBe(GERAET)
  })

  it('lädt K_v beim erneuten Lesen des Vorsorgefalls', async () => {
    const eigene = identitaet()
    const s = server()
    s.meldeGeraetAn(GERAET, eigene)

    const frisch = await legeVorsorgefallAn(s.faelle, eigene, GERAET, {
      personName: 'Anna Müller',
    })

    const [wieder] = await ladeFaelle(s.faelle, s.wraps, s.geraete, eigene, GERAET, s.tresor)
    if (wieder?.zustand !== 'lesbar') {
      throw new Error('Muss lesbar sein.')
    }

    expect(wieder.status).toBe('vorsorge')
    expect(wieder.personName).toBe('Anna Müller')
    expect(wieder.sterbedatum).toBeNull()
    expect(wieder.kv).toEqual(frisch.kv)
  })

  it('löscht einen Vorsorgefall samt Tresor', async () => {
    const eigene = identitaet()
    const s = server()
    s.meldeGeraetAn(GERAET, eigene)

    const fall = await legeVorsorgefallAn(s.faelle, eigene, GERAET, {
      personName: 'Anna Müller',
    })

    await loescheVorsorgefall(s.faelle, fall.id)
    expect(s.faelleZeilen).toHaveLength(0)
  })
})

describe('Einen Fall wieder lesen (§3.6)', () => {
  it('entschlüsselt Name und Sterbedatum aus dem Payload', async () => {
    const s = await angelegterFall()

    expect(await neuGeladen(s)).toEqual([
      expect.objectContaining({
        zustand: 'lesbar',
        personName: 'Hans Weber',
        sterbedatum: '2026-05-12',
      }),
    ])
  })

  it('holt K_c und K_cat aus den Wraps zurück', async () => {
    const s = await angelegterFall()
    const [wieder] = await neuGeladen(s)

    if (s.fall.zustand !== 'lesbar' || wieder?.zustand !== 'lesbar') {
      throw new Error('Beide Fälle müssen lesbar sein.')
    }

    expect(wieder.kc).toEqual(s.fall.kc)
    expect(wieder.kcat).toEqual(s.fall.kcat)
  })

  it('weist einen manipulierten Wrap ab, statt ihn zu entpacken', async () => {
    const s = await angelegterFall()
    const wrap = s.wrapZeilen[0]

    if (wrap === undefined) {
      throw new Error('Ohne Wrap gibt es nichts zu manipulieren.')
    }
    wrap.wrappedKey = Uint8Array.from(wrap.wrappedKey)
    wrap.wrappedKey[wrap.wrappedKey.length - 1] ^= 0x01

    expect(await neuGeladen(s)).toEqual([
      expect.objectContaining({ zustand: 'gesperrt', id: s.fall.id }),
    ])
  })

  it('sperrt einen Fall, für den dieses Gerät keinen Wrap hat', async () => {
    const s = await angelegterFall()
    const fremdesGeraet = 'a0000000-0000-4000-8000-000000000002'
    s.meldeGeraetAn(fremdesGeraet, identitaet())

    const geladen = await ladeFaelle(s.faelle, s.wraps, s.geraete, s.eigene, fremdesGeraet, s.tresor)

    expect(geladen).toEqual([expect.objectContaining({ zustand: 'gesperrt' })])
  })

  it('sperrt einen Fall, dessen wrappendes Gerät nicht auffindbar ist', async () => {
    const s = await angelegterFall()
    for (const zeile of s.wrapZeilen) {
      zeile.wrappedBy = 'a0000000-0000-4000-8000-00000000ffff'
    }

    expect(await neuGeladen(s)).toEqual([expect.objectContaining({ zustand: 'gesperrt' })])
  })

  it('holt K_v aus dem Vault-Wrap eines Vorsorgefalls zurück, wenn das Commitment stimmt', async () => {
    const s = server()
    const eigene = identitaet()
    s.meldeGeraetAn(GERAET, eigene)

    await legeVorsorgefallAn(s.faelle, eigene, GERAET, {
      personName: 'Anna Vorsorge',
    })

    const geladen = await ladeFaelle(s.faelle, s.wraps, s.geraete, eigene, GERAET, s.tresor)
    const [wieder] = geladen

    expect(wieder).toBeDefined()
    if (wieder?.zustand !== 'lesbar') {
      throw new Error('Fall muss lesbar sein')
    }

    expect(wieder.status).toBe('vorsorge')
    expect(wieder.kv).not.toBeNull()
    expect(wieder.kv).toHaveLength(32)
    expect(wieder.vaultCommitment).not.toBeNull()
  })

  it('sperrt den Fall, wenn das Tresor-Commitment nicht mit dem entpackten K_v übereinstimmt', async () => {
    const s = server()
    const eigene = identitaet()
    s.meldeGeraetAn(GERAET, eigene)

    await legeVorsorgefallAn(s.faelle, eigene, GERAET, {
      personName: 'Anna Vorsorge',
    })

    // Manipuliere das in der Fall-Zeile gespeicherte vaultCommitment
    const fallZeile = s.faelleZeilen[0]
    if (!fallZeile || !fallZeile.vaultCommitment) {
      throw new Error('Fallzeile oder vaultCommitment fehlt')
    }
    fallZeile.vaultCommitment = Uint8Array.from(fallZeile.vaultCommitment)
    fallZeile.vaultCommitment[0] ^= 0xff

    const geladen = await ladeFaelle(s.faelle, s.wraps, s.geraete, eigene, GERAET, s.tresor)
    const [wieder] = geladen

    expect(wieder).toEqual(
      expect.objectContaining({
        zustand: 'gesperrt',
        grund: expect.stringContaining('Commitment'),
      }),
    )
  })

  it('sperrt den Fall, wenn der Vault-Wrap beschädigt/manipuliert ist', async () => {
    const s = server()
    const eigene = identitaet()
    s.meldeGeraetAn(GERAET, eigene)

    await legeVorsorgefallAn(s.faelle, eigene, GERAET, {
      personName: 'Anna Vorsorge',
    })

    const vaultWrap = s.vaultWrapZeilen[0]
    if (!vaultWrap) {
      throw new Error('vaultWrap fehlt')
    }
    vaultWrap.wrappedKey = Uint8Array.from(vaultWrap.wrappedKey)
    vaultWrap.wrappedKey[0] ^= 0xff

    const geladen = await ladeFaelle(s.faelle, s.wraps, s.geraete, eigene, GERAET, s.tresor)
    const [wieder] = geladen

    expect(wieder).toEqual(
      expect.objectContaining({
        zustand: 'gesperrt',
        grund: expect.stringContaining('Tresorschlüssel konnte nicht entpackt werden'),
      }),
    )
  })
})

