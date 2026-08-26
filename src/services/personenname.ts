/**
 * Wie ein Personenname dasteht, wenn keiner hinterlegt ist (DESIGN.md §3.3, §6).
 *
 * `profiles.display_name` darf leer sein: Wer sich mit Apple anmeldet, gibt
 * seinen Namen oft nicht weiter, und die E-Mail-Adresse ist dann ein
 * Zufallsstring bei `privaterelay.appleid.com` (`core/auth/clerkAdapter.tsx`).
 * Frueher stand die Adresse ersatzweise als Name da — in der Freigabeliste, im
 * Kopplungsangebot, im vorausgefuellten Namensfeld der Vorsorge.
 *
 * Ein Platzhalter ist die ehrlichere Auskunft: Er sagt, dass hier ein Name
 * fehlt, statt eine Zeichenkette als Namen auszugeben, die keine ist. Wo die
 * E-Mail-Adresse zur Person gehoert und weiterhilft, steht sie ohnehin daneben
 * — im Kopplungsangebot (§6) und in Profil.
 *
 * Eine einzige Stelle dafuer, damit der Platzhalter ueberall derselbe ist:
 * Zwei verschiedene Ersatztexte fuer dieselbe Lage lesen sich wie zwei
 * verschiedene Auskuenfte.
 */

/** Was anstelle eines fehlenden Namens dasteht. */
export const OHNE_NAMEN = 'Ohne Namen'

/**
 * Der Name, oder der Platzhalter, wenn keiner dasteht.
 *
 * @param ersatz was statt des Platzhalters dastehen soll, etwa eine Kennung,
 * an der sich eine Zeile ueberhaupt noch zuordnen laesst.
 */
export function personenname(name: string | null | undefined, ersatz = OHNE_NAMEN): string {
  const gekuerzt = name?.trim() ?? ''

  return gekuerzt === '' ? ersatz : gekuerzt
}
