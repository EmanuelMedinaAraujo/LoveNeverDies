import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactElement } from 'react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Falldaten } from '../../src/hooks/useCase.ts'
import type { Aufgabe, Fragebaumergebnis } from '../../src/services/aufgabenService.ts'
import type { LesbarerFall } from '../../src/services/fallService.ts'
import { AuthKontextProvider } from '../../src/core/auth/authProvider.ts'
import { authWert } from './harness.tsx'

/**
 * Der Fragebaum als Screen (ERBE_DESIGN.md §3, §6, §7).
 *
 * Geprüft wird, was der Screen aus einem Zustand macht: dass der Pfad im
 * `state` des Routers hängt und ein Einstieg ohne ihn von vorn beginnt, dass
 * der erste Durchlauf schreibt und ein zweiter nicht, und dass die Aufgabe
 * höchstens einmal entsteht.
 */

const useCase = vi.fn<() => Falldaten>()
const speichereFragebaum = vi.fn<(pfad: string[], ersetzen?: boolean) => Promise<void>>()
const legeFragebaumAufgabeAn = vi.fn<(vorlage: string, notizen?: string) => Promise<void>>()
const setzeKenntnisAm = vi.fn<(wert: string | null) => Promise<void>>()
const setzeAnfechtungKenntnisAm = vi.fn<(wert: string | null) => Promise<void>>()
const mockFragebaum = vi.fn<() => Fragebaumergebnis | null>(() => null)
/** Ob Bestand und `K_p` schon da sind (ERBE_DESIGN.md §6). */
const mockGeladen = vi.fn<() => boolean>(() => true)
const mockVorhandene = vi.fn<() => Aufgabe | null>(() => null)
/**
 * Ob der Mock je Rendern eine neue `speichereFragebaum`-Identität ausgibt.
 *
 * Der echte Hook steckt die Funktion in ein `useCallback`, das an
 * `liste.konfiguration` hängt: Sobald ein Schreiben durchkommt, ist sie eine
 * andere. Ein Fehlschlag dagegen lässt die Konfiguration unberührt — dann
 * bleibt sie dieselbe, und ein Wiederholungsversuch, der auf einen Wechsel
 * wartet, wartet für immer. Beides muss prüfbar sein.
 */
const mockNeueIdentitaet = vi.fn<() => boolean>(() => true)
const mockModus = vi.fn<() => 'einfach' | 'erweitert'>(() => 'erweitert')

vi.mock('../../src/hooks/useCase.ts', () => ({ useCase: () => useCase() }))

vi.mock('../../src/hooks/useAnsichtsmodus.ts', () => ({
  useAnsichtsmodus: () => mockModus(),
}))

vi.mock('../../src/hooks/useAufgaben.ts', () => ({
  useAufgaben: () => ({
    fragebaum: mockFragebaum(),
    fragebaumGeladen: mockGeladen(),
    /*
     * Bei jedem Rendern eine neue Identität, und nicht der Spion selbst.
     *
     * Der echte `speichereFragebaum` hängt in einem `useCallback` an
     * `liste.konfiguration`, und die wechselt, sobald geschrieben wurde. Gäbe
     * der Mock immer dieselbe Funktion zurück, änderte sich keine Abhängigkeit
     * des schreibenden Effekts, er liefe ohnehin nur einmal — und der
     * Doppelschreib-Test bestünde auch ohne den Riegel, den er prüft.
     */
    speichereFragebaum: mockNeueIdentitaet()
      ? (...argumente: Parameters<typeof speichereFragebaum>) => speichereFragebaum(...argumente)
      : speichereFragebaum,
    fragebaumAufgabe: () => mockVorhandene(),
    legeFragebaumAufgabeAn,
    setzeKenntnisAm,
    setzeAnfechtungKenntnisAm,
    fristbezug: { sterbedatum: null, kenntnisAm: null, anfechtungKenntnisAm: null },
    nachlass: [],
  }),
}))

const { Fragebaum } = await import('../../src/screens/shared/Fragebaum/Fragebaum.tsx')

const LESBAR: LesbarerFall = {
  zustand: 'lesbar',
  id: 'fall-1',
  status: 'trauerfall',
  personName: 'Hans Weber',
  sterbedatum: '2026-03-15',
  kid: 'case_fall-1:1',
  keyGeneration: 1,
  rotationPending: false,
  kc: new Uint8Array([1]),
  kcat: new Uint8Array([2]),
  preparerId: 'user_1',
  vaultCommitment: null,
  katalogVersion: null,
  kv: null,
  vaultResplitPending: false,
  vaultK: null,
  vaultN: 0,
}

