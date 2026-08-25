import type { ReactNode } from 'react'
import { useCase } from '../hooks/useCase.ts'
import { Leiste } from '../ui/Leiste/Leiste.tsx'
import stile from './Rahmen.module.css'

/**
 * Ein Hauptscreen mit der unteren Leiste darunter (DESIGN.md §7).
 *
 * Die Leiste selbst ist eine Darstellung ohne Wissen über Fälle; sie steht in
 * `src/ui` und bekommt gesagt, was sie zeigen soll. Was sie zeigen soll, weiß
 * diese Schicht: `useCase` gehört zu `hooks`, und `ui` darf `hooks` nicht
 * importieren (§9). Die Trennung ist nicht Zeremonie — sie ist der Grund, warum
 * die Leiste in einem Screentest ohne Supabase-Attrappe zu prüfen ist.
 */
export function Rahmen({ children }: { children: ReactNode }) {
  const { zustand } = useCase()

  /*
   * §3.6: Ein gesperrter Fall in der Liste heißt, dieses Gerät wartet auf seine
   * Freigabe. Ablesbar ist das nur lokal: Die Wraps fremder Geräte sieht dieses
   * Gerät nicht (§4), also kann nur das wartende Gerät selbst den Hinweis
   * zeigen.
   */
  const freigabeNoetig =
    zustand.status === 'bereit' && zustand.faelle.some((eintrag) => eintrag.zustand === 'gesperrt')

  return (
    <>
      <div className={stile.inhalt}>{children}</div>
      <Leiste freigabeNoetig={freigabeNoetig} ohneFall={zustand.status === 'kein-fall'} />
    </>
  )
}
