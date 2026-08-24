/**
 * Die Entscheidung der Edge Function `vault-release` (DESIGN.md §3.5, §9).
 *
 * Getrennt von `index.ts`, und zwar aus einem Grund: Was diese Funktion
 * entscheidet, muss geprüft sein (§10), und geprüft werden kann nur, was ohne
 * Deno-Laufzeit, ohne HTTP und ohne Datenbank läuft. Hier steht deshalb
 * ausschliesslich die Reihenfolge der Prüfungen; woher Gerät, Mitgliedschaft
 * und Zeile kommen, sagt der Zugang, den `index.ts` daneben stellt.
 *
 * Die Kryptographie kommt aus `src/core/crypto`. Das ist kein Zufall und kein
 * Umweg: §9 verlangt, dass der Kern ohne Browser-Abhängigkeiten auskommt,
 * damit die Function dieselben Bytes baut und dieselbe
 * `@noble/post-quantum`-Version benutzt wie der Client. Zwei Implementierungen
 * derselben Domain-Präfixe wären zwei Gelegenheiten, sie auseinanderlaufen zu
 * lassen.
 *
 * Was diese Funktion **nicht** prüfen kann: ob der Share der richtige ist. Er
 * liegt unter `K_c`, und den hat der Server nie gesehen. Sie weiss
 * ausschliesslich, dass eine authentifizierte Person X diesen Blob signiert
 * hat. Deshalb löst der Zähler der Freigaben nichts aus (§3.5).
 */

import { ByteaFehler, ausBytea } from '../../../src/core/db/bytea.ts'
import { freigabeNachricht } from '../../../src/core/crypto/commitment.ts'
import { DOMAIN_SEPARATION } from '../../../src/core/crypto/domain.ts'
import { signaturSchluesselAusBytes, verifiziere } from '../../../src/core/crypto/sign.ts'

/** Ein Request-Body war nicht zu lesen. */
export class FreigabeFehler extends Error {
  constructor(nachricht: string) {
    super(nachricht)
    this.name = 'FreigabeFehler'
  }
}

/**
 * Was der Client schickt.
 *
 * Ohne `user_id`: Sie kommt aus dem geprüften Token und nie aus dem Body
 * (§3.5). Ein Feld dafür gäbe es hier nur, damit jemand es füllt.
 */
export type Freigabeanfrage = {
  caseId: string
  /** Das Gerät, das signiert hat. Es muss der angemeldeten Person gehören. */
  deviceId: string
  /** Die `K_c`-Generation, unter der `releasedShare` liegt (§3.4, §3.5). */
  kid: string
  releasedShare: Uint8Array
  signatur: Uint8Array
}

export type Freigabegeraet = {
  userId: string
  /** `device_keys.sig_public_key`: ML-DSA-65-pk ‖ Ed25519-pk. */
  pkSig: Uint8Array
}

export type NeueFreigabe = {
  caseId: string
  userId: string
  geraeteId: string
  /**
   * Die `K_c`-Generation, unter der `releasedShare` liegt.
   *
   * Sie muss in die Zeile, nicht nur in die Signatur: Ohne sie wüsste das
   * öffnende Gerät nicht, unter welcher Generation der Blob liegt (§3.4, §3.5).
   */
  kid: string
  releasedShare: Uint8Array
  signatur: Uint8Array
}

export type Freigabezugang = {
  geraet(deviceId: string): Promise<Freigabegeraet | null>
  istMitglied(caseId: string, userId: string): Promise<boolean>
  /** `insert … on conflict (case_id, user_id) do update` (§3.5). */
  schreibe(freigabe: NeueFreigabe): Promise<void>
}

export type Freigabeergebnis = {
  status: number
  koerper: { angenommen: true } | { fehler: string }
}

function text(koerper: Record<string, unknown>, feld: string): string {
  const wert = koerper[feld]

  if (typeof wert !== 'string' || wert === '') {
    throw new FreigabeFehler(`Das Feld ${feld} fehlt oder ist leer.`)
  }

  return wert
}

