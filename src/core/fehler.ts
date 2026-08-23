/** Eine Fehlermeldung zum Anzeigen, unabhängig davon, was geworfen wurde. */
export function alsNachricht(fehler: unknown): string {
  return fehler instanceof Error ? fehler.message : String(fehler)
}
