import { UserProfile } from '@clerk/react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../../../core/auth/authProvider.ts'
import { useFarbschema } from '../../../hooks/useFarbschema.ts'
import { Zurueck } from '../../../ui/Zurueck/Zurueck.tsx'
import stile from './Konto.module.css'

/**
 * Die Kontoeinstellungen (DESIGN.md §7).
 *
 * E-Mail-Adresse ändern, Passwort ändern, ein zweites Verfahren einrichten,
 * angemeldete Sitzungen sehen: Das sind Angaben der Anmeldung und keine des
 * Falls. Sie liegen bei Clerk, sie werden dort geprüft, und sie gehören
 * deshalb in Clerks eigene Oberfläche und nicht in ein nachgebautes Formular,
 * das dieselben Regeln ein zweites Mal kennen müsste — Passwortlänge,
 * Bestätigungsmail, Wiederherstellungscodes.
 *
 * Damit steht Clerk in genau drei Dateien: `core/auth/clerkAdapter.tsx` für die
 * Sitzung, `screens/shared/Anmelden` für die Anmeldung und hier für das Konto
 * (§1). Ein Wechsel des Anbieters tauscht diese drei aus und sonst nichts.
 *
 * **Was hier nicht steht, ist wichtiger als das, was steht.** Diese Seite ändert
 * nichts an den Schlüsseln. Ein neues Passwort entschlüsselt keine einzige
 * Zeile mehr oder weniger: `sk_u` liegt gerätegebunden im Keystore, und die
 * Anmeldung sagt ausschliesslich, *wer* jemand ist (§3.6). Wer sein Passwort
 * ändert, verliert deshalb keinen Zugriff — und wer ein gestohlenes Passwort
 * hat, gewinnt keinen.
 *
 * `routing="hash"` hält die Unterseiten von Clerk in dieser einen Route, ohne
 * dass die App dafür eigene Routen braucht — dasselbe wie in `Anmelden`.
 */
export function Konto() {
  const { zustand } = useAuth()
  const { palette } = useFarbschema()

  // Ohne Anmeldung gibt es kein Konto zu zeigen. Hierher kommt in aller Regel
  // niemand, weil die App vor der Anmeldung nur den Anmeldescreen kennt; ein
  // Lesezeichen auf diese Adresse gibt es trotzdem.
  if (zustand.status === 'abgemeldet') {
    return <Navigate to="/" replace />
  }

  return (
    <main className={stile.seite}>
      <Zurueck ziel="/profil" />

      <h1>Konto</h1>
      <p className={stile.hinweis}>
        Hier ändern Sie Ihre Anmeldung: E-Mail-Adresse, Passwort, Name. Ihre Aufgaben und
        Dokumente bleiben davon unberührt — sie hängen an diesem Gerät, nicht an Ihrem Passwort.
      </p>

      <UserProfile
        routing="hash"
        appearance={{
          variables: {
            colorPrimary: palette.akzent,
            colorPrimaryForeground: palette.aufAkzent,
            colorBackground: palette.karte,
            colorForeground: palette.text,
            colorMutedForeground: palette.textSekundaer,
            colorInput: palette.karte,
            colorInputForeground: palette.text,
            colorBorder: palette.kartenrand,
            colorRing: palette.akzent,
          },
        }}
      />
    </main>
  )
}
