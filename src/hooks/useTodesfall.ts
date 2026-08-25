/**
 * Den Todesfall bestätigen und den Tresor öffnen (DESIGN.md §3.5, §5, §8).
 *
 * Der Tab Erbe zeigt darüber den Freigabestand eines Vorsorgefalls, nimmt die
 * Bestätigung entgegen und vollzieht den Übergang, sobald `K_v` wirklich
 * rekonstruiert werden konnte.
 *
 * Zwei Dinge unterscheiden diesen Hook von allem anderen in dieser App:
 *
 * Er geht nicht durch die Offline-Queue (§5). Freigabe und `open_vault`
 * erfordern eine Verbindung. Eine versehentlich abgeschickte Todesbestätigung
 * nimmt niemand zurück; eine Fehlermeldung im Moment des Tippens ist das
 * kleinere Übel. Deshalb steht die Prüfung auf eine Verbindung hier ganz vorn
 * und nicht im Fehlerpfad.
 *
 * Er entscheidet nicht am Zähler. Der Zähler zeigt an, mehr nicht (§3.5).
 * Ob der Übergang stattfindet, entscheidet der Nachweis über `K_v`, und der
 * entsteht erst beim Zusammensetzen.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Geraeteidentitaet } from '../core/crypto/keystore.ts'
import { signaturSchluesselAusBytes } from '../core/crypto/sign.ts'
import { entpackeSchluessel } from '../core/crypto/wrap.ts'
import { supabaseFallschluessel } from '../core/db/supabaseFallschluessel.ts'
import { supabaseGeraeteschluessel } from '../core/db/supabaseGeraeteschluessel.ts'
import { supabaseInhalte } from '../core/db/supabaseInhalte.ts'
import { supabaseProfil } from '../core/db/supabaseProfil.ts'
import { useSupabase } from '../core/db/supabaseProvider.tsx'
import { freigabeklingel } from '../core/sync/realtime.ts'
import { supabaseTresor } from '../core/db/supabaseTresor.ts'
import { alsNachricht } from '../core/fehler.ts'
import { useAuth } from '../core/auth/authProvider.ts'
import type { LesbarerFall } from '../services/fallService.ts'
import { ausgelieferterKatalogstand, instanziiereKatalog } from '../services/katalogService.ts'
import {
  erstelleFreigabe,
  fallPayloadMitSterbedatum,
  rekonstruiereTresorschluessel,
  umzuwrappendeTresorItems,
  TodesfallFehler,
  TresorOeffnenFehler,
} from '../services/todesfallService.ts'
import { useGeraeteanmeldung } from './useGeraete.ts'

/** Eine Freigabe, wie der Tab Erbe sie zeigt. */
export type Freigabeanzeige = {
  userId: string
  /** Der Anzeigename, oder die Kennung, wenn `profiles` nichts hergibt. */
  name: string
  freigegebenAm: string
  /** Ob das die eigene Freigabe ist. */
  eigene: boolean
}

export type Todesfalldaten = {
  freigaben: Freigabeanzeige[]
  /** Wie viele Freigaben nötig sind. `null`, solange niemand verteilt hat. */
  k: number | null
  /** Ob dieses Gerät einen Schlüsselanteil hält und damit freigeben kann. */
  kannFreigeben: boolean
  /** Ob die eigene Freigabe schon steht. */
  eigeneFreigabe: boolean
  /** Ob der Zähler `k` erreicht hat. Das öffnet nichts, es zeigt nur an (§3.5). */
  schwelleErreicht: boolean
  laedt: boolean
  laeuft: boolean
  fehler: string | null
  /**
   * Die Namen der Personen, deren Freigabe unbrauchbar war (§3.5).
   *
   * Sie stehen hier, damit die App sie beim Namen nennen und um eine erneute
   * Freigabe bitten kann, statt nur "geht nicht" zu melden.
   */
  unbrauchbare: string[]
  bestaetigeTodesfall: () => Promise<void>
  oeffneTresor: (sterbedatum: string) => Promise<void>
  aktualisiere: () => void
}

