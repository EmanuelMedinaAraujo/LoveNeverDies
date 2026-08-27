import { useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import {
  ALLEINERBE,
  ERBENGEMEINSCHAFT,
  ERBSCHEIN,
  ERBSCHEIN_FRAGE,
} from '../../../content/erbstatus.ts'
import { alsNachricht } from '../../../core/fehler.ts'
import { useAufgaben } from '../../../hooks/useAufgaben.ts'
import { useCase } from '../../../hooks/useCase.ts'
import { useTodesfall } from '../../../hooks/useTodesfall.ts'
import type { Aufgabe, Fragebaumergebnis } from '../../../services/aufgabenService.ts'
import { istVorsorgende, type LesbarerFall } from '../../../services/fallService.ts'
import { BAUPLAENE, knoten, statusText } from '../../../services/fragebaumService.ts'
import { Badge } from '../../../ui/Badge/Badge.tsx'
import { Button } from '../../../ui/Button/Button.tsx'
import { Card } from '../../../ui/Card/Card.tsx'
import { Infoblock } from '../../../ui/Infoblock/Infoblock.tsx'
import { KeinFall } from '../KeinFall/KeinFall.tsx'
import { fallLadeText } from '../Ladeanzeige/FallLadeanzeige.tsx'
import stile from './Erbe.module.css'
import { SymbolPerson, SymbolPersonen, SymbolUrkunde } from './Symbole.tsx'

function Ladeanzeige({ text }: { text: string }) {
  return (
    <p className={stile.hinweis} role="status">
      {text}
    </p>
  )
}

/**
 * Freigabestand und Todesbestätigung (DESIGN.md §3.5, §7).
 *
 * §7 verlangt beides im Tab Erbe: den Freigabestatus und die Aktion "Todesfall
 * bestätigen", mit Bestätigungsdialog. Der Dialog ist keine Höflichkeit: Eine
 * versehentlich abgeschickte Todesbestätigung nimmt niemand zurück (§5).
 *
 * Der Zähler steht hier als Anzeige und nicht als Auslöser (§3.5). Erreicht er
 * `k`, heisst das ausschliesslich, dass ein Versuch sich lohnt; ob der Tresor
 * aufgeht, entscheidet erst das Zusammensetzen.
 */
function Todesfallfreigabe({
  fall,
  onFallAktualisieren,
}: {
  fall: LesbarerFall
  onFallAktualisieren: () => void
}) {
  const {
    freigaben,
    k,
    kannFreigeben,
    eigeneFreigabe,
    schwelleErreicht,
    laedt,
    laeuft,
    fehler,
    unbrauchbare,
    bestaetigeTodesfall,
    oeffneTresor,
  } = useTodesfall(fall, onFallAktualisieren)

  const [dialog, setzeDialog] = useState<'zu' | 'bestaetigen' | 'oeffnen'>('zu')
  const [sterbedatum, setzeSterbedatum] = useState('')

  async function bestaetigen(ereignis: FormEvent) {
    ereignis.preventDefault()

    try {
      await bestaetigeTodesfall()
      setzeDialog('zu')
    } catch {
      /* Die Meldung steht in `fehler`. */
    }
  }

  async function oeffnen(ereignis: FormEvent) {
    ereignis.preventDefault()

    try {
      await oeffneTresor(sterbedatum)
      setzeDialog('zu')
    } catch {
      /* Die Meldung steht in `fehler`, samt der Namen in `unbrauchbare`. */
    }
  }

  if (laedt) {
    return <Ladeanzeige text="Freigaben werden geladen..." />
  }

  return (
    <Card>
      <div className={stile.statusKopf}>
        <h2 className={stile.abschnitt}>Todesfall bestätigen</h2>
        <Badge lage={schwelleErreicht ? 'knapp' : 'ruhig'}>
          {k === null
            ? 'Keine Freigaben möglich'
            : `${freigaben.length} von ${k} Freigaben`}
        </Badge>
      </div>

      <p className={stile.hinweis}>
        Erst wenn genügend Angehörige den Todesfall bestätigt haben, lässt sich der Tresor
        öffnen. Eine Bestätigung lässt sich nicht zurücknehmen.
      </p>

      {freigaben.length === 0 ? (
        <p className={stile.hinweis}>Bisher hat niemand den Todesfall bestätigt.</p>
      ) : (
        <ul className={stile.liste}>
          {freigaben.map((freigabe) => (
            <li key={freigabe.userId} className={stile.item}>
              <p className={stile.itemTitel}>
                {freigabe.name}
                {freigabe.eigene ? ' (Sie)' : ''}
              </p>
              <p className={stile.hinweis}>
                Freigegeben am {new Date(freigabe.freigegebenAm).toLocaleDateString('de-DE')}
              </p>
            </li>
          ))}
        </ul>
      )}

      {unbrauchbare.length > 0 ? (
        <p className={stile.warnung} role="alert">
          {unbrauchbare.length === 1
            ? `Der Schlüsselanteil von ${unbrauchbare[0]} ist unbrauchbar.`
            : `Die Schlüsselanteile von ${unbrauchbare.join(', ')} sind unbrauchbar.`}{' '}
          Bitten Sie {unbrauchbare.length === 1 ? 'diese Person' : 'diese Personen'}, den
          Todesfall erneut zu bestätigen — der zweite Versuch ersetzt den ersten.
        </p>
      ) : null}

      {fehler !== null && unbrauchbare.length === 0 ? (
        <p className={stile.warnung} role="alert">
          {fehler}
        </p>
      ) : null}

      {dialog === 'bestaetigen' ? (
        <form className={stile.formular} onSubmit={(ereignis) => void bestaetigen(ereignis)}>
          <p className={stile.warnung}>
            Bestätigen Sie, dass {fall.personName} verstorben ist? Diese Bestätigung lässt sich
            nicht zurücknehmen.
          </p>

          {/*
            Kein Sterbedatum an dieser Stelle: Eine Freigabe trägt es nicht mit
            (§3.5, §4), und ein Feld, dessen Inhalt beim Absenden verfiele, wäre
            eine Auskunft, die man abgibt und die niemand bekommt. Gefragt wird
            danach dort, wo es wirklich in den Fall geht, nämlich beim Öffnen.
          */}

          <div className={stile.gefahrGruppe}>
            <Button type="submit" disabled={laeuft}>
              Ja, Todesfall bestätigen
            </Button>
            <Button
              variante="sekundaer"
              type="button"
              disabled={laeuft}
              onClick={() => setzeDialog('zu')}
            >
              Abbrechen
            </Button>
          </div>
        </form>
      ) : null}

      {dialog === 'oeffnen' ? (
        <form className={stile.formular} onSubmit={(ereignis) => void oeffnen(ereignis)}>
          <p className={stile.warnung}>
            Der Tresor wird jetzt geöffnet und der Fall zum Trauerfall. Das lässt sich nicht
            rückgängig machen.
          </p>

          <div className={stile.feld}>
            <label htmlFor="oeffnen-sterbedatum">Sterbedatum</label>
            <input
              id="oeffnen-sterbedatum"
              type="date"
              className={stile.eingabe}
              value={sterbedatum}
              onChange={(ereignis) => setzeSterbedatum(ereignis.target.value)}
              required
            />
          </div>

          <div className={stile.gefahrGruppe}>
            <Button type="submit" disabled={laeuft}>
              Tresor jetzt öffnen
            </Button>
            <Button
              variante="sekundaer"
              type="button"
              disabled={laeuft}
              onClick={() => setzeDialog('zu')}
            >
              Abbrechen
            </Button>
          </div>
        </form>
      ) : null}

      {dialog === 'zu' && kannFreigeben && !eigeneFreigabe ? (
        <Button volleBreite disabled={laeuft} onClick={() => setzeDialog('bestaetigen')}>
          Todesfall bestätigen
        </Button>
      ) : null}

      {/*
        Ohne Schlüsselanteil auf diesem Gerät gibt es nichts freizugeben (§3.5)
        — und bis hierher stand dann gar nichts da: keine Schaltfläche, kein
        Satz, nur der Zähler darüber. Wer den Knopf erwartet, den ihm jemand am
        Telefon beschreibt, sucht ihn dann auf dem falschen Bildschirm.

        Der Satz sagt beides: dass es an diesem Gerät liegt und nicht an der
        Person, und wer es in Ordnung bringen kann. Verteilen kann nur die
        vorsorgende Person; seit der Kopplung geschieht das sofort beim
        Beitritt (`hooks/useKopplung.ts`), aber ein Gerät, das erst danach
        dazugekommen ist, wartet weiterhin auf die nächste Verteilung.
      */}
      {dialog === 'zu' && !kannFreigeben && !eigeneFreigabe ? (
        <p className={stile.hinweis}>
          Für dieses Gerät liegt noch kein Schlüsselanteil bereit — deshalb lässt sich der
          Todesfall von hier aus nicht bestätigen. Bitten Sie {fall.personName}, die App einmal
          zu öffnen; die Anteile werden dann neu verteilt.
        </p>
      ) : null}

      {dialog === 'zu' && eigeneFreigabe ? (
        <p className={stile.hinweis}>Sie haben den Todesfall bereits bestätigt.</p>
      ) : null}

      {dialog === 'zu' && schwelleErreicht ? (
        <Button volleBreite disabled={laeuft} onClick={() => setzeDialog('oeffnen')}>
          Tresor öffnen
        </Button>
      ) : null}
    </Card>
  )
}

/**
 * Der Tab „Erbe" bei einem Vorsorgefall (DESIGN.md §3.5, §7).
 *
 * Hier kommt nur an, wer *nicht* vorsorgt: Die vorsorgende Person hat ihren
 * eigenen Bereich unter „Nachlass", und die Route schickt sie dorthin
 * (`app/App.tsx`). Was Angehörigen in diesem Fall bleibt, sind genau zwei
 * Dinge — die Todesbestätigung und die Auskunft, dass der Tresor bis dahin
 * versiegelt ist.
 *
 * Ohne `K_v` gibt es hier nichts zu lesen und nichts zu schreiben (§3.5).
 * Deshalb zieht dieser Zweig auch keinen Tresor-Zustand mehr auf: Er zeigte
 * eine leere Liste, für die zuvor jede Zeile des Falls entschlüsselt worden
 * wäre.
 */
function VorsorgeAngehoerige({
  fall,
  onFallAktualisieren,
}: {
  fall: LesbarerFall
  onFallAktualisieren: () => void
}) {
  return (
    <>
      <Todesfallfreigabe fall={fall} onFallAktualisieren={onFallAktualisieren} />

      <Card>
        <h2 className={stile.abschnitt}>Geschützter Tresor</h2>
        <p className={stile.hinweis}>
          Dies ist der Vorsorgefall von {fall.personName}. Der Tresor ist versiegelt und wird
          erst nach Bestätigung des Todesfalls durch die Angehörigen geöffnet.
        </p>
      </Card>
    </>
  )
}

/**
 * Was hinter dem Status "Erbe" aufgeht (ERBE_DESIGN.md §10).
 *
 * Wer erbt, hat das Ergebnis des Fragebaums und danach zwei Fragen, die der
 * Baum nicht mehr stellt: Brauche ich einen Erbschein, und erbe ich allein
 * oder mit anderen? Sie stehen deshalb hinter dem Wort "Erbe" und nicht als
 * zwei weitere Karten auf der Seite: Wer sie nicht hat, soll sie nicht
 * wegblättern müssen.
 *
 * Eine Ansicht nach der anderen, mit einem Weg zurück aus jeder. Keine eigene
 * Adresse und kein Dialog — dieselbe Überlegung wie beim Fragebaum: Der
 * Zurück-Knopf des Browsers soll die Seite verlassen und nicht eine
 * Erläuterung schließen.
 */
type Erbeansicht =
  | 'wahl'
  | 'erbschein'
  | 'stellung'
  | 'erbengemeinschaft'
  | 'alleinerbe'

/** Der Weg zurück, eine Ansicht nach oben. */
function Zurueck({ auf }: { auf: () => void }) {
  return (
    <Button variante="text" className={stile.zurueck} onClick={auf}>
      <span aria-hidden="true">←</span> Zurück
    </Button>
  )
}

/** Der Erbschein-Text mit der Frage darunter (§10). */
function Erbschein({
  vorhandene,
  onAnlegen,
  onZurueck,
}: {
  vorhandene: Aufgabe | null
  onAnlegen: () => Promise<void>
  onZurueck: () => void
}) {
  const navigate = useNavigate()
  const [laeuft, setzeLaeuft] = useState(false)
  const [fehler, setzeFehler] = useState<string | null>(null)

  async function anlegen() {
    setzeLaeuft(true)
    setzeFehler(null)

    try {
      await onAnlegen()
    } catch (ursache) {
      setzeFehler(alsNachricht(ursache))
    } finally {
      setzeLaeuft(false)
    }
  }

  return (
    <div className={stile.wege}>
      <Zurueck auf={onZurueck} />
      <Infoblock text={ERBSCHEIN} />

      {fehler === null ? null : (
        <p className={stile.warnung} role="alert">
          {fehler}
        </p>
      )}

      {/*
        Höchstens eine je Person und Art (§7): Ein zweites "Ja" legt nichts
        Neues an, sondern führt zu der Aufgabe, die schon da ist.
      */}
      {vorhandene === null ? (
        <>
          <p className={stile.frage}>{ERBSCHEIN_FRAGE}</p>
          <div className={stile.jaNein}>
            <Button disabled={laeuft} onClick={() => void anlegen()}>
              Ja
            </Button>
            <Button variante="sekundaer" disabled={laeuft} onClick={onZurueck}>
              Nein
            </Button>
          </div>
        </>
      ) : (
        <>
          <p className={stile.hinweis}>
            Die Aufgabe „{BAUPLAENE.erbschein.titel}“ ist angelegt. Sie steht in Ihren Aufgaben
            und ist nur für Sie sichtbar.
          </p>
          <Button volleBreite onClick={() => navigate(`/aufgabe/${vorhandene.id}`)}>
            Aufgabe öffnen
          </Button>
        </>
      )}
    </div>
  )
}

/**
 * Alles, was hinter dem Wort "Erbe" steht.
 *
 * Der Zustand liegt hier und nicht in der Adresse: Er ist nichts, was jemand
 * teilt, und nichts, was einen Fall betrifft.
 */
function Erbewege({
  ansicht,
  setzeAnsicht,
  vorhandene,
  onAnlegen,
}: {
  ansicht: Erbeansicht
  setzeAnsicht: (ansicht: Erbeansicht) => void
  vorhandene: Aufgabe | null
  onAnlegen: () => Promise<void>
}) {
  if (ansicht === 'wahl') {
    return (
      <div className={stile.wege}>
        <Button variante="sekundaer" volleBreite onClick={() => setzeAnsicht('erbschein')}>
          <SymbolUrkunde />
          Erbschein
        </Button>
        <Button variante="sekundaer" volleBreite onClick={() => setzeAnsicht('stellung')}>
          <SymbolPersonen />
          Erbengemeinschaft bzw. Alleinerbe
        </Button>
      </div>
    )
  }

  if (ansicht === 'erbschein') {
    return (
      <Erbschein
        vorhandene={vorhandene}
        onAnlegen={onAnlegen}
        onZurueck={() => setzeAnsicht('wahl')}
      />
    )
  }

  if (ansicht === 'stellung') {
    return (
      <div className={stile.wege}>
        <Zurueck auf={() => setzeAnsicht('wahl')} />
        <h3 className={stile.infoTitel}>Was trifft auf Sie zu?</h3>
        <p className={stile.hinweis}>Das Nachlassgericht informiert Sie darüber.</p>
        <Button variante="sekundaer" volleBreite onClick={() => setzeAnsicht('erbengemeinschaft')}>
          <SymbolPersonen />
          Erbengemeinschaft
        </Button>
        <Button variante="sekundaer" volleBreite onClick={() => setzeAnsicht('alleinerbe')}>
          <SymbolPerson />
          Alleinerbe
        </Button>
      </div>
    )
  }

  return (
    <div className={stile.wege}>
      <Zurueck auf={() => setzeAnsicht('stellung')} />
      <Infoblock text={ansicht === 'erbengemeinschaft' ? ERBENGEMEINSCHAFT : ALLEINERBE} />
    </div>
  )
}

/**
 * Der Erbstatus dieser Person und der Weg in den Fragebaum
 * (ERBE_DESIGN.md §10).
 *
 * Das Ergebnis liegt privat unter `K_p` (§3.7): Zwei Geschwister im selben Fall
 * sehen hier verschiedene Sätze, und keiner von beiden erfährt den des
 * anderen. Deshalb kommt es aus `useAufgaben` und nicht aus `useCase` — genau
 * wie das Kenntnisdatum, mit dem es sich die Zeile teilt (§8).
 */
function Erbstatus({ fall }: { fall: LesbarerFall }) {
  const { zustand, fragebaum, fragebaumGeladen, fragebaumAufgabe, legeFragebaumAufgabeAn } =
    useAufgaben(fall)
  const navigate = useNavigate()
  const [ansicht, setzeAnsicht] = useState<Erbeansicht>('wahl')

  /*
   * Gewartet wird auf `fragebaumGeladen` und nicht bloss auf den Bestand.
   *
   * `fragebaum` ist `null`, solange `K_p` unterwegs ist — auch dann, wenn ein
   * Ergebnis längst gespeichert ist: Das Item liegt da, nur unlesbar. Wer das
   * für „noch nicht durchlaufen" hält, lädt jemanden zu einem Fragebaum ein,
   * den er schon hinter sich hat, und der zweite Durchlauf endet dann bei
   * „Ihr gespeichertes Ergebnis bleibt". Eine Sekunde Ladetext ist billiger
   * als diese Verwechslung (ERBE_DESIGN.md §6).
   */
  if (zustand.status === 'laedt' || !fragebaumGeladen) {
    return <Ladeanzeige text="Ihr Ergebnis wird geladen..." />
  }

  /*
   * Nur "Erbe" trägt die beiden Wege (§10). "Wahrscheinlich Erbe" trägt sie
   * nicht: Wer noch nicht weiß, ob er erbt, soll keinen Erbschein beantragen,
   * und "Noch Erbe" ist die Ausschlagung — dort ist der Erbschein das
   * Gegenteil dessen, was ansteht.
   */
  const istErbe = fragebaum !== null && fragebaum.status === 'erbe'

  return (
    <Card>
      <div className={stile.statusKopf}>
        <h2 className={stile.abschnitt}>Ihr Erbstatus</h2>
        {fragebaum === null || fragebaum.status === null ? null : (
          <Badge lage="hinweis">{statusText(fragebaum.status)}</Badge>
        )}
      </div>

      {fragebaum === null ? (
        <>
          <p className={stile.hinweis}>
            Ob Sie erben, entscheidet darüber, was als Nächstes zu tun ist und welche Fristen für
            Sie laufen. Der Fragebaum führt Sie in wenigen Schritten hindurch. Ihre Antworten
            sehen nur Sie.
          </p>
          <Button volleBreite onClick={() => navigate('/erbe/fragebaum')}>
            Fragebaum starten
          </Button>
        </>
      ) : (
        <>
          <p className={stile.itemInhalt}>{ergebnisSatz(fragebaum)}</p>
          <p className={stile.hinweis}>
            {fragebaum.am === ''
              ? 'Ermittelt mit dem Fragebaum.'
              : `Ermittelt am ${new Date(fragebaum.am).toLocaleDateString('de-DE')}.`}{' '}
            Nur für Sie sichtbar.
          </p>

          {istErbe ? (
            <Erbewege
              ansicht={ansicht}
              setzeAnsicht={setzeAnsicht}
              vorhandene={fragebaumAufgabe('erbschein')}
              onAnlegen={() => legeFragebaumAufgabeAn('erbschein')}
            />
          ) : null}
        </>
      )}
    </Card>
  )
}

/**
 * Der gespeicherte Ergebnistext.
 *
 * Aus der Inhaltsdatei und nicht aus dem gespeicherten Payload: Der Payload
 * trägt die Knoten-Id und nicht den Satz, damit ein korrigierter Rechtstext
 * auch für die gilt, die den Baum schon durchlaufen haben. Findet sich der
 * Knoten nicht mehr, bleibt der Status — er steht mit im Ergebnis.
 */
function ergebnisSatz(ergebnis: Fragebaumergebnis): string {
  const ziel = knoten(ergebnis.knotenId)

  if (ziel === null) {
    return ergebnis.status === null
      ? 'Ihr Ergebnis liegt vor.'
      : `Ihr Ergebnis: ${statusText(ergebnis.status)}.`
  }

  return ziel.text.split('\n')[0] ?? ziel.text
}

export function Erbe() {
  const { zustand, aktualisiere: onFallAktualisieren } = useCase()

  if (zustand.status === 'laedt' || zustand.status === 'schluessel-erneuerung') {
    return (
      <main className={stile.seite}>
        <Ladeanzeige text={fallLadeText(zustand.status)} />
      </main>
    )
  }

  if (zustand.status === 'kein-fall') {
    return <KeinFall />
  }

  if (zustand.status === 'fehler') {
    return (
      <main className={stile.seite}>
        <p className={stile.hinweis} role="alert">
          Der Fall war nicht zu laden: {zustand.nachricht}
        </p>
      </main>
    )
  }

  /*
   * §3.5: Die vorsorgende Person hat ihren eigenen Bereich. Die Route schickt
   * sie ohnehin dorthin (`app/App.tsx`); dass der Screen es noch einmal tut,
   * hält ihn für sich allein richtig — er zeigte sonst, direkt aufgerufen, die
   * Todesbestätigung für den eigenen Tod.
   */
  if (istVorsorgende(zustand.aktiver)) {
    return <Navigate to="/nachlass" replace />
  }

  const fall = zustand.aktiver
  if (fall.zustand === 'gesperrt') {
    return (
      <main className={stile.seite}>
        <p className={stile.hinweis} role="alert">
          Dieser Fall ist auf diesem Gerät gesperrt: {fall.grund}
        </p>
      </main>
    )
  }

  return (
    <main className={stile.seite}>
      <div className={stile.kopf}>
        <h1>Erbe & Tresor</h1>
        <p className={stile.hinweis}>
          {fall.personName} {fall.status === 'vorsorge' ? '· Vorsorge' : '· Trauerfall'}
        </p>
      </div>

      {fall.status === 'vorsorge' ? (
        <VorsorgeAngehoerige fall={fall} onFallAktualisieren={onFallAktualisieren} />
      ) : (
        <TrauerfallErbe fall={fall} />
      )}
    </main>
  )
}

function TrauerfallErbe({ fall }: { fall: LesbarerFall }) {
  const { fragebaum, fragebaumGeladen } = useAufgaben(fall)

  return (
    <>
      <Erbstatus fall={fall} />

      {/*
        §3.5: Die ganze Karte führt in den geöffneten Tresor. Vorher stand
        hier ein Satz, der auf einen anderen Tab verwies -- der Inhalt, den
        die vorsorgende Person hinterlegt hat, war nirgends zu sehen.

        Nur bei einem Fall, der aus einer Vorsorge hervorgegangen ist:
        `preparerId` steht ausschließlich dort (siehe die Spalte in
        `faelle`, "nur bei Vorsorge"). Ein Trauerfall, der direkt angelegt
        wurde, hatte nie einen Tresor, und eine Karte, die zu einem
        Screen führt, der nur "Versiegelt, 0 von 0" melden könnte, wäre
        keine Auskunft, sondern eine Enttäuschung, einen Fingertipp weiter.
      */}
      {fall.preparerId === null ? null : (
        <Link className={stile.karte} to="/erbe/tresor">
          <Card>
            <div className={stile.statusKopf}>
              <h2 className={stile.abschnitt}>Nachlass-Tresor</h2>
              <Badge lage="ruhig">Trauerfall</Badge>
            </div>
            <p className={stile.hinweis}>
              Was {fall.personName} hinterlegt hat: Zugänge, Unterlagen, persönliche
              Nachrichten. Tippen Sie, um es zu lesen.
            </p>
          </Card>
        </Link>
      )}

      {fragebaumGeladen && fragebaum !== null ? <ErneutDurchlaufen /> : null}
    </>
  )
}

/**
 * Der Weg noch einmal durch den Baum, ganz unten (ERBE_DESIGN.md §10).
 *
 * Unten und nicht neben dem Ergebnis: Wer ihn sucht, sucht ihn bewusst. Was ein
 * zweiter Durchlauf mit dem gespeicherten Ergebnis macht, steht dort, wo es
 * passiert — auf der Ergebnisseite —, und nicht hier: Ein Hinweis an dieser
 * Stelle wäre eine Warnung vor etwas, das noch gar nicht ansteht (§6).
 */
function ErneutDurchlaufen() {
  const navigate = useNavigate()

  return (
    <Button variante="sekundaer" volleBreite onClick={() => navigate('/erbe/fragebaum')}>
      Fragebaum erneut durchlaufen
    </Button>
  )
}
