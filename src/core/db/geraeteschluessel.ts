/**
 * `device_keys` als schmale Tabelle (DESIGN.md §4).
 *
 * Der Port, den der `geraeteService` benutzt, und nichts darüber hinaus. Was
 * darin auftaucht, sind ausschließlich öffentliche Schlüssel; einen Platz für
 * `sk_u` gibt es hier nicht, damit es keinen gibt (§3.1).
 *
 * Warum überhaupt ein Port und nicht der Supabase-Client direkt im Service:
 * Die Idempotenz der Registrierung (§3.6) ist eine Regel des Clients, nicht der
 * Datenbank, und sie braucht einen Test, der ohne Netz und ohne Projekt läuft.
 */

export type GeraeteschluesselZeile = {
  id: string
  userId: string
  /** `pk_u`, 1216 Byte. */
  pkKem: Uint8Array
  /** ML-DSA-65-pk ‖ Ed25519-pk, 1984 Byte. */
  pkSig: Uint8Array
  label: string | null
  angelegtAm: string
}

export type NeuerGeraeteschluessel = {
  userId: string
  pkKem: Uint8Array
  pkSig: Uint8Array
  label: string | null
}

export type GeraeteschluesselTabelle = {
  finde(userId: string, pkKem: Uint8Array): Promise<GeraeteschluesselZeile | null>

  /**
   * Legt an, sofern `(user_id, public_key)` noch frei ist.
   *
   * @returns `null`, wenn ein anderer Schreiber zuerst da war. Kein Fehler: Es
   * ist dieselbe Identität, und der Aufrufer will nur die Zeile.
   */
  legeAn(neu: NeuerGeraeteschluessel): Promise<GeraeteschluesselZeile | null>

  /**
   * Die Zeile zu einer `device_keys.id`.
   *
   * Gebraucht für `key_wraps.wrapped_by` (§3.6): Bevor ein Wrap entpackt wird,
   * muss der öffentliche Signaturschlüssel des wrappenden Geräts her — und das
   * kann ein Gerät einer anderen Person sein.
   *
   * @returns `null`, wenn es die Zeile nicht gibt oder die RLS sie verbirgt.
   */
  nachId(id: string): Promise<GeraeteschluesselZeile | null>

  fuerBenutzer(userId: string): Promise<GeraeteschluesselZeile[]>

  benenneUm(id: string, label: string): Promise<void>
}
