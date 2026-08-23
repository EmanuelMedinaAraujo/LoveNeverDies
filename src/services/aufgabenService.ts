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
 * **Nicht entschlüsselbare Items verschwinden still** (§3.7). Sie gehören in
 * aller Regel einer anderen Person — private Items liegen in derselben Tabelle
 * und tragen keinen Marker, also lädt jedes Mitglied sie mit und verwirft sie.
 * Dass dabei auch ein echter Defekt verschluckt wird, ist die bewusst
 * hingenommene Grenze aus §11.8. Deshalb zählt {@link ladeAufgaben} die
 * übersprungenen Zeilen mit — anzeigen darf das ausschließlich der Dev-Modus.
 */

import { entschluessele, verschluessele } from '../core/crypto/aead'
import { bytesText, textBytes } from '../core/crypto/bytes'
import { entpackeDek, erzeugeDek, wrappeDek } from '../core/crypto/dek'
import type { InhalteTabelle, InhaltZeile } from '../core/db/inhalte'
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
   * Wie viele Zeilen still verworfen wurden (§3.7). Sichtbar ausschließlich im
   * Dev-Modus — in Produktion gibt es diesen Zähler nirgends zu sehen.
   */
  uebersprungen: number
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
 * Die Aufgaben eines Falls, in `seq`-Reihenfolge.
 *
 * Ein Fehlschlag beim Entschlüsseln einer einzelnen Zeile bringt diese Funktion
 * nicht zum Scheitern — er zählt. Ein Fehlschlag beim Abrufen schon: Ein
 * Server, der nicht antwortet, darf nicht als „keine Aufgaben" durchgehen.
 */
export async function ladeAufgaben(
  inhalte: InhalteTabelle,
  fall: Fallschluessel,
): Promise<Aufgabenliste> {
  const zeilen = await inhalte.imFall(fall.id)

  const aufgaben: Aufgabe[] = []
  let uebersprungen = 0

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
      uebersprungen += 1
    }
  }

  return { aufgaben, uebersprungen }
}

/** Legt eine Aufgabe an: eigener DEK, Payload darunter, DEK unter `K_c`. */
export async function legeAufgabeAn(
  inhalte: InhalteTabelle,
  fall: Fallschluessel,
  titel: string,
): Promise<void> {
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

  await inhalte.lege({
    // Clientseitig erzeugt, damit Anlegen später offline funktioniert (§5).
    id: uuidv7(),
    fallId: fall.id,
    art: 'item',
    kid: fall.kid,
    wrappedDek,
    payload: verschluesselt,
  })
}

/**
 * Schreibt geänderte Felder zurück. Der DEK bleibt unangetastet — er ändert
 * sich nie (§3.1), und deshalb kostet ein Edit genau eine Spalte.
 */
export async function schreibeAufgabe(
  inhalte: InhalteTabelle,
  aufgabe: Aufgabe,
  aenderung: Aufgabenaenderung,
): Promise<void> {
  const payload: Aufgabenpayload = {
    typ: 'aufgabe',
    titel: aenderung.titel === undefined ? aufgabe.titel : pruefeTitel(aenderung.titel),
    beschreibung: aenderung.beschreibung ?? aufgabe.beschreibung,
    erledigt: aenderung.erledigt ?? aufgabe.erledigt,
  }

  await inhalte.schreibePayload(
    aufgabe.id,
    await verschluessele(aufgabe.dek, textBytes(JSON.stringify(payload))),
  )
}

/**
 * Löscht eine Aufgabe — als Tombstone, nicht als DELETE (§5).
 *
 * Löschen gewinnt endgültig: Die Datenbank weist ein `deleted → false` ab (§4),
 * ein späteres Edit von einem anderen Gerät belebt die Aufgabe also nicht
 * wieder.
 */
export function loescheAufgabe(inhalte: InhalteTabelle, aufgabe: Aufgabe): Promise<void> {
  return inhalte.loesche(aufgabe.id)
}
