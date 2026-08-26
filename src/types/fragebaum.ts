/**
 * Der Erbe-Fragebaum als Typ (ERBE_DESIGN.md).
 *
 * Wie beim Rechtskatalog steht die Form in `types` und nicht bei den Daten:
 * Die Inhaltsdatei, der Dienst, der das Ergebnis auswertet, und die Screens
 * brauchen dieselbe Form, und keiner der drei soll die anderen mitziehen (§9).
 */

/**
 * Der Erbstatus einer Person, abgeleitet aus dem erreichten Ergebnis.
 *
 * Sechs Ergebnisse tragen einen Status, die übrigen tragen keinen: Wer auf der
 * Seite zur Testamentsanfechtung landet oder erfährt, wie man ueberhaupt von
 * einem Testament erfährt, hat etwas gelernt, aber nichts über seine
 * Erbenstellung. `null` ist deshalb kein Fehlerfall, sondern eine Aussage.
 *
 * `noch-erbe` ist die Ausschlagung, und die Benennung ist Absicht: Wer
 * ausschlagen will, ist bis zur wirksamen Ausschlagung noch Erbe. Genau deshalb
 * läuft ihm eine Frist (§ 1944 BGB).
 */
export type Erbstatus =
  | 'erbe'
  | 'wahrscheinlich-erbe'
  | 'wahrscheinlich-kein-erbe'
  | 'kein-erbe'
  | 'noch-erbe'

/**
 * Die Aufgaben, die aus dem Baum und aus dem Erbstatus entstehen können
 * (ERBE_DESIGN.md §7).
 *
 * Drei hängen an einem Ergebnisknoten. `erbschein` hängt an keinem: Sie
 * entsteht auf der Erbe-Seite, hinter dem Status "Erbe" (§10). Trotzdem
 * dieselbe Aufzählung und derselbe Bauplan — es ist dieselbe Sorte Aufgabe,
 * privat und auf die anlegende Person zugewiesen, und "höchstens eine je
 * Person und Art" soll für sie genauso gelten.
 */
export type Aufgabenvorlage = 'testament' | 'ausschlagung' | 'anfechtung' | 'erbschein'

/**
 * Das Thema eines Infoknotens.
 *
 * Der Export nennt nur das Thema ("Infos zu Erbschein"), nicht den Text. Der
 * Text kommt von den Juristinnen; bis dahin sagt die Erläuterung genau das
 * und erfindet nichts (DESIGN.md §8).
 *
 * `pflichtteil` ist die Ausnahme: Der Text dazu liegt vor und steht in
 * `infoText`, kein Platzhalter.
 */
export type Infothema = 'erbschein' | 'nachlassgericht' | 'pflichtteil'

/** Eine Antwort und der Knoten, zu dem sie führt. */
export type Antwort = {
  text: string
  /** Die Id des Zielknotens. Jede Antwort trifft einen vorhandenen Knoten. */
  ziel: string
}

export type Fragebaumknoten = {
  /**
   * Undurchsichtig und stabil. Sie steht in der Adresse
   * `/erbe/fragebaum/:knotenId`; ein umnummerierter Knoten macht aus einem
   * geteilten Link eine andere Frage.
   */
  id: string
  /** Ein Ergebnis hat keine Antworten und beendet den Durchlauf. */
  art: 'frage' | 'ergebnis'
  /**
   * Fragetext oder Ergebnistext, Absätze durch `\n` getrennt.
   *
   * `{person}` wird beim Rendern durch den Namen der verstorbenen Person
   * ersetzt: Die Frage nach dem Verwandtschaftsgrad lautet im Baum "Ich bin
   * (Name des Verstorbenen +s)" und ergibt erst mit dem Namen einen Satz.
   */
  text: string
  /**
   * Ein Hinweis unter der Frage.
   *
   * Steht an "Wollen Sie das Erbe haben?" (Schulden-Hinweis) und an
   * "Ich bin {person}s …" (Rechtlicher Hinweis/Disclaimer).
   */
  hinweis?: string
  /** Ein `ℹ`-Knopf im Kopf der Seite, der eine Erläuterung aufklappt. */
  info?: Infothema
  /** Diese Seite bietet an, die Aufgabe anzulegen (ERBE_DESIGN.md §7). */
  aufgabe?: Aufgabenvorlage
  /** Die aufklappbare Karte "Zuständige Stelle ermitteln" (ERBE_DESIGN.md §8). */
  gericht?: boolean
  /**
   * Das Feld für das eigene Kenntnisdatum (§ 1944 BGB, DESIGN.md §8).
   *
   * Es schreibt in dasselbe private `kenntnisAm` wie das Aufgabendetail: ein
   * Datum, eine Ablage.
   */
  kenntnisdatum?: boolean
  /**
   * Das Feld für den Tag, an dem diese Person vom Anfechtungsgrund erfahren
   * hat.
   *
   * Ausdruecklich nicht `kenntnisAm`: Das ist die Kenntnis von Anfall und
   * Berufungsgrund und trägt eine andere Frist. Die beiden zu vermengen ergäbe
   * ein falsch gerechnetes Fristende, und §8 rechnet lieber gar nicht als
   * falsch. Der Tag wandert deshalb sowohl in die Notizen der Aufgabe als auch
   * in das eigene `anfechtungKenntnisAm` (§8), von dem die Anfechtungsfrist
   * tatsächlich abhängt.
   */
  anfechtungsdatum?: boolean
  /**
   * Zeigt den festen Hinweis zur Ausschlagungswirkung über dem Ergebnistext
   * (ERBE_DESIGN.md §7): Wer Nachlassgegenstände verkauft, verschenkt oder
   * nutzt, nimmt das Erbe damit an, auch ohne es zu wollen. Ein deklaratives
   * Flag statt Freitext an jedem der zehn Ausschlagungsknoten, aus demselben
   * Grund wie `kenntnisdatum` und `gericht`: Zehnmal derselbe Satz von Hand
   * gepflegt liefe irgendwann auseinander.
   */
  ausschlagungshinweis?: boolean
  /** Der Erbstatus, den dieses Ergebnis begruendet, oder keiner. */
  status?: Erbstatus
  antworten: Antwort[]
}
