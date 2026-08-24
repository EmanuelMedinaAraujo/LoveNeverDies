/**
 * Die beiden Seiten der Kopplung (DESIGN.md §6, §3.6).
 *
 * Drei Hooks, weil an einer Kopplung drei Dinge hängen, die zu verschiedenen
 * Zeiten passieren:
 *
 * - `useKopplungscode`: die beitretende Seite: acht Zeichen holen und
 *   zeigen, dazu den eigenen Prüfcode zum Vorlesen.
 * - `useKopplungswache`: dieselbe Seite, während sie wartet: Ist der Fall
 *   schon lesbar? §6 verspricht "innerhalb von Sekunden, ohne Neuladen".
 * - `useEinloesung`: die einladende Seite: Code eingeben, Name und
 *   Prüfcode sehen, nach dem mündlichen Abgleich bestätigen.
 *
 * Warum die Wache pollt und nicht an der Türklingel hängt: Die Klingel aus
 * §5 sitzt auf der `cases`-Zeile eines Falls, in dem man schon ist. Hier wartet
 * jemand darauf, überhaupt in einen Fall zu kommen (`memberships`) oder einen
 * `key_wraps`-Eintrag zu bekommen. Beides hebt `cases.version` nicht, und die
 * beitretende Seite darf die Zeile vorher nicht einmal abonnieren. Ein Poll
 * alle drei Sekunden ist deshalb nicht der billigere Weg, sondern der einzige.
 * Er läuft ausschließlich, solange der Wartescreen offen ist.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Geraeteidentitaet } from '../core/crypto/keystore.ts'
import type { Kopplungscode, Kopplungszweck } from '../core/db/kopplung.ts'
import { supabaseFaelle } from '../core/db/supabaseFaelle.ts'
import { supabaseFallschluessel } from '../core/db/supabaseFallschluessel.ts'
import { supabaseGeraeteschluessel } from '../core/db/supabaseGeraeteschluessel.ts'
import { supabaseKopplung } from '../core/db/supabaseKopplung.ts'
import { useSupabase } from '../core/db/supabaseProvider.tsx'
import { alsNachricht } from '../core/fehler.ts'
import { ladeFaelle, type Fall, type LesbarerFall } from '../services/fallService.ts'
import {
  erzeugeKopplungscode,
  freischaltungText,
  fuegeZumFallHinzu,
  KopplungFehler,
  loeseKopplungscodeEin,
  schalteGeraetFrei,
  type Kopplungsanfrage,
} from '../services/kopplungService.ts'
import { useCase } from './useCase.ts'
import { useGeraeteanmeldung } from './useGeraete.ts'
import { useProfilAbgleich } from './useProfil.ts'

type Ergebnis<T> = { wert: T } | { nachricht: string }

/** §6: "schaltet innerhalb von Sekunden frei". */
export const WACHE_ABSTAND_MS = 3_000

export type KopplungscodeZustand =
  | { status: 'laedt' }
  | { status: 'bereit'; code: string; laeuftAbAm: string; pruefcode: string }
  | { status: 'fehler'; nachricht: string }

export type Kopplungscodedaten = {
  zustand: KopplungscodeZustand
  /** Nach Ablauf oder Fehlgriff: einen frischen Code holen. */
  neuAnfordern: () => void
}

/**
 * Holt einen Kopplungscode für dieses Gerät (§6, Schritt 1 und 2).
 *
 * Der Prüfcode daneben kommt aus der lokalen Identität und nicht aus der
 * Zeile, die der Server zurückgibt: Verglichen wird, was dieses Gerät wirklich
 * besitzt, gegen das, was beim Gegenüber ankommt. Käme er vom Server, verglichen
 * beide Seiten dieselbe Serverangabe miteinander, und der Abgleich prüfte
 * nichts mehr (§3.6).
 *
 * Erst das Profil, dann der Code: `erzeuge_kopplungscode` weist einen Aufruf
 * ohne Zeile in `profiles` ab, und zwar mit Absicht: §6 zeigt der einladenden
 * Person einen echten Namen, bevor sie das Familiengeheimnis weitergibt. Dieser
 * Hook wartet deshalb auf den Abgleich, statt in einen Fehler zu laufen, den
 * niemand einordnen kann. `neuAnfordern` stößt beides gemeinsam an.
 */
