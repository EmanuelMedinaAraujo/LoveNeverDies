import { useEffect, useRef, useState } from 'react'

/** Wo ein Feld zwischen "getippt" und "liegt auf dem Server" gerade steht. */
export type Speicherstand = 'ruht' | 'wartet' | 'gespeichert'

/**
 * Speichert von selbst, kurz nachdem jemand aufgehört hat zu tippen (§5, §7).
 *
 * Ein Feld mit einer Schaltfläche daneben ist eine Zusage, die man einlösen
 * muss: Wer den Tag einträgt und weiterscrollt, hat ihn nicht eingetragen. Auf
 * einem Telefon passiert genau das, weil die Tastatur die Schaltfläche
 * verdeckt, die man danach hätte drücken sollen. Die Frist, die dann fehlt,
 * ist die eine Angabe, wegen der dieser Screen überhaupt da ist (§8).
 *
 * Genau ein Versuch je Wert, und das ist der Unterschied zwischen "speichert
 * von selbst" und einer Schleife: Weist der Server die Änderung ab, bleibt der
 * getippte Wert stehen und der gespeicherte daneben — die Bedingung "es gibt
 * etwas zu speichern" bliebe für immer wahr, und der Screen versuchte es alle
 * 800 ms erneut. Wer weiterkommen will, ändert etwas; das ist ein neuer Wert
 * und damit ein neuer Versuch.
 *
 * Steht in `hooks/` und nicht in einem Screen, seit beide Ansichten dieselbe
 * Zusage geben: Die einfache und die erweiterte Aufgabe speichern ihr
 * Kenntnisdatum auf demselben Weg, und zwei Kopien dieser Schleife wären zwei
 * Gelegenheiten, sie verschieden zu reparieren.
 *
 * @param eingabe was im Feld steht.
 * @param gespeichert was im Bestand steht.
 * @param gesperrt solange eine andere Mutation läuft. Dann wird gewartet, statt
 * zwei Änderungen ineinander zu schieben.
 */
export function useAutospeichern(
  eingabe: string,
  gespeichert: string,
  gesperrt: boolean,
  speichere: () => void,
): Speicherstand {
  /*
   * Die Funktion kommt bei jedem Rendern neu herein: Die Screens schreiben sie
   * inline. Im Ref gelesen, hängt der Wecker unten nicht an ihrer Identität und
   * fängt nicht bei jedem Tastendruck von vorn an.
   */
  const speichereRef = useRef(speichere)

  useEffect(() => {
    speichereRef.current = speichere
  })

  const versucht = useRef<string | null>(null)
  const [stand, setzeStand] = useState<Speicherstand>('ruht')

  useEffect(() => {
    if (eingabe === gespeichert) {
      // Angekommen. Ob das eigene Tippen der Grund war oder eine Änderung von
      // einem anderen Gerät, spielt für die Meldung keine Rolle: Beides heisst,
      // dass hier nichts mehr aussteht.
      const gerade = versucht.current
      versucht.current = null
      setzeStand(gerade === null ? 'ruht' : 'gespeichert')
      return
    }

    if (gesperrt || versucht.current === eingabe) {
      return
    }

    setzeStand('wartet')

    const wecker = setTimeout(() => {
      versucht.current = eingabe
      speichereRef.current()
    }, 800)

    return () => clearTimeout(wecker)
  }, [eingabe, gespeichert, gesperrt])

  return stand
}
