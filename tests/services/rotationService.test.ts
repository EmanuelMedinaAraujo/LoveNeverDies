import { describe, expect, it } from 'vitest'
import { entschluessele, erzeugeAesSchluessel, verschluessele } from '../../src/core/crypto/aead'
import { bytesText, textBytes } from '../../src/core/crypto/bytes'
import { erzeugeKemSchluesselpaar } from '../../src/core/crypto/kem'
import type { Geraeteidentitaet } from '../../src/core/crypto/keystore'
import { erzeugeSignaturSchluesselpaar, pkSigBytes, signaturSchluesselAusBytes } from '../../src/core/crypto/sign'
import { entpackeSchluessel } from '../../src/core/crypto/wrap'
import type { FaelleTabelle } from '../../src/core/db/faelle'
import type { SchluesselwrapTabelle, SchluesselwrapZeile } from '../../src/core/db/fallschluessel'
import type { GeraeteschluesselTabelle, GeraeteschluesselZeile } from '../../src/core/db/geraeteschluessel'
import type { InhalteTabelle, InhaltZeile } from '../../src/core/db/inhalte'
import type { MitgliederTabelle } from '../../src/core/db/mitglieder'
import type { LesbarerFall } from '../../src/services/fallService'
import { rotiereFallschluessel } from '../../src/services/rotationService'

