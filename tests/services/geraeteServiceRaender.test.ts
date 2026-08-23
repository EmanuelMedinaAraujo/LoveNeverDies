import { beforeEach, describe, expect, it, vi } from 'vitest'
import { geraetePruefcode } from '../../src/core/crypto/fingerprint'
import { erzeugeKemSchluesselpaar } from '../../src/core/crypto/kem'
import type { Geraeteidentitaet } from '../../src/core/crypto/keystore'
import { erzeugeSignaturSchluesselpaar, pkSigBytes } from '../../src/core/crypto/sign'
import type { GeraeteschluesselTabelle } from '../../src/core/db/geraeteschluessel'
import {
  benenneGeraetUm,
  eigeneGeraete,
  GeraeteFehler,
  registriereGeraet,
} from '../../src/services/geraeteService'

/**
 * Die Ränder der Geräteregistrierung (DESIGN.md §3.6).
 *
 * Der gewöhnliche Weg steht in `geraeteService.test.ts` gegen eine Tabelle,
 * die sich wie `device_keys` verhält. Hier stehen die Fälle, die sich mit
 * einer sich korrekt verhaltenden Tabelle **nicht** herstellen lassen: der
 * Wettlauf, der in beiden Richtungen verliert, und die Namensprüfung.
 */

const ANNA = 'user_anna'

async function testidentitaet(fuellwert = 1): Promise<Geraeteidentitaet> {
  const kem = erzeugeKemSchluesselpaar(new Uint8Array(32).fill(fuellwert))
  const signatur = erzeugeSignaturSchluesselpaar(new Uint8Array(64).fill(fuellwert))
  const pkKem = kem.oeffentlich
  const pkSig = pkSigBytes(signatur.oeffentlich)

  return {
    kem,
    signatur,
    pkKem,
    pkSig,
    fingerabdruck: new Uint8Array(32),
    pruefcode: await geraetePruefcode(pkKem, pkSig),
  }
}

function tabelleMit(teile: Partial<GeraeteschluesselTabelle>): GeraeteschluesselTabelle {
  return {
    finde: vi.fn().mockResolvedValue(null),
    legeAn: vi.fn().mockResolvedValue(null),
    nachId: vi.fn().mockResolvedValue(null),
    fuerBenutzer: vi.fn().mockResolvedValue([]),
    benenneUm: vi.fn().mockResolvedValue(undefined),
    ...teile,
  }
}

let identitaet: Geraeteidentitaet

beforeEach(async () => {
  identitaet = await testidentitaet()
})

describe('registriereGeraet', () => {
  it('gibt auf, wenn sich das Geraet weder finden noch anlegen laesst', async () => {
    /*
     * `legeAn` meldet einen Konflikt (jemand war schneller), aber das
     * anschliessende `finde` liefert nichts — die Zeile ist also weder da noch
     * anzulegen. Eine Geraeteliste ohne das eigene Geraet waere schlimmer als
     * ein Abbruch: Sie saehe vollstaendig aus.
     */
    const tabelle = tabelleMit({
      legeAn: vi.fn().mockResolvedValue(null),
      finde: vi.fn().mockResolvedValue(null),
    })

    await expect(
      registriereGeraet(tabelle, identitaet, { userId: ANNA, label: 'iPhone' }),
    ).rejects.toThrow(GeraeteFehler)

    await expect(
      registriereGeraet(tabelle, identitaet, { userId: ANNA, label: 'iPhone' }),
    ).rejects.toThrow(/weder finden noch anlegen/)
  })
})

describe('eigeneGeraete', () => {
  it('sortiert bei gleichem Rang nach Alter', async () => {
    // Sonst aenderte sich die Reihenfolge bei jedem Aufruf.
    const fremd = await testidentitaet(2)
    const nochFremder = await testidentitaet(3)

    const tabelle = tabelleMit({
      fuerBenutzer: vi.fn().mockResolvedValue([
        {
          id: 'geraet-neu',
          userId: ANNA,
          pkKem: nochFremder.pkKem,
          pkSig: nochFremder.pkSig,
          label: 'Neueres',
          angelegtAm: '2026-08-24T10:00:00Z',
        },
        {
          id: 'geraet-alt',
          userId: ANNA,
          pkKem: fremd.pkKem,
          pkSig: fremd.pkSig,
          label: 'Aelteres',
          angelegtAm: '2026-08-20T10:00:00Z',
        },
      ]),
    })

    const geraete = await eigeneGeraete(tabelle, identitaet, ANNA)

    expect(geraete.map((geraet) => geraet.label)).toEqual(['Aelteres', 'Neueres'])
  })

  it('kommt mit einer leeren Liste zurecht', async () => {
    await expect(eigeneGeraete(tabelleMit({}), identitaet, ANNA)).resolves.toEqual([])
  })
})

describe('benenneGeraetUm', () => {
  it('weist einen leeren Namen zurueck', async () => {
    const tabelle = tabelleMit({})

    await expect(benenneGeraetUm(tabelle, 'geraet-1', '')).rejects.toThrow(
      /darf nicht leer sein/,
    )
    expect(tabelle.benenneUm).not.toHaveBeenCalled()
  })

  it('weist einen Namen aus lauter Leerzeichen zurueck', async () => {
    const tabelle = tabelleMit({})

    await expect(benenneGeraetUm(tabelle, 'geraet-1', '   ')).rejects.toThrow(GeraeteFehler)
    expect(tabelle.benenneUm).not.toHaveBeenCalled()
  })

  it('schneidet Leerraum ab, bevor der Name in die Tabelle geht', async () => {
    const tabelle = tabelleMit({})

    await benenneGeraetUm(tabelle, 'geraet-1', '  iPad von Anna  ')

    expect(tabelle.benenneUm).toHaveBeenCalledWith('geraet-1', 'iPad von Anna')
  })
})
