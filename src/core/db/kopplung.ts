/**
 * Kopplungscodes als schmale Tabelle (DESIGN.md §6, §4).
 *
 * `pairing_codes` ist die einzige Tabelle dieses Projekts, die überhaupt kein
 * Leserecht kennt: keine Policy, kein `grant`. Deshalb hat dieser Port keine
 * Abfragen, sondern nur drei RPCs. Sie sind der ganze Weg an diese Zeilen.
 *
 * ```
 * erzeugeCode      §6 Schritt 2   beitretende Seite bekommt acht Zeichen
 * loeseEin         §6 Schritt 4   einladende Seite sieht, wer da ist
 * schliesseAb      §6 Schritt 6   nach dem mündlichen Abgleich: Schlüssel hoch
 * ```
 *
 * Zwischen Schritt 4 und 6 liegt der Prüfcode-Abgleich (§3.6). Dass es zwei
 * Aufrufe sind und nicht einer, ist deshalb keine Umständlichkeit, sondern die
 * Stelle, an der zwei Menschen miteinander sprechen.
 */

import type { Wrap } from '../crypto/wrap'

/** `join` holt eine Person in einen Fall, `device` ein zweites eigenes Gerät. */
export type Kopplungszweck = 'join' | 'device'

export type Kopplungscode = {
  /** Acht Zeichen, ohne O/0/I/1. Ungruppiert, so wie er in der Tabelle steht. */
  code: string
  /** ISO-Zeitstempel. 15 Minuten nach der Ausgabe (§6). */
  laeuftAbAm: string
}

/**
 * Warum eine Einlösung nicht durchging.
 *
 * Kein Wurf, sondern ein Wert: Jeder Versuch zählt gegen das Rate-Limit, und
 * eine Ausnahme rollte die Zählung mit zurück (§4). Für die Oberfläche ist das
 * ein Gewinn, denn sie kann sagen, was nicht stimmt.
 */
export type Einloesungsstatus =
  | 'ok'
  | 'gesperrt'
  | 'unbekannt'
  | 'abgelaufen'
  | 'verbraucht'
  | 'selbst'
  | 'fremd'

/** Was die einladende Seite sieht, bevor sie bestätigt (§6, Schritt 4). */
export type Kopplungsangebot = {
  zweck: Kopplungszweck
  /** Clerk `sub` der beitretenden Seite. */
  userId: string
  anzeigename: string
  email: string | null
  /** Das Gerät, an das gewrappt wird. */
  geraeteId: string
  pkKem: Uint8Array
  pkSig: Uint8Array
}

/**
 * `Exclude<..., 'ok'>` in der zweiten Variante, damit TypeScript am `status`
 * unterscheiden kann: Stünde dort der volle Statustyp, wäre `ok` in beiden
 * Varianten möglich und `angebot` nie sicher da.
 */
export type Einloesung =
  | { status: 'ok'; angebot: Kopplungsangebot }
  | { status: Exclude<Einloesungsstatus, 'ok'> }

/** Was `schliesse_kopplung_ab` für einen einzelnen Fall braucht (§6, Schritt 6). */
export type Kopplungsabschluss = {
  code: string
  fallId: string
  kidFall: string
  kidKatalog: string
  /** Das wrappende Gerät. Es gehört der bestätigenden Person. */
  absenderId: string
  wrapFall: Wrap
  wrapKatalog: Wrap
}

export type KopplungTabelle = {
  erzeugeCode(geraeteId: string, zweck: Kopplungszweck): Promise<Kopplungscode>

  loeseEin(code: string): Promise<Einloesung>

  /**
   * Legt Mitgliedschaft (nur bei `join`) und beide Wraps in einem Zug an.
   *
   * Mehrfach aufrufbar mit demselben Code: Ein `device`-Code schaltet alle
   * Fälle frei, die das freigebende Gerät lesen kann (§4).
   */
  schliesseAb(abschluss: Kopplungsabschluss): Promise<void>
}
