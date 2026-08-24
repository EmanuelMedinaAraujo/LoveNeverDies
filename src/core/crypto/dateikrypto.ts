/**
 * Dateien ver- und entschlüsseln, ohne die Oberfläche anzuhalten
 * (DESIGN.md §7, §3.1).
 *
 * §7: „Pro Datei ein zufälliger DEK, clientseitig AES-256-GCM […] Die
 * Verschlüsselung läuft außerhalb des Main-Threads, damit die Oberfläche nicht
 * einfriert."
 *
 * Kryptographisch passiert hier nichts Neues: Eine Datei geht durch dieselben
 * beiden Funktionen aus `aead.ts` wie jeder Payload, unter demselben
 * Envelope-Format (§3.2). Neu ist ausschließlich der **Ort** — ein Worker
 * statt des Main-Threads.
 *
 * Dieses Modul trägt deshalb zwei Dinge und keine dritte Kryptographie:
 *
 *   - {@link Dateikrypto}, den Port. Wer eine Datei verschlüsselt, weiß nicht,
 *     wo es geschieht.
 *   - Das Protokoll zwischen Main-Thread und Worker, samt der Ausführung eines
 *     einzelnen Auftrags. Sie steht hier und nicht im Worker, weil sie sich so
 *     ohne Worker prüfen lässt.
 *
 * Warum überhaupt ein Worker, wo `subtle.encrypt` schon ein Promise liefert:
 * Ein Promise sagt nichts darüber, wo gerechnet wird. Bei 15 MB ist das der
 * Unterschied zwischen einer Fortschrittsanzeige, die sich dreht, und einer,
 * die steht.
 */

import { entschluessele, verschluessele } from './aead'

/** Eine Datei war nicht zu ver- oder zu entschlüsseln. */
export class DateikryptoFehler extends Error {
  constructor(nachricht: string) {
    super(nachricht)
    this.name = 'DateikryptoFehler'
  }
}

/** Ver- und Entschlüsseln einer ganzen Datei — irgendwo. */
export type Dateikrypto = {
  /** @param dek der Schlüssel dieser Datei, 32 Byte (§3.1). */
  verschluessele(dek: Uint8Array, klartext: Uint8Array): Promise<Uint8Array>
  entschluessele(dek: Uint8Array, blob: Uint8Array): Promise<Uint8Array>
  /**
   * Gibt frei, was hinter dem Port steht. Ohne Worker ein Nulleffekt — und
   * genau deshalb steht die Methode am Port und nicht nur an der einen
   * Umsetzung, die etwas freizugeben hat.
   */
  schliesse(): void
}

/** Was der Main-Thread dem Worker aufträgt. */
export type Kryptoauftrag = {
  /** Ordnet die Antwort dem Auftrag zu. Ein Worker bearbeitet mehrere. */
  nummer: number
  was: 'verschluesseln' | 'entschluesseln'
  schluessel: Uint8Array
  daten: Uint8Array
}

/**
 * Was zurückkommt.
 *
 * Ein Fehlschlag reist als Feld und nicht als geworfener Fehler: Über
 * `postMessage` kommt von einem `Error` nur eine Meldung ohne Typ an, und ein
 * `onerror` am Worker wüsste nicht, welcher Auftrag gescheitert ist.
 */
export type Kryptoantwort =
  | { nummer: number; ok: true; daten: Uint8Array }
  | { nummer: number; ok: false; fehler: string }

/**
 * Führt genau einen Auftrag aus — im Worker, im Test aber auch ohne ihn.
 *
 * Der Fehlschlag beim Entschlüsseln ist hier kein Sonderfall des privaten
 * Items (§3.7): Eine Datei, die sich unter ihrem eigenen DEK nicht öffnen
 * lässt, ist beschädigt, und das gehört gesagt.
 */
export async function fuehreAuftragAus(auftrag: Kryptoauftrag): Promise<Kryptoantwort> {
  try {
    const daten =
      auftrag.was === 'verschluesseln'
        ? await verschluessele(auftrag.schluessel, auftrag.daten)
        : await entschluessele(auftrag.schluessel, auftrag.daten)

    return { nummer: auftrag.nummer, ok: true, daten }
  } catch (ursache) {
    return {
      nummer: auftrag.nummer,
      ok: false,
      fehler: ursache instanceof Error ? ursache.message : String(ursache),
    }
  }
}

/**
 * Die Umsetzung ohne Worker: dieselbe Kryptographie, auf dem Main-Thread.
 *
 * Sie ist kein Zweitweg, sondern der Rückfall für eine Laufzeit ohne `Worker`
 * — ältere Browser, `jsdom`, die Edge Function. Eine App, die dort gar keine
 * Dokumente mehr anzeigt, wäre der teurere Fehler als eine, die für einen
 * Moment steht.
 */
export function direkteDateikrypto(): Dateikrypto {
  return {
    verschluessele: (dek, klartext) => verschluessele(dek, klartext),
    entschluessele: (dek, blob) => entschluessele(dek, blob),
    schliesse: () => {},
  }
}
