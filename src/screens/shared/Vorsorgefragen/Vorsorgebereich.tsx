import { useAufgaben } from '../../../hooks/useAufgaben.ts'
import { useCase } from '../../../hooks/useCase.ts'
import { useTresor } from '../../../hooks/useTresor.ts'
import type { LesbarerFall } from '../../../services/fallService.ts'
import { Card } from '../../../ui/Card/Card.tsx'
import { Vorsorgefragen } from './Vorsorgefragen.tsx'
import stile from './Vorsorgefragen.module.css'

/**
 * Was auf dem ersten Screen steht, wenn der Fall ein Vorsorgefall ist
 * (DESIGN.md §2, §3.5, §7).
 *
 * Ein Vorsorgefall hat keine Aufgaben: kein Sterbedatum, kein Rechtskatalog
 * (§2). Wer vorsorgt, sähe auf "Meine Aufgaben" also für immer den Satz "Für
 * Sie ist gerade nichts eingetragen" — richtig und nutzlos. An dieser Stelle
 * stehen stattdessen die acht Fragen, die den Angehörigen später die Suche
 * ersparen.
 *
 * Nur für die vorsorgende Person (§3.5). Angehörige sind in diesem Fall
 * Mitglied, ohne `K_v` zu haben: Sie können die Antworten nicht lesen und
 * sollen sie nicht geben. Bei ihnen steht hier ein Satz, was dieser Fall ist.
 *
 * Derselbe Sync-Stream wie überall (§5): ein Delta, ein Cache, eine Queue je
 * Fall. Deshalb liest dieser Bereich `zeilen` aus `useAufgaben` und legt
 * keinen zweiten daneben.
 */
export function Vorsorgebereich({ fall }: { fall: LesbarerFall }) {
  const { aktualisiere } = useCase()
  const { zustand, zeilen, mutiere } = useAufgaben(fall)
  const { items, istPreparer, speichereAntwort } = useTresor(fall, zeilen, mutiere, aktualisiere)

  if (zustand.status === 'laedt') {
    return (
      <p className={stile.hinweis} role="status">
        Ihre Vorsorgefragen werden geladen…
      </p>
    )
  }

  if (!istPreparer) {
    return (
      <Card>
        <p className={stile.hinweis}>
          Dies ist der Vorsorgefall von {fall.personName}. Was dort hinterlegt ist, liegt im
          Tresor und wird erst nach dem Trauerfall lesbar.
        </p>
      </Card>
    )
  }

  return (
    <>
      <Card>
        <p className={stile.hinweis}>
          Diese Fragen ersparen Ihren Angehörigen später das Suchen. Sie müssen sie nicht auf
          einmal beantworten: Jede Antwort wird für sich gespeichert, und ändern können Sie sie
          jederzeit — hier oder im Tab „Erbe &amp; Tresor“. Ihre Antworten liegen verschlüsselt
          in Ihrem Tresor; Angehörige lesen sie erst im Trauerfall.
        </p>
      </Card>

      <Vorsorgefragen items={items} onSpeichern={speichereAntwort} />
    </>
  )
}
