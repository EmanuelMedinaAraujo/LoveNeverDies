import { useState, type ReactNode } from 'react'
import { AUSSCHLAGUNG, ERBSCHEIN, TESTAMENTSANFECHTUNG } from '../../../content/erbstatus.ts'
import type { Infoabschnitt, Infotext } from '../../../types/infotext.ts'
import stile from './ErbscheinInfo.module.css'

type KlappAbschnitt = {
  titel: string
  inhalte: Infoabschnitt[]
}

function parseAbschnitte(text: Infotext): KlappAbschnitt[] {
  const ergebnis: KlappAbschnitt[] = []
  let aktuellerTitel = ''
  let aktuelleInhalte: Infoabschnitt[] = []

  for (const abschnitt of text.abschnitte) {
    if (abschnitt.art === 'zwischentitel') {
      if (aktuellerTitel !== '') {
        ergebnis.push({ titel: aktuellerTitel, inhalte: aktuelleInhalte })
      }
      aktuellerTitel = abschnitt.text
      aktuelleInhalte = []
    } else {
      aktuelleInhalte.push(abschnitt)
    }
  }

  if (aktuellerTitel !== '') {
    ergebnis.push({ titel: aktuellerTitel, inhalte: aktuelleInhalte })
  }

  return ergebnis
}

function mitFett(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|\[gruen:[^\]]+\]|\[rot:[^\]]+\])/g).map((teil, nummer) => {
    if (teil.startsWith('**') && teil.endsWith('**')) {
      return <strong key={nummer}>{mitFett(teil.slice(2, -2))}</strong>
    }
    if (teil.startsWith('[gruen:') && teil.endsWith(']')) {
      return (
        <span key={nummer} className={stile.gruen}>
          {mitFett(teil.slice(7, -1))}
        </span>
      )
    }
    if (teil.startsWith('[rot:') && teil.endsWith(']')) {
      return (
        <span key={nummer} className={stile.rot}>
          {mitFett(teil.slice(5, -1))}
        </span>
      )
    }
    return teil
  })
}

function KlappEintrag({ abschnitt }: { abschnitt: KlappAbschnitt }) {
  const [offen, setzeOffen] = useState(false)

  return (
    <li className={stile.eintrag}>
      <details onToggle={(ereignis) => setzeOffen(ereignis.currentTarget.open)}>
        <summary className={stile.titel}>
          <span>{mitFett(abschnitt.titel)}</span>
          <span className={stile.schalter}>{offen ? 'Zuklappen' : 'Anzeigen'}</span>
        </summary>

        <div>
          {abschnitt.inhalte.map((inhalt, idx) => {
            if (inhalt.art === 'absatz') {
              return (
                <p key={idx} className={stile.inhalt} style={{ whiteSpace: 'pre-line' }}>
                  {mitFett(inhalt.text)}
                </p>
              )
            }
            if (inhalt.art === 'punkte') {
              return (
                <ul key={idx} className={stile.punkte}>
                  {inhalt.punkte.map((punkt, pIdx) => (
                    <li key={pIdx}>{mitFett(punkt)}</li>
                  ))}
                </ul>
              )
            }
            return null
          })}
        </div>
      </details>
    </li>
  )
}

export function InfoKlappListe({
  infotext,
  ariaLabel,
}: {
  infotext: Infotext
  ariaLabel: string
}): ReactNode {
  const abschnitte = parseAbschnitte(infotext)

  return (
    <ul className={stile.liste} aria-label={ariaLabel}>
      {abschnitte.map((abschnitt) => (
        <KlappEintrag key={abschnitt.titel} abschnitt={abschnitt} />
      ))}
    </ul>
  )
}

/**
 * Die Hintergrundinformationen zum Erbschein als einklappbare Abschnitte.
 */
export function ErbscheinInfo(): ReactNode {
  return <InfoKlappListe infotext={ERBSCHEIN} ariaLabel="Informationen zum Erbschein" />
}

/**
 * Die Hintergrundinformationen zur Testamentsanfechtung als einklappbare Abschnitte.
 */
export function AnfechtungInfo(): ReactNode {
  return (
    <InfoKlappListe
      infotext={TESTAMENTSANFECHTUNG}
      ariaLabel="Informationen zur Testamentsanfechtung"
    />
  )
}

/**
 * Die Hintergrundinformationen zur Ausschlagung als einklappbare Abschnitte.
 */
export function AusschlagungInfo(): ReactNode {
  return <InfoKlappListe infotext={AUSSCHLAGUNG} ariaLabel="Informationen zur Ausschlagung" />
}
