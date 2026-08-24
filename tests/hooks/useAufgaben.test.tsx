import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { InhaltZeile } from '../../src/core/db/inhalte.ts'
import type { AbgelehnteMutation, Mutation } from '../../src/core/sync/queue.ts'
import type { Syncdaten, SyncZustand } from '../../src/hooks/useSync.ts'
import type { Aufgabe } from '../../src/services/aufgabenService.ts'
import type { Katalogfall } from '../../src/services/katalogService.ts'

/**
 * Die Aufgaben eines Falls (DESIGN.md §3.1, §5, §7).
 *
 * Der Sync liegt darunter und ist hier ersetzt — was er tut, prüft
 * `useSync.test.tsx`. `aufgabenService` ist ebenfalls ersetzt; was er
 * verschlüsselt und wann er eine Zeile still verwirft, steht in
 * `tests/services/aufgabenService.test.ts`.
 *
 * Was bleibt, ist die Aufgabe dieses Hooks: aus Ciphertext-Zeilen Aufgaben
 * machen, und zwar **nur aus den geänderten** (§5), aus Klartext Mutationen
 * machen und sie an die Queue geben.
 */

const aufgabenAusZeilen = vi.fn()
const beschreibeAbgelehnte = vi.fn()
const mutationAnlegen = vi.fn()
const mutationAendern = vi.fn()
const mutationLoeschen = vi.fn()

vi.mock('../../src/services/aufgabenService.ts', () => ({
  aufgabenAusZeilen: (...a: unknown[]) => aufgabenAusZeilen(...a),
  beschreibeAbgelehnte: (...a: unknown[]) => beschreibeAbgelehnte(...a),
  mutationAnlegen: (...a: unknown[]) => mutationAnlegen(...a),
  mutationAendern: (...a: unknown[]) => mutationAendern(...a),
  mutationLoeschen: (...a: unknown[]) => mutationLoeschen(...a),
}))

const useSync = vi.fn<(fallId: string) => Syncdaten>()

vi.mock('../../src/hooks/useSync.ts', () => ({ useSync: (fallId: string) => useSync(fallId) }))

/** Der Zugang zum Server. Angefasst wird er nicht — der Katalog ist ersetzt. */
vi.mock('../../src/core/db/supabaseProvider.tsx', () => ({ useSupabase: () => () => ({}) }))

const instanziiereKatalog = vi.fn()

vi.mock('../../src/services/katalogService.ts', () => ({
  instanziiereKatalog: (...a: unknown[]) => instanziiereKatalog(...a),
}))

const { useAufgaben } = await import('../../src/hooks/useAufgaben.ts')

const FALL: Katalogfall = {
  id: 'fall-1',
  kid: 'case_fall-1:1',
  kc: new Uint8Array([1]),
  kcat: new Uint8Array([2]),
  katalogVersion: '2026-08+testtest',
}

function zeile(id: string, ueberschreibung: Partial<InhaltZeile> = {}): InhaltZeile {
  return {
    id,
    fallId: FALL.id,
    seq: 1,
    art: 'item',
    geloescht: false,
    imTresor: false,
    kid: FALL.kid,
    wrappedDek: new Uint8Array([0xaa]),
    payload: new Uint8Array([0x01]),
    geaendertAm: '2026-08-24T10:00:00Z',
    ...ueberschreibung,
  }
}

function aufgabe(ueberschreibung: Partial<Aufgabe> = {}): Aufgabe {
  return {
    id: 'item-1',
    titel: 'Sterbeurkunde beantragen',
    beschreibung: '',
    erledigt: false,
    katalog: null,
    dek: new Uint8Array([9]),
    kid: FALL.kid,
    ...ueberschreibung,
  }
}

const mutiere = vi.fn<(mutation: Mutation) => Promise<void>>()
const bestaetige = vi.fn()
const aktualisiere = vi.fn()

