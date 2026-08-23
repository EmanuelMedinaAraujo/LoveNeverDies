import { useEffect } from 'react'
import { Link, Navigate, Route, Routes } from 'react-router-dom'
import { useAuth } from '../core/auth/authProvider.ts'
import { speicherDauerhaftAnfordern } from '../core/storage/persist.ts'
import { useAnsichtsmodus } from '../hooks/useAnsichtsmodus.ts'
import { useCase } from '../hooks/useCase.ts'
import { useGeraeteanmeldung } from '../hooks/useGeraete.ts'
import { fallBeschriftung } from '../services/fallbeschriftung.ts'
import type { Fall } from '../services/fallService.ts'
import { Alle } from '../screens/shared/Alle/Alle.tsx'
import { Anmelden } from '../screens/shared/Anmelden/Anmelden.tsx'
import { KeinFall } from '../screens/shared/KeinFall/KeinFall.tsx'
import { Profil } from '../screens/shared/Profil/Profil.tsx'
import { Todesfall } from '../screens/shared/Todesfall/Todesfall.tsx'
import stile from './App.module.css'

function Ladeanzeige({ text }: { text: string }) {
  return (
    <div className={stile.ladeanzeige} role="status">
      {text}
    </div>
  )
}

/**
 * Der Fall selbst, sobald es einen gibt (§2). Es gibt noch keinen eigenen
 * Start-Screen mit den *zugewiesenen* Aufgaben — der kommt mit der Zuweisung,
 * die ihn füllt (§7). Bis dahin steht hier, wofür §2 die Beschriftung
 * verlangt: der Name der Person, kein Sammelbegriff, und der Weg zu "Alle".
 */
function Fallanzeige({ fall }: { fall: Fall }) {
  if (fall.zustand === 'gesperrt') {
    return (
      <main className={stile.start}>
        <h1>Fall gesperrt</h1>
        <p className={stile.hinweis} role="alert">
          {fall.grund}
        </p>
      </main>
    )
  }

  return (
    <main className={stile.start}>
      <h1>
        {fall.sterbedatum === null ? fall.personName : fallBeschriftung(fall.personName, fall.sterbedatum)}
      </h1>

      {/*
        Die untere Leiste aus §7 — Start · Erbe · Alle · Profil — kommt mit den
        Screens, die sie verbindet. Zwei davon gibt es, und die beiden Wege
        stehen so lange hier.
      */}
      <p className={stile.hinweis}>
        <Link to="/alle">Alle Aufgaben</Link>
      </p>
      <p className={stile.hinweis}>
        <Link to="/profil">Profil und Geräte</Link>
      </p>
    </main>
  )
}

/**
 * Die Fallsperre aus DESIGN.md §7: Ohne Fall ist die App gesperrt, es gibt einen
 * Screen mit drei Schaltflächen.
 */
function FallSperre() {
  const { zustand: fall } = useCase()

  if (fall.status === 'laedt') {
    return <Ladeanzeige text="Ihre Daten werden geladen…" />
  }

  if (fall.status === 'fehler') {
    return <Ladeanzeige text={`Ihre Fälle sind gerade nicht abrufbar. ${fall.nachricht}`} />
  }

  if (fall.status === 'kein-fall') {
    return <KeinFall />
  }

  return <Fallanzeige fall={fall.aktiver} />
}

export function App() {
  const ansichtsmodus = useAnsichtsmodus()
  const { zustand } = useAuth()

  /*
   * §7: Nach der Anmeldung entstehen beide Keypairs und das Gerät meldet sich
   * an — still, ohne sichtbaren Zwischenschritt. Der Rückgabewert wird hier
   * nicht gebraucht; Profil holt sich denselben Zustand noch einmal.
   */
  useGeraeteanmeldung()

  useEffect(() => {
    document.documentElement.dataset.dichte = ansichtsmodus
  }, [ansichtsmodus])

  useEffect(() => {
    /*
     * §7: läuft still mit. Schlägt es fehl, sagt die App nichts — ein Hinweis
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
      <Route path="/" element={<FallSperre />} />
      <Route path="/alle" element={<Alle />} />
      <Route path="/todesfall" element={<Todesfall />} />
      <Route path="/profil" element={<Profil />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
