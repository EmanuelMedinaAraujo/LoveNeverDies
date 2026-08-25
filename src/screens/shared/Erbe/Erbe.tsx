import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { alsNachricht } from '../../../core/fehler.ts'
import { useAufgaben } from '../../../hooks/useAufgaben.ts'
import { useCase } from '../../../hooks/useCase.ts'
import { useTodesfall } from '../../../hooks/useTodesfall.ts'
import { useTresor } from '../../../hooks/useTresor.ts'
import type { LesbarerFall } from '../../../services/fallService.ts'
import type { TresorItem } from '../../../services/tresorService.ts'
import { Badge } from '../../../ui/Badge/Badge.tsx'
import { Button } from '../../../ui/Button/Button.tsx'
import { Card } from '../../../ui/Card/Card.tsx'
import { KeinFall } from '../KeinFall/KeinFall.tsx'
import { fallLadeText } from '../Ladeanzeige/FallLadeanzeige.tsx'
import stile from './Erbe.module.css'

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
        <h2 className={stile.abschnitt}>Tresor-Inhalte</h2>
        <Badge lage="ruhig">{items.length} {items.length === 1 ? 'Eintrag' : 'Einträge'}</Badge>
      </div>

      <p className={stile.hinweis}>
        Inhalte im Tresor liegen verschlüsselt unter Ihrem Tresorschlüssel K_v. Angehörige
        erhalten erst nach dem Trauerfall und mit den nötigen Freigaben Zugriff.
      </p>

      {items.length === 0 ? (
        <p className={stile.hinweis}>Der Tresor ist noch leer.</p>
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
              Der Tresor ist versiegelt, kann aber noch von niemandem geöffnet werden. Bitte laden
              Sie Angehörige ein, damit der Tresor im Ernstfall freigegeben werden kann.
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

      <Todesfallfreigabe fall={fall} onFallAktualisieren={onFallAktualisieren} />

      {istPreparer ? (
        <>
          <TresorInhalte items={items} onNeu={legeItemAn} onLoeschen={loescheItem} />

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
        <Card>
          <div className={stile.statusKopf}>
            <h2 className={stile.abschnitt}>Nachlass-Tresor</h2>
            <Badge lage="ruhig">Trauerfall</Badge>
          </div>
          <p className={stile.hinweis}>
            Der Fall ist ein Trauerfall. Die Aufgaben und Dokumente stehen im Tab „Alle"
            bereit.
          </p>
        </Card>
      )}
    </main>
  )
}
