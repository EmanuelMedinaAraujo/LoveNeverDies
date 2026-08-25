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

/** Die drei Aufgaben, die aus dem Baum entstehen können (ERBE_DESIGN.md §7). */
export type Aufgabenvorlage = 'testament' | 'ausschlagung' | 'anfechtung'

/**
 * Das Thema eines Infoknotens.
 *
 * Der Export nennt nur das Thema ("Infos zu Erbschein"), nicht den Text. Der
 * Text kommt von den Juristinnen; bis dahin sagt die Erläuterung genau das
 * und erfindet nichts (DESIGN.md §8).
 */
export type Infothema = 'erbschein' | 'nachlassgericht'

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
   * Steht heute an genau einer Frage, "Wollen Sie das Erbe haben?": Im Export
   * war der Hinweis eine eigene Seite hinter einer Kette mit nur einer Antwort
   * (ERBE_DESIGN.md §2).
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
   * falsch. Der Tag wandert deshalb in die Notizen der Aufgabe.
   */
  anfechtungsdatum?: boolean
  /** Der Erbstatus, den dieses Ergebnis begruendet, oder keiner. */
  status?: Erbstatus
  antworten: Antwort[]
}