function falldaten(): Falldaten {
  return {
    zustand: { status: 'bereit', aktiver: LESBAR, faelle: [LESBAR] },
    legeTrauerfallAn: vi.fn(),
    legeVorsorgefallAn: vi.fn(),
    loescheVorsorgefall: vi.fn(),
    verlasseFall: vi.fn(),
    aktualisiere: vi.fn(),
  }
}

/** Der Screen an einer Adresse, mit oder ohne Pfad im `state`. */
function zeige(pfadAdresse: string, zustand?: { pfad: string[] }): ReactElement {
  const eintrag = zustand === undefined ? pfadAdresse : { pathname: pfadAdresse, state: zustand }

  render(
    <AuthKontextProvider value={authWert()}>
      <MemoryRouter initialEntries={[eintrag]}>
        <Routes>
          <Route path="/erbe/fragebaum" element={<Fragebaum />} />
          <Route path="/erbe/fragebaum/:knotenId" element={<Fragebaum />} />
          <Route path="/erbe" element={<p>Erbe-Seite</p>} />
          <Route path="/aufgabe/:id" element={<p>Aufgabendetail</p>} />
        </Routes>
      </MemoryRouter>
    </AuthKontextProvider>,
  )

  return <></>
}

/** Wie `zeige`, gibt aber ein erneutes Rendern in die Hand. */
function zeigeMitRerender(pfadAdresse: string, zustand: { pfad: string[] }) {
  // Bei jedem Aufruf ein neues Element: Mit demselben Objekt lässt React das
  // erneute Rendern der Kinder aus, und der Test prüfte nichts.
  const baum = () => (
    <AuthKontextProvider value={authWert()}>
      <MemoryRouter initialEntries={[{ pathname: pfadAdresse, state: zustand }]}>
        <Routes>
          <Route path="/erbe/fragebaum" element={<Fragebaum />} />
          <Route path="/erbe/fragebaum/:knotenId" element={<Fragebaum />} />
          <Route path="/erbe" element={<p>Erbe-Seite</p>} />
          <Route path="/aufgabe/:id" element={<p>Aufgabendetail</p>} />
        </Routes>
      </MemoryRouter>
    </AuthKontextProvider>
  )

  const ergebnis = render(baum())

  return { rerender: () => ergebnis.rerender(baum()) }
}

const ERBE_PFAD = ['n0', 'n1', 'n2', 'n3', 'n4', 'n6']
const AUSSCHLAGUNG_PFAD = ['n0', 'n1', 'n2', 'n3', 'n4', 'n7']
const ANFECHTUNG_PFAD = ['n0', 'n50', 'n51']

beforeEach(() => {
  vi.clearAllMocks()
  useCase.mockReturnValue(falldaten())
  mockFragebaum.mockReturnValue(null)
  mockGeladen.mockReturnValue(true)
  mockVorhandene.mockReturnValue(null)
  mockNeueIdentitaet.mockReturnValue(true)
  mockModus.mockReturnValue('erweitert')
  speichereFragebaum.mockResolvedValue(undefined)
  legeFragebaumAufgabeAn.mockResolvedValue(undefined)
  setzeKenntnisAm.mockResolvedValue(undefined)
  setzeAnfechtungKenntnisAm.mockResolvedValue(undefined)
})

