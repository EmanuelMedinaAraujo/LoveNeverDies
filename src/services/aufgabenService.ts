/**
 * Aufgaben anlegen, ändern, abhaken und löschen (DESIGN.md §3.1, §3.3, §5).
 *
 * Die Kette ist zweistufig und immer dieselbe:
 *
 * ```
 * Anlegen  DEK erzeugen → payload = AES-GCM(DEK, Inhalt)
 *                       → wrapped_dek = AES-GCM(K_c, DEK)   → items
 * Lesen    wrapped_dek unter K_c entpacken → payload unter DEK entschlüsseln
 * Ändern   nur payload neu, derselbe DEK
 * Löschen  Tombstone, Payload und DEK werden geleert
 * ```
 *
 * Im Klartext gehen ausschließlich die Spalten aus §3.3 hinaus. Titel,
 * Beschreibung, Typ und Erledigt-Status liegen im Payload; der Server kann eine
 * Aufgabe zählen, datieren und ausliefern, lesen kann er sie nie.
 *
 * **Dieser Dienst schreibt nirgends hin.** Er nimmt Klartext entgegen und gibt
 * eine {@link Mutation} zurück — fertig verschlüsselt, bereit zum Anhängen an
 * die Offline-Queue (§5). Wann sie hinausgeht, entscheidet die Queue und nicht
 * der Moment des Tippens; das ist der Unterschied zwischen einer App, die im
 * Flugmodus funktioniert, und einer, die dort Fehlermeldungen zeigt.
 *
 * **Nicht entschlüsselbare Items verschwinden still** (§3.7). Sie gehören in
 * aller Regel einer anderen Person — private Items liegen in derselben Tabelle
 * und tragen keinen Marker, also lädt jedes Mitglied sie mit und verwirft sie.
 * Dass dabei auch ein echter Defekt verschluckt wird, ist die bewusst
 * hingenommene Grenze aus §11.8. Deshalb zählt {@link aufgabenAusZeilen} die
 * übersprungenen Zeilen mit — anzeigen darf das ausschließlich der Dev-Modus.
 */

import { entschluessele, verschluessele } from '../core/crypto/aead'
import { bytesText, textBytes } from '../core/crypto/bytes'
import { entpackeDek, erzeugeDek, wrappeDek } from '../core/crypto/dek'
import type { InhaltZeile } from '../core/db/inhalte'
import type { AbgelehnteMutation, Mutation } from '../core/sync/queue'
import { uuidv7 } from '../core/uuidv7'

/** Eine Aufgabe war nicht anzulegen oder nicht zu ändern. */
export class AufgabenFehler extends Error {
  constructor(nachricht: string, options?: ErrorOptions) {
    super(nachricht, options)
    this.name = 'AufgabenFehler'
  }
}

/**
 * Was der Dienst vom Fall braucht: seine ID und den Schlüssel, unter dem die
 * DEKs seiner Items liegen.
 *
 * `LesbarerFall` aus `fallService` erfüllt das; der schmalere Typ steht hier,
 * damit dieser Dienst nichts über Sterbedaten und Fallstatus wissen muss.
 */
export type Fallschluessel = {
  id: string
  /** `current_kid`, unter dem `kc` steht. */
  kid: string
  kc: Uint8Array
}

/**
 * Der verschlüsselte Inhalt einer Aufgabe (§3.3).
 *
 * `typ` ist heute einwertig und steht trotzdem da: Er ist die Unterscheidung,
 * an der ein späterer Leser ein Konfigurations-Item (`kenntnisAm`, §8) von
 * einer Aufgabe trennt, ohne raten zu müssen. Ein Feld nachträglich zum
 * Unterscheidungsmerkmal zu erklären ginge nicht — alte Payloads trügen es nicht.
 *
 * `erledigt` ist hier ein gespeichertes Feld, weil es in diesem Stand nur
 * Blätter gibt. Sobald eine Aufgabe Unteraufgaben hat, leitet der Client es
 * bei jedem Rendern aus den Kindern ab und speichert es nicht (§7).
 */
type Aufgabenpayload = {
  typ: 'aufgabe'
  titel: string
  beschreibung: string
  erledigt: boolean
}

export type Aufgabe = {
  id: string
  titel: string
  beschreibung: string
  erledigt: boolean
  /**
   * Der DEK dieser Zeile, entpackt. Er bleibt im Speicher, weil jede Änderung
   * ihn wieder braucht — neu erzeugt würde er nur bei einer neuen Aufgabe.
   */
  dek: Uint8Array
  /** Der Schlüssel, unter dem der DEK auf dem Server liegt. */
  kid: string
}

