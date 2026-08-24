import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CACHE_DB } from '../../src/core/db/idb'
import type { InhalteTabelle, NeuerInhalt } from '../../src/core/db/inhalte'
import { arbeiteAb, idbWarteschlange, type Mutation } from '../../src/core/sync/queue'

/**
 * Nahtstelle: die Offline-Queue und ihr Replay (DESIGN.md §5, §10).
 *
 * §5: „Jede Mutation wird optimistisch lokal angewandt und angehängt
 * (`{op, itemId, payload, ts}`), beim Reconnect abgearbeitet." Und: „Abgelehnte
 * Mutationen werden nie stillschweigend verworfen."
 *
 * Daraus folgen drei Zusagen, die dieser Test einzeln festhält:
 *
 *   1. **Reihenfolge.** Was zuerst angehängt wurde, geht zuerst hinaus.
 *   2. **Ein Urteil beendet die Mutation.** Der Server hat Nein gesagt: aus der
 *      Queue heraus, als Mitteilung zurück — aber der Rest läuft weiter.
 *   3. **Ein Netzproblem beendet gar nichts.** Die Mutation bleibt stehen, und
 *      mit ihr alles dahinter: Sonst käme ein Häkchen vor der Aufgabe an, an
 *      der es hängt.
 */

const ANLEGEN: Mutation = {
  op: 'anlegen',
  itemId: 'item-1',
  fallId: 'fall-1',
  art: 'item',
  kid: 'case_fall-1:1',
  wrappedDek: new Uint8Array([0xaa]),
  payload: new Uint8Array([0x01]),
  ts: 1_700_000_000_000,
}

const AENDERN: Mutation = {
  op: 'aendern',
  itemId: 'item-1',
  payload: new Uint8Array([0x02]),
  ts: 1_700_000_000_001,
}

const LOESCHEN: Mutation = {
  op: 'loeschen',
  itemId: 'item-1',
  ts: 1_700_000_000_002,
}

/** Ein Fehlschlag, über den der Server geurteilt hat (§5). */
function urteil(nachricht: string): Error {
  return Object.assign(new Error(nachricht), { abgelehnt: true })
}

/** Ein Fehlschlag, der den Server nie erreicht hat. */
function netzproblem(): Error {
  return Object.assign(new Error('TypeError: Failed to fetch'), { abgelehnt: false })
}

function inhalteDoppel(ueberschreibung: Partial<InhalteTabelle> = {}): {
  inhalte: InhalteTabelle
  gesehen: string[]
} {
  const gesehen: string[] = []

  const inhalte: InhalteTabelle = {
    seit: vi.fn().mockResolvedValue([]),
    lege: vi.fn((neu: NeuerInhalt) => {
      gesehen.push(`lege ${neu.id}`)
      return Promise.resolve()
    }),
    schreibePayload: vi.fn((id: string) => {
      gesehen.push(`schreibe ${id}`)
      return Promise.resolve()
    }),
    loesche: vi.fn((id: string) => {
      gesehen.push(`loesche ${id}`)
      return Promise.resolve()
    }),
    ...ueberschreibung,
  }

  return { inhalte, gesehen }
}

beforeEach(async () => {
  await leereDatenbank()
})

afterEach(async () => {
  await leereDatenbank()
})

function leereDatenbank(): Promise<void> {
  return new Promise((erfuellen) => {
    const anfrage = indexedDB.deleteDatabase(CACHE_DB)
    anfrage.onsuccess = () => erfuellen()
    anfrage.onerror = () => erfuellen()
    anfrage.onblocked = () => erfuellen()
  })
}

describe('Warteschlange', () => {
  it('gibt die Mutationen in der Reihenfolge des Anhängens zurück', async () => {
    const warteschlange = idbWarteschlange()

    await warteschlange.haengeAn(ANLEGEN)
    await warteschlange.haengeAn(AENDERN)
    await warteschlange.haengeAn(LOESCHEN)

    expect((await warteschlange.offen()).map((eintrag) => eintrag.mutation.op)).toEqual([
      'anlegen',
      'aendern',
      'loeschen',
    ])
  })

  it('überdauert einen Kaltstart', async () => {
    // Der Fall aus §5: im Flugmodus angelegt, App geschlossen, später wieder
    // geöffnet. Läge die Queue im Speicher, wäre die Aufgabe weg.
    await idbWarteschlange().haengeAn(ANLEGEN)

    expect(await idbWarteschlange().offen()).toHaveLength(1)
  })

  it('legt die Bytes ab, wie sie kamen', async () => {
    // Die Mutation trägt Ciphertext. Sie liegt neben dem Cache und untersteht
    // derselben Zusage aus §5 — verschlüsselt wird vor dem Anhängen.
    const warteschlange = idbWarteschlange()
    await warteschlange.haengeAn(ANLEGEN)

    expect((await warteschlange.offen())[0]?.mutation).toEqual(ANLEGEN)
  })

  it('entfernt genau einen Eintrag', async () => {
    const warteschlange = idbWarteschlange()
    await warteschlange.haengeAn(ANLEGEN)
    await warteschlange.haengeAn(AENDERN)

    const [erster] = await warteschlange.offen()
    await warteschlange.entferne(erster!.schluessel)

    expect((await warteschlange.offen()).map((eintrag) => eintrag.mutation.op)).toEqual(['aendern'])
  })
})

