/**
 * Dauerhafter Speicher (DESIGN.md §7).
 *
 * `sk_u` liegt in IndexedDB und verlaesst das Geraet nie (§3.1). Raeumt der
 * Browser den Speicher auf, ist der Fall bei genau einem Geraet und ohne zweite
 * Person verloren (§11.1). `navigator.storage.persist()` bittet den Browser,
 * das zu unterlassen.
 *
 * Die Bitte laeuft still. Schlaegt sie fehl (Safari vergibt das Recht nur unter
 * eigenen Bedingungen, manche Browser kennen die API gar nicht), sagt die App
 * nichts. Ein Hinweis waere eine Warnung ohne Handlungsmoeglichkeit; worauf das
 * Onboarding stattdessen sichtbar draengt, ist die zweite Person im Fall.
 */

export type PersistErgebnis = 'gewaehrt' | 'abgelehnt' | 'nicht-unterstuetzt'

export async function speicherDauerhaftAnfordern(): Promise<PersistErgebnis> {
  if (typeof navigator === 'undefined' || !navigator.storage?.persist) {
    return 'nicht-unterstuetzt'
  }

  try {
    // Bereits gewaehrt? Dann kostet ein zweiter Aufruf in manchen Browsern
    // einen Berechtigungsdialog, den niemand angefordert hat.
    if (await navigator.storage.persisted?.()) {
      return 'gewaehrt'
    }

    return (await navigator.storage.persist()) ? 'gewaehrt' : 'abgelehnt'
  } catch {
    return 'nicht-unterstuetzt'
  }
}
