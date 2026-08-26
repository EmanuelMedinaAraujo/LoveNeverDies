import { useState, type FormEvent } from 'react'
import { alsNachricht } from '../../../core/fehler.ts'
import type { TresorItem } from '../../../services/tresorService.ts'
import { Badge } from '../../../ui/Badge/Badge.tsx'
import { Button } from '../../../ui/Button/Button.tsx'
import { Card } from '../../../ui/Card/Card.tsx'
import stile from './Nachlassbereich.module.css'

/**
 * Was im Tresor liegt, ohne zu einer Frage zu gehören (DESIGN.md §3.5).
 *
 * Acht Fragen decken viel ab und nicht alles: die Bankverbindung, der Ort des
 * Zweitschlüssels, ein Brief an die Tochter. Dafür steht dieser Bereich am
 * Ende des Formulars — nach den Fragen, weil er die Ausnahme ist, und vor der
 * Übersicht, weil er in sie mit hineingehört.
 *
 * Ein Eintrag hat einen Titel und einen Inhalt, und beide liegen unter `K_v`
 * wie jede Antwort darüber. Für die Angehörigen sieht er später aus wie alles
 * andere im geöffneten Tresor: ein Titel, den man antippt, und ein Text
 * darunter.
 *
 * Zugeklappt, solange niemand etwas hinzufügen will: Am Ende einer langen
 * Seite steht eine Schaltfläche mit einem Verb und kein leeres Formular, das
 * aussieht wie eine neunte unbeantwortete Frage.
 */
export function Weitereeintraege({
  eintraege,
  onNeu,
  onLoeschen,
}: {
  eintraege: TresorItem[]
  onNeu: (titel: string, inhalt: string) => Promise<void>
  onLoeschen: (item: TresorItem) => Promise<void>
}) {
  const [formOffen, setzeFormOffen] = useState(false)
  const [titel, setzeTitel] = useState('')
  const [inhalt, setzeInhalt] = useState('')
  const [laeuft, setzeLaeuft] = useState(false)
  const [fehler, setzeFehler] = useState<string | null>(null)
  const [zuLoeschen, setzeZuLoeschen] = useState<string | null>(null)

  function schliesse() {
    setzeFormOffen(false)
    setzeTitel('')
    setzeInhalt('')
    setzeFehler(null)
  }

  async function anlegen(ereignis: FormEvent) {
    ereignis.preventDefault()
    setzeLaeuft(true)
    setzeFehler(null)

    try {
      await onNeu(titel, inhalt)
      schliesse()
    } catch (ursache) {
      setzeFehler(alsNachricht(ursache))
    } finally {
      setzeLaeuft(false)
    }
  }

  async function loeschen(item: TresorItem) {
    setzeLaeuft(true)
    setzeFehler(null)

    try {
      await onLoeschen(item)
      setzeZuLoeschen(null)
    } catch (ursache) {
      setzeFehler(alsNachricht(ursache))
    } finally {
      setzeLaeuft(false)
    }
  }

  return (
    <Card>
      <div className={stile.statusKopf}>
        <h2 className={stile.abschnitt}>Weitere Einträge</h2>
        {eintraege.length === 0 ? null : (
          <Badge lage="ruhig">
            {eintraege.length} {eintraege.length === 1 ? 'Eintrag' : 'Einträge'}
          </Badge>
        )}
      </div>

      <p className={stile.hinweis}>
        Alles, was Ihre Angehörigen sonst noch wissen sollten und wonach oben nicht gefragt
        wird — eine Bankverbindung, der Ort des Zweitschlüssels, ein persönlicher Brief.
      </p>

      {fehler === null ? null : (
        <p className={stile.warnung} role="alert">
          {fehler}
        </p>
      )}

      {eintraege.length === 0 ? null : (
        <ul className={stile.liste}>
          {eintraege.map((item) => (
            <li key={item.id} className={stile.eintrag}>
              <div className={stile.eintragKopf}>
                <p className={stile.eintragTitel}>{item.titel}</p>
                {/*
                  Löschen mit Rückfrage: Ein Eintrag ist mit einem Griff weg,
                  und im Tresor liegt nichts, was man nebenan noch einmal
                  nachlesen könnte (§5).
                */}
                {zuLoeschen === item.id ? null : (
                  <Button
                    variante="text"
                    disabled={laeuft}
                    onClick={() => setzeZuLoeschen(item.id)}
                    aria-label={`„${item.titel}“ löschen`}
                  >
                    Löschen
                  </Button>
                )}
              </div>

              {item.inhalt === '' ? null : (
                <p className={stile.eintragInhalt}>{item.inhalt}</p>
              )}

              {zuLoeschen === item.id ? (
                <>
                  <p className={stile.hinweis}>
                    Diesen Eintrag aus dem Tresor entfernen? Das lässt sich nicht rückgängig
                    machen.
                  </p>
                  <div className={stile.knopfgruppe}>
                    <Button
                      variante="sekundaer"
                      disabled={laeuft}
                      onClick={() => void loeschen(item)}
                    >
                      Ja, Eintrag löschen
                    </Button>
                    <Button
                      variante="sekundaer"
                      disabled={laeuft}
                      onClick={() => setzeZuLoeschen(null)}
                    >
                      Abbrechen
                    </Button>
                  </div>
                </>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {formOffen ? (
        <form className={stile.formular} onSubmit={(ereignis) => void anlegen(ereignis)}>
          <div className={stile.feld}>
            <label htmlFor="tresor-titel">Titel</label>
            <input
              id="tresor-titel"
              className={stile.eingabe}
              value={titel}
              onChange={(ereignis) => setzeTitel(ereignis.target.value)}
              placeholder="z. B. Bankverbindung"
              required
              autoFocus
            />
          </div>

          <div className={stile.feld}>
            <label htmlFor="tresor-inhalt">Inhalt</label>
            <textarea
              id="tresor-inhalt"
              className={stile.textbereich}
              rows={5}
              value={inhalt}
              onChange={(ereignis) => setzeInhalt(ereignis.target.value)}
              placeholder="Was Ihre Angehörigen dazu wissen müssen"
            />
          </div>

          <div className={stile.knopfgruppe}>
            {/*
              `required` allein liesse einen Titel aus lauter Leerzeichen
              durch; der Dienst weist ihn dann ab, und die Meldung landet weit
              weg von diesem Feld.
            */}
            <Button type="submit" disabled={laeuft || titel.trim() === ''}>
              Im Tresor speichern
            </Button>
            <Button variante="sekundaer" type="button" disabled={laeuft} onClick={schliesse}>
              Abbrechen
            </Button>
          </div>
        </form>
      ) : (
        <Button variante="sekundaer" volleBreite onClick={() => setzeFormOffen(true)}>
          Eintrag hinzufügen
        </Button>
      )}
    </Card>
  )
}
