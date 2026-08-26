import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { InhaltZeile } from '../../src/core/db/inhalte.ts'
import type { AbgelehnteMutation, Mutation } from '../../src/core/sync/queue.ts'
import type { Syncdaten, SyncZustand } from '../../src/hooks/useSync.ts'
import type { Aufgabe } from '../../src/services/aufgabenService.ts'
import type { Aufgabenfall } from '../../src/hooks/useAufgaben.ts'
import { baueBaum } from '../../src/services/aufgabenbaum.ts'
import { ALLE, NIEMAND, personen } from '../../src/services/zuweisung.ts'

/**
 * Die Aufgaben eines Falls (DESIGN.md §3.1, §5, §7).
 *
 * Der Sync liegt darunter und ist hier ersetzt. Was er tut, prüft
 * `useSync.test.tsx`. `aufgabenService` ist ebenfalls ersetzt; was er
 * verschlüsselt und wann er eine Zeile still verwirft, steht in
 * `tests/services/aufgabenService.test.ts`.
 *
 * Was bleibt, ist die Aufgabe dieses Hooks: aus Ciphertext-Zeilen Aufgaben
 * machen, und zwar nur aus den geänderten (§5), aus Klartext Mutationen
 * machen und sie an die Queue geben.
 */

const aufgabenAusZeilen = vi.fn()
const beschreibeAbgelehnte = vi.fn()
const mutationAnlegen = vi.fn()
const mutationAendern = vi.fn()
const mutationLoeschen = vi.fn()

class AufgabenFehler extends Error {}

vi.mock('../../src/services/aufgabenService.ts', () => ({
  AufgabenFehler,
  aufgabenAusZeilen: (...a: unknown[]) => aufgabenAusZeilen(...a),
  /*
   * Echt und nicht als Attrappe: Die Unterscheidung zwischen Aufgabe und
   * Konfigurations-Item ist eine Zeile ohne Zustand (§3.7, §8), und ein Mock
   * davon prüfte nur, ob der Test dieselbe Regel noch einmal aufschreibt.
   */
  istKonfiguration: (eintrag: object) => 'kenntnisAm' in eintrag,
  istNachlass: (eintrag: object) => 'inhalt' in eintrag,
  beschreibeAbgelehnte: (...a: unknown[]) => beschreibeAbgelehnte(...a),
  mutationAnlegen: (...a: unknown[]) => mutationAnlegen(...a),
  mutationAendern: (...a: unknown[]) => mutationAendern(...a),
  mutationLoeschen: (...a: unknown[]) => mutationLoeschen(...a),
}))

/*
 * Der persönliche Schlüssel (§3.7). Was `privatService` wirklich tut, prüft
 * `tests/services/privatService.test.ts`; hier zählt, dass dieser Hook ihn
 * holt, ihn beim Entschlüsseln weiterreicht und die eine Strukturregel
 * durchsetzt, die vor jedem Schreibvorgang steht.
 */
const ladePersoenlichenSchluessel = vi.fn()
const stellePersoenlichenSchluesselBereit = vi.fn()
const mutationPrivatAnlegen = vi.fn()
const mutationKenntnisAnlegen = vi.fn()
const mutationKenntnisAendern = vi.fn()
const mutationAnfechtungKenntnisAnlegen = vi.fn()
const mutationAnfechtungKenntnisAendern = vi.fn()
const gibFuerAlleFreiDienst = vi.fn()
const pruefeAbhaengigkeiten = vi.fn()

vi.mock('../../src/services/privatService.ts', () => ({
  ladePersoenlichenSchluessel: (...a: unknown[]) => ladePersoenlichenSchluessel(...a),
  stellePersoenlichenSchluesselBereit: (...a: unknown[]) =>
    stellePersoenlichenSchluesselBereit(...a),
  mutationPrivatAnlegen: (...a: unknown[]) => mutationPrivatAnlegen(...a),
  mutationKenntnisAnlegen: (...a: unknown[]) => mutationKenntnisAnlegen(...a),
  mutationKenntnisAendern: (...a: unknown[]) => mutationKenntnisAendern(...a),
  mutationAnfechtungKenntnisAnlegen: (...a: unknown[]) => mutationAnfechtungKenntnisAnlegen(...a),
  mutationAnfechtungKenntnisAendern: (...a: unknown[]) => mutationAnfechtungKenntnisAendern(...a),
  gibFuerAlleFrei: (...a: unknown[]) => gibFuerAlleFreiDienst(...a),
  pruefeAbhaengigkeiten: (...a: unknown[]) => pruefeAbhaengigkeiten(...a),
}))

/** Das angemeldete Gerät. Ohne eines gibt es weder `K_p` noch ein Ziel dafür. */
const GERAET = 'a0000000-0000-4000-8000-000000000001'
const IDENTITAET = { kem: {}, signatur: {} }

vi.mock('../../src/hooks/useGeraete.ts', () => ({
  useGeraeteanmeldung: () => ({
    status: 'bereit',
    identitaet: IDENTITAET,
    geraet: { id: GERAET },
    benutzer: { id: ICH.userId, anzeigename: ICH.name },
  }),
}))

const useSync = vi.fn<(fallId: string) => Syncdaten>()

vi.mock('../../src/hooks/useSync.ts', () => ({ useSync: (fallId: string) => useSync(fallId) }))

/** Die angemeldete Person. Sie ist das, was in eine Zuweisung geschrieben wird (§7). */
const ICH = { userId: 'user_anna', name: 'Anna Müller' }

/**
 * Der Anmeldezustand — veränderlich, weil er hier eine eigene Frage ist.
 *
 * `useGeraeteanmeldung` und `useAuth` sind zwei Quellen, und die eine kann
 * durch sein, während die andere noch lädt. Genau in dieser Lücke ging das
 * Fragebaum-Ergebnis verloren (ERBE_DESIGN.md §6).
 */
let mockAuth: { status: 'laedt' } | { status: 'abgemeldet' } | { status: 'angemeldet'; benutzer: { id: string; anzeigename: string } }

