/**
 * `memberships` als schmale Tabelle (DESIGN.md §4).
 *
 * Wer zu einem Fall gehört, steht im Klartext auf dem Servern — das ist eine
 * der bewusst offenen Spalten aus §3.3: „Der Server weiß, wer zu wem gehört und
 * wie diese Menschen heißen. Er weiß nichts über den Inhalt."
 *
 * **Kennungen, keine Namen.** Der Anzeigename kommt aus `profiles`, und die
 * Tabelle entsteht mit der Kopplung (#10) — dort ist sie der ganze Zweck des
 * Schritts, denn die einladende Person muss den Namen sehen, *bevor* ein
 * gemeinsamer Schlüssel existiert. Bis dahin holt sich die Zuweisung die Namen
 * aus den Payloads, in denen sie ohnehin stehen (`services/zuweisung.ts`).
 *
 * Geschrieben wird hier nichts: Mitgliedschaften entstehen über die
 * Fallanlage-RPC und über die Kopplung, nie über ein Insert vom Client (§4).
 */

export type MitgliedZeile = {
  /** Clerk `sub`. */
  userId: string
  beigetretenAm: string
}

export type MitgliederTabelle = {
  /** Die Mitglieder eines Falls. Ob man ihn sehen darf, entscheidet die RLS. */
  imFall(fallId: string): Promise<MitgliedZeile[]>
}