export function useKopplungscode(zweck: Kopplungszweck): Kopplungscodedaten {
  const anmeldung = useGeraeteanmeldung()
  const { zustand: profil, nochmal: profilNochmal } = useProfilAbgleich()
  const zugang = useSupabase()

  /*
   * Im State steht ausschließlich das Ergebnis der asynchronen Arbeit, nicht
   * der Ladezustand, dasselbe Muster wie in `useGeraete.ts`. Was sich aus dem
   * Anmeldezustand ergibt, entsteht beim Rendern; ein Effekt, der synchron
   * `setState` ruft, erzeugte eine zweite Renderrunde für etwas, das schon
   * feststand.
   */
  const [ergebnis, setzeErgebnis] = useState<Ergebnis<Kopplungscode> | null>(null)
  const [runde, setzeRunde] = useState(0)

  const identitaet = anmeldung.status === 'bereit' ? anmeldung.identitaet : null
  const geraetId = anmeldung.status === 'bereit' ? anmeldung.geraet.id : null
  const anmeldungFehler = anmeldung.status === 'fehler' ? anmeldung.nachricht : null

  const profilBereit = profil.status === 'bereit'
  const profilFehler = profil.status === 'fehler' ? profil.nachricht : null

  useEffect(() => {
    if (identitaet === null || geraetId === null || !profilBereit) {
      return
    }

    let aktuell = true

    void (async () => {
      try {
        const code = await erzeugeKopplungscode(supabaseKopplung(zugang()), geraetId, zweck)

        if (aktuell) {
          setzeErgebnis({ wert: code })
        }
      } catch (fehler) {
        if (aktuell) {
          setzeErgebnis({ nachricht: alsNachricht(fehler) })
        }
      }
    })()

    return () => {
      aktuell = false
    }
  }, [geraetId, identitaet, profilBereit, runde, zugang, zweck])

  const neuAnfordern = useCallback(() => {
    // Erst das alte Ergebnis fort, dann die neue Runde: Sonst stünde der
    // abgelaufene Code noch da, während der frische unterwegs ist, und jemand
    // liest ihn in der Zwischenzeit vor.
    setzeErgebnis(null)
    profilNochmal()
    setzeRunde((vorher) => vorher + 1)
  }, [profilNochmal])

  const zustand = useMemo<KopplungscodeZustand>(() => {
    if (anmeldungFehler !== null) {
      return { status: 'fehler', nachricht: anmeldungFehler }
    }

    if (profilFehler !== null) {
      return {
        status: 'fehler',
        nachricht: `Ihr Name war nicht zu hinterlegen, und ohne ihn gibt es keinen Kopplungscode. ${profilFehler}`,
      }
    }

    if (identitaet === null || ergebnis === null) {
      return { status: 'laedt' }
    }

    if ('nachricht' in ergebnis) {
      return { status: 'fehler', nachricht: ergebnis.nachricht }
    }

    return {
      status: 'bereit',
      code: ergebnis.wert.code,
      laeuftAbAm: ergebnis.wert.laeuftAbAm,
      pruefcode: identitaet.pruefcode,
    }
  }, [anmeldungFehler, ergebnis, identitaet, profilFehler])

  return useMemo(() => ({ zustand, neuAnfordern }), [neuAnfordern, zustand])
}

export type WacheZustand =
  | { status: 'laedt' }
  | { status: 'wartet' }
  | { status: 'freigeschaltet'; lesbar: number }
  | { status: 'fehler'; nachricht: string }

/**
 * Wartet darauf, dass die andere Seite bestätigt (§6, Schritt 7).
 *
 * "Freigeschaltet" heißt: mehr lesbare Fälle als beim Öffnen dieses
 * Screens. Nicht "mindestens einer": Ein zweites Gerät kann zwei von drei
 * Fällen längst lesen und auf den dritten warten, und dann wäre die Wache von
 * Anfang an fertig, ohne dass etwas geschehen ist.
 */
