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
 * Die Katalog-ID, unter der die `stelle`-te Unteraufgabe einer Katalogaufgabe
 * ihre Item-ID bekommt (§8).
 *
 * Unteraufgaben sind eigene Zeilen (§7), also brauchen sie eigene
 * deterministische IDs — sonst legten zwei gleichzeitig instanziierende
 * Mitglieder jede Unteraufgabe doppelt an. Abgeleitet wird sie aus der ID der
 * Elternaufgabe und der Stelle in ihrer Liste; das `#` kann mit keiner echten
 * Katalog-ID kollidieren, denn die Quelltabelle lässt nur `[a-z0-9-]` zu.
 *
 * Die **Stelle** und nicht der Titel: Ein Tippfehler, den die Juristinnen in
 * einer Unteraufgabe beheben, soll den Text ändern und nicht eine zweite
 * Unteraufgabe anlegen. Innerhalb eines Falls ist der Katalog ohnehin
 * eingefroren (§8) — die Stelle kann sich unter einem laufenden Fall nicht
 * verschieben.
 */
function unteraufgabenPfad(aufgabeId: string, stelle: number): string {
  return `${aufgabeId}#unteraufgabe-${stelle}`
}

/**
 * Eine Katalogaufgabe als Payload eines Items (§8).
 *
 * Titel und Kurzbeschreibung werden die Aufgabe selbst — änderbar wie bei jeder
 * anderen. Alles Übrige wird ihre Herkunft und altert mit ihr: Rechtsgrundlage,
 * Frist, zuständige Stelle und Quelle stehen ab jetzt im Item und nicht mehr im
 * Katalog.
 *
 * @param dependsOn die Item-IDs, in die `haengtAbVon` bereits übersetzt ist.
 * Der Katalog nennt Katalog-IDs, das Item nennt UUIDs (§7) — übersetzt wird
 * genau hier, denn nur hier stehen `K_cat` und die `case_id` beisammen.
 */
function payloadAus(
  aufgabe: Katalogaufgabe,
  version: string,
  dependsOn: string[],
): Aufgabenpayload {
  const { id, titel, kurzbeschreibung, ...uebriges } = aufgabe

  return {
    typ: 'aufgabe',
    titel,
    beschreibung: kurzbeschreibung,
    erledigt: false,
    notizen: '',
    parentId: null,
    dependsOn,
    katalog: { ...uebriges, aufgabeId: id, version },
  }
}

/**
 * Eine Unteraufgabe aus dem Katalog als Payload (§7).
 *
 * Ohne Herkunft, und das mit Absicht: Rechtsgrundlage, Quelle und Frist gehören
 * der Elternaufgabe. Eine Unteraufgabe, die dieselbe Frist noch einmal trüge,
 * zeigte sie doppelt und behauptete zudem, das Gesetz nenne sie einzeln.
 */
function unterpayloadAus(titel: string, parentId: string): Aufgabenpayload {
  return {
    typ: 'aufgabe',
    titel,
    beschreibung: '',
    erledigt: false,
    notizen: '',
    parentId,
    dependsOn: [],
    katalog: null,
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

  /*
   * Zuerst alle Item-IDs, dann erst die Payloads. `dependsOn` einer Aufgabe
   * nennt andere Katalogaufgaben (§8), und deren Item-IDs müssen schon
   * feststehen, wenn ihr Payload geschrieben wird. Der Import stellt sicher,
   * dass jeder Verweis eine Aufgabe derselben Tabelle trifft — der `filter`
   * unten wirft einen unauflösbaren Verweis trotzdem weg, denn ein Verweis
   * ins Leere darf höchstens eine fehlende Abhängigkeit sein und nie ein
   * Absturz beim Anlegen des ganzen Katalogs.
   */
  const itemIds = new Map(
    await Promise.all(
      katalog.aufgaben.map(
        async (aufgabe) =>
          [aufgabe.id, await katalogItemId(fall.kcat, fall.id, aufgabe.id)] as const,
      ),
    ),
  )

  const zeilen: (NeuerInhalt | null)[] = []

  for (const aufgabe of katalog.aufgaben) {
    const id = itemIds.get(aufgabe.id)

    if (id === undefined) {
      continue
    }

    const dependsOn = aufgabe.haengtAbVon
      .map((verweis) => itemIds.get(verweis))
      .filter((verweis): verweis is string => verweis !== undefined)

    zeilen.push(
      bekannt.has(id)
        ? null
        : await verschluesselterInhalt(fall, id, payloadAus(aufgabe, katalog.version, dependsOn)),
    )

    /*
     * Die Unteraufgaben unabhängig von ihrer Elternaufgabe: Steht die schon,
     * kann eine Unteraufgabe trotzdem fehlen — etwa weil ein früherer Anlauf
     * mittendrin abbrach. Und ist eine gelöscht, steht ihr Tombstone in
     * `vorhandeneIds` und sie kommt nicht wieder (§5).
     */
    for (const [stelle, titel] of aufgabe.unteraufgaben.entries()) {
      const unterId = await katalogItemId(
        fall.kcat,
        fall.id,
        unteraufgabenPfad(aufgabe.id, stelle + 1),
      )

      zeilen.push(
        bekannt.has(unterId)
          ? null
          : await verschluesselterInhalt(fall, unterId, unterpayloadAus(titel, id)),
      )
    }
  }

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
