/**
 * Erzeugt die PWA-Icons und die Favicons aus den beiden Kacheln (DESIGN.md §7).
 *
 * Quelle sind `scripts/icon/kachel-dunkel.png` und `scripts/icon/kachel-hell.png`:
 * die beiden gelieferten Marken-Icons, aus ihrem weissen Blatt herausgeschnitten
 * und mit ihrer eigenen Flaechenfarbe bis in die Ecken gefuellt. Randfuellend
 * und nicht mit runden Ecken, weil iOS und Android ohnehin ihre eigene Maske
 * darueberlegen; eine mitgelieferte Rundung ergaebe dort einen zweiten Rand.
 * Daneben liegen die Originale (`LNDIcon*.jpg`), aus denen sie einmalig
 * geschnitten wurden.
 *
 * Gerechnet wird hier und nicht von Hand, damit die Groessen reproduzierbar aus
 * einer Quelle fallen und keine Binaerdatei ohne Herkunft im Repo liegt. Kein
 * zusaetzliches Paket: PNG ist einfach genug, um es zu lesen und zu schreiben,
 * und §11.2 nennt die kurze Abhaengigkeitsliste als Gegenmassnahme.
 *
 *   node scripts/generate-icons.mjs
 *
 * **Welche Kachel wohin.** App-Icon, Maskable und Apple-Touch nehmen die dunkle:
 * Sie steht auf jedem Hintergrund, waehrend die helle auf einem hellen
 * Startbildschirm verschwindet. Das Manifest kennt ohnehin nur einen Satz
 * Icons; ein Farbschema kann es nicht (Web App Manifest, `icons`). Das Favicon
 * dagegen schon: `index.html` verlinkt beide mit `media` und laesst den Browser
 * waehlen.
 */

import { deflateSync, inflateSync } from 'node:zlib'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HIER = dirname(fileURLToPath(import.meta.url))
const QUELLE = join(HIER, 'icon')
const AUSGABE = join(HIER, '..', 'public')

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

/**
 * Ein Bild: `{ breite, hoehe, daten }` mit drei Bytes je Pixel.
 *
 * Gelesen wird genau die Form, die hier auch geschrieben wird: 8 Bit,
 * Truecolour ohne Alpha, nicht verschraenkt. Alles andere wirft, statt still
 * etwas Falsches zu rechnen -- die Quellen liegen im Repo, und wenn eine davon
 * ihre Form aendert, soll dieser Lauf es sagen.
 */
function lesePng(pfad) {
  const datei = readFileSync(pfad)
  const breite = datei.readUInt32BE(16)
  const hoehe = datei.readUInt32BE(20)
  const [tiefe, farbtyp, , , verschraenkt] = datei.subarray(24, 29)

  if (tiefe !== 8 || farbtyp !== 2 || verschraenkt !== 0) {
    throw new Error(`${pfad}: erwartet 8-Bit-Truecolour ohne Verschraenkung.`)
  }

  const teile = []
  let pos = 8

  while (pos < datei.length) {
    const laenge = datei.readUInt32BE(pos)
    const typ = datei.subarray(pos + 4, pos + 8).toString('latin1')

    if (typ === 'IDAT') {
      teile.push(datei.subarray(pos + 8, pos + 8 + laenge))
    }

    pos += 12 + laenge
  }

  const roh = inflateSync(Buffer.concat(teile))
  const daten = Buffer.alloc(breite * hoehe * 3)

  /*
   * Die Rueckfilterung aus der PNG-Spezifikation, alle fuenf Typen. Jede Zeile
   * traegt ihren Typ als erstes Byte und bezieht sich auf den bereits
   * zurueckgefilterten linken Nachbarn (`a`), die Zeile darueber (`b`) und
   * deren linken Nachbarn (`c`).
   */
  for (let y = 0; y < hoehe; y += 1) {
    const anfangRoh = y * (1 + breite * 3)
    const typ = roh[anfangRoh]
    const zeile = y * breite * 3
    const darueber = (y - 1) * breite * 3

    for (let i = 0; i < breite * 3; i += 1) {
      const x = roh[anfangRoh + 1 + i]
      const a = i >= 3 ? daten[zeile + i - 3] : 0
      const b = y > 0 ? daten[darueber + i] : 0
      const c = y > 0 && i >= 3 ? daten[darueber + i - 3] : 0

      let wert
      switch (typ) {
        case 0:
          wert = x
          break
        case 1:
          wert = x + a
          break
        case 2:
          wert = x + b
          break
        case 3:
          wert = x + ((a + b) >> 1)
          break
        case 4: {
          const p = a + b - c
          const pa = Math.abs(p - a)
          const pb = Math.abs(p - b)
          const pc = Math.abs(p - c)
          wert = x + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)
          break
        }
        default:
          throw new Error(`${pfad}: unbekannter Zeilenfilter ${typ}.`)
      }

      daten[zeile + i] = wert & 0xff
    }
  }

  return { breite, hoehe, daten }
}