export function useKopplungswache(aktiv: boolean): WacheZustand {
  const anmeldung = useGeraeteanmeldung()
  const zugang = useSupabase()

  const [zustand, setzeZustand] = useState<WacheZustand>({ status: 'laedt' })

  // Die Ausgangszahl steht in einer Ref und nicht im State: Sie wird beim
  // ersten Durchlauf gesetzt und danach nur noch gelesen. Ein `setState`
  // darauf löste eine Renderrunde für etwas aus, das niemand anzeigt.
  const ausgangszahl = useRef<number | null>(null)

  const identitaet = anmeldung.status === 'bereit' ? anmeldung.identitaet : null
  const geraetId = anmeldung.status === 'bereit' ? anmeldung.geraet.id : null
  const anmeldungFehler = anmeldung.status === 'fehler' ? anmeldung.nachricht : null

  useEffect(() => {
    if (!aktiv || identitaet === null || geraetId === null) {
      return
    }

    let abgeraeumt = false
    let fertig = false
    let takt: ReturnType<typeof setInterval> | null = null

    async function sieheNach(eigene: Geraeteidentitaet, geraet: string) {
      try {
        const client = zugang()
        const faelle = await ladeFaelle(
          supabaseFaelle(client),
          supabaseFallschluessel(client),
          supabaseGeraeteschluessel(client),
          eigene,
          geraet,
        )

        /*
         * `fertig` neben `abgeraeumt`: Ein langsamer Abruf kann nach einem
         * schnelleren zurückkommen, der längst freigegeben hat. Ohne diese
         * Sperre schriebe er "wartet" darüber, und weil der Takt dann schon
         * abgeräumt ist, sähe niemand je wieder nach. Der Screen bliebe auf
         * "Warten auf die Bestätigung…" stehen, obwohl er offen ist.
         */
        if (abgeraeumt || fertig) {
          return
        }

        const lesbar = faelle.filter((fall) => fall.zustand === 'lesbar').length

        if (ausgangszahl.current === null) {
          ausgangszahl.current = lesbar
        }

        if (lesbar > ausgangszahl.current) {
          fertig = true
          setzeZustand({ status: 'freigeschaltet', lesbar })

          // Fertig heißt fertig: Ein Takt, der weiterliefe, hielte die
          // Verbindung offen, nachdem der Screen seine Antwort hat.
          if (takt !== null) {
            clearInterval(takt)
            takt = null
          }

          return
        }

        setzeZustand({ status: 'wartet' })
      } catch (fehler) {
        if (!abgeraeumt && !fertig) {
          setzeZustand({ status: 'fehler', nachricht: alsNachricht(fehler) })
        }
      }
    }

    void sieheNach(identitaet, geraetId)
    takt = setInterval(() => void sieheNach(identitaet, geraetId), WACHE_ABSTAND_MS)

    return () => {
      abgeraeumt = true

      if (takt !== null) {
        clearInterval(takt)
      }
    }
  }, [aktiv, geraetId, identitaet, zugang])

  if (anmeldungFehler !== null) {
    return { status: 'fehler', nachricht: anmeldungFehler }
  }

  return zustand
}

export type EinloesungZustand =
  | { status: 'leer'; fehler: string | null }
  | { status: 'angebot'; anfrage: Kopplungsanfrage; fehler: string | null }
  | { status: 'fertig'; nachricht: string }

export type Einloesungsdaten = {
  zustand: EinloesungZustand
  /** Ein Aufruf ist unterwegs. Getrennt vom Zustand, damit das Angebot stehen bleibt. */
  laeuft: boolean
  /** Die Fallliste ist geladen. Vorher lässt sich nicht bestätigen. */
  faelleBereit: boolean
  /** Die Fälle, unter denen die einladende Person wählen kann (nur `join`). */
  lesbareFaelle: LesbarerFall[]
  einloesen: (eingabe: string) => Promise<void>
  /** @param fallId nur bei `join` gebraucht; ohne Angabe der erste lesbare Fall. */
  bestaetigen: (fallId?: string) => Promise<void>
  abbrechen: () => void
}

function lesbare(faelle: Fall[]): LesbarerFall[] {
  return faelle.filter((fall): fall is LesbarerFall => fall.zustand === 'lesbar')
}

/**
 * Die einladende Seite: Code eingeben, prüfen, bestätigen (§6, Schritt 4 bis 6).
 *
 * Zwischen `einloesen` und `bestaetigen` liegt der mündliche Abgleich. Dass es
 * zwei Aufrufe sind, ist deshalb keine Umständlichkeit der Oberfläche, sondern
 * die einzige Stelle, an der der Schlüsseltausch durch einen bösartigen Server
 * auffällt (§3.6).
 *
 * Ein gescheitertes Bestätigen wirft das Angebot nicht weg: Der Code ist zu
 * diesem Zeitpunkt eingelöst und damit verbraucht; wer zurück ins Eingabefeld
 * fiele, bekäme ihn nur noch als "bereits eingelöst" zurück, obwohl
 * `schliesse_kopplung_ab` ihn weiterhin annähme. Die Meldung steht deshalb
 * neben dem Angebot, und der Knopf bleibt da, wo er war.
 */
