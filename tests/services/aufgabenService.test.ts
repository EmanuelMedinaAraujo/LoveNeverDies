import { describe, expect, it } from 'vitest'
import { erzeugeAesSchluessel, verschluessele } from '../../src/core/crypto/aead'
import { bytesText, textBytes } from '../../src/core/crypto/bytes'
import { erzeugeDek, wrappeDek } from '../../src/core/crypto/dek'
import type { InhalteTabelle, InhaltZeile, NeuerInhalt } from '../../src/core/db/inhalte'
import { arbeiteAb, type Mutation, type Warteschlange } from '../../src/core/sync/queue'
import {
  AufgabenFehler,
  aufgabenAusZeilen,
  beschreibeAbgelehnte,
  mutationAendern,
  mutationAnlegen,
  mutationLoeschen,
  type Aufgabe,
  type Fallschluessel,
} from '../../src/services/aufgabenService'
import { ALLE, NIEMAND, personen } from '../../src/services/zuweisung'

/**
 * Aufgaben anlegen, ändern, abhaken und löschen (DESIGN.md §3.1, §3.3, §5).
 *
 * Der Dienst schreibt seit dem Sync-Slice nirgends mehr hin: Er gibt eine
 * {@link Mutation} zurück, fertig verschlüsselt, und die Queue trägt sie
 * hinaus (§5). Der Server steht hier trotzdem — als Speicher ohne Verstand, der
 * annimmt, was kommt, und die eine Regel aus §4 befolgt: `seq` vergibt er,
 * nicht der Client. Nur so lässt sich die ganze Kette prüfen, von der Eingabe
 * bis zur wieder entschlüsselten Zeile.
 *
 * Geprüft wird, worauf der Slice steht: Titel und Beschreibung gehen
 * ausschließlich verschlüsselt hinaus, jedes Item bekommt einen eigenen DEK,
 * was sich nicht entschlüsseln lässt verschwindet still — und eine abgelehnte
 * Änderung kommt mit ihrem Klartext zurück.
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
    legeAlleNeuen: () => Promise.reject(new Error('nicht gebraucht')),
    umwrappe: () => Promise.reject(new Error('nicht gebraucht')),

    seit(fallId, wasserzeichen) {
      // Sortiert über die `id` statt über `seq`: Der Reconciler stellt die
      // Anzeigereihenfolge her, und hier steht sie gleich so da, damit die
      // Erwartungen in diesem Test die Anlagereihenfolge lesen können.
      return Promise.resolve(
        zeilen
          .filter((zeile) => zeile.fallId === fallId && zeile.seq > wasserzeichen)
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

/**
 * Eine Warteschlange im Speicher, die genau eine Mutation hält.
 *
 * Der Weg vom Dienst zum Server läuft über {@link arbeiteAb} — die Alternative
 * wäre, im Test von Hand `inhalte.lege` zu rufen und damit einen Schreibweg zu
 * prüfen, den es in der App nicht gibt.
 */
function warteschlangeMit(...mutationen: Mutation[]): Warteschlange {
  let offen = mutationen.map((mutation, stelle) => ({ schluessel: stelle, mutation }))

  return {
    haengeAn(mutation) {
      offen = [...offen, { schluessel: offen.length, mutation }]
      return Promise.resolve()
    },
    offen: () => Promise.resolve(offen),
    entferne(schluessel) {
      offen = offen.filter((eintrag) => eintrag.schluessel !== schluessel)
      return Promise.resolve()
    },
  }
}

/** Legt an, ändert oder löscht — über die Queue, so wie die App es tut. */
async function uebertrage(inhalte: InhalteTabelle, ...mutationen: Mutation[]): Promise<void> {
  const ergebnis = await arbeiteAb(warteschlangeMit(...mutationen), inhalte)

  if (ergebnis.abgelehnt.length > 0 || ergebnis.offen > 0) {
    throw new Error(`Nicht übertragen: ${JSON.stringify(ergebnis.abgelehnt)}`)
  }
}

/** Der Stand des Falls, entschlüsselt — der Weg aus §5 in voller Länge. */
async function lies(inhalte: InhalteTabelle, k: Fallschluessel) {
  return aufgabenAusZeilen(await inhalte.seit(k.id, 0), k)
}

