import { describe, expect, it, vi } from 'vitest'
import { entschluessele, verschluessele } from '../../src/core/crypto/aead'
import { bytesText, textBytes } from '../../src/core/crypto/bytes'
import { direkteDateikrypto } from '../../src/core/crypto/dateikrypto'
import { entpackeDek, erzeugeDek, wrappeDek } from '../../src/core/crypto/dek'
import type { Dokumentablage } from '../../src/core/db/ablage'
import type { InhalteTabelle, InhaltZeile, NeuerInhalt } from '../../src/core/db/inhalte'
import {
  DokumentFehler,
  dokumenteAusZeilen,
  loescheDokument,
  MAX_DOKUMENT_BYTES,
  nimmDokumentAuf,
  oeffneDokument,
  type Dateiauswahl,
  type Dokumentpayload,
  type Dokumentwerkzeug,
} from '../../src/services/dokumentService'
import type { Fallschluessel } from '../../src/services/aufgabenService'

/**
 * Dokumente aufnehmen, ansehen und löschen (DESIGN.md §7).
 *
 * Geprüft wird, was §7 zusagt und was der Dienst allein entscheidet: die
 * Grenze bei 15 MB, dass im Storage nichts Lesbares liegt, die Reihenfolge
 * beim Anlegen und beim Löschen — und dass ein Fehlschlag beim Aufräumen die
 * endgültige Aussage „gelöscht" nicht zurücknimmt.
 */

const FALL: Fallschluessel = { id: 'fall-1', kid: 'case_fall-1:1', kc: erzeugeDek() }

/**
 * Ciphertext als Text lesen — so weit er sich lesen lässt.
 *
 * `bytesText` wirft bei allem, was kein gültiges UTF-8 ist, und Ciphertext ist
 * das fast nie. Für die Frage „steht hier noch etwas Lesbares?" ist der
 * nachsichtige Decoder der richtige: Bliebe irgendwo Klartext stehen, stünde er
 * als ASCII mitten in den Ersatzzeichen.
 */
function lesbar(bytes: Uint8Array): string {
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes)
}

/** Eine Ablage, die sich merkt, was sie bekommen hat. */
function ablage() {
  const objekte = new Map<string, Uint8Array>()
  const entfernt: string[] = []
  let ladeFehler: Error | null = null
  let entferneFehler: Error | null = null

  const port: Dokumentablage = {
    lade(pfad, ciphertext) {
      if (ladeFehler !== null) {
        return Promise.reject(ladeFehler)
      }

      objekte.set(pfad, ciphertext)
      return Promise.resolve()
    },
    hole(pfad) {
      const bytes = objekte.get(pfad)

      return bytes === undefined
        ? Promise.reject(new Error(`Nichts unter ${pfad}.`))
        : Promise.resolve(bytes)
    },
    entferne(pfad) {
      entfernt.push(pfad)

      if (entferneFehler !== null) {
        return Promise.reject(entferneFehler)
      }

      objekte.delete(pfad)
      return Promise.resolve()
    },
  }

  return {
    port,
    objekte,
    entfernt,
    scheitereBeimLaden: (fehler: Error) => (ladeFehler = fehler),
    scheitereBeimEntfernen: (fehler: Error) => (entferneFehler = fehler),
  }
}

/** Eine `items`-Tabelle, die nur mitschreibt. */
function inhalte() {
  const gelegt: NeuerInhalt[] = []
  const geloescht: string[] = []
  let legeFehler: Error | null = null
  let loescheFehler: Error | null = null

  const port: InhalteTabelle = {
    seit: () => Promise.resolve([]),
    lege(neu) {
      if (legeFehler !== null) {
        return Promise.reject(legeFehler)
      }

      gelegt.push(neu)
      return Promise.resolve()
    },
    legeAlleNeuen: () => Promise.resolve(),
    schreibePayload: () => Promise.resolve(),
    loesche(id) {
      if (loescheFehler !== null) {
        return Promise.reject(loescheFehler)
      }

      geloescht.push(id)
      return Promise.resolve()
    },
  }

  return {
    port,
    gelegt,
    geloescht,
    scheitereBeimLegen: (fehler: Error) => (legeFehler = fehler),
    scheitereBeimLoeschen: (fehler: Error) => (loescheFehler = fehler),
  }
}

function werkzeug(): Dokumentwerkzeug & {
  ablage: ReturnType<typeof ablage>['port']
  hilfen: { ablage: ReturnType<typeof ablage>; inhalte: ReturnType<typeof inhalte> }
} {
  const a = ablage()
  const i = inhalte()

  return {
    fall: FALL,
    ablage: a.port,
    inhalte: i.port,
    krypto: direkteDateikrypto(),
    hilfen: { ablage: a, inhalte: i },
  }
}

