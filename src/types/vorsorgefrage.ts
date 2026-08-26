/**
 * Eine Frage der Nachlass-Checkliste (DESIGN.md §3.5).
 *
 * Wie beim Rechtskatalog und beim Fragebaum steht die Form in `types` und
 * nicht bei den Daten: Die Inhaltsdatei, der Screen, der die Frage stellt, und
 * die Übersicht, die Frage und Antwort noch einmal nebeneinander zeigt,
 * brauchen dieselbe Form.
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
   * Mietvertrag, Strom, Kfz usw." steht auf einer eigenen Zeile und wird mit
   * `white-space: pre-wrap` auch dort gesetzt (§8).
   */
  frage: string
  /**
   * Was zwischen der Frage und dem Antwortfeld steht.
   *
   * Zwei Fragen brauchen das: Die Vorsorgevollmacht, weil das Wort ohne seine
   * Erklärung eine Fachvokabel ist, und die Bestattung, weil dort nicht nach
   * einer Auskunft gefragt wird, sondern nach einem Wunsch — und ein leeres
   * Feld unter "Wünsche für Ihre Bestattung" sagt nicht, was hineingehört.
   *
   * Der Text steht *vor* dem Feld und nicht darunter: Wer ihn erst nach dem
   * Tippen liest, hat ihn zu spät gelesen.
   */
  erlaeuterung?: string
  /**
   * Ein weiterführender Erklärtext hinter dem Antwortfeld dieser Frage.
   *
   * Bisher gibt es genau einen: Wer kein Testament hat, findet unter der Frage
   * danach den Weg zu „So verfassen Sie ein Testament". Die Kennung steht
   * hier und nicht als Adresse, weil die Inhaltsschicht keine Routen kennt
   * (§9) — welcher Screen dazugehört, entscheidet der Screen.
   */
  anschluss?: 'testament'
}

