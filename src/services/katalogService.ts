/**
 * Den Rechtskatalog in einem Fall instanziieren (DESIGN.md §8).
 *
 * Ein neu angelegter Trauerfall ist nicht leer. Er enthält die Aufgabenliste
 * der Juristinnen — verschlüsselt wie jedes andere Item, mit Rechtsgrundlage,
 * Frist und Quelle in den Payload kopiert.
 *
 * **Instanziierung ist strukturell idempotent.** Zwei Mitglieder können
 * gleichzeitig beginnen; koordinieren kann der Server das nicht, denn er sieht
 * nur Ciphertext. Statt eines Mandats mit Ablauf und Aufräumlogik rechnet jedes
 * Gerät dieselbe Item-ID aus (`katalogItemId`), und ein `insert … on conflict
 * do nothing` macht aus dem zweiten Anlauf einen Nulleffekt.
 *
 * **Der Katalog initialisiert, mehr nicht.** Danach sind es gewöhnliche Items:
 * frei änderbar, ergänzbar, löschbar. Eine gelöschte Katalogaufgabe kommt
 * deshalb auch nicht wieder — der Tombstone steht im Bestand, und was im
 * Bestand steht, wird hier nicht noch einmal angelegt.
 *
 * **Warum das nicht durch die Offline-Queue geht** (§5). Die Queue trägt, was
 * jemand getippt hat, und meldet einen Fehlschlag als „konnte nicht gespeichert
 * werden". Hier tippt niemand: Das Anlegen gehört zum Übergang nach
 * `trauerfall`, der ohnehin online stattfindet, und ein Duplikat ist kein
 * Fehlschlag, sondern der Normalfall des Rennens. Vierzig Aufgaben als vierzig
 * Queue-Einträge wären zudem vierzig Rundläufe und vierzig mögliche
 * Mitteilungen über eine Ablehnung, die keine ist.
 */

import { katalog as ausgelieferterKatalog } from '../content/katalog'
import { katalogItemId } from '../core/crypto/katalogId'
import type { InhalteTabelle, NeuerInhalt } from '../core/db/inhalte'
import type { Katalog, Katalogaufgabe } from '../types/katalog'
import {
  verschluesselterInhalt,
  type Aufgabenpayload,
  type Fallschluessel,
} from './aufgabenService'

/** Die Instanziierung war nicht durchzuführen. */
export class KatalogFehler extends Error {
  constructor(nachricht: string) {
    super(nachricht)
    this.name = 'KatalogFehler'
  }
}

/**
 * Was die Instanziierung vom Fall braucht.
 *
 * `kcat` steht neben `kc`, weil beide gebraucht werden und beide etwas anderes
 * tun: `K_c` wrappt die DEKs, `K_cat` erzeugt die IDs. Getrennt sind sie, weil
 * `K_c` rotiert und `K_cat` nie (§3.4, §8) — zwei Mitglieder auf verschiedenen
 * `K_c`-Generationen rechnen trotzdem dieselben IDs aus.
 */
export type Katalogfall = Fallschluessel & {
  kcat: Uint8Array
  /** Der eingefrorene Katalogstand des Falls, `null` bei einem Vorsorgefall. */
  katalogVersion: string | null
}

/**
 * Eine Katalogaufgabe als Payload eines Items (§8).
 *
 * Titel und Kurzbeschreibung werden die Aufgabe selbst — änderbar wie bei jeder
 * anderen. Alles Übrige wird ihre Herkunft und altert mit ihr: Rechtsgrundlage,
 * Frist, zuständige Stelle und Quelle stehen ab jetzt im Item und nicht mehr im
 * Katalog.
 */
function payloadAus(aufgabe: Katalogaufgabe, version: string): Aufgabenpayload {
  const { id, titel, kurzbeschreibung, ...uebriges } = aufgabe

  return {
    typ: 'aufgabe',
    titel,
    beschreibung: kurzbeschreibung,
    erledigt: false,
    katalog: { ...uebriges, aufgabeId: id, version },
  }
}

/**
 * Prüft, dass dieser Build den Stand kennt, der für den Fall eingefroren ist.
 *
 * Ein Fall trägt seinen Katalogstand (§8). Ein Client mit einem anderen Build
 * dürfte nicht einfach seinen eigenen Katalog hineinschreiben — die Items
 * trügen dann eine Herkunft, die der Fall nie hatte, und zwei Mitglieder
 * legten verschiedene Aufgaben mit verschiedenen IDs an.
 */
function pruefeStand(katalog: Katalog, fall: Katalogfall): void {
  if (fall.katalogVersion === null) {
    throw new KatalogFehler(
      'Dieser Fall hat keinen eingefrorenen Katalogstand. Instanziiert wird erst beim Übergang nach "trauerfall" (§8).',
    )
  }

  if (fall.katalogVersion !== katalog.version) {
    throw new KatalogFehler(
      `Der Fall ist auf Katalogstand ${fall.katalogVersion} aufgesetzt, diese App bringt ${katalog.version} mit.`,
    )
  }
}

/**
 * Die Zeilen, die diesem Fall aus dem Katalog noch fehlen — fertig
 * verschlüsselt.
 *
 * @param katalog der Stand, den dieser Build mitbringt. Als Parameter und
 * nicht als Import, weil `hooks` die Schicht `content` nicht sehen darf (§9)
 * und weil die Tests einen eigenen Stand vorgeben können — die Voreinstellung
 * ist der ausgelieferte.
 * @param vorhandeneIds die IDs aller Items des Falls, **Tombstones
 * eingeschlossen**. Eine gelöschte Katalogaufgabe ist erledigt und nicht
 * abwesend; stünde sie nicht in dieser Menge, legte der nächste Start sie
 * wieder an.
 * @throws {KatalogFehler} wenn der Fall auf einem anderen Katalogstand steht.
 */
export async function fehlendeKatalogitems(
  fall: Katalogfall,
  vorhandeneIds: Iterable<string>,
  katalog: Katalog = ausgelieferterKatalog(),
): Promise<NeuerInhalt[]> {
  pruefeStand(katalog, fall)

  const bekannt = new Set(vorhandeneIds)

  const zeilen = await Promise.all(
    katalog.aufgaben.map(async (aufgabe) => {
      const id = await katalogItemId(fall.kcat, fall.id, aufgabe.id)

      return bekannt.has(id)
        ? null
        : await verschluesselterInhalt(fall, id, payloadAus(aufgabe, katalog.version))
    }),
  )

  return zeilen.filter((zeile): zeile is NeuerInhalt => zeile !== null)
}

/**
 * Instanziiert den Katalog: rechnen, was fehlt, und es in einem Zug anlegen.
 *
 * @returns wie viele Zeilen hinausgingen. Das ist nicht, wie viele entstanden
 * sind — was ein anderes Mitglied im selben Moment angelegt hat, übergeht das
 * `on conflict` still, und genau dafür ist es da.
 */
export async function instanziiereKatalog(
  inhalte: InhalteTabelle,
  fall: Katalogfall,
  vorhandeneIds: Iterable<string> = [],
  katalog: Katalog = ausgelieferterKatalog(),
): Promise<number> {
  const fehlende = await fehlendeKatalogitems(fall, vorhandeneIds, katalog)

  await inhalte.legeAlleNeuen(fehlende)

  return fehlende.length
}