/** Legt eine Aufgabe an und gibt sie entschlüsselt zurück. */
async function legeAn(inhalte: InhalteTabelle, k: Fallschluessel, titel: string): Promise<Aufgabe> {
  await uebertrage(inhalte, await mutationAnlegen(k, titel))

  const { aufgaben } = await lies(inhalte, k)
  return aufgaben[aufgaben.length - 1]!
}

describe('Unteraufgaben als eigene Zeilen (§7)', () => {
  it('legt eine Unteraufgabe unter ihrer Elternaufgabe an', async () => {
    const { inhalte } = server()
    const k = fall()

    const eltern = await legeAn(inhalte, k, 'Sterbefall anzeigen')
    await uebertrage(inhalte, await mutationAnlegen(k, 'Urkunden bestellen', eltern.id))

    const { aufgaben } = await lies(inhalte, k)
    const kind = aufgaben.find((aufgabe) => aufgabe.titel === 'Urkunden bestellen')

    expect(kind?.parentId).toBe(eltern.id)
    expect(kind?.id).not.toBe(eltern.id)
  })

  it('lässt zwei offline gesetzte Häkchen beide überleben', async () => {
    /*
     * Die Begründung aus §7, geprüft am ganzen Weg: „Läge alles im Payload der
     * Elternaufgabe, überlebte von zwei offline gesetzten Häkchen genau eines,
     * ohne dass jemand davon erführe."
     *
     * Hier haken zwei Geräte je eine andere Unteraufgabe ab, beide offline,
     * beide ohne den Stand des anderen zu kennen. Weil jede Unteraufgabe eine
     * eigene Zeile ist, schreiben sie in verschiedene Zeilen — es gibt nichts
     * zu überschreiben und nichts, was verloren gehen könnte.
     */
    const { inhalte } = server()
    const k = fall()

    const eltern = await legeAn(inhalte, k, 'Sterbefall anzeigen')
    await uebertrage(
      inhalte,
      await mutationAnlegen(k, 'Urkunden bestellen', eltern.id),
      await mutationAnlegen(k, 'Termin machen', eltern.id),
    )

    // Beide Geräte lesen denselben Stand und gehen dann offline.
    const standHandy = await lies(inhalte, k)
    const standLaptop = await lies(inhalte, k)

    const vomHandy = standHandy.aufgaben.find((a) => a.titel === 'Urkunden bestellen')
    const vomLaptop = standLaptop.aufgaben.find((a) => a.titel === 'Termin machen')

    if (vomHandy === undefined || vomLaptop === undefined) {
      throw new Error('Beide Unteraufgaben sollten dastehen.')
    }

    // Zurück im Netz, in beliebiger Reihenfolge.
    await uebertrage(inhalte, await mutationAendern(vomLaptop, { erledigt: true }))
    await uebertrage(inhalte, await mutationAendern(vomHandy, { erledigt: true }))

    const { aufgaben } = await lies(inhalte, k)
    const kinder = aufgaben.filter((aufgabe) => aufgabe.parentId === eltern.id)

    expect(kinder).toHaveLength(2)
    expect(kinder.every((kind) => kind.erledigt)).toBe(true)
  })

  it('lässt die Elternbeziehung eine Änderung überleben', async () => {
    // Fiele `parentId` beim ersten Häkchen aus dem Payload, sprängen die
    // Unteraufgaben reihenweise auf die Wurzelebene (§7).
    const { inhalte } = server()
    const k = fall()

    const eltern = await legeAn(inhalte, k, 'Sterbefall anzeigen')
    await uebertrage(inhalte, await mutationAnlegen(k, 'Urkunden bestellen', eltern.id))

    const vorher = (await lies(inhalte, k)).aufgaben.find((a) => a.parentId === eltern.id)

    if (vorher === undefined) {
      throw new Error('Die Unteraufgabe sollte dastehen.')
    }

    await uebertrage(inhalte, await mutationAendern(vorher, { erledigt: true }))

    const nachher = (await lies(inhalte, k)).aufgaben.find((a) => a.id === vorher.id)

    expect(nachher?.parentId).toBe(eltern.id)
    expect(nachher?.erledigt).toBe(true)
  })

  it('trägt Notizen und Abhängigkeiten verschlüsselt mit', async () => {
    const { inhalte, zeilen } = server()
    const k = fall()

    const zuerst = await legeAn(inhalte, k, 'Todesbescheinigung holen')
    const danach = await legeAn(inhalte, k, 'Sterbefall anzeigen')

    await uebertrage(
      inhalte,
      await mutationAendern(danach, {
        notizen: 'Standesamt Mitte, Zimmer 2',
        dependsOn: [zuerst.id],
      }),
    )

    const wieder = (await lies(inhalte, k)).aufgaben.find((a) => a.id === danach.id)

    expect(wieder?.notizen).toBe('Standesamt Mitte, Zimmer 2')
    expect(wieder?.dependsOn).toEqual([zuerst.id])

    // §3.3: Notizen und Abhängigkeiten gehen den Server nichts an.
    const alles = zeilen.flatMap((zeile) => [...zeile.payload]).join(',')
    expect(alles).not.toContain([...new TextEncoder().encode('Zimmer 2')].join(','))
  })
})

