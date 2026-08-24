/**
 * Die beiden Seiten der Kopplung (DESIGN.md §6, §3.6).
 *
 * Drei Hooks, weil an einer Kopplung drei Dinge hängen, die zu verschiedenen
 * Zeiten passieren:
 *
 * - `useKopplungscode` — die **beitretende** Seite: acht Zeichen holen und
 *   zeigen, dazu den eigenen Prüfcode zum Vorlesen.
 * - `useKopplungswache` — dieselbe Seite, während sie wartet: Ist der Fall
 *   schon lesbar? §6 verspricht „innerhalb von Sekunden, ohne Neuladen".
 * - `useEinloesung` — die **einladende** Seite: Code eingeben, Name und
 *   Prüfcode sehen, nach dem mündlichen Abgleich bestätigen.
 *
 * **Warum die Wache pollt und nicht an der Türklingel hängt.** Die Klingel aus
 * §5 sitzt auf der `cases`-Zeile eines Falls, in dem man schon ist. Hier wartet
 * jemand darauf, überhaupt in einen Fall zu kommen (`memberships`) oder einen
 * `key_wraps`-Eintrag zu bekommen — beides hebt `cases.version` nicht, und die
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

type Ergebnis<T> = { wert: T } | { nachricht: string }

/** §6: „schaltet innerhalb von Sekunden frei". */
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
 * Der Prüfcode daneben kommt aus der **lokalen** Identität und nicht aus der
 * Zeile, die der Server zurückgibt: Verglichen wird, was dieses Gerät wirklich
 * besitzt, gegen das, was beim Gegenüber ankommt. Käme er vom Server, verglichen
 * beide Seiten dieselbe Serverangabe miteinander, und der Abgleich prüfte
 * nichts mehr (§3.6).
 */
export function useKopplungscode(zweck: Kopplungszweck): Kopplungscodedaten {
  const anmeldung = useGeraeteanmeldung()
  const zugang = useSupabase()

  /*
   * Im State steht ausschließlich das Ergebnis der asynchronen Arbeit, nicht
   * der Ladezustand — dasselbe Muster wie in `useGeraete.ts`. Was sich aus dem
   * Anmeldezustand ergibt, entsteht beim Rendern; ein Effekt, der synchron
   * `setState` ruft, erzeugte eine zweite Renderrunde für etwas, das schon
   * feststand.
   */
  const [ergebnis, setzeErgebnis] = useState<Ergebnis<Kopplungscode> | null>(null)
  const [runde, setzeRunde] = useState(0)

  const identitaet = anmeldung.status === 'bereit' ? anmeldung.identitaet : null
  const geraetId = anmeldung.status === 'bereit' ? anmeldung.geraet.id : null
  const anmeldungFehler = anmeldung.status === 'fehler' ? anmeldung.nachricht : null

  useEffect(() => {
    if (identitaet === null || geraetId === null) {
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
  }, [geraetId, identitaet, runde, zugang, zweck])

  const neuAnfordern = useCallback(() => {
    // Erst das alte Ergebnis fort, dann die neue Runde: Sonst stünde der
    // abgelaufene Code noch da, während der frische unterwegs ist, und jemand
    // liest ihn in der Zwischenzeit vor.
    setzeErgebnis(null)
    setzeRunde((vorher) => vorher + 1)
  }, [])

  const zustand = useMemo<KopplungscodeZustand>(() => {
    if (anmeldungFehler !== null) {
      return { status: 'fehler', nachricht: anmeldungFehler }
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
  }, [anmeldungFehler, ergebnis, identitaet])

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
 * „Freigeschaltet" heißt: **mehr** lesbare Fälle als beim Öffnen dieses
 * Screens. Nicht „mindestens einer" — ein zweites Gerät kann zwei von drei
 * Fällen längst lesen und auf den dritten warten, und dann wäre die Wache von
 * Anfang an fertig, ohne dass etwas geschehen ist.
 */
export function useKopplungswache(aktiv: boolean): WacheZustand {
  const anmeldung = useGeraeteanmeldung()
  const zugang = useSupabase()

  const [zustand, setzeZustand] = useState<WacheZustand>({ status: 'laedt' })

  // Die Ausgangszahl steht in einer Ref und nicht im State: Sie wird beim
  // ersten Durchlauf gesetzt und danach nur noch gelesen — ein `setState`
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

        if (abgeraeumt) {
          return
        }

        const lesbar = faelle.filter((fall) => fall.zustand === 'lesbar').length

        if (ausgangszahl.current === null) {
          ausgangszahl.current = lesbar
        }

        if (lesbar > ausgangszahl.current) {
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
        if (!abgeraeumt) {
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
  | { status: 'leer' }
  | { status: 'laeuft' }
  | { status: 'angebot'; anfrage: Kopplungsanfrage }
  | { status: 'fertig'; nachricht: string }
  | { status: 'fehler'; nachricht: string }

export type Einloesungsdaten = {
  zustand: EinloesungZustand
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
 */
export function useEinloesung(): Einloesungsdaten {
  const anmeldung = useGeraeteanmeldung()
  const { zustand: fallZustand } = useCase()
  const zugang = useSupabase()

  const [zustand, setzeZustand] = useState<EinloesungZustand>({ status: 'leer' })

  const identitaet = anmeldung.status === 'bereit' ? anmeldung.identitaet : null
  const geraetId = anmeldung.status === 'bereit' ? anmeldung.geraet.id : null

  const faelle = useMemo(
    () => (fallZustand.status === 'bereit' ? fallZustand.faelle : []),
    [fallZustand],
  )
  const lesbareFaelle = useMemo(() => lesbare(faelle), [faelle])

  const einloesen = useCallback(
    async (eingabe: string) => {
      setzeZustand({ status: 'laeuft' })

      try {
        const anfrage = await loeseKopplungscodeEin(supabaseKopplung(zugang()), eingabe)
        setzeZustand({ status: 'angebot', anfrage })
      } catch (fehler) {
        setzeZustand({ status: 'fehler', nachricht: alsNachricht(fehler) })
      }
    },
    [zugang],
  )

  const bestaetigen = useCallback(
    async (fallId?: string) => {
      if (zustand.status !== 'angebot') {
        return
      }

      if (identitaet === null || geraetId === null) {
        setzeZustand({
          status: 'fehler',
          nachricht: 'Ohne angemeldetes Gerät lässt sich keine Kopplung abschließen.',
        })
        return
      }

      const { anfrage } = zustand
      setzeZustand({ status: 'laeuft' })

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
        setzeZustand({ status: 'fehler', nachricht: alsNachricht(fehler) })
      }
    },
    [faelle, geraetId, identitaet, lesbareFaelle, zugang, zustand],
  )

  const abbrechen = useCallback(() => setzeZustand({ status: 'leer' }), [])

  return useMemo(
    () => ({ zustand, lesbareFaelle, einloesen, bestaetigen, abbrechen }),
    [abbrechen, bestaetigen, einloesen, lesbareFaelle, zustand],
  )
}
