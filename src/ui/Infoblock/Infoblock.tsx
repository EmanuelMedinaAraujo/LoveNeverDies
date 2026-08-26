import type { Infotext } from '../../types/infotext.ts'
import stile from './Infoblock.module.css'

/**
 * Ein gegliederter Erklaertext (DESIGN.md §8).
 *
 * Er steht an drei Stellen: hinter dem Wort "Erbe" (Erbschein,
 * Erbengemeinschaft, Alleinerbe), vor der Nachlass-Checkliste und auf der
 * Seite zum Testament. Bis hierher gab es ihn nur im Erbe-Screen als private
 * Funktion; die zweite Verwendung waere eine zweite Fassung geworden, und
 * zwei Fassungen desselben Kastens driften auseinander -- die eine bekommt
 * gefuellte Punkte, die andere Striche.
 *
 * Die Aufzaehlung ist eine `ul` und traegt damit gefuellte Punkte, in beiden
 * Ansichten und auch dann, wenn jemand den Text vorgelesen bekommt: Eine
 * Vorlesestimme sagt "Liste mit fuenf Eintraegen". Punkte, die als Zeichen im
 * Text stuenden, sagte sie mit vor.
 *
 * Der Titel ist ein `h3`: Der Kasten steht in einer Karte, deren Ueberschrift
 * ein `h2` ist, und unter einer Seitenueberschrift `h1`. Wo er ohne Karte
 * steht, laesst sich die Ebene mit `titelEbene` heben, damit die Gliederung
 * fuer eine Vorlesestimme keine Stufe ueberspringt.
 */
export function Infoblock({
  text,
  titelEbene = 'h3',
}: {
  text: Infotext
  titelEbene?: 'h2' | 'h3'
}) {
  const Titel = titelEbene

  return (
    <div className={stile.info}>
      <Titel className={stile.titel}>{text.titel}</Titel>

      {text.abschnitte.map((abschnitt) =>
        abschnitt.art === 'punkte' ? (
          <ul key={abschnitt.punkte.join('|')} className={stile.punkte}>
            {abschnitt.punkte.map((punkt) => (
              <li key={punkt}>{punkt}</li>
            ))}
          </ul>
        ) : (
          <p
            key={abschnitt.text}
            className={abschnitt.art === 'zwischentitel' ? stile.zwischentitel : stile.absatz}
          >
            {abschnitt.text}
          </p>
        ),
      )}
    </div>
  )
}
