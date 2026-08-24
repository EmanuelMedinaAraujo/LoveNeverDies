import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { sha256, textBytes, verkette } from '../../src/core/crypto/bytes'
import { DOMAIN_SEPARATION } from '../../src/core/crypto/domain'
import { erzeugeSignaturSchluesselpaar, signiere, verifiziere } from '../../src/core/crypto/sign'

/**
 * Nahtstelle: die Domain-Trennung aus DESIGN.md §3.2.
 *
 * Jeder Hash und jede Signatur trägt ein Präfix, damit ein Wert aus einem
 * Kontext in keinem anderen gilt. Zwei Dinge müssen dafür stimmen: Die Präfixe
 * stehen an genau einer Stelle im Code, sonst driften Client und Edge Function
 * auseinander, und sie trennen wirklich.
 */

const src = fileURLToPath(new URL('../../src', import.meta.url))

const PRAEFIXE_AUS_DEM_DOKUMENT = [
  'LN-fp-v1',
  'LN-open-v1',
  'LN-rel-v1',
  'LN-wrap-v1',
  'LN-cat-v1',
]

function alleQuelldateien(ordner: string): string[] {
  return readdirSync(ordner, { withFileTypes: true }).flatMap((eintrag) => {
    const pfad = join(ordner, eintrag.name)

    if (eintrag.isDirectory()) return alleQuelldateien(pfad)

    return /\.(ts|tsx)$/.test(eintrag.name) ? [pfad] : []
  })
}

/**
 * Kommentare zählen nicht: In ihnen steht das Format aus §3.2 absichtlich noch
 * einmal. Der Ausdruck ist grob: Ein `//` in einem String kürzt die Zeile zu
 * früh, was höchstens ein Vorkommen übersieht und nie eines erfindet.
 */
function ohneKommentare(quelle: string): string {
  return quelle.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
}

describe('Die Präfixe stehen an genau einer Stelle', () => {
  const dateien = alleQuelldateien(src)

  it.each(PRAEFIXE_AUS_DEM_DOKUMENT)('%s kommt im Code genau einmal vor', (praefix) => {
    const vorkommen = dateien.flatMap((datei) => {
      const treffer = ohneKommentare(readFileSync(datei, 'utf8')).split(praefix).length - 1

      return Array.from({ length: treffer }, () => datei)
    })

    expect(vorkommen).toHaveLength(1)
    expect(vorkommen[0]).toMatch(/core[/\\]crypto[/\\]domain\.ts$/)
  })

  it('trägt die Werte aus §3.2', () => {
    expect(DOMAIN_SEPARATION).toEqual({
      fingerprint: 'LN-fp-v1',
      vaultCommitment: 'LN-open-v1',
      vaultRelease: 'LN-rel-v1',
      keyWrap: 'LN-wrap-v1',
      catalogItemId: 'LN-cat-v1',
    })
  })
})

describe('Die Präfixe trennen', () => {
  const praefixe = Object.values(DOMAIN_SEPARATION)
  const EINGABE = textBytes('derselbe Wert')

  it('gibt jedem Präfix einen eigenen Hash über derselben Eingabe', async () => {
    const hashes = await Promise.all(
      praefixe.map(async (praefix) =>
        Buffer.from(await sha256(verkette(textBytes(praefix), EINGABE))).toString('hex'),
      ),
    )

    expect(new Set(hashes).size).toBe(praefixe.length)
  })

  it('lässt keine Signatur unter einem fremden Präfix gelten', () => {
    const geraet = erzeugeSignaturSchluesselpaar()

    for (const signiertUnter of praefixe) {
      const signatur = signiere(signiertUnter, EINGABE, geraet.geheim)

      for (const gepruefteUnter of praefixe) {
        expect(verifiziere(signatur, gepruefteUnter, EINGABE, geraet.oeffentlich)).toBe(
          signiertUnter === gepruefteUnter,
        )
      }
    }
  })
})
