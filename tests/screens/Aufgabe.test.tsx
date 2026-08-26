import { fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Route, Routes } from 'react-router-dom'
import type { AufgabenZustand, Aufgabendaten } from '../../src/hooks/useAufgaben.ts'
import type { Falldaten } from '../../src/hooks/useCase.ts'
import type { Erinnerungsdaten } from '../../src/hooks/useErinnerungen.ts'
import type { Aufgabe as Aufgabendatensatz, Katalogherkunft } from '../../src/services/aufgabenService.ts'
import { baueBaum } from '../../src/services/aufgabenbaum.ts'
import type { LesbarerFall } from '../../src/services/fallService.ts'
import { BENUTZER, rendereMitProvidern } from './harness.tsx'
import { BAUPLAENE } from '../../src/services/fragebaumService.ts'
import { ALLE, NIEMAND, personen } from '../../src/services/zuweisung.ts'

const useCase = vi.fn<() => Falldaten>()
const useAufgaben = vi.fn<() => Aufgabendaten>()

vi.mock('../../src/hooks/useCase.ts', () => ({ useCase: () => useCase() }))
vi.mock('../../src/hooks/useAufgaben.ts', () => ({ useAufgaben: () => useAufgaben() }))

/*
 * Die Dokumente hängen an Storage und an `items` (§7) und haben ihren eigenen
 * Screentest daneben. Hier steht die Attrappe, damit das Aufgabendetail ohne
 * Supabase-Provider rendert: dieselbe Linie wie bei `useAufgaben`.
 */
vi.mock('../../src/hooks/useDokumente.ts', () => ({
  useDokumente: () => ({
    dokumente: [],
    uebersprungen: 0,
    online: true,
    nimmAuf: vi.fn(),
    oeffne: vi.fn(),
    loesche: vi.fn(),
  }),
}))

const { Aufgabe } = await import('../../src/screens/erweitert/Aufgabe/Aufgabe.tsx')

/**
 * Das ganzseitige Aufgabendetail (DESIGN.md §7, §8).
 *
 * Der Screen, an dem die juristische Arbeit sichtbar wird. Geprüft wird, was
 * §7 dort ausdrücklich verlangt: Rechtsgrundlage, Quelle, zuständige Stelle,
 * benötigte Dokumente und Notizen; Unteraufgaben als eigene Zeilen mit eigenem
 * Häkchen; eine Elternaufgabe ohne eigenes Häkchen; die Frist, gerechnet und
 * nie gespeichert; und "Zuerst: ..." bei offenen Abhängigkeiten.
 */

/** Heute als ISO-Kalendertag, damit die Fristen nicht mit dem Jahr altern. */
function heute(): string {
  const jetzt = new Date()
  const monat = `${jetzt.getMonth() + 1}`.padStart(2, '0')
  const tag = `${jetzt.getDate()}`.padStart(2, '0')

  return `${jetzt.getFullYear()}-${monat}-${tag}`
}

const LESBAR: LesbarerFall = {
  zustand: 'lesbar',
  id: 'fall-1',
  status: 'trauerfall',
  personName: 'Hans Weber',
  sterbedatum: heute(),
  kid: 'case_fall-1:1',
  keyGeneration: 1,
  rotationPending: false,
  kc: new Uint8Array([1]),
  kcat: new Uint8Array([2]),
  kv: null,
  preparerId: null,
  vaultCommitment: null,
  vaultResplitPending: false,
  vaultK: null,
  vaultN: null,
  katalogVersion: '2026-08+testtest',
}

function herkunft(ueberschreibung: Partial<Katalogherkunft> = {}): Katalogherkunft {
  return {
    aufgabeId: 'sterbefall-anzeigen',
    version: '2026-08+testtest',
    fristTage: 3,
    fristAb: 'sterbedatum',
    zustaendigeStelle: 'Standesamt des Sterbeortes',
    benoetigteDokumente: ['Todesbescheinigung', 'Personalausweis'],
    unteraufgaben: [],
    haengtAbVon: [],
    hinweis: 'Werktage, keine Kalendertage.',
    kategorie: 'Sofort',
    reihenfolge: 10,
    ...ueberschreibung,
  }
}

function aufgabe(ueberschreibung: Partial<Aufgabendatensatz> = {}): Aufgabendatensatz {
  return {
    id: 'item-1',
    titel: 'Sterbefall beim Standesamt anzeigen',
    beschreibung: 'Das Standesamt beurkundet den Sterbefall.',
    erledigt: false,
    notizen: '',
    parentId: null,
    dependsOn: [],
    assignee: personen([{ userId: BENUTZER.id, name: BENUTZER.anzeigename }]),
    fristAm: null,
    katalog: herkunft(),
    dek: new Uint8Array([9]),
    kid: LESBAR.kid,
    privat: false,
    ...ueberschreibung,
  }
}

const NETZ = { laedtNetz: false, netzfehler: null }

type RohZustand =
  | { status: 'laedt' }
  | Omit<Extract<AufgabenZustand, { status: 'bereit' }>, 'baum'>

const ERINNERUNGEN: Erinnerungsdaten = {
  erlaubnis: 'nicht-verfuegbar',
  frage: vi.fn().mockResolvedValue(undefined),
  geplant: 0,
}

