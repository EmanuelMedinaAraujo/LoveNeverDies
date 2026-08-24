import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { erzeugeAesSchluessel, verschluessele } from '../../src/core/crypto/aead.ts'
import { sha256 } from '../../src/core/crypto/bytes.ts'
import { tresorCommitment } from '../../src/core/crypto/commitment.ts'
import { erzeugeDek, wrappeDek } from '../../src/core/crypto/dek.ts'
import { erzeugeKemSchluesselpaar, kapsele } from '../../src/core/crypto/kem.ts'
import { erzeugeSignaturSchluesselpaar, pkSigBytes } from '../../src/core/crypto/sign.ts'
import type { InhaltZeile } from '../../src/core/db/inhalte.ts'
import type { VaultReleaseZeile, VaultShareZeile } from '../../src/core/db/tresor.ts'
import type { LesbarerFall } from '../../src/services/fallService.ts'

/**
 * Der Hook hinter "Todesfall bestätigen" (DESIGN.md §3.5, §5).
 *
 * Zwei Zusagen hängen hier und nirgends sonst: Freigabe und `open_vault`
 * brauchen eine Verbindung und gehen **nicht** in die Offline-Queue (§5), und
 * der Übergang wird erst vollzogen, wenn `K_v` wirklich zusammenkam.
 */

const GERAET = 'geraet-1'
const ICH = 'user_anna'
const BERND = 'user_bernd'

const kemPaar = erzeugeKemSchluesselpaar()
const sigPaar = erzeugeSignaturSchluesselpaar()

const identitaet = {
  kem: kemPaar,
  signatur: sigPaar,
  pkKem: kemPaar.oeffentlich,
  pkSig: pkSigBytes(sigPaar.oeffentlich),
  fingerabdruck: new Uint8Array(32),
  pruefcode: '481253',
}

const tresorDb = {
  wrapFuerGeraet: vi.fn(),
  legeWrapAn: vi.fn(),
  sharesFuerFall: vi.fn(),
  resplitVault: vi.fn(),
  freigabenFuerFall: vi.fn(),
  sendeFreigabe: vi.fn(),
  oeffneTresor: vi.fn(),
}

const inhalteDb = {
  seit: vi.fn(),
  lege: vi.fn(),
  legeAlleNeuen: vi.fn(),
  schreibePayload: vi.fn(),
  umwrappe: vi.fn(),
  loesche: vi.fn(),
}

const profilDb = { speichere: vi.fn(), namen: vi.fn() }

vi.mock('../../src/core/db/supabaseTresor.ts', () => ({ supabaseTresor: () => tresorDb }))
vi.mock('../../src/core/db/supabaseInhalte.ts', () => ({ supabaseInhalte: () => inhalteDb }))
vi.mock('../../src/core/db/supabaseProfil.ts', () => ({ supabaseProfil: () => profilDb }))

const stabilerClient = {}
// Ein stabiler Zugang, kein frischer bei jedem Rendern: `zugang` steht in der
// Abhängigkeitsliste des Ladeeffekts, und eine neue Funktion je Rendern liesse
// ihn endlos wieder anlaufen.
const stabilerZugang = () => stabilerClient

vi.mock('../../src/core/db/supabaseProvider.tsx', () => ({
  useSupabase: () => stabilerZugang,
}))

vi.mock('../../src/core/auth/authProvider.ts', () => ({
  useAuth: () => ({
    zustand: { status: 'angemeldet', benutzer: { id: ICH, anzeigename: 'Anna Müller' } },
  }),
}))

vi.mock('../../src/hooks/useGeraete.ts', () => ({
  useGeraeteanmeldung: () => ({
    status: 'bereit',
    identitaet,
    benutzer: { id: ICH, anzeigename: 'Anna Müller' },
    geraet: { id: GERAET, label: 'iPhone', pruefcode: '481253', angelegtAm: '', diesesGeraet: true },
  }),
}))

const { useTodesfall } = await import('../../src/hooks/useTodesfall.ts')
const { ausgelieferterKatalogstand } = await import('../../src/services/katalogService.ts')

const kv = erzeugeAesSchluessel()

