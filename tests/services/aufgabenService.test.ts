import { describe, expect, it } from 'vitest'
import { erzeugeAesSchluessel, verschluessele } from '../../src/core/crypto/aead'
import { bytesText, textBytes } from '../../src/core/crypto/bytes'
import { erzeugeDek, wrappeDek } from '../../src/core/crypto/dek'
import type { InhalteTabelle, InhaltZeile, NeuerInhalt } from '../../src/core/db/inhalte'
import {
  AufgabenFehler,
  ladeAufgaben,
  legeAufgabeAn,
  loescheAufgabe,
  schreibeAufgabe,
  type Fallschluessel,
} from '../../src/services/aufgabenService'

/**
 * Aufgaben anlegen, ändern, abhaken und löschen (DESIGN.md §3.1, §3.3, §5).
 *
 * Der Server steht hier als Speicher ohne Verstand — er nimmt an, was kommt,
 * und gibt zurück, was drinsteht, samt der einen Regel, die §4 von ihm
 * verlangt: `seq` vergibt er, nicht der Client.
 *
 * Geprüft wird die Kette, auf der der ganze Slice steht: Titel und
 * Beschreibung gehen ausschließlich verschlüsselt hinaus, jedes Item bekommt
 * einen eigenen DEK, und was sich nicht entschlüsseln lässt, verschwindet
 * still.
 */

function fall(): Fallschluessel {
  return { id: 'fall-1', kid: 'case_fall-1:1', kc: erzeugeAesSchluessel() }
}

/** Ein Server: eine Tabelle, ein Zähler, keine Meinung. */
function server() {
  const zeilen: InhaltZeile[] = []
  let version = 0

  function finde(id: string): InhaltZeile {
    const zeile = zeilen.find((kandidat) => kandidat.id === id)

    if (zeile === undefined) {
      throw new Error(`Kein Item ${id}.`)
    }

    return zeile
  }

  const inhalte: InhalteTabelle = {
    imFall(fallId) {
      // Sortiert über die `id`, so wie der Adapter es von Postgres verlangt:
      // `seq` steigt bei jedem Schreibvorgang und taugt nicht als Reihenfolge
      // für die Anzeige.
      return Promise.resolve(
        zeilen
          .filter((zeile) => zeile.fallId === fallId)
          .sort((a, b) => (a.id < b.id ? -1 : 1)),
      )
    },

    lege(neu: NeuerInhalt) {
      version += 1
      zeilen.push({
        ...neu,
        seq: version,
        geloescht: false,
        imTresor: false,
        geaendertAm: new Date(version).toISOString(),
      })
      return Promise.resolve()
    },

    schreibePayload(id, payload) {
      version += 1
      const zeile = finde(id)
      zeile.payload = payload
      zeile.seq = version
      return Promise.resolve()
    },

    loesche(id) {
      version += 1
      const zeile = finde(id)
      zeile.geloescht = true
      zeile.payload = new Uint8Array()
      zeile.wrappedDek = new Uint8Array()
      zeile.seq = version
      return Promise.resolve()
    },
  }

  return { inhalte, zeilen }
}

