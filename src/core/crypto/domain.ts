/**
 * Domain-Trennung (DESIGN.md §3.2).
 *
 * Jeder Hash und jede Signatur traegt ein Praefix, damit ein Wert aus einem
 * Kontext in keinem anderen gilt. Die Praefixe teilt der Client mit der Edge
 * Function `vault-release`; sie stehen deshalb an einer Stelle und nirgends
 * sonst.
 *
 * Dieses Modul ist bewusst frei von React, Supabase und jeder Laufzeit ausser
 * der Sprache selbst. Die Import-Boundary-Regel in `eslint.config.js` setzt
 * das durch.
 */

export const DOMAIN_SEPARATION = {
  /** Geraete-Fingerprint: SHA-256(pk_kem ‖ pk_sig) */
  fingerprint: 'LN-fp-v1',
  /** Tresor-Commitment: SHA-256(K_v) */
  vaultCommitment: 'LN-open-v1',
  /** Freigabe-Signatur: case_id ‖ user_id ‖ kid ‖ SHA-256(released_share) */
  vaultRelease: 'LN-rel-v1',
  /** Wrap-Signatur: case_id ‖ kid ‖ device_id ‖ SHA-256(kem_ct ‖ wrapped_key) */
  keyWrap: 'LN-wrap-v1',
  /** Katalog-Item-ID: HMAC-SHA256(K_cat, catalog_item_path) */
  catalogItemId: 'LN-cat-v1',
} as const

export type DomainSeparationPrefix = (typeof DOMAIN_SEPARATION)[keyof typeof DOMAIN_SEPARATION]
