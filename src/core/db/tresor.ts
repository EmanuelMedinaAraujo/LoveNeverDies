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

/**
 * Eine Zeile aus `vault_releases` (§3.5, §4).
 *
 * Eine Person, eine Zeile: Der Primärschlüssel `(case_id, user_id)` setzt
 * durch, dass Personen gezählt werden und nicht Geräte.
 */
export type VaultReleaseZeile = {
  fallId: string
  userId: string
  /** Das Gerät, das signiert hat. */
  geraeteId: string
  /** Die `K_c`-Generation, unter der `releasedShare` liegt (§3.4, §3.5). */
  kid: string
  releasedShare: Uint8Array
  signatur: Uint8Array
  freigegebenAm: string
}

/**
 * Eine Freigabe auf dem Weg zur Edge Function `vault-release` (§3.5, §9).
 *
 * Ohne `user_id`? Nein, mit — aber sie steht hier nur, weil sie in die
 * Signatur eingeht. Die Function nimmt die Kennung ausdrücklich aus dem
 * geprüften Token und nie aus diesem Body.
 */
export type NeueFreigabe = {
  caseId: string
  userId: string
  geraeteId: string
  kid: string
  releasedShare: Uint8Array
  signatur: Uint8Array
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
   * Legt den `K_v`-Wrap für ein weiteres Gerät des Preparers an (§3.5).
   *
   * Ist für dieses Gerät schon einer da, bleibt er stehen: Der Aufruf läuft
   * bei jeder Gerätefreigabe und darf einen bestehenden Wrap nicht ersetzen.
   */
  legeWrapAn(wrap: VaultKeyWrapZeile): Promise<void>

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

  /**
   * Gibt den eigenen Schlüsselanteil an ein weiteres eigenes Gerät weiter (§3.5).
   *
   * Der Weg über eine RPC und nicht über ein `insert`: `vault_shares` hat
   * keine Schreib-Policy, weil die Verteilung dem Preparer gehört. Stelle und
   * Hash nimmt die Datenbank aus der bestehenden Zeile, nicht von hier — sonst
   * liesse sich ein erfundener Anteil samt passendem Hash unterschieben.
   */
  uebergibShare(
    fallId: string,
    geraeteId: string,
    kemCt: Uint8Array,
    wrappedShare: Uint8Array,
  ): Promise<void>

  /** Die Freigaben eines Falls. Lesbar für jedes Mitglied (§4). */
  freigabenFuerFall(fallId: string): Promise<VaultReleaseZeile[]>

  /**
   * Schickt eine Freigabe an die Edge Function `vault-release` (§3.5, §9).
   *
   * Der einzige Weg in `vault_releases`: Direktes INSERT ist per RLS für alle
   * ausgeschlossen. Und der einzige Schreibweg dieser App, der **nicht** durch
   * die Offline-Queue geht (§5) — eine versehentlich abgeschickte
   * Todesbestätigung nimmt niemand zurück.
   */
  sendeFreigabe(freigabe: NeueFreigabe): Promise<void>

  /**
   * Der Übergang nach `trauerfall` gegen den Nachweis über `K_v` (§3.5).
   *
   * @param proof `SHA-256("LN-open-v1" ‖ K_v)`.
   * @param katalogVersion der Stand, den dieser Client mitbringt (§8).
   * @param payload `{personName, sterbedatum}` unter `K_c`.
   * @returns die gültige `catalog_version` — die eigene oder die eines
   * schnelleren Clients. Wer sie nicht kennt, instanziiert nicht.
   */
  oeffneTresor(
    fallId: string,
    proof: Uint8Array,
    katalogVersion: string,
    payload: Uint8Array,
  ): Promise<string | null>
}