function fall(ueberschreibung: Partial<LesbarerFall> = {}): LesbarerFall {
  return {
    zustand: 'lesbar',
    id: '11111111-1111-4111-8111-111111111111',
    status: 'vorsorge',
    personName: 'Hans Weber',
    sterbedatum: null,
    kid: 'case_11111111-1111-4111-8111-111111111111:1',
    keyGeneration: 1,
    rotationPending: false,
    kc: erzeugeAesSchluessel(),
    kcat: erzeugeAesSchluessel(),
    kv: null,
    preparerId: 'user_hans',
    vaultCommitment: new Uint8Array(32),
    vaultResplitPending: false,
    vaultK: 1,
    vaultN: 1,
    katalogVersion: null,
    ...ueberschreibung,
  }
}

/** Der eigene Share, an dieses Gerät gewrappt. */
async function eigenerShare(teil: Uint8Array = kv): Promise<VaultShareZeile> {
  const kapselung = kapsele(identitaet.pkKem)

  return {
    fallId: fall().id,
    userId: ICH,
    geraeteId: GERAET,
    shareIndex: 1,
    shareHash: await sha256(teil),
    kemCt: kapselung.kemCt,
    wrappedShare: await verschluessele(kapselung.geteiltesGeheimnis, teil),
  }
}

async function freigabeZeile(
  kc: Uint8Array,
  kid: string,
  teil: Uint8Array = kv,
  userId = ICH,
): Promise<VaultReleaseZeile> {
  return {
    fallId: fall().id,
    userId,
    geraeteId: GERAET,
    kid,
    releasedShare: await verschluessele(kc, teil),
    signatur: new Uint8Array([1]),
    freigegebenAm: '2026-08-24T09:00:00Z',
  }
}

function setzeOnline(wert: boolean): void {
  Object.defineProperty(globalThis.navigator, 'onLine', { value: wert, configurable: true })
}

