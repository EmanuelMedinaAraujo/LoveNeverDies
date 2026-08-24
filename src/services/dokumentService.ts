/**
 * Dokumente aufnehmen, ansehen und löschen (DESIGN.md §7, §3.1, §5).
 *
 * §7: "Dokument einfach abfotografieren". Man hält die Sterbeurkunde vor die
 * Kamera, sie landet verschlüsselt am Aufgabendetail und lässt sich später
 * wieder ansehen.
 *
 * Die Kette ist dieselbe wie bei einer Aufgabe (§3.1), nur mit einem Anhang:
 *
 * ```
 * Aufnehmen  DEK erzeugen → Datei  = AES-GCM(DEK, Bytes)      → Storage
 *                         → payload = AES-GCM(DEK, Metadaten) → items
 *                         → wrapped_dek = AES-GCM(K_c, DEK)   → items
 * Ansehen    wrapped_dek unter K_c entpacken → Datei unter DEK entschlüsseln
 * Löschen    Tombstone setzen, dann das Storage-Objekt entfernen
 * ```
 *
 * Ein DEK für beides: Metadaten und Datei liegen unter demselben
 * Schlüssel. Zwei wären zwei Wraps in einer Zeile, die nur eine Spalte dafür
 * hat. Die Nonce ist je Aufruf frisch (§3.2), es gibt also nichts
 * wiederzuverwenden.
 *
 * Im Klartext steht genau eine Angabe mehr als bei einer Aufgabe:
 * `storage_path`. Dateiname, MIME-Typ, Größe und die Aufgabe, an der das
 * Dokument hängt, liegen im Payload (§3.3).
 *
 * Dokumente gehen nicht in die Offline-Queue (§5). Eine 15-MB-Datei in
 * IndexedDB zwischenzulagern, um sie beim Reconnect hochzuladen, wäre ein
 * zweiter Speicher mit eigener Verdrängung und eigenem Aufräumen. Die
 * Aufnahme selbst braucht ohnehin eine Verbindung, damit das Storage-Objekt
 * und die Item-Zeile zusammen entstehen. Ohne Netz ist die Schaltfläche
 * gesperrt, und das steht auch da.
 */

import { bytesText, textBytes } from '../core/crypto/bytes'
import { entschluessele, verschluessele } from '../core/crypto/aead'
import type { Dateikrypto } from '../core/crypto/dateikrypto'
import { entpackeDek, erzeugeDek, wrappeDek } from '../core/crypto/dek'
import { dokumentPfad, type Dokumentablage } from '../core/db/ablage'
import type { InhalteTabelle, InhaltZeile } from '../core/db/inhalte'
import { uuidv7 } from '../core/uuidv7'
import type { Fallschluessel } from './aufgabenService'

/** Ein Dokument konnte nicht aufgenommen, geöffnet oder gelöscht werden. */
export class DokumentFehler extends Error {
  constructor(nachricht: string, options?: ErrorOptions) {
    super(nachricht, options)
    this.name = 'DokumentFehler'
  }
}

/**
 * 15 MB (§7). Keine Chunks: Eine Datei ist genau ein Storage-Objekt.
 *
 * Die Grenze steht doppelt: hier und als `file_size_limit` am Bucket. Diese
 * Stelle sagt einer Person, was los ist, bevor 20 MB durch die Leitung gehen;
 * die andere trägt den Fall, in dem jemand an dieser vorbeikommt.
 */
export const MAX_DOKUMENT_BYTES = 15 * 1024 * 1024

/**
 * Was der Dienst von einer Datei braucht. `File` aus einem `<input>` erfüllt es;
 * der schmalere Typ steht hier, damit ein Test kein DOM aufbauen muss.
 */
export type Dateiauswahl = {
  name: string
  /** Der MIME-Typ. Leer, wenn der Browser ihn nicht erkennt. */
  type: string
  size: number
  arrayBuffer(): Promise<ArrayBuffer>
}