function aufgabendaten(
  ueberschreibung: Partial<Omit<Aufgabendaten, 'zustand'>> & { zustand?: RohZustand } = {},
): Aufgabendaten {
  const { zustand = { status: 'bereit', aufgaben: [aufgabe()], uebersprungen: 0, ...NETZ }, ...rest } =
    ueberschreibung

  return {
    zustand:
      zustand.status === 'laedt' ? zustand : { ...zustand, baum: baueBaum(zustand.aufgaben) },
    zeilen: [],
    mutiere: vi.fn(),
    aktualisiere: vi.fn(),
    erinnerungen: ERINNERUNGEN,
    abgelehnt: [],
    bestaetige: vi.fn(),
    legeAn: vi.fn().mockResolvedValue(undefined),
    schreibe: vi.fn().mockResolvedValue(undefined),
    hakeAb: vi.fn().mockResolvedValue(undefined),
    loesche: vi.fn().mockResolvedValue(undefined),
    ich: { userId: BENUTZER.id, name: BENUTZER.anzeigename },
    uebernimm: vi.fn().mockResolvedValue(undefined),
    gibFrei: vi.fn().mockResolvedValue(undefined),
    weiseZu: vi.fn().mockResolvedValue(undefined),
    uebernahmen: [],
    bestaetigeUebernahmen: vi.fn(),
    gibFuerAlleFrei: vi.fn().mockResolvedValue(undefined),
    fristbezug: { sterbedatum: LESBAR.sterbedatum, kenntnisAm: null, anfechtungKenntnisAm: null },
    nachlass: [],
    setzeKenntnisAm: vi.fn().mockResolvedValue(undefined),
    setzeAnfechtungKenntnisAm: vi.fn().mockResolvedValue(undefined),
    fragebaum: null,
    fragebaumGeladen: true,
    speichereFragebaum: vi.fn().mockResolvedValue(undefined),
    fragebaumAufgabe: () => null,
    legeFragebaumAufgabeAn: vi.fn().mockResolvedValue(undefined),
    ...rest,
  }
}

/** Der Screen unter seiner echten Route, sonst gibt `useParams` keine ID her. */
function zeigeDetail(id = 'item-1') {
  return rendereMitProvidern(
    <Routes>
      <Route path="/aufgabe/:id" element={<Aufgabe />} />
      <Route path="/alle" element={<p>Alle Aufgaben</p>} />
    </Routes>,
    { pfad: `/aufgabe/${id}` },
  )
}

/** Ein Kalendertag, so viele Tage vor heute. */
function vorTagen(tage: number): string {
  const tag = new Date()
  tag.setDate(tag.getDate() - tage)

  const monat = `${tag.getMonth() + 1}`.padStart(2, '0')

  return `${tag.getFullYear()}-${monat}-${`${tag.getDate()}`.padStart(2, '0')}`
}

/** Das Detail einer Aufgabe mit einer Frist ab der eigenen Kenntnis (§8, #12). */
function zeigeAusschlagung({
  kenntnisAm = null,
  aufgaben = [aufgabe({ katalog: herkunft({ fristTage: 42, fristAb: 'kenntnis' }) })],
  setzeKenntnisAm = vi.fn().mockResolvedValue(undefined),
}: {
  kenntnisAm?: string | null
  aufgaben?: Aufgabendatensatz[]
  setzeKenntnisAm?: Aufgabendaten['setzeKenntnisAm']
} = {}) {
  useAufgaben.mockReturnValue(
    aufgabendaten({
      zustand: { status: 'bereit', aufgaben, uebersprungen: 0, ...NETZ },
      fristbezug: { sterbedatum: LESBAR.sterbedatum, kenntnisAm, anfechtungKenntnisAm: null },
      setzeKenntnisAm,
    }),
  )

  return zeigeDetail()
}

beforeEach(() => {
  vi.clearAllMocks()
  useCase.mockReturnValue({
    zustand: { status: 'bereit', faelle: [LESBAR], aktiver: LESBAR },
    legeTrauerfallAn: vi.fn().mockResolvedValue(undefined),
    legeVorsorgefallAn: vi.fn().mockResolvedValue(undefined),
    loescheVorsorgefall: vi.fn().mockResolvedValue(undefined),
    verlasseFall: vi.fn().mockResolvedValue(undefined),
    aktualisiere: vi.fn(),
  })
  useAufgaben.mockReturnValue(aufgabendaten())
})