describe('mutationAnlegen', () => {
  it('legt eine Aufgabe an, die sich danach wieder lesen lässt', async () => {
    const { inhalte } = server()
    const k = fall()

    await uebertrage(inhalte, await mutationAnlegen(k, 'Sterbeurkunde beantragen'))

    const { aufgaben } = await lies(inhalte, k)

    expect(aufgaben).toHaveLength(1)
    expect(aufgaben[0]).toMatchObject({
      titel: 'Sterbeurkunde beantragen',
      beschreibung: '',
      erledigt: false,
    })
  })

  it('gibt eine Mutation zurück, ohne irgendwohin zu schreiben', async () => {
    // §5: Jede Mutation wird angehängt und beim Reconnect abgearbeitet. Ein
    // Dienst, der nebenher selbst schriebe, hätte einen zweiten Weg — mit
    // eigener Reihenfolge und der Frage, was gilt, wenn beide laufen.
    const { inhalte, zeilen } = server()

    const mutation = await mutationAnlegen(fall(), 'Sterbeurkunde beantragen')

    expect(mutation.op).toBe('anlegen')
    expect(zeilen).toHaveLength(0)
    expect(await inhalte.seit('fall-1', 0)).toEqual([])
  })

  it('schreibt Titel und Beschreibung nirgends im Klartext', async () => {
    // Das Versprechen aus §3.3, und es lässt sich nur an den Bytes prüfen, die
    // wirklich hinausgehen.
    const { inhalte, zeilen } = server()
    const k = fall()

    const aufgabe = await legeAn(inhalte, k, 'Erbschein beantragen')
    await uebertrage(
      inhalte,
      await mutationAendern(aufgabe, {
        titel: 'Erbschein beantragen',
        beschreibung: 'Beim Nachlassgericht in Freiburg',
      }),
    )

    const alleBytes = zeilen.flatMap((zeile) => [
      bytesText(new Uint8Array(zeile.payload.filter((byte) => byte >= 0x20 && byte < 0x7f))),
      zeile.kid,
      zeile.id,
    ])

    expect(alleBytes.join(' ')).not.toMatch(/Erbschein|Freiburg/)
  })

  it('trägt auch in der Queue nur Ciphertext', async () => {
    // Die Queue liegt in IndexedDB, neben dem Cache, und untersteht derselben
    // Zusage aus §5. Verschlüsselt wird deshalb vor dem Anhängen und nicht
    // beim Hinausgehen.
    const mutation = await mutationAnlegen(fall(), 'Sterbeurkunde beantragen')

    expect(JSON.stringify(mutation)).not.toMatch(/Sterbeurkunde/)
  })

  it('gibt jedem Item einen eigenen DEK', async () => {
    // §3.1: DEKs liegen pro Item, damit eine Rotation nur 32 Byte je Zeile neu
    // wrappen muss. Zwei Items, die sich einen teilten, liessen sich nur noch
    // gemeinsam rotieren und gemeinsam freigeben.
    const { inhalte, zeilen } = server()
    const k = fall()

    await legeAn(inhalte, k, 'Eins')
    await legeAn(inhalte, k, 'Zwei')

    const { aufgaben } = await lies(inhalte, k)

    expect(Array.from(aufgaben[0]!.dek)).not.toEqual(Array.from(aufgaben[1]!.dek))
    expect(Array.from(zeilen[0]!.wrappedDek)).not.toEqual(Array.from(zeilen[1]!.wrappedDek))
  })

  it('wrappt den DEK unter dem aktuellen kid des Falls', async () => {
    const { inhalte, zeilen } = server()
    const k = fall()

    await legeAn(inhalte, k, 'Eins')

    expect(zeilen[0]?.kid).toBe(k.kid)
    expect(zeilen[0]?.art).toBe('item')
  })

  it('vergibt clientseitige UUIDv7 als Item-ID', async () => {
    // §5: Item-IDs entstehen auf dem Gerät, damit Anlegen offline funktioniert
    // und die Queue eine Aufgabe benennen kann, die der Server nie gesehen hat.
    const mutation = await mutationAnlegen(fall(), 'Eins')

    expect(mutation.itemId[14]).toBe('7')
  })

  it('weist einen leeren Titel zurueck', async () => {
    await expect(mutationAnlegen(fall(), '   ')).rejects.toThrow(AufgabenFehler)
  })
})