/**
 * Der verschlüsselte Inhalt eines Dokuments (§3.3).
 *
 * `aufgabeId` liegt hier und nicht in einer Spalte: Dass ein Dokument zu einer
 * Aufgabe gehört, ist Inhalt und geht den Server nichts an, genau wie
 * `parentId` bei einer Unteraufgabe.
 */
export type Dokumentpayload = {
  typ: 'dokument'
  name: string
  mimetyp: string
  /** Die Größe im Klartext, in Byte. Für die Anzeige, nicht für die Logik. */
  groesse: number
  /** Die Aufgabe, an der es hängt, oder `null`, wenn es allein im Fall steht. */
  aufgabeId: string | null
  aufgenommenAm: string
}

export type Dokument = {
  id: string
  name: string
  mimetyp: string
  groesse: number
  aufgabeId: string | null
  aufgenommenAm: string
  /** `{case_id}/{item_id}` (§7), hergeleitet, nie aus dem Delta gelesen. */
  pfad: string
  /** Der DEK dieser Zeile, entpackt: Er öffnet Metadaten und Datei. */
  dek: Uint8Array
  kid: string
}

export type Dokumentliste = {
  dokumente: Dokument[]
  /** Die Zeilen, die still verworfen wurden (§3.7), bei ihrer ID. */
  uebersprungeneIds: string[]
}

/** Was eine Aufnahme braucht: Schlüssel, Ablage, Tabelle, Kryptowerkbank. */
export type Dokumentwerkzeug = {
  fall: Fallschluessel
  ablage: Dokumentablage
  inhalte: InhalteTabelle
  krypto: Dateikrypto
}

/**
 * Die Größe als Text: für eine Meldung und für die Liste im Aufgabendetail.
 *
 * Grob und mit Absicht: Ob eine Sterbeurkunde 2,3 oder 2,4 MB hat, ändert für
 * niemanden etwas. Dass sie 20 MB hat, schon.
 */
