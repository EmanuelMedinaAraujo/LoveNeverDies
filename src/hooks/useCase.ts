/**
 * Der Fall, in dem sich die angemeldete Person gerade befindet (DESIGN.md §2, §3.6).
 *
 * Lädt, sobald das Gerät angemeldet ist — vorher gibt es weder `identitaet`
 * noch die `device_id`, die `key_wraps` braucht. `aktiver` ist der erste
 * eigene Fall; eine Wahl zwischen mehreren Fällen kommt mit der Kopplung (§6)
 * und ist hier noch nicht gebaut.
 *
 * Muster für Laden, Fehler und Neuladen: `useGeraete.ts`.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabaseFaelle } from '../core/db/supabaseFaelle.ts'
import { supabaseFallschluessel } from '../core/db/supabaseFallschluessel.ts'
import { supabaseGeraeteschluessel } from '../core/db/supabaseGeraeteschluessel.ts'
import { supabaseInhalte } from '../core/db/supabaseInhalte.ts'
import { useSupabase } from '../core/db/supabaseProvider.tsx'
import { alsNachricht } from '../core/fehler.ts'
import {
  ladeFaelle,
  legeTrauerfallAn as legeTrauerfallAnDienst,
  type Fall,
  type Trauerfallangaben,
} from '../services/fallService.ts'
import { useGeraeteanmeldung } from './useGeraete.ts'

type Ergebnis<T> = { wert: T } | { nachricht: string }

export type FallZustand =
  | { status: 'laedt' }
  | { status: 'kein-fall' }
  | { status: 'fehler'; nachricht: string }
  | { status: 'bereit'; faelle: Fall[]; aktiver: Fall }

export type Falldaten = {
  zustand: FallZustand
  legeTrauerfallAn: (angaben: Trauerfallangaben) => Promise<void>
}

export function useCase(): Falldaten {
  const anmeldung = useGeraeteanmeldung()
  const zugang = useSupabase()

  const [ergebnis, setzeErgebnis] = useState<Ergebnis<Fall[]> | null>(null)
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
        const client = zugang()
        const faelle = await ladeFaelle(
          supabaseFaelle(client),
          supabaseFallschluessel(client),
          supabaseGeraeteschluessel(client),
          identitaet,
          geraetId,
        )

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
    }
  }, [identitaet, geraetId, runde, zugang])

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
      // Die Liste kommt vom Server zurück, statt den frischen Fall lokal
      // anzuhängen: Was `ladeFaelle` liefert, hat den vollen Weg aus §3.6
      // durchlaufen — Wrap lesen, Signatur prüfen, entpacken — und genau das
      // soll auch für den eigenen, gerade erst angelegten Fall gelten.
      setzeRunde((vorher) => vorher + 1)
    },
    [geraetId, identitaet, zugang],
  )

  const zustand = useMemo<FallZustand>(() => {
    if (anmeldungFehler !== null) {
      return { status: 'fehler', nachricht: anmeldungFehler }
    }

    if (identitaet === null || geraetId === null || ergebnis === null) {
      return { status: 'laedt' }
    }

    if ('nachricht' in ergebnis) {
      return { status: 'fehler', nachricht: ergebnis.nachricht }
    }

    const [aktiver] = ergebnis.wert

    return aktiver === undefined
      ? { status: 'kein-fall' }
      : { status: 'bereit', faelle: ergebnis.wert, aktiver }
  }, [anmeldungFehler, ergebnis, geraetId, identitaet])

  return useMemo(() => ({ zustand, legeTrauerfallAn }), [zustand, legeTrauerfallAn])
}
