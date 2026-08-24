import { describe, expect, it } from 'vitest'
import { alsBytea } from '../../src/core/db/bytea'
import { InhalteFehler, supabaseInhalte } from '../../src/core/db/supabaseInhalte'
import { alsHex, fehler, stubClient } from './supabaseAdapter'

/**
 * `items` über Supabase (DESIGN.md §4).
 *
 * Hier geht es um die Übersetzung zwischen PostgREST-Antwort und Port: welche
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

describe('legeAlleNeuen', () => {
  const NEU = {
    id: 'item-1',
    fallId: 'fall-1',
    art: 'item' as const,
    kid: 'case_fall-1:1',
    wrappedDek: new Uint8Array([0x01]),
    payload: new Uint8Array([0x02]),
  }

  it('schickt ein einziges Statement mit on conflict do nothing (§8)', async () => {
    /*
     * `ignoreDuplicates` ist PostgRESTs `Prefer: resolution=ignore-duplicates`.
     * Ohne das wäre die zweite von zwei gleichzeitigen Instanziierungen ein
     * Fehler statt eines Nulleffekts und mit `ignoreDuplicates: false` ein
     * Upsert, der die womöglich längst geänderte Zeile überschriebe.
     */
    const { client, gesehen } = stubClient({ data: null, error: null })

    await supabaseInhalte(client).legeAlleNeuen([NEU, { ...NEU, id: 'item-2' }])

    expect(gesehen.tabelle).toBe('items')
    expect(gesehen.hochgeladen?.optionen).toEqual({ ignoreDuplicates: true })
    expect(gesehen.hochgeladen?.werte).toEqual([
      {
        id: 'item-1',
        case_id: 'fall-1',
        kind: 'item',
        kid: 'case_fall-1:1',
        wrapped_dek: alsBytea(new Uint8Array([0x01])),
        payload: alsBytea(new Uint8Array([0x02])),
      },
      {
        id: 'item-2',
        case_id: 'fall-1',
        kind: 'item',
        kid: 'case_fall-1:1',
        wrapped_dek: alsBytea(new Uint8Array([0x01])),
        payload: alsBytea(new Uint8Array([0x02])),
      },
    ])
  })

  it('setzt weder seq noch updated_at — beides gehört dem Trigger (§4)', async () => {
    const { client, gesehen } = stubClient({ data: null, error: null })

    await supabaseInhalte(client).legeAlleNeuen([NEU])

    const [zeile] = gesehen.hochgeladen?.werte as Record<string, unknown>[]

    expect(Object.keys(zeile ?? {})).not.toContain('seq')
    expect(Object.keys(zeile ?? {})).not.toContain('updated_at')
  })

  it('fasst den Server gar nicht erst an, wenn nichts fehlt', async () => {
    // Der Normalfall nach dem ersten Mal: Der Katalog steht längst.
    const { client, gesehen } = stubClient({ data: null, error: null })

    await supabaseInhalte(client).legeAlleNeuen([])

    expect(gesehen.tabelle).toBeUndefined()
  })

  it('macht aus einem Urteil des Servers einen abgelehnten Fehlschlag', async () => {
    const { client } = stubClient({ data: null, error: fehler('nope', '42501') })

    await expect(supabaseInhalte(client).legeAlleNeuen([NEU])).rejects.toMatchObject({
      name: 'InhalteFehler',
      abgelehnt: true,
    })
  })
})

describe('seit', () => {
  it('holt das Delta eines Falls in seq-Reihenfolge', async () => {
    // §5: `select * from items where case_id = ? and seq > watermark`. Sortiert
    // über `seq` und nicht über die `id`: Das Wasserzeichen wandert am Ende des
    // Deltas auf dessen höchste Nummer, und das trägt nur, wenn die Zeilen in
    // eben dieser Reihenfolge ankommen. Die Anzeigereihenfolge über die `id`
    // stellt der Reconciler her.
    const { client, gesehen } = stubClient({ data: [ZEILE], error: null })

    const zeilen = await supabaseInhalte(client).seit('fall-1', 2)

    expect(gesehen.tabelle).toBe('items')
    expect(gesehen.filter).toEqual({ case_id: 'fall-1' })
    expect(gesehen.groesserAls).toEqual({ seq: 2 })
    expect(gesehen.sortierung).toEqual({ spalte: 'seq', optionen: { ascending: true } })
    expect(zeilen).toEqual([ERWARTET])
  })

  it('holt bei Wasserzeichen 0 den vollständigen Stand', async () => {
    // §5: "Vollständige Resynchronisation ist `seq > 0`." Kein eigener Weg,
    // derselbe Weg mit 0.
    const { client, gesehen } = stubClient({ data: [ZEILE], error: null })

    await supabaseInhalte(client).seit('fall-1', 0)

    expect(gesehen.groesserAls).toEqual({ seq: 0 })
  })

  it('liest seq auch als Zahl, wenn PostgREST eine schickt', async () => {
    const { client } = stubClient({ data: [{ ...ZEILE, seq: 3 }], error: null })

    const [zeile] = await supabaseInhalte(client).seit('fall-1', 0)

    expect(zeile?.seq).toBe(3)
  })

  it('macht aus einem PostgREST-Fehler einen InhalteFehler', async () => {
    const { client } = stubClient({ data: null, error: fehler('permission denied') })

    await expect(supabaseInhalte(client).seit('fall-1', 0)).rejects.toThrow(
      /Die Aufgaben konnten nicht abgerufen werden: permission denied/,
    )
  })
})

