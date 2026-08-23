/**
 * Erzeugt die PWA-Icons (DESIGN.md §7 / Issue #1: Installation auf Android und iOS).
 *
 * Die Icons werden hier gerechnet statt beigelegt, damit sie reproduzierbar aus
 * den Farbwerten aus §12 entstehen und keine Binärdatei ohne Herkunft im Repo
 * liegt. Kein zusätzliches Paket: PNG ist einfach genug, um es direkt zu
 * schreiben, und §11.2 nennt die kurze Abhängigkeitsliste als Gegenmaßnahme.
 *
 *   node scripts/generate-icons.mjs
 */

import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const AUSGABE = join(dirname(fileURLToPath(import.meta.url)), '..', 'public')

// §12
const AKZENT = [0x35, 0x52, 0x3c]
const AUF_AKZENT = [0xfa, 0xf8, 0xf5]

const crcTabelle = (() => {
  const tabelle = new Uint32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    }
    tabelle[n] = c >>> 0
  }
  return tabelle
})()

function crc32(bytes) {
  let c = 0xffffffff
  for (const byte of bytes) {
    c = crcTabelle[(c ^ byte) & 0xff] ^ (c >>> 8)
  }
  return (c ^ 0xffffffff) >>> 0
}

function chunk(typ, daten) {
  const laenge = Buffer.alloc(4)
  laenge.writeUInt32BE(daten.length)

  const koerper = Buffer.concat([Buffer.from(typ, 'latin1'), daten])
  const pruefsumme = Buffer.alloc(4)
  pruefsumme.writeUInt32BE(crc32(koerper))

  return Buffer.concat([laenge, koerper, pruefsumme])
}

/** @param {number} groesse @param {(x: number, y: number) => number[]} farbe */
function png(groesse, farbe) {
  const zeilen = Buffer.alloc(groesse * (1 + groesse * 3))

  for (let y = 0; y < groesse; y += 1) {
    const anfang = y * (1 + groesse * 3)
    zeilen[anfang] = 0 // Filter "None"

    for (let x = 0; x < groesse; x += 1) {
      const [r, g, b] = farbe(x, y)
      const pos = anfang + 1 + x * 3
      zeilen[pos] = r
      zeilen[pos + 1] = g
      zeilen[pos + 2] = b
    }
  }

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(groesse, 0)
  ihdr.writeUInt32BE(groesse, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 2 // colour type: truecolour

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(zeilen, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

/**
 * Implizite Herzkurve: (x² + y² − 1)³ − x²y³ ≤ 0.
 * `skalierung` ist die halbe Kantenlänge des Herzens im Verhältnis zum Icon —
 * bei `maskable` kleiner, damit die Form innerhalb der sicheren Zone bleibt.
 */
function herzZeichner(groesse, skalierung) {
  const mitte = (groesse - 1) / 2
  const radius = mitte * skalierung
  // Ohne Überabtastung wird die Silhouette bei 192 px sichtbar treppig.
  const proben = [0.25, 0.75]

  return (px, py) => {
    let treffer = 0

    for (const dx of proben) {
      for (const dy of proben) {
        const x = (px + dx - 0.5 - mitte) / radius
        // Verschoben, weil die Kurve nicht um ihren optischen Mittelpunkt liegt.
        const y = -(py + dy - 0.5 - mitte) / radius + 0.25
        const t = x * x + y * y - 1

        if (t * t * t - x * x * y * y * y <= 0) {
          treffer += 1
        }
      }
    }

    const anteil = treffer / (proben.length * proben.length)

    return [0, 1, 2].map((k) =>
      Math.round(AKZENT[k] + (AUF_AKZENT[k] - AKZENT[k]) * anteil),
    )
  }
}

mkdirSync(AUSGABE, { recursive: true })

const dateien = [
  ['icon-192.png', 192, 0.58],
  ['icon-512.png', 512, 0.58],
  // Maskable: Android beschneidet bis zu 20 % je Rand.
  ['icon-maskable-512.png', 512, 0.42],
  ['apple-touch-icon-180.png', 180, 0.58],
]

for (const [name, groesse, skalierung] of dateien) {
  writeFileSync(join(AUSGABE, name), png(groesse, herzZeichner(groesse, skalierung)))
  console.log(`${name} (${groesse}×${groesse})`)
}
