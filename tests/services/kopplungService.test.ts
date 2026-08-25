import { describe, expect, it } from 'vitest'
import { verschluessele } from '../../src/core/crypto/aead'
import { sha256 } from '../../src/core/crypto/bytes'
import { geraetePruefcode } from '../../src/core/crypto/fingerprint'
import { erzeugeKemSchluesselpaar, kapsele } from '../../src/core/crypto/kem'
import type { Geraeteidentitaet } from '../../src/core/crypto/keystore'
import { erzeugeSignaturSchluesselpaar, pkSigBytes } from '../../src/core/crypto/sign'
import type {
  FaelleTabelle,
  FallZeile,
  NeuerTrauerfall,
  NeuerVorsorgefall,
} from '../../src/core/db/faelle'
import type { InhalteTabelle, InhaltZeile, NeuerInhalt } from '../../src/core/db/inhalte'
import type {
  SchluesselwrapTabelle,
  SchluesselwrapZeile,
} from '../../src/core/db/fallschluessel'
import type {
  GeraeteschluesselTabelle,
  GeraeteschluesselZeile,
} from '../../src/core/db/geraeteschluessel'
import type { Einloesung, KopplungTabelle, Kopplungszweck } from '../../src/core/db/kopplung'
import type {
  PersoenlicheSchluesselTabelle,
  PersoenlicherSchluesselwrapZeile,
} from '../../src/core/db/persoenlicheschluessel'
import type { TresorTabelle, VaultKeyWrapZeile, VaultShareZeile } from '../../src/core/db/tresor'
import {
  ladeFaelle,
  legeTrauerfallAn,
  legeVorsorgefallAn,
  type Fall,
} from '../../src/services/fallService'
import {
  freischaltungText,
  fuegeZumFallHinzu,
  gruppierterKopplungscode,
  KOPPLUNGSCODE_ALPHABET,
  KopplungFehler,
  loeseKopplungscodeEin,
  normalisiereKopplungscode,
  schalteGeraetFrei,
} from '../../src/services/kopplungService'
import {
  ladePersoenlichenSchluessel,
  stellePersoenlichenSchluesselBereit,
} from '../../src/services/privatService'
import { entpackeEigenenAnteil } from '../../src/services/todesfallService'

/**
 * Der ganze Ablauf aus DESIGN.md §6, ohne Server: Code ausgeben, einlösen,
 * Prüfcode vergleichen, Schlüssel wrappen, und am anderen Ende einen Fall
 * lesen, den es dort vorher nicht gab.
 *
 * Der Server steht hier wieder als Speicher ohne Verstand (§11): Er nimmt an,
 * was kommt, und gibt zurück, was drinsteht, nur eingeschränkt auf das, was
 * die RLS herausgibt, denn genau daran hängt, ob `ladeFaelle` auf der anderen
 * Seite überhaupt etwas findet.
 */

const ANGABEN = { personName: 'Hans Weber', sterbedatum: '2026-05-12' }

const BERND = 'user_bernd'
const ANNA = 'user_anna'

const BERNDS_GERAET = 'b0000000-0000-4000-8000-000000000001'
const ANNAS_GERAET = 'a0000000-0000-4000-8000-000000000002'

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

type Codezeile = {
  code: string
  userId: string
  geraeteId: string
  zweck: Kopplungszweck
  verbraucht: boolean
  eingeloestVon: string | null
}

/**
 * Ein Server mit Zeilen und mit RLS, aber ohne Meinung.
 *
 * Die Einschränkung auf Mitgliedschaften ist hier nicht Zierrat: Ohne sie sähe
 * die beitretende Person den Fall schon vor der Kopplung, und der Test bewiese
 * nichts.
 */