export function useEinloesung(): Einloesungsdaten {
  const anmeldung = useGeraeteanmeldung()
  const { zustand: fallZustand } = useCase()
  const zugang = useSupabase()

  const [zustand, setzeZustand] = useState<EinloesungZustand>({ status: 'leer', fehler: null })
  const [laeuft, setzeLaeuft] = useState(false)

  const identitaet = anmeldung.status === 'bereit' ? anmeldung.identitaet : null
  const geraetId = anmeldung.status === 'bereit' ? anmeldung.geraet.id : null

  /*
   * "Kein Fall" ist ein fertiges Ergebnis und kein halbes: Die Liste ist
   * geladen und leer. Nur `laedt` heißt, dass noch etwas kommen kann.
   * Genau dann darf niemand bestätigen, sonst verbrennt ein Code an einer
   * Liste, die es noch gar nicht gibt.
   */
  const faelleBereit = fallZustand.status === 'bereit' || fallZustand.status === 'kein-fall'

  const faelle = useMemo(
    () => (fallZustand.status === 'bereit' ? fallZustand.faelle : []),
    [fallZustand],
  )
  const lesbareFaelle = useMemo(() => lesbare(faelle), [faelle])

  const einloesen = useCallback(
    async (eingabe: string) => {
      setzeLaeuft(true)

      try {
        const anfrage = await loeseKopplungscodeEin(supabaseKopplung(zugang()), eingabe)
        setzeZustand({ status: 'angebot', anfrage, fehler: null })
      } catch (fehler) {
        setzeZustand({ status: 'leer', fehler: alsNachricht(fehler) })
      } finally {
        setzeLaeuft(false)
      }
    },
    [zugang],
  )

  const bestaetigen = useCallback(
    async (fallId?: string) => {
      if (zustand.status !== 'angebot' || laeuft) {
        return
      }

      const { anfrage } = zustand

      if (identitaet === null || geraetId === null || !faelleBereit) {
        setzeZustand({
          status: 'angebot',
          anfrage,
          fehler: 'Ihre Fälle sind noch nicht geladen. Bitte versuchen Sie es gleich noch einmal.',
        })
        return
      }

      setzeLaeuft(true)

      try {
        const kopplung = supabaseKopplung(zugang())

        if (anfrage.angebot.zweck === 'device') {
          const freischaltung = await schalteGeraetFrei(
            kopplung,
            anfrage,
            faelle,
            identitaet,
            geraetId,
          )

          setzeZustand({ status: 'fertig', nachricht: freischaltungText(freischaltung) })
          return
        }

        const fall = fallId === undefined ? lesbareFaelle[0] : lesbareFaelle.find((f) => f.id === fallId)

        if (fall === undefined) {
          throw new KopplungFehler(
            'Dieser Fall lässt sich von diesem Gerät aus nicht weitergeben. Sie können nur teilen, was Sie selbst lesen können.',
          )
        }

        await fuegeZumFallHinzu(kopplung, anfrage, fall, identitaet, geraetId)

        setzeZustand({
          status: 'fertig',
          nachricht: `${anfrage.angebot.anzeigename} gehört jetzt zum Fall ${fall.personName}.`,
        })
      } catch (fehler) {
        setzeZustand({ status: 'angebot', anfrage, fehler: alsNachricht(fehler) })
      } finally {
        setzeLaeuft(false)
      }
    },
    [faelle, faelleBereit, geraetId, identitaet, laeuft, lesbareFaelle, zugang, zustand],
  )

  const abbrechen = useCallback(() => setzeZustand({ status: 'leer', fehler: null }), [])

  return useMemo(
    () => ({ zustand, laeuft, faelleBereit, lesbareFaelle, einloesen, bestaetigen, abbrechen }),
    [abbrechen, bestaetigen, einloesen, faelleBereit, laeuft, lesbareFaelle, zustand],
  )
}
