/**
 * Die Offline-Queue (DESIGN.md §5).
 *
 * §5: „Offline-Queue in IndexedDB: Jede Mutation wird optimistisch lokal
 * angewandt und angehängt (`{op, itemId, payload, ts}`), beim Reconnect
 * abgearbeitet. Item-IDs sind clientseitig erzeugte UUIDv7, damit Anlegen
 * offline funktioniert."
 *
 * **Warum jede Mutation hier durchgeht und nicht nur die im Flugmodus.** Ein
 * zweiter, direkter Schreibweg für den Onlinefall wäre ein zweites Verhalten
 * für dieselbe Handlung — mit eigener Reihenfolge, eigener Fehlerbehandlung und
 * der Frage, was passiert, wenn die Verbindung mitten im Tippen abbricht. Es
 * gibt einen Weg: anhängen, dann abarbeiten. Steht das Netz, dauert das einen
 * Rundlauf; steht es nicht, dauert es bis zum Reconnect.
 *
 * **Was nicht hineingeht** (§5): Tresorfreigabe und `open_vault` — eine
 * versehentlich abgeschickte Todesbestätigung nimmt niemand zurück — und
 * Dokument-Uploads. Beides kommt in eigenen Slices.
 */

import { istAbgelehnt, type Inhaltsart, type InhalteTabelle } from '../db/inhalte'
import { alsVersprechenAusStore, inTransaktion, QUEUE } from '../db/idb'

/**
 * Eine angehängte Mutation.
 *
 * Die Form aus §5 — `{op, itemId, payload, ts}` — mit den Spalten, ohne die ein
 * INSERT nicht auskommt: Ein Item, das der Server noch nie gesehen hat, muss
 * seinen Fall, seine Art und sein `kid` mitbringen, und den DEK, unter dem sein
 * Payload liegt. Ein Edit braucht das alles nicht: Der DEK ändert sich nie
 * (§3.1), und deshalb kostet ein Edit genau eine Spalte.
 *
 * Alle Byte-Felder sind Ciphertext. Verschlüsselt wird vor dem Anhängen — die
 * Queue liegt neben dem Cache und untersteht derselben Zusage aus §5.
 */
export type Mutation =
  | {
      op: 'anlegen'
      itemId: string
      fallId: string
      art: Inhaltsart
      kid: string
      wrappedDek: Uint8Array
      payload: Uint8Array
      ts: number
    }
  | { op: 'aendern'; itemId: string; payload: Uint8Array; ts: number }
  | { op: 'loeschen'; itemId: string; ts: number }

export type WartendeMutation = {
  /** Der `autoIncrement`-Schlüssel: zugleich die Reihenfolge des Anhängens. */
  schluessel: IDBValidKey
  mutation: Mutation
}

export type Warteschlange = {
  haengeAn(mutation: Mutation): Promise<void>
  /** Alles, was noch offen ist, in der Reihenfolge des Anhängens. */
  offen(): Promise<WartendeMutation[]>
  entferne(schluessel: IDBValidKey): Promise<void>
}

export function idbWarteschlange(): Warteschlange {
  return {
    haengeAn(mutation) {
      return inTransaktion(
        [QUEUE],
        'readwrite',
        'Die Änderung war nicht zwischenzuspeichern.',
        (transaktion) => {
          transaktion.objectStore(QUEUE).add(mutation)
        },
      )
    },

    offen() {
      return inTransaktion(
        [QUEUE],
        'readonly',
        'Die offenen Änderungen waren nicht zu lesen.',
        async (transaktion) => {
          const store = transaktion.objectStore(QUEUE)

          // Schlüssel und Werte getrennt: `getAll` liefert die Mutationen,
          // `getAllKeys` die Schlüssel, und beide in derselben Reihenfolge —
          // der des `autoIncrement`, also der des Anhängens.
          const [mutationen, schluessel] = await Promise.all([
            alsVersprechenAusStore(store.getAll()) as Promise<Mutation[]>,
            alsVersprechenAusStore(store.getAllKeys()),
          ])

          return mutationen.map((mutation, stelle) => ({
            schluessel: schluessel[stelle] as IDBValidKey,
            mutation,
          }))
        },
      )
    },

    entferne(schluessel) {
      return inTransaktion(
        [QUEUE],
        'readwrite',
        'Die übertragene Änderung war nicht auszutragen.',
        (transaktion) => {
          transaktion.objectStore(QUEUE).delete(schluessel)
        },
      )
    },
  }
}

/** Eine Mutation, über die der Server geurteilt hat (§5). */
export type AbgelehnteMutation = {
  mutation: Mutation
  /** Was der Server gesagt hat. Für die Mitteilung, nicht für die Logik. */
  grund: string
}

export type Abarbeitung = {
  uebertragen: number
  /**
   * Was der Server verworfen hat. Der Aufrufer entschlüsselt den Payload und
   * zeigt ihn an — §5 verlangt, dass eine abgelehnte Änderung nie
   * stillschweigend verschwindet.
   */
  abgelehnt: AbgelehnteMutation[]
  /** Was noch in der Queue steht: alles, wozu der Server nichts gesagt hat. */
  offen: number
}

function fuehreAus(inhalte: InhalteTabelle, mutation: Mutation): Promise<void> {
  switch (mutation.op) {
    case 'anlegen':
      return inhalte.lege({
        id: mutation.itemId,
        fallId: mutation.fallId,
        art: mutation.art,
        kid: mutation.kid,
        wrappedDek: mutation.wrappedDek,
        payload: mutation.payload,
      })

    case 'aendern':
      return inhalte.schreibePayload(mutation.itemId, mutation.payload)

    case 'loeschen':
      return inhalte.loesche(mutation.itemId)
  }
}

/**
 * Arbeitet die Queue ab — der Reconnect aus §5.
 *
 * Strikt in Reihenfolge und beim ersten Netzproblem strikt zu Ende. Liefe die
 * Queue nach einem gescheiterten `lege` weiter, träfe das nächste
 * `schreibePayload` auf ein Item, das es auf dem Server nicht gibt: Der Server
 * lehnte ab, und eine Aufgabe, die nur wegen einer schlechten Verbindung noch
 * nicht angekommen war, erschiene als „konnte nicht gespeichert werden".
 *
 * Ein **Urteil** des Servers beendet dagegen nur diese eine Mutation. Sie
 * verlässt die Queue, weil ein zweiter Versuch dasselbe Ergebnis brächte, und
 * kommt als {@link AbgelehnteMutation} zurück.
 */
export async function arbeiteAb(
  warteschlange: Warteschlange,
  inhalte: InhalteTabelle,
): Promise<Abarbeitung> {
  const wartend = await warteschlange.offen()

  let uebertragen = 0
  const abgelehnt: AbgelehnteMutation[] = []

  for (const [stelle, eintrag] of wartend.entries()) {
    try {
      await fuehreAus(inhalte, eintrag.mutation)
      uebertragen += 1
    } catch (fehler) {
      if (!istAbgelehnt(fehler)) {
        // Kein Urteil, nur keine Antwort. Diese Mutation und alles dahinter
        // bleiben stehen und gehen beim nächsten Versuch erneut hinaus.
        return { uebertragen, abgelehnt, offen: wartend.length - stelle }
      }

      abgelehnt.push({ mutation: eintrag.mutation, grund: fehler.message })
    }

    await warteschlange.entferne(eintrag.schluessel)
  }

  return { uebertragen, abgelehnt, offen: 0 }
}