export function groessentext(bytes: number): string {
  const mb = bytes / (1024 * 1024)

  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`
}

/**
 * Weist eine zu große Datei ab, bevor sie gelesen wird.
 *
 * §7 verlangt eine klare Meldung statt eines stillschweigenden Abschneidens.
 * Die Prüfung steht deshalb vor `arrayBuffer()`: Eine 200-MB-Datei erst in den
 * Speicher zu ziehen, um sie dann abzulehnen, brächte auf einem Telefon die
 * ganze App zu Fall, und die Meldung käme nie an.
 */
function pruefeGroesse(datei: Dateiauswahl): void {
  if (datei.size > MAX_DOKUMENT_BYTES) {
    throw new DokumentFehler(
      `"${datei.name}" ist ${groessentext(datei.size)} groß. Mehr als 15 MB nimmt die App nicht an: Fotografieren Sie das Dokument noch einmal mit kleinerer Auflösung.`,
    )
  }

  if (datei.size === 0) {
    throw new DokumentFehler(`"${datei.name}" ist leer. Da ist nichts zu speichern.`)
  }
}

function alsText(wert: unknown, ersatz = ''): string {
  return typeof wert === 'string' && wert !== '' ? wert : ersatz
}

/**
 * Liest, was in einem entschlüsselten Payload steht.
 *
 * @throws {DokumentFehler} wenn es kein Dokumentpayload ist. Der Aufrufer macht
 * daraus eine übersprungene Zeile: Von aussen ist ein Defekt nicht von dem
 * privaten Item einer anderen Person zu unterscheiden (§11.8).
 */
function lesePayload(klartext: Uint8Array): Dokumentpayload {
  const roh: unknown = JSON.parse(bytesText(klartext))

  if (typeof roh !== 'object' || roh === null || (roh as { typ?: unknown }).typ !== 'dokument') {
    throw new DokumentFehler('Dieser Payload ist kein Dokument.')
  }

  const felder = roh as Partial<Dokumentpayload>

  return {
    typ: 'dokument',
    // Ein Payload aus einer älteren Fassung kennt vielleicht nicht jedes Feld.
    // Fehlt eines, steht ein tragbarer Ersatz da statt eines Absturzes in der
    // Dokumentenliste.
    name: alsText(felder.name, 'Dokument'),
    mimetyp: alsText(felder.mimetyp, 'application/octet-stream'),
    groesse: typeof felder.groesse === 'number' ? felder.groesse : 0,
    aufgabeId: alsText(felder.aufgabeId) === '' ? null : (felder.aufgabeId as string),
    aufgenommenAm: alsText(felder.aufgenommenAm),
  }
}

async function leseZeile(zeile: InhaltZeile, fall: Fallschluessel): Promise<Dokument> {
  const dek = await entpackeDek(fall.kc, zeile.wrappedDek)
  const { name, mimetyp, groesse, aufgabeId, aufgenommenAm } = lesePayload(
    await entschluessele(dek, zeile.payload),
  )

  return {
    id: zeile.id,
    name,
    mimetyp,
    groesse,
    aufgabeId,
    aufgenommenAm,
    /*
     * Hergeleitet und nicht aus der Zeile gelesen: Der CHECK
     * `items_storage_path_gehoert_zum_item` hält `{case_id}/{item_id}` fest,
     * also sagt die Spalte nichts, was hier nicht schon steht, und der
     * Delta-Sync trägt sie deshalb gar nicht erst mit (§5).
     */
    pfad: dokumentPfad(zeile.fallId, zeile.id),
    dek,
    kid: zeile.kid,
  }
}

/**
 * Macht aus Ciphertext-Zeilen Dokumente: derselbe Schritt wie
 * `aufgabenAusZeilen`, nur für `kind = 'file'`.
 *
 * Tombstones und Aufgaben fallen vorher heraus: Ein Tombstone ist leer und
 * zählte sonst als Defekt, obwohl er das Gegenteil ist (§5).
 */
export async function dokumenteAusZeilen(
  zeilen: InhaltZeile[],
  fall: Fallschluessel,
): Promise<Dokumentliste> {
  const dokumente: Dokument[] = []
  const uebersprungeneIds: string[] = []

  for (const zeile of zeilen) {
    if (zeile.geloescht || zeile.art !== 'file') {
      continue
    }

    try {
      dokumente.push(await leseZeile(zeile, fall))
    } catch {
      uebersprungeneIds.push(zeile.id)
    }
  }

  return { dokumente, uebersprungeneIds }
}

/**
 * Nimmt ein Dokument auf: verschlüsseln, hochladen, Zeile schreiben.
 *
 * Erst die Datei, dann die Zeile: Andersherum stünde ein Dokument in der
 * Liste, dessen Datei nie ankam, sichtbar, anklickbar und beim Öffnen ein
 * Fehler. So gibt es für einen Moment eine Datei ohne Zeile: Sie ist für
 * niemanden sichtbar, und wenn das INSERT scheitert, räumt dieser Dienst sie
 * gleich wieder weg. Bleibt sie trotzdem liegen (der Verbindung ist alles
 * zuzutrauen), holt sie der Aufräumjob nach sieben Tagen (§7).
 *
 * @param aufgabeId die Aufgabe, an der das Dokument hängt (§7), oder `null`.
 */
export async function nimmDokumentAuf(
  { fall, ablage, inhalte, krypto }: Dokumentwerkzeug,
  datei: Dateiauswahl,
  aufgabeId: string | null = null,
): Promise<Dokument> {
  pruefeGroesse(datei)

  const id = uuidv7()
  const pfad = dokumentPfad(fall.id, id)
  const dek = erzeugeDek()

  const payload: Dokumentpayload = {
    typ: 'dokument',
    name: datei.name === '' ? 'Dokument' : datei.name,
    // Ein Browser, der den Typ nicht erkennt, liefert eine leere Zeichenkette.
    // "Unbekannt" ist ehrlicher als ein geratenes `image/jpeg`.
    mimetyp: datei.type === '' ? 'application/octet-stream' : datei.type,
    groesse: datei.size,
    aufgabeId,
    aufgenommenAm: new Date().toISOString(),
  }

  const bytes = new Uint8Array(await datei.arrayBuffer())

  // Die Datei geht in den Worker (§7), die beiden kleinen Envelopes bleiben
  // hier: Ein `postMessage` für 32 Byte kostet mehr, als es spart.
  const [ciphertext, verschluesselterPayload, wrappedDek] = await Promise.all([
    krypto.verschluessele(dek, bytes),
    verschluessele(dek, textBytes(JSON.stringify(payload))),
    wrappeDek(fall.kc, dek),
  ])

  await ablage.lade(pfad, ciphertext)

  try {
    await inhalte.lege({
      id,
      fallId: fall.id,
      art: 'file',
      kid: fall.kid,
      wrappedDek,
      payload: verschluesselterPayload,
      storagePfad: pfad,
    })
  } catch (ursache) {
    await entferneStill(ablage, pfad)

    throw new DokumentFehler(
      `"${payload.name}" konnte nicht gespeichert werden. ${ursache instanceof Error ? ursache.message : ''}`.trim(),
      { cause: ursache },
    )
  }

  /*
   * `typ` bleibt im Payload und kommt nicht mit: Dort unterscheidet er ein
   * Dokument von einer Aufgabe, sobald jemand die Bytes liest (§3.3). Im
   * Speicher tut das der Typ, und ein Feld, das immer denselben Wert trägt,
   * sagt nichts.
   */
  const { name, mimetyp, groesse, aufgenommenAm } = payload

  return { id, name, mimetyp, groesse, aufgabeId, aufgenommenAm, pfad, dek, kid: fall.kid }
}

/** Holt die Datei und entschlüsselt sie: der Weg zurück aus §7. */
export async function oeffneDokument(
  dokument: Dokument,
  ablage: Dokumentablage,
  krypto: Dateikrypto,
): Promise<Uint8Array> {
  const ciphertext = await ablage.hole(dokument.pfad)

  try {
    return await krypto.entschluessele(dokument.dek, ciphertext)
  } catch (ursache) {
    // Hier ist ein Fehlschlag kein fremdes Item (§3.7), sondern eine
    // beschädigte Datei: Der DEK stammt aus derselben Zeile wie der Pfad.
    throw new DokumentFehler(
      `"${dokument.name}" lässt sich nicht öffnen. Die Datei ist beschädigt.`,
      { cause: ursache },
    )
  }
}

/**
 * Löscht ein Dokument: Tombstone, dann Datei (§7).
 *
 * In dieser Reihenfolge, und nicht umgekehrt: Der Tombstone ist die
 * endgültige Aussage (§5); scheitert er, bleibt das Dokument vollständig
 * stehen, statt als Zeile ohne Datei zurückzubleiben.
 *
 * Scheitert danach das Entfernen der Datei, ist das Löschen trotzdem
 * geschehen. Eine Fehlermeldung darüber wäre irreführend: Sie sagte "hat
 * nicht geklappt" über etwas, das endgültig geklappt hat. Was liegen bleibt,
 * holt der Aufräumjob nach sieben Tagen; genau dafür gibt es ihn.
 */
export async function loescheDokument(
  dokument: Dokument,
  ablage: Dokumentablage,
  inhalte: InhalteTabelle,
): Promise<void> {
  await inhalte.loesche(dokument.id)
  await entferneStill(ablage, dokument.pfad)
}

/** Entfernt eine Datei, ohne dass ein Fehlschlag den Aufrufer aufhält. */
async function entferneStill(ablage: Dokumentablage, pfad: string): Promise<void> {
  try {
    await ablage.entferne(pfad)
  } catch {
    // Siehe `loescheDokument`: Der Aufräumjob ist das Netz darunter.
  }
}
