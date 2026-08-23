import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Aufgabe, Fallschluessel } from '../../src/services/aufgabenService.ts'

/**
 * Die Aufgaben eines Falls (DESIGN.md §5, §7).
 *
 * `aufgabenService` ist ersetzt — was er verschlüsselt und wann er eine Zeile
 * still verwirft, steht in `tests/services/aufgabenService.test.ts`. Hier geht
 * es um die Zustandsführung: Eine Änderung ist sofort sichtbar (§5), danach
 * kommt die Liste vom Server zurück, und kein Fehler wird verschluckt.
 */

const ladeAufgaben = vi.fn()
const legeAufgabeAn = vi.fn()
const schreibeAufgabe = vi.fn()
const loescheAufgabe = vi.fn()

vi.mock('../../src/services/aufgabenService.ts', () => ({
  ladeAufgaben: (...a: unknown[]) => ladeAufgaben(...a),
  legeAufgabeAn: (...a: unknown[]) => legeAufgabeAn(...a),
  schreibeAufgabe: (...a: unknown[]) => schreibeAufgabe(...a),
  loescheAufgabe: (...a: unknown[]) => loescheAufgabe(...a),
}))
vi.mock('../../src/core/db/supabaseInhalte.ts', () => ({ supabaseInhalte: () => ({}) }))
// Siehe useGeraete.test.tsx: Der Zugang muss stabil bleiben, sonst dreht sich
// der Effekt endlos.
vi.mock('../../src/core/db/supabaseProvider.tsx', () => {
  const zugang = () => ({})
  return { useSupabase: () => zugang }
})

const { useAufgaben } = await import('../../src/hooks/useAufgaben.ts')

const FALL: Fallschluessel = { id: 'fall-1', kid: 'case_fall-1:1', kc: new Uint8Array([1]) }

function aufgabe(ueberschreibung: Partial<Aufgabe> = {}): Aufgabe {
  return {
    id: 'item-1',
    titel: 'Sterbeurkunde beantragen',
    beschreibung: '',
    erledigt: false,
    dek: new Uint8Array([9]),
    kid: FALL.kid,
    ...ueberschreibung,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  ladeAufgaben.mockResolvedValue({ aufgaben: [aufgabe()], uebersprungen: 0 })
  legeAufgabeAn.mockResolvedValue(undefined)
  schreibeAufgabe.mockResolvedValue(undefined)
  loescheAufgabe.mockResolvedValue(undefined)
})