describe('legeAufgabeAn', () => {
  it('legt eine Aufgabe an, die sich danach wieder lesen lässt', async () => {
    const { inhalte } = server()
    const k = fall()

    await legeAufgabeAn(inhalte, k, 'Sterbeurkunde beantragen')

    const { aufgaben } = await ladeAufgaben(inhalte, k)

    expect(aufgaben).toHaveLength(1)
    expect(aufgaben[0]).toMatchObject({
      titel: 'Sterbeurkunde beantragen',
      beschreibung: '',
      erledigt: false,
    })
  })

  it('schreibt Titel und Beschreibung nirgends im Klartext', async () => {
    // Das Versprechen aus §3.3, und es lässt sich nur an den Bytes prüfen, die
    // wirklich hinausgehen.
    const { inhalte, zeilen } = server()
    const k = fall()

    await legeAufgabeAn(inhalte, k, 'Erbschein beantragen')
    await schreibeAufgabe(inhalte, (await ladeAufgaben(inhalte, k)).aufgaben[0]!, {
      titel: 'Erbschein beantragen',
      beschreibung: 'Beim Nachlassgericht in Freiburg',
    })

    const alleBytes = zeilen.flatMap((zeile) => [
      bytesText(new Uint8Array(zeile.payload.filter((byte) => byte >= 0x20 && byte < 0x7f))),
      zeile.kid,
      zeile.id,
    ])

    expect(alleBytes.join(' ')).not.toMatch(/Erbschein|Freiburg/)
  })

  it('gibt jedem Item einen eigenen DEK', async () => {
    // §3.1: DEKs liegen pro Item, damit eine Rotation nur 32 Byte je Zeile neu
    // wrappen muss. Zwei Items, die sich einen teilten, liessen sich nur noch
    // gemeinsam rotieren und gemeinsam freigeben.
    const { inhalte, zeilen } = server()
    const k = fall()

    await legeAufgabeAn(inhalte, k, 'Eins')
    await legeAufgabeAn(inhalte, k, 'Zwei')

    const { aufgaben } = await ladeAufgaben(inhalte, k)

    expect(Array.from(aufgaben[0]!.dek)).not.toEqual(Array.from(aufgaben[1]!.dek))
    expect(Array.from(zeilen[0]!.wrappedDek)).not.toEqual(Array.from(zeilen[1]!.wrappedDek))
  })

  it('wrappt den DEK unter dem aktuellen kid des Falls', async () => {
    const { inhalte, zeilen } = server()
    const k = fall()

    await legeAufgabeAn(inhalte, k, 'Eins')

    expect(zeilen[0]?.kid).toBe(k.kid)
    expect(zeilen[0]?.art).toBe('item')
  })

  it('vergibt clientseitige UUIDv7 als Item-ID', async () => {
    // §5: Item-IDs entstehen auf dem Gerät, damit Anlegen später offline
    // funktioniert.
    const { inhalte, zeilen } = server()
    const k = fall()

    await legeAufgabeAn(inhalte, k, 'Eins')

    expect(zeilen[0]?.id[14]).toBe('7')
  })

  it('weist einen leeren Titel zurueck', async () => {
    const { inhalte, zeilen } = server()

    await expect(legeAufgabeAn(inhalte, fall(), '   ')).rejects.toThrow(AufgabenFehler)
    expect(zeilen).toHaveLength(0)
  })
})

describe('schreibeAufgabe', () => {
  it('aendert den Titel, ohne den DEK anzufassen', async () => {
    // Der DEK aendert sich nie (§3.1). Ein Edit kostet deshalb genau eine
    // Spalte, und eine spaetere Rotation muss nur den DEK neu wrappen.
    const { inhalte, zeilen } = server()
    const k = fall()

    await legeAufgabeAn(inhalte, k, 'Alter Titel')
    const vorher = zeilen[0]!.wrappedDek

    const [aufgabe] = (await ladeAufgaben(inhalte, k)).aufgaben
    await schreibeAufgabe(inhalte, aufgabe!, { titel: 'Neuer Titel' })

    const { aufgaben } = await ladeAufgaben(inhalte, k)
    expect(aufgaben[0]?.titel).toBe('Neuer Titel')
    expect(zeilen[0]?.wrappedDek).toBe(vorher)
  })

  it('behaelt die Felder, die nicht mitgeschickt wurden', async () => {
    const { inhalte } = server()
    const k = fall()

    await legeAufgabeAn(inhalte, k, 'Titel')
    const [erst] = (await ladeAufgaben(inhalte, k)).aufgaben
    await schreibeAufgabe(inhalte, erst!, { beschreibung: 'Zwei Kopien' })

    const [dann] = (await ladeAufgaben(inhalte, k)).aufgaben
    await schreibeAufgabe(inhalte, dann!, { titel: 'Anderer Titel' })

    const { aufgaben } = await ladeAufgaben(inhalte, k)
    expect(aufgaben[0]).toMatchObject({
      titel: 'Anderer Titel',
      beschreibung: 'Zwei Kopien',
    })
  })

  it('weist einen leeren Titel zurueck', async () => {
    const { inhalte } = server()
    const k = fall()

    await legeAufgabeAn(inhalte, k, 'Titel')
    const [aufgabe] = (await ladeAufgaben(inhalte, k)).aufgaben

    await expect(schreibeAufgabe(inhalte, aufgabe!, { titel: '' })).rejects.toThrow(AufgabenFehler)
  })
})