export type Aufgabenliste = {
  aufgaben: Aufgabe[]
  /**
   * Die Zeilen, die still verworfen wurden (§3.7), bei ihrer ID. Sichtbar
   * ausschließlich im Dev-Modus — in Produktion gibt es diesen Zähler nirgends
   * zu sehen.
   *
   * IDs statt einer Zahl, weil der Aufrufer stapelweise entschlüsselt: Er
   * bekommt nur die geänderten Zeilen zu sehen (§5) und müsste einen Zähler
   * über die Stapel hinweg selbst fortschreiben — und dazu wissen, welche Zeile
   * gar nicht erst mitzählt. Genau diese Regel steht hier und soll hier bleiben.
   */
  uebersprungeneIds: string[]
}

/** Was sich an einer Aufgabe ändern lässt. Was fehlt, bleibt, wie es war. */
export type Aufgabenaenderung = {
  titel?: string
  beschreibung?: string
  erledigt?: boolean
}

function pruefeTitel(titel: string): string {
  const gekuerzt = titel.trim()

  if (gekuerzt === '') {
    throw new AufgabenFehler('Eine Aufgabe braucht einen Titel.')
  }

  return gekuerzt
}

/**
 * Liest, was in einem entschlüsselten Payload steht.
 *
 * @throws wenn es kein Aufgabenpayload ist. Der Aufrufer macht daraus eine
 * übersprungene Zeile — von aussen ist ein Defekt nicht von dem privaten Item
 * einer anderen Person zu unterscheiden (§11.8).
 */
function lesePayload(klartext: Uint8Array): Aufgabenpayload {
  const roh: unknown = JSON.parse(bytesText(klartext))

  if (
    typeof roh !== 'object' ||
    roh === null ||
    !('titel' in roh) ||
    typeof roh.titel !== 'string'
  ) {
    throw new AufgabenFehler('Dieser Payload ist keine Aufgabe.')
  }

  const felder = roh as Partial<Aufgabenpayload>

  return {
    typ: 'aufgabe',
    titel: felder.titel ?? '',
    beschreibung: felder.beschreibung ?? '',
    erledigt: felder.erledigt === true,
  }
}

async function leseZeile(zeile: InhaltZeile, fall: Fallschluessel): Promise<Aufgabe> {
  const dek = await entpackeDek(fall.kc, zeile.wrappedDek)
  const { titel, beschreibung, erledigt } = lesePayload(await entschluessele(dek, zeile.payload))

  return { id: zeile.id, titel, beschreibung, erledigt, dek, kid: zeile.kid }
}

/**
 * Macht aus Ciphertext-Zeilen Aufgaben — der Schritt, den §5 „entschlüsselt beim
 * Start in den Speicher" nennt.
 *
 * Die Zeilen kommen aus dem Cache oder aus dem Delta; woher, ist dieser
 * Funktion gleich. Sie kostet einige Millisekunden, und deshalb bezieht sich
 * die Ladeanzeige ausdrücklich auf den Netzwerk-Fetch und nicht auf diesen
 * Schritt (§5).
 *
 * Ein Fehlschlag beim Entschlüsseln einer einzelnen Zeile bringt die Liste
 * nicht zum Scheitern — er zählt.
 */
export async function aufgabenAusZeilen(
  zeilen: InhaltZeile[],
  fall: Fallschluessel,
): Promise<Aufgabenliste> {
  const aufgaben: Aufgabe[] = []
  const uebersprungeneIds: string[] = []

  for (const zeile of zeilen) {
    // Tombstones werden vor jedem Entschlüsselungsversuch aussortiert: Sie sind
    // leer und zählten sonst als Defekt, obwohl sie das Gegenteil sind — ein
    // ordnungsgemäß gelöschtes Item (§5).
    if (zeile.geloescht || zeile.art !== 'item') {
      continue
    }

    try {
      aufgaben.push(await leseZeile(zeile, fall))
    } catch {
      uebersprungeneIds.push(zeile.id)
    }
  }

  return { aufgaben, uebersprungeneIds }
}

/**
 * Eine neue Aufgabe: eigener DEK, Payload darunter, DEK unter `K_c`.
 *
 * Die ID entsteht hier und nicht auf dem Server — eine clientseitige UUIDv7
 * (§5), damit Anlegen offline funktioniert und die Queue eine Aufgabe benennen
 * kann, die der Server noch nie gesehen hat.
 */
export async function mutationAnlegen(
  fall: Fallschluessel,
  titel: string,
): Promise<Mutation> {
  const payload: Aufgabenpayload = {
    typ: 'aufgabe',
    titel: pruefeTitel(titel),
    beschreibung: '',
    erledigt: false,
  }

  const dek = erzeugeDek()

  const [verschluesselt, wrappedDek] = await Promise.all([
    verschluessele(dek, textBytes(JSON.stringify(payload))),
    wrappeDek(fall.kc, dek),
  ])

  return {
    op: 'anlegen',
    itemId: uuidv7(),
    fallId: fall.id,
    art: 'item',
    kid: fall.kid,
    wrappedDek,
    payload: verschluesselt,
    ts: Date.now(),
  }
}