vi.mock('../../src/core/auth/authProvider.ts', () => ({
  useAuth: () => ({ zustand: mockAuth }),
}))

/** Der Zugang zum Server. Angefasst wird er nicht, da der Katalog ersetzt ist. */
vi.mock('../../src/core/db/supabaseProvider.tsx', () => ({ useSupabase: () => () => ({}) }))

const instanziiereKatalog = vi.fn()

vi.mock('../../src/services/katalogService.ts', () => ({
  instanziiereKatalog: (...a: unknown[]) => instanziiereKatalog(...a),
}))

const { useAufgaben } = await import('../../src/hooks/useAufgaben.ts')

/** Der persönliche Schlüssel dieser Person in diesem Fall (§3.7). */
const PRIVAT = { kid: 'a'.repeat(64), kp: new Uint8Array([7]) }

const FALL: Aufgabenfall = {
  id: 'fall-1',
  kid: 'case_fall-1:1',
  kc: new Uint8Array([1]),
  kcat: new Uint8Array([2]),
  katalogVersion: '2026-08+testtest',
  sterbedatum: '2026-05-12',
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
    notizen: '',
    parentId: null,
    dependsOn: [],
    assignee: NIEMAND,
    fristAm: null,
    katalog: null,
    dek: new Uint8Array([9]),
    kid: FALL.kid,
    privat: false,
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
  mockAuth = { status: 'angemeldet', benutzer: { id: ICH.userId, anzeigename: ICH.name } }
  mutiere.mockResolvedValue(undefined)
  aufgabenAusZeilen.mockResolvedValue({ aufgaben: [], konfigurationen: [], nachlass: [], uebersprungeneIds: [] })
  beschreibeAbgelehnte.mockResolvedValue([])
  ladePersoenlichenSchluessel.mockResolvedValue(null)
  stellePersoenlichenSchluesselBereit.mockResolvedValue(PRIVAT)
  mutationPrivatAnlegen.mockResolvedValue({ op: 'anlegen' })
  mutationKenntnisAnlegen.mockResolvedValue({ op: 'anlegen', itemId: 'kenntnis-1' })
  mutationKenntnisAendern.mockResolvedValue({ op: 'aendern', itemId: 'kenntnis-1' })
  mutationAnfechtungKenntnisAnlegen.mockResolvedValue({ op: 'anlegen', itemId: 'anfechtung-1' })
  mutationAnfechtungKenntnisAendern.mockResolvedValue({ op: 'aendern', itemId: 'anfechtung-1' })
  gibFuerAlleFreiDienst.mockResolvedValue(undefined)
  pruefeAbhaengigkeiten.mockReturnValue(undefined)
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
    // §5: "Gecachte Inhalte werden sofort gerendert." Die Ladeanzeige gehört
    // dem Fetch, nicht dem Entschlüsseln.
    const eine = zeile('item-1')
    aufgabenAusZeilen.mockResolvedValue({ aufgaben: [aufgabe()], konfigurationen: [], nachlass: [], uebersprungeneIds: [] })
    useSync.mockReturnValue(syncdaten({ zeilen: [eine], laedtNetz: true }))

    const { result } = renderHook(() => useAufgaben(FALL))

    await waitFor(() => {
      expect(result.current.zustand).toEqual({
        status: 'bereit',
        aufgaben: [aufgabe()],
        baum: baueBaum([aufgabe()]),
        uebersprungen: 0,
        laedtNetz: true,
        netzfehler: null,
      })
    })
  })

  it('laesst die Liste stehen, wenn der Abruf scheitert', async () => {
    // Ein Server, der nicht antwortet, darf nicht als "keine Aufgaben"
    // durchgehen. Sonst sieht jemand einen leeren Fall und legt alles neu an.
    aufgabenAusZeilen.mockResolvedValue({ aufgaben: [aufgabe()], konfigurationen: [], nachlass: [], uebersprungeneIds: [] })
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
     * §5: "Sichtbare Screens aktualisieren sich nur für tatsächlich geänderte
     * Zeilen." Der Reconciler gibt unveränderte Zeilen unverändert zurück; wer
     * das ignoriert, entschlüsselt bei jeder Türklingel den ganzen Fall neu,
     * und bei hundert Aufgaben ist die Türklingel dann teurer als das Polling,
     * das sie ersetzt.
     */
    const erste = zeile('item-1')
    const zweite = zeile('item-2')

    aufgabenAusZeilen.mockResolvedValueOnce({ aufgaben: [aufgabe()], konfigurationen: [], nachlass: [], uebersprungeneIds: [] })
    useSync.mockReturnValue(syncdaten({ zeilen: [erste] }))

    const { result, rerender } = renderHook(() => useAufgaben(FALL))
    await waitFor(() => expect(result.current.zustand).toMatchObject({ aufgaben: [aufgabe()] }))

    const vorher = result.current.zustand

    aufgabenAusZeilen.mockResolvedValueOnce({
      aufgaben: [aufgabe({ id: 'item-2', titel: 'Konten kündigen' })],
      konfigurationen: [],
      nachlass: [],
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
    expect(aufgabenAusZeilen).toHaveBeenLastCalledWith([zweite], FALL, null)

    // Und die unveränderte behält ihre Objektidentität. Daran erkennt React,
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
      konfigurationen: [],
      nachlass: [],
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
    expect(aufgabenAusZeilen).toHaveBeenLastCalledWith([], FALL, null)
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
    // Die anlegende Person geht mit hinaus: Wer etwas aufschreibt, ist damit
    // eingetragen (§7).
    expect(mutationAnlegen).toHaveBeenCalledWith(FALL, 'Konten kündigen', null, ICH, {})
    expect(mutiere).toHaveBeenCalledWith(angelegt)

    await act(async () => {
      await result.current.schreibe(aufgabe(), { titel: 'Anders' })
    })
    expect(mutationAendern).toHaveBeenCalledWith(aufgabe(), { titel: 'Anders' })

    // Eine Aufgabe, die schon jemandem gehoert, aendert beim Haken nur das
    // Haekchen. Die freie traegt die Uebernahme mit; das steht weiter unten.
    const meine = aufgabe({ assignee: personen([ICH]) })

    await act(async () => {
      await result.current.hakeAb(meine, true)
    })
    expect(mutationAendern).toHaveBeenLastCalledWith(meine, { erledigt: true })

    await act(async () => {
      await result.current.loesche(aufgabe())
    })
    expect(mutationLoeschen).toHaveBeenCalledWith(aufgabe())
    expect(mutiere).toHaveBeenLastCalledWith(geloescht)
  })

  it('reicht einen Fehler der Mutation an den Aufrufer durch', async () => {
    // §5: Abgelehnte Änderungen werden nie stillschweigend verworfen. Der Hook
    // faengt sie deshalb nicht ab; der Screen zeigt sie an.
    mutationAnlegen.mockRejectedValue(new Error('Eine Aufgabe braucht einen Titel.'))

    const { result } = renderHook(() => useAufgaben(FALL))

    await expect(result.current.legeAn('   ')).rejects.toThrow('braucht einen Titel')
    expect(mutiere).not.toHaveBeenCalled()
  })

  it('meldet verworfene Aenderungen mit entschluesseltem Titel', async () => {
    // §5: "mit ihrem entschlüsselten Inhalt als Mitteilung".
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
    expect(beschreibeAbgelehnte).toHaveBeenCalledWith(verworfen, [eine], FALL, null)
  })

  it('raeumt die Mitteilung erst weg, wenn jemand sie zur Kenntnis nimmt', async () => {
    const { result } = renderHook(() => useAufgaben(FALL))

    await waitFor(() => expect(result.current.zustand.status).toBe('bereit'))

    act(() => result.current.bestaetige())

    expect(bestaetige).toHaveBeenCalled()
    // Weggeräumt wird im Sync: Dort liegt die Liste, und ein zweiter Ort für
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
      konfigurationen: [],
      nachlass: [],
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
       * Fälle auf, bei denen das nicht durchkam: eine abgerissene Verbindung,
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
        zustaendigeStelle: '',
        benoetigteDokumente: [],
        unteraufgaben: [],
        haengtAbVon: [],
        hinweis: '',
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
        konfigurationen: [],
      nachlass: [],
      uebersprungeneIds: [],
      })

      useSync.mockReturnValue(
        syncdaten({
          zeilen: [zeile('selbst-1'), zeile('katalog-20'), zeile('selbst-2'), zeile('katalog-10')],
        }),
      )

      const { result } = renderHook(() => useAufgaben(FALL))

      /*
       * Gewartet wird auf die Liste und nicht bloss auf "bereit". Sobald der
       * Cache gelesen ist, steht der Zustand (§5). Die Zeilen sind dann aber
       * noch am Entschlüsseln, und unter Last wäre die Erwartung darunter ein
       * Rennen gegen einen leeren Zwischenstand.
       */
      await waitFor(() => {
        expect(result.current.zustand).toMatchObject({
          status: 'bereit',
          aufgaben: [
            { titel: 'Erste' },
            { titel: 'Zweite' },
            { titel: 'Selbst angelegt' },
            { titel: 'Auch selbst' },
          ],
        })
      })
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
      // ein fremder Katalogstand: Beides kann niemand hier beheben.
      instanziiereKatalog.mockRejectedValue(new Error('kein Netz'))
      aufgabenAusZeilen.mockResolvedValue({ aufgaben: [aufgabe()], konfigurationen: [], nachlass: [], uebersprungeneIds: [] })
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

/**
 * Zuweisung und der verlorene Zugriff (DESIGN.md §7).
 *
 * Was eine Zuweisung bedeutet, steht in `zuweisung.test.ts`. Hier steht, was
 * dieser Hook damit tut: die richtige Mutation bauen und mitbekommen, wenn
 * eine Reservierung an jemand anderen gegangen ist.
 */
describe('Zuweisung', () => {
  const BERT = { userId: 'user_bert', name: 'Bert Müller' }

  function mitAufgabe(zuweisung = NIEMAND, ueberschreibung: Partial<Aufgabe> = {}) {
    const eine = aufgabe({ assignee: zuweisung, ...ueberschreibung })

    aufgabenAusZeilen.mockResolvedValue({ aufgaben: [eine], konfigurationen: [], nachlass: [], uebersprungeneIds: [] })
    useSync.mockReturnValue(syncdaten({ zeilen: [zeile(eine.id)] }))

    return eine
  }

  it('trägt beim Abhaken einer freien Aufgabe die angemeldete Person ein', async () => {
    /*
     * §7: Eine freie Aufgabe abzuhaken *ist* die Ansage "ich habe das
     * gemacht". Wer sie erst übernehmen müsste, um sie abhaken zu dürfen,
     * macht zwei Handgriffe für eine Auskunft.
     */
    const freie = mitAufgabe(NIEMAND)
    mutationAendern.mockResolvedValue({ op: 'aendern' })

    const { result } = renderHook(() => useAufgaben(FALL))
    await waitFor(() => expect(result.current.zustand.status).toBe('bereit'))

    await act(async () => {
      await result.current.hakeAb(freie, true)
    })

    // Ein Payload, nicht zwei: Zwei Mutationen könnten halb ankommen, und
    // "abgehakt, aber niemand war es" ist genau der Fall, den das abschafft.
    expect(mutationAendern).toHaveBeenCalledTimes(1)
    expect(mutationAendern).toHaveBeenCalledWith(freie, {
      erledigt: true,
      assignee: personen([ICH]),
    })
  })

  it('trägt beim Wegnehmen des Häkchens niemanden ein', async () => {
    // "Doch nicht erledigt" ist keine Ansage, etwas getan zu haben.
    const freie = mitAufgabe(NIEMAND, { erledigt: true })
    mutationAendern.mockResolvedValue({ op: 'aendern' })

    const { result } = renderHook(() => useAufgaben(FALL))
    await waitFor(() => expect(result.current.zustand.status).toBe('bereit'))

    await act(async () => {
      await result.current.hakeAb(freie, false)
    })

    expect(mutationAendern).toHaveBeenCalledWith(freie, { erledigt: false })
  })

  it('lässt eine fremde Aufgabe beim Abhaken fremd', async () => {
    /*
     * Die Sperre ist dazu da, dass nicht zwei Menschen dieselbe Behörde
     * anrufen. Sie beiläufig zu übergehen hieße, sie abzuschaffen. Die
     * Oberfläche sperrt das Häkchen hier ohnehin; der Hook soll sich nicht
     * darauf verlassen.
     */
    const fremde = mitAufgabe(personen([BERT]))
    mutationAendern.mockResolvedValue({ op: 'aendern' })

    const { result } = renderHook(() => useAufgaben(FALL))
    await waitFor(() => expect(result.current.zustand.status).toBe('bereit'))

    await act(async () => {
      await result.current.hakeAb(fremde, true)
    })

    expect(mutationAendern).toHaveBeenCalledWith(fremde, { erledigt: true })
  })

  it('meldet die verlorene Übernahme auch, wenn sie aus einem Häkchen kam', async () => {
    // §7: Tippen zwei Menschen im selben Moment, gewinnt die höhere `seq`.
    // Die unterlegene Person soll lesen, wer schneller war.
    const freie = mitAufgabe(NIEMAND)
    mutationAendern.mockResolvedValue({ op: 'aendern' })

    const { result, rerender } = renderHook(() => useAufgaben(FALL))
    await waitFor(() => expect(result.current.zustand.status).toBe('bereit'))

    await act(async () => {
      await result.current.hakeAb(freie, true)
    })

    aufgabenAusZeilen.mockResolvedValue({
      aufgaben: [aufgabe({ assignee: personen([BERT]) })],
      konfigurationen: [],
      nachlass: [],
      uebersprungeneIds: [],
    })
    useSync.mockReturnValue(syncdaten({ zeilen: [zeile('item-1', { seq: 2 })] }))
    rerender()

    await waitFor(() => expect(result.current.uebernahmen).toHaveLength(1))
    expect(result.current.uebernahmen[0]?.name).toBe('Bert Müller')
  })

  it('trägt die angemeldete Person ein, wenn sie übernimmt', async () => {
    const eine = mitAufgabe()
    mutationAendern.mockResolvedValue({ op: 'aendern' })

    const { result } = renderHook(() => useAufgaben(FALL))
    await waitFor(() => expect(result.current.zustand.status).toBe('bereit'))

    await act(async () => {
      await result.current.uebernimm(eine)
    })

    expect(mutationAendern).toHaveBeenCalledWith(eine, { assignee: personen([ICH]) })
  })

  it('wirft beim Übernehmen niemanden hinaus, der schon eingetragen ist', async () => {
    const eine = mitAufgabe(personen([BERT]))
    mutationAendern.mockResolvedValue({ op: 'aendern' })

    const { result } = renderHook(() => useAufgaben(FALL))
    await waitFor(() => expect(result.current.zustand.status).toBe('bereit'))

    await act(async () => {
      await result.current.uebernimm(eine)
    })

    expect(mutationAendern).toHaveBeenCalledWith(eine, { assignee: personen([BERT, ICH]) })
  })

  it('löst auch eine fremde Reservierung (§7)', async () => {
    const eine = mitAufgabe(personen([BERT]))
    mutationAendern.mockResolvedValue({ op: 'aendern' })

    const { result } = renderHook(() => useAufgaben(FALL))
    await waitFor(() => expect(result.current.zustand.status).toBe('bereit'))

    await act(async () => {
      await result.current.gibFrei(eine)
    })

    expect(mutationAendern).toHaveBeenCalledWith(eine, { assignee: NIEMAND })
  })

  it('setzt "Alle" als eigenen Wert', async () => {
    const eine = mitAufgabe()
    mutationAendern.mockResolvedValue({ op: 'aendern' })

    const { result } = renderHook(() => useAufgaben(FALL))
    await waitFor(() => expect(result.current.zustand.status).toBe('bereit'))

    await act(async () => {
      await result.current.weiseZu(eine, ALLE)
    })

    expect(mutationAendern).toHaveBeenCalledWith(eine, { assignee: ALLE })
  })

  it('beobachtet auch das Ankreuzen im Aufgabendetail', async () => {
    /*
     * Sich selbst anzukreuzen ist dasselbe wie "Übernehmen" und muss deshalb
     * dieselbe Mitteilung nach sich ziehen, wenn ein anderes Gerät gewinnt (§7).
     */
    const eine = mitAufgabe()
    mutationAendern.mockResolvedValue({ op: 'aendern' })

    const { result, rerender } = renderHook(() => useAufgaben(FALL))
    await waitFor(() => expect(result.current.zustand.status).toBe('bereit'))

    await act(async () => {
      await result.current.weiseZu(eine, personen([ICH]))
    })

    aufgabenAusZeilen.mockResolvedValue({
      aufgaben: [aufgabe({ assignee: personen([BERT]) })],
      konfigurationen: [],
      nachlass: [],
      uebersprungeneIds: [],
    })
    useSync.mockReturnValue(syncdaten({ zeilen: [zeile('item-1', { seq: 2 })] }))
    rerender()

    await waitFor(() =>
      expect(result.current.uebernahmen).toEqual([
        { itemId: eine.id, titel: eine.titel, name: 'Bert Müller' },
      ]),
    )
  })

  it('schweigt, wenn man die Aufgabe selbst weitergegeben hat', async () => {
    const eine = mitAufgabe()
    mutationAendern.mockResolvedValue({ op: 'aendern' })

    const { result, rerender } = renderHook(() => useAufgaben(FALL))
    await waitFor(() => expect(result.current.zustand.status).toBe('bereit'))

    await act(async () => {
      await result.current.uebernimm(eine)
    })

    await act(async () => {
      await result.current.weiseZu(eine, personen([BERT]))
    })

    aufgabenAusZeilen.mockResolvedValue({
      aufgaben: [aufgabe({ assignee: personen([BERT]) })],
      konfigurationen: [],
      nachlass: [],
      uebersprungeneIds: [],
    })
    useSync.mockReturnValue(syncdaten({ zeilen: [zeile('item-1', { seq: 2 })] }))
    rerender()

    await waitFor(() => expect(result.current.zustand.status).toBe('bereit'))
    expect(result.current.uebernahmen).toEqual([])
  })

  it('meldet, wer die Aufgabe stattdessen bekommen hat', async () => {
    /*
     * Der Fall aus §7: Zwei greifen gleichzeitig zu, die höhere `seq` gewinnt.
     * Hier tippt die angemeldete Person auf "Übernehmen"; im nächsten Delta
     * steht Bert. Statt eines stillen Verlusts gibt es einen Satz.
     */
    const eine = mitAufgabe()
    mutationAendern.mockResolvedValue({ op: 'aendern' })

    const { result, rerender } = renderHook(() => useAufgaben(FALL))
    await waitFor(() => expect(result.current.zustand.status).toBe('bereit'))

    await act(async () => {
      await result.current.uebernimm(eine)
    })

    expect(result.current.uebernahmen).toEqual([])

    // Bert war schneller.
    aufgabenAusZeilen.mockResolvedValue({
      aufgaben: [aufgabe({ assignee: personen([BERT]) })],
      konfigurationen: [],
      nachlass: [],
      uebersprungeneIds: [],
    })
    useSync.mockReturnValue(syncdaten({ zeilen: [zeile('item-1', { seq: 2 })] }))
    rerender()

    await waitFor(() =>
      expect(result.current.uebernahmen).toEqual([
        { itemId: eine.id, titel: eine.titel, name: 'Bert Müller' },
      ]),
    )

    act(() => {
      result.current.bestaetigeUebernahmen()
    })

    expect(result.current.uebernahmen).toEqual([])
  })

  it('schweigt, wenn die eigene Reservierung durchgekommen ist', async () => {
    const eine = mitAufgabe()
    mutationAendern.mockResolvedValue({ op: 'aendern' })

    const { result, rerender } = renderHook(() => useAufgaben(FALL))
    await waitFor(() => expect(result.current.zustand.status).toBe('bereit'))

    await act(async () => {
      await result.current.uebernimm(eine)
    })

    aufgabenAusZeilen.mockResolvedValue({
      aufgaben: [aufgabe({ assignee: personen([ICH, BERT]) })],
      konfigurationen: [],
      nachlass: [],
      uebersprungeneIds: [],
    })
    useSync.mockReturnValue(syncdaten({ zeilen: [zeile('item-1', { seq: 2 })] }))
    rerender()

    await waitFor(() => expect(result.current.zustand.status).toBe('bereit'))
    expect(result.current.uebernahmen).toEqual([])
  })

  it('schweigt, wenn die Aufgabe wieder freigegeben wurde', async () => {
    const eine = mitAufgabe()
    mutationAendern.mockResolvedValue({ op: 'aendern' })

    const { result, rerender } = renderHook(() => useAufgaben(FALL))
    await waitFor(() => expect(result.current.zustand.status).toBe('bereit'))

    await act(async () => {
      await result.current.uebernimm(eine)
    })

    aufgabenAusZeilen.mockResolvedValue({
      aufgaben: [aufgabe({ assignee: NIEMAND })],
      konfigurationen: [],
      nachlass: [],
      uebersprungeneIds: [],
    })
    useSync.mockReturnValue(syncdaten({ zeilen: [zeile('item-1', { seq: 2 })] }))
    rerender()

    await waitFor(() => expect(result.current.zustand.status).toBe('bereit'))
    expect(result.current.uebernahmen).toEqual([])
  })
})

describe('Private Aufgaben (§3.7)', () => {
  it('holt den persönlichen Schlüssel und reicht ihn beim Entschlüsseln weiter', async () => {
    ladePersoenlichenSchluessel.mockResolvedValue(PRIVAT)
    useSync.mockReturnValue(syncdaten({ zeilen: [zeile('item-1')] }))

    renderHook(() => useAufgaben(FALL))

    await waitFor(() =>
      expect(aufgabenAusZeilen).toHaveBeenLastCalledWith([zeile('item-1')], FALL, PRIVAT),
    )
  })

  it('entschlüsselt den Bestand erneut, sobald K_p nachträglich hereinkommt', async () => {
    /*
     * `K_p` kostet einen eigenen Rundlauf. Käme er erst nach dem ersten
     * Entschlüsseln, stünden die eigenen privaten Zeilen längst als verworfen
     * in der WeakMap und blieben es für den Rest der Sitzung: Die private
     * Aufgabe wäre für ihre Besitzerin unsichtbar, bis sie neu lädt.
     */
    let loese: (schluessel: unknown) => void = () => undefined
    ladePersoenlichenSchluessel.mockReturnValue(
      new Promise((aufloesen) => {
        loese = aufloesen
      }),
    )

    const eine = zeile('item-1')
    useSync.mockReturnValue(syncdaten({ zeilen: [eine] }))

    renderHook(() => useAufgaben(FALL))

    await waitFor(() => expect(aufgabenAusZeilen).toHaveBeenLastCalledWith([eine], FALL, null))

    await act(async () => {
      loese(PRIVAT)
    })

    await waitFor(() => expect(aufgabenAusZeilen).toHaveBeenLastCalledWith([eine], FALL, PRIVAT))
  })

  it('legt eine private Aufgabe unter K_p an und trägt die anlegende Person ein', async () => {
    const mutation = { op: 'anlegen', itemId: 'item-privat' }
    mutationPrivatAnlegen.mockResolvedValue(mutation)
    useSync.mockReturnValue(syncdaten())

    const { result } = renderHook(() => useAufgaben(FALL))

    await act(async () => {
      await result.current.legeAn('Erbausschlagung erwägen', null, true)
    })

    expect(stellePersoenlichenSchluesselBereit).toHaveBeenCalled()
    expect(mutationPrivatAnlegen).toHaveBeenCalledWith(
      FALL,
      PRIVAT,
      'Erbausschlagung erwägen',
      ICH,
      {},
    )
    expect(mutationAnlegen).not.toHaveBeenCalled()
    expect(mutiere).toHaveBeenCalledWith(mutation)
  })

  it('reicht Beschreibung und Frist bis in dieselbe Mutation durch (§7)', async () => {
    mutationAnlegen.mockResolvedValue({ op: 'anlegen', itemId: 'item-1' })
    useSync.mockReturnValue(syncdaten())

    const { result } = renderHook(() => useAufgaben(FALL))

    await act(async () => {
      await result.current.legeAn('Konten kündigen', null, false, {
        beschreibung: 'Sparkasse',
        fristAm: '2026-09-30',
      })
    })

    expect(mutationAnlegen).toHaveBeenCalledWith(FALL, 'Konten kündigen', null, ICH, {
      beschreibung: 'Sparkasse',
      fristAm: '2026-09-30',
    })
  })

  it('legt ohne den Schalter weiterhin eine geteilte Aufgabe an', async () => {
    mutationAnlegen.mockResolvedValue({ op: 'anlegen', itemId: 'item-1' })
    useSync.mockReturnValue(syncdaten())

    const { result } = renderHook(() => useAufgaben(FALL))

    await act(async () => {
      await result.current.legeAn('Sterbeurkunde beantragen')
    })

    expect(mutationAnlegen).toHaveBeenCalled()
    expect(stellePersoenlichenSchluesselBereit).not.toHaveBeenCalled()
    expect(mutationPrivatAnlegen).not.toHaveBeenCalled()
  })

  it('legt keine private Unteraufgabe an', async () => {
    /*
     * §3.7: Private Aufgaben sind immer Wurzelaufgaben. Sonst hätte dieselbe
     * Elternaufgabe für ihre Besitzerin drei Kinder und für alle anderen zwei.
     */
    useSync.mockReturnValue(syncdaten())

    const { result } = renderHook(() => useAufgaben(FALL))

    await expect(result.current.legeAn('Nur für mich', 'item-1', true)).rejects.toThrow(
      /Unteraufgabe/,
    )

    expect(stellePersoenlichenSchluesselBereit).not.toHaveBeenCalled()
    expect(mutiere).not.toHaveBeenCalled()
  })

  it('prüft die Abhängigkeiten, bevor eine Änderung in die Queue geht', async () => {
    const eine = aufgabe()
    aufgabenAusZeilen.mockResolvedValue({ aufgaben: [eine], konfigurationen: [], nachlass: [], uebersprungeneIds: [] })
    mutationAendern.mockResolvedValue({ op: 'aendern', itemId: eine.id })
    useSync.mockReturnValue(syncdaten({ zeilen: [zeile('item-1')] }))

    const { result } = renderHook(() => useAufgaben(FALL))

    /*
     * Gewartet wird auf die entschlüsselte Liste und nicht bloss auf
     * `status: 'bereit'`: Der steht schon, sobald der Cache gelesen ist (§5),
     * und `schreibe` prüft gegen das, was dieses Gerät entschlüsselt hat.
     */
    await waitFor(() => {
      const zustand = result.current.zustand

      expect(zustand.status === 'bereit' && zustand.aufgaben).toEqual([eine])
    })

    await act(async () => {
      await result.current.schreibe(eine, { dependsOn: ['item-2'] })
    })

    expect(pruefeAbhaengigkeiten).toHaveBeenCalledWith(eine, ['item-2'], [eine])
  })

  it('hängt nichts an, wenn die Abhängigkeit auf eine private Aufgabe zeigt', async () => {
    const eine = aufgabe()
    aufgabenAusZeilen.mockResolvedValue({ aufgaben: [eine], konfigurationen: [], nachlass: [], uebersprungeneIds: [] })
    useSync.mockReturnValue(syncdaten({ zeilen: [zeile('item-1')] }))

    pruefeAbhaengigkeiten.mockImplementation(() => {
      throw new AufgabenFehler('Von einer privaten Aufgabe kann nichts abhängen.')
    })

    const { result } = renderHook(() => useAufgaben(FALL))

    await waitFor(() => expect(result.current.zustand.status).toBe('bereit'))

    await expect(result.current.schreibe(eine, { dependsOn: ['privat'] })).rejects.toThrow(
      /privaten Aufgabe/,
    )

    expect(mutiere).not.toHaveBeenCalled()
  })

  it('gibt eine private Aufgabe für alle frei und stösst eine Sync-Runde an', async () => {
    /*
     * Umwrappen ist keine der drei Operationen, die die Queue kennt (§5). Ohne
     * das `aktualisiere()` danach stünde die Aufgabe bis zur nächsten
     * Türklingel weiter als privat da.
     */
    ladePersoenlichenSchluessel.mockResolvedValue(PRIVAT)
    const meine = aufgabe({ kid: PRIVAT.kid, privat: true })
    useSync.mockReturnValue(syncdaten())

    const { result } = renderHook(() => useAufgaben(FALL))

    /*
     * Nicht nur, dass der Schlüssel geholt wurde, sondern dass er angekommen
     * ist: Er kostet einen eigenen Rundlauf, und erst danach entschlüsselt der
     * Hook mit ihm. Vorher hielte `gibFuerAlleFrei` noch kein `K_p`.
     */
    await waitFor(() =>
      expect(aufgabenAusZeilen).toHaveBeenCalledWith(expect.anything(), FALL, PRIVAT),
    )

    await act(async () => {
      await result.current.gibFuerAlleFrei(meine)
    })

    expect(gibFuerAlleFreiDienst).toHaveBeenCalledWith(
      expect.anything(),
      FALL,
      PRIVAT,
      meine,
    )
    expect(aktualisiere).toHaveBeenCalled()
  })

  it('gibt nichts frei, solange kein persönlicher Schlüssel da ist', async () => {
    useSync.mockReturnValue(syncdaten())

    const { result } = renderHook(() => useAufgaben(FALL))

    await expect(result.current.gibFuerAlleFrei(aufgabe())).rejects.toThrow(
      /persönlicher Schlüssel/,
    )

    expect(gibFuerAlleFreiDienst).not.toHaveBeenCalled()
  })

  it('lässt die Aufgabenliste stehen, wenn K_p nicht abrufbar ist', async () => {
    /*
     * §3.7: Ohne `K_p` sieht dieses Gerät die eigenen privaten Aufgaben nicht,
     * und das ist genau der Zustand, den jedes andere Mitglied ohnehin hat.
     * Die geteilten Aufgaben stehen davon unberührt da.
     */
    ladePersoenlichenSchluessel.mockRejectedValue(new Error('Kein Netz.'))
    aufgabenAusZeilen.mockResolvedValue({ aufgaben: [aufgabe()], konfigurationen: [], nachlass: [], uebersprungeneIds: [] })
    useSync.mockReturnValue(syncdaten({ zeilen: [zeile('item-1')] }))

    const { result } = renderHook(() => useAufgaben(FALL))

    // Auf die entschlüsselte Liste und nicht auf `status`: Der steht schon,
    // sobald der Cache gelesen ist (§5).
    await waitFor(() => {
      const zustand = result.current.zustand

      expect(zustand.status === 'bereit' && zustand.aufgaben).toEqual([aufgabe()])
    })
  })
})

/**
 * Das eigene Kenntnisdatum (DESIGN.md §8, #12).
 *
 * Es kommt als privates Konfigurations-Item über denselben Weg herein wie
 * alles andere (§3.7) und darf trotzdem nirgends als Aufgabe auftauchen. Was
 * der Dienst dabei verschlüsselt, prüft `privatService.test.ts`; hier zählt,
 * was dieser Hook damit macht.
 */
describe('Kenntnisdatum (§8, #12)', () => {
  /** Ein gelesenes Konfigurations-Item, so wie der Dienst es liefert. */
  function konfiguration(
    id: string,
    kenntnisAm: string | null,
    anfechtungKenntnisAm: string | null = null,
  ) {
    return { id, kenntnisAm, anfechtungKenntnisAm, dek: new Uint8Array([8]), kid: PRIVAT.kid }
  }

  it('haelt es aus dem Aufgabenbaum heraus und gibt es als Fristbezug weiter', async () => {
    aufgabenAusZeilen.mockResolvedValue({
      aufgaben: [aufgabe()],
      konfigurationen: [konfiguration('kenntnis-1', '2026-05-12')],
      nachlass: [],
      uebersprungeneIds: [],
    })
    useSync.mockReturnValue(syncdaten({ zeilen: [zeile('item-1'), zeile('kenntnis-1')] }))

    const { result } = renderHook(() => useAufgaben(FALL))

    await waitFor(() => {
      expect(result.current.fristbezug).toEqual({
        sterbedatum: FALL.sterbedatum,
        kenntnisAm: '2026-05-12',
        anfechtungKenntnisAm: null,
      })
    })

    const zustand = result.current.zustand

    expect(zustand.status === 'bereit' && zustand.aufgaben).toEqual([aufgabe()])
    expect(zustand.status === 'bereit' && zustand.uebersprungen).toBe(0)
  })

  it('legt beim ersten Eintragen ein Item unter K_p an', async () => {
    const { result } = renderHook(() => useAufgaben(FALL))

    await waitFor(() => {
      expect(result.current.zustand.status).toBe('bereit')
    })

    await act(async () => {
      await result.current.setzeKenntnisAm('2026-05-12')
    })

    expect(stellePersoenlichenSchluesselBereit).toHaveBeenCalled()
    expect(mutationKenntnisAnlegen).toHaveBeenCalledWith(FALL, PRIVAT, '2026-05-12')
    expect(mutationKenntnisAendern).not.toHaveBeenCalled()
    expect(mutiere).toHaveBeenCalledWith({ op: 'anlegen', itemId: 'kenntnis-1' })
  })

  it('aendert das vorhandene Item, statt ein zweites anzulegen', async () => {
    const vorhanden = konfiguration('kenntnis-1', '2026-05-12')

    ladePersoenlichenSchluessel.mockResolvedValue(PRIVAT)
    aufgabenAusZeilen.mockResolvedValue({
      aufgaben: [],
      konfigurationen: [vorhanden],
      nachlass: [],
      uebersprungeneIds: [],
    })
    useSync.mockReturnValue(syncdaten({ zeilen: [zeile('kenntnis-1')] }))

    const { result } = renderHook(() => useAufgaben(FALL))

    await waitFor(() => {
      expect(result.current.fristbezug.kenntnisAm).toBe('2026-05-12')
    })

    await act(async () => {
      await result.current.setzeKenntnisAm('2026-06-02')
    })

    expect(mutationKenntnisAendern).toHaveBeenCalledWith(vorhanden, '2026-06-02')
    expect(mutationKenntnisAnlegen).not.toHaveBeenCalled()
  })

  it('nimmt bei zwei eigenen Items das juengste', async () => {
    /*
     * Zwei Geräte derselben Person können offline je eines angelegt haben. Die
     * `id` ist eine UUIDv7 (§5), also ist die größere die jüngere, und beide
     * Geräte einigen sich ohne Zutun auf dieselbe.
     */
    aufgabenAusZeilen.mockResolvedValue({
      aufgaben: [],
      konfigurationen: [konfiguration('kenntnis-1', '2026-05-12'), konfiguration('kenntnis-2', '2026-06-02')],
      nachlass: [],
      uebersprungeneIds: [],
    })
    useSync.mockReturnValue(syncdaten({ zeilen: [zeile('kenntnis-1'), zeile('kenntnis-2')] }))

    const { result } = renderHook(() => useAufgaben(FALL))

    await waitFor(() => {
      expect(result.current.fristbezug.kenntnisAm).toBe('2026-06-02')
    })
  })
})

/**
 * Das eigene Anfechtungs-Kenntnisdatum (§8, D).
 *
 * Dasselbe Muster wie oben bei `setzeKenntnisAm`, nur ein eigenes Feld
 * desselben Konfigurations-Items: Die Anfechtung hängt an einem anderen Tag
 * als die Ausschlagung nach § 1944 BGB, und beide dürfen sich nicht
 * gegenseitig überschreiben.
 */
describe('Anfechtungs-Kenntnisdatum (§8, D)', () => {
  function konfiguration(
    id: string,
    kenntnisAm: string | null,
    anfechtungKenntnisAm: string | null,
  ) {
    return { id, kenntnisAm, anfechtungKenntnisAm, dek: new Uint8Array([8]), kid: PRIVAT.kid }
  }

  it('gibt es getrennt vom Kenntnisdatum als Fristbezug weiter', async () => {
    aufgabenAusZeilen.mockResolvedValue({
      aufgaben: [],
      konfigurationen: [konfiguration('konfig-1', '2026-05-12', '2026-06-01')],
      nachlass: [],
      uebersprungeneIds: [],
    })
    useSync.mockReturnValue(syncdaten({ zeilen: [zeile('konfig-1')] }))

    const { result } = renderHook(() => useAufgaben(FALL))

    await waitFor(() => {
      expect(result.current.fristbezug).toEqual({
        sterbedatum: FALL.sterbedatum,
        kenntnisAm: '2026-05-12',
        anfechtungKenntnisAm: '2026-06-01',
      })
    })
  })

  it('legt beim ersten Eintragen ein Item unter K_p an', async () => {
    const { result } = renderHook(() => useAufgaben(FALL))

    await waitFor(() => {
      expect(result.current.zustand.status).toBe('bereit')
    })

    await act(async () => {
      await result.current.setzeAnfechtungKenntnisAm('2026-05-12')
    })

    expect(stellePersoenlichenSchluesselBereit).toHaveBeenCalled()
    expect(mutationAnfechtungKenntnisAnlegen).toHaveBeenCalledWith(FALL, PRIVAT, '2026-05-12')
    expect(mutationAnfechtungKenntnisAendern).not.toHaveBeenCalled()
    expect(mutiere).toHaveBeenCalledWith({ op: 'anlegen', itemId: 'anfechtung-1' })
  })

  it('aendert das vorhandene Item, statt ein zweites anzulegen', async () => {
    const vorhanden = konfiguration('konfig-1', null, '2026-05-12')

    ladePersoenlichenSchluessel.mockResolvedValue(PRIVAT)
    aufgabenAusZeilen.mockResolvedValue({
      aufgaben: [],
      konfigurationen: [vorhanden],
      nachlass: [],
      uebersprungeneIds: [],
    })
    useSync.mockReturnValue(syncdaten({ zeilen: [zeile('konfig-1')] }))

    const { result } = renderHook(() => useAufgaben(FALL))

    await waitFor(() => {
      expect(result.current.fristbezug.anfechtungKenntnisAm).toBe('2026-05-12')
    })

    await act(async () => {
      await result.current.setzeAnfechtungKenntnisAm('2026-06-02')
    })

    expect(mutationAnfechtungKenntnisAendern).toHaveBeenCalledWith(vorhanden, '2026-06-02')
    expect(mutationAnfechtungKenntnisAnlegen).not.toHaveBeenCalled()
    // Und das Kenntnisdatum nach § 1944 BGB bleibt unberührt: andere Funktion,
    // anderes Feld.
    expect(mutationKenntnisAendern).not.toHaveBeenCalled()
  })
})

/**
 * Wann ein Fragebaum-Ergebnis abgelegt werden darf (ERBE_DESIGN.md §6).
 *
 * Der Riegel, der das Schreiben freigibt, muss dasselbe abfragen wie der, der
 * es verbietet. Fragt er weniger ab, gibt es ein Zeitfenster, in dem der
 * Fragebaum schreiben darf und `holePersoenlichenSchluessel` wirft — und dann
 * ist ein vollständiger Durchlauf verloren, bevor irgendein Netzaufruf
 * passiert.
 */
describe('fragebaumGeladen (ERBE_DESIGN.md §6)', () => {
  it('steht erst, wenn Bestand, K_p und Anmeldung durch sind', async () => {
    useSync.mockReturnValue(syncdaten())

    const { result } = renderHook(() => useAufgaben(FALL))

    await waitFor(() => expect(result.current.fragebaumGeladen).toBe(true))
  })

  it('steht nicht, solange der Bestand noch nicht gecacht ist', async () => {
    useSync.mockReturnValue(syncdaten({ gecacht: false }))

    const { result } = renderHook(() => useAufgaben(FALL))

    await waitFor(() => expect(ladePersoenlichenSchluessel).toHaveBeenCalled())

    expect(result.current.fragebaumGeladen).toBe(false)
  })

  it('steht nicht, solange die Anmeldung noch lädt', async () => {
    /*
     * Der Fehler, den dieser Test festhält: Die Geräteanmeldung ist durch,
     * `K_p` ist geprüft — und `useAuth` liefert trotzdem noch keine `userId`.
     * Gäbe der Riegel hier frei, schriebe der Fragebaum in genau dem Moment,
     * in dem {@link holePersoenlichenSchluessel} „Ohne angemeldetes Gerät geht
     * das nicht." wirft.
     */
    mockAuth = { status: 'laedt' }
    useSync.mockReturnValue(syncdaten())

    const { result } = renderHook(() => useAufgaben(FALL))

    await waitFor(() => expect(ladePersoenlichenSchluessel).toHaveBeenCalled())

    expect(result.current.fragebaumGeladen).toBe(false)
  })

  it('gibt frei, sobald die Anmeldung nachkommt', async () => {
    mockAuth = { status: 'laedt' }
    useSync.mockReturnValue(syncdaten())

    const { result, rerender } = renderHook(() => useAufgaben(FALL))

    await waitFor(() => expect(ladePersoenlichenSchluessel).toHaveBeenCalled())
    expect(result.current.fragebaumGeladen).toBe(false)

    mockAuth = { status: 'angemeldet', benutzer: { id: ICH.userId, anzeigename: ICH.name } }
    rerender()

    await waitFor(() => expect(result.current.fragebaumGeladen).toBe(true))
  })
})