describe('Abhaken', () => {
  it('merkt sich den Erledigt-Status ueber ein Neuladen hinweg', async () => {
    const { inhalte } = server()
    const k = fall()

    await legeAufgabeAn(inhalte, k, 'Konten kuendigen')
    const [aufgabe] = (await ladeAufgaben(inhalte, k)).aufgaben
    await schreibeAufgabe(inhalte, aufgabe!, { erledigt: true })

    expect((await ladeAufgaben(inhalte, k)).aufgaben[0]?.erledigt).toBe(true)
  })

  it('laesst sich wieder zuruecknehmen', async () => {
    const { inhalte } = server()
    const k = fall()

    await legeAufgabeAn(inhalte, k, 'Konten kuendigen')
    const [erst] = (await ladeAufgaben(inhalte, k)).aufgaben
    await schreibeAufgabe(inhalte, erst!, { erledigt: true })

    const [dann] = (await ladeAufgaben(inhalte, k)).aufgaben
    await schreibeAufgabe(inhalte, dann!, { erledigt: false })

    expect((await ladeAufgaben(inhalte, k)).aufgaben[0]?.erledigt).toBe(false)
  })
})

describe('loescheAufgabe', () => {
  it('nimmt sie aus der Liste, ohne die Zeile zu entfernen', async () => {
    // §5: Löschen ist ein Tombstone. Die Zeile bleibt stehen, damit die
    // Aufräumung über denselben Delta-Sync an die anderen Geräte kommt wie
    // jede andere Änderung.
    const { inhalte, zeilen } = server()
    const k = fall()

    await legeAufgabeAn(inhalte, k, 'Zeitung abbestellen')
    const [aufgabe] = (await ladeAufgaben(inhalte, k)).aufgaben
    await loescheAufgabe(inhalte, aufgabe!)

    expect((await ladeAufgaben(inhalte, k)).aufgaben).toEqual([])
    expect(zeilen).toHaveLength(1)
    expect(zeilen[0]?.geloescht).toBe(true)
  })

  it('zaehlt eine geloeschte Zeile nicht als uebersprungen', async () => {
    // Ein Tombstone ist leer und deshalb nicht entschluesselbar. Landete er im
    // Zaehler aus §3.7, zeigte der Dev-Modus nach jedem Loeschen eine Warnung
    // ueber einen Defekt, den es nicht gibt.
    const { inhalte } = server()
    const k = fall()

    await legeAufgabeAn(inhalte, k, 'Zeitung abbestellen')
    const [aufgabe] = (await ladeAufgaben(inhalte, k)).aufgaben
    await loescheAufgabe(inhalte, aufgabe!)

    expect((await ladeAufgaben(inhalte, k)).uebersprungen).toBe(0)
  })
})

