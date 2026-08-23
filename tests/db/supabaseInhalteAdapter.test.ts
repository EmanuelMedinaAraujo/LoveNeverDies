import { describe, expect, it } from 'vitest'
import { alsBytea } from '../../src/core/db/bytea'
import { InhalteFehler, supabaseInhalte } from '../../src/core/db/supabaseInhalte'
import { alsHex, fehler, stubClient } from './supabaseAdapter'

/**
 * `items` über Supabase (DESIGN.md §4).
 *
 * Hier geht es um die Übersetzung zwischen PostgREST-Antwort und Port — welche
 * Spalten der Adapter verlangt, was er aus `bytea` macht und was aus einem
 * Fehler wird. Ob die Tabelle selbst tut, was §4 von ihr behauptet, steht
 * daneben in `inhalte.test.ts` gegen echtes Postgres.
 */

const ZEILE = {
  id: 'item-1',
  case_id: 'fall-1',
  seq: '3',
  kind: 'item' as const,
  deleted: false,
  in_vault: false,
  kid: 'case_fall-1:1',
  wrapped_dek: alsHex([0x01, 0x02]),
  payload: alsHex([0x03, 0x04]),
  updated_at: '2026-08-23T10:00:00Z',
}

const ERWARTET = {
  id: 'item-1',
  fallId: 'fall-1',
  seq: 3,
  art: 'item',
  geloescht: false,
  imTresor: false,
  kid: 'case_fall-1:1',
  wrappedDek: new Uint8Array([0x01, 0x02]),
  payload: new Uint8Array([0x03, 0x04]),
  geaendertAm: '2026-08-23T10:00:00Z',
}

describe('imFall', () => {
  it('holt die Zeilen eines Falls in Anlagereihenfolge', async () => {
    // Über die `id` und nicht über `seq`: `seq` steigt bei jedem Häkchen (§4),
    // und danach sortiert wanderte die gerade abgehakte Aufgabe ans Ende.
    const { client, gesehen } = stubClient({ data: [ZEILE], error: null })

    const zeilen = await supabaseInhalte(client).imFall('fall-1')

    expect(gesehen.tabelle).toBe('items')
    expect(gesehen.filter).toEqual({ case_id: 'fall-1' })
    expect(gesehen.sortierung).toEqual({ spalte: 'id', optionen: { ascending: true } })
    expect(zeilen).toEqual([ERWARTET])
  })

  it('liest seq auch als Zahl, wenn PostgREST eine schickt', async () => {
    const { client } = stubClient({ data: [{ ...ZEILE, seq: 3 }], error: null })

    const [zeile] = await supabaseInhalte(client).imFall('fall-1')

    expect(zeile?.seq).toBe(3)
  })

  it('macht aus einem PostgREST-Fehler einen InhalteFehler', async () => {
    const { client } = stubClient({ data: null, error: fehler('permission denied') })

    await expect(supabaseInhalte(client).imFall('fall-1')).rejects.toThrow(
      /Die Aufgaben waren nicht abzurufen: permission denied/,
    )
  })
})

describe('lege', () => {
  const NEU = {
    id: 'item-2',
    fallId: 'fall-1',
    art: 'item' as const,
    kid: 'case_fall-1:1',
    wrappedDek: new Uint8Array([0x05]),
    payload: new Uint8Array([0x06]),
  }

  it('schreibt genau die Spalten, die der Client vergibt', async () => {
    // `seq` und `updated_at` stehen bewusst nicht dabei: Beides setzt der
    // Trigger aus §4, und ein Client, der sie mitschickte, behauptete eine
    // Zuständigkeit, die er nicht hat.
    const { client, gesehen } = stubClient({ data: null, error: null })

    await supabaseInhalte(client).lege(NEU)

    expect(gesehen.eingefuegt).toEqual({
      id: 'item-2',
      case_id: 'fall-1',
      kind: 'item',
      kid: 'case_fall-1:1',
      wrapped_dek: alsBytea(new Uint8Array([0x05])),
      payload: alsBytea(new Uint8Array([0x06])),
    })
  })

  it('macht aus einem PostgREST-Fehler einen InhalteFehler', async () => {
    const { client } = stubClient({ data: null, error: fehler('new row violates row-level security') })

    await expect(supabaseInhalte(client).lege(NEU)).rejects.toThrow(
      /Die Aufgabe war nicht anzulegen/,
    )
  })
})

describe('schreibePayload', () => {
  it('ändert genau den Payload der einen Zeile', async () => {
    const { client, gesehen } = stubClient({ data: [{ id: 'item-1' }], error: null })

    await supabaseInhalte(client).schreibePayload('item-1', new Uint8Array([0x07]))

    expect(gesehen.filter).toEqual({ id: 'item-1' })
    expect(gesehen.aktualisiert).toEqual({ payload: alsBytea(new Uint8Array([0x07])) })
  })

  it('meldet einen Fehler, wenn die RLS die Zeile wegfiltert', async () => {
    // PostgREST hält ein UPDATE auf null Zeilen nicht für einen Fehler. Ohne
    // die zurückgegebenen Zeilen meldete der Adapter Erfolg, und der neue Titel
    // verschwände beim nächsten Laden wortlos wieder.
    const { client } = stubClient({ data: [], error: null })

    await expect(
      supabaseInhalte(client).schreibePayload('item-1', new Uint8Array([0x07])),
    ).rejects.toThrow(InhalteFehler)
  })

  it('macht aus einem PostgREST-Fehler einen InhalteFehler', async () => {
    // Der andere Fall: nicht null Zeilen, sondern gar keine Antwort. Beides
    // heißt „nicht gespeichert", und beides muss so ankommen.
    const { client } = stubClient({ data: null, error: fehler('deadlock detected', '40P01') })

    await expect(
      supabaseInhalte(client).schreibePayload('item-1', new Uint8Array([0x07])),
    ).rejects.toThrow(/Die Aufgabe war nicht zu ändern: deadlock detected/)
  })
})

describe('loesche', () => {
  it('setzt den Tombstone und leert Payload und DEK', async () => {
    // §5: Tombstones werden nie garbage-collected. Bliebe der Ciphertext
    // stehen, läge eine gelöschte Aufgabe für immer auf dem Server.
    const { client, gesehen } = stubClient({ data: [{ id: 'item-1' }], error: null })

    await supabaseInhalte(client).loesche('item-1')

    expect(gesehen.aktualisiert).toEqual({
      deleted: true,
      payload: '\\x',
      wrapped_dek: '\\x',
    })
  })

  it('meldet einen Fehler, wenn die RLS die Zeile wegfiltert', async () => {
    const { client } = stubClient({ data: [], error: null })

    await expect(supabaseInhalte(client).loesche('item-1')).rejects.toThrow(
      /nicht zu löschen/,
    )
  })
})
