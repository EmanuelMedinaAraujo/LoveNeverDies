/**
 * Der Fall, in dem sich die angemeldete Person gerade befindet (DESIGN.md §2, §3.6).
 *
 * Lädt, sobald das Gerät angemeldet ist. Vorher gibt es weder `identitaet`
 * noch die `device_id`, die `key_wraps` braucht. `aktiver` ist der erste
 * eigene Fall; eine Wahl zwischen mehreren Fällen kommt mit der Kopplung (§6)
 * und ist hier noch nicht gebaut.
 *
 * Muster für Laden, Fehler und Neuladen: `useGeraete.ts`.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { idbCiphertextcache } from '../core/db/idb.ts'
import { supabaseFaelle } from '../core/db/supabaseFaelle.ts'
import { supabaseFallschluessel } from '../core/db/supabaseFallschluessel.ts'
import { supabaseGeraeteschluessel } from '../core/db/supabaseGeraeteschluessel.ts'
import { supabaseInhalte } from '../core/db/supabaseInhalte.ts'
import { supabaseMitglieder } from '../core/db/supabaseMitglieder.ts'
import { supabaseTresor } from '../core/db/supabaseTresor.ts'
import { useSupabase } from '../core/db/supabaseProvider.tsx'
import { alsNachricht } from '../core/fehler.ts'
import { tuerklingel } from '../core/sync/realtime.ts'
import {
  ladeFaelle,
  legeTrauerfallAn as legeTrauerfallAnDienst,
  legeVorsorgefallAn as legeVorsorgefallAnDienst,
  loescheVorsorgefall as loescheVorsorgefallDienst,
  verlasseFall as verlasseFallDienst,
  type Fall,
  type Trauerfallangaben,
  type Vorsorgefallangaben,
} from '../services/fallService.ts'
import { rotiereFallschluessel } from '../services/rotationService.ts'
import { useGeraeteanmeldung } from './useGeraete.ts'

type Ergebnis<T> = { wert: T } | { nachricht: string }

export type FallZustand =
  | { status: 'laedt' }
  | { status: 'schluessel-erneuerung' }
  | { status: 'kein-fall' }
  | { status: 'fehler'; nachricht: string }
  | { status: 'bereit'; faelle: Fall[]; aktiver: Fall }

export type Falldaten = {
  zustand: FallZustand
  legeTrauerfallAn: (angaben: Trauerfallangaben) => Promise<void>
  legeVorsorgefallAn: (angaben: Vorsorgefallangaben) => Promise<void>
  loescheVorsorgefall: (fallId: string) => Promise<void>
  verlasseFall: (fallId: string) => Promise<void>
  aktualisiere: () => void
}

export function useCase(): Falldaten {
  const anmeldung = useGeraeteanmeldung()
  const zugang = useSupabase()

  const [ergebnis, setzeErgebnis] = useState<Ergebnis<Fall[]> | null>(null)
  const [erneuerung, setzeErneuerung] = useState(false)
  const [runde, setzeRunde] = useState(0)

  const identitaet = anmeldung.status === 'bereit' ? anmeldung.identitaet : null
  const geraetId = anmeldung.status === 'bereit' ? anmeldung.geraet.id : null
  const anmeldungFehler = anmeldung.status === 'fehler' ? anmeldung.nachricht : null

  useEffect(() => {
    if (identitaet === null || geraetId === null) {
      return
    }

    let aktuell = true
    let retryTimer: ReturnType<typeof setTimeout> | null = null

    void (async () => {
      try {
        const client = zugang()
        const faelle = await ladeFaelle(
          supabaseFaelle(client),
          supabaseFallschluessel(client),
          supabaseGeraeteschluessel(client),
          identitaet,
          geraetId,
          supabaseTresor(client),
        )

        if (!aktuell) return

        const [aktiver] = faelle
        if (aktiver !== undefined && aktiver.zustand === 'lesbar' && aktiver.rotationPending) {
          setzeErneuerung(true)
          const ergebnisRotation = await rotiereFallschluessel(
            supabaseFaelle(client),
            supabaseInhalte(client),
            supabaseFallschluessel(client),
            supabaseGeraeteschluessel(client),
            supabaseMitglieder(client),
            aktiver,
            identitaet,
            geraetId,
          )
          if (!aktuell) return
          if (ergebnisRotation.status === 'erfolg') {
            setzeErneuerung(false)
            setzeRunde((vorher) => vorher + 1)
            return
          }
          setzeErneuerung(false)
          // Mandat verweigert / fremde Rotation läuft: Nach 3 Sekunden erneut versuchen / prüfen
          retryTimer = setTimeout(() => {
            if (aktuell) {
              setzeRunde((vorher) => vorher + 1)
            }
          }, 3000)
        }

        if (aktuell) {
          setzeErgebnis({ wert: faelle })
        }
      } catch (fehler) {
        if (aktuell) {
          setzeErgebnis({ nachricht: alsNachricht(fehler) })
        }
      }
    })()

    return () => {
      aktuell = false
      if (retryTimer !== null) {
        clearTimeout(retryTimer)
      }
    }
  }, [identitaet, geraetId, runde, zugang])

  const aktiverFallId =
    ergebnis !== null && 'wert' in ergebnis && ergebnis.wert[0] !== undefined
      ? ergebnis.wert[0].id
      : null

  useEffect(() => {
    if (aktiverFallId === null) return
    const client = zugang()
    return tuerklingel(client, aktiverFallId, () => {
      setzeRunde((vorher) => vorher + 1)
    })
  }, [aktiverFallId, zugang])

  const legeTrauerfallAn = useCallback(
    async (angaben: Trauerfallangaben) => {
      if (identitaet === null || geraetId === null) {
        throw new Error('Ohne angemeldetes Gerät lässt sich kein Fall anlegen.')
      }

      const client = zugang()

      await legeTrauerfallAnDienst(
        supabaseFaelle(client),
        supabaseInhalte(client),
        identitaet,
        geraetId,
        angaben,
      )
      setzeRunde((vorher) => vorher + 1)
    },
    [geraetId, identitaet, zugang],
  )

  const legeVorsorgefallAn = useCallback(
    async (angaben: Vorsorgefallangaben) => {
      if (identitaet === null || geraetId === null) {
        throw new Error('Ohne angemeldetes Gerät lässt sich kein Fall anlegen.')
      }

      const client = zugang()

      await legeVorsorgefallAnDienst(
        supabaseFaelle(client),
        identitaet,
        geraetId,
        angaben,
      )
      setzeRunde((vorher) => vorher + 1)
    },
    [geraetId, identitaet, zugang],
  )

  const loescheVorsorgefall = useCallback(
    async (fallId: string) => {
      const client = zugang()
      await loescheVorsorgefallDienst(supabaseFaelle(client), fallId)
      setzeRunde((vorher) => vorher + 1)
    },
    [zugang],
  )

  const verlasseFall = useCallback(
    async (fallId: string) => {
      const client = zugang()
      await verlasseFallDienst(supabaseMitglieder(client), idbCiphertextcache(), fallId)
      setzeRunde((vorher) => vorher + 1)
    },
    [zugang],
  )

  const aktualisiere = useCallback(() => setzeRunde((vorher) => vorher + 1), [])

  const zustand = useMemo<FallZustand>(() => {
    if (anmeldungFehler !== null) {
      return { status: 'fehler', nachricht: anmeldungFehler }
    }

    if (erneuerung) {
      return { status: 'schluessel-erneuerung' }
    }

    if (identitaet === null || geraetId === null || ergebnis === null) {
      return { status: 'laedt' }
    }

    if ('nachricht' in ergebnis) {
      return { status: 'fehler', nachricht: ergebnis.nachricht }
    }

    const [aktiver] = ergebnis.wert

    if (aktiver !== undefined && aktiver.zustand === 'lesbar' && aktiver.rotationPending) {
      return { status: 'schluessel-erneuerung' }
    }

    return aktiver === undefined
      ? { status: 'kein-fall' }
      : { status: 'bereit', faelle: ergebnis.wert, aktiver }
  }, [anmeldungFehler, erneuerung, ergebnis, geraetId, identitaet])

  return useMemo(
    () => ({
      zustand,
      legeTrauerfallAn,
      legeVorsorgefallAn,
      loescheVorsorgefall,
      verlasseFall,
      aktualisiere,
    }),
    [zustand, legeTrauerfallAn, legeVorsorgefallAn, loescheVorsorgefall, verlasseFall, aktualisiere],
  )
}
