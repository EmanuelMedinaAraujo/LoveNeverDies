import { describe, expect, it } from 'vitest'
import { BAUPLAENE } from '../../src/services/fragebaumService'
import { erzeugeAesSchluessel } from '../../src/core/crypto/aead'
import { erzeugeKemSchluesselpaar } from '../../src/core/crypto/kem'
import type { Geraeteidentitaet } from '../../src/core/crypto/keystore'
import { erzeugeSignaturSchluesselpaar, pkSigBytes } from '../../src/core/crypto/sign'
import type {
  GeraeteschluesselTabelle,
  GeraeteschluesselZeile,
} from '../../src/core/db/geraeteschluessel'
import type { InhalteTabelle, InhaltZeile, NeuerInhalt } from '../../src/core/db/inhalte'
import type {
  PersoenlicheSchluesselTabelle,
  PersoenlicherSchluesselwrapZeile,
} from '../../src/core/db/persoenlicheschluessel'
import { arbeiteAb, type Mutation, type Warteschlange } from '../../src/core/sync/queue'
import {
  AufgabenFehler,
  aufgabenAusZeilen,
  mutationAendern,
  mutationAnlegen,
  type Aufgabe,
  type Fallschluessel,
} from '../../src/services/aufgabenService'
import {
  erzeugePersoenlichesKid,
  gibFuerAlleFrei,
  ladePersoenlichenSchluessel,
  mutationFragebaumAendern,
  mutationFragebaumAnlegen,
  mutationKenntnisAendern,
  mutationKenntnisAnlegen,
  mutationPrivatAnlegen,
  pruefeAbhaengigkeiten,
  stellePersoenlichenSchluesselBereit,
  uebergebePersoenlichenSchluessel,
} from '../../src/services/privatService'
import { baueBaum } from '../../src/services/aufgabenbaum'
import { fristlage } from '../../src/services/fristen'
import { darfBearbeiten, NIEMAND } from '../../src/services/zuweisung'

/**
 * Private Aufgaben von der Eingabe bis zur Freigabe (DESIGN.md §3.7).
 *
 * Der Server steht hier wieder als Speicher ohne Verstand (§11): Er nimmt an,
 * was kommt, und gibt zurück, was drinsteht — mit der einen Einschränkung, die
 * §3.7 zur Regel macht: `personal_key_wraps` gibt er ausschließlich der Person
 * heraus, der sie gehören. Ohne diese Sperre bewiese der Test nichts.
 *
 * Was `items` angeht, ist er absichtlich blind: Private Zeilen liegen in
 * derselben Tabelle und tragen keinen Marker. Genau deshalb bekommt Bernd sie
 * mitgeliefert, und genau deshalb muss sein Client sie still wegwerfen.
 */

const ANNA = 'user_anna'
const BERND = 'user_bernd'

const ANNAS_GERAET = 'a0000000-0000-4000-8000-000000000001'
const ANNAS_ZWEITES = 'a0000000-0000-4000-8000-000000000002'
const BERNDS_GERAET = 'b0000000-0000-4000-8000-000000000001'

function identitaet(): Geraeteidentitaet {
  const kem = erzeugeKemSchluesselpaar()
  const signatur = erzeugeSignaturSchluesselpaar()

  return {
    kem,
    signatur,
    pkKem: kem.oeffentlich,
    pkSig: pkSigBytes(signatur.oeffentlich),
    fingerabdruck: new Uint8Array(32),
    pruefcode: '000000',
  }
}

function fall(): Fallschluessel {
  return { id: 'fall-1', kid: 'case_fall-1:1', kc: erzeugeAesSchluessel() }
}

