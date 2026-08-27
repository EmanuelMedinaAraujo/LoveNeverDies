/**
 * Den eigenen Namen hinterlegen (DESIGN.md §3.3, §6).
 *
 * §6 braucht ihn in `profiles`, damit die einladende Person einen echten Namen
 * sieht, bevor ein gemeinsamer Schlüssel existiert: Ein öffentlicher Schlüssel
 * ist keine Identität, und wer das Familiengeheimnis weitergibt, soll vorher
 * lesen, wen er hereinlässt.
 *
 * **Woher der Name kommt.** Zuerst von Clerk, wo er steht — dann läuft das
 * still mit, ohne Screen und ohne Rückfrage, und es läuft bei jeder Anmeldung:
 * Wer bei Clerk heiratet und seinen Namen ändert, ändert ihn nicht in dieser
 * Tabelle, und ein Kopplungsangebot zeigte sonst jahrelang den alten.
 *
 * Bei Clerk steht aber oft keiner. „Mit Apple anmelden" reicht den Namen nur
 * beim allerersten Mal weiter, und wer sich mit einer E-Mail-Adresse
 * registriert, gibt gar keinen an. Früher trug der Adapter dann die Adresse
 * als Anzeigenamen ein; sie landete in dieser Tabelle und von dort in jedem
 * Kopplungsangebot (`core/auth/clerkAdapter.tsx`). Jetzt bleibt der Name in
 * diesem Fall leer, und die App fragt danach — dort, wo ohnehin ein Formular
 * steht: beim Anlegen eines Trauerfalls, beim Anlegen einer Vorsorge und vor
 * dem Kopplungscode der beitretenden Person.
 *
 * Der selbst eingetragene Name überlebt das nächste Laden: Clerk gewinnt nur,
 * solange dort wirklich ein Name steht.
 *
 * **Ein Fehlschlag hält nichts an.** Ohne Profil scheitert später
 * `erzeuge_kopplungscode` mit einem Satz, der sagt, was fehlt (§6); bis dahin
 * funktioniert alles andere, und eine Fehlermeldung beim Start, die niemand
 * einordnen kann, hilft niemandem. Folgenlos steckenbleiben darf er trotzdem
 * nicht: Ohne `nochmal` bliebe die Sitzung nach einem einzigen misslungenen
 * Rundlauf bis zum Neuladen ohne Profil. Der Kopplungscode-Hook wartet deshalb
 * auf `bereit` und stößt bei Bedarf einen neuen Versuch an.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '../core/auth/authProvider.ts'
import { supabaseProfil } from '../core/db/supabaseProfil.ts'
import { useSupabase } from '../core/db/supabaseProvider.tsx'
import { alsNachricht } from '../core/fehler.ts'
import { istEchterName } from '../services/personenname.ts'

export type ProfilZustand =
  | { status: 'laedt' }
  | { status: 'abgemeldet' }
  | { status: 'bereit' }
  | { status: 'fehler'; nachricht: string }

export type Profildaten = {
  zustand: ProfilZustand
  /**
   * Der hinterlegte Name: der von Clerk, sonst der selbst eingetragene.
   *
   * Leer, solange keiner dasteht — und leer auch dann, wenn dort noch eine
   * E-Mail-Adresse aus der Zeit steht, in der sie ersatzweise eingetragen
   * wurde (`services/personenname.ts`).
   */
  name: string
  /** Ob die App nach einem Namen fragen muss, bevor es weitergeht (§3.3, §6). */
  nameFehlt: boolean
  /**
   * Trägt den selbst eingegebenen Namen ein.
   *
   * Wirft weiter, damit das Formular, das ihn aufgenommen hat, den Grund
   * nennen kann: Wer seinen Namen eingibt und weitergeschickt wird, obwohl
   * nichts ankam, gibt ihn beim nächsten Mal wieder ein.
   */
  speichereNamen: (name: string) => Promise<void>
  /** Nach einem Fehlschlag: noch einmal schreiben. */
  nochmal: () => void
}

export function useProfilAbgleich(): Profildaten {
  const { zustand: authZustand } = useAuth()
  const zugang = useSupabase()

  const [zustand, setzeZustand] = useState<ProfilZustand>({ status: 'laedt' })
  const [hinterlegt, setzeHinterlegt] = useState('')
  const [runde, setzeRunde] = useState(0)

  const benutzer = authZustand.status === 'angemeldet' ? authZustand.benutzer : null

  /*
   * Am Inhalt festgemacht und nicht am Objekt: Clerk gibt bei jeder
   * Token-Erneuerung ein neues `benutzer`-Objekt heraus, ohne dass sich darin
   * etwas geändert hätte, dieselbe Überlegung wie in `useGeraete.ts`.
   */
  const benutzerId = benutzer?.id ?? null
  const anzeigename = benutzer?.anzeigename.trim() ?? ''
  const email = benutzer?.email ?? null

  useEffect(() => {
    if (benutzerId === null) {
      return
    }

    let aktuell = true

    void (async () => {
      try {
        const profil = supabaseProfil(zugang())

        /*
         * Erst lesen, dann schreiben. Ohne diesen Blick überschriebe der
         * Abgleich bei jedem Laden den selbst eingetragenen Namen mit dem
         * leeren aus Clerk — die Person hätte ihn eingegeben, gesehen, und
         * beim nächsten Öffnen der App wäre er weg.
         */
        const gespeichert = (await profil.namen([benutzerId])).get(benutzerId) ?? ''

        if (anzeigename !== '' && anzeigename !== gespeichert) {
          await profil.speichere({ userId: benutzerId, anzeigename, email })
        }

        if (aktuell) {
          setzeHinterlegt(anzeigename !== '' ? anzeigename : gespeichert)
          setzeZustand({ status: 'bereit' })
        }
      } catch (fehler) {
        if (aktuell) {
          setzeZustand({ status: 'fehler', nachricht: alsNachricht(fehler) })
        }
      }
    })()

    return () => {
      aktuell = false
    }
  }, [anzeigename, benutzerId, email, runde, zugang])

  const speichereNamen = useCallback(
    async (neuer: string) => {
      const gekuerzt = neuer.trim()

      if (benutzerId === null) {
        throw new Error('Ohne Anmeldung lässt sich kein Name hinterlegen.')
      }

      if (gekuerzt === '') {
        throw new Error('Bitte tragen Sie Ihren Namen ein.')
      }

      await supabaseProfil(zugang()).speichere({
        userId: benutzerId,
        anzeigename: gekuerzt,
        email,
      })

      setzeHinterlegt(gekuerzt)
      setzeZustand({ status: 'bereit' })
    },
    [benutzerId, email, zugang],
  )

  const nochmal = useCallback(() => setzeRunde((vorher) => vorher + 1), [])

  return useMemo(
    () => ({
      zustand: authZustand.status === 'abgemeldet' ? { status: 'abgemeldet' as const } : zustand,
      name: istEchterName(hinterlegt) ? hinterlegt : '',
      /*
       * Solange das Profil lädt, fehlt nichts: Ein Formular, das seine
       * Namensfrage einblendet und eine Sekunde später wieder einklappt, ist
       * schlimmer als eines, das kurz wartet.
       */
      nameFehlt: zustand.status === 'bereit' && !istEchterName(hinterlegt),
      speichereNamen,
      nochmal,
    }),
    [authZustand.status, hinterlegt, nochmal, speichereNamen, zustand],
  )
}
