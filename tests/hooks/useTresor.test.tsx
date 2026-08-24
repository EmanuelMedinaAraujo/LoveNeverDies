import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { erzeugeAesSchluessel, verschluessele } from '../../src/core/crypto/aead.ts'
import { textBytes } from '../../src/core/crypto/bytes.ts'
import type { InhaltZeile } from '../../src/core/db/inhalte.ts'
import type { LesbarerFall } from '../../src/services/fallService.ts'

const mockVerteileShares = vi.fn()

vi.mock('../../src/services/tresorService.ts', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../../src/services/tresorService.ts')>()
  return {
    ...orig,
    verteileShares: (...args: unknown[]) => mockVerteileShares(...args),
  }
})

const stabilerClient = {}
const stabilerZugang = () => stabilerClient

vi.mock('../../src/core/db/supabaseProvider.tsx', () => ({
  useSupabase: () => stabilerZugang,
}))

const stabilerAuth = {
  zustand: {
    status: 'angemeldet',
    benutzer: { id: 'user_preparer', email: 'test@example.com' },
  },
}

vi.mock('../../src/core/auth/authProvider.ts', () => ({
  useAuth: () => stabilerAuth,
}))

const { useTresor } = await import('../../src/hooks/useTresor.ts')

function erstelleFall(ueberschreibung: Partial<LesbarerFall> = {}): LesbarerFall {
  return {
    zustand: 'lesbar',
    id: 'fall-tresor-1',
    status: 'vorsorge',
    personName: 'Anna Vorsorge',
    sterbedatum: null,
    kid: 'case_fall-tresor-1:1',
    keyGeneration: 1,
    rotationPending: false,
    kc: erzeugeAesSchluessel(),
    kcat: erzeugeAesSchluessel(),
    kv: erzeugeAesSchluessel(),
    preparerId: 'user_preparer',
    vaultCommitment: new Uint8Array(32),
    vaultResplitPending: false,
    vaultK: null,
    vaultN: 0,
    katalogVersion: null,
    ...ueberschreibung,
  }
}

async function erstelleTresorZeile(
  fall: LesbarerFall,
  titel: string,
  inhalt: string,
): Promise<InhaltZeile> {
  if (fall.kv === null) throw new Error('kv fehlt')
  const { wrappeDek, erzeugeDek } = await import('../../src/core/crypto/dek.ts')
  const dek = erzeugeDek()
  const payload = await verschluessele(
    dek,
    textBytes(JSON.stringify({ typ: 'tresor', titel, inhalt })),
  )
  const wrappedDek = await wrappeDek(fall.kv, dek)

  return {
    id: 'item-1',
    fallId: fall.id,
    seq: 1,
    art: 'item',
    geloescht: false,
    kid: `vault_${fall.id}`,
    wrappedDek,
    payload,
    imTresor: true,
    geaendertAm: '2026-08-24T12:00:00Z',
  }
}

/** Lässt die Mikrotasks des Effekts durchlaufen, ohne auf etwas zu warten. */
async function ruhe(): Promise<void> {
  await new Promise((fertig) => setTimeout(fertig, 50))
}