describe('ladeAufgaben', () => {
  it('sortiert in Anlagereihenfolge, nicht nach Titel', async () => {
    const { inhalte } = server()
    const k = fall()

    await legeAufgabeAn(inhalte, k, 'Zuerst')
    await legeAufgabeAn(inhalte, k, 'Danach')

    const { aufgaben } = await ladeAufgaben(inhalte, k)
    expect(aufgaben.map((aufgabe) => aufgabe.titel)).toEqual(['Zuerst', 'Danach'])
  })

  it('laesst die Reihenfolge stehen, wenn eine Aufgabe geaendert wird', async () => {
    /*
     * Der Fehler, gegen den das steht: `seq` steigt bei jedem Schreibvorgang
     * (§4). Wer danach sortiert, schiebt die gerade abgehakte Aufgabe ans Ende
     * der Liste — bei zwanzig Aufgaben sucht man die erste anschliessend unten
     * wieder.
     */
    const { inhalte } = server()
    const k = fall()

    await legeAufgabeAn(inhalte, k, 'Zuerst')
    await legeAufgabeAn(inhalte, k, 'In der Mitte')
    await legeAufgabeAn(inhalte, k, 'Zuletzt')

    const [erste] = (await ladeAufgaben(inhalte, k)).aufgaben
    await schreibeAufgabe(inhalte, erste!, { erledigt: true })

    const { aufgaben } = await ladeAufgaben(inhalte, k)
    expect(aufgaben.map((aufgabe) => aufgabe.titel)).toEqual([
      'Zuerst',
      'In der Mitte',
      'Zuletzt',
    ])
  })

  it('verwirft ein Item, dessen DEK unter einem fremden Schluessel liegt', async () => {
    // Der Normalfall aus §3.7: ein privates Item einer anderen Person. Es wird
    // mitgeladen und still verworfen — rund 2 KB, und niemand erfaehrt davon.
    const { inhalte } = server()
    const k = fall()
    const fremd = erzeugeAesSchluessel()

    await legeAufgabeAn(inhalte, k, 'Meins')
    await inhalte.lege({
      id: 'fremdes-item',
      fallId: k.id,
      art: 'item',
      kid: 'privat-egal',
      wrappedDek: await wrappeDek(fremd, erzeugeDek()),
      payload: await verschluessele(fremd, textBytes('{}')),
    })

    const { aufgaben, uebersprungen } = await ladeAufgaben(inhalte, k)

    expect(aufgaben.map((aufgabe) => aufgabe.titel)).toEqual(['Meins'])
    expect(uebersprungen).toBe(1)
  })

  it('verwirft ein Item, dessen Payload kein Aufgabenpayload ist', async () => {
    // Ein echter Defekt sieht von aussen genauso aus wie ein fremdes Item —
    // §11 nennt das als bewusst hingenommene Grenze. Umso wichtiger, dass er
    // die Liste nicht mitreisst.
    const { inhalte } = server()
    const k = fall()
    const dek = erzeugeDek()

    await legeAufgabeAn(inhalte, k, 'Meins')
    await inhalte.lege({
      id: 'kaputtes-item',
      fallId: k.id,
      art: 'item',
      kid: k.kid,
      wrappedDek: await wrappeDek(k.kc, dek),
      payload: await verschluessele(dek, textBytes('kein JSON')),
    })

    const { aufgaben, uebersprungen } = await ladeAufgaben(inhalte, k)

    expect(aufgaben.map((aufgabe) => aufgabe.titel)).toEqual(['Meins'])
    expect(uebersprungen).toBe(1)
  })

  it('verwirft ein Item, dessen Payload kein Titel-Feld hat', async () => {
    const { inhalte } = server()
    const k = fall()
    const dek = erzeugeDek()

    await inhalte.lege({
      id: 'ohne-titel',
      fallId: k.id,
      art: 'item',
      kid: k.kid,
      wrappedDek: await wrappeDek(k.kc, dek),
      payload: await verschluessele(dek, textBytes(JSON.stringify({ typ: 'aufgabe' }))),
    })

    const { aufgaben, uebersprungen } = await ladeAufgaben(inhalte, k)

    expect(aufgaben).toEqual([])
    expect(uebersprungen).toBe(1)
  })

  it('laesst die Items eines fremden Falls aussen vor', async () => {
    const { inhalte } = server()
    const k = fall()

    await legeAufgabeAn(inhalte, k, 'Meins')
    await legeAufgabeAn(inhalte, { ...fall(), id: 'fall-2' }, 'Fremdes')

    const { aufgaben } = await ladeAufgaben(inhalte, k)
    expect(aufgaben.map((aufgabe) => aufgabe.titel)).toEqual(['Meins'])
  })

  it('reicht einen Fehler der Tabelle durch, statt ihn zu verschlucken', async () => {
    // Der Unterschied, auf den es ankommt: Ein Item, das *diese Person* nicht
    // lesen darf, verschwindet still. Ein Server, der gar nicht antwortet, darf
    // nicht als „keine Aufgaben" durchgehen.
    const inhalte: InhalteTabelle = {
      imFall: () => Promise.reject(new Error('Der Server war nicht erreichbar.')),
      lege: () => Promise.resolve(),
      schreibePayload: () => Promise.resolve(),
      loesche: () => Promise.resolve(),
    }

    await expect(ladeAufgaben(inhalte, fall())).rejects.toThrow('nicht erreichbar')
  })
})
