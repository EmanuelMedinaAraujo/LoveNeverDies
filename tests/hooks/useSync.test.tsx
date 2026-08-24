import 'fake-indexeddb/auto'
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CACHE_DB } from '../../src/core/db/idb'
import type { InhalteTabelle, InhaltZeile, NeuerInhalt } from '../../src/core/db/inhalte'
import type { Mutation } from '../../src/core/sync/queue'

/**
 * Der Rundlauf des Delta-Syncs (DESIGN.md §5).
 *
 * Die vier Bausteine haben eigene Tests — `tests/sync/*`. Hier geht es um das,
 * was erst beim Zusammensetzen entsteht und in keinem von ihnen steht:
 *
 * - Der **Kaltstart** rendert aus dem Cache, bevor das Netz antwortet, und
 *   auch dann, wenn es nie antwortet.
 * - Der **billige Check** spart den Abruf. `version` gleich Wasserzeichen →
 *   kein `seit`.
 * - Die **Queue** geht zuerst hinaus, und was der Server verwirft, kommt als
 *   Mitteilung zurück statt still zu verschwinden.
 * - Die **Türklingel** und der **Reconnect** stossen dieselbe Runde an.
 *
 * Der Server ist ein Doppel: eine Tabelle, ein Zähler, keine Meinung. Ob
 * Postgres `seq` richtig vergibt, prüft `tests/db/delta.test.ts` gegen eine
 * echte Datenbank.
 */

type Klingelruf = () => void

const laeuten: Klingelruf[] = []

vi.mock('../../src/core/sync/realtime.ts', () => ({
  tuerklingel: (_client: unknown, _fallId: string, laeute: Klingelruf) => {
    laeuten.push(laeute)

    return () => {
      const stelle = laeuten.indexOf(laeute)

      if (stelle >= 0) {
        laeuten.splice(stelle, 1)
      }
    }
  },
}))

// Siehe useGeraete.test.tsx: Der Zugang muss stabil bleiben, sonst dreht sich
// der Effekt endlos.
vi.mock('../../src/core/db/supabaseProvider.tsx', () => {
  const zugang = () => ({})
  return { useSupabase: () => zugang }
})

vi.mock('../../src/core/db/supabaseInhalte.ts', () => ({
  supabaseInhalte: () => server.inhalte,
}))

vi.mock('../../src/core/db/supabaseFaelle.ts', () => ({
  supabaseFaelle: () => ({ version: (fallId: string) => server.version(fallId) }),
}))

const { useSync } = await import('../../src/hooks/useSync.ts')

const FALL = 'fall-1'

function bytes(...werte: number[]): Uint8Array {
  return new Uint8Array(werte)
}

/**
 * Bytes als Zahlenliste vergleichen.
 *
 * Was durch IndexedDB gegangen ist, kommt als `Uint8Array` aus einem anderen
 * Realm zurück — inhaltlich dasselbe, für `toEqual` aber ein anderer Typ. Die
 * Frage hier ist der Inhalt.
 */
function alsListe(werte: Uint8Array | undefined): number[] {
  return [...(werte ?? new Uint8Array())]
}

/** Eine Ablehnung: der Server hat geurteilt, es liegt nicht am Netz (§5). */
function abgelehnt(nachricht: string): Error {
  return Object.assign(new Error(nachricht), { abgelehnt: true as const })
}

