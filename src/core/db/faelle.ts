/**
 * `cases` als schmale Tabelle (DESIGN.md §2, §4).
 *
 * Der Port, den der `fallService` benutzt. Was hier durchgeht, ist entweder
 * öffentlich (`status`, `current_kid`, `version`) oder ein Envelope — der
 * Payload trägt Name und Sterbedatum, und beides sieht der Server nie (§3.3).
 *
 * Angelegt wird über eine RPC und nicht über ein Insert: Fall, Mitgliedschaft
 * und die beiden Wraps entstehen zusammen oder gar nicht (§4). Ein Fall ohne
 * Mitgliedschaft wäre für niemanden sichtbar, ein Fall ohne Wraps nach dem
 * nächsten Neuladen unlesbar.
 */

import type { Wrap } from '../crypto/wrap'

export type Fallstatus = 'vorsorge' | 'trauerfall'

export type FallZeile = {
  id: string
  status: Fallstatus
  /** `kid` der aktuellen `K_c`-Generation, "case_<uuid>:<gen>". */
  currentKid: string
  keyGeneration: number
  /** Sync-Zähler und Wasserzeichen zugleich (§4, §5). */
  version: number
  /**
   * Der eingefrorene Katalogstand (§8), oder `null` bei einem Vorsorgefall,
   * der noch keine Aufgaben hat.
   *
   * Eine Herkunftsangabe, keine lebende Verknüpfung: Rechtsgrundlage und
   * Quelle stehen im Item selbst und altern mit ihm.
   */
  katalogVersion: string | null
  /** `{personName, sterbedatum}` unter `K_c` (§3.2). */
  payload: Uint8Array
  angelegtAm: string
}

export type NeuerTrauerfall = {
  /** Vom Client vergeben, weil beide `kid` daraus entstehen (§3.1). */
  id: string
  kidFall: string
  kidKatalog: string
  payload: Uint8Array
  /** Der Katalogstand, der mit diesem Fall eingefroren wird (§8). */
  katalogVersion: string
  /** Das anlegende Gerät: Empfänger und Absender beider Wraps zugleich. */
  geraeteId: string
  wrapFall: Wrap
  wrapKatalog: Wrap
}

export type FaelleTabelle = {
  /** Legt Fall, Mitgliedschaft und beide Wraps in einem Zug an. */
  legeTrauerfallAn(neu: NeuerTrauerfall): Promise<void>

  /** Die Fälle der angemeldeten Person. Wer das ist, entscheidet die RLS. */
  eigene(): Promise<FallZeile[]>

  /**
   * Der billige Check aus §5: ein Integer, kein Fetch.
   *
   * Gleich dem Wasserzeichen heisst „nichts Neues" — dann wird kein Item
   * abgerufen. `cases.version` trägt das, weil der Trigger `items_assign_seq`
   * ihn bei jeder Inhaltsänderung des Falls mithebt (§4).
   *
   * @returns `null`, wenn die RLS den Fall nicht hergibt. Ausdrücklich nicht
   * `0` — das hiesse „alles neu holen".
   */
  version(fallId: string): Promise<number | null>
}
