/**
 * Shamir: `K_v` in Teile zerlegen und wieder zusammensetzen (DESIGN.md §3.5).
 *
 * Der Preparer behält `K_v`. Nach seinem Tod ist der Split der einzige Zugang:
 * `n` Angehörige halten je einen Teil, `k = max(1, ⌈2n/3⌉)` davon rekonstruieren
 * den Schlüssel.
 *
 * **Zwei Dinge tut dieses Modul bewusst nicht.**
 *
 * Es kennt `n = 1` nicht. Die Bibliothek verlangt `shares ≥ 2` und
 * `threshold ≥ 2`, und bei einem einzigen Angehörigen ist `share_1 = K_v` ohnehin
 * ein Direktwrap statt eines Splits — die einzige Verzweigung im ganzen
 * Tresorpfad, und sie gehört dorthin, nicht hierher.
 *
 * Und es sagt nicht, ob eine Kombination gelungen ist. Aus zu wenigen Teilen
 * fallen bereitwillig Bytes, nur eben die falschen; Shamir kann das nicht
 * bemerken. Genau deshalb hängt die Entscheidung in §3.5 am
 * `vault_commitment` über dem rekonstruierten `K_v` und nicht am Zähler der
 * Freigaben.
 */

import { combine, split } from 'shamir-secret-sharing'

/** Die Bibliothek arbeitet mit 1 Byte Index pro Teil. */
export const MAX_SHARES = 255

/** Unter `shares ≥ 2` und `threshold ≥ 2` arbeitet die Bibliothek nicht. */
export const MIN_SHARES = 2

/** Ein Split oder eine Kombination war so nicht möglich. */
export class ShamirFehler extends Error {
  constructor(nachricht: string) {
    super(nachricht)
    this.name = 'ShamirFehler'
  }
}

/**
 * Zerlegt `geheimnis` in `anzahl` Teile, von denen `schwelle` genügen.
 *
 * Jeder Aufruf zieht ein frisches Polynom. Teile aus zwei Aufrufen liegen auf
 * verschiedenen Kurven und lassen sich nicht mischen — das ist der Grund,
 * warum eine Neuverteilung die Teile der vorigen Runde wertlos macht, ohne
 * `K_v` selbst anzufassen.
 */
export async function teileGeheimnis(
  geheimnis: Uint8Array,
  anzahl: number,
  schwelle: number,
): Promise<Uint8Array[]> {
  if (anzahl < MIN_SHARES) {
    throw new ShamirFehler(
      `Shamir braucht mindestens ${MIN_SHARES} Teile, gefordert waren ${anzahl}. Ein einzelner Angehöriger bekommt einen Direktwrap von K_v (§3.5), keinen Split.`,
    )
  }

  if (anzahl > MAX_SHARES) {
    throw new ShamirFehler(`Shamir trägt höchstens ${MAX_SHARES} Teile, gefordert waren ${anzahl}.`)
  }

  if (schwelle < MIN_SHARES || schwelle > anzahl) {
    throw new ShamirFehler(
      `Die Schwelle muss zwischen ${MIN_SHARES} und der Zahl der Teile (${anzahl}) liegen, war ${schwelle}.`,
    )
  }

  return split(geheimnis, anzahl, schwelle)
}

/**
 * Setzt Teile zusammen.
 *
 * @returns die rekonstruierten Bytes — auch dann, wenn es zu wenige oder
 * fremde Teile waren. Wer wissen muss, ob das Ergebnis stimmt, prüft es gegen
 * das `vault_commitment` (§3.5).
 * @throws {ShamirFehler} wenn die Teile schon der Form nach nicht zusammenpassen.
 * Das ist kein Randfall: Jedes Mitglied besitzt `K_c` und kann die Freigabe
 * eines anderen mitlesen und als eigene erneut hochladen (§3.5). Beim
 * Zusammensetzen liegen dann zwei gleiche Teile vor, und der Tresorpfad muss
 * das an einem eigenen Fehlertyp erkennen statt an einem Fehlertext der
 * Bibliothek.
 */
export async function kombiniereShares(teile: Uint8Array[]): Promise<Uint8Array> {
  if (teile.length < MIN_SHARES) {
    throw new ShamirFehler(
      `Zum Zusammensetzen braucht es mindestens ${MIN_SHARES} Teile, übergeben waren ${teile.length}.`,
    )
  }

  const laenge = teile[0]?.length ?? 0

  if (laenge < 2) {
    throw new ShamirFehler(`Jeder Teil ist mindestens 2 Byte lang, der erste war ${laenge}.`)
  }

  if (teile.some((teil) => teil.length !== laenge)) {
    throw new ShamirFehler('Die Teile sind verschieden lang und gehören nicht zusammen.')
  }

  // Die Bibliothek unterscheidet Teile am letzten Byte, ihrer Stelle auf der
  // Kurve. Zwei Teile mit derselben Stelle sind derselbe Teil.
  const stellen = new Set(teile.map((teil) => teil[laenge - 1]))

  if (stellen.size !== teile.length) {
    throw new ShamirFehler('Zwei Teile stehen an derselben Stelle der Kurve; einer ist doppelt.')
  }

  return combine(teile)
}
