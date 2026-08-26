import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { FallZustand } from '../../src/hooks/useCase.ts'
import type { Todesfalldaten } from '../../src/hooks/useTodesfall.ts'
import type { Tresordaten } from '../../src/hooks/useTresor.ts'
import { Erbe } from '../../src/screens/shared/Erbe/Erbe.tsx'
import type { Fragebaumergebnis } from '../../src/services/aufgabenService.ts'
import type { LesbarerFall } from '../../src/services/fallService.ts'
import { rendereMitProvidern } from './harness.tsx'

const navigiere = vi.fn()
const mockLoescheVorsorgefall = vi.fn()
const mockLegeItemAn = vi.fn()
const mockAendereItem = vi.fn()
const mockSpeichereAntwort = vi.fn()
const mockLoescheItem = vi.fn()
const mockVerteileShares = vi.fn()
const mockBestaetigeTodesfall = vi.fn()
const mockOeffneTresor = vi.fn()

let mockFallZustand: FallZustand
let mockTresor: Tresordaten
let mockTodesfall: Todesfalldaten
let mockAufgabenZustand: { status: 'laedt' } | { status: 'bereit' }

/** Das eigene Fragebaum-Ergebnis, privat unter `K_p` (ERBE_DESIGN.md §6). */
const mockFragebaum = vi.fn<() => Fragebaumergebnis | null>(() => null)
/** Ob Bestand, `K_p` und Anmeldung durch sind (ERBE_DESIGN.md §6). */
const mockGeladen = vi.fn<() => boolean>(() => true)
/** Die Erbschein-Aufgabe, wenn sie schon angelegt ist (ERBE_DESIGN.md §10). */
const mockErbscheinaufgabe = vi.fn<() => { id: string } | null>(() => null)
const mockLegeFragebaumAufgabeAn = vi.fn<(vorlage: string) => Promise<void>>()

vi.mock('react-router-dom', async () => {
  const echt = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return {
    ...echt,
    useNavigate: () => navigiere,
  }
})

vi.mock('../../src/hooks/useCase.ts', () => ({
  useCase: () => ({
    zustand: mockFallZustand,
    loescheVorsorgefall: mockLoescheVorsorgefall,
    legeVorsorgefallAn: vi.fn(),
    legeTrauerfallAn: vi.fn(),
    verlasseFall: vi.fn(),
    aktualisiere: vi.fn(),
  }),
}))

vi.mock('../../src/hooks/useAufgaben.ts', () => ({
  useAufgaben: () => ({
    zustand:
      mockAufgabenZustand.status === 'laedt'
        ? { status: 'laedt' }
        : { status: 'bereit', laedtNetz: false, netzfehler: null, aufgaben: [], baum: [], uebersprungen: 0 },
    fragebaum: mockFragebaum(),
    fragebaumGeladen: mockGeladen(),
    zeilen: [],
    mutiere: vi.fn(),
    bestaetige: vi.fn(),
    aktualisiere: vi.fn(),
    setzeZuweisung: vi.fn(),
    schliesseAufgabe: vi.fn(),
    oeffneAufgabe: vi.fn(),
    legeAufgabeAn: vi.fn(),
    aendereAufgabe: vi.fn(),
    loescheAufgabe: vi.fn(),
    fragebaumAufgabe: () => mockErbscheinaufgabe(),
    legeFragebaumAufgabeAn: mockLegeFragebaumAufgabeAn,
  }),
}))

vi.mock('../../src/hooks/useTresor.ts', () => ({
  useTresor: () => mockTresor,
}))

vi.mock('../../src/hooks/useTodesfall.ts', () => ({
  useTodesfall: () => mockTodesfall,
}))

function standardFall(ueberschreibung: Partial<LesbarerFall> = {}): LesbarerFall {
  return {
    zustand: 'lesbar',
    id: 'fall-1',
    status: 'vorsorge',
    personName: 'Anna Müller',
    sterbedatum: null,
    kid: 'case_fall-1:1',
    keyGeneration: 1,
    rotationPending: false,
    kc: new Uint8Array(32),
    kcat: new Uint8Array(32),
    kv: new Uint8Array(32),
    preparerId: 'user_1',
    vaultCommitment: new Uint8Array(32),
    vaultResplitPending: false,
    vaultK: null,
    vaultN: 0,
    katalogVersion: null,
    ...ueberschreibung,
  }
}

