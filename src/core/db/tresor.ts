/**
 * Tabellen vault_key_wraps und vault_shares (DESIGN.md §3.5, §4).
 *
 * K_v liegt nur in vault_key_wraps, gewrappt an die Geräte des Preparers.
 * RLS schützt die Zeilen vor anderen Nutzern.
 *
 * Schlüsselanteile der Angehörigen liegen in vault_shares.
 * Die Verteilung läuft über die RPC resplit_vault.
 */

export type VaultKeyWrapZeile = {
  fallId: string
  geraeteId: string
  kemCt: Uint8Array
  wrappedKey: Uint8Array
}

export type VaultShareZeile = {
  fallId: string
  userId: string
  geraeteId: string
  shareIndex: number
  shareHash: Uint8Array
  kemCt: Uint8Array
  wrappedShare: Uint8Array
}

export type ResplitShareInput = {
  userId: string
  deviceId: string
  shareIndex: number
  shareHash: Uint8Array
  kemCt: Uint8Array
  wrappedShare: Uint8Array
}

export type TresorTabelle = {
  /**
   * Holt den Tresorschlüssel-Wrap für ein bestimmtes Gerät.
   * Gibt `null` zurück, wenn kein Wrap existiert oder die RLS den Zugriff verwehrt.
   */
  wrapFuerGeraet(fallId: string, geraeteId: string): Promise<VaultKeyWrapZeile | null>

  /**
   * Holt alle Shares eines Falls (z. B. zur Prüfung).
   */
  sharesFuerFall(fallId: string): Promise<VaultShareZeile[]>

  /**
   * Führt einen atomaren Re-Split des Tresors durch:
   * Löscht alte Shares und Releases, trägt neue Shares ein, aktualisiert n und k.
   */
  resplitVault(
    fallId: string,
    n: number,
    k: number | null,
    shares: ResplitShareInput[],
  ): Promise<void>
}
