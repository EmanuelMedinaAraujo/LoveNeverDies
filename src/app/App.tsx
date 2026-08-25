import { useEffect } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { useAuth } from '../core/auth/authProvider.ts'
import { speicherDauerhaftAnfordern } from '../core/storage/persist.ts'
import { useAnsichtsmodus } from '../hooks/useAnsichtsmodus.ts'
import { useGeraeteanmeldung } from '../hooks/useGeraete.ts'
import { useProfilAbgleich } from '../hooks/useProfil.ts'
import { Alle } from '../screens/shared/Alle/Alle.tsx'
import { Anmelden } from '../screens/shared/Anmelden/Anmelden.tsx'
import { Beitreten } from '../screens/shared/Beitreten/Beitreten.tsx'
import { Aufgabe } from '../screens/shared/Aufgabe/Aufgabe.tsx'
import { Erbe } from '../screens/shared/Erbe/Erbe.tsx'
import { Koppeln } from '../screens/shared/Koppeln/Koppeln.tsx'
import { Profil } from '../screens/shared/Profil/Profil.tsx'
import { Start } from '../screens/shared/Start/Start.tsx'
import { Todesfall } from '../screens/shared/Todesfall/Todesfall.tsx'
import { Vorsorge } from '../screens/shared/Vorsorge/Vorsorge.tsx'
import { Rahmen } from './Rahmen.tsx'
import stile from './App.module.css'

function Ladeanzeige({ text }: { text: string }) {
  return (
    <div className={stile.ladeanzeige} role="status">
      {text}
    </div>
  )
}

export function App() {
  const ansichtsmodus = useAnsichtsmodus()
  const { zustand } = useAuth()

  /*
   * §7: Nach der Anmeldung entstehen beide Keypairs und das Gerät meldet sich
   * an: still, ohne sichtbaren Zwischenschritt. Der Rückgabewert wird hier
   * nicht gebraucht; Profil holt sich denselben Zustand noch einmal.
   */
  useGeraeteanmeldung()

  /*
   * §3.3, §6: Name und E-Mail landen in `profiles`, damit die einladende Person
   * sie sieht, bevor ein gemeinsamer Schlüssel existiert. Läuft ebenfalls still
   * mit; ein Fehlschlag hält nichts an und meldet sich erst, wenn wirklich ein
   * Kopplungscode gebraucht wird.
   */
  useProfilAbgleich()

  useEffect(() => {
    document.documentElement.dataset.dichte = ansichtsmodus
  }, [ansichtsmodus])

  useEffect(() => {
    /*
     * §7: läuft still mit. Schlägt es fehl, sagt die App nichts: Ein Hinweis
     * wäre eine Warnung ohne Handlungsmöglichkeit. Die Bitte steht hinter der
     * Anmeldung, weil Browser sie eher gewähren, wenn jemand die Seite
     * tatsächlich benutzt.
     */
    if (zustand.status === 'angemeldet') {
      void speicherDauerhaftAnfordern()
    }
  }, [zustand.status])

  if (zustand.status === 'laedt') {
    return <Ladeanzeige text="Einen Moment bitte…" />
  }

  if (zustand.status === 'abgemeldet') {
    return <Anmelden />
  }

  return (
    <Routes>
      {/*
        Die vier Hauptscreens aus §7. Sie und nur sie stehen im `Rahmen`, der
        die untere Leiste darunter setzt: Start, Erbe, Alle, Profil.

        Was hier nicht im Rahmen steht, ist Absicht. Das Aufgabendetail ist
        ganzseitig (§7), und Todesfall, Vorsorge, Koppeln und Beitreten sind
        lineare Abläufe mit genau einem nächsten Schritt. Eine Leiste, die
        mitten in einer Kopplung vier andere Wege anbietet, ist dort keine
        Orientierung, sondern eine Abbruchkante.

        Start trägt die Fallsperre selbst: Ohne Fall ist die App gesperrt, und
        dann steht dort der Screen mit den drei Schaltflächen.
      */}
      <Route
        path="/"
        element={
          <Rahmen>
            <Start />
          </Rahmen>
        }
      />
      <Route
        path="/erbe"
        element={
          <Rahmen>
            <Erbe />
          </Rahmen>
        }
      />
      <Route
        path="/alle"
        element={
          <Rahmen>
            <Alle />
          </Rahmen>
        }
      />
      {/* Das ganzseitige Aufgabendetail (§7). */}
      <Route path="/aufgabe/:id" element={<Aufgabe />} />
      <Route path="/todesfall" element={<Todesfall />} />
      <Route path="/vorsorge" element={<Vorsorge />} />
      {/*
        Beide Zwecke aus §6 auf demselben Screen, mit verschiedenen Wegen
        hinein: "Ich wurde eingeladen" aus der Fallweiche, "Dieses Gerät
        freischalten" aus Start und Profil. Der Ablauf ist identisch (§6).
      */}
      <Route path="/beitreten" element={<Beitreten zweck="join" />} />
      <Route path="/geraet-freischalten" element={<Beitreten zweck="device" />} />
      <Route path="/koppeln" element={<Koppeln />} />
      <Route
        path="/profil"
        element={
          <Rahmen>
            <Profil />
          </Rahmen>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
