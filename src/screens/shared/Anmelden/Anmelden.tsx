import { SignIn } from '@clerk/react'
import { useFarbschema } from '../../../hooks/useFarbschema.ts'
import stile from './Anmelden.module.css'

/**
 * Anmeldung (DESIGN.md §7, Onboarding-Schritt 1).
 *
 * Wer nicht angemeldet ist, sieht ausschließlich diesen Screen. Erst danach
 * entstehen die beiden Keypairs und läuft `navigator.storage.persist()`.
 *
 * Clerk rendert das Formular selbst. Die Farben kommen aus §12, die Sprache aus
 * `deDE` — Clerks deutsche Übersetzung siezt durchgehend, was zu §1 passt.
 *
 * `routing="hash"` hält Anmeldung und Registrierung in dieser einen Komponente,
 * ohne dass die App dafür eigene Routen braucht.
 */
export function Anmelden() {
  const { palette } = useFarbschema()

  return (
    <main className={stile.seite}>
      <div className={stile.kopf}>
        <h1>LoveNeverDies</h1>
        <p className={stile.untertitel}>
          Wir begleiten Sie durch die Aufgaben, die nach einem Todesfall zu erledigen sind.
        </p>
      </div>

      <SignIn
        routing="hash"
        withSignUp
        appearance={{
          variables: {
            /*
             * §7: Touch-Ziele mindestens 48 px. Clerk leitet die Groesse seiner
             * Bedienelemente aus `spacing` und `fontSize` ab; die Voreinstellung
             * (1rem / 0.8125rem) ergibt 32 px hohe Knoepfe und ein 32 px hohes
             * Eingabefeld. Fuer die Zielgruppe dieser App ist das der erste
             * Screen ueberhaupt — er darf nicht der unbedienbarste sein.
             */
            spacing: '1.5rem',
            fontSize: '1rem',

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
          /*
           * `spacing` allein reicht nicht: Clerk skaliert Knoepfe damit
           * staerker als Eingabefelder, die 48 px waeren erst bei grotesken
           * Proportionen erreicht. Die Hoehen stehen deshalb direkt hier.
           */
          elements: {
            formButtonPrimary: { minHeight: '3rem' },
            socialButtonsIconButton: { minHeight: '3rem' },
            formFieldInput: { minHeight: '3rem' },
            formFieldInputShowPasswordButton: { minHeight: '3rem', minWidth: '3rem' },
          },
        }}
      />
    </main>
  )
}
