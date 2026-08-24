/**
 * `key_wraps` als schmale Tabelle (DESIGN.md §3.6, §4).
 *
 * Gelesen wird ausschließlich, was für dieses Gerät bestimmt ist. Mehr
 * gibt die RLS ohnehin nicht heraus. Geschrieben wird in diesem Stand nur beim
 * Anlegen eines Falls, und das läuft über die RPC in `faelle.ts`, damit Fall
 * und Wraps nicht auseinanderfallen können. Der Weg für fremde Geräte gehört
 * zur Kopplung (§6) und kommt mit ihr.
 */

import type { Wrap } from '../crypto/wrap'

export type SchluesselwrapZeile = Wrap & {
  fallId: string
  kid: string
  /** Das Empfängergerät. */
  geraeteId: string
  /** Das wrappende Gerät. Gegen dessen `sig_public_key` wird verifiziert. */
  wrappedBy: string
}

export type SchluesselwrapTabelle = {
  fuerGeraet(fallId: string, geraeteId: string): Promise<SchluesselwrapZeile[]>

  /**
   * Schreibt Wraps für die Geräte der Mitglieder (§3.4, §3.6).
   */
  schreibeWraps(wraps: SchluesselwrapZeile[]): Promise<void>
}
