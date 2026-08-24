/**
 * Einheitlicher Ladehinweis für den Fallzustand (DESIGN.md §7).
 */
export function fallLadeText(status: 'laedt' | 'schluessel-erneuerung'): string {
  return status === 'schluessel-erneuerung'
    ? 'Schlüssel werden erneuert…'
    : 'Ihre Daten werden geladen…'
}
