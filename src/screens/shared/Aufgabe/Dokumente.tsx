import { useEffect, useMemo, useState, type ChangeEvent } from 'react'
import { alsNachricht } from '../../../core/fehler.ts'
import { useDokumente } from '../../../hooks/useDokumente.ts'
import type { InhaltZeile } from '../../../core/db/inhalte.ts'
import type { Fallschluessel } from '../../../services/aufgabenService.ts'
import { groessentext, type Dokument } from '../../../services/dokumentService.ts'
import { Button } from '../../../ui/Button/Button.tsx'
import { Card } from '../../../ui/Card/Card.tsx'
import stile from './Dokumente.module.css'

/**
 * Die Dokumente einer Aufgabe (DESIGN.md §7).
 *
 * §7 benennt die Aktion wörtlich: „Dokument einfach abfotografieren". Genau so
 * heißt sie hier, und dahinter liegt ein `<input type="file"
 * capture="environment">` — auf dem Telefon öffnet das die Kamera, auf dem
 * Rechner den Dateiauswahldialog. Zwei Wege für dieselbe Handlung wären zwei
 * Schaltflächen, von denen eine auf jedem Gerät die falsche ist.
 *
 * **Verschlüsselt wird vor dem Hochladen, außerhalb des Main-Threads** (§7,
 * `core/crypto/workerDateikrypto.ts`). Sichtbar ist davon nur, dass die
 * Schaltfläche für einen Moment „Wird verschlüsselt…" sagt — die Liste bleibt
 * scrollbar, die Notizen bleiben tippbar.
 *
 * **Angesehen wird im Fenster, nicht als Link auf den Server.** Was im Storage
 * liegt, ist Ciphertext; ein `<img src>` darauf zeigte nichts. Der Klartext
 * entsteht erst hier und lebt als `blob:`-URL genau so lange, wie jemand
 * hinsieht.
 */

/** Wonach eine Bilddatei aussieht — alles andere gibt es nur zum Speichern. */
function istBild(mimetyp: string): boolean {
  return mimetyp.startsWith('image/')
}

/** Ein geöffnetes Dokument samt der URL, unter der sein Klartext liegt. */
type Ansicht = { dokument: Dokument; url: string }

function Dokumentzeile({
  dokument,
  gesperrt,
  darfLoeschen,
  aufAnsehen,
  aufLoeschen,
}: {
  dokument: Dokument
  /** Läuft gerade etwas? Dann ruht alles, bis es durch ist. */
  gesperrt: boolean
  /**
   * §7: Ansehen darf jedes Mitglied, löschen nur, wem die Aufgabe zugewiesen
   * ist. Die Schaltfläche steht deshalb gar nicht erst da statt grau daneben —
   * ausgegraut sähe aus wie „geht gerade nicht" und nicht wie „nicht Ihre".
   */
  darfLoeschen: boolean
  aufAnsehen: () => void
  aufLoeschen: () => void
}) {
  const [fragt, setzeFragt] = useState(false)

  if (fragt) {
    return (
      <li className={stile.zeile}>
        <p>
          „{dokument.name}" wirklich löschen? Die Datei wird dabei entfernt und kommt nicht
          zurück.
        </p>
        <div className={stile.aktionen}>
          <Button
            onClick={() => {
              setzeFragt(false)
              aufLoeschen()
            }}
            disabled={gesperrt}
          >
            Endgültig löschen
          </Button>
          <Button variante="sekundaer" onClick={() => setzeFragt(false)}>
            Abbrechen
          </Button>
        </div>
      </li>
    )
  }

  return (
    <li className={stile.zeile}>
      <span className={stile.name}>{dokument.name}</span>
      <span className={stile.hinweis}>{groessentext(dokument.groesse)}</span>

      <div className={stile.aktionen}>
        <Button
          variante="sekundaer"
          onClick={aufAnsehen}
          disabled={gesperrt}
          vorleseText={`: „${dokument.name}"`}
        >
          Ansehen
        </Button>
        {darfLoeschen ? (
          <Button
            variante="sekundaer"
            onClick={() => setzeFragt(true)}
            disabled={gesperrt}
            vorleseText={`: „${dokument.name}"`}
          >
            Löschen
          </Button>
        ) : null}
      </div>
    </li>
  )
}