/**
 * Ein Byte-Feld, kodiert wie jede `bytea`-Spalte dieses Projekts (§4).
 *
 * Dieselbe Kodierung wie auf dem Weg in die Tabelle und dieselbe wie in jedem
 * anderen Adapter: `\x`-Hex. Eine zweite Kodierung nur für diesen einen
 * Request-Body wäre eine zweite Stelle, an der Bytes falsch ankommen können.
 */
function bytes(koerper: Record<string, unknown>, feld: string): Uint8Array {
  try {
    return ausBytea(text(koerper, feld))
  } catch (ursache) {
    if (ursache instanceof ByteaFehler) {
      throw new FreigabeFehler(`Das Feld ${feld} kam nicht als bytea-Hex an: ${ursache.message}`)
    }

    throw ursache
  }
}

/**
 * Liest den Request-Body.
 *
 * @throws {FreigabeFehler} bei allem, was nicht die Form aus §3.5 hat. Ein
 * fehlendes Feld ist ein Fehler des Clients und keine abgewiesene Freigabe:
 * Der Unterschied steht später im Statuscode.
 */
export function leseFreigabeanfrage(koerper: unknown): Freigabeanfrage {
  if (typeof koerper !== 'object' || koerper === null || Array.isArray(koerper)) {
    throw new FreigabeFehler('Der Request-Body ist kein Objekt.')
  }

  const felder = koerper as Record<string, unknown>

  return {
    caseId: text(felder, 'caseId'),
    deviceId: text(felder, 'deviceId'),
    kid: text(felder, 'kid'),
    releasedShare: bytes(felder, 'releasedShare'),
    signatur: bytes(felder, 'signatur'),
  }
}

function abgewiesen(grund: string): Freigabeergebnis {
  return { status: 403, koerper: { fehler: grund } }
}

/**
 * Prüft eine Freigabe und schreibt sie, wenn sie durchkommt.
 *
 * Die Reihenfolge ist Absicht: Herkunft, dann Zugehörigkeit, dann
 * Kryptographie. Eine ML-DSA-Prüfung kostet mehr als zwei Abfragen, und wer
 * gar nicht im Fall ist, soll sie nicht auslösen können.
 *
 * @param userId der `sub` aus dem geprüften Token — **nie** aus dem Body
 * (§3.5). Er geht auch in die Nachricht ein, gegen die verifiziert wird: Eine
 * Signatur über eine fremde Kennung passt damit nicht mehr.
 * @returns 200 und eine geschriebene Zeile, oder 403 und keine.
 */
export async function nimmFreigabeAn(
  anfrage: Freigabeanfrage,
  userId: string,
  zugang: Freigabezugang,
): Promise<Freigabeergebnis> {
  const geraet = await zugang.geraet(anfrage.deviceId)

  if (geraet === null || geraet.userId !== userId) {
    return abgewiesen('Dieses Gerät gehört nicht zur angemeldeten Person.')
  }

  if (!(await zugang.istMitglied(anfrage.caseId, userId))) {
    return abgewiesen('Sie sind kein Mitglied dieses Falls.')
  }

  const nachricht = await freigabeNachricht({
    caseId: anfrage.caseId,
    userId,
    kid: anfrage.kid,
    releasedShare: anfrage.releasedShare,
  })

  let gilt: boolean
  try {
    gilt = verifiziere(
      anfrage.signatur,
      DOMAIN_SEPARATION.vaultRelease,
      nachricht,
      signaturSchluesselAusBytes(geraet.pkSig),
    )
  } catch {
    // Ein Envelope aus einer fremden Version, ein abgeschnittener öffentlicher
    // Schlüssel: beides ist hier "verifiziert nicht" und keine Ausnahme, die
    // den Aufrufer etwas anginge.
    gilt = false
  }

  if (!gilt) {
    return abgewiesen('Die Signatur dieser Freigabe stimmt nicht.')
  }

  await zugang.schreibe({
    caseId: anfrage.caseId,
    userId,
    geraeteId: anfrage.deviceId,
    kid: anfrage.kid,
    releasedShare: anfrage.releasedShare,
    signatur: anfrage.signatur,
  })

  return { status: 200, koerper: { angenommen: true } }
}
