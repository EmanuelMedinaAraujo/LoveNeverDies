import { screen, waitFor } from '@testing-library/react'
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
import { ALLE, NIEMAND, personen } from '../../src/services/zuweisung.ts'

const useCase = vi.fn<() => Falldaten>()
const useAufgaben = vi.fn<() => Aufgabendaten>()

vi.mock('../../src/hooks/useCase.ts', () => ({ useCase: () => useCase() }))
vi.mock('../../src/hooks/useAufgaben.ts', () => ({ useAufgaben: () => useAufgaben() }))

/*
 * Die Mitgliederliste kommt vom Server (§4). Hier steht sie fest: Der Screen
 * soll zeigen, was er aus ihr macht, nicht ob Supabase antwortet.
 */
let useMitgliederfehler: string | null = null

vi.mock('../../src/hooks/useMitglieder.ts', () => ({
  useMitglieder: () => ({
    userIds: [BENUTZER.id, 'user_bert'],
    ich: { userId: BENUTZER.id, name: BENUTZER.anzeigename },
    fehler: useMitgliederfehler,
  }),
}))

const { Aufgabe } = await import('../../src/screens/shared/Aufgabe/Aufgabe.tsx')

/**
 * Das ganzseitige Aufgabendetail (DESIGN.md §7, §8).
 *
 * Der Screen, an dem die juristische Arbeit sichtbar wird. Geprüft wird, was
 * §7 dort ausdrücklich verlangt: Rechtsgrundlage, Quelle, zuständige Stelle,
 * benötigte Dokumente und Notizen; Unteraufgaben als eigene Zeilen mit eigenem
 * Häkchen; eine Elternaufgabe ohne eigenes Häkchen; die Frist, gerechnet und
 * nie gespeichert; und „Zuerst: …" bei offenen Abhängigkeiten.
 */

/** Heute als ISO-Kalendertag — damit die Fristen nicht mit dem Jahr altern. */
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
  kc: new Uint8Array([1]),
  kcat: new Uint8Array([2]),
  katalogVersion: '2026-08+testtest',
}

function herkunft(ueberschreibung: Partial<Katalogherkunft> = {}): Katalogherkunft {
  return {
    aufgabeId: 'sterbefall-anzeigen',
    version: '2026-08+testtest',
    fristTage: 3,
    fristAb: 'sterbedatum',
    rechtsgrundlage: '§ 28 PStG',
    zustaendigeStelle: 'Standesamt des Sterbeortes',
    benoetigteDokumente: ['Todesbescheinigung', 'Personalausweis'],
    unteraufgaben: [],
    haengtAbVon: [],
    hinweis: 'Werktage, keine Kalendertage.',
    quelleUrl: 'https://www.gesetze-im-internet.de/pstg/__28.html',
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
    katalog: herkunft(),
    dek: new Uint8Array([9]),
    kid: LESBAR.kid,
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
    ...rest,
  }
}

/** Der Screen unter seiner echten Route — sonst gibt `useParams` keine ID her. */
function zeigeDetail(id = 'item-1') {
  return rendereMitProvidern(
    <Routes>
      <Route path="/aufgabe/:id" element={<Aufgabe />} />
      <Route path="/alle" element={<p>Alle Aufgaben</p>} />
    </Routes>,
    { pfad: `/aufgabe/${id}` },
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  useMitgliederfehler = null
  useCase.mockReturnValue({
    zustand: { status: 'bereit', faelle: [LESBAR], aktiver: LESBAR },
    legeTrauerfallAn: vi.fn().mockResolvedValue(undefined),
  })
  useAufgaben.mockReturnValue(aufgabendaten())
})

describe('Aufgabendetail (§7, §8)', () => {
  it('zeigt Rechtsgrundlage, zuständige Stelle, Dokumente, Hinweis und Quelle', () => {
    zeigeDetail()

    expect(
      screen.getByRole('heading', { name: 'Sterbefall beim Standesamt anzeigen' }),
    ).toBeVisible()
    expect(screen.getByText('§ 28 PStG')).toBeVisible()
    expect(screen.getByText('Standesamt des Sterbeortes')).toBeVisible()
    expect(screen.getByText('Todesbescheinigung')).toBeVisible()
    expect(screen.getByText('Personalausweis')).toBeVisible()
    expect(screen.getByText('Werktage, keine Kalendertage.')).toBeVisible()
    expect(screen.getByRole('link', { name: /gesetze-im-internet/ })).toHaveAttribute(
      'href',
      'https://www.gesetze-im-internet.de/pstg/__28.html',
    )
  })

  it('rechnet das Fristende aus und zeigt die Restzeit', () => {
    zeigeDetail()

    expect(screen.getByText('noch 3 Tage')).toBeVisible()
    expect(screen.getByText(/endet am/)).toBeVisible()
  })

  it('zeigt bei einer Frist ab Kenntnis kein gerechnetes Datum', () => {
    // §8: Die App rechnet nicht mit einer Vermutung. Das Kenntnisdatum kommt
    // in #12; bis dahin steht hier, woran die Frist hängt.
    useAufgaben.mockReturnValue(
      aufgabendaten({
        zustand: {
          status: 'bereit',
          aufgaben: [aufgabe({ katalog: herkunft({ fristTage: 42, fristAb: 'kenntnis' }) })],
          uebersprungen: 0,
          ...NETZ,
        },
      }),
    )

    zeigeDetail()

    expect(screen.getByText('Frist ab Ihrer Kenntnis')).toBeVisible()
    expect(screen.queryByText(/endet am/)).toBeNull()
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

    expect(screen.queryByRole('heading', { name: 'Rechtliches' })).toBeNull()
  })

  it('lässt ein Blatt direkt abhaken', async () => {
    const hakeAb = vi.fn().mockResolvedValue(undefined)
    useAufgaben.mockReturnValue(aufgabendaten({ hakeAb }))

    zeigeDetail()

    await userEvent.click(screen.getByRole('checkbox', { name: 'Diese Aufgabe ist erledigt' }))

    expect(hakeAb).toHaveBeenCalledWith(expect.objectContaining({ id: 'item-1' }), true)
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
     * Der Screen bleibt beim Wechsel über einen „Zuerst: …"-Link an derselben
     * Stelle im Baum. Ohne `key` behielte React den Zustand des Formulars: Ein
     * angefangener Entwurf stünde im Feld der anderen Aufgabe und landete beim
     * nächsten „Notizen speichern" an der falschen Zeile — eine Notiz, die
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

    await userEvent.click(screen.getByRole('link', { name: 'Zurück zu allen Aufgaben' }))

    await waitFor(() => expect(screen.getByText('Alle Aufgaben')).toBeVisible())
  })
})

