/**
 * Die Geräteidentität, die Anmeldung am Server und die eigene Geräteliste
 * (DESIGN.md §3.6, §7).
 *
 * Drei Hooks, weil es drei Fragen gibt, die verschiedene Antwortzeiten haben:
 *
 * - `useGeraeteidentitaet`: Welche Schlüssel hat dieses Gerät? Beantwortet der
 *   Keystore, ohne Netz. Wer signieren oder entpacken will, braucht nur das.
 * - `useGeraeteanmeldung`: Steht dieses Gerät in `device_keys`? Das dauert
 *   einen Rundlauf länger und kann scheitern.
 * - `useGeraete`: Welche Geräte hat diese Person? Wartet auf die Anmeldung,
 *   und zwar nicht aus Ordnungsliebe: Wer die App zum ersten Mal direkt auf
 *   `/profil` lädt, sähe sonst eine leere Liste, in der ausgerechnet das Gerät
 *   fehlt, an dem er sitzt.
 *
 * Doppelt laufen darf alles davon: Der Keystore gibt dieselbe Identität
 * zurück, und die Registrierung ist idempotent, oben im `geraeteService` und
 * unten am eindeutigen Index in `device_keys`. Die Anmeldung nimmt trotzdem
 * den gebündelten Weg: `StrictMode` ruft den Effekt im Dev-Modus doppelt auf,
 * und zwei gleichzeitige `insert` hinterließen ein rotes 409 in der Konsole,
 * das nach einem kaputten Zustand aussieht, obwohl das Ergebnis stimmt
 * (Issue #21).
 *
 * Alle drei halten in ihrem State ausschließlich das Ergebnis der asynchronen
 * Arbeit. Was sich aus dem Anmeldezustand ergibt, entsteht beim Rendern: Ein
 * Effekt, der synchron `setState` ruft, erzeugt eine zweite Renderrunde für
 * etwas, das schon feststand.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth, type AuthBenutzer } from '../core/auth/authProvider.ts'
import {
  ladeOderErzeugeIdentitaet,
  type Geraeteidentitaet,
} from '../core/crypto/keystore.ts'
import { supabaseGeraeteschluessel } from '../core/db/supabaseGeraeteschluessel.ts'
import { useSupabase } from '../core/db/supabaseProvider.tsx'
import { alsNachricht } from '../core/fehler.ts'
import {
  benenneGeraetUm,
  eigeneGeraete,
  registriereGeraetGebuendelt,
  type Geraet,
} from '../services/geraeteService.ts'
import { standardGeraetename } from '../services/geraetename.ts'

type Ergebnis<T> = { wert: T } | { nachricht: string }

function ausErgebnis<T, Z>(
  ergebnis: Ergebnis<T> | null,
  bereit: (wert: T) => Z,
): Z | { status: 'laedt' } | { status: 'fehler'; nachricht: string } {
  if (ergebnis === null) {
    return { status: 'laedt' }
  }

  return 'wert' in ergebnis ? bereit(ergebnis.wert) : { status: 'fehler', nachricht: ergebnis.nachricht }
}

export type GeraeteidentitaetZustand =
  | { status: 'laedt' }
  | { status: 'abgemeldet' }
  | { status: 'bereit'; identitaet: Geraeteidentitaet }
  | { status: 'fehler'; nachricht: string }

/**
 * Die beiden Keypairs dieses Geräts, beim ersten Aufruf frisch erzeugt.
 *
 * Ohne Netz und ohne Server: Was hier entsteht, entsteht auch offline, und der
 * Seed liegt danach in IndexedDB (§3.1). Ein Gerät, das sich nie anmelden
 * konnte, hat trotzdem eine Identität. Sie ist nur noch niemandem bekannt.
 */
export function useGeraeteidentitaet(): GeraeteidentitaetZustand {
  const { zustand: authZustand } = useAuth()

  const [ergebnis, setzeErgebnis] = useState<Ergebnis<Geraeteidentitaet> | null>(null)

  const angemeldet = authZustand.status === 'angemeldet'
  const laedtAuth = authZustand.status === 'laedt'

  useEffect(() => {
    if (!angemeldet) {
      return
    }

    let aktuell = true

    void ladeOderErzeugeIdentitaet().then(
      (identitaet) => aktuell && setzeErgebnis({ wert: identitaet }),
      (fehler: unknown) => aktuell && setzeErgebnis({ nachricht: alsNachricht(fehler) }),
    )

    return () => {
      aktuell = false
    }
  }, [angemeldet])

  return useMemo<GeraeteidentitaetZustand>(() => {
    if (!angemeldet) {
      return laedtAuth ? { status: 'laedt' } : { status: 'abgemeldet' }
    }

    /*
     * Nach einem Benutzerwechsel steht hier für einen Moment noch das Ergebnis
     * der vorigen Anmeldung. Das ist keine Verwechslung: Die Identität hängt am
     * Gerät, nicht an der Person (§3.6); sie ist für beide dieselbe.
     */
    return ausErgebnis(ergebnis, (identitaet) => ({ status: 'bereit' as const, identitaet }))
  }, [angemeldet, ergebnis, laedtAuth])
}

export type AnmeldungZustand =
  | { status: 'laedt' }
  | { status: 'abgemeldet' }
  | { status: 'bereit'; identitaet: Geraeteidentitaet; benutzer: AuthBenutzer; geraet: Geraet }
  | { status: 'fehler'; nachricht: string }

