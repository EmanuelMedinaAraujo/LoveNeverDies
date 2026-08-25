/**
 * Kopplung: Angehörige einladen und ein zweites Gerät freigeben (DESIGN.md §6, §3.6).
 *
 * Der Ablauf aus §6, aus der Nähe:
 *
 * ```
 * beitretende Seite            Server                 einladende Seite
 * ─────────────────            ──────                 ────────────────
 * erzeugeKopplungscode() ───►  pairing_codes
 *        │                                            loeseKopplungscodeEin()
 *        │  Code am Telefon ─────────────────────────►        │
 *        │                                            Name, E-Mail, Prüfcode
 *        │  ◄─── Prüfcode mündlich abgleichen ──────────────► │
 *        │                                            fuegeZumFallHinzu()
 *        ▼                                                    │
 *  Fall wird lesbar  ◄───── K_c und K_cat, gewrappt ──────────┘
 * ```
 *
 * Der Prüfcode ist der einzige Schutz gegen einen bösartigen Server. Ein
 * öffentlicher Schlüssel ist keine Identität; dass der Server einen echten
 * Namen dazu liefert, bindet ihn an eine authentifizierte Person, nicht an
 * diesen Schlüssel. Erst der mündliche Abgleich der sechs Ziffern schließt die
 * Lücke; und er deckt beide Schlüssel ab, weil ein Fingerprint nur über den
 * KEM-Schlüssel den Signaturschlüssel austauschbar ließe (§3.6).
 *
 * Deshalb rechnet diese Datei den Prüfcode aus den Bytes, die der Server
 * geliefert hat, und nicht aus irgendeinem Feld, das er mitschicken könnte.
 */

import { verschluessele } from '../core/crypto/aead'
import { geraetePruefcode } from '../core/crypto/fingerprint'
import { kapsele } from '../core/crypto/kem'
import type { Geraeteidentitaet } from '../core/crypto/keystore'
import { wrappeSchluessel } from '../core/crypto/wrap'
import type {
  Kopplungsangebot,
  Kopplungscode,
  KopplungTabelle,
  Kopplungszweck,
} from '../core/db/kopplung'
import type { PersoenlicheSchluesselTabelle } from '../core/db/persoenlicheschluessel'
import type { TresorTabelle } from '../core/db/tresor'
import type { Fall, LesbarerFall } from './fallService'
import { uebergebePersoenlichenSchluessel } from './privatService'
import { entpackeEigenenAnteil } from './todesfallService'

/** Die 32 Zeichen aus §6: kein O, keine 0, kein I, keine 1. */
export const KOPPLUNGSCODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'

export const KOPPLUNGSCODE_LAENGE = 8

/** Die Kopplung ist gescheitert, bevor irgendein Schlüssel bewegt wurde. */
export class KopplungFehler extends Error {
  constructor(nachricht: string, options?: ErrorOptions) {
    super(nachricht, options)
    this.name = 'KopplungFehler'
  }
}

/**
 * Acht Zeichen in zwei Vierergruppen.
 *
 * Am Telefon liest niemand acht Zeichen am Stück vor, ohne sich einmal zu
 * verzählen, und die Gruppierung ist Darstellung, nicht Inhalt: Eingelesen
 * wird der Code mit und ohne Bindestrich (§6).
 */
export function gruppierterKopplungscode(code: string): string {
  return `${code.slice(0, 4)}-${code.slice(4)}`
}

/**
 * Sechs Ziffern in zwei Dreiergruppen (§3.6).
 *
 * Steht hier und nicht bei der Geräteliste, weil beide Seiten der Kopplung
 * denselben Prüfcode zeigen und ihn miteinander vergleichen. Zwei Funktionen,
 * die ihn verschieden gruppieren, wären zwei Zahlen, die sich am Telefon nicht
 * mehr zusammenlesen lassen.
 */
export function gruppierterPruefcode(pruefcode: string): string {
  return `${pruefcode.slice(0, 3)} ${pruefcode.slice(3)}`
}

/**
 * Was jemand eingetippt hat, als Code gelesen.
 *
 * Bindestriche und Kleinschreibung fallen weg; alles andere wird abgewiesen,
 * bevor es an den Server geht. Ein Fehlgriff, den der Client erkennt, zählt
 * nicht gegen das Rate-Limit (§4), und wer sich vertippt hat, soll nicht
 * dadurch bestraft werden, dass er es kein drittes Mal versuchen darf.
 *
 * @throws {KopplungFehler} mit einem Satz, der sagt, was zu tun ist.
 */