/** Ein Server: eine Tabelle, ein Zähler, keine Meinung. */
function serverDoppel() {
  const zeilen: InhaltZeile[] = []
  let zaehler = 0

  /** Was der nächste Schreibvorgang werfen soll, einmalig. */
  let stolperstein: Error | null = null

  /** Solange das an ist, erreicht kein Schreibvorgang den Server. */
  let flugmodus = false

  /** Haelt die naechste `version`-Abfrage an, bis der Test sie entscheidet. */
  let versionSperre: Promise<Error | null> | null = null

  const gesehen = { seit: 0, version: 0 }

  function stolpere() {
    if (flugmodus) {
      throw new Error('Kein Netz.')
    }

    if (stolperstein !== null) {
      const fehler = stolperstein
      stolperstein = null
      throw fehler
    }
  }

  function finde(id: string): InhaltZeile {
    const zeile = zeilen.find((kandidat) => kandidat.id === id)

    if (zeile === undefined) {
      throw abgelehnt(`Kein Item ${id}.`)
    }

    return zeile
  }

  const inhalte: InhalteTabelle = {
    seit(fallId, wasserzeichen) {
      gesehen.seit += 1

      return Promise.resolve(
        zeilen
          .filter((zeile) => zeile.fallId === fallId && zeile.seq > wasserzeichen)
          .sort((links, rechts) => links.seq - rechts.seq)
          .map((zeile) => ({ ...zeile })),
      )
    },

    lege(neu: NeuerInhalt) {
      stolpere()
      zaehler += 1
      zeilen.push({
        ...neu,
        seq: zaehler,
        geloescht: false,
        imTresor: false,
        geaendertAm: new Date(zaehler).toISOString(),
      })
      return Promise.resolve()
    },

    schreibePayload(id, payload) {
      stolpere()
      const zeile = finde(id)
      zaehler += 1
      zeile.payload = payload
      zeile.seq = zaehler
      return Promise.resolve()
    },

    loesche(id) {
      stolpere()
      const zeile = finde(id)
      zaehler += 1
      zeile.geloescht = true
      zeile.payload = bytes()
      zeile.wrappedDek = bytes()
      zeile.seq = zaehler
      return Promise.resolve()
    },
  }

  return {
    inhalte,
    gesehen,
    version(fallId: string) {
      gesehen.version += 1

      // `cases.version` und das höchste `seq` sind dieselbe Zahl (§4).
      const zahl = zeilen.some((zeile) => zeile.fallId === fallId) || zaehler > 0 ? zaehler : 0

      const sperre = versionSperre

      if (sperre === null) {
        return Promise.resolve(zahl)
      }

      versionSperre = null

      return sperre.then((fehler) => {
        if (fehler !== null) {
          throw fehler
        }

        return zahl
      })
    },
    /**
     * Haelt die naechste Runde beim billigen Check an.
     *
     * @returns die Entscheidung: ein Fehler laesst die Runde scheitern, `null`
     * laesst sie weiterlaufen.
     */
    haltVersionAn() {
      let entscheide!: (fehler: Error | null) => void

      versionSperre = new Promise<Error | null>((erfuellen) => {
        entscheide = erfuellen
      })

      return entscheide
    },
    /** Ein anderes Gerät schreibt. */
    fremdeZeile(id: string, payload: Uint8Array) {
      zaehler += 1
      zeilen.push({
        id,
        fallId: FALL,
        seq: zaehler,
        art: 'item',
        geloescht: false,
        imTresor: false,
        kid: 'case_fall-1:1',
        wrappedDek: bytes(0xaa),
        payload,
        geaendertAm: new Date(zaehler).toISOString(),
      })
    },
    lassStolpern(fehler: Error) {
      stolperstein = fehler
    },
    setzeFlugmodus(an: boolean) {
      flugmodus = an
    },
  }
}

let server = serverDoppel()

function anlegen(itemId: string, payload: Uint8Array): Mutation {
  return {
    op: 'anlegen',
    itemId,
    fallId: FALL,
    art: 'item',
    kid: 'case_fall-1:1',
    wrappedDek: bytes(0xaa),
    payload,
    ts: 1,
  }
}

async function loescheDb() {
  await new Promise<void>((erfuellen) => {
    const anfrage = indexedDB.deleteDatabase(CACHE_DB)
    anfrage.onsuccess = () => erfuellen()
    anfrage.onerror = () => erfuellen()
    anfrage.onblocked = () => erfuellen()
  })
}

beforeEach(() => {
  server = serverDoppel()
  laeuten.length = 0
})

afterEach(loescheDb)