describe('Aufgabendetail (§7, §8)', () => {
  it('zeigt zuständige Stelle, Dokumente und Hinweis', () => {
    zeigeDetail()

    expect(
      screen.getByRole('heading', { name: 'Sterbefall beim Standesamt anzeigen' }),
    ).toBeVisible()
    expect(screen.getByText('Standesamt des Sterbeortes')).toBeVisible()
    expect(screen.getByText('Todesbescheinigung')).toBeVisible()
    expect(screen.getByText('Personalausweis')).toBeVisible()
    expect(screen.getByText('Werktage, keine Kalendertage.')).toBeVisible()
  })

  it('zeigt weder Rechtsgrundlage noch Quelllink (ADR-0003)', () => {
    zeigeDetail()

    expect(screen.queryByText(/§/)).toBeNull()
    expect(screen.queryByText('Rechtsgrundlage')).toBeNull()
    expect(screen.queryByRole('link', { name: /gesetze-im-internet/ })).toBeNull()
  })

  it('rechnet das Fristende aus und zeigt die Restzeit', () => {
    zeigeDetail()

    expect(screen.getByText('noch 3 Tage')).toBeVisible()
    expect(screen.getByText(/endet am/)).toBeVisible()
  })

  it('zeigt bei einer Frist ab Kenntnis kein gerechnetes Datum', () => {
    // §8: Die App rechnet nicht mit einer Vermutung. Ohne eingetragenes
    // Kenntnisdatum steht hier, woran die Frist hängt, und kein Ende (#12).
    zeigeAusschlagung()

    expect(screen.getByText('Frist ab Ihrer Kenntnis')).toBeVisible()
    expect(screen.getByText(/Diese Frist läuft ab/)).toBeVisible()
    expect(screen.queryByText(/endet am/)).toBeNull()
  })

  it('zeigt bei der Testament-Aufgabe die Frist unverzüglich und die Ermittlung des Gerichts', () => {
    useAufgaben.mockReturnValue(
      aufgabendaten({
        zustand: {
          status: 'bereit',
          aufgaben: [
            aufgabe({
              titel: BAUPLAENE.testament.titel,
              beschreibung: BAUPLAENE.testament.beschreibung,
              katalog: BAUPLAENE.testament.katalog,
            }),
          ],
          uebersprungen: 0,
          ...NETZ,
        },
      }),
    )

    zeigeDetail()

    expect(screen.getByText('unverzüglich')).toBeVisible()
    expect(screen.getByText('unverzüglich (ohne schuldhaftes Zögern)')).toBeVisible()
    expect(screen.getByText('Nachlassgericht (Amtsgericht)')).toBeVisible()
    expect(screen.getByLabelText('Postleitzahl für Gerichtssuche')).toBeVisible()
  })

  it('zeigt bei der Erbschein-Aufgabe die neuen Verfahrensinformationen und einklappbare Hintergrundinfos', () => {
    useAufgaben.mockReturnValue(
      aufgabendaten({
        zustand: {
          status: 'bereit',
          aufgaben: [
            aufgabe({
              titel: BAUPLAENE.erbschein.titel,
              beschreibung: BAUPLAENE.erbschein.beschreibung,
              katalog: BAUPLAENE.erbschein.katalog,
            }),
          ],
          uebersprungen: 0,
          ...NETZ,
        },
      }),
    )

    zeigeDetail()

    // Neue Verfahrensinformationen in "Das gilt dafür"
    expect(screen.getByText('Wie beantragen Sie einen Erbschein?')).toBeVisible()
    expect(screen.getByText('Beim Notar oder beim Nachlassgericht')).toBeVisible()
    expect(
      screen.getByText(
        'Anrufen oder online Termin vereinbaren - die Stellen erklären Ihnen die weiteren Schritte',
      ),
    ).toBeVisible()
    expect(screen.getByText('Notar oder Nachlassgericht:')).toBeVisible()
    expect(
      screen.getByText(/Sie erhalten schneller und innerhalb der Frist einen Termin/),
    ).toBeVisible()
    expect(screen.getByText(/Ihnen fallen keine zusätzlichen Kosten an/)).toBeVisible()

    // Einklappbare Abschnitte für die anderen Informationen
    expect(screen.getByText('1. Was ist ein Erbschein?')).toBeVisible()
    expect(screen.getByText('2. Wofür wird er gebraucht?')).toBeVisible()
    expect(screen.getByText('3. Nicht nötig wenn:')).toBeVisible()
    expect(screen.getByText('4. Kosten')).toBeVisible()

    // Alte Checkliste / Schritte sind gelöscht
    expect(screen.queryByText(/Prüfen, ob ein Erbschein überhaupt nötig ist/)).toBeNull()
  })

  it('zeigt bei der Testamentsanfechtung-Aufgabe die neuen Verfahrensinformationen und einklappbaren Hintergrundtexte', () => {
    useAufgaben.mockReturnValue(
      aufgabendaten({
        zustand: {
          status: 'bereit',
          aufgaben: [
            aufgabe({
              titel: BAUPLAENE.anfechtung.titel,
              beschreibung: BAUPLAENE.anfechtung.beschreibung,
              katalog: BAUPLAENE.anfechtung.katalog,
            }),
          ],
          uebersprungen: 0,
          ...NETZ,
        },
      }),
    )

    zeigeDetail()

    // Einklappbare Abschnitte für Testamentsanfechtung (1 bis 6, ohne "Wie fechte ich...")
    expect(screen.getByText('1. Was ist das?')).toBeVisible()
    expect(screen.getByText('2. Wer darf anfechten?')).toBeVisible()
    expect(screen.getByText('3. Welche Gründe rechtfertigen eine Anfechtung?')).toBeVisible()
    expect(screen.getByText('4. Folge der Anfechtung')).toBeVisible()
    expect(screen.getByText('5. Frist')).toBeVisible()
    expect(screen.getByText('6. Kosten')).toBeVisible()
    expect(screen.queryByText('5. Wie fechte ich ein Testament an?')).toBeNull()

    // Zuständige Stelle Card (ersetzt "Das gilt dafür" und enthält den Verfahrenstext)
    expect(screen.getByRole('heading', { name: 'Zuständige Stelle' })).toBeVisible()
    expect(screen.queryByRole('heading', { name: 'Das gilt dafür' })).toBeNull()

    expect(screen.getByText('Wie fechte ich ein Testament an?')).toBeVisible()
    expect(screen.getByText('Es gibt zwei Möglichkeiten:')).toBeVisible()
    expect(screen.getByText('schriftlicher Antrag an das Nachlassgericht')).toBeInTheDocument()
    expect(screen.getByText('persönlich beim Nachlassgericht')).toBeInTheDocument()
    expect(
      screen.getByText(
        /Hinweis: Bei persönlichem Erscheinen vereinbaren Sie vorher einen Termin beim Nachlassgericht./,
      ),
    ).toBeInTheDocument()

    // Alte Dokumenten- / Schritt-Texte sind gelöscht
    expect(
      screen.queryByText(/Datum eintragen, an dem Sie vom Anfechtungsgrund erfahren haben/),
    ).toBeNull()
  })

  it('zeigt bei der Ausschlagungs-Aufgabe die neuen einheitlichen Schritte und einklappbaren Abschnitte', () => {
    useAufgaben.mockReturnValue(
      aufgabendaten({
        zustand: {
          status: 'bereit',
          aufgaben: [
            aufgabe({
              titel: BAUPLAENE.ausschlagung.titel,
              beschreibung: BAUPLAENE.ausschlagung.beschreibung,
              katalog: BAUPLAENE.ausschlagung.katalog,
            }),
          ],
          uebersprungen: 0,
          ...NETZ,
        },
      }),
    )

    zeigeDetail()

    // Einklappbare Abschnitte
    expect(screen.getByText('1. Frist')).toBeVisible()
    expect(screen.getByText('2. Wie können Sie das Erbe ablehnen?')).toBeVisible()
    expect(
      screen.getByText(/Gibt es ein Testament, läuft die Frist erst los/),
    ).toBeInTheDocument()

    expect(screen.getByText('Termin bei einem Notar vereinbaren')).toBeInTheDocument()
    expect(screen.getByText('Antrag auf Ausschlagung stellen')).toBeInTheDocument()
    expect(
      screen.getByText('Notar beurkundet den Antrag und schickt ihn an das Nachlassgericht'),
    ).toBeInTheDocument()
    expect(
      screen.getByText('telefonisch Termin beim Nachlassgericht vereinbaren'),
    ).toBeInTheDocument()
    expect(screen.getByText('persönlich beim Nachlassgericht erscheinen')).toBeInTheDocument()
    expect(
      screen.getByText(/Beim Notar erhalten Sie schneller und sicher innerhalb der Frist einen Termin/),
    ).toBeInTheDocument()
    expect(screen.getByText(/Beim Nachlassgericht fallen Ihnen keine zusätzlichen Kosten an/)).toBeInTheDocument()

    // Zuständige Stelle als Titel der Card, kein "Das gilt dafür"
    expect(screen.getByRole('heading', { name: 'Zuständige Stelle' })).toBeVisible()
    expect(screen.queryByRole('heading', { name: 'Das gilt dafür' })).toBeNull()

    // Hinweis mit rotem und fettem "Hinweis:"
    const hinweisLabel = screen.getByText('Hinweis:')
    expect(hinweisLabel.tagName).toBe('STRONG')
    expect(hinweisLabel).toHaveClass(/rot/)

    // Alte Dokumenten- / Schritt-Texte sind gelöscht
    expect(screen.queryByText('Sterbeurkunde und Personalausweis mitnehmen')).toBeNull()
  })

  it('zeigt zu einer selbst angelegten Aufgabe keine erfundenen Rechtsangaben', () => {
    useAufgaben.mockReturnValue(
      aufgabendaten({
        zustand: {
          status: 'bereit',
          aufgaben: [aufgabe({ titel: 'Konten kündigen', katalog: null })],
          uebersprungen: 0,
          ...NETZ,
        },
      }),
    )

    zeigeDetail()

    expect(screen.queryByRole('heading', { name: 'Das gilt dafür' })).toBeNull()
  })

  it('zeigt Nachlassgerichtssuche ausgeklappt und persistiert gefundene Gerichte in den Notizen', async () => {
    const schreibe = vi.fn().mockResolvedValue(undefined)
    useAufgaben.mockReturnValue(
      aufgabendaten({
        schreibe,
        zustand: {
          status: 'bereit',
          aufgaben: [
            aufgabe({
              katalog: herkunft({
                zustaendigeStelle: 'Nachlassgericht (Amtsgericht)',
              }),
            }),
          ],
          uebersprungen: 0,
          ...NETZ,
        },
      }),
    )

    zeigeDetail()

    const eingabe = screen.getByPlaceholderText(/PLZ z\. B\./i)
    expect(eingabe).toBeVisible()

    await userEvent.type(eingabe, '74199')

    expect(screen.getByRole('heading', { name: 'Amtsgericht Heilbronn' })).toBeVisible()
    expect(schreibe).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'item-1' }),
      expect.objectContaining({
        notizen: expect.stringContaining('Amtsgericht Heilbronn'),
      }),
    )
  })

  it('persistiert bei ungültiger PLZ oder Nicht-Wohngebiet nichts in den Notizen', async () => {
    const schreibe = vi.fn().mockResolvedValue(undefined)
    useAufgaben.mockReturnValue(
      aufgabendaten({
        schreibe,
        zustand: {
          status: 'bereit',
          aufgaben: [
            aufgabe({
              katalog: herkunft({
                zustaendigeStelle: 'Nachlassgericht (Amtsgericht)',
              }),
            }),
          ],
          uebersprungen: 0,
          ...NETZ,
        },
      }),
    )

    zeigeDetail()

    const eingabe = screen.getByPlaceholderText(/PLZ z\. B\./i)
    await userEvent.type(eingabe, '01053')

    expect(screen.getByText(/Postfach oder Großempfänger/i)).toBeVisible()
    expect(schreibe).not.toHaveBeenCalled()
  })

  it('hat kein eigenes Häkchen: abgehakt wird in der Liste', () => {
    /*
     * Dasselbe Häkchen im Detail und in der Übersicht sind zwei Wege zu einer
     * Handlung, und einer davon liegt zwei Tipps tiefer. Es bleibt der in der
     * Liste; das Detail sagt nur, woran man ist.
     */
    useAufgaben.mockReturnValue(aufgabendaten({}))

    zeigeDetail()

    expect(screen.queryByRole('checkbox', { name: 'Diese Aufgabe ist erledigt' })).toBeNull()
    expect(screen.getByText('Offen. Abhaken können Sie sie in der Liste.')).toBeVisible()
  })

  it('nimmt einer Aufgabe mit Unteraufgaben das eigene Häkchen', () => {
    useAufgaben.mockReturnValue(
      aufgabendaten({
        zustand: {
          status: 'bereit',
          aufgaben: [
            aufgabe(),
            aufgabe({ id: 'kind-1', titel: 'Urkunden bestellen', parentId: 'item-1' }),
            aufgabe({
              id: 'kind-2',
              titel: 'Termin machen',
              parentId: 'item-1',
              erledigt: true,
            }),
          ],
          uebersprungen: 0,
          ...NETZ,
        },
      }),
    )

    zeigeDetail()

    expect(screen.queryByRole('checkbox', { name: 'Diese Aufgabe ist erledigt' })).toBeNull()
    expect(screen.getByText('Offen: 1 von 2 Unteraufgaben erledigt.')).toBeVisible()
    expect(screen.getByRole('checkbox', { name: 'Urkunden bestellen' })).not.toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Termin machen' })).toBeChecked()
  })

  it('gilt als erledigt, sobald alle Unteraufgaben es sind', () => {
    useAufgaben.mockReturnValue(
      aufgabendaten({
        zustand: {
          status: 'bereit',
          aufgaben: [
            aufgabe({ erledigt: false }),
            aufgabe({ id: 'kind-1', titel: 'Urkunden bestellen', parentId: 'item-1', erledigt: true }),
          ],
          uebersprungen: 0,
          ...NETZ,
        },
      }),
    )

    zeigeDetail()

    expect(screen.getByText('Erledigt: alle 1 Unteraufgaben sind abgehakt.')).toBeVisible()
  })

  it('legt eine Unteraufgabe unter dieser Aufgabe an', async () => {
    const legeAn = vi.fn().mockResolvedValue(undefined)
    useAufgaben.mockReturnValue(aufgabendaten({ legeAn }))

    zeigeDetail()

    await userEvent.type(screen.getByLabelText('Neue Unteraufgabe'), 'Urkunden bestellen')
    await userEvent.click(screen.getByRole('button', { name: 'Unteraufgabe hinzufügen' }))

    expect(legeAn).toHaveBeenCalledWith('Urkunden bestellen', 'item-1')
  })

  it('hakt eine Unteraufgabe für sich ab', async () => {
    const hakeAb = vi.fn().mockResolvedValue(undefined)
    useAufgaben.mockReturnValue(
      aufgabendaten({
        hakeAb,
        zustand: {
          status: 'bereit',
          aufgaben: [
            aufgabe(),
            aufgabe({ id: 'kind-1', titel: 'Urkunden bestellen', parentId: 'item-1' }),
          ],
          uebersprungen: 0,
          ...NETZ,
        },
      }),
    )

    zeigeDetail()

    await userEvent.click(screen.getByRole('checkbox', { name: 'Urkunden bestellen' }))

    expect(hakeAb).toHaveBeenCalledWith(expect.objectContaining({ id: 'kind-1' }), true)
  })

  it('fragt, bevor es eine Unteraufgabe löscht', async () => {
    const loesche = vi.fn().mockResolvedValue(undefined)
    useAufgaben.mockReturnValue(
      aufgabendaten({
        loesche,
        zustand: {
          status: 'bereit',
          aufgaben: [
            aufgabe(),
            aufgabe({ id: 'kind-1', titel: 'Urkunden bestellen', parentId: 'item-1' }),
          ],
          uebersprungen: 0,
          ...NETZ,
        },
      }),
    )

    zeigeDetail()

    await userEvent.click(screen.getByRole('button', { name: 'Löschen: „Urkunden bestellen"' }))
    expect(loesche).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole('button', { name: 'Endgültig löschen' }))
    expect(loesche).toHaveBeenCalledWith(expect.objectContaining({ id: 'kind-1' }))
  })

  it('bietet unter einer Unteraufgabe keine weitere Ebene an', () => {
    // §7: eine Ebene, keine Verschachtelung.
    useAufgaben.mockReturnValue(
      aufgabendaten({
        zustand: {
          status: 'bereit',
          aufgaben: [
            aufgabe(),
            aufgabe({ id: 'kind-1', titel: 'Urkunden bestellen', parentId: 'item-1' }),
          ],
          uebersprungen: 0,
          ...NETZ,
        },
      }),
    )

    zeigeDetail('kind-1')

    expect(screen.queryByLabelText('Neue Unteraufgabe')).toBeNull()
    expect(screen.getByText(/Tiefer gliedert die App nicht/)).toBeVisible()
  })

  it('benennt offene Abhängigkeiten und verlinkt sie', () => {
    useAufgaben.mockReturnValue(
      aufgabendaten({
        zustand: {
          status: 'bereit',
          aufgaben: [
            aufgabe({ id: 'zuerst', titel: 'Todesbescheinigung holen' }),
            aufgabe({ dependsOn: ['zuerst'] }),
          ],
          uebersprungen: 0,
          ...NETZ,
        },
      }),
    )

    zeigeDetail()

    expect(screen.getByText(/^Zuerst:/)).toBeVisible()
    expect(screen.getByRole('link', { name: 'Todesbescheinigung holen' })).toHaveAttribute(
      'href',
      '/aufgabe/zuerst',
    )
  })

  it('speichert Notizen', async () => {
    const schreibe = vi.fn().mockResolvedValue(undefined)
    useAufgaben.mockReturnValue(aufgabendaten({ schreibe }))

    zeigeDetail()

    await userEvent.type(screen.getByLabelText(/Notizen/), 'Termin am Montag')
    await userEvent.click(screen.getByRole('button', { name: 'Notizen speichern' }))

    expect(schreibe).toHaveBeenCalledWith(expect.objectContaining({ id: 'item-1' }), {
      notizen: 'Termin am Montag',
    })
  })

  describe('Selbst gesetzte Frist (§7)', () => {
    /** Ein Kalendertag, so viele Tage nach heute. */
    function inTagen(tage: number): string {
      const tag = new Date()
      tag.setDate(tag.getDate() + tage)

      const monat = `${tag.getMonth() + 1}`.padStart(2, '0')

      return `${tag.getFullYear()}-${monat}-${`${tag.getDate()}`.padStart(2, '0')}`
    }

    it('speichert ein eingetragenes Datum an der Aufgabe', async () => {
      const schreibe = vi.fn().mockResolvedValue(undefined)
      useAufgaben.mockReturnValue(aufgabendaten({ schreibe }))

      zeigeDetail()

      fireEvent.change(screen.getByLabelText('Erledigt bis'), {
        target: { value: '2026-06-30' },
      })
      await userEvent.click(screen.getByRole('button', { name: 'Frist speichern' }))

      expect(schreibe).toHaveBeenCalledWith(expect.objectContaining({ id: 'item-1' }), {
        fristAm: '2026-06-30',
      })
    })

    it('entfernt eine eingetragene Frist wieder', async () => {
      const schreibe = vi.fn().mockResolvedValue(undefined)
      useAufgaben.mockReturnValue(
        aufgabendaten({
          zustand: {
            status: 'bereit',
            aufgaben: [aufgabe({ fristAm: inTagen(1) })],
            uebersprungen: 0,
            ...NETZ,
          },
          schreibe,
        }),
      )

      zeigeDetail()

      await userEvent.click(screen.getByRole('button', { name: 'Frist entfernen' }))

      expect(schreibe).toHaveBeenCalledWith(expect.objectContaining({ id: 'item-1' }), {
        fristAm: null,
      })
    })

    it('zeigt die eigene Frist im Badge, wenn sie früher endet als die gesetzliche', () => {
      // Gesetzlich sind es drei Tage ab dem Sterbedatum (siehe `herkunft`).
      useAufgaben.mockReturnValue(
        aufgabendaten({
          zustand: {
            status: 'bereit',
            aufgaben: [aufgabe({ fristAm: inTagen(1) })],
            uebersprungen: 0,
            ...NETZ,
          },
        }),
      )

      zeigeDetail()

      expect(screen.getByText('noch 1 Tag')).toBeVisible()
    })

    it('lässt die gesetzliche Frist von einem späteren eigenen Datum nicht verdecken', () => {
      // §8: Ein selbst eingetragener Tag im nächsten Monat darf eine
      // gesetzliche Frist nicht vom Bildschirm nehmen.
      useAufgaben.mockReturnValue(
        aufgabendaten({
          zustand: {
            status: 'bereit',
            aufgaben: [aufgabe({ fristAm: inTagen(60) })],
            uebersprungen: 0,
            ...NETZ,
          },
        }),
      )

      zeigeDetail()

      expect(screen.getByText('noch 3 Tage')).toBeVisible()
      expect(screen.getByText(/gilt schon eine gesetzliche Frist/)).toBeVisible()
    })
  })

  it('sagt es, wenn die Aufgabe nicht mehr da ist', () => {
    zeigeDetail('gibt-es-nicht')

    expect(screen.getByRole('alert')).toHaveTextContent('Diese Aufgabe gibt es nicht mehr.')
  })

  it('behauptet während des ersten Abrufs nicht, die Aufgabe sei weg', () => {
    useAufgaben.mockReturnValue(
      aufgabendaten({
        zustand: {
          status: 'bereit',
          aufgaben: [],
          uebersprungen: 0,
          laedtNetz: true,
          netzfehler: null,
        },
      }),
    )

    zeigeDetail()

    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByRole('status')).toBeVisible()
  })

  it('trägt einen Notizentwurf nicht in die nächste Aufgabe', async () => {
    /*
     * Der Screen bleibt beim Wechsel über einen "Zuerst: ..."-Link an derselben
     * Stelle im Baum. Ohne `key` behielte React den Zustand des Formulars: Ein
     * angefangener Entwurf stünde im Feld der anderen Aufgabe und landete beim
     * nächsten "Notizen speichern" an der falschen Zeile: eine Notiz, die
     * jemand zu seiner Erbausschlagung getippt hat, unter der Bestattung.
     */
    const schreibe = vi.fn().mockResolvedValue(undefined)

    useAufgaben.mockReturnValue(
      aufgabendaten({
        schreibe,
        zustand: {
          status: 'bereit',
          aufgaben: [
            aufgabe({ id: 'zuerst', titel: 'Todesbescheinigung holen' }),
            aufgabe({ dependsOn: ['zuerst'] }),
          ],
          uebersprungen: 0,
          ...NETZ,
        },
      }),
    )

    zeigeDetail()

    await userEvent.type(screen.getByLabelText(/Notizen/), 'Gilt nur für das Standesamt')
    await userEvent.click(screen.getByRole('link', { name: 'Todesbescheinigung holen' }))

    expect(screen.getByRole('heading', { name: 'Todesbescheinigung holen' })).toBeVisible()
    expect(screen.getByLabelText(/Notizen/)).toHaveValue('')

    // Und gespeichert wurde unterwegs nichts.
    expect(schreibe).not.toHaveBeenCalled()
  })

  it('führt zurück zu allen Aufgaben', async () => {
    zeigeDetail()

    await userEvent.click(screen.getByRole('link', { name: 'Zurück' }))

    await waitFor(() => expect(screen.getByText('Alle Aufgaben')).toBeVisible())
  })
})

