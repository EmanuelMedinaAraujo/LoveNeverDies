/**
 * Den eigenen Namen hinterlegen (DESIGN.md §3.3, §6).
 *
 * Läuft nach der Anmeldung still mit, wie die Geräteanmeldung daneben. Es gibt
 * dafür keinen Screen und keine Rückfrage: Clerk kennt Name und E-Mail
 * ohnehin, und §6 braucht sie in `profiles`, damit die einladende Person einen
 * echten Namen sieht, **bevor** ein gemeinsamer Schlüssel existiert.
 *
 * **Warum bei jeder Anmeldung und nicht nur beim ersten Mal.** Wer bei Clerk
 * heiratet und den Namen ändert, ändert ihn nicht in dieser Tabelle. Ein
 * Kopplungsangebot zeigte dann jahrelang den alten Namen — und das ist genau
 * der Wert, an dem jemand am Telefon entscheidet, ob er das Familiengeheimnis
 * weitergibt.
 *
 * **Ein Fehlschlag ist kein Grund, die App anzuhalten.** Ohne Profil scheitert
 * später `erzeuge_kopplungscode` mit einem Satz, der sagt, was fehlt (§6). Bis
 * dahin funktioniert alles andere, und eine Fehlermeldung beim Start, die
 * niemand einordnen kann, hilft niemandem.
 *
 * Er darf deshalb aber nicht folgenlos steckenbleiben: Ohne `nochmal` bliebe
 * die Sitzung nach einem einzigen misslungenen Rundlauf bis zum Neuladen ohne
 * Profil, und jede Kopplung scheiterte mit „Ohne hinterlegten Namen". Der
 * Kopplungscode-Hook wartet deshalb auf `bereit` und stößt bei Bedarf einen
 * neuen Versuch an.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '../core/auth/authProvider.ts'
import { supabaseProfil } from '../core/db/supabaseProfil.ts'
import { useSupabase } from '../core/db/supabaseProvider.tsx'
import { alsNachricht } from '../core/fehler.ts'

export type ProfilZustand =
  | { status: 'laedt' }
  | { status: 'abgemeldet' }
  | { status: 'bereit' }
  | { status: 'fehler'; nachricht: string }

export type Profildaten = {
  zustand: ProfilZustand
  /** Nach einem Fehlschlag: noch einmal schreiben. */
  nochmal: () => void
}

export function useProfilAbgleich(): Profildaten {
  const { zustand: authZustand } = useAuth()
  const zugang = useSupabase()

  const [zustand, setzeZustand] = useState<ProfilZustand>({ status: 'laedt' })
  const [runde, setzeRunde] = useState(0)

  const benutzer = authZustand.status === 'angemeldet' ? authZustand.benutzer : null

  /*
   * Am Inhalt festgemacht und nicht am Objekt: Clerk gibt bei jeder
   * Token-Erneuerung ein neues `benutzer`-Objekt heraus, ohne dass sich darin
   * etwas geändert hätte — dieselbe Überlegung wie in `useGeraete.ts`.
   */
  const benutzerId = benutzer?.id ?? null
  const anzeigename = benutzer?.anzeigename ?? null
  const email = benutzer?.email ?? null

  useEffect(() => {
    if (benutzerId === null || anzeigename === null) {
      return
    }

    let aktuell = true

    void supabaseProfil(zugang())
      .speichere({ userId: benutzerId, anzeigename, email })
      .then(
        () => aktuell && setzeZustand({ status: 'bereit' }),
        (fehler: unknown) =>
          aktuell && setzeZustand({ status: 'fehler', nachricht: alsNachricht(fehler) }),
      )

    return () => {
      aktuell = false
    }
  }, [anzeigename, benutzerId, email, runde, zugang])

  const nochmal = useCallback(() => setzeRunde((vorher) => vorher + 1), [])

  return useMemo(
    () => ({
      zustand: authZustand.status === 'abgemeldet' ? { status: 'abgemeldet' as const } : zustand,
      nochmal,
    }),
    [authZustand.status, nochmal, zustand],
  )
}