describe('Erbe Screen (§3.5, §7)', () => {
  beforeEach(() => {
    navigiere.mockClear()
    mockLoescheVorsorgefall.mockClear()
    mockLegeItemAn.mockClear()
    mockAendereItem.mockClear()
    mockSpeichereAntwort.mockReset()
    mockSpeichereAntwort.mockResolvedValue(undefined)
    mockLoescheItem.mockClear()

    mockVerteileShares.mockReset()
    mockBestaetigeTodesfall.mockReset()
    mockOeffneTresor.mockReset()

    /*
     * Der Vorsorgefall aus der Sicht der Angehörigen: kein `K_v`, und damit
     * nichts zu lesen und nichts zu schreiben (§3.5). Die vorsorgende Person
     * kommt auf diesem Screen gar nicht mehr an — sie hat ihren eigenen Tab,
     * und der Screen schickt sie dorthin.
     */
    const fall = standardFall({ kv: null, preparerId: 'user_2' })
    mockFallZustand = { status: 'bereit', faelle: [fall], aktiver: fall }
    mockAufgabenZustand = { status: 'bereit' }
    mockFragebaum.mockReturnValue(null)
    mockGeladen.mockReturnValue(true)
    mockErbscheinaufgabe.mockReturnValue(null)
    mockLegeFragebaumAufgabeAn.mockReset()
    mockLegeFragebaumAufgabeAn.mockResolvedValue(undefined)
    mockTresor = {
      items: [],
      schwelle: { n: 0, k: null },
      istPreparer: false,
      resplitPending: false,
      legeItemAn: mockLegeItemAn,
      aendereItem: mockAendereItem,
      speichereAntwort: mockSpeichereAntwort,
      loescheItem: mockLoescheItem,
      verteileShares: mockVerteileShares,
      resplitLaeuft: false,
      resplitFehler: null,
    }
    mockTodesfall = {
      freigaben: [],
      k: null,
      kannFreigeben: false,
      eigeneFreigabe: false,
      schwelleErreicht: false,
      laedt: false,
      laeuft: false,
      fehler: null,
      unbrauchbare: [],
      bestaetigeTodesfall: mockBestaetigeTodesfall,
      oeffneTresor: mockOeffneTresor,
      aktualisiere: vi.fn(),
    }
  })

  it('schickt die vorsorgende Person in ihren Nachlass-Bereich', () => {
    /*
     * §3.5: Wer selbst vorsorgt, hat einen eigenen Tab. Auf „Erbe" stünde für
     * sie die Todesbestätigung für den eigenen Tod — und sonst nichts, was sie
     * tun könnte.
     */
    const preparer = standardFall()
    mockFallZustand = { status: 'bereit', faelle: [preparer], aktiver: preparer }
    mockTresor.istPreparer = true

    rendereMitProvidern(<Erbe />, { pfad: '/erbe' })

    expect(screen.queryByRole('heading', { name: 'Erbe & Tresor' })).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Todesfall bestätigen' })).toBeNull()
  })

  it('zeigt Angehörigen eines Vorsorgefalls den geschützten Tresor ohne Schreibzugriff', () => {
    // Ohne `K_v` gibt es nichts zu beantworten und nichts zu lesen (§3.5).
    rendereMitProvidern(<Erbe />)

    expect(screen.getByRole('heading', { name: 'Geschützter Tresor' })).toBeVisible()
    expect(
      screen.getByText(/Dies ist der Vorsorgefall von Anna Müller. Der Tresor ist versiegelt/),
    ).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Eintrag hinzufügen' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Vorsorge löschen' })).toBeNull()
  })

  it('zeigt den Freigabestand des Falls', () => {
    mockTodesfall.k = 2
    mockTodesfall.freigaben = [
      {
        userId: 'user_2',
        name: 'Bernd Weber',
        freigegebenAm: '2026-08-24T09:00:00Z',
        eigene: false,
      },
    ]

    rendereMitProvidern(<Erbe />)

    expect(screen.getByRole('heading', { name: 'Todesfall bestätigen' })).toBeVisible()
    expect(screen.getByText('1 von 2 Freigaben')).toBeVisible()
    expect(screen.getByText('Bernd Weber')).toBeVisible()
  })

  it('bestätigt den Todesfall erst nach dem Bestätigungsdialog', async () => {
    mockTodesfall.k = 1
    mockTodesfall.kannFreigeben = true
    mockBestaetigeTodesfall.mockResolvedValue(undefined)

    rendereMitProvidern(<Erbe />)

    await userEvent.click(screen.getByRole('button', { name: 'Todesfall bestätigen' }))
    expect(mockBestaetigeTodesfall).not.toHaveBeenCalled()

    expect(
      screen.getByText(/Bestätigen Sie, dass Anna Müller verstorben ist\?/),
    ).toBeVisible()

    await userEvent.click(screen.getByRole('button', { name: 'Ja, Todesfall bestätigen' }))
    expect(mockBestaetigeTodesfall).toHaveBeenCalledTimes(1)
  })

  it('bietet die Bestätigung nicht an, wenn dieses Gerät keinen Schlüsselanteil hält', () => {
    mockTodesfall.kannFreigeben = false

    rendereMitProvidern(<Erbe />)

    expect(screen.queryByRole('button', { name: 'Todesfall bestätigen' })).toBeNull()
  })

  it('sagt es, wenn die eigene Bestätigung schon steht', () => {
    mockTodesfall.k = 1
    mockTodesfall.kannFreigeben = true
    mockTodesfall.eigeneFreigabe = true
    mockTodesfall.freigaben = [
      { userId: 'user_1', name: 'Anna Müller', freigegebenAm: '2026-08-24T09:00:00Z', eigene: true },
    ]

    rendereMitProvidern(<Erbe />)

    expect(screen.getByText('Sie haben den Todesfall bereits bestätigt.')).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Todesfall bestätigen' })).toBeNull()
  })

  it('öffnet den Tresor mit Sterbedatum, sobald die Schwelle erreicht ist', async () => {
    mockTodesfall.k = 1
    mockTodesfall.schwelleErreicht = true
    mockOeffneTresor.mockResolvedValue(undefined)

    rendereMitProvidern(<Erbe />)

    await userEvent.click(screen.getByRole('button', { name: 'Tresor öffnen' }))
    await userEvent.type(screen.getByLabelText('Sterbedatum'), '2026-05-12')
    await userEvent.click(screen.getByRole('button', { name: 'Tresor jetzt öffnen' }))

    expect(mockOeffneTresor).toHaveBeenCalledWith('2026-05-12')
  })

  it('benennt die Person, deren Schlüsselanteil scheitert, und bittet um einen zweiten Versuch', () => {
    mockTodesfall.k = 2
    mockTodesfall.schwelleErreicht = true
    mockTodesfall.fehler = 'Es liegen 1 brauchbare Freigaben vor, nötig sind 2.'
    mockTodesfall.unbrauchbare = ['Clara Weber']

    rendereMitProvidern(<Erbe />)

    expect(screen.getByRole('alert')).toHaveTextContent(
      /Der Schlüsselanteil von Clara Weber ist unbrauchbar/,
    )
    expect(screen.getByRole('alert')).toHaveTextContent(/erneut zu bestätigen/)
  })
})

