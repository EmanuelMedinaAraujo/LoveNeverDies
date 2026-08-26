/**
 * Kopiert die rechtlichen Dokumente von legal/*.html nach public/legal/.
 *
 * `legal/` ist die Quelle fuer die statischen HTML-Seiten (Datenschutz,
 * Einwilligungserklaerung, Nutzungsbedingungen). Vite kopiert den Inhalt von
 * `public/` in das Ausgabeverzeichnis `dist/`, wo Cloudflare Workers sie
 * als statische Assets serviert.
 *
 *   node scripts/copy-legal.mjs
 */

import { cpSync, mkdirSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HIER = dirname(fileURLToPath(import.meta.url))
const QUELLE = join(HIER, '..', 'legal')
const ZIEL = join(HIER, '..', 'public', 'legal')

mkdirSync(ZIEL, { recursive: true })

const dateien = readdirSync(QUELLE).filter((datei) => datei.endsWith('.html'))

for (const datei of dateien) {
  cpSync(join(QUELLE, datei), join(ZIEL, datei), { force: true })
  console.log(`Kopiert: legal/${datei} -> public/legal/${datei}`)
}