describe('useSync', () => {
  it('holt das vollständige Delta, wenn dieses Gerät den Fall noch nie gesehen hat', async () => {
    server.fremdeZeile('item-1', bytes(1, 2, 3))

    const { result } = renderHook(() => useSync(FALL))

    await waitFor(() => expect(result.current.zustand.zeilen).toHaveLength(1))
    expect(result.current.zustand.zeilen[0]).toMatchObject({ id: 'item-1', seq: 1 })
    expect(result.current.zustand.netzfehler).toBeNull()
  })

  it('setzt keinen Item-Abruf ab, wenn die version dem Wasserzeichen gleicht', async () => {
    // Schritt 1 aus §5: ein Integer. Gleich dem Wasserzeichen → kein Fetch.
    server.fremdeZeile('item-1', bytes(1))

    const erste = renderHook(() => useSync(FALL))
    await waitFor(() => expect(erste.result.current.zustand.zeilen).toHaveLength(1))
    erste.unmount()

    const abrufe = server.gesehen.seit

    const zweite = renderHook(() => useSync(FALL))
    await waitFor(() => expect(zweite.result.current.zustand.zeilen).toHaveLength(1))
    await waitFor(() => expect(server.gesehen.version).toBeGreaterThan(1))

    expect(server.gesehen.seit).toBe(abrufe)
  })

  it('zeigt den zuletzt gecachten Stand, auch wenn das Netz nicht antwortet', async () => {
    // §5: „Gecachte Inhalte werden sofort gerendert." Ein Kaltstart im
    // Flugmodus zeigt den Fall, statt ihn für leer zu erklären.
    server.fremdeZeile('item-1', bytes(7))

    const erste = renderHook(() => useSync(FALL))
    await waitFor(() => expect(erste.result.current.zustand.zeilen).toHaveLength(1))
    erste.unmount()

    server.version = () => Promise.reject(new Error('Kein Netz.'))

    const { result } = renderHook(() => useSync(FALL))

    await waitFor(() => expect(result.current.zustand.gecacht).toBe(true))
    expect(result.current.zustand.zeilen).toHaveLength(1)
    await waitFor(() => expect(result.current.zustand.netzfehler).toBe('Kein Netz.'))

    // Die Liste bleibt stehen, während der Fehler danebensteht.
    expect(result.current.zustand.zeilen[0]).toMatchObject({ id: 'item-1' })
  })

  it('zeigt eine angelegte Aufgabe sofort, noch bevor sie hinausgeht', async () => {
    const { result } = renderHook(() => useSync(FALL))
    await waitFor(() => expect(result.current.zustand.gecacht).toBe(true))

    let gibFrei = () => {}
    const angehalten = new Promise<void>((aufloesen) => {
      gibFrei = aufloesen
    })
    const echtesLege = server.inhalte.lege
    server.inhalte.lege = async (neu) => {
      await angehalten
      return echtesLege(neu)
    }

    await act(async () => {
      await result.current.mutiere(anlegen('item-neu', bytes(4, 5)))
    })

    // Noch nichts auf dem Server — und trotzdem steht die Zeile da (§5).
    expect(result.current.zustand.zeilen).toHaveLength(1)
    expect(result.current.zustand.zeilen[0]).toMatchObject({ id: 'item-neu', seq: 0 })

    await act(async () => {
      gibFrei()
      await angehalten
    })

    // Nach der Bestätigung trägt dieselbe Zeile die `seq` des Servers.
    await waitFor(() => expect(result.current.zustand.zeilen[0]?.seq).toBe(1))
  })

  it('meldet eine abgelehnte Mutation, statt sie still zu verwerfen', async () => {
    const { result } = renderHook(() => useSync(FALL))
    await waitFor(() => expect(result.current.zustand.gecacht).toBe(true))

    server.lassStolpern(abgelehnt('Der Fall ist versiegelt.'))

    await act(async () => {
      await result.current.mutiere(anlegen('item-neu', bytes(4)))
    })

    await waitFor(() => expect(result.current.zustand.abgelehnt).toHaveLength(1))
    expect(result.current.zustand.abgelehnt[0]).toMatchObject({
      grund: 'Der Fall ist versiegelt.',
      mutation: { op: 'anlegen', itemId: 'item-neu' },
    })

    // Die Mutation verlässt die Queue, und mit ihr die optimistische Anzeige:
    // Der Server ist die Wahrheit, und ein Eintrag, den es nirgends gibt, darf
    // nicht stehen bleiben.
    await waitFor(() => expect(result.current.zustand.zeilen).toHaveLength(0))

    act(() => result.current.bestaetige())
    expect(result.current.zustand.abgelehnt).toHaveLength(0)
  })

  it('lässt eine Mutation stehen, die den Server nie erreicht hat', async () => {
    // Kein Urteil, nur keine Antwort: Sie geht beim nächsten Versuch erneut
    // hinaus, und bis dahin bleibt sie sichtbar (§5).
    const { result } = renderHook(() => useSync(FALL))
    await waitFor(() => expect(result.current.zustand.gecacht).toBe(true))

    server.lassStolpern(new Error('Kein Netz.'))

    await act(async () => {
      await result.current.mutiere(anlegen('item-neu', bytes(4)))
    })

    await waitFor(() => expect(result.current.zustand.zeilen).toHaveLength(1))
    expect(result.current.zustand.abgelehnt).toHaveLength(0)

    await act(async () => {
      result.current.aktualisiere()
    })

    await waitFor(() => expect(result.current.zustand.zeilen[0]?.seq).toBe(1))
  })

  it('überträgt eine Mutation, die während einer scheiternden Runde angetippt wurde', async () => {
    /*
     * Der Wunsch nach einer weiteren Runde darf mit der gescheiterten nicht
     * untergehen.
     *
     * Wer antippt, während eine Runde läuft, hängt seine Mutation an und
     * vermerkt „gleich nochmal" — mehr kann er nicht tun, denn zwei Runden
     * nebeneinander holten dasselbe Delta zweimal. Bricht die laufende Runde
     * danach ab, muss der Vermerk sie überleben: Sonst wartet die Aufgabe auf
     * ein Ereignis, das nicht kommt. Die Türklingel läutet nur, wenn jemand
     * *anders* schreibt, `online` feuert nicht, wer nie offline war, und das
     * Polling schweigt, solange Realtime steht. Sichtbar wäre sie trotzdem —
     * optimistisch angezeigt, aber auf keinem Server, und genau dieses stille
     * Auseinanderlaufen schliesst §5 aus.
     */
    const { result } = renderHook(() => useSync(FALL))
    await waitFor(() => expect(result.current.zustand.gecacht).toBe(true))
    await waitFor(() => expect(result.current.zustand.laedtNetz).toBe(false))

    // Eine Runde beim billigen Check anhalten …
    const entscheide = server.haltVersionAn()

    act(() => {
      result.current.aktualisiere()
    })

    await waitFor(() => expect(result.current.zustand.laedtNetz).toBe(true))

    // … und währenddessen eine Aufgabe anlegen.
    await act(async () => {
      await result.current.mutiere(anlegen('item-neu', bytes(4)))
    })

    expect(result.current.zustand.zeilen).toHaveLength(1)
    expect(result.current.zustand.zeilen[0]?.seq).toBe(0)

    // Jetzt scheitert die angehaltene Runde.
    await act(async () => {
      entscheide(new Error('Kein Netz.'))
    })

    await waitFor(() => expect(result.current.zustand.netzfehler).not.toBeNull())

    // Ohne Türklingel und ohne `online`: Die Aufgabe geht trotzdem hinaus, und
    // die bestätigte Zeile trägt danach die `seq` des Servers.
    await waitFor(() => expect(result.current.zustand.zeilen[0]?.seq).toBe(1))
    expect(result.current.zustand.netzfehler).toBeNull()
  })

  it('holt nach, was ein anderes Gerät geschrieben hat, sobald es klingelt', async () => {
    const { result } = renderHook(() => useSync(FALL))
    await waitFor(() => expect(result.current.zustand.gecacht).toBe(true))
    await waitFor(() => expect(result.current.zustand.laedtNetz).toBe(false))

    server.fremdeZeile('item-fremd', bytes(9))

    expect(result.current.zustand.zeilen).toHaveLength(0)

    await act(async () => {
      for (const laeute of laeuten) {
        laeute()
      }
    })

    await waitFor(() => expect(result.current.zustand.zeilen).toHaveLength(1))
    expect(result.current.zustand.zeilen[0]).toMatchObject({ id: 'item-fremd' })
  })

  it('arbeitet die Queue beim Reconnect ab', async () => {
    // §5: „beim Reconnect abgearbeitet." Was im Flugmodus angehängt wurde, geht
    // hinaus, sobald das Gerät wieder Netz hat.
    const { result } = renderHook(() => useSync(FALL))
    await waitFor(() => expect(result.current.zustand.gecacht).toBe(true))

    server.setzeFlugmodus(true)

    await act(async () => {
      await result.current.mutiere(anlegen('item-flug', bytes(3)))
    })

    await waitFor(() => expect(result.current.zustand.zeilen[0]?.seq).toBe(0))

    server.setzeFlugmodus(false)

    await act(async () => {
      globalThis.dispatchEvent(new Event('online'))
    })

    await waitFor(() => expect(result.current.zustand.zeilen[0]?.seq).toBe(1))
  })

  it('überträgt beim Reconnect in der Reihenfolge des Anhängens', async () => {
    const { result } = renderHook(() => useSync(FALL))
    await waitFor(() => expect(result.current.zustand.gecacht).toBe(true))

    // Ohne Reihenfolge träfe das Häkchen auf ein Item, das es noch nicht gibt.
    server.setzeFlugmodus(true)

    await act(async () => {
      await result.current.mutiere(anlegen('item-flug', bytes(3)))
      await result.current.mutiere({
        op: 'aendern',
        itemId: 'item-flug',
        payload: bytes(3, 4),
        ts: 2,
      })
    })

    await waitFor(() => expect(result.current.zustand.zeilen[0]?.seq).toBe(0))

    server.setzeFlugmodus(false)

    await act(async () => {
      globalThis.dispatchEvent(new Event('online'))
    })

    await waitFor(() => expect(result.current.zustand.zeilen[0]?.seq).toBe(2))
    expect(alsListe(result.current.zustand.zeilen[0]?.payload)).toEqual([3, 4])
    expect(result.current.zustand.abgelehnt).toHaveLength(0)
  })

  it('legt im Cache ausschliesslich die Bytes des Servers ab', async () => {
    // §5: „byteidentisch zum Server". Der Beweis ist ein zweiter Kaltstart —
    // was er zeigt, kam aus IndexedDB und nirgendwoher sonst.
    server.fremdeZeile('item-1', bytes(0xde, 0xad, 0xbe, 0xef))

    const erste = renderHook(() => useSync(FALL))
    await waitFor(() => expect(erste.result.current.zustand.zeilen).toHaveLength(1))
    erste.unmount()

    server.inhalte.seit = () => Promise.reject(new Error('Kein Netz.'))

    const { result } = renderHook(() => useSync(FALL))

    await waitFor(() => expect(result.current.zustand.zeilen).toHaveLength(1))
    expect(alsListe(result.current.zustand.zeilen[0]?.payload)).toEqual([0xde, 0xad, 0xbe, 0xef])
  })

  it('lässt einen Tombstone den Bestand erreichen, ohne ihn dazwischen zurückzunehmen', async () => {
    /*
     * §5: Jede Mutation wird optimistisch lokal angewandt. Das trägt nur, wenn
     * die Anzeige zwischen „bestätigt" und „Delta da" nicht kurz auf den Stand
     * davor zurückfällt — sonst käme die gerade gelöschte Aufgabe für die Dauer
     * eines Rundlaufs wieder, und zwar ausgerechnet dann, wenn alles geklappt
     * hat.
     */
    server.fremdeZeile('item-1', bytes(1))

    const verlauf: (boolean | undefined)[] = []

    const { result } = renderHook(() => {
      const daten = useSync(FALL)
      verlauf.push(daten.zustand.zeilen[0]?.geloescht)
      return daten
    })

    await waitFor(() => expect(result.current.zustand.zeilen).toHaveLength(1))

    await act(async () => {
      await result.current.mutiere({ op: 'loeschen', itemId: 'item-1', ts: 3 })
    })

    await waitFor(() => expect(result.current.zustand.zeilen[0]?.geloescht).toBe(true))
    expect(alsListe(result.current.zustand.zeilen[0]?.payload)).toEqual([])

    // Ab dem ersten Bild, das den Tombstone zeigt, taucht die Aufgabe nie
    // wieder als vorhanden auf.
    const erstesMal = verlauf.indexOf(true)
    expect(erstesMal).toBeGreaterThanOrEqual(0)
    expect(verlauf.slice(erstesMal)).not.toContain(false)
  })
})
