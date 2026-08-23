/**
 * `items` als schmale Tabelle (DESIGN.md §3.3, §4).
 *
 * Der Port, den der `aufgabenService` benutzt. Was hier durchgeht, ist entweder
 * eine der Klartextspalten aus §3.3 — `seq`, `kind`, `deleted`, `in_vault`,
 * `kid` — oder ein Envelope. Titel, Beschreibung, Typ und Erledigt-Status
 * liegen im `payload`, verschlüsselt unter einem DEK, der seinerseits unter
 * `K_c` gewrappt in derselben Zeile steht.
 *
 * Zwei Spalten fehlen absichtlich in den Schreibwegen:
 *
 * - **`seq`** vergibt ausschließlich der Trigger `items_assign_seq` (§4). Ein
 *   Port, der sie annähme, führte in Versuchung, sie zu setzen.
 * - **`storage_path`** gehört zu `kind = 'file'` und damit zu den Dokumenten
 *   (§7), die in diesem Stand noch nicht hochgeladen werden.
 *
 * Und eine Operation fehlt: Es gibt kein Löschen. Auf `items` ist DELETE per
 * RLS für alle ausgeschlossen — was danach aussieht, ist ein Tombstone (§5).
 */

/**
 * Die Werte des CHECK aus §4, unübersetzt: `kind` unterscheidet ausschließlich
 * eine Aufgabe von einer Datei. Alles, was inhaltlich zwischen Items
 * unterscheidet, liegt verschlüsselt im Payload und geht den Server nichts an.
 */
export type Inhaltsart = 'item' | 'file'

export type InhaltZeile = {
  id: string
  fallId: string
  /** Vom Trigger vergeben, streng steigend je Fall (§4, §5). */
  seq: number
  art: Inhaltsart
  /** Tombstone. Eine gelöschte Zeile bleibt stehen und wird nie hart gelöscht. */
  geloescht: boolean
  /** DEK unter `K_v` statt `K_c` (§3.5). */
  imTresor: boolean
  /** Benennt den Schlüssel, unter dem `wrappedDek` liegt: `K_c`, `K_v` oder `K_p`. */
  kid: string
  wrappedDek: Uint8Array
  payload: Uint8Array
  geaendertAm: string
}

export type NeuerInhalt = {
  /** Clientseitig erzeugte UUIDv7, damit Anlegen später offline funktioniert (§5). */
  id: string
  fallId: string
  art: Inhaltsart
  kid: string
  wrappedDek: Uint8Array
  payload: Uint8Array
}

export type InhalteTabelle = {
  /**
   * Alle Zeilen eines Falls in Anlagereihenfolge — Tombstones eingeschlossen.
   *
   * Sortiert wird über die `id` und ausdrücklich **nicht** über `seq`. `seq`
   * ist der Sync-Zähler (§5) und steigt bei jedem Schreibvorgang: Ein Häkchen
   * an der ersten Aufgabe schöbe sie ans Ende der Liste. Die `id` ist eine
   * UUIDv7 und trägt den Anlagezeitpunkt in ihren führenden Bits, sortiert
   * also chronologisch und ändert sich nie.
   */
  imFall(fallId: string): Promise<InhaltZeile[]>

  lege(neu: NeuerInhalt): Promise<void>

  /**
   * Schreibt einen neuen Payload. Der DEK bleibt, wo er ist: Er ändert sich
   * nie (§3.1), und deshalb kostet ein Edit genau eine Spalte.
   */
  schreibePayload(id: string, payload: Uint8Array): Promise<void>

  /**
   * Setzt den Tombstone und leert dabei Payload und DEK.
   *
   * Das Leeren ist keine Zugabe: Tombstones werden nie garbage-collected (§5),
   * eine gelöschte Aufgabe läge sonst für immer als Ciphertext auf dem Server.
   * Verloren geht nichts — `deleted` ist endgültig, die Datenbank weist ein
   * `deleted → false` ab (§4), und niemand liest den Payload einer gelöschten
   * Zeile je wieder.
   */
  loesche(id: string): Promise<void>
}