export function normalisiereKopplungscode(eingabe: string): string {
  const code = eingabe.replace(/[^0-9A-Za-z]/g, '').toUpperCase()

  if (code.length !== KOPPLUNGSCODE_LAENGE) {
    throw new KopplungFehler(
      `Ein Kopplungscode hat ${KOPPLUNGSCODE_LAENGE} Zeichen; dieser hat ${code.length}.`,
    )
  }

  if ([...code].some((zeichen) => !KOPPLUNGSCODE_ALPHABET.includes(zeichen))) {
    // Die vier fehlen im Alphabet, weil sie sich am Telefon nicht unterscheiden
    // lassen (§6). Wer eines davon eingetippt hat, hat sich verhört, nicht
    // vertippt, und die Meldung soll ihn genau darauf stoßen.
    throw new KopplungFehler(
      'In einem Kopplungscode kommen kein O, keine 0, kein I und keine 1 vor. Bitte hören Sie noch einmal nach.',
    )
  }

  return code
}

/** Was die beitretende Seite anzeigt (§6, Schritt 2 und 3). */
export async function erzeugeKopplungscode(
  kopplung: KopplungTabelle,
  geraeteId: string,
  zweck: Kopplungszweck,
): Promise<Kopplungscode> {
  return kopplung.erzeugeCode(geraeteId, zweck)
}

/** Ein eingelöster Code samt dem, was die einladende Seite prüfen muss. */
export type Kopplungsanfrage = {
  code: string
  angebot: Kopplungsangebot
  /** Die sechs Ziffern aus §3.6, über beide Schlüssel des Angebots. */
  pruefcode: string
}

/** Warum eine Einlösung nicht durchging: in einem Satz für die Oberfläche. */
const ABWEISUNG: Record<string, string> = {
  gesperrt:
    'Zu viele Versuche in kurzer Zeit. Bitte warten Sie eine Viertelstunde und versuchen Sie es dann noch einmal.',
  unbekannt: 'Diesen Kopplungscode gibt es nicht. Bitte lassen Sie ihn sich noch einmal nennen.',
  abgelaufen:
    'Dieser Kopplungscode ist abgelaufen. Er gilt 15 Minuten; bitte lassen Sie sich einen neuen geben.',
  verbraucht:
    'Dieser Kopplungscode wurde bereits eingelöst. Jeder Code gilt genau einmal; bitte lassen Sie sich einen neuen geben.',
  selbst: 'Das ist Ihr eigener Einladungscode. Ihn muss die andere Person eingeben, nicht Sie.',
  fremd: 'Dieser Code gibt ein Gerät einer anderen Person frei. Sie können ihn nicht einlösen.',
}

/**
 * Löst einen Code ein und rechnet den Prüfcode aus dem, was zurückkam (§6, Schritt 4).
 *
 * @throws {KopplungFehler} bei jedem Status außer `ok`. Die Einlösung ist ein
 * einzelner Schritt mit einem einzigen erwarteten Ausgang; alles andere ist für
 * die Oberfläche ein Fehler mit einem Satz daran, keine Variante, die sie
 * durchreichen müsste.
 */
export async function loeseKopplungscodeEin(
  kopplung: KopplungTabelle,
  eingabe: string,
): Promise<Kopplungsanfrage> {
  const code = normalisiereKopplungscode(eingabe)
  const ergebnis = await kopplung.loeseEin(code)

  if (ergebnis.status !== 'ok') {
    throw new KopplungFehler(
      ABWEISUNG[ergebnis.status] ?? 'Dieser Kopplungscode konnte nicht eingelöst werden.',
    )
  }

  return {
    code,
    angebot: ergebnis.angebot,
    pruefcode: await geraetePruefcode(ergebnis.angebot.pkKem, ergebnis.angebot.pkSig),
  }
}

/**
 * Wrappt `K_c` und `K_cat` eines Falls an das Gerät der anderen Seite.
 *
 * Beide Schlüssel zusammen und in einem Aufruf: Ein Fall, für den nur `K_c`
 * ankommt, ist für die andere Seite so unlesbar wie einer ohne beides; der
 * `fallService` braucht beide Wraps, bevor er einen Fall überhaupt als lesbar
 * ausgibt.
 */