/**
 * Zuständigkeit im Aufgabendetail (DESIGN.md §7).
 *
 * Der Screen, auf dem eine Familie die Arbeit verteilt: übernehmen, freigeben,
 * jemanden eintragen, "Alle". Die Sperre gilt für das Bearbeiten, nicht für
 * das Lesen und nicht für die Zuweisung selbst. Wer nicht eingetragen ist, soll
 * die Rechtsgrundlage sehen und sich eintragen können.
 */
describe('Zuständigkeit (§7)', () => {
  const BERT = { userId: 'user_bert', name: 'Bert Müller' }

  function mitAufgabe(ueberschreibung: Partial<Aufgabendatensatz>) {
    const daten = aufgabendaten({
      zustand: {
        status: 'bereit',
        aufgaben: [aufgabe(ueberschreibung)],
        uebersprungen: 0,
        ...NETZ,
      },
    })

    useAufgaben.mockReturnValue(daten)

    return daten
  }

  it('nennt die zuständige Person', () => {
    mitAufgabe({ assignee: personen([BERT]) })

    zeigeDetail()

    // Ohne "Zuständig:" davor: Das steht schon in der Überschrift darüber.
    // Für die Vorlesestimme bleibt es als unsichtbarer Zusatz stehen.
    expect(screen.getByText('Bert Müller')).toBeVisible()
    expect(screen.getByText('Bert Müller').closest('[role="status"]')).toHaveTextContent(
      'Zuständig: Bert Müller',
    )
  })

  it('lässt eine unzugewiesene Aufgabe übernehmen', async () => {
    const daten = mitAufgabe({ assignee: NIEMAND })

    zeigeDetail()

    await userEvent.click(screen.getByRole('button', { name: 'Übernehmen' }))

    expect(daten.weiseZu).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'item-1' }),
      personen([{ userId: BENUTZER.id, name: BENUTZER.anzeigename }]),
    )
  })

  it('lässt jedes Mitglied eine fremde Reservierung lösen', async () => {
    const daten = mitAufgabe({ assignee: personen([BERT]) })

    zeigeDetail()

    await userEvent.click(screen.getByRole('button', { name: 'Freigeben' }))

    expect(daten.weiseZu).toHaveBeenCalledWith(expect.objectContaining({ id: 'item-1' }), NIEMAND)
  })

  it('setzt "Alle" als eigenen Wert und nicht als Liste aller Namen', async () => {
    const daten = mitAufgabe({ assignee: NIEMAND })

    zeigeDetail()

    await userEvent.click(screen.getByRole('button', { name: 'Allen zuweisen' }))

    expect(daten.weiseZu).toHaveBeenCalledWith(expect.objectContaining({ id: 'item-1' }), ALLE)
  })

  it('bietet "Allen zuweisen" nur bei einer freien Aufgabe an', () => {
    /*
     * Aus einer bestehenden Zuweisung heraus waere "Allen" eine Verdraengung
     * und keine Ergaenzung; wer das will, gibt die Aufgabe erst frei.
     */
    mitAufgabe({ assignee: personen([BERT]) })

    zeigeDetail()

    expect(screen.queryByRole('button', { name: 'Allen zuweisen' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Freigeben' })).toBeVisible()
  })

  it('lässt bei "Alle" nur noch freigeben', () => {
    // Bei "Alle" ist jede:r zugewiesen; "Übernehmen" haette nichts zu tun.
    mitAufgabe({ assignee: ALLE })

    zeigeDetail()

    expect(screen.getByText('Alle')).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Übernehmen' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Freigeben' })).toBeVisible()
  })

  it('sperrt Notizen und Unteraufgaben, wenn die Aufgabe nicht mir gehört', () => {
    mitAufgabe({ assignee: personen([BERT]) })

    zeigeDetail()

    expect(screen.getByRole('button', { name: 'Unteraufgabe hinzufügen' })).toBeDisabled()

    // Wer zuständig ist, steht in der Zuständigkeitszeile und nicht ein
    // zweites Mal als Erklärung neben jedem gesperrten Feld.
    expect(screen.getByText('Bert Müller')).toBeVisible()
  })

  it('nennt eine freie Aufgabe frei und bietet sie an', () => {
    mitAufgabe({ assignee: NIEMAND })

    zeigeDetail()

    expect(screen.getByText('Niemand')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Übernehmen' })).toBeEnabled()

    // Die übrige Sperre bleibt: Ändern setzt weiterhin eine Zuweisung voraus.
    expect(screen.getByRole('button', { name: 'Unteraufgabe hinzufügen' })).toBeDisabled()
  })

  it('lässt die Angaben trotzdem lesen', () => {
    mitAufgabe({ assignee: personen([BERT]) })

    zeigeDetail()

    expect(screen.getByText('Standesamt des Sterbeortes')).toBeVisible()
  })

  it('zeigt kein Häkchen an einer Unteraufgabe, die einer anderen Person gehört', () => {
    useAufgaben.mockReturnValue(
      aufgabendaten({
        zustand: {
          status: 'bereit',
          aufgaben: [
            aufgabe({ id: 'item-1' }),
            aufgabe({
              id: 'item-2',
              titel: 'Urkunden bestellen',
              parentId: 'item-1',
              katalog: null,
              assignee: personen([BERT]),
            }),
          ],
          uebersprungen: 0,
          ...NETZ,
        },
      }),
    )

    zeigeDetail()

    expect(screen.queryByRole('checkbox', { name: 'Urkunden bestellen' })).toBeNull()
    expect(screen.getByText('Urkunden bestellen')).toBeVisible()
  })
})

