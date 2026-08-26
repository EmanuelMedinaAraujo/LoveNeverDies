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

  it('legt eine Unteraufgabe im Dialog hinter dem Plus an', async () => {
    const legeAn = vi.fn().mockResolvedValue(undefined)
    useAufgaben.mockReturnValue(aufgabendaten({ legeAn }))

    zeigeDetail()

    // Solange niemand das Plus antippt, steht unter der Liste kein Formular.
    expect(screen.queryByRole('dialog')).toBeNull()

    await userEvent.click(screen.getByRole('button', { name: 'Neue Unteraufgabe' }))
    await userEvent.type(screen.getByLabelText('Was ist zu tun?'), 'Urkunden bestellen')
    await userEvent.click(screen.getByRole('button', { name: 'Unteraufgabe speichern' }))

    expect(legeAn).toHaveBeenCalledWith('Urkunden bestellen', 'item-1', false, {
      beschreibung: '',
      fristAm: null,
    })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('nimmt auch bei einer Unteraufgabe Beschreibung und Frist auf (§7)', async () => {
    /*
     * Eine Unteraufgabe ist eine Zeile wie jede andere und hat ihre eigene
     * Frist: "Sterbeurkunden bestellen" bis Freitag, "Termin machen" bis
     * übermorgen. Genau dafür sind es eigene Zeilen und keine Liste im
     * Payload der Elternaufgabe.
     */
    const legeAn = vi.fn().mockResolvedValue(undefined)
    useAufgaben.mockReturnValue(aufgabendaten({ legeAn }))

    zeigeDetail()

    await userEvent.click(screen.getByRole('button', { name: 'Neue Unteraufgabe' }))
    await userEvent.type(screen.getByLabelText('Was ist zu tun?'), 'Urkunden bestellen')
    await userEvent.type(screen.getByLabelText('Beschreibung (optional)'), 'Sechs Stück')
    await userEvent.type(screen.getByLabelText('Erledigt bis (optional)'), '2026-09-30')
    await userEvent.click(screen.getByRole('button', { name: 'Unteraufgabe speichern' }))

    expect(legeAn).toHaveBeenCalledWith('Urkunden bestellen', 'item-1', false, {
      beschreibung: 'Sechs Stück',
      fristAm: '2026-09-30',
    })
  })

  it('bietet in der Unteraufgabe keinen Schalter "Nur für mich" an (§3.7)', async () => {
    /*
     * Private Aufgaben sind immer Wurzelaufgaben. Eine private Unteraufgabe
     * läge unter `K_p`, und dieselbe Elternaufgabe hätte für ihre Besitzerin
     * drei Kinder und für alle anderen zwei.
     */
    useAufgaben.mockReturnValue(aufgabendaten())

    zeigeDetail()

    await userEvent.click(screen.getByRole('button', { name: 'Neue Unteraufgabe' }))

    expect(screen.queryByRole('checkbox', { name: 'Nur für mich' })).toBeNull()
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

  it('bietet an einer Unteraufgabenzeile keine Aktion an, sondern den Weg ins Detail', () => {
    /*
     * „Zuständigkeit ändern" versprach etwas Engeres, als der Link tat, und
     * „Löschen" stand unter jeder Zeile. Gelöscht wird jetzt in der Aufgabe
     * selbst, oben rechts, wie bei jeder anderen auch.
     */
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

    zeigeDetail()

    expect(screen.queryByRole('link', { name: /Zuständigkeit ändern/ })).toBeNull()
    expect(
      screen.queryByRole('button', { name: /Löschen.*Urkunden bestellen/ }),
    ).toBeNull()

    expect(
      screen.getByRole('link', { name: 'Details: „Urkunden bestellen“' }),
    ).toHaveAttribute('href', '/aufgabe/kind-1')
  })

  it('löscht die Aufgabe nach Rückfrage über den Weg oben rechts', async () => {
    const loesche = vi.fn().mockResolvedValue(undefined)
    useAufgaben.mockReturnValue(aufgabendaten({ loesche }))

    zeigeDetail()

    await userEvent.click(
      screen.getByRole('button', { name: /Aufgabe löschen.*Sterbefall/ }),
    )
    expect(loesche).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog')).toHaveTextContent('wirklich löschen')

    await userEvent.click(screen.getByRole('button', { name: 'Endgültig löschen' }))
    await waitFor(() =>
      expect(loesche).toHaveBeenCalledWith(expect.objectContaining({ id: 'item-1' })),
    )
  })

  it('löscht die Aufgabe nach Rückfrage über die Schaltfläche unten', async () => {
    const loesche = vi.fn().mockResolvedValue(undefined)
    useAufgaben.mockReturnValue(aufgabendaten({ loesche }))

    zeigeDetail()

    await userEvent.click(screen.getByRole('button', { name: 'Aufgabe löschen' }))
    expect(loesche).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog')).toHaveTextContent('wirklich löschen')

    await userEvent.click(screen.getByRole('button', { name: 'Endgültig löschen' }))
    await waitFor(() =>
      expect(loesche).toHaveBeenCalledWith(expect.objectContaining({ id: 'item-1' })),
    )
  })

  it('löscht eine Unteraufgabe nach Rückfrage über oben rechts und unten', async () => {
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

    zeigeDetail('kind-1')

    // Oben rechts Icon-Button
    const obenKnopf = screen.getByRole('button', {
      name: /Unteraufgabe löschen.*Urkunden bestellen/,
    })
    expect(obenKnopf).toBeVisible()

    // Unten Button
    const untenKnopf = screen.getByRole('button', { name: 'Unteraufgabe löschen' })
    expect(untenKnopf).toBeVisible()

    await userEvent.click(untenKnopf)
    expect(screen.getByRole('dialog')).toHaveTextContent('wirklich löschen')
    await userEvent.click(screen.getByRole('button', { name: 'Endgültig löschen' }))
    await waitFor(() =>
      expect(loesche).toHaveBeenCalledWith(expect.objectContaining({ id: 'kind-1' })),
    )
  })

  it('bietet das Löschen nicht an, wo niemand bearbeiten darf', () => {
    // §7: Bearbeiten darf nur, wem sie zugewiesen ist — und wegnehmen erst recht.
    useAufgaben.mockReturnValue(
      aufgabendaten({
        zustand: {
          status: 'bereit',
          aufgaben: [
            aufgabe({ assignee: personen([{ userId: 'user_bert', name: 'Bert Müller' }]) }),
          ],
          uebersprungen: 0,
          ...NETZ,
        },
      }),
    )

    zeigeDetail()

    expect(screen.queryByRole('button', { name: /löschen/i })).toBeNull()
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

    /*
     * Der Abschnitt steht gar nicht mehr da. Vorher stand dort eine leere
     * Karte mit dem Satz "Tiefer gliedert die App nicht" — eine Überschrift,
     * eine Fläche und ein Absatz, um mitzuteilen, dass es hier nichts gibt.
     */
    expect(screen.queryByRole('heading', { name: 'Unteraufgaben' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Neue Unteraufgabe' })).toBeNull()
    expect(screen.queryByText(/Tiefer gliedert die App nicht/)).toBeNull()
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

  it('speichert Notizen von selbst, ohne Schaltfläche', async () => {
    /*
     * §5, §7: Ein Feld mit einer Schaltfläche daneben ist eine Zusage, die man
     * einlösen muss. Auf einem Telefon verdeckt die Tastatur genau die
     * Schaltfläche, die man danach hätte drücken sollen.
     */
    const schreibe = vi.fn().mockResolvedValue(undefined)
    useAufgaben.mockReturnValue(aufgabendaten({ schreibe }))

    zeigeDetail()

    expect(screen.queryByRole('button', { name: 'Notizen speichern' })).toBeNull()

    await userEvent.type(screen.getByLabelText(/Notizen/), 'Termin am Montag')

    await waitFor(
      () =>
        expect(schreibe).toHaveBeenCalledWith(expect.objectContaining({ id: 'item-1' }), {
          notizen: 'Termin am Montag',
        }),
      { timeout: 3000 },
    )
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

      // Kein erklärender Satz und keine Feldbeschriftung mehr: über dem Feld
      // steht „Frist", und ein Datumsfeld darunter sagt den Rest.
      expect(screen.queryByText(/Bis wann soll diese Aufgabe erledigt sein/)).toBeNull()
      expect(screen.queryByRole('button', { name: 'Frist speichern' })).toBeNull()

      fireEvent.change(screen.getByLabelText('Frist'), {
        target: { value: '2026-06-30' },
      })

      await waitFor(
        () =>
          expect(schreibe).toHaveBeenCalledWith(expect.objectContaining({ id: 'item-1' }), {
            fristAm: '2026-06-30',
          }),
        { timeout: 3000 },
      )
    })

    it('entfernt eine eingetragene Frist über das Kreuz in der Zeile', async () => {
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

      const kreuz = screen.getByRole('button', { name: 'Frist entfernen' })

      // In derselben Zeile wie das Feld, nicht als eigener Kasten darunter:
      // Das Kreuz gehört zu diesem einen Feld.
      expect(kreuz.parentElement).toContainElement(screen.getByLabelText('Frist'))

      await userEvent.click(kreuz)

      expect(schreibe).toHaveBeenCalledWith(expect.objectContaining({ id: 'item-1' }), {
        fristAm: null,
      })
      expect(screen.getByLabelText('Frist')).toHaveValue('')
    })

    it('zeigt das Kreuz erst, wenn etwas im Feld steht', () => {
      useAufgaben.mockReturnValue(aufgabendaten())

      zeigeDetail()

      expect(screen.queryByRole('button', { name: 'Frist entfernen' })).toBeNull()
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

    expect(screen.getByRole('button', { name: 'Neue Unteraufgabe' })).toBeDisabled()
    expect(screen.getByLabelText(/Notizen/)).toBeDisabled()

    // Wer zuständig ist, steht in der Zuständigkeitszeile
    expect(screen.getByText('Bert Müller')).toBeVisible()
  })

  it('zeigt beim Antippen deaktivierter Felder einen Hinweis zur Zuweisung', async () => {
    mitAufgabe({ assignee: personen([BERT]) })

    zeigeDetail()

    // Vorher kein Hinweis
    expect(screen.queryByRole('alert')).toBeNull()

    // Frist antippen
    await userEvent.click(screen.getByLabelText('Frist').parentElement!)
    expect(await screen.findByRole('alert')).toHaveTextContent(
      /Zuständig: Bert Müller.*unter „Zuständigkeit“/,
    )

    // Notizen antippen
    await userEvent.click(screen.getByLabelText(/Notizen/).parentElement!)
    expect(screen.getAllByRole('alert')).toHaveLength(2)

    // Dokumente antippen
    await userEvent.click(screen.getByText('Dokument abfotografieren'))
    expect(screen.getAllByRole('alert')).toHaveLength(3)
  })

  it('zeigt bei einer freien Aufgabe beim Antippen deaktivierter Felder den Hinweis sich die Aufgabe zuzuweisen', async () => {
    mitAufgabe({ assignee: NIEMAND })

    zeigeDetail()

    await userEvent.click(screen.getByLabelText('Frist').parentElement!)
    expect(await screen.findByRole('alert')).toHaveTextContent(
      /Weisen Sie sich die Aufgabe erst zu/,
    )
  })

  it('nennt eine freie Aufgabe frei und bietet sie an', () => {
    mitAufgabe({ assignee: NIEMAND })

    zeigeDetail()

    expect(screen.getByText('Niemand zugewiesen')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Übernehmen' })).toBeEnabled()

    // Die übrige Sperre bleibt: Ändern setzt weiterhin eine Zuweisung voraus.
    expect(screen.getByRole('button', { name: 'Neue Unteraufgabe' })).toBeDisabled()
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

    expect(screen.queryByRole('button', { name: 'Neue Unteraufgabe' })).toBeNull()
    expect(screen.getByText(/Machen Sie sie für alle sichtbar/)).toBeVisible()
  })

  it('lässt eine geteilte Aufgabe unverändert', () => {
    useAufgaben.mockReturnValue(aufgabendaten())

    zeigeDetail()

    expect(screen.queryByRole('heading', { name: 'Sichtbarkeit' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Neue Unteraufgabe' })).toBeEnabled()
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
