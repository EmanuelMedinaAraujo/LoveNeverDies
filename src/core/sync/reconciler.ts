/**
 * Delta und Bestand verrechnen (DESIGN.md §5).
 *
 * Zwei Regeln, beide ohne Client-Uhr:
 *
 *   1. Last-Write-Wins über die serverseitig vergebene `seq`. Die Nummer
 *      kommt vom Trigger `items_assign_seq` unter Zeilensperre (§4), sie ist je
 *      Fall streng steigend, und sie ist damit die einzige Reihenfolge, auf die
 *      sich zwei Geräte einigen können. Uhren tun das nicht.
 *   2. Löschen gewinnt endgültig. Die Datenbank weist ein `deleted → false`
 *      ab (§4). Hier steht dieselbe Regel ein zweites Mal, denn der Server gilt
 *      als potenziell bösartig (§11), und eine Regel, die nur an einer Stelle
 *      steht, ist keine.
 *
 * Diese Datei kennt weder Netz noch Speicher noch Schlüssel. Sie bekommt zwei
 * Listen und gibt eine zurück: Deshalb lässt sich die Frage "was passiert bei
 * zwei nebenläufigen Änderungen?" hier beantworten und nirgends sonst.
 */

import type { InhaltZeile } from '../db/inhalte'
import type { Mutation } from './queue'

export type Vereinigung = {
  /** Der neue Bestand, nach `id` sortiert. */
  zeilen: InhaltZeile[]
  /**
   * Die IDs, deren Zeile sich wirklich geändert hat.
   *
   * §5 verlangt, dass sichtbare Screens sich nur für tatsächlich geänderte
   * Zeilen aktualisieren. Ohne diese Liste entschlüsselte jede Türklingel den
   * ganzen Fall neu, und bei einem Fall mit hundert Aufgaben wäre die
   * Türklingel teurer als das Polling, das sie ersetzt.
   */
  geaendert: string[]
}

/**
 * Legt fest, was aus zwei Fassungen derselben Zeile wird.
 *
 * Der Tombstone überlebt die Verrechnung immer. Die höhere `seq` überlebt
 * ebenfalls immer, auch die eines abgewiesenen Edits: Bliebe die Nummer
 * stehen, während das Wasserzeichen darüber hinausgewandert ist, holte kein
 * Delta diese Zeile je wieder, und der Bestand bliebe für immer auf dem alten
 * Stand.
 */
function gewinner(bisher: InhaltZeile, neu: InhaltZeile): InhaltZeile {
  const inhalt = neu.seq > bisher.seq ? neu : bisher

  return {
    ...inhalt,
    seq: Math.max(bisher.seq, neu.seq),
    geloescht: bisher.geloescht || neu.geloescht,
  }
}

/** Zwei Zeilen sind gleich, wenn kein Bildschirm den Unterschied sähe. */
function gleich(bisher: InhaltZeile, neu: InhaltZeile): boolean {
  return (
    bisher.seq === neu.seq &&
    bisher.geloescht === neu.geloescht &&
    bisher.kid === neu.kid &&
    bisher.art === neu.art &&
    bisher.imTresor === neu.imTresor &&
    bisher.payload.length === neu.payload.length &&
    bisher.payload.every((byte, stelle) => byte === neu.payload[stelle])
  )
}

/**
 * Verrechnet ein Delta mit dem Bestand.
 *
 * Sortiert wird über die `id` und nicht über `seq`: `seq` steigt bei jedem
 * Schreibvorgang, auch bei einem Häkchen, und danach sortiert wanderte die
 * gerade abgehakte Aufgabe ans Ende der Liste. Die `id` ist eine UUIDv7, trägt
 * den Anlagezeitpunkt in ihren führenden Bits und ändert sich nie.
 */
export function vereine(bestand: InhaltZeile[], delta: InhaltZeile[]): Vereinigung {
  const nachId = new Map(bestand.map((zeile) => [zeile.id, zeile]))
  const geaendert: string[] = []

  for (const neu of delta) {
    const bisher = nachId.get(neu.id)

    if (bisher === undefined) {
      nachId.set(neu.id, neu)
      geaendert.push(neu.id)
      continue
    }

    const vereint = gewinner(bisher, neu)

    if (!gleich(bisher, vereint)) {
      nachId.set(neu.id, vereint)
      geaendert.push(neu.id)
    }
  }

  return {
    zeilen: [...nachId.values()].sort((links, rechts) => (links.id < rechts.id ? -1 : 1)),
    geaendert,
  }
}

/**
 * Legt die noch nicht übertragenen Mutationen über den bestätigten Bestand
 * (§5: "optimistisch lokal angewandt").
 *
 * Warum als Überlagerung und nicht im Cache: Der Cache trägt ausschliesslich
 * das, was der Server bestätigt hat: Genau das verlangt §5 mit "byteidentisch
 * zum Server". Was noch wartet, liegt in der Queue und wird bei jedem Rendern
 * darübergelegt. Das ist zugleich die Rücknahme abgelehnter Änderungen: Eine
 * Mutation, die der Server verwirft, verlässt die Queue, und ihre Wirkung
 * verschwindet mit ihr. Läge sie im Cache, bliebe ein abgelehntes Edit dort für
 * immer stehen. Der Delta-Sync brächte es nie zurück, weil sich auf dem Server
 * nichts geändert hat.
 *
 * @param mutationen in der Reihenfolge des Anhängens.
 */
export function wendeAn(zeilen: InhaltZeile[], mutationen: Mutation[]): InhaltZeile[] {
  const nachId = new Map(zeilen.map((zeile) => [zeile.id, zeile]))

  for (const mutation of mutationen) {
    if (mutation.op === 'anlegen') {
      nachId.set(mutation.itemId, {
        id: mutation.itemId,
        fallId: mutation.fallId,
        // `seq` vergibt ausschliesslich der Server (§4). Bis dahin steht 0 da:
        // niedriger als jedes Delta, also gewinnt die bestätigte Zeile, sobald
        // sie kommt.
        seq: 0,
        art: mutation.art,
        geloescht: false,
        imTresor: false,
        kid: mutation.kid,
        wrappedDek: mutation.wrappedDek,
        payload: mutation.payload,
        geaendertAm: new Date(mutation.ts).toISOString(),
      })
      continue
    }

    const bisher = nachId.get(mutation.itemId)

    if (bisher === undefined) {
      // Kein Anlegen dazu und keine bestätigte Zeile: Es gibt nichts, worüber
      // sich etwas legen liesse. Eine erfundene Zeile wäre schlimmer: Sie
      // erschiene als Aufgabe ohne Inhalt.
      continue
    }

    nachId.set(
      mutation.itemId,
      mutation.op === 'aendern'
        ? { ...bisher, payload: mutation.payload }
        : // Payload und DEK werden geleert, so wie der Server es täte (§5).
          {
            ...bisher,
            geloescht: true,
            payload: new Uint8Array(),
            wrappedDek: new Uint8Array(),
          },
    )
  }

  return [...nachId.values()].sort((links, rechts) => (links.id < rechts.id ? -1 : 1))
}
