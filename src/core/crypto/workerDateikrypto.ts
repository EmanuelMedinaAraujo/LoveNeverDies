/**
 * {@link Dateikrypto} in einem Worker (DESIGN.md §7).
 *
 * §7 verlangt die Verschlüsselung „außerhalb des Main-Threads, damit die
 * Oberfläche nicht einfriert". Dieses Modul ist die eine Stelle, an der ein
 * Worker vorkommt; alles darüber kennt nur den Port.
 *
 * **Ein Worker, mehrere Aufträge.** Er entsteht beim ersten Auftrag und bleibt
 * stehen, bis jemand {@link Dateikrypto.schliesse} ruft. Ein Worker je Datei
 * kostete bei jedem Klick einen Modulstart; einer, der nie entsteht, kostet
 * nichts — und die meisten Sitzungen laden nie ein Dokument hoch.
 *
 * **Wo kein `Worker` ist, wird auf dem Main-Thread gerechnet.** Der Rückfall
 * steht in `dateikrypto.ts` und ist ausdrücklich benannt: Eine App, die ohne
 * Worker gar keine Dokumente mehr öffnet, wäre der teurere Fehler.
 */

import {
  DateikryptoFehler,
  direkteDateikrypto,
  type Dateikrypto,
  type Kryptoantwort,
  type Kryptoauftrag,
} from './dateikrypto'

/**
 * Der Worker aus dem eigenen Bündel.
 *
 * `new URL(…, import.meta.url)` ist die Form, die der Bundler erkennt und
 * mitbaut — ein Pfad als Zeichenkette wäre nach dem Bauen ein 404. `module`,
 * weil der Worker `dateikrypto.ts` importiert.
 */
function standardWorker(): Worker {
  return new Worker(new URL('./dateiWorker.ts', import.meta.url), { type: 'module' })
}

type Offen = {
  aufloesen: (daten: Uint8Array) => void
  ablehnen: (fehler: Error) => void
}

/**
 * @param erzeugeWorker die Werkbank. Ohne Angabe der Worker dieses Bündels,
 * sofern die Laufzeit einen kennt; die Tests schieben eine Attrappe unter, weil
 * ein echter Worker ausser dem Zustellen von Nachrichten nichts beiträgt, was
 * hier zu prüfen wäre.
 *
 * Eine übergebene Werkbank schlägt den Rückfall: Wer eine mitbringt, hat eine
 * — die Frage nach `globalThis.Worker` stellt sich dann gar nicht.
 */
export function workerDateikrypto(erzeugeWorker?: () => Worker): Dateikrypto {
  if (erzeugeWorker === undefined && typeof Worker === 'undefined') {
    return direkteDateikrypto()
  }

  const erzeuge = erzeugeWorker ?? standardWorker

  let worker: Worker | null = null
  let naechsteNummer = 0
  const offen = new Map<number, Offen>()

  /** Ob {@link Dateikrypto.schliesse} gerufen wurde und noch etwas läuft. */
  let schliesstNach = false

  /**
   * Bricht alles Wartende ab.
   *
   * Ein Worker, der stirbt, nimmt jeden laufenden Auftrag mit. Ohne diese
   * Zeile bliebe der Fortschrittsbalken für immer stehen — schlimmer als eine
   * Fehlermeldung, weil niemand weiss, worauf er wartet.
   */
  function brichAb(grund: string) {
    for (const { ablehnen } of offen.values()) {
      ablehnen(new DateikryptoFehler(grund))
    }

    offen.clear()
  }

  /**
   * Beendet den Worker, sobald nichts mehr wartet.
   *
   * Getrennt vom Abbrechen, und das ist der Punkt: Ein Aufruf von
   * {@link Dateikrypto.schliesse} kommt in aller Regel daher, dass ein Screen
   * verschwindet — und der laufende Auftrag ist dann trotzdem echte Arbeit,
   * hinter der eine Datei steht, die gleich hochgeladen wird. Die
   * Promise-Kette darüber lebt weiter, auch wenn niemand mehr hinsieht; das
   * Dokument kommt also an, und der nächste Abgleich zeigt es. Ihn hier
   * abzubrechen hiesse, ein fertig verschlüsseltes Foto wegzuwerfen, ohne dass
   * irgendwo etwas davon stünde.
   */
  function beendeWennLeer() {
    if (!schliesstNach || offen.size > 0) {
      return
    }

    worker?.terminate()
    worker = null
    schliesstNach = false
  }

  function werkbank(): Worker {
    if (worker !== null) {
      return worker
    }

    const frisch = erzeuge()

    frisch.addEventListener('message', (ereignis: MessageEvent<Kryptoantwort>) => {
      const antwort = ereignis.data
      const wartend = offen.get(antwort.nummer)

      if (wartend === undefined) {
        return
      }

      offen.delete(antwort.nummer)

      if (antwort.ok) {
        wartend.aufloesen(antwort.daten)
      } else {
        wartend.ablehnen(new DateikryptoFehler(antwort.fehler))
      }

      beendeWennLeer()
    })

    frisch.addEventListener('error', () => {
      // Der Worker ist hin. Der nächste Auftrag baut einen neuen auf — was
      // ihn umgebracht hat, war entweder einmalig oder wiederholt sich, und
      // dann sagt es die nächste Fehlermeldung erneut.
      worker = null
      schliesstNach = false
      frisch.terminate()
      brichAb('Die Dateiverschlüsselung ist abgestürzt. Bitte versuchen Sie es noch einmal.')
    })

    worker = frisch
    return frisch
  }

  function beauftrage(was: Kryptoauftrag['was'], schluessel: Uint8Array, daten: Uint8Array) {
    const nummer = naechsteNummer++

    return new Promise<Uint8Array>((aufloesen, ablehnen) => {
      offen.set(nummer, { aufloesen, ablehnen })

      /*
       * Der Auftrag reist als Kopie, nicht als Transferable: Die Bytes gehören
       * dem Aufrufer, und ein Puffer, den das Absenden leert, wäre eine Falle
       * für seine nächste Zeile. Die Antwort kommt umgekehrt als Transferable
       * zurück (siehe `dateiWorker.ts`) — sie gehört niemandem sonst.
       */
      werkbank().postMessage({ nummer, was, schluessel, daten } satisfies Kryptoauftrag)
    })
  }

  return {
    verschluessele: (dek, klartext) => beauftrage('verschluesseln', dek, klartext),
    entschluessele: (dek, blob) => beauftrage('entschluesseln', dek, blob),

    /**
     * Gibt den Worker frei — nicht mitten im Satz, sondern nach dem letzten
     * Auftrag (siehe {@link beendeWennLeer}).
     */
    schliesse() {
      schliesstNach = true
      beendeWennLeer()
    },
  }
}