describe('Einstieg und Navigation (§3)', () => {
  it('beginnt bei der ersten Frage', () => {
    zeige('/erbe/fragebaum')

    expect(screen.getByRole('heading', { name: 'Sind Sie Erbe?' })).toBeInTheDocument()
  })

  it('führt eine Antwort zur nächsten Frage', async () => {
    const nutzer = userEvent.setup()
    zeige('/erbe/fragebaum')

    await nutzer.click(screen.getByRole('button', { name: 'Ja' }))

    expect(
      screen.getByRole('heading', { name: 'Haben Sie ein Testament gefunden?' }),
    ).toBeInTheDocument()
  })

  it('zeigt auf der ersten Frage kein "Zurück"', () => {
    zeige('/erbe/fragebaum')

    expect(screen.queryByRole('button', { name: 'Zurück' })).not.toBeInTheDocument()
  })

  it('zeigt schon auf der ersten Frage ein "Zurück"', () => {
    // Der Screen liegt nicht im `Rahmen`: Ohne diesen Knopf käme man von der
    // ersten Frage nur mit dem Browser wieder heraus.
    zeige('/erbe/fragebaum')

    expect(screen.getByRole('link', { name: 'Zurück' })).toHaveAttribute('href', '/erbe')
  })

  it('führt "Zurück" zur vorigen Frage', async () => {
    const nutzer = userEvent.setup()
    zeige('/erbe/fragebaum')

    await nutzer.click(screen.getByRole('button', { name: 'Ja' }))
    await nutzer.click(screen.getByRole('link', { name: 'Zurück' }))

    expect(screen.getByRole('heading', { name: 'Sind Sie Erbe?' })).toBeInTheDocument()
  })

  it('beginnt von vorn, wenn der Pfad fehlt', () => {
    // Ein Neuladen, ein geteilter Link, ein Lesezeichen: Ohne Pfad gibt es
    // keinen Durchlauf, zu dem die Seite gehört (§3).
    zeige('/erbe/fragebaum/n4')

    expect(screen.getByRole('heading', { name: 'Sind Sie Erbe?' })).toBeInTheDocument()
  })

  it('beginnt von vorn, wenn der Pfad woanders endet', () => {
    zeige('/erbe/fragebaum/n4', { pfad: ['n0', 'n1'] })

    expect(screen.getByRole('heading', { name: 'Sind Sie Erbe?' })).toBeInTheDocument()
  })

  it('schreibt bei der gesetzlichen Erbfolge das s ohne Leerzeichen direkt an den Namen des Verstorbenen', async () => {
    const nutzer = userEvent.setup()
    zeige('/erbe/fragebaum')

    // n0: Sind Sie Erbe? -> "Ich weiß es nicht" (n57)
    await nutzer.click(screen.getByRole('button', { name: 'Ich weiß es nicht' }))
    // n57: Gibt es ein Testament? -> "Nein" (n65)
    await nutzer.click(screen.getByRole('button', { name: 'Nein' }))

    expect(
      screen.getByRole('heading', { name: 'Ich bin Hans Webers …' }),
    ).toBeInTheDocument()
  })

  it('beginnt von vorn bei einem Knoten, den es nicht gibt', () => {
    zeige('/erbe/fragebaum/gibt-es-nicht', { pfad: ['gibt-es-nicht'] })

    expect(screen.getByRole('heading', { name: 'Sind Sie Erbe?' })).toBeInTheDocument()
  })
})

