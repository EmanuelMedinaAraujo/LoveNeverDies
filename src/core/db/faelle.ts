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
}
