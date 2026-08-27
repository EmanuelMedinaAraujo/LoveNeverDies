import { SignIn } from '@clerk/react'
import { useFarbschema } from '../../../hooks/useFarbschema.ts'
import { Button } from '../../../ui/Button/Button.tsx'
import { Card } from '../../../ui/Card/Card.tsx'
import stile from './Anmelden.module.css'

const publishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY
const istGueltigerKey =
  typeof publishableKey === 'string' &&
  publishableKey.trim() !== '' &&
  !publishableKey.includes('xxxxxxxx') &&
  (publishableKey.startsWith('pk_test_') || publishableKey.startsWith('pk_live_'))

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

      {istGueltigerKey ? (
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
      ) : (
        <Card>
          <div style={{ textAlign: 'center', padding: '1rem' }}>
            <h2 style={{ marginBottom: '0.75rem', fontSize: '1.25rem' }}>Demo-Modus aktiv</h2>
            <p style={{ marginBottom: '1.5rem', color: 'var(--farbe-text-sekundaer)' }}>
              Es ist kein Clerk-Schlüssel konfiguriert. Sie können die App und den
              ElevenLabs-Sprachassistenten direkt im Demo-Modus nutzen.
            </p>
            <Button
              volleBreite
              onClick={() => {
                window.location.reload()
              }}
            >
              Demo-Modus fortsetzen
            </Button>
          </div>
        </Card>
      )}
    </main>
  )
}

