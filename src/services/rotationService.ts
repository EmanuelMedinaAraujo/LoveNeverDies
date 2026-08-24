/**
 * Schlüsselrotation beim Verlassen eines Falls (DESIGN.md §3.4, §4, §7).
 *
 * Verlässt jemand einen Fall, setzt die Datenbank `rotation_pending = true`.
 * Das nächste verbleibende Mitglied beansprucht über `claim_rotation` ein
 * Mandat für 2 Minuten mit Zeilensperre.
 *
 * Der Mandatsinhaber:
 * 1. erzeugt einen frischen Fallschlüssel `K_c` für Generation + 1,
 * 2. wrappt `K_c` an alle aktiven Geräte aller verbleibenden Mitglieder,
 * 3. entpackt die DEKs aller geteilten Items unter dem alten `K_c`, wrappt sie
 *    unter dem neuen `K_c` und aktualisiert die Zeilen,
 * 4. verschlüsselt den Fall-Payload unter dem neuen `K_c`,
 * 5. bestätigt die Rotation atomar per Compare-and-Swap (`commit_rotation`).
 *
 * Tresor-Items und private Items bleiben unberührt, weil ihre DEKs unter `K_v`
 * bzw. `K_p` liegen (§3.4).
 */

import { entschluessele, erzeugeAesSchluessel, verschluessele } from '../core/crypto/aead'
import { textBytes } from '../core/crypto/bytes'
import type { Geraeteidentitaet } from '../core/crypto/keystore'
import { wrappeSchluessel } from '../core/crypto/wrap'
import type { FaelleTabelle, RotierteItemZeile } from '../core/db/faelle'
import type { SchluesselwrapTabelle, SchluesselwrapZeile } from '../core/db/fallschluessel'
import type { GeraeteschluesselTabelle } from '../core/db/geraeteschluessel'
import type { InhalteTabelle } from '../core/db/inhalte'
import type { MitgliederTabelle } from '../core/db/mitglieder'
import type { LesbarerFall } from './fallService'

export type RotationErgebnis =
  | {
      status: 'erfolg'
      kidNeu: string
      kcNeu: Uint8Array
      keyGeneration: number
    }
  | { status: 'mandat_verweigert' }
  | { status: 'cas_fehlgeschlagen' }

/**
 * Führt die Schlüsselrotation für einen Fall durch (§3.4).
 */
export async function rotiereFallschluessel(
  faelle: FaelleTabelle,
  inhalte: InhalteTabelle,
  fallschluessel: SchluesselwrapTabelle,
  geraete: GeraeteschluesselTabelle,
  mitglieder: MitgliederTabelle,
  fall: LesbarerFall,
  identitaet: Geraeteidentitaet,
  geraeteId: string,
): Promise<RotationErgebnis> {
  const generation = fall.keyGeneration ?? 1

  // 1. Mandat beanspruchen (2 Minuten mit Zeilensperre)
  const mandatErhalten = await faelle.claimRotation(fall.id, generation, geraeteId)
  if (!mandatErhalten) {
    return { status: 'mandat_verweigert' }
  }

  // 2. Frischen Fallschlüssel K_c für Generation + 1 erzeugen
  const naechsteGen = generation + 1
  const kidNeu = `case_${fall.id}:${naechsteGen}`
  const kcNeu = erzeugeAesSchluessel()

  // 3. Alle aktuellen Mitglieder und deren Geräte ermitteln
  const mitgliederListe = await mitglieder.imFall(fall.id)
  const userIds = mitgliederListe.map((m) => m.userId)
  const geraeteListen = await Promise.all(userIds.map((uid) => geraete.fuerBenutzer(uid)))
  const alleGeraete = geraeteListen.flat()

  // 4. K_c an alle Geräte der verbleibenden Mitglieder wrappen
  const wraps: SchluesselwrapZeile[] = await Promise.all(
    alleGeraete.map(async (g) => {
      const wrap = await wrappeSchluessel(
        kcNeu,
        { geraeteId: g.id, pkKem: g.pkKem },
        { fallId: fall.id, kid: kidNeu },
        identitaet.signatur.geheim,
      )
      return {
        fallId: fall.id,
        kid: kidNeu,
        geraeteId: g.id,
        kemCt: wrap.kemCt,
        wrappedKey: wrap.wrappedKey,
        wrappedBy: geraeteId,
        signatur: wrap.signatur,
      }
    }),
  )
  await fallschluessel.schreibeWraps(wraps)

  // 5. Nur geteilte Items unter dem alten K_c umwrappen (gesammelt für atomaren Commit)
  const alleItems = await inhalte.seit(fall.id, 0)
  const umgewrappteItems: RotierteItemZeile[] = []

  for (const item of alleItems) {
    // Tresor-Items, Privat-Items und gelöschte leere Items auslassen
    if (item.kid !== fall.kid || item.imTresor || item.geloescht || item.wrappedDek.length === 0) {
      continue
    }

    const dek = await entschluessele(fall.kc, item.wrappedDek)
    const neuWrappedDek = await verschluessele(kcNeu, dek)
    umgewrappteItems.push({ id: item.id, wrappedDek: neuWrappedDek })
  }

  // 6. Fall-Payload unter neuem K_c verschlüsseln
  const angaben = {
    personName: fall.personName,
    sterbedatum: fall.sterbedatum,
  }
  const neuerPayload = await verschluessele(kcNeu, textBytes(JSON.stringify(angaben)))

  // 7. Rotation und Item-Rewraps atomar per CAS bestätigen
  const committet = await faelle.commitRotation(
    fall.id,
    generation,
    kidNeu,
    geraeteId,
    neuerPayload,
    umgewrappteItems,
  )

  if (!committet) {
    return { status: 'cas_fehlgeschlagen' }
  }

  return {
    status: 'erfolg',
    kidNeu,
    kcNeu,
    keyGeneration: naechsteGen,
  }
}