export function Dokumente({
  fall,
  aufgabeId,
  zeilen,
  aktualisiere,
  darfAendern,
}: {
  fall: Fallschluessel
  /** Die Aufgabe, an der die Dokumente hängen (§7). */
  aufgabeId: string
  /** Der Bestand als Ciphertext, aus `useAufgaben`. */
  zeilen: InhaltZeile[]
  aktualisiere: () => void
  /**
   * §7: „Bearbeiten darf nur, wem sie zugewiesen ist." Aufnehmen und Löschen
   * sind Bearbeiten; Ansehen ist es nicht — wer die Rechtsgrundlage lesen darf,
   * darf auch die Sterbeurkunde sehen, die daran hängt.
   */
  darfAendern: boolean
}) {
  const { dokumente, online, nimmAuf, oeffne, loesche } = useDokumente(fall, zeilen, aktualisiere)

  const [laeuft, setzeLaeuft] = useState<null | 'aufnehmen' | 'oeffnen' | 'loeschen'>(null)
  const [fehler, setzeFehler] = useState<string | null>(null)
  const [ansicht, setzeAnsicht] = useState<Ansicht | null>(null)

  const meine = useMemo(
    () => dokumente.filter((dokument) => dokument.aufgabeId === aufgabeId),
    [aufgabeId, dokumente],
  )

  /*
   * Eine `blob:`-URL hält ihren Puffer fest, bis jemand sie widerruft. Ohne
   * diese Zeile bliebe jedes einmal angesehene Dokument bis zum Neuladen im
   * Speicher — bei 15 MB pro Scan ist das auf einem Telefon schnell zu viel.
   */
  useEffect(() => {
    if (ansicht === null) {
      return
    }

    return () => URL.revokeObjectURL(ansicht.url)
  }, [ansicht])

  async function fuehreAus(was: 'aufnehmen' | 'oeffnen' | 'loeschen', arbeit: () => Promise<void>) {
    setzeLaeuft(was)
    setzeFehler(null)

    try {
      await arbeit()
    } catch (ursache) {
      setzeFehler(alsNachricht(ursache))
    } finally {
      setzeLaeuft(null)
    }
  }

  async function aufnehmen(ereignis: ChangeEvent<HTMLInputElement>) {
    const datei = ereignis.target.files?.[0]

    // Das Feld wird geleert, bevor irgendetwas passiert: Sonst löst dieselbe
    // Datei ein zweites Mal kein `change` aus, und ein fehlgeschlagener
    // Versuch liesse sich nicht wiederholen.
    ereignis.target.value = ''

    if (datei === undefined) {
      return
    }

    await fuehreAus('aufnehmen', async () => {
      await nimmAuf(datei, aufgabeId)
    })
  }

  async function ansehen(dokument: Dokument) {
    await fuehreAus('oeffnen', async () => {
      const klartext = await oeffne(dokument)

      setzeAnsicht({
        dokument,
        url: URL.createObjectURL(new Blob([klartext as BlobPart], { type: dokument.mimetyp })),
      })
    })
  }

  const zu = laeuft !== null || !darfAendern || !online

  return (
    <Card className={stile.karte}>
      <h2>Dokumente</h2>

      <label className={[stile.aufnahme, zu ? stile.gesperrt : null].filter(Boolean).join(' ')}>
        {laeuft === 'aufnehmen'
          ? 'Wird verschlüsselt und hochgeladen…'
          : 'Dokument einfach abfotografieren'}
        <input
          className={stile.feld}
          type="file"
          accept="image/*,application/pdf"
          // Auf dem Telefon die Rückkamera (§7). Ein Rechner ohne Kamera
          // ignoriert das Attribut und zeigt den Dateidialog.
          capture="environment"
          disabled={zu}
          onChange={(ereignis) => void aufnehmen(ereignis)}
        />
      </label>

      {online ? null : (
        <p className={stile.hinweis} role="status">
          Ohne Verbindung lässt sich kein Dokument aufnehmen. Ein Foto wartet nicht in der
          Warteschlange — es geht ganz hinaus oder gar nicht.
        </p>
      )}

      {darfAendern || !online ? null : (
        <p className={stile.hinweis}>
          Ansehen können Sie alles. Zum Aufnehmen und Löschen übernehmen Sie oben die
          Zuständigkeit.
        </p>
      )}

      {fehler === null ? null : (
        <p className={stile.hinweis} role="alert">
          {fehler}
        </p>
      )}

      {meine.length === 0 ? (
        <p className={stile.hinweis}>
          Noch keine. Halten Sie das Dokument vor die Kamera — es wird auf diesem Gerät
          verschlüsselt, bevor es hinausgeht.
        </p>
      ) : (
        <ul className={stile.liste}>
          {meine.map((dokument) => (
            <Dokumentzeile
              key={dokument.id}
              dokument={dokument}
              gesperrt={laeuft !== null}
              darfLoeschen={darfAendern}
              aufAnsehen={() => void ansehen(dokument)}
              aufLoeschen={() => void fuehreAus('loeschen', () => loesche(dokument))}
            />
          ))}
        </ul>
      )}

      {ansicht === null ? null : (
        <div className={stile.zeile}>
          <p className={stile.name}>{ansicht.dokument.name}</p>

          {istBild(ansicht.dokument.mimetyp) ? (
            <img className={stile.vorschau} src={ansicht.url} alt={ansicht.dokument.name} />
          ) : (
            /*
              Kein Bild, also kein Bild zeigen. Der Link speichert den
              entschlüsselten Klartext — das ist der einzige Weg, ein PDF in
              einer App zu öffnen, die keinen Betrachter mitbringt.
            */
            <a href={ansicht.url} download={ansicht.dokument.name}>
              „{ansicht.dokument.name}" speichern
            </a>
          )}

          <div className={stile.aktionen}>
            <Button variante="sekundaer" onClick={() => setzeAnsicht(null)}>
              Schließen
            </Button>
          </div>
        </div>
      )}
    </Card>
  )
}
