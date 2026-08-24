import { renderHook, waitFor, act } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { verschluessele } from '../../src/core/crypto/aead.ts'
import { textBytes } from '../../src/core/crypto/bytes.ts'
import { erzeugeDek, wrappeDek } from '../../src/core/crypto/dek.ts'
import type { InhaltZeile } from '../../src/core/db/inhalte.ts'
import type { Fallschluessel } from '../../src/services/aufgabenService.ts'
import type { Dokument, Dokumentpayload } from '../../src/services/dokumentService.ts'

/**
 * Die Dokumente eines Falls (DESIGN.md §7, §5).
 *
 * Der Dienst ist ersetzt; was er verschlüsselt, steht in
 * `tests/services/dokumentService.test.ts`. Hier geht es um das, was der Hook
 * allein entscheidet: dass er auf dem Bestand aus `useAufgaben` reitet statt
 * auf einem zweiten Sync, dass eine Aufnahme ohne Verbindung gar nicht erst
 * losgeht (§5: keine Queue für Dokumente), und dass nach einem Schreibvorgang
 * am Delta vorbei eine Runde angestossen wird.
 */

const nimmDokumentAuf = vi.fn()
const loescheDokument = vi.fn()
const oeffneDokument = vi.fn()

vi.mock('../../src/services/dokumentService.ts', async (original) => ({
  ...(await original<typeof import('../../src/services/dokumentService.ts')>()),
  nimmDokumentAuf: (...a: unknown[]) => nimmDokumentAuf(...a),
  loescheDokument: (...a: unknown[]) => loescheDokument(...a),
  oeffneDokument: (...a: unknown[]) => oeffneDokument(...a),
}))

/* Derselbe Grund wie in `useMitglieder.test.tsx`: eine stabile Funktion. */
vi.mock('../../src/core/db/supabaseProvider.tsx', () => {
  const zugang = () => ({})
  return { useSupabase: () => zugang }
})

const { useDokumente } = await import('../../src/hooks/useDokumente.ts')

const KC = erzeugeDek()
const FALL: Fallschluessel = { id: 'fall-1', kid: 'case_fall-1:1', kc: KC }

const PAYLOAD: Dokumentpayload = {
  typ: 'dokument',
  name: 'sterbeurkunde.jpg',
  mimetyp: 'image/jpeg',
  groesse: 4242,
  aufgabeId: 'item-1',
  aufgenommenAm: '2026-08-24T10:00:00Z',
}

async function dokumentzeile(id = 'dok-1'): Promise<InhaltZeile> {
  const dek = erzeugeDek()

  return {
    id,
    fallId: FALL.id,
    seq: 1,
    art: 'file',
    geloescht: false,
    imTresor: false,
    kid: FALL.kid,
    wrappedDek: await wrappeDek(KC, dek),
    payload: await verschluessele(dek, textBytes(JSON.stringify(PAYLOAD))),
    geaendertAm: '2026-08-24T10:00:00Z',
  }
}

const DATEI = {
  name: 'sterbeurkunde.jpg',
  type: 'image/jpeg',
  size: 4242,
  arrayBuffer: () => Promise.resolve(new ArrayBuffer(4242)),
}

/** Setzt `navigator.onLine` für die Dauer eines Tests. */
function setzeOnline(online: boolean) {
  Object.defineProperty(globalThis.navigator, 'onLine', {
    configurable: true,
    get: () => online,
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  setzeOnline(true)
})

describe('useDokumente', () => {
  it('entschlüsselt die Dokumentzeilen aus dem Bestand', async () => {
    const zeilen = [await dokumentzeile()]
    const { result } = renderHook(() => useDokumente(FALL, zeilen, vi.fn()))

    await waitFor(() => expect(result.current.dokumente).toHaveLength(1))

    expect(result.current.dokumente[0]).toMatchObject({
      id: 'dok-1',
      name: 'sterbeurkunde.jpg',
      pfad: 'fall-1/dok-1',
    })
  })

  it('stösst nach einer Aufnahme eine Sync-Runde an — Dokumente gehen nicht durch die Queue', async () => {
    const aktualisiere = vi.fn()
    nimmDokumentAuf.mockResolvedValue({ id: 'dok-neu' } as Dokument)

    const { result } = renderHook(() => useDokumente(FALL, [], aktualisiere))

    await result.current.nimmAuf(DATEI, 'item-1')

    expect(nimmDokumentAuf).toHaveBeenCalledWith(
      expect.objectContaining({ fall: FALL }),
      DATEI,
      'item-1',
    )
    expect(aktualisiere).toHaveBeenCalledTimes(1)
  })

  it('nimmt ohne Verbindung gar nichts erst entgegen', async () => {
    setzeOnline(false)
    const aktualisiere = vi.fn()

    const { result } = renderHook(() => useDokumente(FALL, [], aktualisiere))

    await waitFor(() => expect(result.current.online).toBe(false))
    await expect(result.current.nimmAuf(DATEI, 'item-1')).rejects.toThrow(/Ohne Verbindung/)

    // Nichts hochgeladen, nichts angestossen: §5 lässt Dokumente nicht warten.
    expect(nimmDokumentAuf).not.toHaveBeenCalled()
    expect(aktualisiere).not.toHaveBeenCalled()
  })

  it('merkt, wenn die Verbindung zurückkommt', async () => {
    setzeOnline(false)
    const { result } = renderHook(() => useDokumente(FALL, [], vi.fn()))

    await waitFor(() => expect(result.current.online).toBe(false))

    setzeOnline(true)
    act(() => {
      globalThis.dispatchEvent(new Event('online'))
    })

    await waitFor(() => expect(result.current.online).toBe(true))
  })

  it('stösst auch nach dem Löschen eine Runde an', async () => {
    const aktualisiere = vi.fn()
    loescheDokument.mockResolvedValue(undefined)

    const { result } = renderHook(() => useDokumente(FALL, [], aktualisiere))

    await result.current.loesche({ id: 'dok-1' } as Dokument)

    expect(loescheDokument).toHaveBeenCalled()
    expect(aktualisiere).toHaveBeenCalledTimes(1)
  })

  it('zählt, was sich nicht entschlüsseln liess (§3.7)', async () => {
    const fremd = await dokumentzeile('dok-fremd')
    const { result } = renderHook(() =>
      useDokumente({ ...FALL, kc: erzeugeDek() }, [fremd], vi.fn()),
    )

    await waitFor(() => expect(result.current.uebersprungen).toBe(1))
    expect(result.current.dokumente).toEqual([])
  })
})
