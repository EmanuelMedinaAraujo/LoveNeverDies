import { useEffect } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { useAuth } from '../core/auth/authProvider.ts'
import { speicherDauerhaftAnfordern } from '../core/storage/persist.ts'
import { useAnsichtsmodus } from '../hooks/useAnsichtsmodus.ts'
import { useCase } from '../hooks/useCase.ts'
import { Anmelden } from '../screens/shared/Anmelden/Anmelden.tsx'
import { KeinFall } from '../screens/shared/KeinFall/KeinFall.tsx'
import stile from './App.module.css'

function Ladeanzeige({ text }: { text: string }) {
  return (
    <div className={stile.ladeanzeige} role="status">
      {text}
    </div>
  )
}

/**
 * Die Fallsperre aus DESIGN.md §7: Ohne Fall ist die App gesperrt, es gibt einen
 * Screen mit drei Schaltflächen.
 */
function FallSperre() {
  const fall = useCase()

  if (fall.status === 'laedt') {
    return <Ladeanzeige text="Ihre Daten werden geladen…" />
  }

  return <KeinFall />
}

export function App() {
  const ansichtsmodus = useAnsichtsmodus()
  const { zustand } = useAuth()

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
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