describe('arbeiteAb', () => {
  it('überträgt in Reihenfolge und leert die Queue', async () => {
    const warteschlange = idbWarteschlange()
    await warteschlange.haengeAn(ANLEGEN)
    await warteschlange.haengeAn(AENDERN)
    await warteschlange.haengeAn(LOESCHEN)

    const { inhalte, gesehen } = inhalteDoppel()
    const ergebnis = await arbeiteAb(warteschlange, inhalte)

    expect(gesehen).toEqual(['lege item-1', 'schreibe item-1', 'loesche item-1'])
    expect(ergebnis).toEqual({ uebertragen: 3, abgelehnt: [], offen: 0 })
    expect(await warteschlange.offen()).toEqual([])
  })

  it('schickt beim Anlegen genau die Spalten mit, die der Client vergibt', async () => {
    const warteschlange = idbWarteschlange()
    await warteschlange.haengeAn(ANLEGEN)

    const lege = vi.fn().mockResolvedValue(undefined)
    const { inhalte } = inhalteDoppel({ lege })

    await arbeiteAb(warteschlange, inhalte)

    expect(lege).toHaveBeenCalledWith({
      id: 'item-1',
      fallId: 'fall-1',
      art: 'item',
      kid: 'case_fall-1:1',
      wrappedDek: new Uint8Array([0xaa]),
      payload: new Uint8Array([0x01]),
    })
  })

  it('nimmt eine abgelehnte Mutation aus der Queue und meldet sie', async () => {
    /*
     * Der Testfall aus §10: „Ein Offline-Queue-Replay-Test inklusive
     * abgelehnter Mutation." Der Server hat geurteilt — wiederholen brächte
     * dasselbe Ergebnis, also verlässt die Mutation die Queue. Aber sie
     * verschwindet nicht: §5 verlangt, dass sie mit ihrem Inhalt als Mitteilung
     * erscheint, und dafür kommt sie hier vollständig zurück.
     */
    const warteschlange = idbWarteschlange()
    await warteschlange.haengeAn(ANLEGEN)
    await warteschlange.haengeAn(AENDERN)

    const { inhalte } = inhalteDoppel({
      lege: vi.fn().mockRejectedValue(urteil('Ein geloeschtes Item kann nicht wiederbelebt werden.')),
    })

    const ergebnis = await arbeiteAb(warteschlange, inhalte)

    expect(ergebnis.abgelehnt).toEqual([
      { mutation: ANLEGEN, grund: 'Ein geloeschtes Item kann nicht wiederbelebt werden.' },
    ])
    // Der Rest läuft weiter: Ein Urteil über eine Mutation ist kein Urteil
    // über die nächste.
    expect(ergebnis.uebertragen).toBe(1)
    expect(await warteschlange.offen()).toEqual([])
  })

  it('lässt bei einem Netzproblem alles stehen, auch das Dahinterliegende', async () => {
    /*
     * Die Reihenfolge ist die halbe Zusage. Liefe die Queue nach einem
     * gescheiterten `lege` einfach weiter, träfe das `schreibePayload` auf ein
     * Item, das es auf dem Server nicht gibt — der Server lehnte ab, und eine
     * Aufgabe, die nur wegen einer schlechten Verbindung noch nicht da war,
     * käme als „konnte nicht gespeichert werden" zurück.
     */
    const warteschlange = idbWarteschlange()
    await warteschlange.haengeAn(ANLEGEN)
    await warteschlange.haengeAn(AENDERN)

    const schreibePayload = vi.fn().mockResolvedValue(undefined)
    const { inhalte } = inhalteDoppel({
      lege: vi.fn().mockRejectedValue(netzproblem()),
      schreibePayload,
    })

    const ergebnis = await arbeiteAb(warteschlange, inhalte)

    expect(ergebnis).toEqual({ uebertragen: 0, abgelehnt: [], offen: 2 })
    expect(schreibePayload).not.toHaveBeenCalled()
    expect(await warteschlange.offen()).toHaveLength(2)
  })

  it('behandelt einen Fehler ohne Urteilsangabe als Netzproblem', async () => {
    // Im Zweifel bleibt eine Mutation lieber stehen, als still zu verschwinden.
    const warteschlange = idbWarteschlange()
    await warteschlange.haengeAn(ANLEGEN)

    const { inhalte } = inhalteDoppel({ lege: vi.fn().mockRejectedValue(new Error('irgendwas')) })

    expect(await arbeiteAb(warteschlange, inhalte)).toEqual({
      uebertragen: 0,
      abgelehnt: [],
      offen: 1,
    })
  })

  it('kommt mit einer leeren Queue klar', async () => {
    const { inhalte, gesehen } = inhalteDoppel()

    expect(await arbeiteAb(idbWarteschlange(), inhalte)).toEqual({
      uebertragen: 0,
      abgelehnt: [],
      offen: 0,
    })
    expect(gesehen).toEqual([])
  })
})