describe('Ergebnis speichern (§6)', () => {
  it('schreibt den ersten Durchlauf von selbst', () => {
    zeige('/erbe/fragebaum/n6', { pfad: ERBE_PFAD })

    expect(speichereFragebaum).toHaveBeenCalledWith(ERBE_PFAD)
  })

  it('schreibt nichts, solange Bestand und K_p noch nicht da sind', () => {
    /*
     * Der Fehler, den dieser Test festhält: Beim Aufbau der Seite ist die
     * Geräteanmeldung noch nicht durch, `K_p` fehlt, und jedes private Item ist
     * unlesbar. Wer da schon schreibt, schreibt entweder ins Leere oder über
     * ein vorhandenes Ergebnis (§6).
     */
    mockGeladen.mockReturnValue(false)

    zeige('/erbe/fragebaum/n6', { pfad: ERBE_PFAD })

    expect(speichereFragebaum).not.toHaveBeenCalled()
  })

  it('hält ein vorhandenes Ergebnis nicht für keines, nur weil es noch lädt', async () => {
    // Dasselbe von der anderen Seite: Sobald geladen ist, steht dort ein
    // Ergebnis, und dann wird nichts geschrieben.
    mockGeladen.mockReturnValue(false)
    mockFragebaum.mockReturnValue({
      knotenId: 'n53',
      pfad: ['n0', 'n50', 'n53'],
      status: 'kein-erbe',
      am: '2026-08-01T10:00:00.000Z',
    })

    const { rerender } = zeigeMitRerender('/erbe/fragebaum/n6', { pfad: ERBE_PFAD })

    expect(speichereFragebaum).not.toHaveBeenCalled()

    mockGeladen.mockReturnValue(true)
    rerender()

    await waitFor(() =>
      expect(screen.getByText(/Ihr gespeichertes Ergebnis bleibt/)).toBeInTheDocument(),
    )

    expect(speichereFragebaum).not.toHaveBeenCalled()
  })

  it('schreibt, sobald Bestand und K_p da sind', async () => {
    mockGeladen.mockReturnValue(false)

    const { rerender } = zeigeMitRerender('/erbe/fragebaum/n6', { pfad: ERBE_PFAD })

    expect(speichereFragebaum).not.toHaveBeenCalled()

    mockGeladen.mockReturnValue(true)
    rerender()

    await waitFor(() => expect(speichereFragebaum).toHaveBeenCalledWith(ERBE_PFAD))
  })

  it('schreibt genau einmal, auch wenn währenddessen neu gerendert wird', async () => {
    /*
     * Das Schreiben stösst über die Queue ein neues Rendern an, und damit
     * wechselt `speichereFragebaum` seine Identität. Ohne Riegel vor dem
     * `await` liefe der Effekt erneut, und es entstünden zwei
     * Konfigurations-Items derselben Person.
     */
    let loese: () => void = () => undefined
    speichereFragebaum.mockReturnValue(
      new Promise<void>((fertig) => {
        loese = fertig
      }),
    )

    const { rerender } = zeigeMitRerender('/erbe/fragebaum/n6', { pfad: ERBE_PFAD })

    rerender()
    rerender()

    expect(speichereFragebaum).toHaveBeenCalledTimes(1)

    loese()
    await waitFor(() => expect(speichereFragebaum).toHaveBeenCalledTimes(1))
  })

  it('wiederholt ein fehlgeschlagenes Speichern von selbst', async () => {
    /*
     * Der Fehler, den dieser Test festhält: Ein Fehlschlag lässt die
     * Konfiguration unberührt, also wechselt `speichereFragebaum` gerade
     * *nicht* seine Identität, und der Effekt lief nie wieder. Wer dann
     * „Zurück zur Übersicht" klickte, hatte seinen Durchlauf verloren, ohne
     * dass irgendwo etwas stand (§6).
     */
    mockNeueIdentitaet.mockReturnValue(false)
    speichereFragebaum.mockRejectedValueOnce(new Error('Ohne angemeldetes Gerät geht das nicht.'))

    zeige('/erbe/fragebaum/n6', { pfad: ERBE_PFAD })

    await waitFor(() => expect(speichereFragebaum).toHaveBeenCalledTimes(2))
    expect(speichereFragebaum).toHaveBeenLastCalledWith(ERBE_PFAD)

    // Und nach dem geglückten Versuch steht die Meldung des ersten nicht mehr da.
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
  })

  it('sagt es, wenn das Ergebnis nicht abgelegt werden konnte', async () => {
    // Still verworfen wird nichts: Was auch nach den Wiederholungen nicht
    // liegt, gehört auf die Seite (§6).
    mockNeueIdentitaet.mockReturnValue(false)
    speichereFragebaum.mockRejectedValue(new Error('Ohne angemeldetes Gerät geht das nicht.'))

    zeige('/erbe/fragebaum/n6', { pfad: ERBE_PFAD })

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Ohne angemeldetes Gerät geht das nicht.',
    )
  })

  it('schreibt einen zweiten Durchlauf nicht', () => {
    mockFragebaum.mockReturnValue({
      knotenId: 'n53',
      pfad: ['n0', 'n50', 'n53'],
      status: 'kein-erbe',
      am: '2026-08-01T10:00:00.000Z',
    })

    zeige('/erbe/fragebaum/n6', { pfad: ERBE_PFAD })

    expect(speichereFragebaum).not.toHaveBeenCalled()
  })

  it('sagt beim zweiten Durchlauf, was gespeichert bleibt', () => {
    mockFragebaum.mockReturnValue({
      knotenId: 'n53',
      pfad: ['n0', 'n50', 'n53'],
      status: 'kein-erbe',
      am: '2026-08-01T10:00:00.000Z',
    })

    zeige('/erbe/fragebaum/n6', { pfad: ERBE_PFAD })

    expect(screen.getByText(/Ihr gespeichertes Ergebnis bleibt/)).toHaveTextContent('Kein Erbe')
  })

  it('ersetzt das Ergebnis nur auf ausdrücklichen Wunsch', async () => {
    const nutzer = userEvent.setup()
    mockFragebaum.mockReturnValue({
      knotenId: 'n53',
      pfad: ['n0', 'n50', 'n53'],
      status: 'kein-erbe',
      am: '2026-08-01T10:00:00.000Z',
    })

    zeige('/erbe/fragebaum/n6', { pfad: ERBE_PFAD })
    await nutzer.click(screen.getByRole('button', { name: 'Gespeichertes Ergebnis ersetzen' }))

    expect(speichereFragebaum).toHaveBeenCalledWith(ERBE_PFAD, true)
  })

  it('meldet keinen Widerspruch, wenn derselbe Weg zum selben Ergebnis führt', () => {
    // Ein "Ihr gespeichertes Ergebnis bleibt: Erbe" auf der Seite "Sie sind
    // Erbe" wäre eine Warnung vor einem Widerspruch, den es nicht gibt (§6).
    mockFragebaum.mockReturnValue({
      knotenId: 'n6',
      pfad: ERBE_PFAD,
      status: 'erbe',
      am: '2026-08-01T10:00:00.000Z',
    })

    zeige('/erbe/fragebaum/n6', { pfad: ERBE_PFAD })

    expect(screen.queryByText(/Ihr gespeichertes Ergebnis bleibt/)).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Gespeichertes Ergebnis ersetzen' }),
    ).not.toBeInTheDocument()
    // Und geschrieben wird trotzdem nichts: Es steht ja schon da.
    expect(speichereFragebaum).not.toHaveBeenCalled()
  })

  it('bietet beim ersten Durchlauf kein Ersetzen an', () => {
    zeige('/erbe/fragebaum/n6', { pfad: ERBE_PFAD })

    expect(
      screen.queryByRole('button', { name: 'Gespeichertes Ergebnis ersetzen' }),
    ).not.toBeInTheDocument()
  })

  it('zeigt den Erbstatus am Ergebnis', () => {
    zeige('/erbe/fragebaum/n6', { pfad: ERBE_PFAD })

    expect(screen.getByText('Erbe')).toBeInTheDocument()
  })
})

