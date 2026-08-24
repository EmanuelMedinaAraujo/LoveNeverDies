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

describe('useTresor Hook (§3.5)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockVerteileShares.mockResolvedValue({ n: 0, k: null })
  })

  it('entschlüsselt Tresor-Items aus zeilen mit K_v', async () => {
    const fall = erstelleFall()
    const zeile = await erstelleTresorZeile(fall, 'Bankschließfach', 'Schlüssel im Arbeitszimmer')
    const mutiere = vi.fn()

    const { result } = renderHook(() =>
      useTresor(fall, [zeile], mutiere, {
        gecacht: true,
        laedtNetz: false,
        netzfehler: null,
        abgeglichen: true,
      }),
    )

    await waitFor(() => {
      expect(result.current.zustand.status).toBe('bereit')
      if (result.current.zustand.status === 'bereit') {
        expect(result.current.zustand.items).toHaveLength(1)
        expect(result.current.zustand.items[0]?.titel).toBe('Bankschließfach')
        expect(result.current.zustand.items[0]?.inhalt).toBe('Schlüssel im Arbeitszimmer')
      }
    })
  })

  it('erzeugt Mutationen zum Anlegen und Löschen von Items', async () => {
    const fall = erstelleFall()
    const mutiere = vi.fn()

    const { result } = renderHook(() =>
      useTresor(fall, [], mutiere, {
        gecacht: true,
        laedtNetz: false,
        netzfehler: null,
        abgeglichen: true,
      }),
    )

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
    const fallOhne = erstelleFall({ vaultN: 0, vaultK: null })
    const mutiere = vi.fn()

    const { result: r0 } = renderHook(() =>
      useTresor(fallOhne, [], mutiere, {
        gecacht: true,
        laedtNetz: false,
        netzfehler: null,
        abgeglichen: true,
      }),
    )

    if (r0.current.zustand.status === 'bereit') {
      expect(r0.current.zustand.schwelle).toEqual({ n: 0, k: null })
    }

    const fallMitDrei = erstelleFall({ vaultN: 3, vaultK: 2 })
    const { result: r3 } = renderHook(() =>
      useTresor(fallMitDrei, [], mutiere, {
        gecacht: true,
        laedtNetz: false,
        netzfehler: null,
        abgeglichen: true,
      }),
    )

    if (r3.current.zustand.status === 'bereit') {
      expect(r3.current.zustand.schwelle).toEqual({ n: 3, k: 2 })
    }
  })

  it('führt Auto-Resplit genau einmal aus und ruft onFallAktualisieren auf', async () => {
    mockVerteileShares.mockResolvedValue({ n: 2, k: 2 })

    const onFallAktualisieren = vi.fn()
    const fall = erstelleFall({ vaultResplitPending: true })
    const mutiere = vi.fn()

    const { rerender } = renderHook(
      (props: { fall: LesbarerFall }) =>
        useTresor(
          props.fall,
          [],
          mutiere,
          {
            gecacht: true,
            laedtNetz: false,
            netzfehler: null,
            abgeglichen: true,
          },
          onFallAktualisieren,
        ),
      { initialProps: { fall } },
    )

    await waitFor(() => {
      expect(mockVerteileShares).toHaveBeenCalledTimes(1)
      expect(onFallAktualisieren).toHaveBeenCalledTimes(1)
    })

    // Re-Render mit unverändertem fall (da React-State erst auf Reload wartet)
    rerender({ fall })

    await waitFor(() => {
      // Darf NICHT noch einmal aufgerufen worden sein!
      expect(mockVerteileShares).toHaveBeenCalledTimes(1)
    })
  })

  it('erlaubt manuelles verteileShares und aktualisiert den Fall', async () => {
    mockVerteileShares.mockResolvedValue({ n: 1, k: 1 })

    const onFallAktualisieren = vi.fn()
    const fall = erstelleFall()
    const mutiere = vi.fn()

    const { result } = renderHook(() =>
      useTresor(
        fall,
        [],
        mutiere,
        {
          gecacht: true,
          laedtNetz: false,
          netzfehler: null,
          abgeglichen: true,
        },
        onFallAktualisieren,
      ),
    )

    const ergebnis = await result.current.verteileShares()

    expect(ergebnis).toEqual({ n: 1, k: 1 })
    expect(mockVerteileShares).toHaveBeenCalledTimes(1)
    expect(onFallAktualisieren).toHaveBeenCalledTimes(1)
  })
})
