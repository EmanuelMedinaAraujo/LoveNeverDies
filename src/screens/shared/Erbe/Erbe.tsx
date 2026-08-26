import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  ALLEINERBE,
  ERBENGEMEINSCHAFT,
  ERBSCHEIN,
  ERBSCHEIN_FRAGE,
} from '../../../content/erbstatus.ts'
import { VORSORGEFRAGEN } from '../../../content/vorsorgefragen.ts'
import { alsNachricht } from '../../../core/fehler.ts'
import { useAufgaben } from '../../../hooks/useAufgaben.ts'
import { useCase } from '../../../hooks/useCase.ts'
import { useTodesfall } from '../../../hooks/useTodesfall.ts'
import { useTresor } from '../../../hooks/useTresor.ts'
import type { Aufgabe, Fragebaumergebnis } from '../../../services/aufgabenService.ts'
import type { LesbarerFall } from '../../../services/fallService.ts'
import { BAUPLAENE, knoten, statusText } from '../../../services/fragebaumService.ts'
import {
  antwortZuFrage,
  eigeneFragen,
  type TresorItem,
} from '../../../services/tresorService.ts'
import type { Infotext } from '../../../types/infotext.ts'
import { Badge } from '../../../ui/Badge/Badge.tsx'
import { Button } from '../../../ui/Button/Button.tsx'
import { Card } from '../../../ui/Card/Card.tsx'
import { KeinFall } from '../KeinFall/KeinFall.tsx'
import { fallLadeText } from '../Ladeanzeige/FallLadeanzeige.tsx'
import { Vorsorgefragen } from '../Vorsorgefragen/Vorsorgefragen.tsx'
import stile from './Erbe.module.css'
import { SymbolPerson, SymbolPersonen, SymbolUrkunde } from './Symbole.tsx'

function Ladeanzeige({ text }: { text: string }) {
  return (
    <p className={stile.hinweis} role="status">
      {text}
    </p>
  )
}