describe('Erbstatus im Trauerfall (ERBE_DESIGN.md §10)', () => {
  beforeEach(() => {
    // Eigenes Setup: Das `beforeEach` des ersten Blocks gilt hier nicht, und
    // ohne dieses trüge der Vorsorgetest den Trauerfall des vorigen Tests.
    const fall = standardFall()

    mockFallZustand = { status: 'bereit', faelle: [fall], aktiver: fall }
    mockAufgabenZustand = { status: 'bereit' }
    mockFragebaum.mockReturnValue(null)
    mockGeladen.mockReturnValue(true)
    mockErbscheinaufgabe.mockReturnValue(null)
    mockLegeFragebaumAufgabeAn.mockReset()
    mockLegeFragebaumAufgabeAn.mockResolvedValue(undefined)
    navigiere.mockClear()
  })

  function trauerfall() {
    const fall = standardFall({ status: 'trauerfall', sterbedatum: '2026-03-15' })

    mockFallZustand = { status: 'bereit', faelle: [fall], aktiver: fall }
  }

  it('führt vom Nachlass-Tresor in den geöffneten Tresor (§3.5)', () => {
    /*
     * Vorher stand hier ein Satz, der auf den Tab "Alle" verwies. Was die
     * vorsorgende Person hinterlegt hat, war damit nirgends zu sehen.
     */
    trauerfall()

    rendereMitProvidern(<Erbe />)

    const karte = screen.getByRole('link', { name: /Nachlass-Tresor/ })

    expect(karte).toHaveAttribute('href', '/erbe/tresor')
  })

  it('zeigt den Nachlass-Tresor nicht, wenn der Fall nie eine Vorsorge hatte', () => {
    /*
     * `preparer_id` steht "nur bei Vorsorge" (siehe die Migration der
     * `faelle`-Tabelle). Ein Trauerfall, der direkt angelegt wurde, hat nie
     * einen Tresor gehabt, und die Karte führte dann zu einem Screen, der nur
     * "Versiegelt, 0 von 0" melden könnte.
     */
    const fall = standardFall({
      status: 'trauerfall',
      sterbedatum: '2026-03-15',
      preparerId: null,
      vaultCommitment: null,
      kv: null,
    })
    mockFallZustand = { status: 'bereit', faelle: [fall], aktiver: fall }

    rendereMitProvidern(<Erbe />)

    expect(screen.queryByRole('link', { name: /Nachlass-Tresor/ })).toBeNull()
  })

  it('lädt in den Fragebaum ein, solange kein Ergebnis vorliegt', () => {
    trauerfall()

    rendereMitProvidern(<Erbe />)

    expect(screen.getByRole('button', { name: 'Fragebaum starten' })).toBeInTheDocument()
  })

  it('lädt nicht in den Fragebaum ein, solange K_p noch unterwegs ist', () => {
    /*
     * Der Fehler, den dieser Test festhält: `fragebaum` ist `null`, solange
     * `K_p` fehlt — auch dann, wenn ein Ergebnis gespeichert ist, denn das Item
     * ist bis dahin unlesbar (§3.7). Ein „Fragebaum starten" an dieser Stelle
     * ist eine Einladung, den eigenen Rechtsstand noch einmal zu ermitteln,
     * obwohl er feststeht.
     */
    trauerfall()
    mockGeladen.mockReturnValue(false)

    rendereMitProvidern(<Erbe />)

    expect(screen.queryByRole('button', { name: 'Fragebaum starten' })).not.toBeInTheDocument()
    expect(screen.getByText('Ihr Ergebnis wird geladen...')).toBeInTheDocument()
  })

  it('zeigt das gespeicherte Ergebnis mit seinem Status', () => {
    trauerfall()
    mockFragebaum.mockReturnValue({
      knotenId: 'n6',
      pfad: ['n0', 'n1', 'n2', 'n3', 'n4', 'n6'],
      status: 'erbe',
      am: '2026-08-25T10:00:00.000Z',
    })

    rendereMitProvidern(<Erbe />)

    expect(screen.getByText('Erbe')).toBeInTheDocument()
    expect(screen.getByText('Sie sind Erbe.')).toBeInTheDocument()
    expect(screen.getByText(/Nur für Sie sichtbar/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Fragebaum starten' })).not.toBeInTheDocument()
  })

  it('bietet den erneuten Durchlauf ganz unten an', () => {
    trauerfall()

    rendereMitProvidern(<Erbe />)

    expect(
      screen.getByRole('button', { name: 'Fragebaum erneut durchlaufen' }),
    ).toBeInTheDocument()
  })

  it('zeigt im Vorsorgefall keinen Erbstatus', () => {
    // §2: Ein Vorsorgefall hat keine Erben, und der Fragebaum erscheint dort
    // gar nicht (ERBE_DESIGN.md §1).
    rendereMitProvidern(<Erbe />)

    expect(screen.queryByText('Ihr Erbstatus')).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Fragebaum erneut durchlaufen' }),
    ).not.toBeInTheDocument()
  })
})

describe('Die Wege hinter dem Status "Erbe" (ERBE_DESIGN.md §10)', () => {
  beforeEach(() => {
    const fall = standardFall({ status: 'trauerfall', sterbedatum: '2026-03-15' })

    mockFallZustand = { status: 'bereit', faelle: [fall], aktiver: fall }
    mockAufgabenZustand = { status: 'bereit' }
    mockGeladen.mockReturnValue(true)
    mockErbscheinaufgabe.mockReturnValue(null)
    mockLegeFragebaumAufgabeAn.mockReset()
    mockLegeFragebaumAufgabeAn.mockResolvedValue(undefined)
    navigiere.mockClear()

    mockFragebaum.mockReturnValue({
      knotenId: 'n6',
      pfad: ['n0', 'n1', 'n2', 'n3', 'n4', 'n6'],
      status: 'erbe',
      am: '2026-08-25T10:00:00.000Z',
    })
  })

  /** Tippt durch die genannten Knöpfe. */
  async function tippe(...knoepfe: string[]) {
    const nutzer = userEvent.setup()

    rendereMitProvidern(<Erbe />)

    for (const knopf of knoepfe) {
      await nutzer.click(screen.getByRole('button', { name: knopf }))
    }

    return nutzer
  }

  it('zeigt den Status "Erbe" als Badge ohne Schaltfläche/Aufklapp-Icon', () => {
    rendereMitProvidern(<Erbe />)

    expect(screen.getByText('Erbe')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Erbe' })).not.toBeInTheDocument()
  })

  it('lässt jeden anderen Status eine Anzeige bleiben', () => {
    // Wer noch nicht weiß, ob er erbt, soll keinen Erbschein beantragen; wer
    // ausschlägt, erst recht nicht.
    mockFragebaum.mockReturnValue({
      knotenId: 'n5',
      pfad: ['n0', 'n5'],
      status: 'wahrscheinlich-erbe',
      am: '2026-08-25T10:00:00.000Z',
    })

    rendereMitProvidern(<Erbe />)

    expect(screen.getByText('Wahrscheinlich Erbe')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Wahrscheinlich Erbe/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Erbschein' })).not.toBeInTheDocument()
  })

  it('zeigt die beiden Wege direkt geöffnet an', () => {
    rendereMitProvidern(<Erbe />)

    expect(screen.getByRole('button', { name: 'Erbschein' })).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Erbengemeinschaft bzw. Alleinerbe' }),
    ).toBeInTheDocument()
  })

  it('zeigt unter "Erbschein" den Erklärtext und die Frage', async () => {
    await tippe('Erbschein')

    expect(screen.getByRole('heading', { name: 'Erbschein' })).toBeInTheDocument()
    expect(
      screen.getByText('Eine amtliche Urkunde, die bestätigt, wer erbt und zu welchem Anteil.'),
    ).toBeInTheDocument()
    expect(screen.getByText('Möchten Sie einen Erbschein beantragen?')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Ja' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Nein' })).toBeInTheDocument()
  })

  it('setzt die Aufzählungen als Liste und nicht als Zeichen im Text', async () => {
    // §7: Gefüllte Punkte kommen vom Browser, nicht aus dem Text. Ein "•", das
    // im String stünde, spräche eine Vorlesestimme mit.
    await tippe('Erbschein')

    expect(screen.getByText('Handelsregister').tagName).toBe('LI')
    expect(screen.queryByText(/•/)).not.toBeInTheDocument()
  })

  it('legt auf "Ja" sofort die Aufgabe an', async () => {
    await tippe('Erbschein', 'Ja')

    expect(mockLegeFragebaumAufgabeAn).toHaveBeenCalledWith('erbschein')
  })

  it('führt auf "Nein" zurück zur Wahl, ohne etwas anzulegen', async () => {
    await tippe('Erbschein', 'Nein')

    expect(mockLegeFragebaumAufgabeAn).not.toHaveBeenCalled()
    expect(
      screen.getByRole('button', { name: 'Erbengemeinschaft bzw. Alleinerbe' }),
    ).toBeInTheDocument()
  })

  it('fragt nicht noch einmal, wenn die Aufgabe schon steht (§7)', async () => {
    mockErbscheinaufgabe.mockReturnValue({ id: 'aufgabe-1' })

    const nutzer = await tippe('Erbschein')

    expect(screen.queryByRole('button', { name: 'Ja' })).not.toBeInTheDocument()

    await nutzer.click(screen.getByRole('button', { name: 'Aufgabe öffnen' }))

    expect(navigiere).toHaveBeenCalledWith('/aufgabe/aufgabe-1')
  })

  it('fragt unter "Erbengemeinschaft bzw. Alleinerbe", was zutrifft', async () => {
    await tippe('Erbengemeinschaft bzw. Alleinerbe')

    expect(screen.getByRole('heading', { name: 'Was trifft auf Sie zu?' })).toBeInTheDocument()
    expect(screen.getByText('Das Nachlassgericht informiert Sie darüber.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Erbengemeinschaft' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Alleinerbe' })).toBeInTheDocument()
  })

  it('erklärt die Erbengemeinschaft', async () => {
    await tippe('Erbengemeinschaft bzw. Alleinerbe', 'Erbengemeinschaft')

    expect(screen.getByRole('heading', { name: 'Erbengemeinschaft' })).toBeInTheDocument()
    expect(screen.getByText(/bildet sich sofort mit dem Tod des Erblassers/)).toBeInTheDocument()
  })

  it('erklärt den Alleinerben', async () => {
    await tippe('Erbengemeinschaft bzw. Alleinerbe', 'Alleinerbe')

    expect(screen.getByRole('heading', { name: 'Alleinerbe' })).toBeInTheDocument()
    expect(screen.getByText(/als auch alle Schulden gehen auf den Erben über/)).toBeInTheDocument()
  })

  it('führt aus jeder Ebene eine Ebene zurück', async () => {
    const nutzer = await tippe('Erbengemeinschaft bzw. Alleinerbe', 'Alleinerbe')

    await nutzer.click(screen.getByRole('button', { name: /Zurück/ }))
    expect(screen.getByRole('heading', { name: 'Was trifft auf Sie zu?' })).toBeInTheDocument()

    await nutzer.click(screen.getByRole('button', { name: /Zurück/ }))
    expect(screen.getByRole('button', { name: 'Erbschein' })).toBeInTheDocument()
  })
})