/** Eine Datei, wie ein `<input type="file">` sie liefert. */
function datei(
  inhalt = 'JPEG-Bytes einer Sterbeurkunde',
  ueberschreibung: Partial<Dateiauswahl> = {},
): Dateiauswahl {
  const bytes = textBytes(inhalt)

  return {
    name: 'sterbeurkunde.jpg',
    type: 'image/jpeg',
    size: bytes.length,
    arrayBuffer: () => Promise.resolve(bytes.buffer as ArrayBuffer),
    ...ueberschreibung,
  }
}

describe('nimmDokumentAuf', () => {
  it('legt Datei und Zeile unter demselben Pfad an', async () => {
    const w = werkzeug()

    const dokument = await nimmDokumentAuf(w, datei(), 'item-7')

    expect(dokument.pfad).toBe(`fall-1/${dokument.id}`)
    expect(dokument.aufgabeId).toBe('item-7')
    expect([...w.hilfen.ablage.objekte.keys()]).toEqual([dokument.pfad])

    const zeile = w.hilfen.inhalte.gelegt[0]
    expect(zeile).toMatchObject({ art: 'file', kid: FALL.kid, storagePfad: dokument.pfad })
  })

  it('legt im Storage nichts ab, was als Bild oder als Text zu lesen wäre', async () => {
    const w = werkzeug()

    const dokument = await nimmDokumentAuf(w, datei('JFIF Sterbeurkunde Hans Weber'))
    const abgelegt = w.hilfen.ablage.objekte.get(dokument.pfad)!

    expect(lesbar(abgelegt)).not.toContain('Sterbeurkunde')
    expect(lesbar(abgelegt)).not.toContain('Hans Weber')

    // Und der Weg zurück steht offen — mit dem DEK, den nur ein Mitglied hat.
    expect(bytesText(await oeffneDokument(dokument, w.ablage, w.krypto))).toBe(
      'JFIF Sterbeurkunde Hans Weber',
    )
  })

  it('lässt den Dateinamen nicht im Klartext hinaus', async () => {
    const w = werkzeug()

    await nimmDokumentAuf(w, datei())

    const zeile = w.hilfen.inhalte.gelegt[0]!
    expect(lesbar(zeile.payload)).not.toContain('sterbeurkunde.jpg')

    // Aber ein Mitglied liest ihn: Der Payload liegt unter dem DEK der Zeile,
    // der DEK unter K_c (§3.1).
    const dek = await entpackeDek(FALL.kc, zeile.wrappedDek)
    const payload = JSON.parse(bytesText(await entschluessele(dek, zeile.payload))) as Dokumentpayload

    expect(payload).toMatchObject({
      typ: 'dokument',
      name: 'sterbeurkunde.jpg',
      mimetyp: 'image/jpeg',
    })
  })

  it('weist eine Datei über 15 MB ab, ohne sie zu lesen', async () => {
    const w = werkzeug()
    const arrayBuffer = vi.fn(() => Promise.resolve(new ArrayBuffer(0)))

    await expect(
      nimmDokumentAuf(w, datei('egal', { size: MAX_DOKUMENT_BYTES + 1, arrayBuffer })),
    ).rejects.toThrow(/15 MB/)

    // „nicht stillschweigend abgeschnitten" (§7): Es wird gar nichts gelesen
    // und gar nichts hochgeladen.
    expect(arrayBuffer).not.toHaveBeenCalled()
    expect(w.hilfen.ablage.objekte.size).toBe(0)
    expect(w.hilfen.inhalte.gelegt).toHaveLength(0)
  })

  it('nimmt eine Datei von genau 15 MB noch an', async () => {
    const w = werkzeug()
    const gross = new Uint8Array(MAX_DOKUMENT_BYTES)

    const dokument = await nimmDokumentAuf(
      w,
      datei('egal', {
        size: MAX_DOKUMENT_BYTES,
        arrayBuffer: () => Promise.resolve(gross.buffer as ArrayBuffer),
      }),
    )

    expect(w.hilfen.ablage.objekte.has(dokument.pfad)).toBe(true)
  })

  it('weist eine leere Datei ab', async () => {
    const w = werkzeug()

    await expect(nimmDokumentAuf(w, datei('', { size: 0 }))).rejects.toBeInstanceOf(DokumentFehler)
  })

  it('räumt die Datei weg, wenn die Zeile nicht zustande kommt', async () => {
    const w = werkzeug()
    w.hilfen.inhalte.scheitereBeimLegen(new Error('Die Aufgabe war nicht anzulegen'))

    await expect(nimmDokumentAuf(w, datei())).rejects.toThrow(/nicht zu speichern/)

    expect(w.hilfen.ablage.objekte.size).toBe(0)
    expect(w.hilfen.ablage.entfernt).toHaveLength(1)
  })

  it('schreibt keine Zeile, wenn schon der Upload scheitert', async () => {
    const w = werkzeug()
    w.hilfen.ablage.scheitereBeimLaden(new Error('Das Dokument war nicht hochzuladen'))

    await expect(nimmDokumentAuf(w, datei())).rejects.toThrow(/nicht hochzuladen/)

    expect(w.hilfen.inhalte.gelegt).toHaveLength(0)
  })
})