describe('mutationAendern', () => {
  it('aendert den Titel, ohne den DEK anzufassen', async () => {
    // Der DEK aendert sich nie (§3.1). Ein Edit kostet deshalb genau eine
    // Spalte, und eine spaetere Rotation muss nur den DEK neu wrappen.
    const { inhalte, zeilen } = server()
    const k = fall()

    const aufgabe = await legeAn(inhalte, k, 'Alter Titel')
    const vorher = zeilen[0]!.wrappedDek

    await uebertrage(inhalte, await mutationAendern(aufgabe, { titel: 'Neuer Titel' }))

    const { aufgaben } = await lies(inhalte, k)
    expect(aufgaben[0]?.titel).toBe('Neuer Titel')
    expect(zeilen[0]?.wrappedDek).toBe(vorher)
  })

  it('behaelt die Felder, die nicht mitgeschickt wurden', async () => {
    const { inhalte } = server()
    const k = fall()

    const erst = await legeAn(inhalte, k, 'Titel')
    await uebertrage(inhalte, await mutationAendern(erst, { beschreibung: 'Zwei Kopien' }))

    const [dann] = (await lies(inhalte, k)).aufgaben
    await uebertrage(inhalte, await mutationAendern(dann!, { titel: 'Anderer Titel' }))

    expect((await lies(inhalte, k)).aufgaben[0]).toMatchObject({
      titel: 'Anderer Titel',
      beschreibung: 'Zwei Kopien',
    })
  })

  it('weist einen leeren Titel zurueck', async () => {
    const { inhalte } = server()
    const k = fall()

    const aufgabe = await legeAn(inhalte, k, 'Titel')

    await expect(mutationAendern(aufgabe, { titel: '' })).rejects.toThrow(AufgabenFehler)
  })
})

describe('Abhaken', () => {
  it('merkt sich den Erledigt-Status ueber ein Neuladen hinweg', async () => {
    const { inhalte } = server()
    const k = fall()

    const aufgabe = await legeAn(inhalte, k, 'Konten kuendigen')
    await uebertrage(inhalte, await mutationAendern(aufgabe, { erledigt: true }))

    expect((await lies(inhalte, k)).aufgaben[0]?.erledigt).toBe(true)
  })

  it('laesst sich wieder zuruecknehmen', async () => {
    const { inhalte } = server()
    const k = fall()

    const erst = await legeAn(inhalte, k, 'Konten kuendigen')
    await uebertrage(inhalte, await mutationAendern(erst, { erledigt: true }))

    const [dann] = (await lies(inhalte, k)).aufgaben
    await uebertrage(inhalte, await mutationAendern(dann!, { erledigt: false }))

    expect((await lies(inhalte, k)).aufgaben[0]?.erledigt).toBe(false)
  })
})

describe('mutationLoeschen', () => {
  it('nimmt sie aus der Liste, ohne die Zeile zu entfernen', async () => {
    // §5: Löschen ist ein Tombstone. Die Zeile bleibt stehen, damit die
    // Aufräumung über denselben Delta-Sync an die anderen Geräte kommt wie
    // jede andere Änderung.
    const { inhalte, zeilen } = server()
    const k = fall()

    const aufgabe = await legeAn(inhalte, k, 'Zeitung abbestellen')
    await uebertrage(inhalte, mutationLoeschen(aufgabe))

    expect((await lies(inhalte, k)).aufgaben).toEqual([])
    expect(zeilen).toHaveLength(1)
    expect(zeilen[0]?.geloescht).toBe(true)
  })

  it('zaehlt eine geloeschte Zeile nicht als uebersprungen', async () => {
    // Ein Tombstone ist leer und deshalb nicht entschluesselbar. Landete er im
    // Zaehler aus §3.7, zeigte der Dev-Modus nach jedem Loeschen eine Warnung
    // ueber einen Defekt, den es nicht gibt.
    const { inhalte } = server()
    const k = fall()

    const aufgabe = await legeAn(inhalte, k, 'Zeitung abbestellen')
    await uebertrage(inhalte, mutationLoeschen(aufgabe))

    expect((await lies(inhalte, k)).uebersprungeneIds).toEqual([])
  })
})