const KEINE: Freigabeanzeige[] = []
const KEINE_NAMEN: string[] = []

/** §5: Freigabe und `open_vault` gehen nicht in die Queue. */
function pruefeVerbindung(): void {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    throw new TodesfallFehler(
      'Dieser Schritt braucht eine Verbindung. Er wird nicht zwischengespeichert und nicht später wiederholt.',
    )
  }
}

export function useTodesfall(fall: LesbarerFall, aktualisiereFall: () => void): Todesfalldaten {
  const zugang = useSupabase()
  const anmeldung = useGeraeteanmeldung()
  const { zustand: authZustand } = useAuth()

  const identitaet: Geraeteidentitaet | null =
    anmeldung.status === 'bereit' ? anmeldung.identitaet : null
  const geraeteId = anmeldung.status === 'bereit' ? anmeldung.geraet.id : null
  const userId = authZustand.status === 'angemeldet' ? authZustand.benutzer.id : null

  /**
   * Der geladene Stand, oder `null`, solange keiner da ist.
   *
   * Ein Zustand statt dreier, und `laedt` daraus abgeleitet statt daneben
   * gesetzt: Ein `setzeLaedt(false)` im Rumpf des Effekts wäre ein zweites
   * Rendern für eine Feststellung, die aus dem vorhandenen Zustand ohnehin
   * folgt.
   */
  const [stand, setzeStand] = useState<{
    freigaben: Freigabeanzeige[]
    eigenerShare: boolean
  } | null>(null)
  const [laeuft, setzeLaeuft] = useState(false)
  const [fehler, setzeFehler] = useState<string | null>(null)
  const [unbrauchbare, setzeUnbrauchbare] = useState<string[]>(KEINE_NAMEN)
  const [runde, setzeRunde] = useState(0)

  const montiert = useRef(true)

  useEffect(() => {
    montiert.current = true

    return () => {
      montiert.current = false
    }
  }, [])

  const aktualisiere = useCallback(() => setzeRunde((vorher) => vorher + 1), [])


  // Der Freigabestand. Er hängt nicht am Delta: `vault_releases` und
  // `vault_shares` stehen neben `items` und kommen nicht mit dem Sync-Stream
  // (§5, `useTresor.ts`).
  const abfragbar = fall.status === 'vorsorge' && geraeteId !== null && userId !== null

  useEffect(() => {
    if (!abfragbar) {
      return
    }

    let aktuell = true

    void (async () => {
      try {
        const client = zugang()
        const tresor = supabaseTresor(client)
        const [zeilenFreigaben, shares] = await Promise.all([
          tresor.freigabenFuerFall(fall.id),
          tresor.sharesFuerFall(fall.id),
        ])

        const namen = await supabaseProfil(client)
          .namen(zeilenFreigaben.map((zeile) => zeile.userId))
          .catch(() => new Map<string, string>())

        if (!aktuell) {
          return
        }

        // Auch den Fehler zurücksetzen: Eine Runde, die durchkam, hebt die
        // Meldung der Runde davor auf. Sonst bliebe die Warnung eines kurzen
        // Netzausfalls für den Rest der Sitzung stehen.
        setzeFehler(null)
        setzeStand({
          freigaben:
            zeilenFreigaben.length === 0
              ? KEINE
              : zeilenFreigaben.map((zeile) => ({
                  userId: zeile.userId,
                  name: namen.get(zeile.userId) ?? zeile.userId,
                  freigegebenAm: zeile.freigegebenAm,
                  eigene: zeile.userId === userId,
                })),
          eigenerShare: shares.some((share) => share.geraeteId === geraeteId),
        })
      } catch (ursache) {
        if (aktuell) {
          setzeFehler(alsNachricht(ursache))
          setzeStand({ freigaben: KEINE, eigenerShare: false })
        }
      }
    })()

    return () => {
      aktuell = false
    }
  }, [abfragbar, fall.id, geraeteId, runde, userId, zugang])

  /*
   * §3.5: Bestätigt eine andere Person auf ihrem Telefon, soll der Zähler hier
   * nachziehen — ohne dass jemand den Tab verlässt und zurückkommt.
   *
   * Eine eigene Klingel und nicht die aus `useCase`: Eine Freigabe schreibt
   * `vault_releases`, und das hebt `cases.version` nicht. Der Delta-Sync und
   * mit ihm die Türklingel bekommen davon nichts mit (§5). Der Fallback ist
   * derselbe wie dort: Fokus und alle 30 Sekunden, aber nur, wenn die
   * Subscription nicht trägt.
   *
   * Nur im Vorsorgefall. Danach gibt es keine Freigaben mehr entgegenzunehmen,
   * und ein offener Kanal hörte für den Rest der Sitzung auf eine Tabelle, in
   * die niemand mehr schreibt.
   */
  useEffect(() => {
    if (!abfragbar) {
      return
    }

    return freigabeklingel(zugang(), fall.id, aktualisiere)
  }, [abfragbar, aktualisiere, fall.id, zugang])

  const bestaetigeTodesfall = useCallback(async () => {
    setzeLaeuft(true)
    setzeFehler(null)

    /*
     * Auch die Vorprüfungen stehen im `try`: Ein Wurf davor käme nie bei
     * `setzeFehler` an, und der Screen fängt die Ausnahme ab, weil die Meldung
     * aus dem Zustand kommt. Offline zu sein sähe dann aus wie eine
     * Schaltfläche, die nichts tut, genau der stille Fehlschlag, den §5 hier
     * ausschliesst.
     */
    try {
      if (identitaet === null || geraeteId === null || userId === null) {
        throw new TodesfallFehler('Ohne angemeldetes Gerät lässt sich nichts freigeben.')
      }

      pruefeVerbindung()

      const tresor = supabaseTresor(zugang())
      const shares = await tresor.sharesFuerFall(fall.id)
      const eigener = shares.find((share) => share.geraeteId === geraeteId)

      if (eigener === undefined) {
        throw new TodesfallFehler(
          'Für dieses Gerät liegt kein Schlüsselanteil vor. Bitten Sie die vorsorgende Person, die Anteile neu zu verteilen.',
        )
      }

      // Die Hash-Prüfung steckt in `erstelleFreigabe` und läuft vor allem
      // anderen: Ein kaputter Wrap fällt auf, bevor irgendetwas hochgeht.
      await tresor.sendeFreigabe(
        await erstelleFreigabe(fall, identitaet, geraeteId, userId, eigener),
      )

      aktualisiere()
    } catch (ursache) {
      if (montiert.current) {
        setzeFehler(alsNachricht(ursache))
      }

      throw ursache
    } finally {
      if (montiert.current) {
        setzeLaeuft(false)
      }
    }
  }, [aktualisiere, fall, geraeteId, identitaet, userId, zugang])

  const oeffneTresor = useCallback(
    async (sterbedatum: string) => {
      setzeLaeuft(true)
      setzeFehler(null)
      setzeUnbrauchbare(KEINE_NAMEN)

      try {
        if (identitaet === null || geraeteId === null) {
          throw new TodesfallFehler('Ohne angemeldetes Gerät lässt sich der Tresor nicht öffnen.')
        }

        if (fall.vaultCommitment === null) {
          throw new TodesfallFehler('Dieser Fall hat keinen versiegelten Tresor.')
        }

        pruefeVerbindung()

        /*
         * Zuerst das Datum, dann das Netz: Ein Tippfehler im Sterbedatum soll
         * auffallen, bevor irgendeine Freigabe entschlüsselt wird, und nicht
         * erst, wenn `K_v` schon im Speicher liegt.
         */
        const payload = await fallPayloadMitSterbedatum(fall.kc, fall.personName, sterbedatum)

        const client = zugang()
        const tresor = supabaseTresor(client)
        const inhalte = supabaseInhalte(client)

        const [zeilenFreigaben, shares, bestand] = await Promise.all([
          tresor.freigabenFuerFall(fall.id),
          tresor.sharesFuerFall(fall.id),
          /*
           * Der volle Bestand, frisch und nicht aus dem Sync-Stream: Ein
           * Delta, das gerade erst begonnen hat, kennt womöglich nicht alle
           * Tresor-Items. Was hier nicht umgewrappt wird, liegt danach
           * unter einem `K_v`, den niemand mehr hat. `seq > 0` ist die
           * vollständige Resynchronisation aus §5 und kein Sonderweg; sie
           * läuft genau einmal, beim Übergang.
           */
          inhalte.seit(fall.id, 0),
        ])

        const shareHashes = new Map(shares.map((share) => [share.userId, share.shareHash]))

        const rekonstruktion = await rekonstruiereTresorschluessel({
          freigaben: zeilenFreigaben,
          shareHashes,
          k: fall.vaultK ?? 1,
          commitment: fall.vaultCommitment,
          fallschluessel: fallschluesselLeser(client, fall, identitaet, geraeteId),
        })

        /*
         * Die Tresor-DEKs wechseln vor dem Statuswechsel von `K_v` auf
         * `K_c`, und das ist die eine Stelle, an der die Reihenfolge aus §3.5
         * bewusst umgedreht ist.
         *
         * Der Grund ist die Unumkehrbarkeit: `open_vault` ist der einzige
         * Schritt, den niemand zurücknimmt. Bricht danach die Verbindung ab,
         * bevor alle DEKs umgewrappt sind, liegen die übrigen für immer unter
         * einem `K_v`, den nur noch dieser eine Aufruf im Speicher hatte.
         * Die vorsorgende Person ist tot, `vault_key_wraps` gehört ihren
         * Geräten. Vorher gescheitert heisst dagegen: Der Fall steht
         * unverändert in der Vorsorge, die Freigaben stehen noch, und der
         * nächste Versuch setzt `K_v` erneut zusammen und macht weiter.
         *
         * Was in diesem Fenster sichtbar wird, war ohnehin verloren: Wer hier
         * steht, hat `K_v` rekonstruiert und liest jeden Tresor-Eintrag im
         * Klartext. Ein Tresor, den niemand mehr öffnen kann, wäre der
         * schwerere Schaden.
         */
        const umwraps = await umzuwrappendeTresorItems(
          bestand,
          rekonstruktion.kv,
          fall.kc,
          fall.kid,
        )

        for (const umwrap of umwraps) {
          await inhalte.umwrappe(umwrap.itemId, umwrap.kid, umwrap.wrappedDek)
        }

        const gueltigeVersion = await tresor.oeffneTresor(
          fall.id,
          rekonstruktion.proof,
          ausgelieferterKatalogstand(),
          payload,
        )

        /*
         * Instanziiert wird aus der zurückgegebenen Version, nicht aus der
         * eigenen (§3.5). Kennt dieser Client sie nicht, instanziiert er nicht
         * und überlässt das dem anderen: Zwei Kataloge in einem Fall wären
         * zwei Herkünfte für dieselben Aufgaben.
         */
        if (gueltigeVersion === ausgelieferterKatalogstand()) {
          await instanziiereKatalog(
            inhalte,
            { ...fall, katalogVersion: gueltigeVersion },
            bestand.map((zeile) => zeile.id),
          )
        }

        /*
         * Wessen Anteil unbrauchbar war, steht hier bewusst nicht mehr: Der
         * Tresor ist offen, eine zweite Freigabe hilft niemandem mehr, und
         * eine Aufforderung dazu wäre eine Bitte um eine Handlung ohne Wirkung.
         * Benannt wird nur, wer den Übergang aufhält (§3.5).
         */
        aktualisiereFall()
        aktualisiere()
      } catch (ursache) {
        if (montiert.current) {
          setzeFehler(alsNachricht(ursache))

          if (ursache instanceof TresorOeffnenFehler) {
            setzeUnbrauchbare(await benenne(zugang(), ursache.fehlerhafte))
          }
        }

        throw ursache
      } finally {
        if (montiert.current) {
          setzeLaeuft(false)
        }
      }
    },
    [aktualisiere, aktualisiereFall, fall, geraeteId, identitaet, zugang],
  )

  const freigaben = stand?.freigaben ?? KEINE
  const eigeneFreigabe = freigaben.some((freigabe) => freigabe.eigene)
  const k = fall.vaultK

  return useMemo(
    () => ({
      freigaben,
      k,
      kannFreigeben: stand?.eigenerShare === true,
      eigeneFreigabe,
      schwelleErreicht: k !== null && freigaben.length >= k,
      laedt: abfragbar && stand === null,
      laeuft,
      fehler,
      unbrauchbare,
      bestaetigeTodesfall,
      oeffneTresor,
      aktualisiere,
    }),
    [
      abfragbar,
      aktualisiere,
      bestaetigeTodesfall,
      eigeneFreigabe,
      fehler,
      freigaben,
      k,
      laeuft,
      oeffneTresor,
      stand,
      unbrauchbare,
    ],
  )
}