function TresorInhalte({
  items,
  onNeu,
  onLoeschen,
}: {
  items: TresorItem[]
  onNeu: (titel: string, inhalt: string) => Promise<void>
  onLoeschen: (item: TresorItem) => Promise<void>
}) {
  const [formOffen, setzeFormOffen] = useState(false)
  const [titel, setzeTitel] = useState('')
  const [inhalt, setzeInhalt] = useState('')
  const [laeuft, setzeLaeuft] = useState(false)
  const [fehler, setzeFehler] = useState<string | null>(null)

  async function absenden(ereignis: FormEvent) {
    ereignis.preventDefault()
    setzeLaeuft(true)
    setzeFehler(null)

    try {
      await onNeu(titel, inhalt)
      setzeTitel('')
      setzeInhalt('')
      setzeFormOffen(false)
    } catch (ursache) {
      setzeFehler(alsNachricht(ursache))
    } finally {
      setzeLaeuft(false)
    }
  }

  return (
    <Card>
      <div className={stile.statusKopf}>
        <h2 className={stile.abschnitt}>Weitere Tresor-Inhalte</h2>
        <Badge lage="ruhig">{items.length} {items.length === 1 ? 'Eintrag' : 'Einträge'}</Badge>
      </div>

      <p className={stile.hinweis}>
        Inhalte im Tresor liegen verschlüsselt unter Ihrem Tresorschlüssel K_v. Angehörige
        erhalten erst nach dem Trauerfall und mit den nötigen Freigaben Zugriff.
      </p>

      {items.length === 0 ? (
        <p className={stile.hinweis}>Hier steht noch nichts außer Ihren Antworten oben.</p>
      ) : (
        <ul className={stile.liste}>
          {items.map((item) => (
            <li key={item.id} className={stile.item}>
              <div className={stile.itemKopf}>
                <p className={stile.itemTitel}>{item.titel}</p>
                <Button
                  variante="sekundaer"
                  onClick={() => void onLoeschen(item)}
                  aria-label={`"${item.titel}" löschen`}
                >
                  Löschen
                </Button>
              </div>
              {item.inhalt ? <p className={stile.itemInhalt}>{item.inhalt}</p> : null}
            </li>
          ))}
        </ul>
      )}

      {formOffen ? (
        <form className={stile.formular} onSubmit={(ereignis) => void absenden(ereignis)}>
          <div className={stile.feld}>
            <label htmlFor="tresor-titel">Titel</label>
            <input
              id="tresor-titel"
              className={stile.eingabe}
              value={titel}
              onChange={(e) => setzeTitel(e.target.value)}
              placeholder="z. B. Bankverbindung, Wichtiges Passwort, Persönlicher Brief"
              required
              autoFocus
            />
          </div>

          <div className={stile.feld}>
            <label htmlFor="tresor-inhalt">Inhalt / Notiz</label>
            <textarea
              id="tresor-inhalt"
              className={stile.textbereich}
              value={inhalt}
              onChange={(e) => setzeInhalt(e.target.value)}
              placeholder="Zugangsdaten, Hinweise oder vertrauliche Informationen..."
            />
          </div>

          {fehler === null ? null : (
            <p className={stile.hinweis} role="alert">
              {fehler}
            </p>
          )}

          <div className={stile.gefahrGruppe}>
            <Button type="submit" disabled={laeuft}>
              Im Tresor speichern
            </Button>
            <Button
              variante="sekundaer"
              type="button"
              disabled={laeuft}
              onClick={() => {
                setzeFormOffen(false)
                setzeFehler(null)
              }}
            >
              Abbrechen
            </Button>
          </div>
        </form>
      ) : (
        <Button volleBreite onClick={() => setzeFormOffen(true)}>
          Inhalt in Tresor legen
        </Button>
      )}
    </Card>
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

function VorsorgeTresor({
  fall,
  onLoescheFall,
  onFallAktualisieren,
}: {
  fall: LesbarerFall
  onLoescheFall: (fallId: string) => Promise<void>
  onFallAktualisieren: () => void
}) {
  // Derselbe Sync-Stream wie bei den Aufgaben und Dokumenten (§5): ein Delta,
  // ein Cache, eine Queue je Fall.
  const { zustand: aufgabenZustand, zeilen, mutiere } = useAufgaben(fall)
  const {
    items,
    schwelle,
    istPreparer,
    resplitPending,
    legeItemAn,
    speichereAntwort,
    legeEigeneFrageAn,
    loescheItem,
    verteileShares,
    resplitLaeuft,
    resplitFehler,
  } = useTresor(fall, zeilen, mutiere, onFallAktualisieren)
  const navigate = useNavigate()

  const [loeschenBestaetigen, setzeLoeschenBestaetigen] = useState(false)
  const [loeschenLaeuft, setzeLoeschenLaeuft] = useState(false)
  const [loeschenFehler, setzeLoeschenFehler] = useState<string | null>(null)

  async function vorsorgeLoeschen() {
    setzeLoeschenLaeuft(true)
    setzeLoeschenFehler(null)

    try {
      await onLoescheFall(fall.id)
      navigate('/', { replace: true })
    } catch (ursache) {
      setzeLoeschenFehler(alsNachricht(ursache))
      setzeLoeschenLaeuft(false)
    }
  }

  if (aufgabenZustand.status === 'laedt') {
    return <Ladeanzeige text="Tresor wird geladen..." />
  }

  /*
   * Die Antworten auf die Vorsorgefragen stehen in ihrem eigenen Block; unter
   * "Weitere Tresor-Inhalte" hätten sie ein zweites Mal dagestanden, dort ohne
   * ihre Frage und ohne Feld zum Ändern.
   */
  const freieItems = items.filter((item) => item.frageId === null)

  /*
   * Gezaehlt werden die gelieferten Fragen und die selbst gestellten zusammen.
   * "3 von 8" neben elf Fragen waere eine Auskunft ueber eine Liste, die so
   * nicht auf dem Bildschirm steht.
   *
   * Eine selbst gestellte Frage gilt als beantwortet, sobald etwas im Feld
   * steht: Ihre Zeile entsteht schon beim Stellen der Frage, ihr blosses
   * Dasein sagt also nichts darueber, ob jemand sie beantwortet hat.
   */
  const eigene = eigeneFragen(items)
  const gesamt = VORSORGEFRAGEN.length + eigene.length
  const beantwortet =
    VORSORGEFRAGEN.filter((frage) => antwortZuFrage(items, frage.id) !== null).length +
    eigene.filter((item) => item.inhalt !== '').length

  return (
    <>
      <Card>
        <div className={stile.statusKopf}>
          <h2 className={stile.abschnitt}>Tresor-Status</h2>
          <Badge lage="ruhig">Versiegelt</Badge>
        </div>

        {schwelle.n === 0 ? (
          <>
            <p className={stile.warnung}>
              Der Tresor ist versiegelt. Im Tresor befinden sich Ihre Antworten. Der Tresor kann
              nach Ihrem Tod nur von Ihren Angehörigen geöffnet werde. Bitte laden Sie Angehörige
              ein, damit diese im Ernstfall auf Ihre Antworten Zugriefen können.
            </p>
            <Button volleBreite onClick={() => navigate('/koppeln')}>
              Angehörige einladen
            </Button>
          </>
        ) : schwelle.n === 1 ? (
          <p className={stile.hinweis}>
            Solange nur 1 Angehörige:r hinterlegt ist, kann diese Person den Tresor allein öffnen.
          </p>
        ) : (
          <p className={stile.hinweis}>
            Zur Öffnung sind {schwelle.k} von {schwelle.n} Freigaben erforderlich (k = ⌈2n/3⌉).
          </p>
        )}

        {resplitPending ? (
          <p className={stile.hinweis}>
            Mitglieder haben sich geändert. Die Tresorschlüssel werden aktualisiert...
          </p>
        ) : null}

        {resplitLaeuft ? <p className={stile.hinweis}>Schlüssel werden neu verteilt...</p> : null}
        {resplitFehler !== null && !resplitLaeuft ? (
          <>
            <p className={stile.warnung} role="alert">
              Die Schlüssel konnten nicht neu verteilt werden: {resplitFehler} Bis das
              gelingt, können die zuletzt hinzugekommenen Angehörigen den Tresor nicht
              freigeben.
            </p>
            {/*
              Von Hand und nicht von allein: Ein automatischer zweiter Versuch
              liefe bei einem dauerhaften Fehler in eine Schleife gegen den
              Server. Der Preparer sieht den Stand und entscheidet.
            */}
            <Button volleBreite onClick={() => void verteileShares().catch(() => undefined)}>
              Erneut versuchen
            </Button>
          </>
        ) : null}
      </Card>

      {/*
        Die Todesbestaetigung steht nur bei den Angehoerigen (§3.5, §7).
        Die vorsorgende Person kann ihren eigenen Tod nicht freigeben: `k`
        zaehlt ausschliesslich Angehoerige, und der Knopf war fuer sie ohnehin
        immer gesperrt. Was blieb, war ein Kasten ueber die eigene Beerdigung
        auf dem Weg zu den eigenen Unterlagen.
      */}
      {istPreparer ? null : (
        <Todesfallfreigabe fall={fall} onFallAktualisieren={onFallAktualisieren} />
      )}

      {istPreparer ? (
        <>
          {/*
            Dieselben Fragen wie auf dem ersten Screen, und dieselben Antworten
            (§3.5). Sie stehen hier ein zweites Mal, weil der Tresor der Ort
            ist, an dem man nachsieht, was man hinterlegt hat: Wer eine Auskunft
            ändern will, sucht sie dort, wo sie liegt, und nicht in einem
            Formular auf der Startseite.
          */}
          <Card>
            <div className={stile.statusKopf}>
              <h2 className={stile.abschnitt}>Ihre Vorsorgefragen</h2>
              <Badge lage="ruhig">
                {beantwortet} von {gesamt} beantwortet
              </Badge>
            </div>
            <p className={stile.hinweis}>
              Ihre Antworten liegen verschlüsselt im Tresor. Sie können sie hier jederzeit
              ändern; gespeichert wird jede Antwort für sich.
            </p>
          </Card>

          <Vorsorgefragen
            items={items}
            onSpeichern={speichereAntwort}
            onFrageAnlegen={legeEigeneFrageAn}
            onFrageLoeschen={loescheItem}
          />

          <TresorInhalte items={freieItems} onNeu={legeItemAn} onLoeschen={loescheItem} />

          <Card>
            <h2 className={stile.abschnitt}>Vorsorge beenden</h2>
            <p className={stile.hinweis}>
              Als vorsorgende Person können Sie diesen Fall nicht verlassen. Sie können die
              Vorsorge samt Tresor jedoch unwiderruflich löschen.
            </p>

            {loeschenBestaetigen ? (
              <div className={stile.loeschenGruppe}>
                <p className={stile.warnung}>
                  Möchten Sie diesen Vorsorgefall samt Tresor wirklich unwiderruflich löschen?
                </p>
                <div className={stile.gefahrGruppe}>
                  <Button
                    variante="sekundaer"
                    disabled={loeschenLaeuft}
                    onClick={() => void vorsorgeLoeschen()}
                  >
                    Ja, Vorsorge löschen
                  </Button>
                  <Button
                    variante="sekundaer"
                    disabled={loeschenLaeuft}
                    onClick={() => setzeLoeschenBestaetigen(false)}
                  >
                    Abbrechen
                  </Button>
                </div>
                {loeschenFehler ? (
                  <p className={stile.hinweis} role="alert">
                    {loeschenFehler}
                  </p>
                ) : null}
              </div>
            ) : (
              <Button
                variante="sekundaer"
                volleBreite
                onClick={() => setzeLoeschenBestaetigen(true)}
              >
                Vorsorge löschen
              </Button>
            )}
          </Card>
        </>
      ) : (
        <Card>
          <h2 className={stile.abschnitt}>Geschützter Tresor</h2>
          <p className={stile.hinweis}>
            Dies ist der Vorsorgefall von {fall.personName}. Der Tresor ist versiegelt und wird erst
            nach Bestätigung des Todesfalls durch die Angehörigen geöffnet.
          </p>
        </Card>
      )}
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

/**
 * Ein gegliederter Erklärtext (§8).
 *
 * Die Aufzählung ist eine `ul` und trägt damit gefüllte Punkte, in beiden
 * Ansichten und auch dann, wenn jemand den Text vorgelesen bekommt: Eine
 * Vorlesestimme sagt "Liste mit fünf Einträgen". Punkte, die als Zeichen im
 * Text stünden, sagte sie mit vor.
 */
function Infoblock({ text }: { text: Infotext }) {
  return (
    <div className={stile.info}>
      <h3 className={stile.infoTitel}>{text.titel}</h3>

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
            className={
              abschnitt.art === 'zwischentitel' ? stile.infoZwischentitel : stile.infoAbsatz
            }
          >
            {abschnitt.text}
          </p>
        ),
      )}
    </div>
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
  const { zustand, loescheVorsorgefall: onLoescheFall, aktualisiere: onFallAktualisieren } = useCase()

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
        <VorsorgeTresor
          fall={fall}
          onLoescheFall={onLoescheFall}
          onFallAktualisieren={onFallAktualisieren}
        />
      ) : (
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

          <ErneutDurchlaufen />
        </>
      )}
    </main>
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
