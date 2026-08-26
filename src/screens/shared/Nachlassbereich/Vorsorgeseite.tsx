import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { useCase } from '../../../hooks/useCase.ts'
import { istVorsorgende, type LesbarerFall } from '../../../services/fallService.ts'
import { fallLadeText } from '../Ladeanzeige/FallLadeanzeige.tsx'
import stile from './Nachlassbereich.module.css'

/**
 * Die Türsteherin vor jeder Seite des Nachlass-Bereichs (DESIGN.md §3.5).
 *
 * Sechs Seiten stellen dieselben fünf Fragen, bevor sie überhaupt etwas
 * anzeigen können: Ist der Fall geladen? Gibt es einen? Ließ er sich lesen?
 * Ist dieses Gerät freigeschaltet? Und gehört der Fall dieser Person als
 * eigene Vorsorge? Sechsmal derselbe Block wäre sechsmal die Gelegenheit,
 * einen der Zweige zu vergessen — und der vergessene Zweig ist immer der, in
 * dem etwas fehlt.
 *
 * Wer hier nicht hingehört, landet auf der Startseite und nicht auf einer
 * Fehlermeldung: Angehörige eines Vorsorgefalls haben ihren eigenen Weg (den
 * Tab „Erbe"), und wer die Adresse aus einem alten Lesezeichen aufruft, soll
 * dort ankommen, wo die App für ihn anfängt.
 *
 * Der Fall kommt als Argument in die Seite hinein, nicht als zweiter Aufruf
 * von `useCase`: Danach ist er ein `LesbarerFall` und kein `Fall | null`, und
 * keine der sechs Seiten muss die Prüfung wiederholen, die hier schon
 * stattgefunden hat.
 */
export function Vorsorgeseite({ kinder }: { kinder: (fall: LesbarerFall) => ReactNode }) {
  const { zustand } = useCase()

  if (zustand.status === 'laedt' || zustand.status === 'schluessel-erneuerung') {
    return (
      <main className={stile.seite}>
        <p className={stile.hinweis} role="status">
          {fallLadeText(zustand.status)}
        </p>
      </main>
    )
  }

  if (zustand.status === 'kein-fall') {
    return <Navigate to="/" replace />
  }

  if (zustand.status === 'fehler') {
    return (
      <main className={stile.seite}>
        <p className={stile.warnung} role="alert">
          Der Fall war nicht zu laden: {zustand.nachricht}
        </p>
      </main>
    )
  }

  /*
   * §3.6: Ein gesperrter Fall heisst, dass dieses Gerät auf seine Freigabe
   * wartet. Der Weg dorthin steht in Profil; hier steht, warum nichts dasteht.
   */
  if (zustand.aktiver.zustand === 'gesperrt') {
    return (
      <main className={stile.seite}>
        <p className={stile.warnung} role="alert">
          Dieser Fall ist auf diesem Gerät gesperrt: {zustand.aktiver.grund}
        </p>
      </main>
    )
  }

  if (!istVorsorgende(zustand.aktiver)) {
    return <Navigate to="/" replace />
  }

  return <>{kinder(zustand.aktiver)}</>
}
