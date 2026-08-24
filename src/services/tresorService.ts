/**
 * Tresor-Inhalte verwalten und Shamir-Shares verteilen (DESIGN.md §3.5).
 *
 * Die vorsorgende Person behält K_v. Anteile gehen an die Angehörigen:
 * - n = Anzahl Angehöriger ohne Preparer
 * - k = max(1, ⌈2n/3⌉)
 * - n = 0: versiegelt, keine Freigaben möglich
 * - n = 1: Direktwrap (share_1 = K_v) ohne Shamir (§3.5)
 * - n >= 2: Shamir-Split mit Schwelle k
 *
 * Jeder Angehörige erhält auf jedem registrierten Gerät einen Share mit share_hash.
 * Neuverteilungen laufen atomar über die RPC resplit_vault.
 */

import { entschluessele, verschluessele } from '../core/crypto/aead'
import { bytesText, sha256, textBytes } from '../core/crypto/bytes'
import { entpackeDek, erzeugeDek, wrappeDek } from '../core/crypto/dek'
import { kapsele } from '../core/crypto/kem'
import { teileGeheimnis } from '../core/crypto/shamir'
import type { GeraeteschluesselTabelle } from '../core/db/geraeteschluessel'
import type { InhaltZeile } from '../core/db/inhalte'
import type { MitgliederTabelle } from '../core/db/mitglieder'
import type { ResplitShareInput, TresorTabelle } from '../core/db/tresor'
import type { Mutation } from '../core/sync/queue'
import { uuidv7 } from '../core/uuidv7'

export class TresorDienstFehler extends Error {
  constructor(nachricht: string, options?: ErrorOptions) {
    super(nachricht, options)
    this.name = 'TresorDienstFehler'
  }
}

export type TresorSchwelle = {
  n: number
  k: number | null
}

export type TresorItem = {
  id: string
  titel: string
  inhalt: string
  dek: Uint8Array
  geaendertAm: string
}

export type TresorItemPayload = {
  typ: 'tresor'
  titel: string
  inhalt: string
}

/**
 * Berechnet `n` und `k` gemäß §3.5:
 * `n = 0` -> `k = null`
 * `n = 1` -> `k = 1`
 * `n >= 2` -> `k = max(1, ⌈2n/3⌉)`
 */
export function berechneTresorSchwelle(n: number): TresorSchwelle {
  if (n <= 0) {
    return { n: 0, k: null }
  }

  if (n === 1) {
    return { n: 1, k: 1 }
  }

  return { n, k: Math.max(1, Math.ceil((2 * n) / 3)) }
}

/**
 * Verteilt `K_v` an alle Angehörigen des Falls (ohne den Preparer).
 *
 * @param preparerId Die User-ID des Preparers, damit er nicht mitgezählt wird (§3.5).
 */