function server() {
  const faelleZeilen: FallZeile[] = []
  const mitglieder: { fallId: string; userId: string }[] = []
  const wrapZeilen: SchluesselwrapZeile[] = []
  const geraeteZeilen: GeraeteschluesselZeile[] = []
  const vaultWrapZeilen: VaultKeyWrapZeile[] = []
  const itemZeilen: InhaltZeile[] = []
  let naechsteSeq = 0
  const profile = new Map<string, { anzeigename: string; email: string | null }>()
  const codes = new Map<string, Codezeile>()

  const vaultShareZeilen: VaultShareZeile[] = []
  const persoenlicheZeilen: PersoenlicherSchluesselwrapZeile[] = []
  let naechsterCode = 0

  function meldeGeraetAn(id: string, eigene: Geraeteidentitaet, userId: string) {
    geraeteZeilen.push({
      id,
      userId,
      pkKem: eigene.pkKem,
      pkSig: eigene.pkSig,
      label: 'Testgerät',
      angelegtAm: '2026-08-23T12:00:00Z',
    })
  }

  function alsPerson(userId: string) {
    const eigeneFaelle = () =>
      faelleZeilen.filter((zeile) =>
        mitglieder.some((m) => m.fallId === zeile.id && m.userId === userId),
      )

    const faelle: FaelleTabelle = {
      version: (fallId) =>
        Promise.resolve(eigeneFaelle().find((zeile) => zeile.id === fallId)?.version ?? null),
      eigene: () => Promise.resolve(eigeneFaelle()),
      legeTrauerfallAn(neu: NeuerTrauerfall) {
        faelleZeilen.push({
          id: neu.id,
          status: 'trauerfall',
          currentKid: neu.kidFall,
          keyGeneration: 1,
          version: 0,
          katalogVersion: neu.katalogVersion,
          payload: neu.payload,
          preparerId: null,
          vaultCommitment: null,
          vaultResplitPending: false,
          vaultK: null,
          vaultN: null,
          rotationPending: false,
          rotationClaimedBy: null,
          rotationClaimExpiresAt: null,
          angelegtAm: '2026-08-23T12:00:00Z',
        })
        mitglieder.push({ fallId: neu.id, userId })

        for (const [kid, wrap] of [
          [neu.kidFall, neu.wrapFall],
          [neu.kidKatalog, neu.wrapKatalog],
        ] as const) {
          wrapZeilen.push({ ...wrap, fallId: neu.id, kid, geraeteId: neu.geraeteId, wrappedBy: neu.geraeteId })
        }

        return Promise.resolve()
      },
      legeVorsorgefallAn(neu: NeuerVorsorgefall) {
        faelleZeilen.push({
          id: neu.id,
          status: 'vorsorge',
          currentKid: neu.kidFall,
          keyGeneration: 1,
          version: 0,
          katalogVersion: null,
          payload: neu.payload,
          preparerId: userId,
          vaultCommitment: neu.vaultCommitment,
          vaultResplitPending: false,
          vaultK: null,
          vaultN: 0,
          rotationPending: false,
          rotationClaimedBy: null,
          rotationClaimExpiresAt: null,
          angelegtAm: '2026-08-24T12:00:00Z',
        })
        mitglieder.push({ fallId: neu.id, userId })

        for (const [kid, wrap] of [
          [neu.kidFall, neu.wrapFall],
          [neu.kidKatalog, neu.wrapKatalog],
        ] as const) {
          wrapZeilen.push({ ...wrap, fallId: neu.id, kid, geraeteId: neu.geraeteId, wrappedBy: neu.geraeteId })
        }

        vaultWrapZeilen.push({
          fallId: neu.id,
          geraeteId: neu.geraeteId,
          kemCt: neu.vaultKemCt,
          wrappedKey: neu.vaultWrappedKey,
        })

        return Promise.resolve()
      },
      loescheVorsorgefall: () => Promise.reject(new Error('nicht gebraucht')),
      claimRotation: () => Promise.resolve(true),
      commitRotation: () => Promise.resolve(true),
    }

    /*
     * `items`, so schmal wie der Port. Die Fallanlage instanziiert den
     * Rechtskatalog hier hinein (§8); für die Kopplung selbst spielt der Inhalt
     * keine Rolle, wohl aber, dass er entstehen kann.
     */
    const inhalte: InhalteTabelle = {
      seit: (fallId) => Promise.resolve(itemZeilen.filter((zeile) => zeile.fallId === fallId)),

      lege: (neu: NeuerInhalt) => {
        itemZeilen.push(alsItem(neu))

        return Promise.resolve()
      },

      umwrappe: () => Promise.reject(new Error('nicht gebraucht')),
      rotiereItem: () => Promise.reject(new Error('nicht gebraucht')),

      legeAlleNeuen: (neue: NeuerInhalt[]) => {
        for (const neu of neue) {
          if (!itemZeilen.some((zeile) => zeile.id === neu.id)) {
            itemZeilen.push(alsItem(neu))
          }
        }

        return Promise.resolve()
      },

      schreibePayload: () => Promise.reject(new Error('nicht gebraucht')),
      loesche: () => Promise.reject(new Error('nicht gebraucht')),
    }

    function alsItem(neu: NeuerInhalt): InhaltZeile {
      return {
        ...neu,
        seq: (naechsteSeq += 1),
        geloescht: false,
        imTresor: false,
        geaendertAm: '2026-08-23T12:00:00Z',
      }
    }

    const wraps: SchluesselwrapTabelle = {
      fuerGeraet: (fallId, geraeteId) =>
        Promise.resolve(
          wrapZeilen.filter((zeile) => zeile.fallId === fallId && zeile.geraeteId === geraeteId),
        ),
      schreibeWraps: () => Promise.resolve(),
    }

    const geraete: GeraeteschluesselTabelle = {
      nachId: (id) => Promise.resolve(geraeteZeilen.find((zeile) => zeile.id === id) ?? null),
      finde: () => Promise.reject(new Error('nicht gebraucht')),
      legeAn: () => Promise.reject(new Error('nicht gebraucht')),
      fuerBenutzer: (wessen) =>
        Promise.resolve(geraeteZeilen.filter((zeile) => zeile.userId === wessen)),
      benenneUm: () => Promise.reject(new Error('nicht gebraucht')),
    }

    /*
     * `vault_key_wraps`, so schmal wie der Port und mit derselben Sperre wie
     * die Policy: Nur der Preparer eines Falls schreibt hinein (§3.5, §4).
     */
    const tresor: TresorTabelle = {
      wrapFuerGeraet: (fallId, geraeteId) =>
        Promise.resolve(
          vaultWrapZeilen.find(
            (zeile) => zeile.fallId === fallId && zeile.geraeteId === geraeteId,
          ) ?? null,
        ),

      legeWrapAn(wrap) {
        const fall = faelleZeilen.find((zeile) => zeile.id === wrap.fallId)

        if (fall?.preparerId !== userId) {
          return Promise.reject(new Error('Nur der Preparer schreibt in vault_key_wraps.'))
        }

        if (
          !vaultWrapZeilen.some(
            (zeile) => zeile.fallId === wrap.fallId && zeile.geraeteId === wrap.geraeteId,
          )
        ) {
          vaultWrapZeilen.push(wrap)
        }

        return Promise.resolve()
      },

      sharesFuerFall: (fallId) =>
        Promise.resolve(vaultShareZeilen.filter((zeile) => zeile.fallId === fallId)),

      resplitVault: () => Promise.reject(new Error('nicht gebraucht')),

      /*
       * Dieselbe Regel wie die RPC `uebergib_tresoranteil` (§3.5): Stelle und
       * Hash kommen aus der bestehenden Zeile dieser Person, nie vom Aufrufer,
       * und das Zielgerät muss ihr gehören.
       */
      uebergibShare(fallId, geraeteId, kemCt, wrappedShare) {
        const eigener = vaultShareZeilen.find(
          (zeile) => zeile.fallId === fallId && zeile.userId === userId,
        )

        if (eigener === undefined) {
          return Promise.reject(new Error('Zu diesem Fall halten Sie keinen Anteil.'))
        }

        if (!geraeteZeilen.some((zeile) => zeile.id === geraeteId && zeile.userId === userId)) {
          return Promise.reject(new Error('Das Gerät gehört nicht zur angemeldeten Person.'))
        }

        vaultShareZeilen.push({
          fallId,
          userId,
          geraeteId,
          shareIndex: eigener.shareIndex,
          shareHash: eigener.shareHash,
          kemCt,
          wrappedShare,
        })

        return Promise.resolve()
      },
      freigabenFuerFall: () => Promise.resolve([]),
      sendeFreigabe: () => Promise.reject(new Error('nicht gebraucht')),
      oeffneTresor: () => Promise.reject(new Error('nicht gebraucht')),
    }

    /*
     * `personal_key_wraps`, mit derselben Sperre wie die Policy (§3.7, §4):
     * Gelesen und geschrieben wird ausschliesslich im eigenen Namen. Ohne die
     * Einschraenkung bewiese der Test nichts: Er liefe auch dann durch, wenn
     * `K_p` fuer alle sichtbar waere.
     */
    const persoenlich: PersoenlicheSchluesselTabelle = {
      fuerGeraet: (fallId, geraeteId) =>
        Promise.resolve(
          persoenlicheZeilen.filter(
            (zeile) =>
              zeile.fallId === fallId &&
              zeile.geraeteId === geraeteId &&
              zeile.userId === userId,
          ),
        ),

      schreibeWraps(neue) {
        for (const wrap of neue) {
          if (wrap.userId !== userId) {
            return Promise.reject(new Error('Fremde persoenliche Schluessel sind gesperrt.'))
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

    const kopplung: KopplungTabelle = {
      erzeugeCode(geraeteId, zweck) {
        // Aus demselben Alphabet wie die Migration, damit
        // `normalisiereKopplungscode` den Code auch wirklich annimmt.
        const code = [...`${naechsterCode++}`.padStart(8, '0')]
          .map((ziffer) => KOPPLUNGSCODE_ALPHABET[Number(ziffer)] ?? '2')
          .join('')

        codes.set(code, { code, userId, geraeteId, zweck, verbraucht: false, eingeloestVon: null })

        return Promise.resolve({ code, laeuftAbAm: '2026-08-24T10:15:00Z' })
      },

      loeseEin(code): Promise<Einloesung> {
        const zeile = codes.get(code)

        if (zeile === undefined) {
          return Promise.resolve({ status: 'unbekannt' })
        }

        if (zeile.verbraucht) {
          return Promise.resolve({ status: 'verbraucht' })
        }

        zeile.verbraucht = true
        zeile.eingeloestVon = userId

        const geraet = geraeteZeilen.find((g) => g.id === zeile.geraeteId)
        const eintrag = profile.get(zeile.userId)

        if (geraet === undefined || eintrag === undefined) {
          throw new Error('Der Testserver kennt dieses Gerät oder Profil nicht.')
        }

        return Promise.resolve({
          status: 'ok',
          angebot: {
            zweck: zeile.zweck,
            userId: zeile.userId,
            anzeigename: eintrag.anzeigename,
            email: eintrag.email,
            geraeteId: zeile.geraeteId,
            pkKem: geraet.pkKem,
            pkSig: geraet.pkSig,
          },
        })
      },

      schliesseAb(abschluss) {
        const zeile = codes.get(abschluss.code)

        if (zeile === undefined || zeile.eingeloestVon !== userId) {
          throw new Error('Dieser Kopplungscode wurde nicht von dieser Person eingelöst.')
        }

        if (
          zeile.zweck === 'join' &&
          !mitglieder.some((m) => m.fallId === abschluss.fallId && m.userId === zeile.userId)
        ) {
          mitglieder.push({ fallId: abschluss.fallId, userId: zeile.userId })
        }

        for (const [kid, wrap] of [
          [abschluss.kidFall, abschluss.wrapFall],
          [abschluss.kidKatalog, abschluss.wrapKatalog],
        ] as const) {
          wrapZeilen.push({
            ...wrap,
            fallId: abschluss.fallId,
            kid,
            geraeteId: zeile.geraeteId,
            wrappedBy: abschluss.absenderId,
          })
        }

        return Promise.resolve()
      },
    }

    return { faelle, inhalte, wraps, geraete, kopplung, tresor, persoenlich }
  }

  return {
    alsPerson,
    meldeGeraetAn,
    profile,
    wrapZeilen,
    vaultWrapZeilen,
    vaultShareZeilen,
    persoenlicheZeilen,
    mitglieder,
    faelleZeilen,
  }
}

/** Bernd hat einen Fall, Anna hat ein Gerät und ein Profil, sonst nichts. */
async function ausgangslage() {
  const s = server()

  const berndsIdentitaet = identitaet()
  const annasIdentitaet = identitaet()

  s.meldeGeraetAn(BERNDS_GERAET, berndsIdentitaet, BERND)
  s.meldeGeraetAn(ANNAS_GERAET, annasIdentitaet, ANNA)
  s.profile.set(BERND, { anzeigename: 'Bernd Weber', email: 'bernd@example.de' })
  s.profile.set(ANNA, { anzeigename: 'Anna Müller', email: 'anna@example.de' })

  const bernd = s.alsPerson(BERND)
  const anna = s.alsPerson(ANNA)

  const fall = await legeTrauerfallAn(
    bernd.faelle,
    bernd.inhalte,
    berndsIdentitaet,
    BERNDS_GERAET,
    ANGABEN,
  )

  return { s, bernd, anna, berndsIdentitaet, annasIdentitaet, fall }
}

function annasFaelle(lage: Awaited<ReturnType<typeof ausgangslage>>) {
  return ladeFaelle(
    lage.anna.faelle,
    lage.anna.wraps,
    lage.anna.geraete,
    lage.annasIdentitaet,
    ANNAS_GERAET,
  )
}

describe('Kopplungscodes lesen und schreiben (§6)', () => {
  it('gruppiert acht Zeichen in zwei Vierergruppen', () => {
    expect(gruppierterKopplungscode('K4M7QP2X')).toBe('K4M7-QP2X')
  })

  it('nimmt den Code so an, wie ihn jemand vom Telefon abschreibt', () => {
    for (const eingabe of ['K4M7QP2X', 'k4m7-qp2x', ' K4M7 QP2X ', 'k4m7qp2x']) {
      expect(normalisiereKopplungscode(eingabe)).toBe('K4M7QP2X')
    }
  })

  it('weist einen Code falscher Länge ab', () => {
    expect(() => normalisiereKopplungscode('K4M7QP2')).toThrow(/8 Zeichen/)
  })

  it('weist die vier verwechselbaren Zeichen ab', () => {
    // Sie kommen im Alphabet nicht vor (§6); wer sie eingetippt hat, hat sich
    // verhört. Der Client fängt das ab, bevor es gegen das Rate-Limit zählt.
    for (const eingabe of ['O4M7QP2X', '04M7QP2X', 'I4M7QP2X', '14M7QP2X']) {
      expect(() => normalisiereKopplungscode(eingabe)).toThrow(/kein O, keine 0, kein I/)
    }
  })
})

describe('Eine Angehörige einladen (§6, purpose = join)', () => {
  it('zeigt der einladenden Seite Name, E-Mail und den Prüfcode des Neugeräts', async () => {
    const lage = await ausgangslage()

    const { code } = await lage.anna.kopplung.erzeugeCode(ANNAS_GERAET, 'join')
    const anfrage = await loeseKopplungscodeEin(lage.bernd.kopplung, gruppierterKopplungscode(code))

    expect(anfrage.angebot).toMatchObject({
      zweck: 'join',
      userId: ANNA,
      anzeigename: 'Anna Müller',
      email: 'anna@example.de',
      geraeteId: ANNAS_GERAET,
    })

    // Derselbe Prüfcode, den Annas Gerät in Profil zeigt. Beide Seiten lesen
    // ihn vor, und er deckt beide Schlüssel ab (§3.6).
    expect(anfrage.pruefcode).toBe(
      await geraetePruefcode(lage.annasIdentitaet.pkKem, lage.annasIdentitaet.pkSig),
    )
  })

  it('macht den Fall für die beitretende Person lesbar', async () => {
    const lage = await ausgangslage()

    expect(await annasFaelle(lage)).toEqual([])

    const { code } = await lage.anna.kopplung.erzeugeCode(ANNAS_GERAET, 'join')
    const anfrage = await loeseKopplungscodeEin(lage.bernd.kopplung, code)

    await fuegeZumFallHinzu(
      lage.bernd.kopplung,
      anfrage,
      lage.fall,
      lage.berndsIdentitaet,
      BERNDS_GERAET,
    )

    // Der volle Weg aus §3.6 auf Annas Seite: Wrap holen, Signatur gegen
    // Bernds Gerät prüfen, entpacken, Payload entschlüsseln.
    expect(await annasFaelle(lage)).toEqual([
      expect.objectContaining({
        zustand: 'lesbar',
        id: lage.fall.id,
        personName: 'Hans Weber',
        sterbedatum: '2026-05-12',
      }),
    ])
  })

  it('gibt K_c und K_cat an das Neugerät weiter, ohne sie im Klartext abzulegen', async () => {
    const lage = await ausgangslage()

    const { code } = await lage.anna.kopplung.erzeugeCode(ANNAS_GERAET, 'join')
    const anfrage = await loeseKopplungscodeEin(lage.bernd.kopplung, code)
    await fuegeZumFallHinzu(lage.bernd.kopplung, anfrage, lage.fall, lage.berndsIdentitaet, BERNDS_GERAET)

    const fuerAnna = lage.s.wrapZeilen.filter((zeile) => zeile.geraeteId === ANNAS_GERAET)

    expect(fuerAnna.map((zeile) => zeile.kid).sort()).toEqual(
      [lage.fall.kid, `cat_${lage.fall.id}`].sort(),
    )
    // Signiert hat Bernds Gerät; gegen dessen `sig_public_key` verifiziert
    // Annas Gerät, bevor es entpackt (§3.6).
    expect(fuerAnna.every((zeile) => zeile.wrappedBy === BERNDS_GERAET)).toBe(true)

    const alles = fuerAnna.flatMap((zeile) => [...zeile.kemCt, ...zeile.wrappedKey]).join(',')
    expect(alles).not.toContain([...lage.fall.kc].join(','))
    expect(alles).not.toContain([...lage.fall.kcat].join(','))
  })

  it('nimmt einen device-Code für eine Einladung nicht an', async () => {
    const lage = await ausgangslage()

    const { code } = await lage.anna.kopplung.erzeugeCode(ANNAS_GERAET, 'device')
    const anfrage = await loeseKopplungscodeEin(lage.bernd.kopplung, code)

    await expect(
      fuegeZumFallHinzu(lage.bernd.kopplung, anfrage, lage.fall, lage.berndsIdentitaet, BERNDS_GERAET),
    ).rejects.toThrow(KopplungFehler)
  })
})

describe('Ein zweites Gerät freigeben (§6, purpose = device)', () => {
  const BERNDS_ZWEITES = 'b0000000-0000-4000-8000-000000000009'

  it('schaltet alle Fälle frei, die das freigebende Gerät lesen kann', async () => {
    const lage = await ausgangslage()
    const zweiterFall = await legeTrauerfallAn(
      lage.bernd.faelle,
      lage.bernd.inhalte,
      lage.berndsIdentitaet,
      BERNDS_GERAET,
      { personName: 'Erika Weber', sterbedatum: '2026-06-01' },
    )

    const zweitesGeraet = identitaet()
    lage.s.meldeGeraetAn(BERNDS_ZWEITES, zweitesGeraet, BERND)

    const { code } = await lage.bernd.kopplung.erzeugeCode(BERNDS_ZWEITES, 'device')
    const anfrage = await loeseKopplungscodeEin(lage.bernd.kopplung, code)

    const faelle = await ladeFaelle(
      lage.bernd.faelle,
      lage.bernd.wraps,
      lage.bernd.geraete,
      lage.berndsIdentitaet,
      BERNDS_GERAET,
    )

    expect(
      await schalteGeraetFrei(
        lage.bernd.kopplung,
        lage.bernd.tresor,
        lage.bernd.persoenlich,
        anfrage,
        faelle,
        lage.berndsIdentitaet,
        BERNDS_GERAET,
        BERND,
      ),
    ).toEqual({ freigeschaltet: 2, gesamt: 2 })

    // Und das Neugerät liest beide Fälle wirklich, nicht bloß der Zahl nach.
    const aufDemNeugeraet = await ladeFaelle(
      lage.bernd.faelle,
      lage.bernd.wraps,
      lage.bernd.geraete,
      zweitesGeraet,
      BERNDS_ZWEITES,
    )

    expect(aufDemNeugeraet.map((fall) => fall.zustand)).toEqual(['lesbar', 'lesbar'])
    expect(aufDemNeugeraet.map((fall) => fall.id).sort()).toEqual(
      [lage.fall.id, zweiterFall.id].sort(),
    )
  })

  /*
   * §3.5, "Versiegeln", Schritt 2: `K_v` an die *eigenen Geräte*. Ohne diesen
   * Schritt liest das zweite Gerät den Fall zwar, den Tresor aber nicht: Es
   * hielte sich für ein Gerät eines Angehörigen, zeigte keine Inhalte an und
   * könnte keinen Re-Split fahren.
   */
  it('reicht K_v an das zweite Gerät des Preparers weiter', async () => {
    const lage = await ausgangslage()

    const vorsorge = await legeVorsorgefallAn(
      lage.bernd.faelle,
      lage.berndsIdentitaet,
      BERNDS_GERAET,
      { personName: 'Bernd Weber' },
    )

    const zweitesGeraet = identitaet()
    lage.s.meldeGeraetAn(BERNDS_ZWEITES, zweitesGeraet, BERND)

    const { code } = await lage.bernd.kopplung.erzeugeCode(BERNDS_ZWEITES, 'device')
    const anfrage = await loeseKopplungscodeEin(lage.bernd.kopplung, code)

    const faelle = await ladeFaelle(
      lage.bernd.faelle,
      lage.bernd.wraps,
      lage.bernd.geraete,
      lage.berndsIdentitaet,
      BERNDS_GERAET,
      lage.bernd.tresor,
    )

    await schalteGeraetFrei(
      lage.bernd.kopplung,
      lage.bernd.tresor,
      lage.bernd.persoenlich,
      anfrage,
      faelle,
      lage.berndsIdentitaet,
      BERNDS_GERAET,
      BERND,
    )

    const aufDemNeugeraet = await ladeFaelle(
      lage.bernd.faelle,
      lage.bernd.wraps,
      lage.bernd.geraete,
      zweitesGeraet,
      BERNDS_ZWEITES,
      lage.bernd.tresor,
    )

    const derVorsorgefall = aufDemNeugeraet.find((fall) => fall.id === vorsorge.id)

    expect(derVorsorgefall?.zustand).toBe('lesbar')
    // Und es ist derselbe K_v, nicht bloß irgendeiner.
    expect(derVorsorgefall?.zustand === 'lesbar' ? derVorsorgefall.kv : null).toEqual(vorsorge.kv)
  })

  it('reicht den persönlichen Schlüssel an das zweite Gerät weiter (§3.7)', async () => {
    /*
     * Ohne diesen Schritt läse das zweite Gerät alles ausser den eigenen
     * privaten Aufgaben: Sie sähen von dort aus aus wie die einer fremden
     * Person und würden still verworfen (§3.7).
     */
    const lage = await ausgangslage()

    const schluessel = await stellePersoenlichenSchluesselBereit(
      lage.bernd.persoenlich,
      lage.bernd.geraete,
      lage.fall.id,
      BERND,
      BERNDS_GERAET,
      lage.berndsIdentitaet,
    )

    const zweitesGeraet = identitaet()
    lage.s.meldeGeraetAn(BERNDS_ZWEITES, zweitesGeraet, BERND)

    const { code } = await lage.bernd.kopplung.erzeugeCode(BERNDS_ZWEITES, 'device')
    const anfrage = await loeseKopplungscodeEin(lage.bernd.kopplung, code)

    const faelle = await ladeFaelle(
      lage.bernd.faelle,
      lage.bernd.wraps,
      lage.bernd.geraete,
      lage.berndsIdentitaet,
      BERNDS_GERAET,
    )

    await schalteGeraetFrei(
      lage.bernd.kopplung,
      lage.bernd.tresor,
      lage.bernd.persoenlich,
      anfrage,
      faelle,
      lage.berndsIdentitaet,
      BERNDS_GERAET,
      BERND,
    )

    const amZweiten = await ladePersoenlichenSchluessel(
      lage.bernd.persoenlich,
      lage.fall.id,
      BERNDS_ZWEITES,
      zweitesGeraet,
    )

    // Derselbe Schlüssel, nicht bloss irgendeiner: Sonst blieben die eigenen
    // privaten Aufgaben auch nach der Kopplung unlesbar.
    expect(amZweiten?.kid).toBe(schluessel.kid)
    expect(amZweiten?.kp).toEqual(schluessel.kp)
  })

  it('lässt einen Trauerfall ohne Tresor unangetastet', async () => {
    const lage = await ausgangslage()

    const zweitesGeraet = identitaet()
    lage.s.meldeGeraetAn(BERNDS_ZWEITES, zweitesGeraet, BERND)

    const { code } = await lage.bernd.kopplung.erzeugeCode(BERNDS_ZWEITES, 'device')
    const anfrage = await loeseKopplungscodeEin(lage.bernd.kopplung, code)

    const faelle = await ladeFaelle(
      lage.bernd.faelle,
      lage.bernd.wraps,
      lage.bernd.geraete,
      lage.berndsIdentitaet,
      BERNDS_GERAET,
    )

    await schalteGeraetFrei(
      lage.bernd.kopplung,
      lage.bernd.tresor,
      lage.bernd.persoenlich,
      anfrage,
      faelle,
      lage.berndsIdentitaet,
      BERNDS_GERAET,
      BERND,
    )

    expect(lage.s.vaultWrapZeilen).toHaveLength(0)
  })

  it('lässt gesperrte Fälle gesperrt und benennt die Zahl', async () => {
    const lage = await ausgangslage()

    /*
     * Ein Fall, den Bernd sieht und nicht lesen kann: Mitgliedschaft ja, Wrap
     * für sein Gerät nein. Genau der Zustand, in dem ein Gerät steckt, das
     * selbst noch auf eine Freigabe wartet (§3.6), und er darf sich nicht
     * stillschweigend weitervererben.
     */
    lage.s.mitglieder.push({ fallId: 'fremder-fall', userId: BERND })
    const dritte = lage.s.alsPerson('user_dritte')
    const fremd = await legeTrauerfallAn(
      dritte.faelle,
      dritte.inhalte,
      identitaet(),
      'c0000000-0000-4000-8000-000000000003',
      { personName: 'Ottilie Weber', sterbedatum: '2026-07-01' },
    )
    lage.s.mitglieder.push({ fallId: fremd.id, userId: BERND })

    const zweitesGeraet = identitaet()
    lage.s.meldeGeraetAn(BERNDS_ZWEITES, zweitesGeraet, BERND)

    const { code } = await lage.bernd.kopplung.erzeugeCode(BERNDS_ZWEITES, 'device')
    const anfrage = await loeseKopplungscodeEin(lage.bernd.kopplung, code)

    const faelle = await ladeFaelle(
      lage.bernd.faelle,
      lage.bernd.wraps,
      lage.bernd.geraete,
      lage.berndsIdentitaet,
      BERNDS_GERAET,
    )

    const freischaltung = await schalteGeraetFrei(
      lage.bernd.kopplung,
      lage.bernd.tresor,
      lage.bernd.persoenlich,
      anfrage,
      faelle,
      lage.berndsIdentitaet,
      BERNDS_GERAET,
      BERND,
    )

    expect(freischaltung).toEqual({ freigeschaltet: 1, gesamt: 2 })
    expect(freischaltungText(freischaltung)).toBe('1 von 2 Fällen freigeschaltet')
  })

  it('gibt nichts frei, wenn dieses Gerät selbst nichts lesen kann', async () => {
    /*
     * Ohne diesen Wurf käme "0 von 0 Fällen freigeschaltet" zurück: Die
     * Kopplung sähe erledigt aus, der Code wäre verbraucht, und das zweite
     * Gerät läse weiterhin nichts. Ein Fehlschlag, der wie ein Erfolg aussieht,
     * ist hier der schlimmste Ausgang.
     */
    const lage = await ausgangslage()
    const zweitesGeraet = identitaet()
    lage.s.meldeGeraetAn(BERNDS_ZWEITES, zweitesGeraet, BERND)

    const { code } = await lage.bernd.kopplung.erzeugeCode(BERNDS_ZWEITES, 'device')
    const anfrage = await loeseKopplungscodeEin(lage.bernd.kopplung, code)

    const nurGesperrt: Fall[] = [{ zustand: 'gesperrt', id: 'fall-x', grund: 'Kein Schlüssel.' }]

    await expect(
      schalteGeraetFrei(
        lage.bernd.kopplung,
        lage.bernd.tresor,
        lage.bernd.persoenlich,
        anfrage,
        nurGesperrt,
        lage.berndsIdentitaet,
        BERNDS_GERAET,
        BERND,
      ),
    ).rejects.toThrow(/keinen Fall lesen/)

    expect(lage.s.wrapZeilen.some((zeile) => zeile.geraeteId === BERNDS_ZWEITES)).toBe(false)
  })

  it('nimmt einen join-Code für eine Gerätefreigabe nicht an', async () => {
    const lage = await ausgangslage()

    const { code } = await lage.anna.kopplung.erzeugeCode(ANNAS_GERAET, 'join')
    const anfrage = await loeseKopplungscodeEin(lage.bernd.kopplung, code)

    await expect(
      schalteGeraetFrei(
        lage.bernd.kopplung,
        lage.bernd.tresor,
        lage.bernd.persoenlich,
        anfrage,
        [],
        lage.berndsIdentitaet,
        BERNDS_GERAET,
        BERND,
      ),
    ).rejects.toThrow(KopplungFehler)
  })
})

describe('Abgewiesene Einlösungen (§6, §4)', () => {
  it('sagt bei jedem Status, was zu tun ist', async () => {
    const lage = await ausgangslage()

    const { code } = await lage.anna.kopplung.erzeugeCode(ANNAS_GERAET, 'join')
    await loeseKopplungscodeEin(lage.bernd.kopplung, code)

    await expect(loeseKopplungscodeEin(lage.bernd.kopplung, code)).rejects.toThrow(
      /bereits eingelöst/,
    )
    await expect(loeseKopplungscodeEin(lage.bernd.kopplung, 'ZZZZZZZZ')).rejects.toThrow(
      /gibt es nicht/,
    )
  })
})

describe('freischaltungText (§4)', () => {
  it('benennt die Zahl, statt sie zu verschweigen', () => {
    expect(freischaltungText({ freigeschaltet: 2, gesamt: 3 })).toBe('2 von 3 Fällen freigeschaltet')
    expect(freischaltungText({ freigeschaltet: 1, gesamt: 1 })).toBe('1 von 1 Fall freigeschaltet')
    expect(freischaltungText({ freigeschaltet: 0, gesamt: 2 })).toBe('0 von 2 Fällen freigeschaltet')
  })
})

describe('Gerätewechsel eines Angehörigen vor dem Öffnen (§3.5, §6)', () => {
  const BERNDS_ZWEITES = 'b0000000-0000-4000-8000-000000000009'

  it('wrappt den eigenen Schlüsselanteil an das neue Gerät, ohne den Preparer', async () => {
    const lage = await ausgangslage()

    // Anna sorgt vor, Bernd ist ihr Angehöriger und hält einen Anteil.
    const vorsorge = await legeVorsorgefallAn(
      lage.anna.faelle,
      lage.annasIdentitaet,
      ANNAS_GERAET,
      { personName: 'Anna Müller' },
    )
    // Bernd tritt dem Vorsorgefall bei, danach liest sein Gerät ihn.
    const { code: beitritt } = await lage.bernd.kopplung.erzeugeCode(BERNDS_GERAET, 'join')
    await fuegeZumFallHinzu(
      lage.anna.kopplung,
      await loeseKopplungscodeEin(lage.anna.kopplung, beitritt),
      vorsorge,
      lage.annasIdentitaet,
      ANNAS_GERAET,
    )

    const kv = vorsorge.kv
    if (kv === null) {
      throw new Error('Der Vorsorgefall hat keinen K_v.')
    }

    const kapselung = kapsele(lage.berndsIdentitaet.pkKem)
    lage.s.vaultShareZeilen.push({
      fallId: vorsorge.id,
      userId: BERND,
      geraeteId: BERNDS_GERAET,
      shareIndex: 1,
      shareHash: await sha256(kv),
      kemCt: kapselung.kemCt,
      wrappedShare: await verschluessele(kapselung.geteiltesGeheimnis, kv),
    })

    // Bernd koppelt ein zweites Gerät. Anna, die vorsorgende Person, ist an
    // diesem Ablauf nicht beteiligt.
    const zweitesGeraet = identitaet()
    lage.s.meldeGeraetAn(BERNDS_ZWEITES, zweitesGeraet, BERND)

    const { code } = await lage.bernd.kopplung.erzeugeCode(BERNDS_ZWEITES, 'device')
    const anfrage = await loeseKopplungscodeEin(lage.bernd.kopplung, code)

    const faelle = await ladeFaelle(
      lage.bernd.faelle,
      lage.bernd.wraps,
      lage.bernd.geraete,
      lage.berndsIdentitaet,
      BERNDS_GERAET,
      lage.bernd.tresor,
    )

    await schalteGeraetFrei(
      lage.bernd.kopplung,
      lage.bernd.tresor,
      lage.bernd.persoenlich,
      anfrage,
      faelle,
      lage.berndsIdentitaet,
      BERNDS_GERAET,
      BERND,
    )

    const neuer = lage.s.vaultShareZeilen.find((zeile) => zeile.geraeteId === BERNDS_ZWEITES)

    expect(neuer).toBeDefined()
    expect(neuer?.userId).toBe(BERND)
    expect(neuer?.shareIndex).toBe(1)

    // Und das neue Gerät liest denselben Anteil: Es kann den Todesfall
    // bestätigen, ohne dass die vorsorgende Person noch einmal verteilt.
    const gelesen = await entpackeEigenenAnteil(
      neuer ?? { ...lage.s.vaultShareZeilen[0]! },
      zweitesGeraet,
    )

    expect(Array.from(gelesen)).toEqual(Array.from(kv))
  })
})