function schreibePng(bild, pfad) {
  const { breite, hoehe, daten } = bild
  const zeilen = Buffer.alloc(hoehe * (1 + breite * 3))

  for (let y = 0; y < hoehe; y += 1) {
    const anfang = y * (1 + breite * 3)
    zeilen[anfang] = 0 // Filter "None"
    daten.copy(zeilen, anfang + 1, y * breite * 3, (y + 1) * breite * 3)
  }

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(breite, 0)
  ihdr.writeUInt32BE(hoehe, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 2 // colour type: truecolour

  writeFileSync(
    pfad,
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk('IHDR', ihdr),
      chunk('IDAT', deflateSync(zeilen, { level: 9 })),
      chunk('IEND', Buffer.alloc(0)),
    ]),
  )
}

/**
 * Verkleinert auf `kante`, als Flaechenmittel ueber die abgedeckten Quellpixel.
 *
 * Kein Nearest-Neighbour: 920 auf 192 ist Faktor 4,79, und jede zweite Kante
 * der Zeichnung fiele dabei auf ein anderes Pixel als ihre Nachbarin. Die
 * Fenster sind bewusst bruchteilig gewichtet -- ein ganzzahliges Fenster
 * verschoebe das Bild bei jeder Groesse ein Stueck weit.
 */
function verkleinere(bild, kante) {
  const daten = Buffer.alloc(kante * kante * 3)
  const schritt = bild.breite / kante

  for (let y = 0; y < kante; y += 1) {
    const y0 = y * schritt
    const y1 = (y + 1) * schritt

    for (let x = 0; x < kante; x += 1) {
      const x0 = x * schritt
      const x1 = (x + 1) * schritt
      const summe = [0, 0, 0]
      let gewicht = 0

      for (let qy = Math.floor(y0); qy < Math.ceil(y1); qy += 1) {
        const hoch = Math.min(qy + 1, y1) - Math.max(qy, y0)

        for (let qx = Math.floor(x0); qx < Math.ceil(x1); qx += 1) {
          const breit = Math.min(qx + 1, x1) - Math.max(qx, x0)
          const anteil = hoch * breit
          const pos = (qy * bild.breite + qx) * 3

          summe[0] += bild.daten[pos] * anteil
          summe[1] += bild.daten[pos + 1] * anteil
          summe[2] += bild.daten[pos + 2] * anteil
          gewicht += anteil
        }
      }

      const ziel = (y * kante + x) * 3
      daten[ziel] = Math.round(summe[0] / gewicht)
      daten[ziel + 1] = Math.round(summe[1] / gewicht)
      daten[ziel + 2] = Math.round(summe[2] / gewicht)
    }
  }

  return { breite: kante, hoehe: kante, daten }
}

/**
 * Dasselbe Bild, auf `anteil` seiner Kante geschrumpft und in seiner eigenen
 * Flaechenfarbe zentriert.
 *
 * Fuer `purpose: maskable`: Android beschneidet bis zu 20 % je Rand, die
 * sichere Zone ist ein Kreis mit 80 % Durchmesser. Die Kachel selbst ist
 * randfuellend, also faellt beim Beschneiden nur Flaeche weg -- aber die Voegel
 * sitzen dicht an der Kante und waeren die ersten, die gehen.
 */
function mitLuft(bild, anteil) {
  const kante = bild.breite
  const innen = Math.round(kante * anteil)
  const klein = verkleinere(bild, innen)
  const rand = Math.round((kante - innen) / 2)

  // Die Flaechenfarbe steht in der Ecke: Dort ist die Kachel schlicht.
  const flaeche = [bild.daten[0], bild.daten[1], bild.daten[2]]
  const daten = Buffer.alloc(kante * kante * 3)

  for (let i = 0; i < kante * kante; i += 1) {
    daten[i * 3] = flaeche[0]
    daten[i * 3 + 1] = flaeche[1]
    daten[i * 3 + 2] = flaeche[2]
  }

  for (let y = 0; y < innen; y += 1) {
    klein.daten.copy(
      daten,
      ((y + rand) * kante + rand) * 3,
      y * innen * 3,
      (y + 1) * innen * 3,
    )
  }

  return { breite: kante, hoehe: kante, daten }
}

const dunkel = lesePng(join(QUELLE, 'kachel-dunkel.png'))
const hell = lesePng(join(QUELLE, 'kachel-hell.png'))

mkdirSync(AUSGABE, { recursive: true })

const dateien = [
  ['icon-192.png', verkleinere(dunkel, 192)],
  ['icon-512.png', verkleinere(dunkel, 512)],
  ['icon-maskable-512.png', verkleinere(mitLuft(dunkel, 0.8), 512)],
  ['apple-touch-icon-180.png', verkleinere(dunkel, 180)],
  // Beide, weil `index.html` sie per `media` dem Farbschema ueberlaesst.
  ['favicon-dunkel-64.png', verkleinere(dunkel, 64)],
  ['favicon-hell-64.png', verkleinere(hell, 64)],
  // Der Anmeldescreen zeigt die Marke ueber dem Formular. Dort entscheidet
  // nicht `prefers-color-scheme`, sondern der Override aus Profil -- also
  // waehlt der Screen selbst (`useFarbschema`), und beide muessen bereitliegen.
  ['logo-dunkel-256.png', verkleinere(dunkel, 256)],
  ['logo-hell-256.png', verkleinere(hell, 256)],
]

for (const [name, bild] of dateien) {
  schreibePng(bild, join(AUSGABE, name))
  console.log(`${name} (${bild.breite}x${bild.hoehe})`)
}
