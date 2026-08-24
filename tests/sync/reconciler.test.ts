import { describe, expect, it } from 'vitest'
import type { InhaltZeile } from '../../src/core/db/inhalte'
import { vereine, wendeAn } from '../../src/core/sync/reconciler'

/**
 * Nahtstelle: die Verrechnung von Delta und Bestand (DESIGN.md §5).
 *
 * Zwei Regeln, beide ohne Client-Uhr:
 *
 *   1. **Last-Write-Wins über die serverseitig vergebene `seq`.** Wer die
 *      höhere Nummer trägt, gewinnt — und zwar auch dann, wenn ein Delta in
 *      falscher Reihenfolge ankommt oder zweimal verarbeitet wird.
 *   2. **Löschen gewinnt endgültig.** Die Datenbank weist ein
 *      `deleted → false` ab (§4); hier steht dieselbe Regel noch einmal,
 *      damit ein Bestand, der einen Tombstone kennt, ihn nicht durch eine
 *      alte Zeile aus dem Cache verliert.
 *
 * Die Ausgabe ist nach `id` sortiert, nicht nach `seq`: `seq` steigt bei jedem
 * Häkchen, und danach sortiert wanderte die gerade abgehakte Aufgabe ans Ende
 * der Liste. Die `id` ist eine UUIDv7 und trägt den Anlagezeitpunkt.
 */

function zeile(id: string, seq: number, ueberschreibung: Partial<InhaltZeile> = {}): InhaltZeile {
  return {
    id,
    fallId: 'fall-1',
    seq,
    art: 'item',
    geloescht: false,
    imTresor: false,
    kid: 'case_fall-1:1',
    wrappedDek: new Uint8Array([0x01]),
    payload: new Uint8Array([seq]),
    geaendertAm: '2026-08-24T10:00:00Z',
    ...ueberschreibung,
  }
}

describe('vereine', () => {
  it('nimmt einen leeren Bestand und macht das Delta daraus', async () => {
    const { zeilen } = vereine([], [zeile('a', 1), zeile('b', 2)])

    expect(zeilen.map((eintrag) => eintrag.id)).toEqual(['a', 'b'])
  })

  it('lässt die höhere seq gewinnen', () => {
    const { zeilen } = vereine([zeile('a', 1)], [zeile('a', 5, { payload: new Uint8Array([9]) })])

    expect(zeilen).toEqual([zeile('a', 5, { payload: new Uint8Array([9]) })])
  })

  it('lässt eine niedrigere seq nicht gewinnen', () => {
    // Ein zweimal verarbeitetes oder verspätet eintreffendes Delta darf den
    // Stand nicht zurückdrehen. Ohne diese Regel bräuchte die Verrechnung eine
    // verlässliche Reihenfolge — die es über zwei Geräte hinweg nicht gibt.
    const { zeilen } = vereine([zeile('a', 5)], [zeile('a', 2)])

    expect(zeilen).toEqual([zeile('a', 5)])
  })

  it('belebt ein gelöschtes Item auch dann nicht wieder, wenn ein Edit höher zählt', () => {
    /*
     * Die Zusage aus §5 in ihrer schärfsten Form. Die Datenbank weist ein
     * `deleted → false` ab, dieses Delta kann es also gar nicht geben — aber
     * ein bösartiger Server ist Teil des Bedrohungsmodells (§11), und eine
     * Regel, die nur an einer Stelle steht, ist keine.
     */
    const { zeilen } = vereine([zeile('a', 3, { geloescht: true })], [zeile('a', 9)])

    expect(zeilen[0]?.geloescht).toBe(true)
    // Die höhere Nummer zählt trotzdem: Sonst holte der nächste Delta-Abruf
    // dieselbe Zeile für immer wieder.
    expect(zeilen[0]?.seq).toBe(9)
  })

  it('trägt einen Tombstone aus dem Delta in den Bestand', () => {
    const { zeilen } = vereine([zeile('a', 1)], [zeile('a', 4, { geloescht: true })])

    expect(zeilen[0]?.geloescht).toBe(true)
  })

  it('sortiert nach id, nicht nach seq', () => {
    // Ein Häkchen an der ersten Aufgabe hebt ihre `seq` über alle anderen.
    // Nach `seq` sortiert stünde sie danach unten, und wer bei zwanzig
    // Aufgaben die erste abhakt, sucht sie anschliessend am Ende der Liste.
    const { zeilen } = vereine([zeile('a', 1), zeile('b', 2)], [zeile('a', 3)])

    expect(zeilen.map((eintrag) => eintrag.id)).toEqual(['a', 'b'])
  })

  it('nennt genau die Zeilen, die sich wirklich geändert haben', () => {
    // §5: „sichtbare Screens aktualisieren sich nur für tatsächlich geänderte
    // Zeilen". Ohne diese Liste entschlüsselte ein Kaltstart bei jeder
    // Türklingel den ganzen Fall neu.
    const { geaendert } = vereine(
      [zeile('a', 1), zeile('b', 2)],
      [zeile('a', 1), zeile('b', 7), zeile('c', 8)],
    )

    expect(geaendert).toEqual(['b', 'c'])
  })

  it('nennt nichts geändert, wenn das Delta leer ist', () => {
    const { geaendert } = vereine([zeile('a', 1)], [])

    expect(geaendert).toEqual([])
  })
})

