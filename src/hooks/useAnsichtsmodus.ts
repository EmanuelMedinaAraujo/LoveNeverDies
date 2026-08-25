import { useCallback, useSyncExternalStore } from 'react'
import {
  ansichtAbonnieren,
  ansichtLesen,
  ansichtSchreiben,
  type Ansichtseinstellungen,
  type Ansichtsmodus,
  type Darstellung,
  type Textgroesse,
} from '../core/storage/ansicht.ts'

export type { Ansichtsmodus, Darstellung, Textgroesse } from '../core/storage/ansicht.ts'

/**
 * Einfach oder Erweitert, Textgröße, Darstellung (DESIGN.md §7).
 *
 * Die Ansichtswahl trifft das Onboarding, noch bevor die Fallweiche kommt;
 * damit erscheinen alle folgenden Screens bereits im gewählten Modus. In
 * Profil lässt sie sich umschalten, und dort stehen auch die beiden Overrides
 * für Textgröße und Darstellung, beide auf "Systemeinstellung folgen".
 *
 * Der Modus landet als `data-dichte` an der Wurzel und schaltet damit die
 * Dichtetokens in `ui/tokens.css` um; die Primitiven lesen ausschließlich diese
 * Tokens. Welche Screens er wählt, entscheidet `app/App.tsx`: `Start`,
 * `Aufgabe` und `Alle` gibt es zweimal, `Erbe` und `Profil` genau einmal (§7).
 *
 * Der Bestand liegt im Modul (`core/storage/ansicht.ts`) und nicht in einem
 * Kontext. Ein Provider hätte hier nichts zu tragen, was ein Abonnement nicht
 * auch trägt, und der eine Effekt, der die Wurzel setzt, sitzt ohnehin in der
 * App.
 */

export function useAnsicht(): Ansichtseinstellungen & {
  waehleModus: (modus: Ansichtsmodus) => void
  waehleTextgroesse: (groesse: Textgroesse) => void
  waehleDarstellung: (darstellung: Darstellung) => void
} {
  const einstellungen = useSyncExternalStore(ansichtAbonnieren, ansichtLesen, ansichtLesen)

  const waehleModus = useCallback((modus: Ansichtsmodus) => ansichtSchreiben({ modus }), [])
  const waehleTextgroesse = useCallback(
    (textgroesse: Textgroesse) => ansichtSchreiben({ textgroesse }),
    [],
  )
  const waehleDarstellung = useCallback(
    (darstellung: Darstellung) => ansichtSchreiben({ darstellung }),
    [],
  )

  return { ...einstellungen, waehleModus, waehleTextgroesse, waehleDarstellung }
}

/**
 * Der Modus, in dem gerendert wird.
 *
 * Solange die Wahl aussteht, gilt "einfach": Das Onboarding hat sie
 * vorausgewählt (§7), und der Screen, auf dem gewählt wird, soll so aussehen,
 * wie die App danach aussieht, wenn man nichts ändert.
 */
export function useAnsichtsmodus(): Ansichtsmodus {
  return useAnsicht().modus ?? 'einfach'
}