describe('aufgabenAusZeilen', () => {
  it('sortiert in Anlagereihenfolge, nicht nach Titel', async () => {
    const { inhalte } = server()
    const k = fall()

    await legeAn(inhalte, k, 'Zuerst')
    await legeAn(inhalte, k, 'Danach')

    const { aufgaben } = await lies(inhalte, k)
    expect(aufgaben.map((aufgabe) => aufgabe.titel)).toEqual(['Zuerst', 'Danach'])
  })

  it('verwirft ein Item, dessen DEK unter einem fremden Schluessel liegt', async () => {
    // Der Normalfall aus §3.7: ein privates Item einer anderen Person. Es wird
    // mitgeladen und still verworfen — rund 2 KB, und niemand erfaehrt davon.
    const { inhalte } = server()
    const k = fall()
    const fremd = erzeugeAesSchluessel()

    await legeAn(inhalte, k, 'Meins')
    await inhalte.lege({
      id: 'fremdes-item',
      fallId: k.id,
      art: 'item',
      kid: 'privat-egal',
      wrappedDek: await wrappeDek(fremd, erzeugeDek()),
      payload: await verschluessele(fremd, textBytes('{}')),
    })

    const { aufgaben, uebersprungeneIds } = await lies(inhalte, k)

    expect(aufgaben.map((aufgabe) => aufgabe.titel)).toEqual(['Meins'])
    expect(uebersprungeneIds).toEqual(['fremdes-item'])
  })

  it('verwirft ein Item, dessen Payload kein Aufgabenpayload ist', async () => {
    // Ein echter Defekt sieht von aussen genauso aus wie ein fremdes Item —
    // §11 nennt das als bewusst hingenommene Grenze. Umso wichtiger, dass er
    // die Liste nicht mitreisst.
    const { inhalte } = server()
    const k = fall()
    const dek = erzeugeDek()

    await legeAn(inhalte, k, 'Meins')
    await inhalte.lege({
      id: 'kaputtes-item',
      fallId: k.id,
      art: 'item',
      kid: k.kid,
      wrappedDek: await wrappeDek(k.kc, dek),
      payload: await verschluessele(dek, textBytes('kein JSON')),
    })

    const { aufgaben, uebersprungeneIds } = await lies(inhalte, k)

    expect(aufgaben.map((aufgabe) => aufgabe.titel)).toEqual(['Meins'])
    expect(uebersprungeneIds).toEqual(['kaputtes-item'])
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

    const { aufgaben, uebersprungeneIds } = await lies(inhalte, k)

    expect(aufgaben).toEqual([])
    expect(uebersprungeneIds).toEqual(['ohne-titel'])
  })

  it('geht an Tresor-Inhalten vorbei, statt sie als Defekt zu zählen', async () => {
    /*
     * Ein Tresor-Eintrag trägt `art: 'item'` wie eine Aufgabe, sein DEK liegt
     * aber unter `K_v` (§3.5). Ohne die Weiche hier scheiterte jeder Versuch
     * und der eigene Tresor stünde als "übersprungene Einträge" im Dev-Modus.
     */
    const { inhalte } = server()
    const k = fall()
    const kv = erzeugeAesSchluessel()

    await legeAn(inhalte, k, 'Eine Aufgabe')

    const [zeile] = await inhalte.seit(k.id, 0)

    if (zeile === undefined) {
      throw new Error('Die angelegte Zeile fehlt.')
    }

    const dek = erzeugeDek()
    const tresorZeile = {
      ...zeile,
      id: 'tresor-item',
      seq: zeile.seq + 1,
      kid: `vault_${k.id}`,
      imTresor: true,
      wrappedDek: await wrappeDek(kv, dek),
      payload: await verschluessele(dek, textBytes('{"typ":"tresor","titel":"Geheim"}')),
    }

    const { aufgaben, uebersprungeneIds } = await aufgabenAusZeilen([zeile, tresorZeile], k)

    expect(aufgaben.map((aufgabe) => aufgabe.titel)).toEqual(['Eine Aufgabe'])
    expect(uebersprungeneIds).toEqual([])
  })

  it('entschlüsselt ohne Netz, weil ihm keine Tabelle übergeben wird', async () => {
    /*
     * §5: „Gecachte Inhalte werden sofort gerendert." Das trägt nur, wenn das
     * Entschlüsseln nichts vom Server braucht — deshalb bekommt diese Funktion
     * Zeilen und keinen Zugang. Woher die Zeilen kommen, Cache oder Delta, ist
     * ihr gleich.
     */
    const { inhalte } = server()
    const k = fall()

    await legeAn(inhalte, k, 'Aus dem Cache')
    const ausDemCache = await inhalte.seit(k.id, 0)

    expect((await aufgabenAusZeilen(ausDemCache, k)).aufgaben[0]?.titel).toBe('Aus dem Cache')
  })
})