describe('useAufgaben', () => {
  it('laedt und liefert die Aufgaben samt Zaehler', async () => {
    ladeAufgaben.mockResolvedValue({ aufgaben: [aufgabe()], uebersprungen: 2 })

    const { result } = renderHook(() => useAufgaben(FALL))

    expect(result.current.zustand.status).toBe('laedt')

    await waitFor(() => {
      expect(result.current.zustand).toEqual({
        status: 'bereit',
        aufgaben: [aufgabe()],
        uebersprungen: 2,
      })
    })
  })

  it('macht aus einem Fehlschlag beim Laden keinen leeren Fall', async () => {
    // Ein Server, der nicht antwortet, darf nicht als „keine Aufgaben"
    // durchgehen — sonst sieht jemand einen leeren Fall und legt alles neu an.
    ladeAufgaben.mockRejectedValue(new Error('Der Server war nicht erreichbar.'))

    const { result } = renderHook(() => useAufgaben(FALL))

    await waitFor(() => {
      expect(result.current.zustand).toEqual({
        status: 'fehler',
        nachricht: 'Der Server war nicht erreichbar.',
      })
    })
  })

  it('laedt nach dem Anlegen vom Server neu', async () => {
    const { result } = renderHook(() => useAufgaben(FALL))
    await waitFor(() => expect(result.current.zustand.status).toBe('bereit'))

    ladeAufgaben.mockResolvedValue({
      aufgaben: [aufgabe(), aufgabe({ id: 'item-2', titel: 'Konten kündigen' })],
      uebersprungen: 0,
    })

    await result.current.legeAn('Konten kündigen')

    expect(legeAufgabeAn).toHaveBeenCalledWith({}, FALL, 'Konten kündigen')

    await waitFor(() => {
      expect(result.current.zustand).toMatchObject({ status: 'bereit' })
      expect(ladeAufgaben).toHaveBeenCalledTimes(2)
    })
  })

  it('laedt nach jeder Aenderung neu', async () => {
    const { result } = renderHook(() => useAufgaben(FALL))
    await waitFor(() => expect(result.current.zustand.status).toBe('bereit'))

    await result.current.schreibe(aufgabe(), { titel: 'Anders' })
    expect(schreibeAufgabe).toHaveBeenCalledWith({}, aufgabe(), { titel: 'Anders' })
    await waitFor(() => expect(ladeAufgaben).toHaveBeenCalledTimes(2))

    await result.current.hakeAb(aufgabe(), true)
    expect(schreibeAufgabe).toHaveBeenCalledWith({}, aufgabe(), { erledigt: true })
    await waitFor(() => expect(ladeAufgaben).toHaveBeenCalledTimes(3))

    await result.current.loesche(aufgabe())
    expect(loescheAufgabe).toHaveBeenCalledWith({}, aufgabe())
    await waitFor(() => expect(ladeAufgaben).toHaveBeenCalledTimes(4))
  })

  it('reicht einen Fehler der Mutation an den Aufrufer durch', async () => {
    // §5: Abgelehnte Mutationen werden nie stillschweigend verworfen. Der Hook
    // faengt sie deshalb nicht ab — der Screen zeigt sie an.
    legeAufgabeAn.mockRejectedValue(new Error('Das ging nicht.'))

    const { result } = renderHook(() => useAufgaben(FALL))
    await waitFor(() => expect(result.current.zustand.status).toBe('bereit'))

    await expect(result.current.legeAn('Neu')).rejects.toThrow('Das ging nicht.')
  })

  it('zeigt ein Haekchen sofort, noch vor dem Rundlauf', async () => {
    // §5: Jede Mutation wird optimistisch lokal angewandt. Ohne das spraenge
    // das gerade gesetzte Haekchen fuer die Dauer eines Rundlaufs sichtbar
    // zurueck — und wer auf einem Telefon tippt, tippt ein zweites Mal.
    let gibFrei = () => {}
    schreibeAufgabe.mockReturnValue(
      new Promise<void>((aufloesen) => {
        gibFrei = aufloesen
      }),
    )

    const { result } = renderHook(() => useAufgaben(FALL))
    await waitFor(() => expect(result.current.zustand.status).toBe('bereit'))

    void result.current.hakeAb(aufgabe(), true)

    await waitFor(() => {
      expect(result.current.zustand).toMatchObject({
        aufgaben: [expect.objectContaining({ erledigt: true })],
      })
    })

    expect(ladeAufgaben).toHaveBeenCalledTimes(1)
    gibFrei()
  })

  it('nimmt eine abgelehnte Aenderung zurueck, indem es neu laedt', async () => {
    // Der Server ist die Wahrheit. Bleibt die optimistische Anzeige stehen,
    // sieht jemand ein Haekchen, das nirgends gespeichert ist.
    schreibeAufgabe.mockRejectedValue(new Error('Das ging nicht.'))

    const { result } = renderHook(() => useAufgaben(FALL))
    await waitFor(() => expect(result.current.zustand.status).toBe('bereit'))

    await expect(result.current.hakeAb(aufgabe(), true)).rejects.toThrow('Das ging nicht.')

    await waitFor(() => {
      expect(ladeAufgaben).toHaveBeenCalledTimes(2)
      expect(result.current.zustand).toMatchObject({
        aufgaben: [expect.objectContaining({ erledigt: false })],
      })
    })
  })

  it('laesst ein ueberholtes Neuladen die juengere Aenderung nicht ueberschreiben', async () => {
    /*
     * Zwei Haekchen kurz hintereinander. Der Abruf, den das erste angestossen
     * hat, wurde losgeschickt, bevor das zweite gesetzt war — er kennt es
     * nicht. Traefe seine Antwort ungeprueft ein, spraenge das zweite Haekchen
     * sichtbar zurueck, genau das, was die optimistische Anzeige verhindern
     * soll.
     */
    const zweite = aufgabe({ id: 'item-2', titel: 'Konten kündigen' })
    ladeAufgaben.mockResolvedValue({ aufgaben: [aufgabe(), zweite], uebersprungen: 0 })

    const { result } = renderHook(() => useAufgaben(FALL))
    await waitFor(() => expect(result.current.zustand.status).toBe('bereit'))

    // Das Neuladen nach dem ersten Haekchen bleibt haengen. Sein Stand kennt
    // das zweite Haekchen naturgemaess nicht — es wurde losgeschickt, bevor es
    // gesetzt war.
    let gibNeuladenFrei = () => {}
    ladeAufgaben.mockReturnValueOnce(
      new Promise((aufloesen) => {
        gibNeuladenFrei = () =>
          aufloesen({ aufgaben: [aufgabe({ erledigt: true }), zweite], uebersprungen: 0 })
      }),
    )

    await result.current.hakeAb(aufgabe(), true)
    await waitFor(() => expect(ladeAufgaben).toHaveBeenCalledTimes(2))

    // Das zweite Haekchen wird gesetzt, waehrend das erste Neuladen noch laeuft
    // und sein eigener Schreibvorgang noch unterwegs ist.
    let gibSchreibenFrei = () => {}
    schreibeAufgabe.mockReturnValueOnce(
      new Promise<void>((aufloesen) => {
        gibSchreibenFrei = aufloesen
      }),
    )

    void result.current.hakeAb(zweite, true)
    await waitFor(() => {
      expect(result.current.zustand).toMatchObject({
        aufgaben: [expect.anything(), expect.objectContaining({ erledigt: true })],
      })
    })

    gibNeuladenFrei()

    // Das ueberholte Ergebnis wird verworfen: Das zweite Haekchen bleibt.
    await new Promise((weiter) => setTimeout(weiter, 20))
    expect(result.current.zustand).toMatchObject({
      aufgaben: [
        expect.objectContaining({ id: 'item-1', erledigt: true }),
        expect.objectContaining({ id: 'item-2', erledigt: true }),
      ],
    })

    gibSchreibenFrei()
  })

  it('faellt nicht ueber eine Aenderung her, solange gar keine Liste da ist', async () => {
    // Der Fehlerzustand hat keine Aufgaben, auf die sich etwas optimistisch
    // anwenden liesse. Die Aenderung geht trotzdem hinaus und laedt danach neu.
    ladeAufgaben.mockRejectedValueOnce(new Error('Der Server war nicht erreichbar.'))

    const { result } = renderHook(() => useAufgaben(FALL))
    await waitFor(() => expect(result.current.zustand.status).toBe('fehler'))

    await result.current.hakeAb(aufgabe(), true)

    await waitFor(() => {
      expect(result.current.zustand).toMatchObject({ status: 'bereit' })
    })
  })

  it('nimmt eine geloeschte Aufgabe sofort aus der Liste', async () => {
    let gibFrei = () => {}
    loescheAufgabe.mockReturnValue(
      new Promise<void>((aufloesen) => {
        gibFrei = aufloesen
      }),
    )

    const { result } = renderHook(() => useAufgaben(FALL))
    await waitFor(() => expect(result.current.zustand.status).toBe('bereit'))

    void result.current.loesche(aufgabe())

    await waitFor(() => {
      expect(result.current.zustand).toMatchObject({ aufgaben: [] })
    })

    gibFrei()
  })
})
