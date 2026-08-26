/**
 * Eine Vorsorgefrage (DESIGN.md §3.5).
 *
 * Wie beim Rechtskatalog und beim Fragebaum steht die Form in `types` und
 * nicht bei den Daten: Die Inhaltsdatei, der Screen, der die Frage stellt, und
 * der Screen, der die Antwort im Tresor wieder zeigt, brauchen dieselbe Form.
 */

export type Vorsorgefrage = {
  /**
   * Die Kennung, unter der die Antwort im Tresor liegt.
   *
   * Sie steht im Payload der Tresorzeile und bleibt stabil: Wird der Wortlaut
   * einer Frage geändert, bleibt die Antwort ihre Antwort. Eine umnummerierte
   * Frage machte dagegen aus einer gegebenen Auskunft eine verwaiste Zeile und
   * stellte die Frage ein zweites Mal, mit leerem Feld daneben.
   */
  id: string
  /**
   * Der Wortlaut, wie ihn die Juristinnen geliefert haben.
   *
   * Mehrzeilig, wo der gelieferte Text mehrzeilig ist: Der Zusatz "Beispiel:
   * Mietvertrag, Wasser, Strom, Kfz usw." steht auf einer eigenen Zeile und
   * wird mit `white-space: pre-wrap` auch dort gesetzt (§8).
   */
  frage: string
}