async function uebergebeFallschluessel(
  kopplung: KopplungTabelle,
  anfrage: Kopplungsanfrage,
  fall: LesbarerFall,
  identitaet: Geraeteidentitaet,
  geraeteId: string,
): Promise<void> {
  const kidKatalog = `cat_${fall.id}`
  const empfaenger = { geraeteId: anfrage.angebot.geraeteId, pkKem: anfrage.angebot.pkKem }

  const [wrapFall, wrapKatalog] = await Promise.all([
    wrappeSchluessel(fall.kc, empfaenger, { fallId: fall.id, kid: fall.kid }, identitaet.signatur.geheim),
    wrappeSchluessel(fall.kcat, empfaenger, { fallId: fall.id, kid: kidKatalog }, identitaet.signatur.geheim),
  ])

  await kopplung.schliesseAb({
    code: anfrage.code,
    fallId: fall.id,
    kidFall: fall.kid,
    kidKatalog,
    absenderId: geraeteId,
    wrapFall,
    wrapKatalog,
  })
}

/**
 * Holt eine andere Person in einen Fall (§6, Schritt 6, `purpose = join`).
 *
 * @throws {KopplungFehler} wenn der Code zu einem zweiten Gerät gehört. Ein
 * `device`-Code hier hieße, eine Mitgliedschaft anzulegen, die niemand wollte.
 */
export async function fuegeZumFallHinzu(
  kopplung: KopplungTabelle,
  anfrage: Kopplungsanfrage,
  fall: LesbarerFall,
  identitaet: Geraeteidentitaet,
  geraeteId: string,
): Promise<void> {
  if (anfrage.angebot.zweck !== 'join') {
    throw new KopplungFehler('Dieser Code gibt ein Gerät frei und holt niemanden in einen Fall.')
  }

  await uebergebeFallschluessel(kopplung, anfrage, fall, identitaet, geraeteId)
}

/**
 * Reicht `K_v` an ein weiteres Gerät derselben Person weiter (§3.5).
 *
 * Nur beim `device`-Zweck, und nur der Preparer kommt hier durch: `fall.kv`
 * steht ausschließlich auf seinen Geräten, und die RLS auf `vault_key_wraps`
 * lässt niemanden sonst schreiben. Ohne diesen Schritt bliebe der Tresor auf
 * dem zweiten Gerät stumm. Der Fall wäre lesbar, der Tresor aber leer, kein
 * Re-Split liefe von dort, und die Oberfläche hielte den Preparer für einen
 * Angehörigen.
 *
 * Anders als bei `key_wraps` steht hier keine Signatur daneben (§3.6): Absender
 * und Empfänger sind dieselbe Person, und die Policy lässt keinen anderen an
 * die Tabelle. Es gibt niemanden, gegen den zu signieren wäre.
 */
async function uebergebeTresorschluessel(
  tresor: TresorTabelle,
  anfrage: Kopplungsanfrage,
  fall: LesbarerFall,
): Promise<void> {
  if (fall.kv === null) {
    return
  }

  const kapselung = kapsele(anfrage.angebot.pkKem)

  await tresor.legeWrapAn({
    fallId: fall.id,
    geraeteId: anfrage.angebot.geraeteId,
    kemCt: kapselung.kemCt,
    wrappedKey: await verschluessele(kapselung.geteiltesGeheimnis, fall.kv),
  })
}

/**
 * Reicht den eigenen Schlüsselanteil an ein weiteres Gerät derselben Person
 * weiter (§3.5).
 *
 * §3.5: "Wechselt ein Angehöriger das Gerät, bevor der Tresor geöffnet ist,
 * wrappt sein altes Gerät den eigenen Share an das neue. Der Preparer wird
 * dafür nicht gebraucht und ist nach seinem Tod auch nicht mehr verfügbar."
 *
 * Ohne diesen Schritt könnte das neue Gerät den Todesfall nicht bestätigen,
 * und der Anteil dieser Person fiele für die Schwelle aus, sobald das alte
 * Gerät weg ist.
 *
 * Ein Anteil, der auf diesem Gerät nicht aufgeht oder nicht zu seinem Hash
 * passt, wird nicht weitergegeben und hält die Kopplung trotzdem nicht auf:
 * Der Fall selbst ist freigeschaltet, und einen kaputten Anteil repariert nur
 * eine neue Verteilung durch den Preparer, nicht ein zweites Gerät.
 */