describe('dokumenteAusZeilen', () => {
  async function zeileZu(payload: Dokumentpayload, id = 'dok-1'): Promise<InhaltZeile> {
    const dek = erzeugeDek()

    return {
      id,
      fallId: FALL.id,
      seq: 1,
      art: 'file',
      geloescht: false,
      imTresor: false,
      kid: FALL.kid,
      wrappedDek: await wrappeDek(FALL.kc, dek),
      payload: await verschluessele(dek, textBytes(JSON.stringify(payload))),
      geaendertAm: '2026-08-24T10:00:00Z',
    }
  }

  const PAYLOAD: Dokumentpayload = {
    typ: 'dokument',
    name: 'sterbeurkunde.jpg',
    mimetyp: 'image/jpeg',
    groesse: 4242,
    aufgabeId: 'item-7',
    aufgenommenAm: '2026-08-24T10:00:00Z',
  }

  it('leitet den Pfad aus Fall und Item her', async () => {
    const { dokumente } = await dokumenteAusZeilen([await zeileZu(PAYLOAD)], FALL)

    expect(dokumente[0]).toMatchObject({
      id: 'dok-1',
      name: 'sterbeurkunde.jpg',
      pfad: 'fall-1/dok-1',
      aufgabeId: 'item-7',
    })
  })

  it('übergeht Aufgaben und Tombstones, ohne sie als Defekt zu zählen', async () => {
    const dokument = await zeileZu(PAYLOAD)
    const aufgabe: InhaltZeile = { ...dokument, id: 'item-1', art: 'item' }
    const tombstone: InhaltZeile = {
      ...dokument,
      id: 'dok-2',
      geloescht: true,
      payload: new Uint8Array(),
      wrappedDek: new Uint8Array(),
    }

    const { dokumente, uebersprungeneIds } = await dokumenteAusZeilen(
      [aufgabe, dokument, tombstone],
      FALL,
    )

    expect(dokumente.map((eintrag) => eintrag.id)).toEqual(['dok-1'])
    expect(uebersprungeneIds).toEqual([])
  })

  it('verwirft still, was sich nicht entschlüsseln lässt (§3.7)', async () => {
    const fremd = await zeileZu(PAYLOAD, 'dok-fremd')
    const { dokumente, uebersprungeneIds } = await dokumenteAusZeilen([fremd], {
      ...FALL,
      kc: erzeugeDek(),
    })

    expect(dokumente).toEqual([])
    expect(uebersprungeneIds).toEqual(['dok-fremd'])
  })

  it('erträgt einen Payload, dem Felder fehlen', async () => {
    const luecke = { typ: 'dokument' } as unknown as Dokumentpayload
    const { dokumente } = await dokumenteAusZeilen([await zeileZu(luecke)], FALL)

    expect(dokumente[0]).toMatchObject({
      name: 'Dokument',
      mimetyp: 'application/octet-stream',
      groesse: 0,
      aufgabeId: null,
    })
  })
})

describe('oeffneDokument', () => {
  it('sagt es, wenn die Datei beschädigt ist', async () => {
    const w = werkzeug()
    const dokument = await nimmDokumentAuf(w, datei())

    w.hilfen.ablage.objekte.set(dokument.pfad, textBytes('kein Envelope'))

    await expect(oeffneDokument(dokument, w.ablage, w.krypto)).rejects.toThrow(/beschädigt/)
  })
})

describe('loescheDokument', () => {
  it('setzt den Tombstone und entfernt die Datei — in dieser Reihenfolge', async () => {
    const w = werkzeug()
    const dokument = await nimmDokumentAuf(w, datei())

    await loescheDokument(dokument, w.ablage, w.inhalte)

    expect(w.hilfen.inhalte.geloescht).toEqual([dokument.id])
    expect(w.hilfen.ablage.objekte.size).toBe(0)
  })

  it('lässt die Datei stehen, wenn schon der Tombstone scheitert', async () => {
    const w = werkzeug()
    const dokument = await nimmDokumentAuf(w, datei())
    w.hilfen.inhalte.scheitereBeimLoeschen(new Error('Die Aufgabe war nicht zu löschen'))

    await expect(loescheDokument(dokument, w.ablage, w.inhalte)).rejects.toThrow(
      /nicht zu löschen/,
    )

    expect(w.hilfen.ablage.objekte.has(dokument.pfad)).toBe(true)
  })

  it('nimmt „gelöscht" nicht zurück, wenn nur das Aufräumen scheitert', async () => {
    const w = werkzeug()
    const dokument = await nimmDokumentAuf(w, datei())
    w.hilfen.ablage.scheitereBeimEntfernen(new Error('Object not found'))

    // Kein Wurf: Der Tombstone steht, und das ist die endgültige Aussage (§5).
    // Was liegen bleibt, holt der Aufräumjob nach sieben Tagen (§7).
    await expect(loescheDokument(dokument, w.ablage, w.inhalte)).resolves.toBeUndefined()

    expect(w.hilfen.inhalte.geloescht).toEqual([dokument.id])
  })
})