/**
 * Geänderte Felder unter demselben DEK. Er ändert sich nie (§3.1), und deshalb
 * kostet ein Edit genau eine Spalte.
 */
export async function mutationAendern(
  aufgabe: Aufgabe,
  aenderung: Aufgabenaenderung,
): Promise<Mutation> {
  const payload: Aufgabenpayload = {
    typ: 'aufgabe',
    titel: aenderung.titel === undefined ? aufgabe.titel : pruefeTitel(aenderung.titel),
    beschreibung: aenderung.beschreibung ?? aufgabe.beschreibung,
    erledigt: aenderung.erledigt ?? aufgabe.erledigt,
  }

  return {
    op: 'aendern',
    itemId: aufgabe.id,
    payload: await verschluessele(aufgabe.dek, textBytes(JSON.stringify(payload))),
    ts: Date.now(),
  }
}

/**
 * Löschen — als Tombstone, nicht als DELETE (§5).
 *
 * Löschen gewinnt endgültig: Die Datenbank weist ein `deleted → false` ab (§4),
 * ein späteres Edit von einem anderen Gerät belebt die Aufgabe also nicht
 * wieder.
 */
export function mutationLoeschen(aufgabe: Aufgabe): Mutation {
  return { op: 'loeschen', itemId: aufgabe.id, ts: Date.now() }
}

/**
 * Eine abgelehnte Änderung, so wie sie auf dem Bildschirm steht.
 *
 * §5: „Abgelehnte Mutationen werden nie stillschweigend verworfen, sondern mit
 * ihrem **entschlüsselten** Inhalt als Mitteilung angezeigt." Ohne den Inhalt
 * wäre die Mitteilung eine Zumutung — „eine Änderung konnte nicht gespeichert
 * werden" sagt niemandem, was er noch einmal tippen muss.
 */
export type AbgelehnteAenderung = {
  itemId: string
  /** Was jemand tun wollte, in einem Wort für die Oberfläche. */
  was: 'anlegen' | 'aendern' | 'loeschen'
  /**
   * Der Titel, entschlüsselt. Leer, wenn er sich nicht mehr herstellen lässt —
   * dann fehlt der DEK, weil die Zeile inzwischen ein Tombstone ist.
   */
  titel: string
  /** Was der Server gesagt hat. */
  grund: string
}

/** Der DEK einer Zeile, oder `null`, wenn er sich nicht entpacken lässt. */
async function dekVon(zeile: InhaltZeile | undefined, fall: Fallschluessel) {
  if (zeile === undefined || zeile.wrappedDek.length === 0) {
    return null
  }

  try {
    return await entpackeDek(fall.kc, zeile.wrappedDek)
  } catch {
    return null
  }
}

async function titelAus(
  payload: Uint8Array | null,
  dek: Uint8Array | null,
): Promise<string> {
  if (payload === null || dek === null) {
    return ''
  }

  try {
    return lesePayload(await entschluessele(dek, payload)).titel
  } catch {
    return ''
  }
}

/**
 * Entschlüsselt, was der Server abgelehnt hat.
 *
 * @param zeilen der aktuelle Bestand. Für ein Edit und ein Löschen steht der
 * DEK dort — die Mutation trägt ihn nicht mit, weil ein Edit genau eine Spalte
 * kostet (§3.1).
 */
export function beschreibeAbgelehnte(
  abgelehnt: AbgelehnteMutation[],
  zeilen: InhaltZeile[],
  fall: Fallschluessel,
): Promise<AbgelehnteAenderung[]> {
  const nachId = new Map(zeilen.map((zeile) => [zeile.id, zeile]))

  return Promise.all(
    abgelehnt.map(async ({ mutation, grund }): Promise<AbgelehnteAenderung> => {
      const gemeinsam = { itemId: mutation.itemId, was: mutation.op, grund }

      if (mutation.op === 'anlegen') {
        // Die abgelehnte Anlage trägt ihren eigenen DEK mit: Auf dem Server gibt
        // es diese Zeile nicht, und im Bestand steht sie auch nicht.
        const dek = await dekVon(
          { wrappedDek: mutation.wrappedDek } as InhaltZeile,
          fall,
        )

        return { ...gemeinsam, titel: await titelAus(mutation.payload, dek) }
      }

      const dek = await dekVon(nachId.get(mutation.itemId), fall)

      return {
        ...gemeinsam,
        titel: await titelAus(
          // Beim Löschen gibt es keinen neuen Payload — gemeint ist der, der
          // noch dasteht.
          mutation.op === 'aendern' ? mutation.payload : (nachId.get(mutation.itemId)?.payload ?? null),
          dek,
        ),
      }
    }),
  )
}
