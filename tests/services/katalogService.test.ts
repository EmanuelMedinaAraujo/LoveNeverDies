import { describe, expect, it } from 'vitest'
import { katalog as ausgelieferterKatalog } from '../../src/content/katalog'
import { erzeugeAesSchluessel } from '../../src/core/crypto/aead'
import type { InhalteTabelle, InhaltZeile, NeuerInhalt } from '../../src/core/db/inhalte'
import {
  aufgabenAusZeilen,
  mutationAendern,
  mutationLoeschen,
  type Aufgabe,
} from '../../src/services/aufgabenService'
import {
  KatalogFehler,
  fehlendeKatalogitems,
  instanziiereKatalog,
  type Katalogfall,
} from '../../src/services/katalogService'
import type { Katalog } from '../../src/types/katalog'

/**
 * Den Rechtskatalog instanziieren (DESIGN.md §8).
 *
 * Die Zusagen, um die es geht:
 *
 *   1. Ein Trauerfall enthält direkt nach der Anlage die Aufgaben der
 *      Juristinnen, verschlüsselt wie jedes andere Item.
 *   2. Zwei gleichzeitige Instanziierungen erzeugen identische IDs und keine
 *      Duplikate, auch dann, wenn die beiden Clients auf verschiedenen
 *      `K_c`-Generationen stehen.
 *   3. Rechtsgrundlage, Quelle und zuständige Stelle stehen im Item selbst und
 *      ändern sich nicht mehr, wenn der Katalog neu importiert wird.
 *   4. Danach ist es ein gewöhnliches Item: änderbar und löschbar.
 */

const FALL_ID = '11111111-2222-4333-8444-555555555555'

const KATALOG: Katalog = {
  sprache: 'de',
  stand: '2026-08',
  version: '2026-08+testtest',
  aufgaben: [
    {
      id: 'sterbefall-anzeigen',
      titel: 'Sterbefall beim Standesamt anzeigen',
      kurzbeschreibung: 'Das Standesamt beurkundet den Sterbefall.',
      fristTage: 3,
      fristAb: 'sterbedatum',
      zustaendigeStelle: 'Standesamt des Sterbeortes',
      benoetigteDokumente: ['Todesbescheinigung'],
      unteraufgaben: ['Sterbeurkunden bestellen'],
      haengtAbVon: [],
      hinweis: 'Werktage, keine Kalendertage.',
      kategorie: 'Sofort',
      reihenfolge: 10,
    },
    {
      id: 'erbausschlagung-pruefen',
      titel: 'Ausschlagung der Erbschaft prüfen',
      kurzbeschreibung: 'Wer erbt, haftet auch für die Schulden.',
      fristTage: 42,
      fristAb: 'kenntnis',
      zustaendigeStelle: 'Nachlassgericht',
      benoetigteDokumente: ['Sterbeurkunde'],
      unteraufgaben: [],
      haengtAbVon: ['sterbefall-anzeigen'],
      hinweis: 'Diese Frist läuft ab Ihrer Kenntnis.',
      kategorie: 'Erbe',
      reihenfolge: 20,
    },
  ],
}

/** `K_cat` ist derselbe für alle Mitglieder eines Falls und rotiert nie (§8). */
const KCAT = erzeugeAesSchluessel()

/**
 * Ein Mitglied: eigener Blick auf denselben Fall.
 *
 * `kid` und `kc` unterscheiden sich zwischen zwei Mitgliedern, sobald `K_c`
 * rotiert hat (§3.4), `kcat` nie. Genau das ist die Konstruktion, die geprüft
 * wird.
 */
function mitglied(generation: number, kcat = KCAT): Katalogfall {
  return {
    id: FALL_ID,
    kid: `case_${FALL_ID}:${generation}`,
    kc: erzeugeAesSchluessel(),
    kcat,
    katalogVersion: KATALOG.version,
  }
}

/** `items` mit dem `on conflict do nothing` aus §8 und einem Zähler. */
function itemtabelle() {
  const zeilen: InhaltZeile[] = []
  let versuche = 0

  const inhalte: InhalteTabelle = {
    seit: () => Promise.resolve(zeilen),
    lege: () => Promise.reject(new Error('nicht gebraucht')),
    umwrappe: () => Promise.reject(new Error('nicht gebraucht')),
    rotiereItem: () => Promise.reject(new Error('nicht gebraucht')),
    schreibePayload: () => Promise.reject(new Error('nicht gebraucht')),
    loesche: () => Promise.reject(new Error('nicht gebraucht')),

    legeAlleNeuen: (neue: NeuerInhalt[]) => {
      versuche += neue.length

      for (const neu of neue) {
        if (!zeilen.some((zeile) => zeile.id === neu.id)) {
          zeilen.push({
            ...neu,
            seq: zeilen.length + 1,
            geloescht: false,
            imTresor: false,
            geaendertAm: '2026-08-24T10:00:00Z',
          })
        }
      }

      return Promise.resolve()
    },
  }

  return { inhalte, zeilen, versuche: () => versuche }
}