describe('Aufgaben aus dem Baum (§7)', () => {
  it('legt die Aufgabe an', async () => {
    const nutzer = userEvent.setup()
    zeige('/erbe/fragebaum/n7', { pfad: AUSSCHLAGUNG_PFAD })

    await nutzer.click(screen.getByRole('button', { name: 'Aufgabe erstellen' }))

    /*
     * Der dritte Wert ist der gelesene Ergebnistext (§7): "Genau diese
     * Informationen müssen in die Aufgabe mit rein."
     */
    expect(legeFragebaumAufgabeAn).toHaveBeenCalledWith(
      'ausschlagung',
      '',
      expect.stringContaining('Sie wollen das Erbe nicht (Ausschlagung)'),
    )
  })

  it('nimmt Postleitzahl und ermittelte Stelle in die Aufgabe mit (§8)', async () => {
    const nutzer = userEvent.setup()
    zeige('/erbe/fragebaum/n7', { pfad: AUSSCHLAGUNG_PFAD })

    await nutzer.click(screen.getByRole('button', { name: /Zuständige Stelle ermitteln/ }))
    await nutzer.type(screen.getByLabelText(/Postleitzahl/), '74199')
    await nutzer.click(screen.getByRole('button', { name: 'Gericht suchen' }))
    await nutzer.click(screen.getByRole('button', { name: 'Aufgabe erstellen' }))

    expect(legeFragebaumAufgabeAn).toHaveBeenCalledWith(
      'ausschlagung',
      expect.stringContaining('Amtsgericht Heilbronn'),
      expect.stringContaining('Sie wollen das Erbe nicht (Ausschlagung)'),
    )
  })

  it('zeigt die Kontaktdaten des ermittelten Gerichts an (§8)', async () => {
    const nutzer = userEvent.setup()
    zeige('/erbe/fragebaum/n7', { pfad: AUSSCHLAGUNG_PFAD })

    await nutzer.click(screen.getByRole('button', { name: /Zuständige Stelle ermitteln/ }))
    await nutzer.type(screen.getByLabelText(/Postleitzahl/), '74199')
    await nutzer.click(screen.getByRole('button', { name: 'Gericht suchen' }))

    expect(screen.getByRole('heading', { name: 'Amtsgericht Heilbronn' })).toBeInTheDocument()
    expect(screen.getByText(/Knorrstr\. 1, 74074 Heilbronn/)).toBeInTheDocument()
  })

  it('trägt das Kenntnisdatum ein, wenn eines angegeben wurde (§8)', async () => {
    const nutzer = userEvent.setup()
    zeige('/erbe/fragebaum/n7', { pfad: AUSSCHLAGUNG_PFAD })

    await nutzer.type(screen.getByLabelText(/Fristbeginn|informiert/), '2026-05-12')
    await nutzer.click(screen.getByRole('button', { name: 'Aufgabe erstellen' }))

    expect(setzeKenntnisAm).toHaveBeenCalledWith('2026-05-12')
  })

  it('trägt das Anfechtungs-Kenntnisdatum in ein eigenes Feld ein (§8, D)', async () => {
    // Ausdrücklich nicht `setzeKenntnisAm`: Die Anfechtungsfrist hängt an
    // einem anderen Tag als die Ausschlagungsfrist nach § 1944 BGB.
    const nutzer = userEvent.setup()
    zeige('/erbe/fragebaum/n51', { pfad: ANFECHTUNG_PFAD })

    await nutzer.type(screen.getByLabelText(/erfahren/), '2026-05-12')
    await nutzer.click(screen.getByRole('button', { name: 'Aufgabe erstellen' }))

    expect(setzeAnfechtungKenntnisAm).toHaveBeenCalledWith('2026-05-12')
    expect(setzeKenntnisAm).not.toHaveBeenCalled()
  })

  it('sagt an der Anfechtungsfrage, dass die Frist jetzt automatisch berechnet wird (D)', () => {
    zeige('/erbe/fragebaum/n51', { pfad: ANFECHTUNG_PFAD })

    expect(screen.getByText(/wird automatisch berechnet/)).toBeInTheDocument()
    expect(screen.queryByText(/wird nicht ausgerechnet/)).not.toBeInTheDocument()
  })

  it('legt keine zweite an, sondern öffnet die vorhandene', () => {
    mockVorhandene.mockReturnValue({ id: 'item-7' } as Aufgabe)

    zeige('/erbe/fragebaum/n7', { pfad: AUSSCHLAGUNG_PFAD })

    expect(screen.queryByRole('button', { name: 'Aufgabe erstellen' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Aufgabe öffnen' })).toBeInTheDocument()
  })

  it('bietet auf einem Ergebnis ohne Aufgabe keinen Knopf an', () => {
    zeige('/erbe/fragebaum/n6', { pfad: ERBE_PFAD })

    expect(screen.queryByRole('button', { name: 'Aufgabe erstellen' })).not.toBeInTheDocument()
  })

  it('bietet auf der Frageseite n2 (Testament gefunden) Aufgabe erstellen und Gerichtssuche an', async () => {
    const nutzer = userEvent.setup()
    const TESTAMENT_FRAGE_PFAD = ['n0', 'n1', 'n2']
    zeige('/erbe/fragebaum/n2', { pfad: TESTAMENT_FRAGE_PFAD })

    expect(
      screen.getByRole('heading', { name: 'Was mache ich, wenn ich ein Testament gefunden habe?' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Aufgabe erstellen' })).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Weiter zu Fragen über das Erbe' }),
    ).toBeInTheDocument()

    // Gerichtssuche ausklappen und PLZ suchen
    await nutzer.click(screen.getByRole('button', { name: /Zuständige Stelle ermitteln/ }))
    await nutzer.type(screen.getByLabelText(/Postleitzahl/), '74199')
    await nutzer.click(screen.getByRole('button', { name: 'Gericht suchen' }))

    expect(screen.getByRole('heading', { name: 'Amtsgericht Heilbronn' })).toBeInTheDocument()

    // Aufgabe erstellen
    await nutzer.click(screen.getByRole('button', { name: 'Aufgabe erstellen' }))

    expect(legeFragebaumAufgabeAn).toHaveBeenCalledWith(
      'testament',
      expect.stringContaining('Amtsgericht Heilbronn'),
      expect.stringContaining('Was mache ich, wenn ich ein Testament gefunden habe?'),
    )
  })

  it('zeigt auf der Frageseite n2 Aufgabe öffnen, wenn die Aufgabe bereits angelegt wurde', () => {
    mockVorhandene.mockReturnValue({ id: 'item-testament-1' } as Aufgabe)
    const TESTAMENT_FRAGE_PFAD = ['n0', 'n1', 'n2']
    zeige('/erbe/fragebaum/n2', { pfad: TESTAMENT_FRAGE_PFAD })

    expect(screen.queryByRole('button', { name: 'Aufgabe erstellen' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Aufgabe öffnen' })).toBeInTheDocument()
    expect(
      screen.getByText(/Sie haben diese Aufgabe bereits angelegt/),
    ).toBeInTheDocument()
  })
})

describe('Infoknoten (§5)', () => {
  it('klappt die Erläuterung an Ort und Stelle auf', async () => {
    const nutzer = userEvent.setup()
    zeige('/erbe/fragebaum/n59', { pfad: ['n0', 'n50', 'n57', 'n58', 'n59'] })

    const knopf = screen.getByRole('button', { name: /Was ist ein Erbschein/ })

    expect(knopf).toHaveAttribute('aria-expanded', 'false')

    await nutzer.click(knopf)

    expect(knopf).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText(/ergänzt/)).toBeInTheDocument()
  })

  it('zeigt auf Frage n1 kein Was ist das Nachlassgericht', () => {
    zeige('/erbe/fragebaum/n1', { pfad: ['n0', 'n1'] })

    expect(screen.queryByRole('button', { name: /Was ist das Nachlassgericht/ })).not.toBeInTheDocument()
  })

  it('bietet an "Wollen Sie das Erbe haben?" den Pflichtteil-Infoknopf an (B)', async () => {
    const nutzer = userEvent.setup()
    zeige('/erbe/fragebaum/n4', { pfad: ['n0', 'n1', 'n2', 'n3', 'n4'] })

    const knopf = screen.getByRole('button', { name: /Was ist der Pflichtteil/ })

    expect(knopf).toHaveAttribute('aria-expanded', 'false')

    await nutzer.click(knopf)

    expect(
      screen.getByText('Der Pflichtteil ist ein Mindest-Betrag an Geld aus dem Erbe.'),
    ).toBeInTheDocument()
  })

  it('zeigt den Infotext und den Pflichtteil-Infoknopf vor der Frageüberschrift an', () => {
    zeige('/erbe/fragebaum/n4', { pfad: ['n0', 'n1', 'n2', 'n3', 'n4'] })

    const hinweis = screen.getByText(/Zum Erbe können auch Schulden/)
    const knopf = screen.getByRole('button', { name: /Was ist der Pflichtteil/ })
    const ueberschrift = screen.getByRole('heading', { name: 'Wollen Sie das Erbe haben?' })

    expect(hinweis.compareDocumentPosition(ueberschrift)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    )
    expect(knopf.compareDocumentPosition(ueberschrift)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    )
    expect(hinweis.compareDocumentPosition(knopf)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    )
  })
})

describe('Hinweis bei Ausschlagung (C)', () => {
  it('zeigt den Hinweis zur Annahme durch Verkauf, Verschenken oder Nutzung über dem Ergebnistext', () => {
    zeige('/erbe/fragebaum/n7', { pfad: AUSSCHLAGUNG_PFAD })

    expect(
      screen.getByText(/nimmt das Erbe automatisch an/),
    ).toBeInTheDocument()
  })

  it('zeigt den Hinweis nicht auf einem Ergebnis ohne diesen Fall', () => {
    zeige('/erbe/fragebaum/n6', { pfad: ERBE_PFAD })

    expect(screen.queryByText(/nimmt das Erbe automatisch an/)).not.toBeInTheDocument()
  })

  it('formatiert die Ausschlagungs-Schritte und hebt die Abschnitte grün hervor', () => {
    zeige('/erbe/fragebaum/n7', { pfad: AUSSCHLAGUNG_PFAD })

    expect(screen.getByText('Normalfall (gesetzliche Erbfolge):')).toHaveClass(/gruen/)
    expect(screen.getByText('Testament oder Erbvertrag:')).toHaveClass(/gruen/)
    expect(screen.getByText('1. Über ein Notariat:')).toHaveClass(/gruen/)
    expect(screen.getByText('2. Persönlich beim Gericht:')).toHaveClass(/gruen/)
    expect(screen.getByText('1. Frist').tagName).toBe('STRONG')
    expect(screen.getByText('2. Wie können Sie das Erbe ablehnen?').tagName).toBe('STRONG')
    expect(screen.getByText('Notar oder Nachlassgericht:').tagName).toBe('STRONG')

    const hinweisLabel = screen.getByText('Hinweis:')
    expect(hinweisLabel.tagName).toBe('STRONG')
    expect(hinweisLabel).toHaveClass(/rot/)
  })
})

describe('Rechtlicher Hinweis bei Verwandtschaftsfragen', () => {
  it('zeigt den rechtlichen Hinweis als modales Overlay vor der Frage "Ich bin {person}s …" und schließt ihn bei Klick auf Verstanden', async () => {
    const nutzer = userEvent.setup()
    zeige('/erbe/fragebaum/n65', { pfad: ['n0', 'n57', 'n65'] })

    const dialog = screen.getByRole('dialog')
    expect(dialog).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Rechtlicher Hinweis' })).toBeInTheDocument()
    expect(
      screen.getByText(
        'Die Ergebnisse der folgenden Fragen dienen ausschließlich der allgemeinen Information und Orientierung. Sie stellen keine Rechtsberatung dar und ersetzen nicht die individuelle Prüfung durch einen Anwalt oder Notar.',
      ),
    ).toBeInTheDocument()

    const verstandenKnopf = screen.getByRole('button', { name: 'Verstanden' })
    await nutzer.click(verstandenKnopf)

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Kind' })).toBeInTheDocument()
  })
})

describe('Einfache Ansicht (§4)', () => {
  it('kürzt einen langen Ergebnistext, ohne ihn umzuformulieren', async () => {
    const nutzer = userEvent.setup()
    mockModus.mockReturnValue('einfach')

    zeige('/erbe/fragebaum/n7', { pfad: AUSSCHLAGUNG_PFAD })

    expect(screen.queryByText(/Über ein Notariat/)).not.toBeInTheDocument()

    await nutzer.click(screen.getByRole('button', { name: 'Mehr anzeigen' }))

    expect(screen.getByText(/Über ein Notariat/)).toBeInTheDocument()
  })

  it('zeigt in der erweiterten Ansicht alles sofort', () => {
    zeige('/erbe/fragebaum/n7', { pfad: AUSSCHLAGUNG_PFAD })

    expect(screen.queryByRole('button', { name: 'Mehr anzeigen' })).not.toBeInTheDocument()
    expect(screen.getByText(/Über ein Notariat/)).toBeInTheDocument()
  })
})

describe('Abbrechen-Button und Bestätigungs-Popup', () => {
  it('zeigt auf einer Frageseite einen Abbrechen-Button', () => {
    zeige('/erbe/fragebaum')

    expect(screen.getByRole('button', { name: 'Abbrechen' })).toBeInTheDocument()
  })

  it('zeigt auf einer Ergebnisseite einen Abbrechen-Button', () => {
    zeige('/erbe/fragebaum/n6', { pfad: ERBE_PFAD })

    expect(screen.getByRole('button', { name: 'Abbrechen' })).toBeInTheDocument()
  })

  it('öffnet bei Klick auf "Abbrechen" das Bestätigungs-Popup', async () => {
    const nutzer = userEvent.setup()
    zeige('/erbe/fragebaum')

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    await nutzer.click(screen.getByRole('button', { name: 'Abbrechen' }))

    const dialog = screen.getByRole('dialog')
    expect(dialog).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: 'Fragebaum abbrechen?' }),
    ).toBeInTheDocument()
    expect(
      screen.getByText(/Möchten Sie die Befragung wirklich abbrechen/),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Ja, abbrechen' })).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Nein, weiter ausfüllen' }),
    ).toBeInTheDocument()
  })

  it('schließt das Popup bei Klick auf "Nein, weiter ausfüllen" und bleibt auf der aktuellen Seite', async () => {
    const nutzer = userEvent.setup()
    zeige('/erbe/fragebaum')

    await nutzer.click(screen.getByRole('button', { name: 'Abbrechen' }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()

    await nutzer.click(screen.getByRole('button', { name: 'Nein, weiter ausfüllen' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Sind Sie Erbe?' })).toBeInTheDocument()
  })

  it('navigiert bei Klick auf "Ja, abbrechen" zur Erbe-Seite', async () => {
    const nutzer = userEvent.setup()
    zeige('/erbe/fragebaum')

    await nutzer.click(screen.getByRole('button', { name: 'Abbrechen' }))
    await nutzer.click(screen.getByRole('button', { name: 'Ja, abbrechen' }))

    expect(screen.getByText('Erbe-Seite')).toBeInTheDocument()
  })

  it('schließt das Popup beim Drücken der Escape-Taste', async () => {
    const nutzer = userEvent.setup()
    zeige('/erbe/fragebaum')

    await nutzer.click(screen.getByRole('button', { name: 'Abbrechen' }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()

    await nutzer.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})