async function uebergebeTresoranteil(
  tresor: TresorTabelle,
  anfrage: Kopplungsanfrage,
  fall: LesbarerFall,
  identitaet: Geraeteidentitaet,
  geraeteId: string,
): Promise<void> {
  if (fall.status !== 'vorsorge') {
    return
  }

  const eigener = (await tresor.sharesFuerFall(fall.id)).find(
    (share) => share.geraeteId === geraeteId,
  )

  if (eigener === undefined) {
    return
  }

  try {
    const teil = await entpackeEigenenAnteil(eigener, identitaet)
    const kapselung = kapsele(anfrage.angebot.pkKem)

    await tresor.uebergibShare(
      fall.id,
      anfrage.angebot.geraeteId,
      kapselung.kemCt,
      await verschluessele(kapselung.geteiltesGeheimnis, teil),
    )
  } catch {
    /* Ein kaputter Anteil wandert nicht mit (§3.5). */
  }
}

/** Was ein freigeschaltetes Gerät danach lesen kann. */
export type Freischaltung = {
  freigeschaltet: number
  gesamt: number
}

/**
 * Schaltet ein zweites Gerät derselben Person frei (§6, `purpose = device`).
 *
 * Freigeschaltet werden alle Fälle, die dieses Gerät lesen kann (§4).
 * Gesperrte Fälle bleiben gesperrt: Wer sie selbst nicht öffnen kann, kann sie
 * auch nicht weitergeben. Deshalb kommen zwei Zahlen zurück und nicht ein
 * "fertig": Die Oberfläche benennt die Lücke ausdrücklich, statt sie
 * schweigend geschehen zu lassen.
 */
export async function schalteGeraetFrei(
  kopplung: KopplungTabelle,
  tresor: TresorTabelle,
  persoenlich: PersoenlicheSchluesselTabelle,
  anfrage: Kopplungsanfrage,
  faelle: Fall[],
  identitaet: Geraeteidentitaet,
  geraeteId: string,
  userId: string,
): Promise<Freischaltung> {
  if (anfrage.angebot.zweck !== 'device') {
    throw new KopplungFehler('Dieser Code holt eine Person in einen Fall und gibt kein Gerät frei.')
  }

  const lesbare = faelle.filter((fall): fall is LesbarerFall => fall.zustand === 'lesbar')

  /*
   * Kein lesbarer Fall heißt: Es gibt nichts weiterzugeben. Ohne diesen Wurf
   * meldete die Oberfläche "0 von 0 Fällen freigeschaltet": Die Kopplung sähe
   * erledigt aus, der Code ist verbraucht, und das zweite Gerät liest weiterhin
   * nichts. Ein Fehlschlag, der wie ein Erfolg aussieht, ist hier der schlimmste
   * Ausgang: Niemand versucht es noch einmal.
   */
  if (lesbare.length === 0) {
    throw new KopplungFehler(
      'Dieses Gerät kann keinen Fall lesen und deshalb auch keinen freigeben. Lassen Sie zuerst dieses Gerät freischalten.',
    )
  }

  /*
   * Nacheinander, nicht nebenläufig: Jeder Aufruf schreibt in `key_wraps` und
   * hebt über `on_membership_created` womöglich eine Fahne in `cases`. Bei
   * einer Familie sind das eine Handvoll Fälle, und eine Reihenfolge, in der
   * ein Fehlschlag beim dritten die ersten beiden stehen lässt, ist leichter zu
   * erklären als eine, in der die Hälfte durchkam.
   */
  for (const fall of lesbare) {
    await uebergebeFallschluessel(kopplung, anfrage, fall, identitaet, geraeteId)
    await uebergebeTresorschluessel(tresor, anfrage, fall)
    await uebergebeTresoranteil(tresor, anfrage, fall, identitaet, geraeteId)

    /*
     * Und `K_p`, sofern es einen gibt (§3.7). Ohne diesen Schritt läse das
     * zweite Gerät alles außer den eigenen privaten Aufgaben: Sie sähen von
     * dort aus aus wie die einer fremden Person und würden still verworfen.
     */
    await uebergebePersoenlichenSchluessel(persoenlich, fall.id, userId, geraeteId, identitaet, {
      geraeteId: anfrage.angebot.geraeteId,
      pkKem: anfrage.angebot.pkKem,
    })
  }

  return { freigeschaltet: lesbare.length, gesamt: faelle.length }
}

/** "2 von 3 Fällen freigeschaltet" (§4). */
export function freischaltungText({ freigeschaltet, gesamt }: Freischaltung): string {
  return `${freigeschaltet} von ${gesamt} ${gesamt === 1 ? 'Fall' : 'Fällen'} freigeschaltet`
}
