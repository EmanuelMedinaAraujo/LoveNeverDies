/**
 * Der Worker, in dem die Dateikryptographie läuft (DESIGN.md §7).
 *
 * Er enthält absichtlich keine Logik: Was ein Auftrag bedeutet, steht in
 * `dateikrypto.ts` und ist dort ohne Worker prüfbar. Hier steht nur, wie eine
 * Nachricht hinein- und hinausgeht.
 *
 * Die Antwort reist als Transferable. Der Puffer wechselt den Besitzer, statt
 * kopiert zu werden. Bei 15 MB ist das der Unterschied zwischen "gleich da"
 * und einem Ruckler auf dem Main-Thread. Der Auftrag wird dagegen
 * kopiert: Die Datei gehört dem Aufrufer, und ein Puffer, den das Absenden
 * leert, wäre eine Falle für die nächste Zeile in seinem Code.
 */

import { fuehreAuftragAus, type Kryptoantwort, type Kryptoauftrag } from './dateikrypto'

/**
 * `globalThis` im Worker ist ein `DedicatedWorkerGlobalScope`, den die
 * DOM-Typen dieses Projekts nicht kennen. `postMessage` heißt dort ohne
 * `targetOrigin`. Die Umdeutung benennt genau das und nichts weiter.
 */
const bereich = globalThis as unknown as {
  addEventListener(
    typ: 'message',
    hoerer: (ereignis: { data: Kryptoauftrag }) => void,
  ): void
  postMessage(nachricht: Kryptoantwort, uebergabe?: Transferable[]): void
}

bereich.addEventListener('message', (ereignis) => {
  void (async () => {
    const antwort = await fuehreAuftragAus(ereignis.data)

    bereich.postMessage(antwort, antwort.ok ? [antwort.daten.buffer as Transferable] : [])
  })()
})