/** Kennungen zu Namen, so weit `profiles` sie hergibt. */
async function benenne(
  client: ReturnType<ReturnType<typeof useSupabase>>,
  userIds: string[],
): Promise<string[]> {
  const namen = await supabaseProfil(client)
    .namen(userIds)
    .catch(() => new Map<string, string>())

  return userIds.map((userId) => namen.get(userId) ?? userId)
}

/**
 * Der `K_c` einer Generation, oder `null` (§3.4, §3.5).
 *
 * Die laufende Generation steht auf dem Fall. Jede ältere muss aus
 * `key_wraps` kommen: Zwischen Freigabe und Öffnen kann ein Mitglied
 * austreten und `K_c` rotieren, und eine Freigabe von vorher liegt dann unter
 * einem Schlüssel, den dieses Gerät nur noch gewrappt hat. Geprüft wird dabei
 * die Signatur des wrappenden Geräts wie bei jedem anderen Wrap (§3.6).
 */
function fallschluesselLeser(
  client: ReturnType<ReturnType<typeof useSupabase>>,
  fall: LesbarerFall,
  identitaet: Geraeteidentitaet,
  geraeteId: string,
): (kid: string) => Promise<Uint8Array | null> {
  const bekannt = new Map<string, Uint8Array | null>([[fall.kid, fall.kc]])

  return async (kid) => {
    const gemerkt = bekannt.get(kid)

    if (gemerkt !== undefined) {
      return gemerkt
    }

    let schluessel: Uint8Array | null = null

    try {
      const wraps = await supabaseFallschluessel(client).fuerGeraet(fall.id, geraeteId)
      const wrap = wraps.find((zeile) => zeile.kid === kid)

      if (wrap !== undefined) {
        const absender = await supabaseGeraeteschluessel(client).nachId(wrap.wrappedBy)

        if (absender !== null) {
          schluessel = await entpackeSchluessel(
            wrap,
            { fallId: fall.id, kid, geraeteId },
            identitaet.kem.geheim,
            signaturSchluesselAusBytes(absender.pkSig),
          )
        }
      }
    } catch {
      // Ein Wrap, der nicht aufgeht, ist von hier aus dasselbe wie keiner: Die
      // Freigabe dieser Generation ist für dieses Gerät unbrauchbar, und die
      // Person dahinter wird benannt.
      schluessel = null
    }

    bekannt.set(kid, schluessel)

    return schluessel
  }
}