describe('beschreibeAbgelehnte', () => {
  /*
   * §5: „Abgelehnte Mutationen werden nie stillschweigend verworfen, sondern
   * mit ihrem **entschlüsselten** Inhalt als Mitteilung angezeigt." Ohne den
   * Inhalt wäre die Mitteilung eine Zumutung — „eine Änderung konnte nicht
   * gespeichert werden" sagt niemandem, was er noch einmal tippen muss.
   */

  it('nennt den Titel einer abgelehnten Anlage', async () => {
    const k = fall()
    const mutation = await mutationAnlegen(k, 'Sterbeurkunde beantragen')

    const [beschrieben] = await beschreibeAbgelehnte(
      [{ mutation, grund: 'permission denied' }],
      [],
      k,
    )

    expect(beschrieben).toEqual({
      itemId: mutation.itemId,
      was: 'anlegen',
      titel: 'Sterbeurkunde beantragen',
      grund: 'permission denied',
    })
  })

  it('nennt den neuen Titel einer abgelehnten Änderung', async () => {
    // Der neue und nicht der alte: Wer den Titel geändert hat und ihn wieder
    // eintippen soll, braucht das, was er getippt hat.
    const { inhalte } = server()
    const k = fall()

    const aufgabe = await legeAn(inhalte, k, 'Alter Titel')
    const mutation = await mutationAendern(aufgabe, { titel: 'Neuer Titel' })

    const [beschrieben] = await beschreibeAbgelehnte(
      [{ mutation, grund: 'abgelehnt' }],
      await inhalte.seit(k.id, 0),
      k,
    )

    expect(beschrieben?.titel).toBe('Neuer Titel')
    expect(beschrieben?.was).toBe('aendern')
  })

  it('nennt den Titel eines abgelehnten Löschens', async () => {
    const { inhalte } = server()
    const k = fall()

    const aufgabe = await legeAn(inhalte, k, 'Zeitung abbestellen')

    const [beschrieben] = await beschreibeAbgelehnte(
      [{ mutation: mutationLoeschen(aufgabe), grund: 'abgelehnt' }],
      await inhalte.seit(k.id, 0),
      k,
    )

    expect(beschrieben?.titel).toBe('Zeitung abbestellen')
    expect(beschrieben?.was).toBe('loeschen')
  })

  it('lässt den Titel leer, wenn die Zeile nicht mehr da ist', async () => {
    // Ein Edit auf ein Item, das ein anderes Gerät inzwischen gelöscht hat: Der
    // Server lehnt ab, und der DEK ist mit dem Tombstone weg (§5). Die
    // Mitteilung bleibt trotzdem stehen — ohne Titel, aber nicht verschwiegen.
    const k = fall()
    const mutation: Mutation = {
      op: 'aendern',
      itemId: 'weg',
      payload: new Uint8Array([1, 2, 3]),
      ts: 0,
    }

    const [beschrieben] = await beschreibeAbgelehnte(
      [{ mutation, grund: 'Sie gehört zu keinem Ihrer Fälle oder ist nicht mehr da.' }],
      [],
      k,
    )

    expect(beschrieben?.titel).toBe('')
    expect(beschrieben?.grund).toMatch(/nicht mehr da/)
  })
})