/**
 * Das Aufgabendetail einer privaten Aufgabe (DESIGN.md §3.7, §7).
 *
 * Zwei Dinge stehen hier und nirgends sonst: dass eine private Aufgabe als
 * solche zu erkennen ist, und dass sie keine Unteraufgaben bekommt.
 */
describe('Private Aufgaben im Detail (§3.7)', () => {
  function privateDaten() {
    return aufgabendaten({
      zustand: {
        status: 'bereit',
        aufgaben: [aufgabe({ titel: 'Erbausschlagung erwägen', privat: true, katalog: null })],
        uebersprungen: 0,
        ...NETZ,
      },
    })
  }

  it('sagt, wer die Aufgabe sieht', () => {
    useAufgaben.mockReturnValue(privateDaten())

    zeigeDetail()

    expect(screen.getByRole('heading', { name: 'Sichtbarkeit' })).toBeVisible()
    expect(screen.getByText(/sehen nur Sie, auf Ihren eigenen Geräten/)).toBeVisible()
  })

  it('gibt sie nach Rückfrage für alle frei', async () => {
    const daten = privateDaten()
    useAufgaben.mockReturnValue(daten)

    zeigeDetail()

    await userEvent.click(screen.getByRole('button', { name: 'Für alle sichtbar machen' }))

    expect(screen.getByText(/Zurücknehmen lässt sich das nicht/)).toBeVisible()
    expect(daten.gibFuerAlleFrei).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole('button', { name: 'Für alle sichtbar machen' }))

    await waitFor(() =>
      expect(daten.gibFuerAlleFrei).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'item-1' }),
      ),
    )
  })

  it('legt unter einer privaten Aufgabe keine Unteraufgabe an', () => {
    /*
     * §3.7: Private Aufgaben sind immer Wurzelaufgaben. Eine Unteraufgabe
     * darunter läge unter `K_c` und stünde bei den anderen auf der Wurzelebene
     * — und verriete nebenbei, dass es hier etwas gibt, das sie nicht sehen.
     */
    useAufgaben.mockReturnValue(privateDaten())

    zeigeDetail()

    expect(screen.queryByLabelText('Neue Unteraufgabe')).toBeNull()
    expect(screen.getByText(/Machen Sie sie für alle sichtbar/)).toBeVisible()
  })

  it('lässt eine geteilte Aufgabe unverändert', () => {
    useAufgaben.mockReturnValue(aufgabendaten())

    zeigeDetail()

    expect(screen.queryByRole('heading', { name: 'Sichtbarkeit' })).toBeNull()
    expect(screen.getByLabelText('Neue Unteraufgabe')).toBeVisible()
  })
})

