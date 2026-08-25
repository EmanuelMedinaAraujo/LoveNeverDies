/**
 * `personal_key_wraps` als schmale Tabelle (DESIGN.md §3.7, §4).
 *
 * `K_p` ist ein Zufallsschlüssel pro Person **und pro Fall**, an die eigenen
 * Geräte gewrappt. Der Unterschied zu `key_wraps` steht in der RLS und nicht
 * hier: Dort darf jedes Mitglied für fremde Geräte schreiben, damit eine
 * Kopplung überhaupt möglich ist (§3.6). Hier darf niemand für eine andere
 * Person lesen oder schreiben, denn es gibt keinen Anlass, bei dem jemand
 * einen fremden persönlichen Schlüssel in der Hand hätte.
 *
 * Deshalb steht in dieser Tabelle auch keine Signatur, anders als bei
 * `key_wraps` (§3.6): Absender und Empfänger sind dieselbe Person. Es gibt
 * niemanden, gegen den zu signieren wäre, und niemanden, der einen falschen
 * `K_p` einstellen könnte, ohne sich selbst auszusperren.
 *
 * `kid` ist ein undurchsichtiger Zufallswert und kein sprechender Name (§3.7).
 * Ein `privat_<user_id>` verriete über die Zeile in `items` hinaus, wem sie
 * gehört; der Join über diese Tabelle tut das ohnehin, und mehr soll es nicht
 * werden.
 */

export type PersoenlicherSchluesselwrapZeile = {
  fallId: string
  userId: string
  /** 32 Byte Zufall, hexkodiert. Benennt `K_p` in `items.kid`. */
  kid: string
  /** Das Empfängergerät, immer eines der eigenen. */
  geraeteId: string
  kemCt: Uint8Array
  /** `AES-GCM(geteiltes Geheimnis, K_p)`. */
  wrappedKey: Uint8Array
}

export type PersoenlicheSchluesselTabelle = {
  /**
   * Die Wraps für ein Gerät. Leer heißt: Diese Person hat in diesem Fall noch
   * nichts Privates angelegt.
   *
   * Eine Liste und kein einzelner Wrap: Die RLS gibt ohnehin nur die eigenen
   * Zeilen heraus, aber ein zweites `kid` wäre kein Fehler, sondern ein
   * halb durchgelaufener Anlauf von einem anderen Gerät. Wer sie alle sieht,
   * kann sich für eines entscheiden, statt an der Uneindeutigkeit zu scheitern.
   */
  fuerGeraet(fallId: string, geraeteId: string): Promise<PersoenlicherSchluesselwrapZeile[]>

  /**
   * Schreibt Wraps für die eigenen Geräte (§3.7).
   *
   * Bestehende bleiben stehen: Der Aufruf läuft bei jeder Gerätefreigabe und
   * darf einen vorhandenen Wrap nicht ersetzen. Auf `personal_key_wraps` gibt
   * es aus demselben Grund wie auf `key_wraps` keine UPDATE-Policy (§3.6).
   */
  schreibeWraps(wraps: PersoenlicherSchluesselwrapZeile[]): Promise<void>
}
