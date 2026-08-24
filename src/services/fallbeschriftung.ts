/**
 * Wie ein Trauerfall in der Oberfläche heißt (DESIGN.md §2).
 *
 * "Hans Weber · Trauerfall seit 12. Mai 2026" statt eines Sammelbegriffs: §2
 * verlangt ausdrücklich den Namen der Person, nicht "Ihr Fall" oder Ähnliches.
 */

function datumAusIso(sterbedatum: string): Date {
  const [jahr, monat, tag] = sterbedatum.split('-').map(Number)

  return new Date(Date.UTC(jahr ?? 0, (monat ?? 1) - 1, tag ?? 1))
}

/**
 * `timeZone: 'UTC'`, weil `sterbedatum` ein reines Kalenderdatum ohne Uhrzeit
 * ist. Ohne die feste Zeitzone verschöbe die lokale Zeitzone des Browsers das
 * Datum an manchen Orten um einen Tag.
 */
const FORMAT = new Intl.DateTimeFormat('de-DE', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
})

export function fallBeschriftung(personName: string, sterbedatum: string): string {
  return `${personName} · Trauerfall seit ${FORMAT.format(datumAusIso(sterbedatum))}`
}
