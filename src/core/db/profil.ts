/**
 * `profiles` als schmale Tabelle (DESIGN.md §3.3, §4, §6).
 *
 * Anzeigename und E-Mail, im Klartext und mit Absicht: §6 zeigt der einladenden
 * Person den Namen der beitretenden, bevor ein gemeinsamer Schlüssel
 * existiert. Verschlüsselt ginge das nicht: Es gäbe zu diesem Zeitpunkt
 * keinen Schlüssel, den beide Seiten hätten.
 *
 * Geschrieben wird ausschließlich das eigene Profil. Gelesen wird es hier gar
 * nicht: Was die Kopplung braucht, kommt aus `loese_kopplungscode_ein`
 * (`kopplung.ts`), und was Profil anzeigt, weiß die Anmeldung ohnehin schon.
 */

export type Profilangaben = {
  /** Clerk `sub`. */
  userId: string
  anzeigename: string
  email: string | null
}

export type ProfilTabelle = {
  /**
   * Legt das eigene Profil an oder bringt es auf den neuesten Stand.
   *
   * Läuft bei jeder Anmeldung, weil Name und E-Mail sich bei Clerk ändern
   * können, ohne dass diese App davon erfährt.
   */
  speichere(angaben: Profilangaben): Promise<void>
}