function syncdaten(zustand: Partial<SyncZustand> = {}): Syncdaten {
  return {
    zustand: {
      zeilen: [],
      gecacht: true,
      laedtNetz: false,
      netzfehler: null,
      abgeglichen: true,
      abgelehnt: [],
      ...zustand,
    },
    mutiere,
    bestaetige,
    aktualisiere,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mutiere.mockResolvedValue(undefined)
  aufgabenAusZeilen.mockResolvedValue({ aufgaben: [], uebersprungeneIds: [] })
  beschreibeAbgelehnte.mockResolvedValue([])
  instanziiereKatalog.mockResolvedValue(0)
  useSync.mockReturnValue(syncdaten())
})

describe('useAufgaben', () => {
  it('laedt, solange der Cache noch nicht gelesen ist', () => {
    useSync.mockReturnValue(syncdaten({ gecacht: false }))

    const { result } = renderHook(() => useAufgaben(FALL))

    expect(result.current.zustand.status).toBe('laedt')
  })

  it('zeigt die gecachten Aufgaben, noch bevor das Netz geantwortet hat', async () => {
    // §5: „Gecachte Inhalte werden sofort gerendert." Die Ladeanzeige gehört
    // dem Fetch, nicht dem Entschlüsseln.
    const eine = zeile('item-1')
    aufgabenAusZeilen.mockResolvedValue({ aufgaben: [aufgabe()], uebersprungeneIds: [] })
    useSync.mockReturnValue(syncdaten({ zeilen: [eine], laedtNetz: true }))

    const { result } = renderHook(() => useAufgaben(FALL))

    await waitFor(() => {
      expect(result.current.zustand).toEqual({
        status: 'bereit',
        aufgaben: [aufgabe()],
        uebersprungen: 0,
        laedtNetz: true,
        netzfehler: null,
      })
    })
  })

  it('laesst die Liste stehen, wenn der Abruf scheitert', async () => {
    // Ein Server, der nicht antwortet, darf nicht als „keine Aufgaben"
    // durchgehen — sonst sieht jemand einen leeren Fall und legt alles neu an.
    aufgabenAusZeilen.mockResolvedValue({ aufgaben: [aufgabe()], uebersprungeneIds: [] })
    useSync.mockReturnValue(
      syncdaten({ zeilen: [zeile('item-1')], netzfehler: 'Kein Netz.' }),
    )

    const { result } = renderHook(() => useAufgaben(FALL))

    await waitFor(() => {
      expect(result.current.zustand).toMatchObject({
        status: 'bereit',
        aufgaben: [aufgabe()],
        netzfehler: 'Kein Netz.',
      })
    })
  })

  it('entschluesselt ausschliesslich die Zeilen, die sich geaendert haben', async () => {
    /*
     * §5: „Sichtbare Screens aktualisieren sich nur für tatsächlich geänderte
     * Zeilen." Der Reconciler gibt unveränderte Zeilen unverändert zurück; wer
     * das ignoriert, entschlüsselt bei jeder Türklingel den ganzen Fall neu —
     * und bei hundert Aufgaben ist die Türklingel dann teurer als das Polling,
     * das sie ersetzt.
     */
    const erste = zeile('item-1')
    const zweite = zeile('item-2')

    aufgabenAusZeilen.mockResolvedValueOnce({ aufgaben: [aufgabe()], uebersprungeneIds: [] })
    useSync.mockReturnValue(syncdaten({ zeilen: [erste] }))

    const { result, rerender } = renderHook(() => useAufgaben(FALL))
    await waitFor(() => expect(result.current.zustand).toMatchObject({ aufgaben: [aufgabe()] }))

    const vorher = result.current.zustand

    aufgabenAusZeilen.mockResolvedValueOnce({
      aufgaben: [aufgabe({ id: 'item-2', titel: 'Konten kündigen' })],
      uebersprungeneIds: [],
    })
    useSync.mockReturnValue(syncdaten({ zeilen: [erste, zweite] }))
    rerender()

    await waitFor(() =>
      expect(result.current.zustand).toMatchObject({
        aufgaben: [aufgabe(), aufgabe({ id: 'item-2', titel: 'Konten kündigen' })],
      }),
    )

    // Nur die neue Zeile ging noch einmal durch die Entschlüsselung.
    expect(aufgabenAusZeilen).toHaveBeenLastCalledWith([zweite], FALL)

    // Und die unveränderte behält ihre Objektidentität — daran erkennt React,
    // dass ihre Zeile nicht neu zu rendern ist.
    expect(
      result.current.zustand.status === 'bereit' ? result.current.zustand.aufgaben[0] : null,
    ).toBe(vorher.status === 'bereit' ? vorher.aufgaben[0] : undefined)
  })

  it('behaelt den Zaehler der verworfenen Zeilen ueber mehrere Runden', async () => {
    // §3.7: Der Zähler gilt dem Bestand, nicht dem letzten Stapel. Eine Runde
    // ohne neue Zeilen setzte ihn sonst auf 0 zurück, obwohl sich nichts
    // geändert hat.
    const fremd = zeile('fremdes-item')

    aufgabenAusZeilen.mockResolvedValueOnce({
      aufgaben: [],
      uebersprungeneIds: ['fremdes-item'],
    })
    useSync.mockReturnValue(syncdaten({ zeilen: [fremd] }))

    const { result, rerender } = renderHook(() => useAufgaben(FALL))
    await waitFor(() => expect(result.current.zustand).toMatchObject({ uebersprungen: 1 }))

    // Die Türklingel läutet, das Delta bringt nichts Neues.
    useSync.mockReturnValue(syncdaten({ zeilen: [fremd], laedtNetz: true }))
    rerender()

    await waitFor(() => expect(result.current.zustand).toMatchObject({ laedtNetz: true }))
    expect(result.current.zustand).toMatchObject({ uebersprungen: 1 })
    expect(aufgabenAusZeilen).toHaveBeenLastCalledWith([], FALL)
  })

  it('haengt jede Mutation an die Queue, statt selbst zu schreiben', async () => {
    // §5: Es gibt einen Weg hinaus. Ein zweiter, direkter Schreibweg wäre ein
    // zweites Verhalten für dieselbe Handlung.
    const angelegt = { op: 'anlegen', itemId: 'item-neu' } as unknown as Mutation
    const geaendert = { op: 'aendern', itemId: 'item-1' } as unknown as Mutation
    const geloescht = { op: 'loeschen', itemId: 'item-1' } as unknown as Mutation

    mutationAnlegen.mockResolvedValue(angelegt)
    mutationAendern.mockResolvedValue(geaendert)
    mutationLoeschen.mockReturnValue(geloescht)

    const { result } = renderHook(() => useAufgaben(FALL))

    await act(async () => {
      await result.current.legeAn('Konten kündigen')
    })
    expect(mutationAnlegen).toHaveBeenCalledWith(FALL, 'Konten kündigen')
    expect(mutiere).toHaveBeenCalledWith(angelegt)

    await act(async () => {
      await result.current.schreibe(aufgabe(), { titel: 'Anders' })
    })
    expect(mutationAendern).toHaveBeenCalledWith(aufgabe(), { titel: 'Anders' })

    await act(async () => {
      await result.current.hakeAb(aufgabe(), true)
    })
    expect(mutationAendern).toHaveBeenLastCalledWith(aufgabe(), { erledigt: true })

    await act(async () => {
      await result.current.loesche(aufgabe())
    })
    expect(mutationLoeschen).toHaveBeenCalledWith(aufgabe())
    expect(mutiere).toHaveBeenLastCalledWith(geloescht)
  })

  it('reicht einen Fehler der Mutation an den Aufrufer durch', async () => {
    // §5: Abgelehnte Änderungen werden nie stillschweigend verworfen. Der Hook
    // faengt sie deshalb nicht ab — der Screen zeigt sie an.
    mutationAnlegen.mockRejectedValue(new Error('Eine Aufgabe braucht einen Titel.'))

    const { result } = renderHook(() => useAufgaben(FALL))

    await expect(result.current.legeAn('   ')).rejects.toThrow('braucht einen Titel')
    expect(mutiere).not.toHaveBeenCalled()
  })

  it('meldet verworfene Aenderungen mit entschluesseltem Titel', async () => {
    // §5: „mit ihrem entschlüsselten Inhalt als Mitteilung".
    const verworfen: AbgelehnteMutation[] = [
      {
        mutation: { op: 'aendern', itemId: 'item-1', payload: new Uint8Array([2]), ts: 1 },
        grund: 'Der Fall ist versiegelt.',
      },
    ]
    const beschrieben = [
      {
        itemId: 'item-1',
        was: 'aendern' as const,
        titel: 'Sterbeurkunde beantragen',
        grund: 'Der Fall ist versiegelt.',
      },
    ]

    const eine = zeile('item-1')
    beschreibeAbgelehnte.mockResolvedValue(beschrieben)
    useSync.mockReturnValue(syncdaten({ zeilen: [eine], abgelehnt: verworfen }))

    const { result } = renderHook(() => useAufgaben(FALL))

    await waitFor(() => expect(result.current.abgelehnt).toEqual(beschrieben))
    expect(beschreibeAbgelehnte).toHaveBeenCalledWith(verworfen, [eine], FALL)
  })

  it('raeumt die Mitteilung erst weg, wenn jemand sie zur Kenntnis nimmt', async () => {
    const { result } = renderHook(() => useAufgaben(FALL))

    await waitFor(() => expect(result.current.zustand.status).toBe('bereit'))

    act(() => result.current.bestaetige())

    expect(bestaetige).toHaveBeenCalled()
    // Weggeräumt wird im Sync — dort liegt die Liste, und ein zweiter Ort für
    // dieselbe Wahrheit liefe auseinander.
    expect(beschreibeAbgelehnte).not.toHaveBeenCalled()
  })

  it('haelt die Reihenfolge aus dem Sync und nicht die des Entschluesselns', async () => {
    // Die Reihenfolge kommt aus der `id`, also aus der Anlagereihenfolge (§4).
    // Ein Häkchen erhöht die `seq` und verschöbe die Zeile ans Ende, wenn sich
    // dieser Hook nach der Antwort des Entschlüsselns richtete.
    const erste = zeile('item-1')
    const zweite = zeile('item-2')

    aufgabenAusZeilen.mockResolvedValue({
      aufgaben: [
        aufgabe({ id: 'item-2', titel: 'Konten kündigen' }),
        aufgabe({ id: 'item-1' }),
      ],
      uebersprungeneIds: [],
    })
    useSync.mockReturnValue(syncdaten({ zeilen: [erste, zweite] }))

    const { result } = renderHook(() => useAufgaben(FALL))

    await waitFor(() =>
      expect(
        result.current.zustand.status === 'bereit'
          ? result.current.zustand.aufgaben.map((eintrag) => eintrag.id)
          : [],
      ).toEqual(['item-1', 'item-2']),
    )
  })

  describe('Rechtskatalog (§8)', () => {
    it('holt die Instanziierung nach, sobald der Bestand abgeglichen ist', async () => {
      /*
       * Angelegt wird der Katalog bei der Fallanlage. Diese Stelle fängt die
       * Fälle auf, bei denen das nicht durchkam — eine abgerissene Verbindung,
       * oder ein Übergang nach `trauerfall`, den ein anderes Gerät vollzogen hat.
       */
      useSync.mockReturnValue(syncdaten({ zeilen: [zeile('item-1')] }))

      renderHook(() => useAufgaben(FALL))

      await waitFor(() => expect(instanziiereKatalog).toHaveBeenCalledTimes(1))
      expect(instanziiereKatalog).toHaveBeenCalledWith(expect.anything(), FALL, ['item-1'])
    })

    it('wartet damit auf den ersten Abgleich mit dem Server', async () => {
      // Vor dem ersten Abruf ist der Bestand der Cache, und ein leerer Cache
      // sagt nichts darüber, was auf dem Server steht.
      useSync.mockReturnValue(syncdaten({ abgeglichen: false }))

      renderHook(() => useAufgaben(FALL))

      await waitFor(() => expect(aufgabenAusZeilen).toHaveBeenCalled())
      expect(instanziiereKatalog).not.toHaveBeenCalled()
    })

    it('tut es höchstens einmal je Fall, auch wenn Deltas nachkommen', async () => {
      useSync.mockReturnValue(syncdaten())

      const { rerender } = renderHook(() => useAufgaben(FALL))
      await waitFor(() => expect(instanziiereKatalog).toHaveBeenCalledTimes(1))

      useSync.mockReturnValue(syncdaten({ zeilen: [zeile('item-1')] }))
      rerender()

      await waitFor(() => expect(aufgabenAusZeilen).toHaveBeenCalled())
      expect(instanziiereKatalog).toHaveBeenCalledTimes(1)
    })

    it('stellt die Aufgaben der Juristinnen in ihrer Reihenfolge nach vorn', async () => {
      /*
       * Die IDs der Katalogaufgaben sind ein UUIDv5 über einen HMAC (§8) und
       * damit zufällig sortiert. Stünde die Liste nach ihnen, käme die
       * Ausschlagungsfrist irgendwo zwischen Krankenkasse und Bestattung zu
       * liegen.
       */
      const katalog = (reihenfolge: number) => ({
        aufgabeId: `aufgabe-${reihenfolge}`,
        version: '2026-08+testtest',
        fristTage: null,
        fristAb: null,
        rechtsgrundlage: '',
        zustaendigeStelle: '',
        benoetigteDokumente: [],
        unteraufgaben: [],
        haengtAbVon: [],
        hinweis: '',
        quelleUrl: '',
        kategorie: 'Sofort',
        reihenfolge,
      })

      aufgabenAusZeilen.mockResolvedValue({
        aufgaben: [
          aufgabe({ id: 'selbst-1', titel: 'Selbst angelegt' }),
          aufgabe({ id: 'katalog-20', titel: 'Zweite', katalog: katalog(20) }),
          aufgabe({ id: 'selbst-2', titel: 'Auch selbst' }),
          aufgabe({ id: 'katalog-10', titel: 'Erste', katalog: katalog(10) }),
        ],
        uebersprungeneIds: [],
      })

      useSync.mockReturnValue(
        syncdaten({
          zeilen: [zeile('selbst-1'), zeile('katalog-20'), zeile('selbst-2'), zeile('katalog-10')],
        }),
      )

      const { result } = renderHook(() => useAufgaben(FALL))

      await waitFor(() => expect(result.current.zustand).toMatchObject({ status: 'bereit' }))

      const zustand = result.current.zustand
      if (zustand.status !== 'bereit') {
        throw new Error('Die Liste sollte stehen.')
      }

      expect(zustand.aufgaben.map((eintrag) => eintrag.titel)).toEqual([
        'Erste',
        'Zweite',
        'Selbst angelegt',
        'Auch selbst',
      ])
    })

    it('lässt einen Fall ohne eingefrorenen Katalogstand in Ruhe', async () => {
      // §8: Ein Vorsorgefall hat keine Aufgaben. Instanziiert wird beim
      // Übergang nach `trauerfall`, nicht vorher.
      useSync.mockReturnValue(syncdaten())

      renderHook(() => useAufgaben({ ...FALL, katalogVersion: null }))

      await waitFor(() => expect(aufgabenAusZeilen).toHaveBeenCalled())
      expect(instanziiereKatalog).not.toHaveBeenCalled()
    })

    it('lässt die Liste stehen, wenn die Instanziierung scheitert', async () => {
      // Kein Wurf und keine Mitteilung: Was hier scheitert, ist das Netz oder
      // ein fremder Katalogstand — beides kann niemand hier beheben.
      instanziiereKatalog.mockRejectedValue(new Error('kein Netz'))
      aufgabenAusZeilen.mockResolvedValue({ aufgaben: [aufgabe()], uebersprungeneIds: [] })
      useSync.mockReturnValue(syncdaten({ zeilen: [zeile('item-1')] }))

      const { result } = renderHook(() => useAufgaben(FALL))

      await waitFor(() =>
        expect(result.current.zustand).toMatchObject({
          status: 'bereit',
          aufgaben: [aufgabe()],
        }),
      )
    })
  })
})