describe('wendeAn', () => {
  /*
   * §5: „Jede Mutation wird optimistisch lokal angewandt und angehängt."
   *
   * Das „optimistisch" liegt hier und nicht im Cache: Der Cache trägt
   * ausschliesslich, was der Server bestätigt hat, und was noch in der Queue
   * steht, wird bei jedem Rendern darübergelegt. Das ist der Grund, aus dem eine
   * abgelehnte Mutation sich von selbst zurücknimmt — sie verlässt die Queue,
   * und mit ihr verschwindet ihre Wirkung. Läge sie stattdessen im Cache, bliebe
   * ein abgelehntes Edit dort für immer stehen: Der Delta-Sync brächte es nie
   * zurück, weil sich auf dem Server nichts geändert hat.
   */

  it('zeigt eine offline angelegte Aufgabe sofort', async () => {
    const zeilen = wendeAn([], [
      {
        op: 'anlegen',
        itemId: 'neu',
        fallId: 'fall-1',
        art: 'item',
        kid: 'case_fall-1:1',
        wrappedDek: new Uint8Array([0xaa]),
        payload: new Uint8Array([0xbb]),
        ts: 17,
      },
    ])

    expect(zeilen).toHaveLength(1)
    expect(zeilen[0]).toMatchObject({
      id: 'neu',
      fallId: 'fall-1',
      kid: 'case_fall-1:1',
      geloescht: false,
      payload: new Uint8Array([0xbb]),
    })
  })

  it('gibt einer noch nicht übertragenen Zeile die seq 0', () => {
    // `seq` vergibt ausschliesslich der Server (§4). Bis er es getan hat, steht
    // 0 da — niedriger als jedes Delta, also gewinnt die bestätigte Zeile,
    // sobald sie kommt.
    const [zeile] = wendeAn([], [
      {
        op: 'anlegen',
        itemId: 'neu',
        fallId: 'fall-1',
        art: 'item',
        kid: 'case_fall-1:1',
        wrappedDek: new Uint8Array(),
        payload: new Uint8Array(),
        ts: 17,
      },
    ])

    expect(zeile?.seq).toBe(0)
  })

  it('legt ein Edit über die bestätigte Zeile', () => {
    const zeilen = wendeAn(
      [zeile('a', 4)],
      [{ op: 'aendern', itemId: 'a', payload: new Uint8Array([0xee]), ts: 17 }],
    )

    expect(zeilen[0]?.payload).toEqual(new Uint8Array([0xee]))
    // Die bestätigte `seq` bleibt stehen: Sie ist das, was der Server weiss,
    // und das Wasserzeichen rechnet mit ihr.
    expect(zeilen[0]?.seq).toBe(4)
  })

  it('nimmt eine offline gelöschte Aufgabe sofort aus der Liste', () => {
    const [gelöscht] = wendeAn([zeile('a', 4)], [{ op: 'loeschen', itemId: 'a', ts: 17 }])

    expect(gelöscht?.geloescht).toBe(true)
    // Payload und DEK werden geleert, so wie der Server es täte (§5) — sonst
    // stünde der Ciphertext einer gelöschten Aufgabe weiter im Cache.
    expect(gelöscht?.payload).toEqual(new Uint8Array())
    expect(gelöscht?.wrappedDek).toEqual(new Uint8Array())
  })

  it('wendet mehrere Mutationen in Reihenfolge an', () => {
    // Anlegen, ändern, abhaken — alles im Flugmodus, alles auf demselben Item.
    const zeilen = wendeAn(
      [],
      [
        {
          op: 'anlegen',
          itemId: 'neu',
          fallId: 'fall-1',
          art: 'item',
          kid: 'case_fall-1:1',
          wrappedDek: new Uint8Array([0xaa]),
          payload: new Uint8Array([0x01]),
          ts: 1,
        },
        { op: 'aendern', itemId: 'neu', payload: new Uint8Array([0x02]), ts: 2 },
      ],
    )

    expect(zeilen[0]?.payload).toEqual(new Uint8Array([0x02]))
  })

  it('lässt ein Edit auf eine unbekannte Zeile fallen', () => {
    // Kein Anlegen dazu, keine bestätigte Zeile: Es gibt nichts, worüber sich
    // etwas legen liesse. Eine erfundene Zeile wäre schlimmer — sie erschiene
    // als Aufgabe ohne Inhalt.
    expect(wendeAn([], [{ op: 'aendern', itemId: 'weg', payload: new Uint8Array(), ts: 1 }])).toEqual(
      [],
    )
  })

  it('lässt den Bestand unangetastet, wenn nichts wartet', () => {
    expect(wendeAn([zeile('a', 1)], [])).toEqual([zeile('a', 1)])
  })
})
