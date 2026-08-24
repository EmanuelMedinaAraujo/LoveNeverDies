/**
 * Den Todesfall bestätigen und den Tresor öffnen (DESIGN.md §3.5, §5, §8).
 *
 * Der Übergang von `vorsorge` nach `trauerfall`, in zwei Hälften, die auf
 * verschiedenen Geräten und zu verschiedenen Zeiten laufen.
 *
 * **Freigeben** passiert auf dem Gerät eines Angehörigen: `share_i` mit `sk_u`
 * entpacken, gegen `share_hash_i` prüfen, unter dem aktuellen `K_c` neu
 * verschlüsseln, zweifach signieren. Die Hash-Prüfung steht vor allem anderen,
 * damit ein kaputter Wrap auffällt, bevor irgendetwas hochgeladen wird — eine
 * Freigabe ist nichts, was man zurücknimmt (§5).
 *
 * **Öffnen** passiert auf dem Gerät irgendeines Mitglieds: jede Freigabe mit
 * dem `K_c` ihrer eigenen Generation entschlüsseln, gegen ihren `share_hash`
 * prüfen, die gültigen zusammensetzen und das Ergebnis am `vault_commitment`
 * messen.
 *
 * Was hier **nicht** passiert: zählen. Der Zähler der Freigaben entscheidet
 * nichts (§3.5). Ein Mitglied kann jederzeit einen korrekt signierten,
 * inhaltlich falschen Share hochladen; der Zähler stiege trotzdem. Die
 * Entscheidung hängt allein am Nachweis, und den hat nur, wer `K_v` wirklich
 * rekonstruiert hat.
 *
 * Scheitert ein Share an seinem Hash, benennt dieses Modul die Person, von der
 * er kam — als Kennung, nicht als Name: Namen holt die Oberfläche aus
 * `profiles`. Ohne diese Auskunft bliebe der Familie nur "geht nicht", und
 * niemand wüsste, wen sie um eine zweite Freigabe bitten muss.
 */

import { entschluessele, verschluessele } from '../core/crypto/aead'
import { gleichZeitkonstant, sha256, textBytes } from '../core/crypto/bytes'
import {
  freigabeNachricht,
  stimmtTresorCommitment,
  tresorCommitment,
} from '../core/crypto/commitment'
import { entpackeDek, wrappeDek } from '../core/crypto/dek'
import { DOMAIN_SEPARATION } from '../core/crypto/domain'
import { entkapsele } from '../core/crypto/kem'
import type { Geraeteidentitaet } from '../core/crypto/keystore'
import { kombiniereShares } from '../core/crypto/shamir'
import { signiere } from '../core/crypto/sign'
import type { InhaltZeile } from '../core/db/inhalte'
import type { NeueFreigabe, VaultShareZeile } from '../core/db/tresor'
import { istGueltigesSterbedatum } from './fallService'

/** Freigeben oder Öffnen ist gescheitert. */
export class TodesfallFehler extends Error {
  constructor(nachricht: string, options?: ErrorOptions) {
    super(nachricht, options)
    this.name = 'TodesfallFehler'
  }
}

/**
 * Der Tresor liess sich nicht öffnen, und zwar aus einem benennbaren Grund.
 *
 * Trägt mit, wessen Freigaben unbrauchbar waren. §3.5: "Hier scheitert ein
 * gültig signierter Müll-Share, und die App kann benennen, von wem er kam,
 * statt nur 'geht nicht' zu melden."
 */
export class TresorOeffnenFehler extends TodesfallFehler {
  /** Die Kennungen der Personen, deren Share unbrauchbar war. */
  readonly fehlerhafte: string[]
  readonly gueltige: number
  readonly noetig: number

  constructor(nachricht: string, fehlerhafte: string[], gueltige: number, noetig: number) {
    super(nachricht)
    this.name = 'TresorOeffnenFehler'
    this.fehlerhafte = fehlerhafte
    this.gueltige = gueltige
    this.noetig = noetig
  }
}

/** Was eine Freigabe vom Fall braucht: die Kennung und den aktuellen `K_c`. */
export type Freigabefall = {
  id: string
  /** `current_kid`, die Generation, unter der neu verschlüsselt wird. */
  kid: string
  kc: Uint8Array
}

/** Was `erstelleFreigabe` vom Gerät braucht, und keinen Deut mehr. */
export type Freigabeidentitaet = Pick<Geraeteidentitaet, 'kem' | 'signatur'>

