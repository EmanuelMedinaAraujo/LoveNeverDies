import { Button } from '../../../ui/Button/Button.tsx'
import { Card } from '../../../ui/Card/Card.tsx'
import type { AbgelehnteAenderung } from '../../../services/aufgabenService.ts'
import type { Uebernahme } from '../../../hooks/useAufgaben.ts'
import stile from './Meldungen.module.css'

/**
 * Was schiefgegangen ist, in Worten (DESIGN.md §5, §7).
 *
 * Zwei Mitteilungen, dieselbe Regel: Nichts verschwindet still, und nichts
 * verschwindet von selbst. Ein Zeitablauf wäre wieder das stille Verschwinden,
 * das §5 ausschließt — weg geht die Mitteilung nur, wenn jemand sie zur
 * Kenntnis nimmt.
 *
 * Sie stehen hier und nicht in einem Screen, weil beide auf mehreren Screens
 * auftreten können: Wer auf Start ein Häkchen setzt, muss dort erfahren, dass
 * der Server es verworfen hat, und nicht erst in „Alle".
 */

/** Wie die drei Operationen heissen, wenn eine Mitteilung von ihnen erzählt. */
const WAS: Record<AbgelehnteAenderung['was'], string> = {
  anlegen: 'Anlegen',
  aendern: 'Ändern',
  loeschen: 'Löschen',
}

/**
 * Was der Server verworfen hat (§5).
 *
 * „Abgelehnte Mutationen werden nie stillschweigend verworfen, sondern mit
 * ihrem entschlüsselten Inhalt als Mitteilung angezeigt." Beides steht hier:
 * die Zahl, weil drei verlorene Änderungen etwas anderes sind als eine, und der
 * Titel, weil „eine Änderung konnte nicht gespeichert werden" niemandem sagt,
 * was er noch einmal tippen muss.
 */
export function Abgelehnt({
  aenderungen,
  aufBestaetigen,
}: {
  aenderungen: AbgelehnteAenderung[]
  aufBestaetigen: () => void
}) {
  return (
    <Card>
      <p role="alert">
        {aenderungen.length === 1
          ? 'Eine Änderung konnte nicht gespeichert werden.'
          : `${aenderungen.length} Änderungen konnten nicht gespeichert werden.`}
      </p>

      <ul className={stile.liste}>
        {aenderungen.map((aenderung, stelle) => (
          <li key={`${aenderung.itemId}:${stelle}`} className={stile.hinweis}>
            {/*
              Ohne Titel bleibt es beim Vorgang. Das passiert, wenn die Zeile
              inzwischen ein Tombstone ist — dann gibt es keinen DEK mehr, unter
              dem sich der Payload lesen liesse (§5).
            */}
            {aenderung.titel === ''
              ? `${WAS[aenderung.was]} einer Aufgabe: ${aenderung.grund}`
              : `${WAS[aenderung.was]} von „${aenderung.titel}“: ${aenderung.grund}`}
          </li>
        ))}
      </ul>

      <Button variante="sekundaer" onClick={aufBestaetigen}>
        Verstanden
      </Button>
    </Card>
  )
}

/**
 * Reservierungen, die an jemand anderen gegangen sind (§7).
 *
 * „Greifen zwei gleichzeitig zu, gewinnt LWW, und die unterlegene Person
 * bekommt 'Bert hat diese Aufgabe übernommen' statt eines stillen Verlusts."
 * Genau dieser Satz steht hier — mit dem Titel dabei, denn in einer Liste von
 * vierzig Aufgaben ist „diese" keine Auskunft.
 */
export function Uebernahmen({
  uebernahmen,
  aufBestaetigen,
}: {
  uebernahmen: Uebernahme[]
  aufBestaetigen: () => void
}) {
  return (
    <Card>
      <ul className={stile.liste}>
        {uebernahmen.map((uebernahme) => (
          <li key={uebernahme.itemId} role="alert">
            {uebernahme.name} hat diese Aufgabe übernommen: „{uebernahme.titel}“
          </li>
        ))}
      </ul>

      <Button variante="sekundaer" onClick={aufBestaetigen}>
        Verstanden
      </Button>
    </Card>
  )
}
