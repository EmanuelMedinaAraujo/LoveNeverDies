import { Button } from '../../../ui/Button/Button.tsx'
import { Checkbox } from '../../../ui/Checkbox/Checkbox.tsx'
import {
  ALLE,
  NIEMAND,
  istFrei,
  istZugewiesen,
  mitPerson,
  nameVon,
  ohnePerson,
  zuweisungText,
  type Zugewiesene,
  type Zuweisung,
} from '../../../services/zuweisung.ts'
import stile from './Zuweisungsfeld.module.css'

/**
 * Wer sich um eine Aufgabe kümmert (DESIGN.md §7).
 *
 * Drei Handgriffe, in der Reihenfolge, in der eine Familie sie braucht:
 * übernehmen, wieder freigeben, jemanden eintragen. „Alle" steht als eigener
 * Wert daneben und nicht als Liste aller Namen — angehakt heißt es „das geht
 * jede:n an", und nicht „hier stehen zufällig gerade alle drin".
 *
 * **Freigeben darf jede:r**, nicht nur die eingetragene Person (§7). In einer
 * Familie fällt jemand aus, und eine Aufgabe, die niemand mehr freigeben kann,
 * blockiert eine gesetzliche Frist.
 *
 * Ein Mitglied ohne Namen heißt „Weiteres Mitglied" — die Namenstabelle
 * `profiles` kommt mit der Kopplung (#10, §3.3), und bis dahin kennt dieses
 * Gerät nur die Namen, die in den Zuweisungen des Falls stehen. Weggelassen
 * wird deshalb niemand: Eine unsichtbare Person ist schlimmer als eine ohne
 * Namen.
 */
export function Zuweisungsfeld({
  zuweisung,
  ich,
  mitglieder,
  gesperrt,
  aufSetzen,
}: {
  zuweisung: Zuweisung
  ich: Zugewiesene
  /** Die Mitglieder des Falls, benannt so gut es geht (`benenne`). */
  mitglieder: Zugewiesene[]
  gesperrt: boolean
  aufSetzen: (zuweisung: Zuweisung) => void
}) {
  const alle = zuweisung.art === 'alle'

  /**
   * Eine Person an- oder abwählen.
   *
   * Aus „Alle" heraus wird dabei die Art gewechselt, und zwar unabhängig davon,
   * in welche Richtung das Kästchen kippt: Bei „Alle" stehen alle Häkchen, ein
   * Tipp auf eine Person kommt also als „abwählen" an — gemeint ist aber „nur
   * sie". Ein Klick, der sichtbar nichts tut, wäre die schlechtere Antwort.
   */
  function schalte(person: Zugewiesene, an: boolean) {
    if (alle) {
      aufSetzen(mitPerson(NIEMAND, person))
      return
    }

    aufSetzen(an ? mitPerson(zuweisung, person) : ohnePerson(zuweisung, person.userId))
  }

  return (
    <div className={stile.feld}>
      <p role="status">Zuständig: {zuweisungText(zuweisung, ich.userId)}</p>

      <div className={stile.aktionen}>
        {istZugewiesen(zuweisung, ich.userId) ? null : (
          <Button disabled={gesperrt} onClick={() => aufSetzen(mitPerson(zuweisung, ich))}>
            Übernehmen
          </Button>
        )}

        {istFrei(zuweisung) ? null : (
          <Button variante="sekundaer" disabled={gesperrt} onClick={() => aufSetzen(NIEMAND)}>
            Freigeben
          </Button>
        )}
      </div>

      <fieldset className={stile.auswahl}>
        <legend className={stile.legende}>Wem ist sie zugewiesen?</legend>

        <Checkbox
          checked={alle}
          disabled={gesperrt}
          onChange={(ereignis) => aufSetzen(ereignis.target.checked ? ALLE : NIEMAND)}
          label="Alle"
        />

        {mitglieder.map((person) => (
          <Checkbox
            key={person.userId}
            checked={alle || istZugewiesen(zuweisung, person.userId)}
            // Bei „Alle" ist jede:r zugewiesen; die einzelnen Häkchen zeigen das
            // und lassen sich trotzdem anfassen — wer eines antippt, meint
            // genau diese Person und nicht mehr alle.
            disabled={gesperrt}
            onChange={(ereignis) => schalte(person, ereignis.target.checked)}
            label={nameVon(person, ich.userId)}
          />
        ))}
      </fieldset>
    </div>
  )
}
