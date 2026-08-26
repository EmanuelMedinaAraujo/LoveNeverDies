import { Button } from '../../../ui/Button/Button.tsx'
import {
  ALLE,
  NIEMAND,
  istFrei,
  istZugewiesen,
  mitPerson,
  zuweisungText,
  type Zugewiesene,
  type Zuweisung,
} from '../../../services/zuweisung.ts'
import { SymbolAlleLeute, SymbolFrei, SymbolPerson } from './Symbole.tsx'
import stile from './Zuweisungsfeld.module.css'

/**
 * Wer sich um eine Aufgabe kümmert (DESIGN.md §7).
 *
 * Eine Zeile: links die Antwort, rechts der Handgriff, der sie ändert. Die
 * Frage steht in der Überschrift darüber ("Zuständigkeit", "Wer kümmert
 * sich?") und wird hier nicht wiederholt; ein "Zuständig:" davor wäre
 * dieselbe Auskunft ein zweites Mal. Für die Vorlesestimme steht sie
 * trotzdem da: Die hört die Überschrift nicht zwangsläufig mit.
 *
 * Der Name trägt ein Zeichen vor sich, und zwar drei verschiedene: eine
 * Person, mehrere, eine offene Stelle. Es ersetzt den Namen nicht, es macht
 * den Zustand auf einen Blick unterscheidbar — auch beim Durchblättern
 * mehrerer Aufgaben.
 *
 * Höchstens zwei Schaltflächen, und welche, folgt aus dem Zustand:
 *
 * ```
 * frei              Übernehmen · Allen zuweisen
 * mir zugewiesen    Freigeben
 * jemand anderem    Übernehmen · Freigeben
 * ```
 *
 * "Freigeben" fehlt bei einer freien Aufgabe, weil es dort nichts zu lösen
 * gibt; "Allen zuweisen" steht nur dort, weil es aus einer bestehenden
 * Zuweisung heraus eine Verdrängung wäre und keine Ergänzung.
 *
 * Freigeben darf jede:r, nicht nur die eingetragene Person (§7). In einer
 * Familie fällt jemand aus, und eine Aufgabe, die niemand mehr freigeben kann,
 * blockiert eine gesetzliche Frist.
 */
export function Zuweisungsfeld({
  zuweisung,
  ich,
  gesperrt,
  aufSetzen,
  gross = false,
}: {
  zuweisung: Zuweisung
  ich: Zugewiesene
  gesperrt: boolean
  aufSetzen: (zuweisung: Zuweisung) => void
  /**
   * Die einfache Ansicht (§7): Der Name steht über den Schaltflächen statt
   * neben ihnen, und die gehen über die volle Breite. Zwei kleine Kästen
   * nebeneinander sind auf diesem Screen kein Angebot, sondern eine Hürde.
   */
  gross?: boolean
}) {
  const frei = istFrei(zuweisung)

  return (
    <div className={[stile.zeile, gross ? stile.gross : null].filter(Boolean).join(' ')}>
      <p className={[stile.wer, frei ? stile.offen : null].filter(Boolean).join(' ')} role="status">
        <span className={stile.zeichen} aria-hidden="true">
          {frei ? <SymbolFrei /> : zuweisung.art === 'alle' ? <SymbolAlleLeute /> : <SymbolPerson />}
        </span>
        <span className="nur-vorlesen">Zuständig: </span>
        <span className={stile.name}>{zuweisungText(zuweisung, ich.userId)}</span>
      </p>

      <div className={stile.aktionen}>
        {istZugewiesen(zuweisung, ich.userId) ? null : (
          <Button
            volleBreite={gross}
            disabled={gesperrt}
            onClick={() => aufSetzen(mitPerson(zuweisung, ich))}
          >
            {gross ? 'Ich übernehme das' : 'Übernehmen'}
          </Button>
        )}

        {frei ? (
          <Button
            variante="sekundaer"
            volleBreite={gross}
            disabled={gesperrt}
            onClick={() => aufSetzen(ALLE)}
          >
            Allen zuweisen
          </Button>
        ) : (
          <Button
            variante="sekundaer"
            volleBreite={gross}
            disabled={gesperrt}
            onClick={() => aufSetzen(NIEMAND)}
          >
            Freigeben
          </Button>
        )}
      </div>
    </div>
  )
}