export async function verteileShares(
  tresorDb: TresorTabelle,
  mitgliederDb: MitgliederTabelle,
  geraeteDb: GeraeteschluesselTabelle,
  fallId: string,
  kv: Uint8Array,
  preparerId: string,
): Promise<TresorSchwelle> {
  const alleMitglieder = await mitgliederDb.imFall(fallId)
  const angehoerige = alleMitglieder.filter((m) => m.userId !== preparerId)
  const n = angehoerige.length

  if (n === 0) {
    await tresorDb.resplitVault(fallId, 0, null, [])
    return { n: 0, k: null }
  }

  if (n === 1) {
    // n = 1: Direktwrap ohne Shamir-Aufruf (§3.5)
    const mitglied = angehoerige[0]
    if (mitglied === undefined) {
      throw new TresorDienstFehler('Angehörige nicht gefunden.')
    }

    const geraete = await geraeteDb.fuerBenutzer(mitglied.userId)
    const shareHash = await sha256(kv)
    const shares: ResplitShareInput[] = []

    for (const geraet of geraete) {
      const kapselung = kapsele(geraet.pkKem)
      const wrappedShare = await verschluessele(kapselung.geteiltesGeheimnis, kv)
      shares.push({
        userId: mitglied.userId,
        deviceId: geraet.id,
        shareIndex: 1,
        shareHash,
        kemCt: kapselung.kemCt,
        wrappedShare,
      })
    }

    await tresorDb.resplitVault(fallId, 1, 1, shares)
    return { n: 1, k: 1 }
  }

  // n >= 2: Shamir-Split mit k = ⌈2n/3⌉
  const k = Math.max(1, Math.ceil((2 * n) / 3))
  const teile = await teileGeheimnis(kv, n, k)
  const shares: ResplitShareInput[] = []

  for (let i = 0; i < n; i++) {
    const mitglied = angehoerige[i]
    const teil = teile[i]
    if (mitglied === undefined || teil === undefined) {
      continue
    }

    const shareHash = await sha256(teil)
    const geraete = await geraeteDb.fuerBenutzer(mitglied.userId)

    for (const geraet of geraete) {
      const kapselung = kapsele(geraet.pkKem)
      const wrappedShare = await verschluessele(kapselung.geteiltesGeheimnis, teil)
      shares.push({
        userId: mitglied.userId,
        deviceId: geraet.id,
        shareIndex: i + 1,
        shareHash,
        kemCt: kapselung.kemCt,
        wrappedShare,
      })
    }
  }

  await tresorDb.resplitVault(fallId, n, k, shares)
  return { n, k }
}

/**
 * Erzeugt eine Mutation für ein neues Tresor-Item:
 * DEK erzeugen, Payload unter DEK verschlüsseln, DEK unter `K_v` wrappen.
 */
export async function mutationTresorAnlegen(
  fallId: string,
  kv: Uint8Array,
  titel: string,
  inhalt: string,
): Promise<Mutation> {
  const gekuerzterTitel = titel.trim()
  if (gekuerzterTitel === '') {
    throw new TresorDienstFehler('Ein Tresor-Eintrag braucht einen Titel.')
  }

  const id = uuidv7()
  const dek = erzeugeDek()

  const payload: TresorItemPayload = {
    typ: 'tresor',
    titel: gekuerzterTitel,
    inhalt: inhalt.trim(),
  }

  const [verschluesselterPayload, wrappedDek] = await Promise.all([
    verschluessele(dek, textBytes(JSON.stringify(payload))),
    wrappeDek(kv, dek),
  ])

  return {
    op: 'anlegen',
    itemId: id,
    fallId,
    art: 'item',
    kid: `vault_${fallId}`,
    wrappedDek,
    payload: verschluesselterPayload,
    imTresor: true,
    ts: Date.now(),
  }
}

/**
 * Erzeugt eine Mutation zum Löschen eines Tresor-Items (Tombstone).
 */
export function mutationTresorLoeschen(itemId: string): Mutation {
  return { op: 'loeschen', itemId, ts: Date.now() }
}

/**
 * Entschlüsselt alle Tresor-Items aus den synchronisierten Zeilen.
 */
export async function tresorItemsAusZeilen(
  zeilen: InhaltZeile[],
  kv: Uint8Array,
): Promise<TresorItem[]> {
  const items: TresorItem[] = []

  for (const zeile of zeilen) {
    if (zeile.geloescht || !zeile.imTresor) {
      continue
    }

    try {
      const dek = await entpackeDek(kv, zeile.wrappedDek)
      const klartext = await entschluessele(dek, zeile.payload)
      const json = JSON.parse(bytesText(klartext)) as Partial<TresorItemPayload>

      if (json.typ === 'tresor' && typeof json.titel === 'string') {
        items.push({
          id: zeile.id,
          titel: json.titel,
          inhalt: typeof json.inhalt === 'string' ? json.inhalt : '',
          dek,
          geaendertAm: zeile.geaendertAm,
        })
      }
    } catch {
      // Fehlerhafte oder unpassende Zeilen überspringen.
    }
  }

  return items
}