describe('useTodesfall (§3.5, §5)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setzeOnline(true)
    tresorDb.sharesFuerFall.mockResolvedValue([])
    tresorDb.freigabenFuerFall.mockResolvedValue([])
    tresorDb.sendeFreigabe.mockResolvedValue(undefined)
    tresorDb.oeffneTresor.mockResolvedValue(ausgelieferterKatalogstand())
    inhalteDb.seit.mockResolvedValue([])
    inhalteDb.umwrappe.mockResolvedValue(undefined)
    inhalteDb.legeAlleNeuen.mockResolvedValue(undefined)
    profilDb.namen.mockResolvedValue(new Map([[BERND, 'Bernd Weber']]))
  })

  it('zeigt den Freigabestand mit Namen und markiert die eigene Freigabe', async () => {
    const dieser = fall()
    tresorDb.freigabenFuerFall.mockResolvedValue([
      await freigabeZeile(dieser.kc, dieser.kid, kv, BERND),
    ])
    tresorDb.sharesFuerFall.mockResolvedValue([await eigenerShare()])

    const { result } = renderHook(() => useTodesfall(dieser, vi.fn()))

    await waitFor(() => {
      expect(result.current.laedt).toBe(false)
    })

    expect(result.current.freigaben).toEqual([
      expect.objectContaining({ userId: BERND, name: 'Bernd Weber', eigene: false }),
    ])
    expect(result.current.kannFreigeben).toBe(true)
    expect(result.current.schwelleErreicht).toBe(true)
  })

  it('prüft den eigenen Share und schickt die Freigabe an die Edge Function', async () => {
    const dieser = fall()
    tresorDb.sharesFuerFall.mockResolvedValue([await eigenerShare()])

    const { result } = renderHook(() => useTodesfall(dieser, vi.fn()))
    await waitFor(() => {
      expect(result.current.laedt).toBe(false)
    })

    await act(async () => {
      await result.current.bestaetigeTodesfall()
    })

    expect(tresorDb.sendeFreigabe).toHaveBeenCalledTimes(1)
    expect(tresorDb.sendeFreigabe).toHaveBeenCalledWith(
      expect.objectContaining({ caseId: dieser.id, userId: ICH, geraeteId: GERAET, kid: dieser.kid }),
    )
  })

  it('lädt nichts hoch, wenn der eigene Share nicht zu seinem Hash passt', async () => {
    const dieser = fall()
    const kaputt = await eigenerShare()
    kaputt.shareHash = await sha256(erzeugeAesSchluessel())
    tresorDb.sharesFuerFall.mockResolvedValue([kaputt])

    const { result } = renderHook(() => useTodesfall(dieser, vi.fn()))
    await waitFor(() => {
      expect(result.current.laedt).toBe(false)
    })

    await expect(result.current.bestaetigeTodesfall()).rejects.toThrow(/beschädigt/i)
    expect(tresorDb.sendeFreigabe).not.toHaveBeenCalled()
  })

  it('trägt den Grund eines Fehlschlags in den Zustand, nicht nur in den Wurf', async () => {
    const dieser = fall()
    tresorDb.sharesFuerFall.mockResolvedValue([await eigenerShare()])

    const { result } = renderHook(() => useTodesfall(dieser, vi.fn()))
    await waitFor(() => {
      expect(result.current.laedt).toBe(false)
    })

    setzeOnline(false)

    // Der Screen fängt die Ausnahme ab und zeigt `fehler`. Stünde die Meldung
    // nur im Wurf, sähe eine Bestätigung ohne Verbindung aus wie eine
    // Schaltfläche, die nichts tut.
    await act(async () => {
      await result.current.bestaetigeTodesfall().catch(() => undefined)
    })

    expect(result.current.fehler).toMatch(/Verbindung/i)
  })

  it('wrappt die Tresor-DEKs um, bevor der Übergang vollzogen wird', async () => {
    const dieser = fall({ vaultCommitment: await tresorCommitment(kv) })
    const dek = erzeugeDek()

    tresorDb.freigabenFuerFall.mockResolvedValue([await freigabeZeile(dieser.kc, dieser.kid)])
    tresorDb.sharesFuerFall.mockResolvedValue([await eigenerShare()])
    inhalteDb.seit.mockResolvedValue([
      {
        id: 'item-1',
        fallId: dieser.id,
        seq: 3,
        art: 'item',
        geloescht: false,
        imTresor: true,
        kid: `vault_${dieser.id}`,
        wrappedDek: await wrappeDek(kv, dek),
        payload: new Uint8Array([1]),
        geaendertAm: '2026-08-24T10:00:00Z',
      },
    ])

    /*
     * `open_vault` ist der einzige Schritt, den niemand zurücknimmt. Käme er
     * zuerst und bräche danach die Verbindung ab, läge jeder noch nicht
     * umgewrappte Tresor-Eintrag für immer unter einem `K_v`, den niemand mehr
     * hat (§3.5).
     */
    const reihenfolge: string[] = []
    inhalteDb.umwrappe.mockImplementation(() => {
      reihenfolge.push('umwrappe')
      return Promise.resolve()
    })
    tresorDb.oeffneTresor.mockImplementation(() => {
      reihenfolge.push('open_vault')
      return Promise.resolve(ausgelieferterKatalogstand())
    })

    const { result } = renderHook(() => useTodesfall(dieser, vi.fn()))
    await waitFor(() => {
      expect(result.current.laedt).toBe(false)
    })

    await act(async () => {
      await result.current.oeffneTresor('2026-05-12')
    })

    expect(reihenfolge).toEqual(['umwrappe', 'open_vault'])
  })

  it('scheitert offline und stellt nichts in die Queue (§5)', async () => {
    const dieser = fall()
    tresorDb.sharesFuerFall.mockResolvedValue([await eigenerShare()])

    const { result } = renderHook(() => useTodesfall(dieser, vi.fn()))
    await waitFor(() => {
      expect(result.current.laedt).toBe(false)
    })

    setzeOnline(false)

    await expect(result.current.bestaetigeTodesfall()).rejects.toThrow(/Verbindung/i)
    await expect(result.current.oeffneTresor('2026-05-12')).rejects.toThrow(/Verbindung/i)

    expect(tresorDb.sendeFreigabe).not.toHaveBeenCalled()
    expect(tresorDb.oeffneTresor).not.toHaveBeenCalled()
  })

  it('öffnet den Tresor, wrappt die Tresor-DEKs um und instanziiert den Katalog', async () => {
    const dieser = fall({ vaultCommitment: await tresorCommitment(kv) })
    const dek = erzeugeDek()
    const tresorZeile: InhaltZeile = {
      id: 'item-1',
      fallId: dieser.id,
      seq: 3,
      art: 'item',
      geloescht: false,
      imTresor: true,
      kid: `vault_${dieser.id}`,
      wrappedDek: await wrappeDek(kv, dek),
      payload: new Uint8Array([1]),
      geaendertAm: '2026-08-24T10:00:00Z',
    }

    tresorDb.freigabenFuerFall.mockResolvedValue([await freigabeZeile(dieser.kc, dieser.kid)])
    tresorDb.sharesFuerFall.mockResolvedValue([await eigenerShare()])
    inhalteDb.seit.mockResolvedValue([tresorZeile])

    const aktualisiereFall = vi.fn()
    const { result } = renderHook(() => useTodesfall(dieser, aktualisiereFall))
    await waitFor(() => {
      expect(result.current.laedt).toBe(false)
    })

    await act(async () => {
      await result.current.oeffneTresor('2026-05-12')
    })

    expect(tresorDb.oeffneTresor).toHaveBeenCalledWith(
      dieser.id,
      await tresorCommitment(kv),
      ausgelieferterKatalogstand(),
      expect.any(Uint8Array),
    )
    expect(inhalteDb.umwrappe).toHaveBeenCalledWith('item-1', dieser.kid, expect.any(Uint8Array))
    expect(inhalteDb.legeAlleNeuen).toHaveBeenCalledTimes(1)
    expect(aktualisiereFall).toHaveBeenCalled()
  })

  it('instanziiert nichts, wenn der Server einen unbekannten Katalogstand nennt (§8)', async () => {
    const dieser = fall({ vaultCommitment: await tresorCommitment(kv) })
    tresorDb.freigabenFuerFall.mockResolvedValue([await freigabeZeile(dieser.kc, dieser.kid)])
    tresorDb.sharesFuerFall.mockResolvedValue([await eigenerShare()])
    tresorDb.oeffneTresor.mockResolvedValue('2031-01+fremderau')

    const { result } = renderHook(() => useTodesfall(dieser, vi.fn()))
    await waitFor(() => {
      expect(result.current.laedt).toBe(false)
    })

    await act(async () => {
      await result.current.oeffneTresor('2026-05-12')
    })

    expect(inhalteDb.legeAlleNeuen).not.toHaveBeenCalled()
  })

  it('benennt die Person, deren Freigabe unbrauchbar ist, und öffnet nicht', async () => {
    const dieser = fall({ vaultCommitment: await tresorCommitment(kv) })
    tresorDb.freigabenFuerFall.mockResolvedValue([
      await freigabeZeile(dieser.kc, dieser.kid, erzeugeAesSchluessel(), BERND),
    ])
    tresorDb.sharesFuerFall.mockResolvedValue([
      { ...(await eigenerShare()), userId: BERND },
    ])

    const { result } = renderHook(() => useTodesfall(dieser, vi.fn()))
    await waitFor(() => {
      expect(result.current.laedt).toBe(false)
    })

    await act(async () => {
      await result.current.oeffneTresor('2026-05-12').catch(() => undefined)
    })

    expect(tresorDb.oeffneTresor).not.toHaveBeenCalled()
    await waitFor(() => {
      expect(result.current.unbrauchbare).toEqual(['Bernd Weber'])
    })
  })

  it('weist ein Sterbedatum zurück, das kein Kalendertag ist, ohne zu öffnen', async () => {
    const dieser = fall({ vaultCommitment: await tresorCommitment(kv) })
    tresorDb.freigabenFuerFall.mockResolvedValue([await freigabeZeile(dieser.kc, dieser.kid)])
    tresorDb.sharesFuerFall.mockResolvedValue([await eigenerShare()])

    const { result } = renderHook(() => useTodesfall(dieser, vi.fn()))
    await waitFor(() => {
      expect(result.current.laedt).toBe(false)
    })

    await expect(result.current.oeffneTresor('2026-02-30')).rejects.toThrow(/Sterbedatum/i)
    expect(tresorDb.oeffneTresor).not.toHaveBeenCalled()
  })
})
