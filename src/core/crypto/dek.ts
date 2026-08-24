/**
 * Der DEK pro Item (DESIGN.md §3.1, §3.2).
 *
 * ```
 * payload      = AES-256-GCM(DEK, Klartext)
 * wrapped_dek  = AES-256-GCM(K_c, DEK)          48 Byte Nutzlast
 * ```
 *
 * Zwei Stufen statt einer, und der Grund steht in §3.1: Eine Rotation von `K_c`
 * (§3.4) muss dann nur die 32 Byte des DEKs neu wrappen. Der Payload wird nie
 * neu verschlüsselt und eine 15-MB-Datei nie neu hochgeladen. Ein Fall mit 40
 * Aufgaben und 10 Scans kostet wenige Kilobyte statt hunderte Megabyte.
 *
 * Der DEK ändert sich nie. Was rotiert, ist ausschließlich der Schlüssel,
 * unter dem er liegt: `K_c`, `K_v` bei Tresor-Items oder `K_p` bei privaten
 * (§3.7). Welcher es ist, sagt das `kid` der Zeile. Dieses Modul sieht davon
 * nichts und braucht es auch nicht, denn gewrappt wird symmetrisch und immer
 * gleich.
 *
 * Ein eigenes Modul und kein direkter Aufruf von {@link verschluessele}: Der
 * Unterschied zwischen "irgendein Ciphertext" und "ein Schlüssel" ist die
 * Längenprüfung beim Entpacken, und die gehört an genau eine Stelle.
 */

import {
  SCHLUESSEL_LAENGE,
  entschluessele,
  erzeugeAesSchluessel,
  verschluessele,
  type SchluesselMaterial,
} from './aead'

/** Ein DEK war nicht zu wrappen oder das Entpackte war keiner. */
export class DekFehler extends Error {
  constructor(nachricht: string) {
    super(nachricht)
    this.name = 'DekFehler'
  }
}

/** Ein frischer DEK: 32 Byte Zufall, pro Item oder pro Datei (§3.1). */
export function erzeugeDek(): Uint8Array {
  return erzeugeAesSchluessel()
}

/**
 * Wrappt `dek` unter dem Schlüssel, der für dieses Item gilt.
 *
 * @param schluessel `K_c`, `K_v` oder `K_p`, was das `kid` der Zeile benennt.
 * @throws {DekFehler} wenn `dek` keine 32 Byte hat. Ein kürzerer Schlüssel wäre
 * schwächer, als das Format verspricht, und fiele erst weit später auf.
 */
export async function wrappeDek(
  schluessel: SchluesselMaterial,
  dek: Uint8Array,
): Promise<Uint8Array> {
  if (dek.length !== SCHLUESSEL_LAENGE) {
    throw new DekFehler(
      `Ein DEK muss ${SCHLUESSEL_LAENGE} Byte lang sein, war ${dek.length}.`,
    )
  }

  return verschluessele(schluessel, dek)
}

/**
 * Entpackt einen `wrapped_dek`.
 *
 * @throws {AeadFehler} wenn der GCM-Tag nicht passt. Das ist der Normalfall bei
 * einem privaten Item einer anderen Person (§3.7): Der Aufrufer verwirft die
 * Zeile still, statt einen Defekt zu melden.
 * @throws {DekFehler} wenn der Tag zwar passt, aber kein Schlüssel herauskommt.
 * Dann liegt ein echter Defekt vor, und er gehört an diese Stelle statt in eine
 * spätere Fehlermeldung über einen Payload, der sich nicht lesen lässt.
 */
export async function entpackeDek(
  schluessel: SchluesselMaterial,
  gewrappt: Uint8Array,
): Promise<Uint8Array> {
  const dek = await entschluessele(schluessel, gewrappt)

  if (dek.length !== SCHLUESSEL_LAENGE) {
    throw new DekFehler(
      `Im wrapped_dek steckten ${dek.length} Byte statt ${SCHLUESSEL_LAENGE}. Das ist kein DEK.`,
    )
  }

  return dek
}
