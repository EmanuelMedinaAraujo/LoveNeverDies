/**
 * Die Dateiablage für Dokumente (DESIGN.md §7, §3.3).
 *
 * Der Port, den der `dokumentService` benutzt: drei Operationen auf einem
 * Objekt, das schon verschlüsselt ist, wenn es hier ankommt. Ver- und
 * Entschlüsseln steht in `core/crypto/dateikrypto.ts`; was durch diese Tür
 * geht, sind Bytes ohne Bedeutung.
 *
 * Der Pfad ist keine freie Angabe: `{case_id}/{item_id}` (§7). Der erste
 * Abschnitt trägt die Zugriffsregel (`is_member((storage.foldername(name))[1])`),
 * der zweite bindet die Datei an genau ein Item. Deshalb gibt es
 * {@link dokumentPfad} und keine freie Zeichenkette am Aufrufort.
 *
 * Kein Überschreiben: Ein Dokument entsteht und wird gelöscht, nie ersetzt:
 * Der DEK gilt für genau diesen Ciphertext, und ein zweiter Upload unter
 * demselben Pfad machte die Datei für jedes Gerät unlesbar, das den alten
 * Payload schon hat. Die Migration lässt UPDATE auf dem Bucket deshalb gar
 * nicht erst zu.
 */

/** Der Bucket aus §7. Privat, 15 MB Obergrenze. */
export const DOKUMENTE_BUCKET = 'documents'

/**
 * Der Ablageort eines Dokuments: `{case_id}/{item_id}` (§7).
 *
 * Dieselbe Gleichung steht als CHECK auf `items`. Der Aufräumjob findet die
 * Datei zu einem getombsteten Item ausschließlich über sie.
 */
export function dokumentPfad(fallId: string, itemId: string): string {
  return `${fallId}/${itemId}`
}

/** Ein Zugriff auf die Dateiablage ist gescheitert. */
export class AblageFehler extends Error {
  constructor(nachricht: string, options?: ErrorOptions) {
    super(nachricht, options)
    this.name = 'AblageFehler'
  }
}

export type Dokumentablage = {
  /**
   * Legt eine verschlüsselte Datei ab.
   *
   * @throws {AblageFehler} auch dann, wenn der Pfad bereits belegt ist. Das ist
   * kein Sonderfall, den es zu glätten gälte: Die Item-ID ist eine frische
   * UUIDv7, ein belegter Pfad heißt also, dass hier etwas nicht stimmt.
   */
  lade(pfad: string, ciphertext: Uint8Array): Promise<void>

  hole(pfad: string): Promise<Uint8Array>

  /**
   * Entfernt die Datei.
   *
   * Der Weg, den §7 "Löschen entfernt auch die Datei" nennt. Scheitert er,
   * bleibt der Tombstone trotzdem stehen und der serverseitige Aufräumjob
   * holt die Datei nach sieben Tagen. Löschen gewinnt endgültig, auch wenn
   * die Verbindung mitten darin abbricht.
   */
  entferne(pfad: string): Promise<void>
}