function erzeugeIdentitaet(): Geraeteidentitaet {
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

describe('rotiereFallschluessel (§3.4, §4, §7)', () => {
  it('rotiert K_c, erzeugt Wraps für alle Mitglieder und wrappt nur geteilte Items um', async () => {
    const identAnna = erzeugeIdentitaet()
    const identClara = erzeugeIdentitaet()

    const fallId = 'fall-100'
    const oldKid = `case_${fallId}:1`
    const kcAlt = erzeugeAesSchluessel()
    const kcat = erzeugeAesSchluessel()

    const fall: LesbarerFall = {
      zustand: 'lesbar',
      id: fallId,
      status: 'trauerfall',
      personName: 'Hans Meier',
      sterbedatum: '2026-06-01',
      kid: oldKid,
      keyGeneration: 1,
      rotationPending: true,
      kc: kcAlt,
      kcat,
      kv: null,
      preparerId: null,
      vaultCommitment: null,
      vaultResplitPending: false,
      vaultK: null,
      vaultN: null,
      katalogVersion: '2026-08',
    }

    const geraeteAnna: GeraeteschluesselZeile = {
      id: 'geraet-anna-1',
      userId: 'user_anna',
      pkKem: identAnna.pkKem,
      pkSig: identAnna.pkSig,
      label: 'Annas iPhone',
      angelegtAm: '2026-08-20T10:00:00Z',
    }

    const geraeteClara: GeraeteschluesselZeile = {
      id: 'geraet-clara-1',
      userId: 'user_clara',
      pkKem: identClara.pkKem,
      pkSig: identClara.pkSig,
      label: 'Claras iPad',
      angelegtAm: '2026-08-20T10:00:00Z',
    }

    // Dek und Items anlegen
    const dekGeteilt = erzeugeAesSchluessel()
    const wrappedDekGeteilt = await verschluessele(kcAlt, dekGeteilt)

    const dekTresor = erzeugeAesSchluessel()
    const kv = erzeugeAesSchluessel()
    const wrappedDekTresor = await verschluessele(kv, dekTresor)

    const dekPrivat = erzeugeAesSchluessel()
    const kp = erzeugeAesSchluessel()
    const wrappedDekPrivat = await verschluessele(kp, dekPrivat)

    const items: InhaltZeile[] = [
      {
        id: 'item-geteilt',
        fallId,
        seq: 1,
        art: 'item',
        geloescht: false,
        imTresor: false,
        kid: oldKid,
        wrappedDek: wrappedDekGeteilt,
        payload: await verschluessele(dekGeteilt, textBytes(JSON.stringify({ titel: 'Bestatter rufen' }))),
        geaendertAm: '2026-08-24T10:00:00Z',
      },
      {
        id: 'item-tresor',
        fallId,
        seq: 2,
        art: 'item',
        geloescht: false,
        imTresor: true,
        kid: `vault_${fallId}`,
        wrappedDek: wrappedDekTresor,
        payload: await verschluessele(dekTresor, textBytes(JSON.stringify({ titel: 'Tresorinhalt' }))),
        geaendertAm: '2026-08-24T10:00:00Z',
      },
      {
        id: 'item-privat',
        fallId,
        seq: 3,
        art: 'item',
        geloescht: false,
        imTresor: false,
        kid: 'personal_clara_1',
        wrappedDek: wrappedDekPrivat,
        payload: await verschluessele(dekPrivat, textBytes(JSON.stringify({ titel: 'Privatnotiz' }))),
        geaendertAm: '2026-08-24T10:00:00Z',
      },
    ]

    const geschriebeneWraps: SchluesselwrapZeile[] = []
    let committetPayload: Uint8Array | undefined
    let committeteItems: { id: string; wrappedDek: Uint8Array }[] | undefined

    const faelle: FaelleTabelle = {
      version: () => Promise.resolve(1),
      legeTrauerfallAn: () => Promise.reject(new Error('nicht gebraucht')),
      legeVorsorgefallAn: () => Promise.reject(new Error('nicht gebraucht')),
      loescheVorsorgefall: () => Promise.reject(new Error('nicht gebraucht')),
      eigene: () => Promise.resolve([]),
      claimRotation: (_id, gen) => Promise.resolve(gen === 1),
      commitRotation: (_id, gen, _newKid, _geraet, payload, umgewrappteItems) => {
        committetPayload = payload
        committeteItems = umgewrappteItems
        if (umgewrappteItems) {
          for (const u of umgewrappteItems) {
            const item = items.find((i) => i.id === u.id)
            if (item) {
              item.kid = _newKid
              item.wrappedDek = u.wrappedDek
            }
          }
        }
        return Promise.resolve(gen === 1)
      },
    }

    const inhalte: InhalteTabelle = {
      seit: () => Promise.resolve([...items]),
      lege: () => Promise.reject(new Error('nicht gebraucht')),
      legeAlleNeuen: () => Promise.reject(new Error('nicht gebraucht')),
      schreibePayload: () => Promise.reject(new Error('nicht gebraucht')),
      umwrappe: () => Promise.reject(new Error('nicht gebraucht')),
      rotiereItem: () => Promise.reject(new Error('rotiereItem darf nicht mehr einzeln gerufen werden')),
      loesche: () => Promise.reject(new Error('nicht gebraucht')),
    }

    const fallschluessel: SchluesselwrapTabelle = {
      fuerGeraet: () => Promise.resolve([]),
      schreibeWraps: (wraps) => {
        geschriebeneWraps.push(...wraps)
        return Promise.resolve()
      },
    }

    const geraete: GeraeteschluesselTabelle = {
      finde: () => Promise.resolve(null),
      legeAn: () => Promise.resolve(null),
      nachId: () => Promise.resolve(null),
      fuerBenutzer: (userId: string) => {
        const res: GeraeteschluesselZeile[] = []
        if (userId === 'user_anna') res.push(geraeteAnna)
        if (userId === 'user_clara') res.push(geraeteClara)
        return Promise.resolve(res)
      },
      benenneUm: () => Promise.reject(new Error('nicht gebraucht')),
    }

    const mitglieder: MitgliederTabelle = {
      imFall: () =>
        Promise.resolve([
          { userId: 'user_anna', beigetretenAm: '2026-08-20T10:00:00Z' },
          { userId: 'user_clara', beigetretenAm: '2026-08-20T11:00:00Z' },
        ]),
      verlasseFall: () => Promise.reject(new Error('nicht gebraucht')),
    }

    const ergebnis = await rotiereFallschluessel(
      faelle,
      inhalte,
      fallschluessel,
      geraete,
      mitglieder,
      fall,
      identAnna,
      'geraet-anna-1',
    )

    expect(ergebnis.status).toBe('erfolg')
    if (ergebnis.status !== 'erfolg') return

    expect(ergebnis.kidNeu).toBe(`case_${fallId}:2`)
    expect(ergebnis.kcNeu).toBeInstanceOf(Uint8Array)
    expect(ergebnis.kcNeu.length).toBe(32)

    // 1. Wraps wurden für beide Geräte geschrieben
    expect(geschriebeneWraps).toHaveLength(2)
    expect(geschriebeneWraps.map((w) => w.geraeteId).sort()).toEqual(['geraet-anna-1', 'geraet-clara-1'])

    // Claras Gerät kann den Wrap entpacken
    const wrapClara = geschriebeneWraps.find((w) => w.geraeteId === 'geraet-clara-1')!
    const entpacktKcClara = await entpackeSchluessel(
      wrapClara,
      { fallId, kid: ergebnis.kidNeu, geraeteId: 'geraet-clara-1' },
      identClara.kem.geheim,
      signaturSchluesselAusBytes(identAnna.pkSig),
    )
    expect(entpacktKcClara).toEqual(ergebnis.kcNeu)

    // 2. Geteiltes Item wurde atomar an commitRotation übergeben und umgewrappt
    expect(committeteItems).toHaveLength(1)
    expect(committeteItems![0]?.id).toBe('item-geteilt')
    const itemGeteilt = items.find((i) => i.id === 'item-geteilt')!
    expect(itemGeteilt.kid).toBe(`case_${fallId}:2`)
    // Mit dem neuen kc lässt sich der ursprüngliche DEK wieder entpacken
    const entpacktDek = await entschluessele(ergebnis.kcNeu, itemGeteilt.wrappedDek)
    expect(entpacktDek).toEqual(dekGeteilt)

    // 3. Tresor-Item und Privat-Item blieben unverändert
    const itemTresor = items.find((i) => i.id === 'item-tresor')!
    expect(itemTresor.kid).toBe(`vault_${fallId}`)
    expect(itemTresor.wrappedDek).toEqual(wrappedDekTresor)

    const itemPrivat = items.find((i) => i.id === 'item-privat')!
    expect(itemPrivat.kid).toBe('personal_clara_1')
    expect(itemPrivat.wrappedDek).toEqual(wrappedDekPrivat)

    // 4. Fall-Payload wurde mit neuem Kc verschlüsselt committet
    expect(committetPayload).toBeDefined()
    const entschluesselterPayload = JSON.parse(
      bytesText(await entschluessele(ergebnis.kcNeu, committetPayload!)),
    )
    expect(entschluesselterPayload).toEqual({ personName: 'Hans Meier', sterbedatum: '2026-06-01' })
  })

  it('gibt mandat_verweigert zurück, wenn claimRotation false liefert', async () => {
    const identAnna = erzeugeIdentitaet()
    const fallId = 'fall-101'

    const fall: LesbarerFall = {
      zustand: 'lesbar',
      id: fallId,
      status: 'trauerfall',
      personName: 'Hans Meier',
      sterbedatum: null,
      kid: `case_${fallId}:1`,
      keyGeneration: 1,
      rotationPending: true,
      kc: erzeugeAesSchluessel(),
      kcat: erzeugeAesSchluessel(),
      kv: null,
      preparerId: null,
      vaultCommitment: null,
      vaultResplitPending: false,
      vaultK: null,
      vaultN: null,
      katalogVersion: '2026-08',
    }

    const faelle: FaelleTabelle = {
      version: () => Promise.resolve(1),
      legeTrauerfallAn: () => Promise.reject(new Error()),
      legeVorsorgefallAn: () => Promise.reject(new Error()),
      loescheVorsorgefall: () => Promise.reject(new Error()),
      eigene: () => Promise.resolve([]),
      claimRotation: () => Promise.resolve(false), // Mandat verweigert!
      commitRotation: () => Promise.resolve(false),
    }

    const inhalte = {} as unknown as InhalteTabelle
    const fallschluessel = {} as unknown as SchluesselwrapTabelle
    const geraete = {} as unknown as GeraeteschluesselTabelle
    const mitglieder = {} as unknown as MitgliederTabelle

    const ergebnis = await rotiereFallschluessel(
      faelle,
      inhalte,
      fallschluessel,
      geraete,
      mitglieder,
      fall,
      identAnna,
      'geraet-1',
    )

    expect(ergebnis.status).toBe('mandat_verweigert')
  })

  it('gibt cas_fehlgeschlagen zurück, wenn commitRotation false liefert', async () => {
    const identAnna = erzeugeIdentitaet()
    const fallId = 'fall-102'

    const fall: LesbarerFall = {
      zustand: 'lesbar',
      id: fallId,
      status: 'trauerfall',
      personName: 'Hans Meier',
      sterbedatum: null,
      kid: `case_${fallId}:1`,
      keyGeneration: 1,
      rotationPending: true,
      kc: erzeugeAesSchluessel(),
      kcat: erzeugeAesSchluessel(),
      kv: null,
      preparerId: null,
      vaultCommitment: null,
      vaultResplitPending: false,
      vaultK: null,
      vaultN: null,
      katalogVersion: '2026-08',
    }

    const faelle: FaelleTabelle = {
      version: () => Promise.resolve(1),
      legeTrauerfallAn: () => Promise.reject(new Error()),
      legeVorsorgefallAn: () => Promise.reject(new Error()),
      loescheVorsorgefall: () => Promise.reject(new Error()),
      eigene: () => Promise.resolve([]),
      claimRotation: () => Promise.resolve(true),
      commitRotation: () => Promise.resolve(false), // CAS schlägt fehl!
    }

    const inhalte: InhalteTabelle = {
      seit: () => Promise.resolve([]),
      lege: () => Promise.reject(new Error()),
      legeAlleNeuen: () => Promise.reject(new Error()),
      schreibePayload: () => Promise.reject(new Error()),
      umwrappe: () => Promise.reject(new Error()),
      rotiereItem: () => Promise.resolve(),
      loesche: () => Promise.reject(new Error()),
    }

    const fallschluessel: SchluesselwrapTabelle = {
      fuerGeraet: () => Promise.resolve([]),
      schreibeWraps: () => Promise.resolve(),
    }

    const geraete: GeraeteschluesselTabelle = {
      finde: () => Promise.resolve(null),
      legeAn: () => Promise.resolve(null),
      nachId: () => Promise.resolve(null),
      fuerBenutzer: () => Promise.resolve([]),
      benenneUm: () => Promise.reject(new Error()),
    }

    const mitglieder: MitgliederTabelle = {
      imFall: () => Promise.resolve([]),
      verlasseFall: () => Promise.reject(new Error()),
    }

    const ergebnis = await rotiereFallschluessel(
      faelle,
      inhalte,
      fallschluessel,
      geraete,
      mitglieder,
      fall,
      identAnna,
      'geraet-1',
    )

    expect(ergebnis.status).toBe('cas_fehlgeschlagen')
  })
})