const NEUES_ITEM = {
  id: 'item-2',
  fallId: 'fall-1',
  art: 'item' as const,
  kid: 'case_fall-1:1',
  wrappedDek: new Uint8Array([0x05]),
  payload: new Uint8Array([0x06]),
}

describe('lege', () => {
  const NEU = NEUES_ITEM

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
      in_vault: false,
      // Ausdrücklich `null` und nicht weggelassen: Bei einer Aufgabe *muss*
      // die Spalte leer bleiben (§7, CHECK auf `items`).
      storage_path: null,
    })
  })

  it('schreibt den Pfad, sobald es ein Dokument ist (§7)', async () => {
    const { client, gesehen } = stubClient({ data: null, error: null })

    await supabaseInhalte(client).lege({
      ...NEU,
      art: 'file',
      storagePfad: 'fall-1/item-2',
    })

    expect(gesehen.eingefuegt).toMatchObject({
      kind: 'file',
      storage_path: 'fall-1/item-2',
    })
  })

  it('macht aus einem PostgREST-Fehler einen InhalteFehler', async () => {
    const { client } = stubClient({ data: null, error: fehler('new row violates row-level security') })

    await expect(supabaseInhalte(client).lege(NEU)).rejects.toThrow(
      /Die Aufgabe konnte nicht angelegt werden/,
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
    // heißt "nicht gespeichert", und beides muss so ankommen.
    const { client } = stubClient({ data: null, error: fehler('deadlock detected', '40P01') })

    await expect(
      supabaseInhalte(client).schreibePayload('item-1', new Uint8Array([0x07])),
    ).rejects.toThrow(/Die Aufgabe konnte nicht geändert werden: deadlock detected/)
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
      /konnte nicht gelöscht werden/,
    )
  })
})

describe('abgelehnt oder nur nicht angekommen', () => {
  /*
   * Die Unterscheidung, an der die Offline-Queue hängt (§5).
   *
   * Eine Mutation, die der Server abgelehnt hat, gehört aus der Queue heraus
   * und als Mitteilung auf den Bildschirm. Ein zweiter Versuch änderte nichts.
   * Eine Mutation, die den Server nie erreicht hat, gehört in der Queue stehen
   * und beim nächsten Reconnect erneut abgeschickt. Von außen sehen beide gleich
   * aus: ein abgelehntes Versprechen. Wer den Unterschied kennt, ist der
   * Adapter, denn nur er weiss, ob überhaupt jemand geantwortet hat.
   *
   * `supabase-js` verpackt auch einen Netzwerkabbruch als `PostgrestError`,
   * dann allerdings ohne SQLSTATE. Der leere `code` ist das Erkennungszeichen.
   */

  it('nennt eine von der RLS abgewiesene Änderung abgelehnt', async () => {
    const { client } = stubClient({
      data: null,
      error: fehler('new row violates row-level security policy', '42501'),
    })

    await expect(supabaseInhalte(client).lege(NEUES_ITEM)).rejects.toMatchObject({
      name: 'InhalteFehler',
      abgelehnt: true,
    })
  })

  it('nennt eine abgewiesene Auferstehung abgelehnt', async () => {
    // §4: `items_forbid_undelete` wirft mit SQLSTATE 23514. Ein Wiederholen
    // brächte dasselbe Ergebnis: Löschen gewinnt endgültig.
    const { client } = stubClient({
      data: null,
      error: fehler('Ein geloeschtes Item kann nicht wiederbelebt werden.', '23514'),
    })

    await expect(
      supabaseInhalte(client).schreibePayload('item-1', new Uint8Array([1])),
    ).rejects.toMatchObject({ abgelehnt: true })
  })

  it('nennt eine weggefilterte Zeile abgelehnt', async () => {
    // Null geänderte Zeilen ohne Fehler: Die RLS hat die Zeile nicht
    // hergegeben, oder es gibt sie nicht mehr. Beides bleibt beim zweiten
    // Versuch so.
    const { client } = stubClient({ data: [], error: null })

    await expect(supabaseInhalte(client).loesche('item-1')).rejects.toMatchObject({
      abgelehnt: true,
    })
  })

  it('nennt einen Netzwerkabbruch nicht abgelehnt', async () => {
    const { client } = stubClient({ data: null, error: fehler('TypeError: Failed to fetch', '') })

    await expect(supabaseInhalte(client).lege(NEUES_ITEM)).rejects.toMatchObject({
      abgelehnt: false,
    })
  })

  it('nennt einen Fehlschlag beim Abrufen nicht abgelehnt', async () => {
    // Abrufen ist keine Mutation und landet nie in der Queue. Trotzdem darf ein
    // Lesefehler nicht als "abgelehnt" durchgehen: Er beendete sonst eine
    // Wiederholung, die es gar nicht gibt.
    const { client } = stubClient({ data: null, error: fehler('permission denied', '42501') })

    await expect(supabaseInhalte(client).seit('fall-1', 0)).rejects.toMatchObject({
      abgelehnt: false,
    })
  })
})

describe('rotiereItem', () => {
  it('aktualisiert kid und wrapped_dek', async () => {
    const { client, gesehen } = stubClient({ data: [{ id: 'item-1' }], error: null })

    await supabaseInhalte(client).rotiereItem(
      'item-1',
      'case_fall-1:2',
      new Uint8Array([0xaa, 0xbb]),
    )

    expect(gesehen.tabelle).toBe('items')
    expect(gesehen.filter).toEqual({ id: 'item-1' })
    expect(gesehen.aktualisiert).toEqual({
      kid: 'case_fall-1:2',
      wrapped_dek: alsBytea(new Uint8Array([0xaa, 0xbb])),
    })
  })
})