/**
 * Entpackt den eigenen Anteil und misst ihn an seinem Klartext-Hash (§3.5).
 *
 * Steht vor jedem Weg, den ein Anteil dieses Geräts nimmt — der Freigabe und
 * dem Gerätewechsel (§6): Ein kaputter Wrap fällt so auf, bevor irgendetwas
 * hochgeht. Eine Freigabe, die an ihrem Hash scheitert, zählte beim Öffnen
 * mit und liesse die Rekonstruktion sicher scheitern; ein weitergereichter
 * kaputter Anteil vererbte den Schaden ans nächste Gerät.
 *
 * @throws {TodesfallFehler} wenn der Wrap nicht an dieses Gerät gerichtet war
 * oder nicht zu `share_hash` passt.
 */
export async function entpackeEigenenAnteil(
  share: VaultShareZeile,
  identitaet: Freigabeidentitaet,
): Promise<Uint8Array> {
  let teil: Uint8Array

  try {
    const geteiltesGeheimnis = entkapsele(share.kemCt, identitaet.kem.geheim)
    teil = await entschluessele(geteiltesGeheimnis, share.wrappedShare)
  } catch (ursache) {
    throw new TodesfallFehler(
      'Ihr Schlüsselanteil lässt sich auf diesem Gerät nicht entpacken. Bitten Sie die vorsorgende Person um eine neue Verteilung.',
      { cause: ursache },
    )
  }

  if (!gleichZeitkonstant(await sha256(teil), share.shareHash)) {
    throw new TodesfallFehler(
      'Ihr Schlüsselanteil ist beschädigt und wird nicht weitergegeben. Bitten Sie die vorsorgende Person um eine neue Verteilung.',
    )
  }

  return teil
}

/**
 * Baut die Freigabe dieser Person (§3.5).
 *
 * @param share die eigene Zeile aus `vault_shares`, gewrappt an dieses Gerät.
 * @throws {TodesfallFehler} wenn der Anteil nicht zu `share_hash` passt. Dann
 * geht nichts hinaus.
 */
export async function erstelleFreigabe(
  fall: Freigabefall,
  identitaet: Freigabeidentitaet,
  geraeteId: string,
  userId: string,
  share: VaultShareZeile,
): Promise<NeueFreigabe> {
  const teil = await entpackeEigenenAnteil(share, identitaet)
  const releasedShare = await verschluessele(fall.kc, teil)

  return {
    caseId: fall.id,
    userId,
    geraeteId,
    kid: fall.kid,
    releasedShare,
    signatur: signiere(
      DOMAIN_SEPARATION.vaultRelease,
      await freigabeNachricht({ caseId: fall.id, userId, kid: fall.kid, releasedShare }),
      identitaet.signatur.geheim,
    ),
  }
}

/** Eine Zeile aus `vault_releases`, soweit das Öffnen sie braucht. */
export type Freigabezeile = {
  userId: string
  /** Die `K_c`-Generation, unter der `releasedShare` liegt (§3.4). */
  kid: string
  releasedShare: Uint8Array
}

export type Rekonstruktion = {
  kv: Uint8Array
  /** `SHA-256("LN-open-v1" ‖ K_v)`, der Nachweis für `open_vault`. */
  proof: Uint8Array
  /** Die Kennungen der Personen, deren Freigabe unbrauchbar war. */
  fehlerhafte: string[]
}

export type Rekonstruktionsauftrag = {
  freigaben: Freigabezeile[]
  /** `share_hash` je Person, aus `vault_shares`. */
  shareHashes: Map<string, Uint8Array>
  k: number
  commitment: Uint8Array
  /**
   * Der `K_c` einer Generation, oder `null`, wenn dieses Gerät sie nicht kennt.
   *
   * Zwischen Freigabe und Öffnen kann ein Mitglied austreten und `K_c`
   * rotieren (§3.4); deshalb trägt jede Freigabe ihr `kid` mit sich, und
   * deshalb wird hier nachgeschlagen statt durchprobiert.
   */
  fallschluessel: (kid: string) => Promise<Uint8Array | null>
}

/**
 * Setzt `K_v` aus den Freigaben zusammen und rechnet den Nachweis (§3.5).
 *
 * @throws {TresorOeffnenFehler} wenn nach dem Aussortieren weniger als `k`
 * brauchbare Teile übrig sind. Der Fehler benennt, an wem es lag.
 * @throws {TodesfallFehler} wenn genug Teile da waren, das Ergebnis aber nicht
 * zum `vault_commitment` passt. Dann ist irgendetwas anderes falsch als eine
 * einzelne Freigabe, und der Übergang findet nicht statt.
 */
