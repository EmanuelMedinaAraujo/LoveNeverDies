import type { ReactNode } from 'react'
import { useCase } from '../hooks/useCase.ts'
import { istVorsorgende } from '../services/fallService.ts'
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

  /*
   * §3.5: Im Vorsorgefall schaltet die Leiste auf „Nachlass · Alle · Profil"
   * um. `istVorsorgende` prüft `K_v`: Angehörige eines Vorsorgefalls behalten
   * die vier Tabs und finden dort den Weg zur Freigabe.
   */
  const vorsorge = zustand.status === 'bereit' && istVorsorgende(zustand.aktiver)

  /*
   * §7: Solange es keinen Fall gibt, steht auf jedem Hauptscreen der
   * Willkommen-Screen mit den drei Wegen — und darunter stand bisher eine
   * Leiste, deren vier Plätze zu zweien nirgendwohin führten und zu einem
   * zurück auf denselben Screen. Das Onboarding ist ein linearer Ablauf mit
   * genau einem nächsten Schritt, wie Todesfall, Vorsorge und Koppeln: Eine
   * Leiste ist dort keine Orientierung, sondern eine Abbruchkante.
   *
   * Der Weg zu Profil geht in diesem Zustand über den Link am Fuß des
   * Willkommen-Screens, und Profil trägt dann selbst einen Zurück-Weg.
   */
  const ohneFall = zustand.status === 'kein-fall'

  if (ohneFall) {
    return <div className={stile.inhaltOhneLeiste}>{children}</div>
  }

  return (
    <>
      <div className={stile.inhalt}>{children}</div>
      <Leiste freigabeNoetig={freigabeNoetig} vorsorge={vorsorge} />
    </>
  )
}