/**
 * Zuständigkeit im Aufgabendetail (DESIGN.md §7).
 *
 * Der Screen, auf dem eine Familie die Arbeit verteilt: übernehmen, freigeben,
 * jemanden eintragen, „Alle". Die Sperre gilt für das Bearbeiten — nicht für
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

    expect(screen.getByText('Zuständig: Bert Müller')).toBeVisible()
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

  it('weist einer zweiten Person zu, ohne die erste zu verdrängen', async () => {
    const daten = mitAufgabe({ assignee: personen([{ userId: BENUTZER.id, name: BENUTZER.anzeigename }]) })

    zeigeDetail()

    /*
     * „Weiteres Mitglied": Bert steht in `memberships`, aber sein Name ist
     * diesem Gerät noch nirgends begegnet. Die Namenstabelle `profiles` kommt
     * mit der Kopplung (#10, §3.3) — bis dahin ist eine namenlose Person immer
     * noch besser als eine unsichtbare.
     */
    await userEvent.click(screen.getByRole('checkbox', { name: 'Weiteres Mitglied' }))

    expect(daten.weiseZu).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'item-1' }),
      personen([{ userId: BENUTZER.id, name: BENUTZER.anzeigename }, { userId: BERT.userId, name: '' }]),
    )
  })

  it('setzt "Alle" als eigenen Wert und nicht als Liste aller Namen', async () => {
    const daten = mitAufgabe({ assignee: NIEMAND })

    zeigeDetail()

    await userEvent.click(screen.getByRole('checkbox', { name: 'Alle' }))

    expect(daten.weiseZu).toHaveBeenCalledWith(expect.objectContaining({ id: 'item-1' }), ALLE)
  })

  it('macht aus "Alle" die eine Person, die angetippt wird', async () => {
    /*
     * Bei „Alle" stehen alle Häkchen, ein Tipp kommt also als „abwählen" an —
     * gemeint ist aber „nur sie". Ein Klick, der sichtbar nichts tut, wäre die
     * schlechtere Antwort.
     */
    const daten = mitAufgabe({ assignee: ALLE })

    zeigeDetail()

    await userEvent.click(screen.getByRole('checkbox', { name: 'Sie' }))

    expect(daten.weiseZu).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'item-1' }),
      personen([{ userId: BENUTZER.id, name: BENUTZER.anzeigename }]),
    )
  })

  it('zeigt bei "Alle" jedes Mitglied als zugewiesen', () => {
    mitAufgabe({ assignee: ALLE })

    zeigeDetail()

    expect(screen.getByRole('checkbox', { name: 'Alle' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Sie' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Weiteres Mitglied' })).toBeChecked()
  })

  it('kennt den Namen eines Mitglieds, sobald er in einer Zuweisung steht', () => {
    // Der Name kommt aus dem Payload, in dem er ohnehin steht — nicht aus einer
    // Tabelle, die es noch nicht gibt (§3.3, #10).
    mitAufgabe({ assignee: personen([BERT]) })

    zeigeDetail()

    expect(screen.getByRole('checkbox', { name: 'Bert Müller' })).toBeChecked()
  })

  it('sperrt Häkchen, Notizen und Unteraufgaben, wenn die Aufgabe nicht mir gehört', () => {
    mitAufgabe({ assignee: personen([BERT]) })

    zeigeDetail()

    expect(screen.getByRole('checkbox', { name: 'Diese Aufgabe ist erledigt' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Unteraufgabe hinzufügen' })).toBeDisabled()
    expect(
      screen.getByText(/Diese Aufgabe ist Ihnen nicht zugewiesen/),
    ).toBeVisible()
  })

  it('sagt es, wenn die Mitglieder nicht abrufbar sind', () => {
    useMitgliederfehler = 'Kein Netz.'
    mitAufgabe({ assignee: NIEMAND })

    zeigeDetail()

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Die Mitglieder dieses Falls sind gerade nicht abrufbar. Kein Netz.',
    )

    // Übernehmen geht trotzdem: Dafür braucht es nur die eigene Person.
    expect(screen.getByRole('button', { name: 'Übernehmen' })).toBeEnabled()
  })

  it('lässt die Rechtsgrundlage trotzdem lesen', () => {
    mitAufgabe({ assignee: personen([BERT]) })

    zeigeDetail()

    expect(screen.getByText('§ 28 PStG')).toBeVisible()
  })

  it('sperrt das Häkchen einer Unteraufgabe, die einer anderen Person gehört', () => {
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

    expect(screen.getByRole('checkbox', { name: 'Urkunden bestellen' })).toBeDisabled()
  })
})