describe('Zuweisung (§7)', () => {
  const ANNA = { userId: 'user_anna', name: 'Anna Müller' }
  const BERT = { userId: 'user_bert', name: 'Bert Müller' }

  it('legt eine Aufgabe ohne Angabe unzugewiesen an', async () => {
    const { inhalte } = server()
    const k = fall()

    const aufgabe = await legeAn(inhalte, k, 'Sterbeurkunde beantragen')

    expect(aufgabe.assignee).toEqual(NIEMAND)
  })

  it('trägt die anlegende Person gleich ein', async () => {
    const { inhalte } = server()
    const k = fall()

    await uebertrage(inhalte, await mutationAnlegen(k, 'Konto kündigen', null, ANNA))

    const { aufgaben } = await lies(inhalte, k)

    expect(aufgaben[0]?.assignee).toEqual(personen([ANNA]))
  })

  it('weist einer zweiten Person zu, ohne die erste zu verdrängen', async () => {
    const { inhalte } = server()
    const k = fall()

    const aufgabe = await legeAn(inhalte, k, 'Sterbeurkunde beantragen')
    await uebertrage(inhalte, await mutationAendern(aufgabe, { assignee: personen([ANNA, BERT]) }))

    const { aufgaben } = await lies(inhalte, k)

    expect(aufgaben[0]?.assignee).toEqual(personen([ANNA, BERT]))
  })

  it('trägt "Alle" als eigenen Wert ein und nicht als Liste aller Namen', async () => {
    const { inhalte } = server()
    const k = fall()

    const aufgabe = await legeAn(inhalte, k, 'Sterbeurkunde beantragen')
    await uebertrage(inhalte, await mutationAendern(aufgabe, { assignee: ALLE }))

    const { aufgaben } = await lies(inhalte, k)

    expect(aufgaben[0]?.assignee).toEqual(ALLE)
  })

  it('lässt die Zuweisung stehen, wenn jemand nur ein Häkchen setzt', async () => {
    const { inhalte } = server()
    const k = fall()

    const aufgabe = await legeAn(inhalte, k, 'Sterbeurkunde beantragen')
    await uebertrage(inhalte, await mutationAendern(aufgabe, { assignee: personen([BERT]) }))

    const [mitZuweisung] = (await lies(inhalte, k)).aufgaben
    await uebertrage(inhalte, await mutationAendern(mitZuweisung!, { erledigt: true }))

    const { aufgaben } = await lies(inhalte, k)

    expect(aufgaben[0]?.assignee).toEqual(personen([BERT]))
    expect(aufgaben[0]?.erledigt).toBe(true)
  })

  it('gibt eine Reservierung wieder frei', async () => {
    const { inhalte } = server()
    const k = fall()

    const aufgabe = await legeAn(inhalte, k, 'Sterbeurkunde beantragen')
    await uebertrage(inhalte, await mutationAendern(aufgabe, { assignee: NIEMAND }))

    const { aufgaben } = await lies(inhalte, k)

    expect(aufgaben[0]?.assignee).toEqual(NIEMAND)
  })

  it('schickt die Zuweisung ausschließlich verschlüsselt hinaus (§3.3)', async () => {
    const { inhalte, zeilen } = server()
    const k = fall()

    await uebertrage(inhalte, await mutationAnlegen(k, 'Konto kündigen', null, ANNA))

    const alles = zeilen.flatMap((zeile) => [...zeile.payload]).join(',')
    const bytes = (text: string) => [...new TextEncoder().encode(text)].join(',')

    expect(alles).not.toContain(bytes(ANNA.userId))
    expect(alles).not.toContain(bytes(ANNA.name))
  })

  it('liest eine Aufgabe von vor diesem Slice als unzugewiesen', async () => {
    const { inhalte } = server()
    const k = fall()

    const dek = erzeugeDek()

    await inhalte.lege({
      id: 'item-alt',
      fallId: k.id,
      art: 'item',
      kid: k.kid,
      wrappedDek: await wrappeDek(k.kc, dek),
      payload: await verschluessele(
        dek,
        textBytes(JSON.stringify({ typ: 'aufgabe', titel: 'Alte Aufgabe' })),
      ),
    })

    const { aufgaben } = await lies(inhalte, k)

    expect(aufgaben[0]?.assignee).toEqual(NIEMAND)
  })
})