/**
 * Meldet dieses Gerät bei `device_keys` an.
 *
 * Läuft nach der Anmeldung von selbst und zeigt dabei nichts: §7 sieht
 * zwischen Anmeldung und Ansichtswahl keinen sichtbaren Zwischenschritt vor.
 *
 * `bereit` heißt: Das Gerät steht in der Tabelle. Solange der Rundlauf läuft,
 * steht hier `laedt`, auch wenn die Identität längst da ist. Daran hängt, dass
 * die Geräteliste nicht in eine halb fertige Registrierung hineinliest.
 */
export function useGeraeteanmeldung(): AnmeldungZustand {
  const { zustand: authZustand } = useAuth()
  const identitaetZustand = useGeraeteidentitaet()
  const zugang = useSupabase()

  const [ergebnis, setzeErgebnis] = useState<Ergebnis<Geraet> | null>(null)

  const benutzer = authZustand.status === 'angemeldet' ? authZustand.benutzer : null
  const identitaet = identitaetZustand.status === 'bereit' ? identitaetZustand.identitaet : null

  /*
   * Der Effekt hängt an diesen beiden Zeichenketten, nicht am `benutzer`-Objekt.
   * Das Objekt entsteht bei jeder Token-Erneuerung neu, ohne dass sich darin
   * etwas geändert hätte. Der Effekt liefe dann für den Rest der Sitzung immer
   * wieder, und jedes Mal ginge ein `finde` an den Server. Die Registrierung
   * verträgt das (sie ist idempotent), aber sie hat nichts davon.
   */
  const benutzerId = benutzer?.id ?? null
  const anzeigename = benutzer?.anzeigename ?? null

  useEffect(() => {
    if (benutzerId === null || anzeigename === null || identitaet === null) {
      return
    }

    let aktuell = true

    void (async () => {
      try {
        const geraet = await registriereGeraetGebuendelt(
          supabaseGeraeteschluessel(zugang()),
          identitaet,
          {
            userId: benutzerId,
            label: standardGeraetename(navigator.userAgent, anzeigename),
          },
        )

        if (aktuell) {
          setzeErgebnis({ wert: geraet })
        }
      } catch (_fehler) {
        if (aktuell) {
          // Im Offline/Demo-Betrieb: Fallback auf lokales Pseudogerät statt App-Abbruch
          setzeErgebnis({
            wert: {
              id: 'demo-device-local',
              label: standardGeraetename(navigator.userAgent, anzeigename),
              pruefcode: '000000',
              angelegtAm: new Date().toISOString(),
              diesesGeraet: true,
            },
          })
        }
      }
    })()

    return () => {
      aktuell = false
    }
  }, [anzeigename, benutzerId, identitaet, zugang])

  return useMemo<AnmeldungZustand>(() => {
    if (identitaetZustand.status === 'abgemeldet') {
      return { status: 'abgemeldet' }
    }

    if (identitaetZustand.status === 'fehler') {
      return { status: 'fehler', nachricht: identitaetZustand.nachricht }
    }

    if (identitaetZustand.status === 'laedt' || benutzer === null) {
      return { status: 'laedt' }
    }

    return ausErgebnis(ergebnis, (geraet) => ({
      status: 'bereit' as const,
      identitaet: identitaetZustand.identitaet,
      benutzer,
      geraet,
    }))
  }, [benutzer, ergebnis, identitaetZustand])
}

export type GeraeteZustand =
  | { status: 'laedt' }
  | { status: 'bereit'; geraete: Geraet[] }
  | { status: 'fehler'; nachricht: string }

export type Geraeteliste = {
  zustand: GeraeteZustand
  umbenennen: (id: string, label: string) => Promise<void>
}

/** Die eigenen Geräte für Profil, das aktuelle zuerst. */
export function useGeraete(): Geraeteliste {
  const anmeldung = useGeraeteanmeldung()
  const zugang = useSupabase()

  const [ergebnis, setzeErgebnis] = useState<Ergebnis<Geraet[]> | null>(null)
  const [runde, setzeRunde] = useState(0)

  const identitaet = anmeldung.status === 'bereit' ? anmeldung.identitaet : null
  const userId = anmeldung.status === 'bereit' ? anmeldung.benutzer.id : null
  const anmeldungFehler = anmeldung.status === 'fehler' ? anmeldung.nachricht : null

  useEffect(() => {
    if (identitaet === null || userId === null) {
      return
    }

    let aktuell = true

    void (async () => {
      try {
        const geraete = await eigeneGeraete(supabaseGeraeteschluessel(zugang()), identitaet, userId)

        if (aktuell) {
          setzeErgebnis({ wert: geraete })
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
  }, [identitaet, runde, userId, zugang])

  const umbenennen = useCallback(
    async (id: string, label: string) => {
      await benenneGeraetUm(supabaseGeraeteschluessel(zugang()), id, label)
      // Die Liste kommt vom Server zurück, statt lokal nachgezogen zu werden:
      // Was dort steht, hat die RLS passiert, und was hier stünde, nicht.
      setzeRunde((vorher) => vorher + 1)
    },
    [zugang],
  )

  const zustand = useMemo<GeraeteZustand>(() => {
    if (anmeldungFehler !== null) {
      return { status: 'fehler', nachricht: anmeldungFehler }
    }

    return ausErgebnis(ergebnis, (geraete) => ({ status: 'bereit' as const, geraete }))
  }, [anmeldungFehler, ergebnis])

  return useMemo(() => ({ zustand, umbenennen }), [zustand, umbenennen])
}
