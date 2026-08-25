import { useState } from 'react'
import { useAnsicht, type Ansichtsmodus } from '../../../hooks/useAnsichtsmodus.ts'
import { Button } from '../../../ui/Button/Button.tsx'
import stile from './Ansichtswahl.module.css'

/**
 * "Wie möchten Sie die App nutzen?" (DESIGN.md §7).
 *
 * Der erste Screen nach der Anmeldung und **vor der Fallweiche**. Das ist keine
 * Reihenfolge aus Bequemlichkeit: Wer zuerst einen Todesfall anlegt und danach
 * gefragt wird, wie er die App sehen möchte, hat den schwersten Screen dieser
 * App bereits in der falschen Ansicht hinter sich. So erscheint alles, was
 * folgt, schon im gewählten Modus.
 *
 * "Einfach" ist vorausgewählt, und zwar wörtlich so wie §7 es verlangt. Die
 * Person, um die es geht, ist die 78-jährige Witwe, die zwei Tage nach dem Tod
 * ihres Mannes eine Ausschlagungsfrist einhalten soll; sie sucht in diesem
 * Moment keine Einstellungen aus. Wer die andere Fassung will, sieht sie
 * daneben stehen und wählt sie.
 *
 * Umgestellt wird später in Profil, jederzeit und in beide Richtungen (§7). Der
 * Screen sagt das, damit die Wahl hier nicht schwerer wiegt, als sie ist.
 */

const WAHL: { modus: Ansichtsmodus; titel: string; erklaerung: string }[] = [
  {
    modus: 'einfach',
    titel: 'Einfach',
    erklaerung: 'Große Schrift, wenige Schaltflächen, ein Schritt nach dem anderen.',
  },
  {
    modus: 'erweitert',
    titel: 'Erweitert',
    erklaerung: 'Mehr auf einem Bildschirm: Fristen sortieren, Aufgaben verteilen, Notizen.',
  },
]

export function Ansichtswahl() {
  const { waehleModus } = useAnsicht()

  /*
   * Die Vorauswahl steht hier und nicht im Speicher: Solange niemand
   * "Weiter" gedrückt hat, ist die Frage unbeantwortet, und ein Neustart
   * mitten im Onboarding soll sie wieder stellen. Geschrieben wird genau
   * einmal, und dann ist sie beantwortet.
   */
  const [gewaehlt, setzeGewaehlt] = useState<Ansichtsmodus>('einfach')

  return (
    <main className={stile.seite}>
      <div className={stile.kopf}>
        <h1>Wie möchten Sie die App nutzen?</h1>
        <p className={stile.hinweis}>Sie können jederzeit in Profil wechseln.</p>
      </div>

      <fieldset className={stile.auswahl}>
        {/*
          Die Frage steht schon als Überschrift darüber. Die Legende wiederholt
          sie für die Vorlesestimme, weil ein `fieldset` ohne `legend` eine
          Gruppe ohne Namen ist — sichtbar wäre sie zweimal dieselbe Zeile.
        */}
        <legend className="nur-vorlesen">Wie möchten Sie die App nutzen?</legend>

        {WAHL.map((eintrag) => (
          <label
            key={eintrag.modus}
            className={[stile.zeile, gewaehlt === eintrag.modus ? stile.aktiv : null]
              .filter(Boolean)
              .join(' ')}
          >
            <input
              className={stile.feld}
              type="radio"
              name="ansicht"
              value={eintrag.modus}
              checked={gewaehlt === eintrag.modus}
              onChange={() => setzeGewaehlt(eintrag.modus)}
            />
            <span className={stile.text}>
              <span className={stile.titel}>{eintrag.titel}</span>
              <span className={stile.erklaerung}>{eintrag.erklaerung}</span>
            </span>
          </label>
        ))}
      </fieldset>

      <Button volleBreite onClick={() => waehleModus(gewaehlt)}>
        Weiter
      </Button>
    </main>
  )
}