describe('useTresor Hook (§3.5)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockVerteileShares.mockResolvedValue({ n: 0, k: null })
  })

  it('entschlüsselt Tresor-Items aus zeilen mit K_v', async () => {
    const fall = erstelleFall()
    const zeile = await erstelleTresorZeile(fall, 'Bankschließfach', 'Schlüssel im Arbeitszimmer')

    const { result } = renderHook(() => useTresor(fall, [zeile], vi.fn(), vi.fn()))

    await waitFor(() => {
      expect(result.current.items).toHaveLength(1)
    })

    expect(result.current.items[0]?.titel).toBe('Bankschließfach')
    expect(result.current.items[0]?.inhalt).toBe('Schlüssel im Arbeitszimmer')
  })

  it('erzeugt Mutationen zum Anlegen und Löschen von Items', async () => {
    const fall = erstelleFall()
    const mutiere = vi.fn()

    const { result } = renderHook(() => useTresor(fall, [], mutiere, vi.fn()))

    await result.current.legeItemAn('Passwort', 'geheim123')

    expect(mutiere).toHaveBeenCalledTimes(1)
    const [mutation] = mutiere.mock.calls[0] as [{ op: string; imTresor?: boolean }]
    expect(mutation.op).toBe('anlegen')
    expect(mutation.imTresor).toBe(true)

    await result.current.loescheItem({
      id: 'item-1',
      titel: 'Passwort',
      inhalt: 'geheim123',
      dek: new Uint8Array(32),
      geaendertAm: '2026-08-24T12:00:00Z',
    })

    expect(mutiere).toHaveBeenCalledTimes(2)
    const [loeschMutation] = mutiere.mock.calls[1] as [{ op: string; itemId: string }]
    expect(loeschMutation.op).toBe('loeschen')
    expect(loeschMutation.itemId).toBe('item-1')
  })

  it('zeigt den korrekten Schwellwert basierend auf vaultN und vaultK', () => {
    const { result: r0 } = renderHook(() =>
      useTresor(erstelleFall({ vaultN: 0, vaultK: null }), [], vi.fn(), vi.fn()),
    )

    expect(r0.current.schwelle).toEqual({ n: 0, k: null })

    const { result: r3 } = renderHook(() =>
      useTresor(erstelleFall({ vaultN: 3, vaultK: 2 }), [], vi.fn(), vi.fn()),
    )

    expect(r3.current.schwelle).toEqual({ n: 3, k: 2 })
  })

  it('führt Auto-Resplit genau einmal aus und ruft aktualisiereFall auf', async () => {
    mockVerteileShares.mockResolvedValue({ n: 2, k: 2 })

    const aktualisiereFall = vi.fn()
    const fall = erstelleFall({ vaultResplitPending: true })

    const { rerender } = renderHook(
      (props: { fall: LesbarerFall }) => useTresor(props.fall, [], vi.fn(), aktualisiereFall),
      { initialProps: { fall } },
    )

    await waitFor(() => {
      expect(mockVerteileShares).toHaveBeenCalledTimes(1)
      expect(aktualisiereFall).toHaveBeenCalledTimes(1)
    })

    // Derselbe Fall noch einmal: Solange nichts nachgeladen wurde, ist die
    // Fahne dieselbe Auskunft wie vorhin und löst nichts Neues aus.
    rerender({ fall })
    await ruhe()

    expect(mockVerteileShares).toHaveBeenCalledTimes(1)
  })

  /*
   * Die Regression aus 84572bf: Der Effekt setzte `resplitLaeuft` als Zustand
   * und hatte ihn zugleich in seiner Abhängigkeitsliste. React räumte die alte
   * Fassung auf, bevor die RPC antwortete, und das Zurücksetzen hing an genau
   * diesem Aufräum-Flag. Die Anzeige blieb für immer stehen.
   */
  it('setzt resplitLaeuft nach dem Auto-Resplit wieder zurück', async () => {
    mockVerteileShares.mockResolvedValue({ n: 2, k: 2 })

    const { result } = renderHook(() =>
      useTresor(erstelleFall({ vaultResplitPending: true }), [], vi.fn(), vi.fn()),
    )

    await waitFor(() => expect(mockVerteileShares).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(result.current.resplitLaeuft).toBe(false))
  })

  it('meldet einen fehlgeschlagenen Auto-Resplit, statt ihn zu verschlucken', async () => {
    mockVerteileShares.mockRejectedValue(new Error('Netz weg'))

    const aktualisiereFall = vi.fn()
    const { result } = renderHook(() =>
      useTresor(erstelleFall({ vaultResplitPending: true }), [], vi.fn(), aktualisiereFall),
    )

    await waitFor(() => expect(result.current.resplitFehler).toBe('Netz weg'))
    expect(result.current.resplitLaeuft).toBe(false)
    expect(aktualisiereFall).not.toHaveBeenCalled()
  })

  it('wiederholt einen fehlgeschlagenen Auto-Resplit nicht von allein', async () => {
    mockVerteileShares.mockRejectedValue(new Error('Netz weg'))

    const fall = erstelleFall({ vaultResplitPending: true })
    const { rerender } = renderHook(
      (props: { fall: LesbarerFall }) => useTresor(props.fall, [], vi.fn(), vi.fn()),
      { initialProps: { fall } },
    )

    await waitFor(() => expect(mockVerteileShares).toHaveBeenCalledTimes(1))

    rerender({ fall })
    rerender({ fall })
    await ruhe()

    expect(mockVerteileShares).toHaveBeenCalledTimes(1)
  })

  /*
   * Nachgeladen heißt: neue Auskunft. Ein Beitritt, der während des ersten
   * Re-Splits hereinkam, steht danach wieder als offene Fahne da und muss
   * einen zweiten Lauf auslösen, auch dann, wenn `vault_n` zufällig dieselbe
   * Zahl trägt wie vorher.
   */
  it('läuft nach einem Nachladen wieder, wenn die Fahne erneut steht', async () => {
    mockVerteileShares.mockResolvedValue({ n: 2, k: 2 })

    const { rerender } = renderHook(
      (props: { fall: LesbarerFall }) => useTresor(props.fall, [], vi.fn(), vi.fn()),
      { initialProps: { fall: erstelleFall({ vaultResplitPending: true, vaultN: 2 }) } },
    )

    await waitFor(() => expect(mockVerteileShares).toHaveBeenCalledTimes(1))

    rerender({ fall: erstelleFall({ vaultResplitPending: true, vaultN: 2 }) })

    await waitFor(() => expect(mockVerteileShares).toHaveBeenCalledTimes(2))
  })

  it('rührt den Tresor eines Nicht-Preparers nicht an', async () => {
    const { result } = renderHook(() =>
      useTresor(erstelleFall({ kv: null, vaultResplitPending: true }), [], vi.fn(), vi.fn()),
    )

    await ruhe()

    expect(mockVerteileShares).not.toHaveBeenCalled()
    expect(result.current.istPreparer).toBe(false)
    expect(result.current.items).toEqual([])
  })

  it('erlaubt manuelles verteileShares und lädt den Fall nach', async () => {
    mockVerteileShares.mockResolvedValue({ n: 1, k: 1 })

    const aktualisiereFall = vi.fn()
    const { result } = renderHook(() => useTresor(erstelleFall(), [], vi.fn(), aktualisiereFall))

    expect(await result.current.verteileShares()).toEqual({ n: 1, k: 1 })
    expect(mockVerteileShares).toHaveBeenCalledTimes(1)
    expect(aktualisiereFall).toHaveBeenCalledTimes(1)
  })

  it('wirft beim manuellen Versuch weiter und merkt sich den Fehler', async () => {
    mockVerteileShares.mockRejectedValue(new Error('Netz weg'))

    const { result } = renderHook(() => useTresor(erstelleFall(), [], vi.fn(), vi.fn()))

    await expect(result.current.verteileShares()).rejects.toThrow('Netz weg')
    await waitFor(() => expect(result.current.resplitFehler).toBe('Netz weg'))
    expect(result.current.resplitLaeuft).toBe(false)
  })
})