async function aufgabenVon(zeilen: InhaltZeile[], fall: Katalogfall): Promise<Aufgabe[]> {
  return (await aufgabenAusZeilen(zeilen, fall)).aufgaben
}

describe('instanziiereKatalog (§8)', () => {
  it('legt zu jeder Katalogaufgabe ein verschlüsseltes Item an', async () => {
    const anna = mitglied(1)
    const { inhalte, zeilen } = itemtabelle()

    // Drei Zeilen aus zwei Katalogaufgaben: Die Unteraufgabe ist eine eigene
    // Zeile mit eigener UUID (§7) und keine Liste im Payload der Elternaufgabe.
    expect(await instanziiereKatalog(inhalte, anna, [], KATALOG)).toBe(3)
    expect(zeilen).toHaveLength(3)

    const aufgaben = await aufgabenVon(zeilen, anna)

    expect(aufgaben.map((aufgabe) => aufgabe.titel)).toEqual([
      'Sterbefall beim Standesamt anzeigen',
      'Sterbeurkunden bestellen',
      'Ausschlagung der Erbschaft prüfen',
    ])
    expect(aufgaben.every((aufgabe) => !aufgabe.erledigt)).toBe(true)
  })

  it('schreibt nichts im Klartext hinaus — auch nicht die Katalogkennung', async () => {
    const anna = mitglied(1)
    const { inhalte, zeilen } = itemtabelle()

    await instanziiereKatalog(inhalte, anna, [], KATALOG)

    const alles = zeilen.flatMap((zeile) => [...zeile.payload, ...zeile.wrappedDek]).join(',')

    for (const wort of ['§ 1944 BGB', 'erbausschlagung-pruefen', 'Ausschlagung']) {
      expect(alles).not.toContain([...new TextEncoder().encode(wort)].join(','))
    }
  })

  it('kopiert Rechtsgrundlage, Quelle, zuständige Stelle und Frist in das Item', async () => {
    const anna = mitglied(1)
    const { inhalte, zeilen } = itemtabelle()

    await instanziiereKatalog(inhalte, anna, [], KATALOG)

    const ausschlagung = (await aufgabenVon(zeilen, anna)).find(
      (aufgabe) => aufgabe.katalog?.aufgabeId === 'erbausschlagung-pruefen',
    )

    expect(ausschlagung?.katalog).toEqual({
      aufgabeId: 'erbausschlagung-pruefen',
      version: '2026-08+testtest',
      fristTage: 42,
      fristAb: 'kenntnis',
      zustaendigeStelle: 'Nachlassgericht',
      benoetigteDokumente: ['Sterbeurkunde'],
      unteraufgaben: [],
      haengtAbVon: ['sterbefall-anzeigen'],
      hinweis: 'Diese Frist läuft ab Ihrer Kenntnis.',
      kategorie: 'Erbe',
      reihenfolge: 20,
    })
  })

  it('rechnet auf zwei K_c-Generationen dieselben IDs aus und legt nichts doppelt an', async () => {
    /*
     * Der Fall aus §8: Zwei Mitglieder instanziieren gleichzeitig, eines davon
     * jenseits einer Rotationsgrenze. Hinge die ID an `K_c`, liefe das
     * `on conflict` ins Leere und der Katalog stünde doppelt da.
     */
    const anna = mitglied(1)
    const bernd = mitglied(7)

    const { inhalte, zeilen, versuche } = itemtabelle()

    const [vonAnna, vonBernd] = await Promise.all([
      fehlendeKatalogitems(anna, [], KATALOG),
      fehlendeKatalogitems(bernd, [], KATALOG),
    ])

    expect(vonAnna.map((zeile) => zeile.id)).toEqual(vonBernd.map((zeile) => zeile.id))

    await inhalte.legeAlleNeuen(vonAnna)
    await inhalte.legeAlleNeuen(vonBernd)

    expect(versuche()).toBe(6)
    expect(zeilen).toHaveLength(3)
    expect(new Set(zeilen.map((zeile) => zeile.id)).size).toBe(3)
  })

  it('trennt zwei Fälle: derselbe Katalog, andere IDs', async () => {
    const anna = mitglied(1)
    const andererFall: Katalogfall = { ...anna, id: '99999999-2222-4333-8444-555555555555' }

    const hier = await fehlendeKatalogitems(anna, [], KATALOG)
    const dort = await fehlendeKatalogitems(andererFall, [], KATALOG)

    expect(dort.map((zeile) => zeile.id)).not.toEqual(hier.map((zeile) => zeile.id))
  })

  it('legt nichts noch einmal an, was schon dasteht', async () => {
    const anna = mitglied(1)
    const { inhalte, zeilen, versuche } = itemtabelle()

    await instanziiereKatalog(inhalte, anna, [], KATALOG)
    const zweiteRunde = await instanziiereKatalog(
      inhalte,
      anna,
      zeilen.map((zeile) => zeile.id),
      KATALOG,
    )

    expect(zweiteRunde).toBe(0)
    expect(versuche()).toBe(3)
    expect(zeilen).toHaveLength(3)
  })

  it('belebt eine gelöschte Katalogaufgabe nicht wieder', async () => {
    // Der Tombstone steht im Bestand (§5). Wer ihn als "fehlt" läse, legte die
    // Aufgabe beim nächsten Start erneut an.
    const anna = mitglied(1)
    const { inhalte, zeilen } = itemtabelle()

    await instanziiereKatalog(inhalte, anna, [], KATALOG)

    const geloescht = zeilen[0]
    if (geloescht === undefined) {
      throw new Error('Es sollte instanziiert worden sein.')
    }

    geloescht.geloescht = true
    geloescht.payload = new Uint8Array()
    geloescht.wrappedDek = new Uint8Array()

    const nachgelegt = await instanziiereKatalog(
      inhalte,
      anna,
      zeilen.map((zeile) => zeile.id),
      KATALOG,
    )

    expect(nachgelegt).toBe(0)
    expect(zeilen).toHaveLength(3)
  })

  it('lässt eine instanziierte Aufgabe ändern und löschen wie jede andere', async () => {
    const anna = mitglied(1)
    const { inhalte, zeilen } = itemtabelle()

    await instanziiereKatalog(inhalte, anna, [], KATALOG)

    const [aufgabe] = await aufgabenVon(zeilen, anna)
    if (aufgabe === undefined) {
      throw new Error('Es sollte instanziiert worden sein.')
    }

    const geaendert = await mutationAendern(aufgabe, { titel: 'Standesamt Mitte', erledigt: true })
    const geloescht = mutationLoeschen(aufgabe)

    expect(geaendert.op).toBe('aendern')
    expect(geloescht).toMatchObject({ op: 'loeschen', itemId: aufgabe.id })

    if (geaendert.op !== 'aendern') {
      throw new Error('Eine Änderung sollte es sein.')
    }

    // Die Herkunft überlebt die Änderung: Rechtsgrundlage und Quelle fielen
    // sonst beim ersten Häkchen aus dem Payload (§8).
    const [wiedergelesen] = await aufgabenVon(
      [{ ...(zeilen[0] as InhaltZeile), payload: geaendert.payload }],
      anna,
    )

    expect(wiedergelesen).toMatchObject({ titel: 'Standesamt Mitte', erledigt: true })
    expect(wiedergelesen?.katalog?.zustaendigeStelle).toBe('Standesamt des Sterbeortes')
  })

  it('lässt ein späterer Import die bereits instanziierte Aufgabe unberührt', async () => {
    const anna = mitglied(1)
    const { inhalte, zeilen } = itemtabelle()

    await instanziiereKatalog(inhalte, anna, [], KATALOG)

    // Der Katalog zieht nach: neue Version.
    const spaeter: Katalog = {
      ...KATALOG,
      version: '2031-03+spaeter',
      aufgaben: KATALOG.aufgaben.map((aufgabe) => ({
        ...aufgabe,
      })),
    }

    await expect(
      instanziiereKatalog(inhalte, anna, zeilen.map((zeile) => zeile.id), spaeter),
    ).rejects.toThrow(KatalogFehler)

    const [aufgabe] = await aufgabenVon(zeilen, anna)
    expect(aufgabe?.katalog?.zustaendigeStelle).toBe('Standesamt des Sterbeortes')
    expect(aufgabe?.katalog?.version).toBe('2026-08+testtest')
  })

  it('instanziiert nichts in einem Fall ohne eingefrorenen Katalogstand', async () => {
    // §8: Eingefroren wird beim Übergang nach `trauerfall`. Ein Vorsorgefall
    // hat keine Aufgaben, und ein 2026 angelegter instanziierte sonst 2031 das
    // Recht von 2026.
    const vorsorge: Katalogfall = { ...mitglied(1), katalogVersion: null }

    await expect(fehlendeKatalogitems(vorsorge, [], KATALOG)).rejects.toThrow(KatalogFehler)
  })

  it('nimmt ohne Angabe den ausgelieferten Katalog', async () => {
    const anna: Katalogfall = { ...mitglied(1), katalogVersion: ausgelieferterKatalog().version }
    const { inhalte, zeilen } = itemtabelle()

    await instanziiereKatalog(inhalte, anna)

    const erwartet = ausgelieferterKatalog().aufgaben.reduce(
      (summe, aufgabe) => summe + 1 + aufgabe.unteraufgaben.length,
      0,
    )

    expect(zeilen).toHaveLength(erwartet)
  })

  it('macht aus jeder Unteraufgabe eine eigene Zeile unter ihrer Elternaufgabe', async () => {
    // §7: "Unteraufgaben sind eigene Zeilen, keine Liste im Payload der
    // Elternaufgabe." Läge alles in einer Zeile, überlebte von zwei offline
    // gesetzten Häkchen genau eines.
    const anna = mitglied(1)
    const { inhalte, zeilen } = itemtabelle()

    await instanziiereKatalog(inhalte, anna, [], KATALOG)

    const aufgaben = await aufgabenVon(zeilen, anna)
    const eltern = aufgaben.find((aufgabe) => aufgabe.katalog?.aufgabeId === 'sterbefall-anzeigen')
    const unteraufgabe = aufgaben.find((aufgabe) => aufgabe.titel === 'Sterbeurkunden bestellen')

    expect(unteraufgabe?.parentId).toBe(eltern?.id)
    expect(unteraufgabe?.id).not.toBe(eltern?.id)
    // Ohne eigene Herkunft: Rechtsgrundlage, Quelle und Frist gehören der
    // Elternaufgabe und stünden hier ein zweites Mal.
    expect(unteraufgabe?.katalog).toBeNull()
  })

  it('rechnet Unteraufgaben-IDs auf zwei Geräten gleich aus', async () => {
    const anna = mitglied(1)
    const bernd = mitglied(7)

    const [vonAnna, vonBernd] = await Promise.all([
      fehlendeKatalogitems(anna, [], KATALOG),
      fehlendeKatalogitems(bernd, [], KATALOG),
    ])

    expect(vonAnna).toHaveLength(3)
    expect(vonAnna.map((zeile) => zeile.id)).toEqual(vonBernd.map((zeile) => zeile.id))
  })

  it('legt eine fehlende Unteraufgabe nach, ohne die Elternaufgabe anzufassen', async () => {
    // Ein Anlauf, der mittendrin abbrach: Die Elternaufgabe steht, die
    // Unteraufgabe fehlt. Beide Zeilen werden einzeln geprüft.
    const anna = mitglied(1)
    const { inhalte, zeilen } = itemtabelle()

    const alle = await fehlendeKatalogitems(anna, [], KATALOG)
    const ohneUnteraufgabe = alle.filter((zeile) => zeile.id !== alle[1]?.id)

    await inhalte.legeAlleNeuen(ohneUnteraufgabe)

    expect(
      await instanziiereKatalog(inhalte, anna, zeilen.map((zeile) => zeile.id), KATALOG),
    ).toBe(1)

    const aufgaben = await aufgabenVon(zeilen, anna)
    expect(aufgaben.map((aufgabe) => aufgabe.titel)).toContain('Sterbeurkunden bestellen')
  })

  it('übersetzt haengtAbVon in die Item-IDs dieses Falls', async () => {
    // §7: `dependsOn` ist eine schlichte UUID-Liste. Der Katalog nennt
    // Katalog-IDs; übersetzt wird beim Instanziieren, denn nur dort stehen
    // `K_cat` und die `case_id` beisammen.
    const anna = mitglied(1)
    const { inhalte, zeilen } = itemtabelle()

    await instanziiereKatalog(inhalte, anna, [], KATALOG)

    const aufgaben = await aufgabenVon(zeilen, anna)
    const anzeigen = aufgaben.find((aufgabe) => aufgabe.katalog?.aufgabeId === 'sterbefall-anzeigen')
    const ausschlagung = aufgaben.find(
      (aufgabe) => aufgabe.katalog?.aufgabeId === 'erbausschlagung-pruefen',
    )

    expect(ausschlagung?.dependsOn).toEqual([anzeigen?.id])
    expect(anzeigen?.dependsOn).toEqual([])
  })
})
