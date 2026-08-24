import { describe, expect, it } from 'vitest'
import { textBytes } from '../../src/core/crypto/bytes'
import { erzeugeKemSchluesselpaar } from '../../src/core/crypto/kem'
import type { Geraeteidentitaet } from '../../src/core/crypto/keystore'
import { erzeugeSignaturSchluesselpaar, pkSigBytes } from '../../src/core/crypto/sign'
import type {
  FaelleTabelle,
  FallZeile,
  NeuerTrauerfall,
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
import { katalog as ausgelieferterKatalog } from '../../src/content/katalog'
import { aufgabenAusZeilen } from '../../src/services/aufgabenService'
import { FallFehler, ladeFaelle, legeTrauerfallAn } from '../../src/services/fallService'

/**
 * Die vollständige Kette aus DESIGN.md §3.1 und §3.6, ohne Server:
 * Fallschlüssel erzeugen, an das eigene Gerät wrappen, signieren, ablegen,
 * wieder lesen, Signatur verifizieren, entpacken, entschlüsseln.
 *
 * Der Server steht hier als Speicher ohne Verstand — er nimmt an, was kommt,
 * und gibt zurück, was drinsteht. Genau so, wie das Bedrohungsmodell aus §11 es
 * annimmt: neugierig und potenziell aktiv. Was er ausliefert, prüft der Client.
 */

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
  const geraeteZeilen: GeraeteschluesselZeile[] = []
  const itemZeilen: InhaltZeile[] = []

  const faelle: FaelleTabelle = {
    version(fallId) {
      // Der billige Check aus §5. Der `fallService` benutzt ihn nicht — er
      // liest Fälle, nicht Inhalte —, aber der Port verlangt ihn.
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
    eigene: () => Promise.resolve(faelleZeilen),
  }

  /** `items`, so schmal wie der Port — und mit dem `on conflict` aus §8. */
  const inhalte: InhalteTabelle = {
    seit: (fallId) => Promise.resolve(itemZeilen.filter((zeile) => zeile.fallId === fallId)),

    lege: (neu) => {
      itemZeilen.push(alsItem(neu))

      return Promise.resolve()
    },

    legeAlleNeuen: (neue) => {
      for (const neu of neue) {
        // `insert … on conflict do nothing`: Was es gibt, bleibt, wie es ist.
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

  return { faelle, inhalte, wraps, geraete, faelleZeilen, wrapZeilen, itemZeilen, meldeGeraetAn }
}

let naechsteSeq = 0

function alsItem(neu: NeuerInhalt): InhaltZeile {
  return {
    ...neu,
    seq: (naechsteSeq += 1),
    geloescht: false,
    imTresor: false,
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
  return ladeFaelle(s.faelle, s.wraps, s.geraete, s.eigene, GERAET)
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

    // Nirgendwo in dem, was zum Server geht, stehen die Schlüsselbytes.
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
    expect(itemZeilen).toHaveLength(katalog.aufgaben.length)
    expect(itemZeilen.every((zeile) => zeile.fallId === fall.id)).toBe(true)
    expect(itemZeilen.every((zeile) => zeile.kid === fall.kid)).toBe(true)
  })

  it('legt die Katalogaufgaben verschlüsselt an — lesbar nur mit K_c', async () => {
    const { fall, itemZeilen } = await angelegterFall()

    const { aufgaben } = await aufgabenAusZeilen(itemZeilen, fall)

    expect(aufgaben.map((aufgabe) => aufgabe.titel)).toEqual(
      ausgelieferterKatalog().aufgaben.map((aufgabe) => aufgabe.titel),
    )
    expect(aufgaben.every((aufgabe) => aufgabe.katalog !== null)).toBe(true)
  })

  it('legt den Fall an, auch wenn die Instanziierung scheitert', async () => {
    /*
     * Der Fall steht danach vollständig da — nur ohne Aufgaben. Ein Wurf
     * machte daraus „Der Fall war nicht anzulegen" (Todesfall.tsx), und der
     * zweite Versuch legte einen zweiten Fall zu derselben verstorbenen Person
     * an. Nachgeholt wird die Instanziierung beim nächsten Laden (§8).
     */
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

describe('Einen Fall wieder lesen (§3.6)', () => {
  it('entschlüsselt Name und Sterbedatum aus dem Payload', async () => {
    // Das Neuladen: dieselben Zeilen, dieselbe Geräteidentität, nichts im
    // Arbeitsspeicher.
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
    // Der Angriff aus §3.6: Ein Mitglied stellt einen formal gültigen Wrap
    // eines falschen `K_c` ein. Der Fall bleibt gesperrt — die App zeigt ihn,
    // aber sie liest nichts daraus.
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
    // §3.6: Ein neues Gerät sieht den Fall, kann synchronisieren und liest
    // nichts, bis ein anderes Mitglied `K_c` daran wrappt.
    const s = await angelegterFall()
    const fremdesGeraet = 'a0000000-0000-4000-8000-000000000002'
    s.meldeGeraetAn(fremdesGeraet, identitaet())

    const geladen = await ladeFaelle(s.faelle, s.wraps, s.geraete, s.eigene, fremdesGeraet)

    expect(geladen).toEqual([expect.objectContaining({ zustand: 'gesperrt' })])
  })

  it('sperrt einen Fall, dessen wrappendes Gerät nicht auffindbar ist', async () => {
    // Ohne `sig_public_key` gibt es nichts zu verifizieren, und ohne
    // Verifikation wird nichts entpackt — auch dann nicht, wenn der Wrap
    // vollkommen in Ordnung wäre.
    const s = await angelegterFall()
    for (const zeile of s.wrapZeilen) {
      zeile.wrappedBy = 'a0000000-0000-4000-8000-00000000ffff'
    }

    expect(await neuGeladen(s)).toEqual([expect.objectContaining({ zustand: 'gesperrt' })])
  })
})