/** Ein Server: `items` für alle, `personal_key_wraps` für genau eine Person. */
function server() {
  const itemZeilen: InhaltZeile[] = []
  const persoenlicheZeilen: PersoenlicherSchluesselwrapZeile[] = []
  const geraeteZeilen: GeraeteschluesselZeile[] = []
  let version = 0

  function meldeGeraetAn(id: string, eigene: Geraeteidentitaet, userId: string) {
    geraeteZeilen.push({
      id,
      userId,
      pkKem: eigene.pkKem,
      pkSig: eigene.pkSig,
      label: 'Testgerät',
      angelegtAm: '2026-08-25T09:00:00Z',
    })
  }

  function finde(id: string): InhaltZeile {
    const zeile = itemZeilen.find((kandidat) => kandidat.id === id)

    if (zeile === undefined) {
      throw new Error(`Kein Item ${id}.`)
    }

    return zeile
  }

  /**
   * `items` ohne Ansehen der Person: Jedes Mitglied bekommt jede Zeile (§3.7).
   *
   * Das ist keine Nachlässigkeit des Testservers, sondern die Aussage des
   * Slices: Private Items tragen keinen Marker, und der Server könnte sie gar
   * nicht zurückhalten, ohne zu wissen, wem sie gehören.
   */
  const inhalte: InhalteTabelle = {
    legeAlleNeuen: () => Promise.reject(new Error('nicht gebraucht')),
    rotiereItem: () => Promise.reject(new Error('nicht gebraucht')),

    seit: (fallId, wasserzeichen) =>
      Promise.resolve(
        itemZeilen
          .filter((zeile) => zeile.fallId === fallId && zeile.seq > wasserzeichen)
          .sort((a, b) => (a.id < b.id ? -1 : 1)),
      ),

    lege(neu: NeuerInhalt) {
      version += 1
      itemZeilen.push({
        ...neu,
        seq: version,
        geloescht: false,
        imTresor: neu.imTresor ?? false,
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

    umwrappe(id, kid, wrappedDek) {
      version += 1
      const zeile = finde(id)
      zeile.kid = kid
      zeile.wrappedDek = wrappedDek
      zeile.imTresor = false
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

  /** Die RLS aus §3.7: eigene Zeilen, sonst nichts. */
  function alsPerson(userId: string) {
    const persoenlich: PersoenlicheSchluesselTabelle = {
      fuerGeraet: (fallId, geraeteId) =>
        Promise.resolve(
          persoenlicheZeilen.filter(
            (zeile) =>
              zeile.fallId === fallId && zeile.geraeteId === geraeteId && zeile.userId === userId,
          ),
        ),

      schreibeWraps(neue) {
        for (const wrap of neue) {
          if (wrap.userId !== userId) {
            return Promise.reject(new Error('Fremde persönliche Schlüssel sind gesperrt.'))
          }

          const schonDa = persoenlicheZeilen.some(
            (zeile) =>
              zeile.fallId === wrap.fallId &&
              zeile.kid === wrap.kid &&
              zeile.geraeteId === wrap.geraeteId,
          )

          if (!schonDa) {
            persoenlicheZeilen.push(wrap)
          }
        }

        return Promise.resolve()
      },
    }

    const geraete: GeraeteschluesselTabelle = {
      fuerBenutzer: (wessen) =>
        Promise.resolve(geraeteZeilen.filter((zeile) => zeile.userId === wessen)),
      nachId: (id) => Promise.resolve(geraeteZeilen.find((zeile) => zeile.id === id) ?? null),
      finde: () => Promise.reject(new Error('nicht gebraucht')),
      legeAn: () => Promise.reject(new Error('nicht gebraucht')),
      benenneUm: () => Promise.reject(new Error('nicht gebraucht')),
    }

    return { persoenlich, geraete }
  }

  return { inhalte, itemZeilen, persoenlicheZeilen, alsPerson, meldeGeraetAn }
}

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

/** Trägt Mutationen so hinaus, wie die App es tut: über die Queue (§5). */
async function uebertrage(inhalte: InhalteTabelle, ...mutationen: Mutation[]): Promise<void> {
  const ergebnis = await arbeiteAb(warteschlangeMit(...mutationen), inhalte)

  if (ergebnis.abgelehnt.length > 0 || ergebnis.offen > 0) {
    throw new Error(`Nicht übertragen: ${JSON.stringify(ergebnis.abgelehnt)}`)
  }
}

/**
 * Anna mit einem Gerät, einem Fall und einer privaten Aufgabe; Bernd ist
 * Mitglied desselben Falls und liest denselben Bestand.
 */
async function ausgangslage() {
  const s = server()
  const k = fall()

  const annasIdentitaet = identitaet()
  s.meldeGeraetAn(ANNAS_GERAET, annasIdentitaet, ANNA)

  const anna = s.alsPerson(ANNA)

  const schluessel = await stellePersoenlichenSchluesselBereit(
    anna.persoenlich,
    anna.geraete,
    k.id,
    ANNA,
    ANNAS_GERAET,
    annasIdentitaet,
  )

  return { s, k, anna, annasIdentitaet, schluessel }
}

describe('K_p beschaffen (§3.7)', () => {
  it('erzeugt ein undurchsichtiges kid, das nichts über die Person sagt', () => {
    const eines = erzeugePersoenlichesKid()
    const anderes = erzeugePersoenlichesKid()

    // 32 Byte in Hex. Kein `privat_<user_id>`: Das `kid` wandert in jedem
    // Delta an jedes Mitglied, die Tabelle dahinter nicht.
    expect(eines).toMatch(/^[0-9a-f]{64}$/)
    expect(eines).not.toBe(anderes)
    expect(eines).not.toContain(ANNA)
  })

  it('legt keinen Schlüssel an, solange niemand etwas Privates anlegt', async () => {
    const s = server()
    const eigene = identitaet()
    s.meldeGeraetAn(ANNAS_GERAET, eigene, ANNA)

    const anna = s.alsPerson(ANNA)

    expect(
      await ladePersoenlichenSchluessel(anna.persoenlich, 'fall-1', ANNAS_GERAET, eigene),
    ).toBeNull()
    expect(s.persoenlicheZeilen).toHaveLength(0)
  })

  it('wrappt einen frischen K_p an alle Geräte derselben Person', async () => {
    const s = server()
    const eigene = identitaet()
    const zweites = identitaet()

    s.meldeGeraetAn(ANNAS_GERAET, eigene, ANNA)
    s.meldeGeraetAn(ANNAS_ZWEITES, zweites, ANNA)
    s.meldeGeraetAn(BERNDS_GERAET, identitaet(), BERND)

    const anna = s.alsPerson(ANNA)

    const schluessel = await stellePersoenlichenSchluesselBereit(
      anna.persoenlich,
      anna.geraete,
      'fall-1',
      ANNA,
      ANNAS_GERAET,
      eigene,
    )

    expect(s.persoenlicheZeilen.map((zeile) => zeile.geraeteId).sort()).toEqual([
      ANNAS_GERAET,
      ANNAS_ZWEITES,
    ])

    // Und es ist wirklich derselbe Schlüssel, nicht bloß irgendeiner: Das
    // zweite Gerät entpackt ihn mit seinem eigenen KEM-Schlüssel.
    const amZweiten = await ladePersoenlichenSchluessel(
      anna.persoenlich,
      'fall-1',
      ANNAS_ZWEITES,
      zweites,
    )

    expect(amZweiten?.kid).toBe(schluessel.kid)
    expect(amZweiten?.kp).toEqual(schluessel.kp)
  })

  it('gibt einen bestehenden K_p zurück, statt einen zweiten anzulegen', async () => {
    const { anna, annasIdentitaet, k, s, schluessel } = await ausgangslage()

    const nochmal = await stellePersoenlichenSchluesselBereit(
      anna.persoenlich,
      anna.geraete,
      k.id,
      ANNA,
      ANNAS_GERAET,
      annasIdentitaet,
    )

    expect(nochmal.kid).toBe(schluessel.kid)
    expect(s.persoenlicheZeilen).toHaveLength(1)
  })
})

describe('Eine private Aufgabe anlegen (§3.7)', () => {
  it('legt sie unter K_p ab und niemals unter K_c', async () => {
    const { anna, k, s, schluessel } = await ausgangslage()

    await uebertrage(
      s.inhalte,
      await mutationPrivatAnlegen(k, schluessel, 'Erbausschlagung erwägen'),
    )

    const [zeile] = s.itemZeilen
    expect(zeile?.kid).toBe(schluessel.kid)
    expect(zeile?.kid).not.toBe(k.kid)

    // Die Gegenprobe zum Aufräumen: Bernds Client kennt Annas Wraps nicht.
    expect(await anna.persoenlich.fuerGeraet(k.id, ANNAS_GERAET)).toHaveLength(1)
  })

  it('ist immer eine Wurzelaufgabe ohne Abhängigkeiten', async () => {
    const { k, s, schluessel } = await ausgangslage()

    await uebertrage(s.inhalte, await mutationPrivatAnlegen(k, schluessel, 'Nur für mich'))

    const { aufgaben } = await aufgabenAusZeilen(await s.inhalte.seit(k.id, 0), k, schluessel)

    expect(aufgaben[0]?.parentId).toBeNull()
    expect(aufgaben[0]?.dependsOn).toEqual([])
  })

  it('weist einen leeren Titel ab wie jede andere Aufgabe', async () => {
    const { k, schluessel } = await ausgangslage()

    await expect(mutationPrivatAnlegen(k, schluessel, '   ')).rejects.toThrow(AufgabenFehler)
  })

  it('trägt die anlegende Person ein', async () => {
    const { k, s, schluessel } = await ausgangslage()

    await uebertrage(
      s.inhalte,
      await mutationPrivatAnlegen(k, schluessel, 'Nur für mich', {
        userId: ANNA,
        name: 'Anna Müller',
      }),
    )

    const { aufgaben } = await aufgabenAusZeilen(await s.inhalte.seit(k.id, 0), k, schluessel)

    expect(darfBearbeiten(aufgaben[0]?.assignee ?? NIEMAND, ANNA)).toBe(true)
  })
})

describe('Was die anderen sehen (§3.7, §11.8)', () => {
  it('zeigt der Besitzerin die private Aufgabe und markiert sie als privat', async () => {
    const { k, s, schluessel } = await ausgangslage()

    await uebertrage(s.inhalte, await mutationAnlegen(k, 'Sterbeurkunde beantragen'))
    await uebertrage(
      s.inhalte,
      await mutationPrivatAnlegen(k, schluessel, 'Erbausschlagung erwägen'),
    )

    const { aufgaben, uebersprungeneIds } = await aufgabenAusZeilen(
      await s.inhalte.seit(k.id, 0),
      k,
      schluessel,
    )

    expect(aufgaben.map((aufgabe) => aufgabe.titel).sort()).toEqual([
      'Erbausschlagung erwägen',
      'Sterbeurkunde beantragen',
    ])
    expect(aufgaben.find((aufgabe) => aufgabe.privat)?.titel).toBe('Erbausschlagung erwägen')
    expect(uebersprungeneIds).toEqual([])
  })

  it('verwirft sie beim anderen Mitglied still, ohne Platzhalter und ohne Fehler', async () => {
    const { k, s, schluessel } = await ausgangslage()

    await uebertrage(s.inhalte, await mutationAnlegen(k, 'Sterbeurkunde beantragen'))
    const privat = await mutationPrivatAnlegen(k, schluessel, 'Erbausschlagung erwägen')
    await uebertrage(s.inhalte, privat)

    /*
     * Bernd hat denselben Fall und denselben `K_c`, aber keinen `K_p`. Er lädt
     * die Zeile mit — der Server könnte sie gar nicht zurückhalten — und wirft
     * sie weg. Kein Wurf, keine Aufgabe, kein Titel.
     */
    const { aufgaben, uebersprungeneIds } = await aufgabenAusZeilen(
      await s.inhalte.seit(k.id, 0),
      k,
      null,
    )

    expect(aufgaben.map((aufgabe) => aufgabe.titel)).toEqual(['Sterbeurkunde beantragen'])
    expect(uebersprungeneIds).toEqual([privat.itemId])
  })
})

describe('Für alle sichtbar machen (§3.7)', () => {
  it('wrappt den DEK von K_p auf K_c, ohne Payload und ID anzurühren', async () => {
    const { k, s, schluessel } = await ausgangslage()

    const angelegt = await mutationPrivatAnlegen(k, schluessel, 'Erbausschlagung erwägen')
    await uebertrage(s.inhalte, angelegt)

    const vorher = { ...(s.itemZeilen[0] as InhaltZeile) }

    const [meine] = (await aufgabenAusZeilen(await s.inhalte.seit(k.id, 0), k, schluessel)).aufgaben
    await gibFuerAlleFrei(s.inhalte, k, schluessel, meine as Aufgabe)

    const nachher = s.itemZeilen[0]

    expect(nachher?.id).toBe(vorher.id)
    expect(nachher?.payload).toEqual(vorher.payload)
    expect(nachher?.kid).toBe(k.kid)
    expect(nachher?.wrappedDek).not.toEqual(vorher.wrappedDek)
    expect(nachher?.imTresor).toBe(false)
  })

  it('macht sie damit für das andere Mitglied lesbar', async () => {
    const { k, s, schluessel } = await ausgangslage()

    await uebertrage(
      s.inhalte,
      await mutationPrivatAnlegen(k, schluessel, 'Erbausschlagung erwägen'),
    )

    const [meine] = (await aufgabenAusZeilen(await s.inhalte.seit(k.id, 0), k, schluessel)).aufgaben
    await gibFuerAlleFrei(s.inhalte, k, schluessel, meine as Aufgabe)

    const beiBernd = await aufgabenAusZeilen(await s.inhalte.seit(k.id, 0), k, null)

    expect(beiBernd.aufgaben.map((aufgabe) => aufgabe.titel)).toEqual(['Erbausschlagung erwägen'])
    expect(beiBernd.uebersprungeneIds).toEqual([])
    expect(beiBernd.aufgaben[0]?.privat).toBe(false)
  })

  it('lässt sie für ein nicht zugewiesenes Mitglied sichtbar, aber gesperrt (§7)', async () => {
    const { k, s, schluessel } = await ausgangslage()

    await uebertrage(
      s.inhalte,
      await mutationPrivatAnlegen(k, schluessel, 'Erbausschlagung erwägen', {
        userId: ANNA,
        name: 'Anna Müller',
      }),
    )

    const [meine] = (await aufgabenAusZeilen(await s.inhalte.seit(k.id, 0), k, schluessel)).aufgaben
    await gibFuerAlleFrei(s.inhalte, k, schluessel, meine as Aufgabe)

    const [beiBernd] = (await aufgabenAusZeilen(await s.inhalte.seit(k.id, 0), k, null)).aufgaben

    // Sichtbar: Der Titel steht da. Nicht bearbeitbar: Anna ist eingetragen,
    // und die Zuweisung überlebt die Freigabe unverändert.
    expect(beiBernd?.titel).toBe('Erbausschlagung erwägen')
    expect(darfBearbeiten(beiBernd?.assignee ?? NIEMAND, BERND)).toBe(false)
    expect(darfBearbeiten(beiBernd?.assignee ?? NIEMAND, ANNA)).toBe(true)
  })

  it('bleibt danach änderbar: derselbe DEK, neuer Payload', async () => {
    const { k, s, schluessel } = await ausgangslage()

    await uebertrage(s.inhalte, await mutationPrivatAnlegen(k, schluessel, 'Alter Titel'))

    const [meine] = (await aufgabenAusZeilen(await s.inhalte.seit(k.id, 0), k, schluessel)).aufgaben
    await gibFuerAlleFrei(s.inhalte, k, schluessel, meine as Aufgabe)

    const [freigegeben] = (await aufgabenAusZeilen(await s.inhalte.seit(k.id, 0), k, null)).aufgaben
    await uebertrage(
      s.inhalte,
      await mutationAendern(freigegeben as Aufgabe, { titel: 'Neuer Titel' }),
    )

    const [geaendert] = (await aufgabenAusZeilen(await s.inhalte.seit(k.id, 0), k, null)).aufgaben
    expect(geaendert?.titel).toBe('Neuer Titel')
  })

  it('weist eine zweite Freigabe ab', async () => {
    /*
     * Ohne diese Prüfung wrappte der zweite Klick den DEK ein zweites Mal
     * unter `K_c` und ergäbe eine Zeile, die niemand mehr liest.
     */
    const { k, s, schluessel } = await ausgangslage()

    await uebertrage(s.inhalte, await mutationPrivatAnlegen(k, schluessel, 'Einmal reicht'))

    const [meine] = (await aufgabenAusZeilen(await s.inhalte.seit(k.id, 0), k, schluessel)).aufgaben
    await gibFuerAlleFrei(s.inhalte, k, schluessel, meine as Aufgabe)

    const [nochmal] = (await aufgabenAusZeilen(await s.inhalte.seit(k.id, 0), k, schluessel))
      .aufgaben

    await expect(gibFuerAlleFrei(s.inhalte, k, schluessel, nochmal as Aufgabe)).rejects.toThrow(
      AufgabenFehler,
    )
  })
})

describe('Nichts hängt von einer privaten Aufgabe ab (§3.7, §7)', () => {
  /** Eine Aufgabe, so knapp wie die Prüfung sie braucht. */
  function aufgabe(id: string, privat: boolean, titel = id): Aufgabe {
    return {
      id,
      titel,
      beschreibung: '',
      erledigt: false,
      notizen: '',
      parentId: null,
      dependsOn: [],
      assignee: NIEMAND,
      dek: new Uint8Array(32),
      kid: privat ? 'privat' : 'case_fall-1:1',
      privat,
      katalog: null,
    }
  }

  it('weist eine öffentliche Aufgabe ab, die auf eine private wartet', () => {
    const oeffentlich = aufgabe('oeffentlich', false)
    const privat = aufgabe('privat', true, 'Erbausschlagung erwägen')

    expect(() =>
      pruefeAbhaengigkeiten(oeffentlich, [privat.id], [oeffentlich, privat]),
    ).toThrow(/Erbausschlagung erwägen/)
  })

  it('lässt eine private Aufgabe auf eine öffentliche warten', () => {
    /*
     * "Meine private Ausschlagung kann erst los, wenn der Erbschein da ist"
     * funktioniert: Die Besitzerin sieht beide Seiten, und niemand sonst sieht
     * die Verknüpfung überhaupt (§3.7).
     */
    const oeffentlich = aufgabe('oeffentlich', false)
    const privat = aufgabe('privat', true)

    expect(() =>
      pruefeAbhaengigkeiten(privat, [oeffentlich.id], [oeffentlich, privat]),
    ).not.toThrow()
  })

  it('lässt zwei öffentliche Aufgaben in Ruhe', () => {
    const eine = aufgabe('eine', false)
    const andere = aufgabe('andere', false)

    expect(() => pruefeAbhaengigkeiten(eine, [andere.id], [eine, andere])).not.toThrow()
  })
})

describe('Ein zweites eigenes Gerät (§3.7, §6)', () => {
  it('liest die privaten Aufgaben, nachdem K_p an es gewrappt wurde', async () => {
    const { anna, annasIdentitaet, k, s, schluessel } = await ausgangslage()

    await uebertrage(
      s.inhalte,
      await mutationPrivatAnlegen(k, schluessel, 'Erbausschlagung erwägen'),
    )

    const zweitesGeraet = identitaet()
    s.meldeGeraetAn(ANNAS_ZWEITES, zweitesGeraet, ANNA)

    // Vor der Kopplung: Das zweite Gerät hat den Fall, aber keinen `K_p`, und
    // sieht die eigene private Aufgabe deshalb so wenig wie Bernd.
    expect(
      await ladePersoenlichenSchluessel(anna.persoenlich, k.id, ANNAS_ZWEITES, zweitesGeraet),
    ).toBeNull()

    await uebergebePersoenlichenSchluessel(
      anna.persoenlich,
      k.id,
      ANNA,
      ANNAS_GERAET,
      annasIdentitaet,
      { geraeteId: ANNAS_ZWEITES, pkKem: zweitesGeraet.pkKem },
    )

    const amZweiten = await ladePersoenlichenSchluessel(
      anna.persoenlich,
      k.id,
      ANNAS_ZWEITES,
      zweitesGeraet,
    )

    expect(amZweiten?.kid).toBe(schluessel.kid)

    const { aufgaben, uebersprungeneIds } = await aufgabenAusZeilen(
      await s.inhalte.seit(k.id, 0),
      k,
      amZweiten,
    )

    expect(aufgaben.map((aufgabe) => aufgabe.titel)).toEqual(['Erbausschlagung erwägen'])
    expect(uebersprungeneIds).toEqual([])
  })

  it('gibt nichts weiter, wenn es nichts Privates gibt', async () => {
    const s = server()
    const eigene = identitaet()
    const zweites = identitaet()

    s.meldeGeraetAn(ANNAS_GERAET, eigene, ANNA)
    s.meldeGeraetAn(ANNAS_ZWEITES, zweites, ANNA)

    const anna = s.alsPerson(ANNA)

    await uebergebePersoenlichenSchluessel(anna.persoenlich, 'fall-1', ANNA, ANNAS_GERAET, eigene, {
      geraeteId: ANNAS_ZWEITES,
      pkKem: zweites.pkKem,
    })

    // Kein Schlüssel auf Vorrat: Er wäre eine Zeile, die dem Server sagt, hier
    // gebe es etwas zu verbergen, ohne dass es das gäbe (§3.3, §11.6).
    expect(s.persoenlicheZeilen).toHaveLength(0)
  })
})

/**
 * Das eigene Kenntnisdatum als privates Konfigurations-Item (DESIGN.md §3.7,
 * §8, #12).
 *
 * Die zweite Sorte privater Items, und die einzige, die nie im Aufgabenbaum
 * steht. Der Anlass ist die Ausschlagungsfrist nach § 1944 BGB: Sie knüpft an
 * die Kenntnis des jeweiligen Erben von Anfall und Berufungsgrund an. Anna war
 * am Sterbetag dabei, ihr Bruder erfährt es drei Wochen später vom Notar, und
 * dieselbe geteilte Aufgabe hat für die beiden zwei verschiedene Enden.
 */
describe('Kenntnisdatum als privates Konfigurations-Item (§8, #12)', () => {
  /** Die Ausschlagungsfrist, wie sie aus dem Katalog in das Item kommt (§8). */
  const AUSSCHLAGUNG = {
    aufgabeId: 'erbausschlagung-pruefen',
    version: '2026-08+testtest',
    fristTage: 42,
    fristAb: 'kenntnis' as const,
    zustaendigeStelle: 'Nachlassgericht',
    benoetigteDokumente: [],
    unteraufgaben: [],
    haengtAbVon: [],
    hinweis: '',
    kategorie: 'Frist',
    reihenfolge: 20,
  }

  it('legt es unter K_p ab und liest es zurück, ohne es als Aufgabe zu zählen', async () => {
    const { s, k, anna, annasIdentitaet, schluessel } = await ausgangslage()

    await uebertrage(
      s.inhalte,
      await mutationPrivatAnlegen(k, schluessel, 'Erbausschlagung erwägen'),
      await mutationKenntnisAnlegen(k, schluessel, '2026-05-12', '2026-05-20'),
    )

    const eigener = await ladePersoenlichenSchluessel(
      anna.persoenlich,
      k.id,
      ANNAS_GERAET,
      annasIdentitaet,
    )

    const { aufgaben, konfigurationen, uebersprungeneIds } = await aufgabenAusZeilen(
      await s.inhalte.seit(k.id, 0),
      k,
      eigener,
    )

    expect(konfigurationen.map((eintrag) => eintrag.kenntnisAm)).toEqual(['2026-05-12'])
    expect(konfigurationen[0]?.kid).toBe(schluessel.kid)

    // Es ist keine Aufgabe und kein Defekt: weder im Baum noch im Zähler der
    // übersprungenen Zeilen (§3.7).
    expect(aufgaben.map((aufgabe) => aufgabe.titel)).toEqual(['Erbausschlagung erwägen'])
    expect(baueBaum(aufgaben).map((knoten) => knoten.aufgabe.titel)).toEqual([
      'Erbausschlagung erwägen',
    ])
    expect(uebersprungeneIds).toEqual([])
  })

  it('bleibt für ein anderes Mitglied unlesbar und wird still verworfen', async () => {
    const { s, k, schluessel } = await ausgangslage()

    await uebertrage(
      s.inhalte,
      await mutationKenntnisAnlegen(k, schluessel, '2026-05-12', '2026-05-20'),
    )

    // Bernd hält `K_c` und keinen fremden `K_p`. Was er nicht lesen kann,
    // verwirft er, ohne dass jemand davon erfährt (§3.7).
    const berndsSicht = await aufgabenAusZeilen(await s.inhalte.seit(k.id, 0), k)

    expect(berndsSicht.aufgaben).toEqual([])
    expect(berndsSicht.konfigurationen).toEqual([])
    expect(berndsSicht.uebersprungeneIds).toHaveLength(1)
  })

  it('ändert das Datum unter demselben DEK, statt ein zweites Item anzulegen', async () => {
    const { s, k, schluessel } = await ausgangslage()

    await uebertrage(
      s.inhalte,
      await mutationKenntnisAnlegen(k, schluessel, '2026-05-12', '2026-05-20'),
    )

    const vorher = (await aufgabenAusZeilen(await s.inhalte.seit(k.id, 0), k, schluessel))
      .konfigurationen[0]!

    await uebertrage(s.inhalte, await mutationKenntnisAendern(vorher, '2026-06-02', '2026-06-10'))

    const nachher = await aufgabenAusZeilen(await s.inhalte.seit(k.id, 0), k, schluessel)

    expect(nachher.konfigurationen).toHaveLength(1)
    expect(nachher.konfigurationen[0]?.id).toBe(vorher.id)
    expect(nachher.konfigurationen[0]?.kenntnisAm).toBe('2026-06-02')
    expect(s.itemZeilen).toHaveLength(1)
  })

  it('leert das Datum wieder und macht die Aufgabe damit erneut fristenlos', async () => {
    const { s, k, schluessel } = await ausgangslage()

    await uebertrage(
      s.inhalte,
      await mutationKenntnisAnlegen(k, schluessel, '2026-05-12', '2026-05-20'),
    )

    const eingetragen = (await aufgabenAusZeilen(await s.inhalte.seit(k.id, 0), k, schluessel))
      .konfigurationen[0]!

    await uebertrage(s.inhalte, await mutationKenntnisAendern(eingetragen, null, '2026-05-20'))

    const { konfigurationen } = await aufgabenAusZeilen(await s.inhalte.seit(k.id, 0), k, schluessel)

    expect(konfigurationen[0]?.kenntnisAm).toBeNull()
    expect(
      fristlage(AUSSCHLAGUNG, { sterbedatum: '2026-05-12', kenntnisAm: null }, '2026-05-20'),
    ).toEqual({ art: 'ab-kenntnis' })
  })

  it('lässt die Zeile der geteilten Aufgabe unberührt (§8)', async () => {
    /*
     * Die Zusage, an der #12 hängt: Zwei Mitglieder sehen auf derselben
     * Aufgabe zwei Fristenden, und dabei ändert sich an ihr keine Zeile. Das
     * Fristende wird gerechnet und nie gespeichert.
     */
    const { s, k, schluessel } = await ausgangslage()

    await uebertrage(s.inhalte, await mutationPrivatAnlegen(k, schluessel, 'Geteilte Aufgabe'))

    const aufgabenzeile = s.itemZeilen[0]!
    const vorher = { seq: aufgabenzeile.seq, payload: aufgabenzeile.payload }

    await uebertrage(
      s.inhalte,
      await mutationKenntnisAnlegen(k, schluessel, '2026-05-12', '2026-05-20'),
    )

    expect(s.itemZeilen[0]?.seq).toBe(vorher.seq)
    expect(s.itemZeilen[0]?.payload).toBe(vorher.payload)

    const annasEnde = fristlage(
      AUSSCHLAGUNG,
      { sterbedatum: '2026-05-12', kenntnisAm: '2026-05-12' },
      '2026-05-20',
    )
    const brudersEnde = fristlage(
      AUSSCHLAGUNG,
      { sterbedatum: '2026-05-12', kenntnisAm: '2026-06-02' },
      '2026-05-20',
    )

    expect(annasEnde).toMatchObject({ ende: '2026-06-23' })
    expect(brudersEnde).toMatchObject({ ende: '2026-07-14' })
  })

  it('weist ein Kenntnisdatum in der Zukunft ab', async () => {
    // Aus einem vertippten Jahr würde sonst eine Frist, die viel später endet
    // als die wirkliche, und eine versäumte Ausschlagung kostet den ganzen
    // Nachlass (§8).
    const { k, schluessel } = await ausgangslage()

    await expect(mutationKenntnisAnlegen(k, schluessel, '2062-05-12', '2026-05-20')).rejects.toThrow(
      AufgabenFehler,
    )
  })

  it('weist einen Text ab, der kein Kalendertag ist', async () => {
    const { k, schluessel } = await ausgangslage()

    await expect(mutationKenntnisAnlegen(k, schluessel, 'im Mai', '2026-05-20')).rejects.toThrow(
      AufgabenFehler,
    )
    await expect(
      mutationKenntnisAnlegen(k, schluessel, '2026-02-31', '2026-05-20'),
    ).rejects.toThrow(AufgabenFehler)
  })
})

describe('Fragebaum-Ergebnis als privates Konfigurations-Item (ERBE_DESIGN.md §6)', () => {
  /** Ein Ergebnis, wie es die Ergebnisseite schreibt. */
  const ERBE = {
    knotenId: 'n6',
    pfad: ['n0', 'n1', 'n2', 'n3', 'n4', 'n6'],
    status: 'erbe' as const,
    am: '2026-08-25T10:00:00.000Z',
  }

  const KEIN_ERBE = {
    knotenId: 'n53',
    pfad: ['n0', 'n50', 'n53'],
    status: 'kein-erbe' as const,
    am: '2026-09-01T10:00:00.000Z',
  }

  it('legt es unter K_p ab und liest es zurück, ohne es als Aufgabe zu zählen', async () => {
    const { s, k, schluessel } = await ausgangslage()

    await uebertrage(s.inhalte, await mutationFragebaumAnlegen(k, schluessel, ERBE))

    const { aufgaben, konfigurationen, uebersprungeneIds } = await aufgabenAusZeilen(
      await s.inhalte.seit(k.id, 0),
      k,
      schluessel,
    )

    expect(konfigurationen).toHaveLength(1)
    expect(konfigurationen[0]?.fragebaum).toEqual(ERBE)
    expect(aufgaben).toEqual([])
    expect(uebersprungeneIds).toEqual([])
  })

  it('bleibt für ein anderes Mitglied unlesbar (§3.7)', async () => {
    // Der Kern der Sache: Wann jemand erfährt, dass er Erbe ist — und ob —,
    // geht seine Geschwister nichts an.
    const { s, k, schluessel } = await ausgangslage()

    await uebertrage(s.inhalte, await mutationFragebaumAnlegen(k, schluessel, ERBE))

    const berndsSicht = await aufgabenAusZeilen(await s.inhalte.seit(k.id, 0), k)

    expect(berndsSicht.konfigurationen).toEqual([])
    expect(berndsSicht.uebersprungeneIds).toHaveLength(1)
  })

  it('ersetzt das Ergebnis unter demselben DEK, statt ein zweites Item anzulegen', async () => {
    const { s, k, schluessel } = await ausgangslage()

    await uebertrage(s.inhalte, await mutationFragebaumAnlegen(k, schluessel, ERBE))

    const vorher = (await aufgabenAusZeilen(await s.inhalte.seit(k.id, 0), k, schluessel))
      .konfigurationen[0]!

    await uebertrage(s.inhalte, await mutationFragebaumAendern(vorher, KEIN_ERBE))

    const nachher = await aufgabenAusZeilen(await s.inhalte.seit(k.id, 0), k, schluessel)

    expect(nachher.konfigurationen).toHaveLength(1)
    expect(nachher.konfigurationen[0]?.id).toBe(vorher.id)
    expect(nachher.konfigurationen[0]?.fragebaum).toEqual(KEIN_ERBE)
    expect(s.itemZeilen).toHaveLength(1)
  })

  it('lässt das Kenntnisdatum stehen, wenn das Ergebnis ersetzt wird', async () => {
    // Das Kenntnisdatum hängt an § 1944 BGB und nicht daran, was der Baum
    // zuletzt gesagt hat. Ein hier vergessenes Feld wäre kein leeres Feld,
    // sondern ein gelöschtes — und damit eine verlorene Ausschlagungsfrist.
    const { s, k, schluessel } = await ausgangslage()

    await uebertrage(
      s.inhalte,
      await mutationKenntnisAnlegen(k, schluessel, '2026-05-12', '2026-05-20'),
    )

    const mitDatum = (await aufgabenAusZeilen(await s.inhalte.seit(k.id, 0), k, schluessel))
      .konfigurationen[0]!

    await uebertrage(s.inhalte, await mutationFragebaumAendern(mitDatum, ERBE))

    const nachher = (await aufgabenAusZeilen(await s.inhalte.seit(k.id, 0), k, schluessel))
      .konfigurationen[0]!

    expect(nachher.kenntnisAm).toBe('2026-05-12')
    expect(nachher.fragebaum).toEqual(ERBE)
  })

  it('lässt das Ergebnis stehen, wenn das Kenntnisdatum geändert wird', async () => {
    const { s, k, schluessel } = await ausgangslage()

    await uebertrage(s.inhalte, await mutationFragebaumAnlegen(k, schluessel, ERBE))

    const mitErgebnis = (await aufgabenAusZeilen(await s.inhalte.seit(k.id, 0), k, schluessel))
      .konfigurationen[0]!

    await uebertrage(
      s.inhalte,
      await mutationKenntnisAendern(mitErgebnis, '2026-06-02', '2026-06-10'),
    )

    const nachher = (await aufgabenAusZeilen(await s.inhalte.seit(k.id, 0), k, schluessel))
      .konfigurationen[0]!

    expect(nachher.kenntnisAm).toBe('2026-06-02')
    expect(nachher.fragebaum).toEqual(ERBE)
  })

  it('liest ein Konfigurations-Item ohne das Feld als "noch nicht durchlaufen"', async () => {
    // Ein Payload, den eine ältere Fassung geschrieben hat, kennt das Feld
    // nicht. Das ist kein Defekt und darf keiner werden.
    const { s, k, schluessel } = await ausgangslage()

    await uebertrage(
      s.inhalte,
      await mutationKenntnisAnlegen(k, schluessel, '2026-05-12', '2026-05-20'),
    )

    const gelesen = (await aufgabenAusZeilen(await s.inhalte.seit(k.id, 0), k, schluessel))
      .konfigurationen[0]!

    expect(gelesen.fragebaum).toBeNull()
    expect(gelesen.kenntnisAm).toBe('2026-05-12')
  })
})

describe('Aufgaben aus dem Fragebaum (ERBE_DESIGN.md §7)', () => {
  it('legt sie privat, zugewiesen und mit ihren Rechtsangaben an', async () => {
    const { s, k, schluessel } = await ausgangslage()
    const bauplan = BAUPLAENE.ausschlagung

    await uebertrage(
      s.inhalte,
      await mutationPrivatAnlegen(k, schluessel, bauplan.titel, { userId: ANNA, name: 'Anna' }, {
        beschreibung: bauplan.beschreibung,
        notizen: 'PLZ 80331',
        katalog: bauplan.katalog,
      }),
    )

    const eigene = await aufgabenAusZeilen(await s.inhalte.seit(k.id, 0), k, schluessel)
    const aufgabe = eigene.aufgaben[0]!

    expect(aufgabe.titel).toBe(bauplan.titel)
    expect(aufgabe.privat).toBe(true)
    expect(aufgabe.katalog?.fristTage).toBe(42)
    expect(aufgabe.katalog?.fristAb).toBe('kenntnis')
    expect(aufgabe.notizen).toBe('PLZ 80331')
    expect(aufgabe.assignee).toEqual({
      art: 'personen',
      personen: [{ userId: ANNA, name: 'Anna' }],
    })
    expect(aufgabe.parentId).toBeNull()
    expect(aufgabe.dependsOn).toEqual([])

    // Die anderen sehen davon nichts.
    const berndsSicht = await aufgabenAusZeilen(await s.inhalte.seit(k.id, 0), k)

    expect(berndsSicht.aufgaben).toEqual([])
  })
})
