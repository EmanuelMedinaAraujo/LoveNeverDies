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
 * `deDE`, Clerks deutsche Übersetzung siezt durchgehend, was zu §1 passt.
 *
 * `routing="hash"` hält Anmeldung und Registrierung in dieser einen Komponente,
 * ohne dass die App dafür eigene Routen braucht.
 *
 * Die Marke steht als Bild über der Überschrift, in der Fassung, die zum
 * gewählten Farbschema passt. Ausgewählt wird sie hier und nicht mit einem
 * `<picture media>`: Der Override aus Profil gewinnt gegen die
 * Systemeinstellung (§7), und ein `media`-Attribut kennt nur die
 * Systemeinstellung. Die Überschrift bleibt daneben stehen — sie ist der
 * Name, den eine Vorlesestimme ansagt, und das Bild trägt ihn nicht.
 */
export function Anmelden() {
  const { palette, schema } = useFarbschema()

  return (
    <main className={stile.seite}>
      <div className={stile.kopf}>
        <img
          className={stile.marke}
          src={schema === 'dunkel' ? '/logo-dunkel-256.png' : '/logo-hell-256.png'}
          width={256}
          height={256}
          alt=""
        />

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