export async function rekonstruiereTresorschluessel(
  auftrag: Rekonstruktionsauftrag,
): Promise<Rekonstruktion> {
  const gueltige: Uint8Array[] = []
  const fehlerhafte: string[] = []

  for (const freigabe of auftrag.freigaben) {
    const erwarteterHash = auftrag.shareHashes.get(freigabe.userId)
    const kc = await auftrag.fallschluessel(freigabe.kid)

    if (erwarteterHash === undefined || kc === null) {
      // Kein Hash heisst: Zu dieser Person steht kein Share im Fall, ihre
      // Freigabe stammt aus einer früheren Runde oder von niemandem. Kein
      // `K_c` heisst: Dieses Gerät kennt die Generation nicht. Beides ist von
      // hier aus dasselbe — unbrauchbar, und benennbar.
      fehlerhafte.push(freigabe.userId)
      continue
    }

    try {
      const teil = await entschluessele(kc, freigabe.releasedShare)

      if (gleichZeitkonstant(await sha256(teil), erwarteterHash)) {
        gueltige.push(teil)
      } else {
        fehlerhafte.push(freigabe.userId)
      }
    } catch {
      fehlerhafte.push(freigabe.userId)
    }
  }

  if (gueltige.length < auftrag.k) {
    throw new TresorOeffnenFehler(
      `Es liegen ${gueltige.length} brauchbare Freigaben vor, nötig sind ${auftrag.k}.`,
      fehlerhafte,
      gueltige.length,
      auftrag.k,
    )
  }

  // Bei `k = 1` ist der Share bereits `K_v` (§3.5): Die Bibliothek verlangt
  // `shares ≥ 2`, und ein einzelner Angehöriger bekommt einen Direktwrap. Das
  // ist die einzige Verzweigung im ganzen Tresorpfad.
  const kv =
    auftrag.k === 1
      ? (gueltige[0] ?? new Uint8Array())
      : await kombiniereShares(gueltige).catch((ursache: unknown) => {
          throw new TodesfallFehler('Die Schlüsselanteile passen nicht zusammen.', {
            cause: ursache,
          })
        })

  if (!(await stimmtTresorCommitment(kv, auftrag.commitment))) {
    throw new TodesfallFehler(
      'Der zusammengesetzte Tresorschlüssel passt nicht zum hinterlegten Nachweis. Der Tresor bleibt geschlossen.',
    )
  }

  return { kv, proof: await tresorCommitment(kv), fehlerhafte }
}

/** Ein Tresor-DEK, der von `K_v` auf `K_c` gewechselt ist (§3.5). */
export type Umwrap = {
  itemId: string
  /** Die `K_c`-Generation, unter der der DEK ab jetzt liegt. */
  kid: string
  wrappedDek: Uint8Array
}

/**
 * Wrappt die DEKs der Tresor-Items von `K_v` auf `K_c` um (§3.5).
 *
 * Der Payload wird dabei nicht angefasst: Der DEK ändert sich nie, es wechselt
 * nur der Schlüssel, unter dem er liegt (§3.1). Ein Tresor mit zehn Einträgen
 * kostet damit ein paar hundert Byte statt einer Neuverschlüsselung.
 *
 * Was sich nicht entpacken lässt, bleibt liegen. Beim Öffnen ist das kein
 * Defekt, sondern die Regel aus §3.7: Wer eine Zeile nicht lesen kann,
 * verwirft sie still — sonst bliebe der ganze Übergang an einem einzelnen
 * beschädigten Eintrag hängen.
 */
export async function umzuwrappendeTresorItems(
  zeilen: InhaltZeile[],
  kv: Uint8Array,
  kc: Uint8Array,
  kidFall: string,
): Promise<Umwrap[]> {
  const umwraps: Umwrap[] = []

  for (const zeile of zeilen) {
    if (!zeile.imTresor || zeile.geloescht) {
      continue
    }

    try {
      const dek = await entpackeDek(kv, zeile.wrappedDek)
      umwraps.push({ itemId: zeile.id, kid: kidFall, wrappedDek: await wrappeDek(kc, dek) })
    } catch {
      /* Nicht entpackbar: still verwerfen (§3.7). */
    }
  }

  return umwraps
}

/**
 * Der Fall-Payload mit dem Sterbedatum darin (§3.5).
 *
 * "Das Sterbedatum trägt die Person ein, die die Bestätigung startet. Es wird
 * unter `K_c` verschlüsselt abgelegt, die Fristen werden clientseitig daraus
 * berechnet."
 *
 * @throws {TodesfallFehler} wenn das Datum kein Kalendertag ist. Ohne ein
 * gültiges Datum steht jede gesetzliche Frist des Falls auf einem falschen
 * Anfang (§8).
 */
export async function fallPayloadMitSterbedatum(
  kc: Uint8Array,
  personName: string,
  sterbedatum: string,
): Promise<Uint8Array> {
  if (!istGueltigesSterbedatum(sterbedatum)) {
    throw new TodesfallFehler(`"${sterbedatum}" ist kein gültiges Sterbedatum.`)
  }

  return verschluessele(kc, textBytes(JSON.stringify({ personName, sterbedatum })))
}