/**
 * Das eigene Kenntnisdatum auf dem Aufgabendetail (DESIGN.md §8, #12).
 *
 * Die Ausschlagungsfrist nach § 1944 BGB knüpft an die Kenntnis des jeweiligen
 * Erben an. Das Datum liegt privat unter `K_p` (§3.7) und wird hier
 * eingetragen: an der Aufgabe, für die es zählt.
 */
describe('Kenntnisdatum (§8, #12)', () => {
  it('bietet das Feld nur bei einer Frist ab Kenntnis an', () => {
    zeigeDetail()

    // Die Sterbefallanzeige hängt am Sterbedatum. Ein Feld ohne Wirkung wäre
    // eine Frage, die niemand beantworten muss.
    expect(screen.queryByLabelText('Tag Ihrer Kenntnis')).toBeNull()
  })

  it('nimmt das Datum entgegen und gibt es an den Hook weiter', () => {
    const setzeKenntnisAm = vi.fn().mockResolvedValue(undefined)
    zeigeAusschlagung({ setzeKenntnisAm })

    fireEvent.change(screen.getByLabelText('Tag Ihrer Kenntnis'), {
      target: { value: '2026-05-12' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Kenntnisdatum speichern' }))

    expect(setzeKenntnisAm).toHaveBeenCalledWith('2026-05-12')
  })

  it('rechnet das Fristende, sobald das Datum eingetragen ist', () => {
    zeigeAusschlagung({ kenntnisAm: heute() })

    expect(screen.getByText(/Ihre Frist endet am/)).toBeVisible()
    expect(screen.getByText('noch 42 Tage')).toBeVisible()
  })

  it('zeigt zwei Mitgliedern auf derselben Aufgabe verschiedene Fristenden', () => {
    /*
     * Die Zusage aus §8: Dieselbe Aufgabe, dasselbe Objekt, zwei Enden. Was
     * auseinandergeht, ist allein das Datum, das jede Person für sich
     * eingetragen hat; an der Zeile ändert sich nichts.
     */
    const geteilt = aufgabe({ katalog: herkunft({ fristTage: 42, fristAb: 'kenntnis' }) })

    const { unmount } = zeigeAusschlagung({ kenntnisAm: heute(), aufgaben: [geteilt] })
    const sohn = screen.getByText(/Ihre Frist endet am/).textContent
    unmount()

    zeigeAusschlagung({ kenntnisAm: vorTagen(21), aufgaben: [geteilt] })
    const bruder = screen.getByText(/Ihre Frist endet am/).textContent

    expect(sohn).not.toBe(bruder)
  })

  it('laesst auch jemanden eintragen, dem die Aufgabe nicht zugewiesen ist', () => {
    /*
     * §7 sperrt das Bearbeiten der Aufgabe, nicht das eigene Kenntnisdatum.
     * Wer es erst nach einer Übernahme eintragen dürfte, sähe seine eigene
     * gesetzliche Frist nicht.
     */
    const setzeKenntnisAm = vi.fn().mockResolvedValue(undefined)

    zeigeAusschlagung({
      setzeKenntnisAm,
      aufgaben: [
        aufgabe({
          katalog: herkunft({ fristTage: 42, fristAb: 'kenntnis' }),
          assignee: personen([{ userId: 'user_bert', name: 'Bert Weber' }]),
        }),
      ],
    })

    fireEvent.change(screen.getByLabelText('Tag Ihrer Kenntnis'), {
      target: { value: '2026-05-12' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Kenntnisdatum speichern' }))

    expect(setzeKenntnisAm).toHaveBeenCalledWith('2026-05-12')
  })

  it('entfernt ein eingetragenes Datum wieder', () => {
    const setzeKenntnisAm = vi.fn().mockResolvedValue(undefined)
    zeigeAusschlagung({ kenntnisAm: heute(), setzeKenntnisAm })

    fireEvent.click(screen.getByRole('button', { name: 'Datum entfernen' }))

    expect(setzeKenntnisAm).toHaveBeenCalledWith(null)
  })
})
