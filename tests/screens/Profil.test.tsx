import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ansichtLesen, ansichtZuruecksetzen } from '../../src/core/storage/ansicht.ts'
import type { Falldaten } from '../../src/hooks/useCase.ts'
import { authWert, rendereMitProvidern } from './harness.tsx'

const useCase = vi.fn<() => Falldaten>()

vi.mock('../../src/hooks/useCase.ts', () => ({ useCase: () => useCase() }))

// Die Geräteliste hat ihren eigenen Test; hier steht sie nur im Weg.
vi.mock('../../src/screens/shared/Profil/Geraeteliste.tsx', () => ({
  Geraeteliste: () => <p>Geräteliste</p>,
}))

/*
 * Der Erbstatus kommt aus dem privaten Konfigurations-Item und damit über
 * `useAufgaben` aus einem Sync-Stream (ERBE_DESIGN.md §6). Für diesen Test ist
 * das Beiwerk: Er prüft Profil und nicht die Synchronisation.
 */
const mockFragebaum = vi.fn<() => Fragebaumergebnis | null>(() => null)
/** Ob Bestand, `K_p` und Anmeldung durch sind (ERBE_DESIGN.md §6). */
const mockGeladen = vi.fn<() => boolean>(() => true)

vi.mock('../../src/hooks/useAufgaben.ts', () => ({
  useAufgaben: () => ({ fragebaum: mockFragebaum(), fragebaumGeladen: mockGeladen() }),
}))

const { Profil } = await import('../../src/screens/shared/Profil/Profil.tsx')

import type { Fragebaumergebnis } from '../../src/services/aufgabenService.ts'
import type { LesbarerFall } from '../../src/services/fallService.ts'

function falldaten(
  zustand: Falldaten['zustand'] = { status: 'kein-fall' },
  ueberschreibung: Partial<Falldaten> = {},
): Falldaten {
  return {
    zustand,
    legeTrauerfallAn: vi.fn(),
    legeVorsorgefallAn: vi.fn(),
    loescheVorsorgefall: vi.fn(),
    verlasseFall: vi.fn(),
    aktualisiere: vi.fn(),
    ...ueberschreibung,
  }
}

const LESBAR: LesbarerFall = {
  zustand: 'lesbar' as const,
  id: 'fall-1',
  status: 'trauerfall' as const,
  personName: 'Hans Weber',
  sterbedatum: '2024-03-15',
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

beforeEach(() => {
  useCase.mockReturnValue(falldaten())
  mockFragebaum.mockReturnValue(null)
  mockGeladen.mockReturnValue(true)
  localStorage.clear()
  ansichtZuruecksetzen()
})

/**
 * Profil (DESIGN.md §7). In diesem Stand: die eigene Person, "Für wen?" sobald
 * es einen lesbaren Fall gibt, die Geräte und die beiden Kopplungswege aus §6.
 */
describe('Profil', () => {
  it('zeigt die angemeldete Person', () => {
    rendereMitProvidern(<Profil />)

    expect(screen.getByRole('heading', { name: 'Sie' })).toBeVisible()
    expect(screen.getByText('Anna Müller')).toBeVisible()
    expect(screen.getByText('anna@example.de')).toBeVisible()
  })

  it('kommt ohne E-Mail-Adresse aus', () => {
    rendereMitProvidern(<Profil />, {
      auth: authWert({
        status: 'angemeldet',
        benutzer: { id: 'user_1', anzeigename: 'Anna Müller', email: null },
      }),
    })

    expect(screen.getByText('Anna Müller')).toBeVisible()
    expect(screen.queryByText('anna@example.de')).toBeNull()
  })

  it('fuehrt vom eigenen Namen in die Kontoeinstellungen', () => {
    /*
     * Der eigene Name war die einzige Zeile in diesem Screen, die dastand,
     * ohne irgendwohin zu führen — und ausgerechnet dort tippt jeder zuerst
     * hin, der seine E-Mail-Adresse oder sein Passwort ändern will (§7).
     */
    rendereMitProvidern(<Profil />)

    expect(screen.getByRole('link', { name: /Anna Müller/ })).toHaveAttribute('href', '/konto')
  })

  it('meldet ab, damit sich jemand anderes anmelden kann (§7)', async () => {
    const auth = authWert()

    rendereMitProvidern(<Profil />, { auth })

    await userEvent.click(screen.getByRole('button', { name: 'Abmelden' }))

    expect(auth.abmelden).toHaveBeenCalled()
  })

  it('nennt den Grund, wenn das Abmelden nicht durchgeht (§5)', async () => {
    const auth = authWert()
    auth.abmelden = vi.fn().mockRejectedValue(new Error('Keine Verbindung.'))

    rendereMitProvidern(<Profil />, { auth })

    await userEvent.click(screen.getByRole('button', { name: 'Abmelden' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Keine Verbindung.')
  })

  it('laesst den Abschnitt zur Person weg, solange niemand angemeldet ist', () => {
    rendereMitProvidern(<Profil />, { auth: authWert({ status: 'laedt' }) })

    expect(screen.queryByRole('heading', { name: 'Sie' })).toBeNull()
  })

  it('zeigt "Fuer wen?", sobald ein Fall lesbar ist', () => {
    useCase.mockReturnValue(falldaten({ status: 'bereit', faelle: [LESBAR], aktiver: LESBAR }))

    rendereMitProvidern(<Profil />)

    expect(screen.getByText('Für wen?')).toBeVisible()
    expect(screen.getByText('Hans Weber')).toBeVisible()
  })

  it('zeigt "Fuer wen?" nicht bei einem gesperrten Fall', () => {
    // Aus einem gesperrten Fall laesst sich der Name nicht lesen (§3.6).
    const gesperrt = { zustand: 'gesperrt' as const, id: 'fall-1', grund: 'Kein Schlüssel.' }
    useCase.mockReturnValue(falldaten({ status: 'bereit', faelle: [gesperrt], aktiver: gesperrt }))

    rendereMitProvidern(<Profil />)

    expect(screen.queryByText('Für wen?')).toBeNull()
  })

  it('zeigt die Geraete und traegt keinen eigenen Weg zurueck mehr (§7)', () => {
    /*
     * Der Weg zurück ist der Start-Tab in der unteren Leiste. Er steht auf
     * jedem Hauptscreen an derselben Stelle, und das ist mehr wert als ein
     * „Zurück", das je nach Screen woanders sitzt.
     */
    rendereMitProvidern(<Profil />)

    expect(screen.getByRole('heading', { name: 'Geräte' })).toBeVisible()
    expect(screen.getByText('Geräteliste')).toBeVisible()
    expect(screen.queryByRole('link', { name: 'Zurück' })).toBeNull()
  })

  it('laesst jedes Mitglied einladen, sobald ein Fall lesbar ist', () => {
    // §6: "Jedes Mitglied darf einladen. Das hier ist eine Familie, keine
    // Organisation." Es haengt am lesbaren Fall, nicht an einer Rolle.
    useCase.mockReturnValue(falldaten({ status: 'bereit', faelle: [LESBAR], aktiver: LESBAR }))

    rendereMitProvidern(<Profil />)

    expect(screen.getByRole('link', { name: 'Angehörige einladen' })).toHaveAttribute(
      'href',
      '/koppeln',
    )
    expect(screen.getByRole('link', { name: 'Ein weiteres Gerät freigeben' })).toHaveAttribute(
      'href',
      '/koppeln',
    )
  })

  it('laesst niemanden einladen, solange dieses Geraet nichts lesen kann', () => {
    // Man kann nur weitergeben, was man selbst hat (§3.6).
    const gesperrt = { zustand: 'gesperrt' as const, id: 'fall-1', grund: 'Kein Schlüssel.' }
    useCase.mockReturnValue(falldaten({ status: 'bereit', faelle: [gesperrt], aktiver: gesperrt }))

    rendereMitProvidern(<Profil />)

    expect(screen.queryByRole('link', { name: 'Angehörige einladen' })).toBeNull()
    expect(screen.getByText(/lässt sich niemand hinzufügen/)).toBeVisible()
  })

  it('fuehrt zur Freischaltung dieses Geraets, solange es nichts lesen kann', () => {
    /*
     * Der Weg steht da, solange dieses Geraet keinen Fall lesen kann: Ein
     * zweites Geraet holt sich hier seinen Code, bevor es ueberhaupt einen
     * Fall sieht.
     */
    rendereMitProvidern(<Profil />)

    expect(
      screen.getByRole('link', { name: 'Dieses Gerät freischalten lassen' }),
    ).toHaveAttribute('href', '/geraet-freischalten')
  })

  it('versteckt die Freischaltung bei einem bereits freigeschalteten Geraet', () => {
    // Wer einen Fall liest, ist freigeschaltet und bekommt neue Faelle
    // ohnehin mit; der Weg waere eine Aufforderung ohne Gegenstand.
    useCase.mockReturnValue(falldaten({ status: 'bereit', faelle: [LESBAR], aktiver: LESBAR }))

    rendereMitProvidern(<Profil />)

    expect(screen.queryByRole('link', { name: 'Dieses Gerät freischalten lassen' })).toBeNull()
    expect(screen.queryByText('Dieses Gerät freischalten lassen')).toBeNull()
  })

  it('zeigt den Freigabe-Badge an den Geraeten, sobald ein Fall gesperrt ist', () => {
    const gesperrt = { zustand: 'gesperrt' as const, id: 'fall-2', grund: 'Kein Schlüssel.' }
    useCase.mockReturnValue(
      falldaten({ status: 'bereit', faelle: [LESBAR, gesperrt], aktiver: LESBAR }),
    )

    rendereMitProvidern(<Profil />)

    expect(screen.getByText('Freigabe nötig')).toBeVisible()
  })

  it('zeigt den Bereich Fall verlassen für einen aktiven Fall', () => {
    useCase.mockReturnValue(
      falldaten({ status: 'bereit', faelle: [LESBAR], aktiver: LESBAR }),
    )

    rendereMitProvidern(<Profil />)

    expect(screen.getByRole('button', { name: 'Fall verlassen' })).toBeVisible()
    expect(
      screen.getByText(/Danach haben Sie keinen Zugriff mehr auf die Aufgaben/),
    ).toBeVisible()
  })

  it('fragt nach Bestätigung und ruft verlasseFall auf', async () => {
    const user = userEvent.setup()
    const mockVerlasseFall = vi.fn().mockResolvedValue(undefined)
    useCase.mockReturnValue(
      falldaten(
        { status: 'bereit', faelle: [LESBAR], aktiver: LESBAR },
        { verlasseFall: mockVerlasseFall },
      ),
    )

    rendereMitProvidern(<Profil />)

    await user.click(screen.getByRole('button', { name: 'Fall verlassen' }))

    expect(screen.getByText(/Den Fall für „Hans Weber“ wirklich verlassen\?/)).toBeVisible()
    expect(screen.getByRole('button', { name: 'Ja, Fall verlassen' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Abbrechen' })).toBeVisible()

    await user.click(screen.getByRole('button', { name: 'Ja, Fall verlassen' }))

    expect(mockVerlasseFall).toHaveBeenCalledWith('fall-1')
  })

  it('bricht die Bestätigung ab', async () => {
    const user = userEvent.setup()
    useCase.mockReturnValue(
      falldaten({ status: 'bereit', faelle: [LESBAR], aktiver: LESBAR }),
    )

    rendereMitProvidern(<Profil />)

    await user.click(screen.getByRole('button', { name: 'Fall verlassen' }))
    expect(screen.getByRole('button', { name: 'Ja, Fall verlassen' })).toBeVisible()

    await user.click(screen.getByRole('button', { name: 'Abbrechen' }))
    expect(screen.queryByRole('button', { name: 'Ja, Fall verlassen' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Fall verlassen' })).toBeVisible()
  })

  const VORSORGE: LesbarerFall = {
    ...LESBAR,
    id: 'fall-vorsorge',
    status: 'vorsorge',
    personName: 'Anna Müller',
    kv: new Uint8Array(32),
    preparerId: 'user_1',
    vaultCommitment: new Uint8Array([1, 2, 3]),
    katalogVersion: null,
  }

  function alsVorsorgende(loeschen = vi.fn()) {
    useCase.mockReturnValue(
      falldaten(
        { status: 'bereit', faelle: [VORSORGE], aktiver: VORSORGE },
        { loescheVorsorgefall: loeschen },
      ),
    )

    return rendereMitProvidern(<Profil />, {
      auth: authWert({
        status: 'angemeldet',
        benutzer: { id: 'user_1', anzeigename: 'Anna Müller', email: 'anna@example.de' },
      }),
    })
  }

  it('bietet der vorsorgenden Person das Löschen statt des Verlassens an', () => {
    alsVorsorgende()

    expect(
      screen.getByText(/Als vorsorgende Person können Sie diesen Fall nicht verlassen/),
    ).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Fall verlassen' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Vorsorge löschen' })).toBeVisible()
  })

  it('führt die vorsorgende Person in ihren Nachlass-Bereich', () => {
    alsVorsorgende()

    expect(screen.getByRole('link', { name: 'Nachlass' })).toHaveAttribute('href', '/nachlass')
  })

  it('löscht die Vorsorge erst nach der Rückfrage, und die nennt den Namen', async () => {
    const loeschen = vi.fn().mockResolvedValue(undefined)
    const user = userEvent.setup()
    alsVorsorgende(loeschen)

    await user.click(screen.getByRole('button', { name: 'Vorsorge löschen' }))
    expect(loeschen).not.toHaveBeenCalled()
    expect(screen.getByText(/Die Vorsorge für „Anna Müller“ samt allen/)).toBeVisible()

    await user.click(screen.getByRole('button', { name: 'Ja, Vorsorge löschen' }))
    expect(loeschen).toHaveBeenCalledWith('fall-vorsorge')
  })

  it('nimmt die Rückfrage auf Abbrechen zurück, ohne zu löschen', async () => {
    const loeschen = vi.fn()
    const user = userEvent.setup()
    alsVorsorgende(loeschen)

    await user.click(screen.getByRole('button', { name: 'Vorsorge löschen' }))
    await user.click(screen.getByRole('button', { name: 'Abbrechen' }))

    expect(loeschen).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Vorsorge löschen' })).toBeVisible()
  })
})

/**
 * Die drei Einstellungen zur Ansicht (§7).
 *
 * Sie stehen genau hier und nicht zweimal: Profil gibt es in beiden Ansichten
 * nur einmal. Dass ein Umschalten wirklich zu den anderen Screens durchdringt,
 * steht in `tests/app/App.test.tsx`; hier steht, dass dieser Screen es
 * schreibt.
 */
describe('Ansicht, Textgröße und Darstellung', () => {
  it('schaltet den Ansichtsmodus um', async () => {
    rendereMitProvidern(<Profil />)

    const feld = screen.getByLabelText('Ansicht')
    expect(feld).toHaveValue('einfach')

    await userEvent.selectOptions(feld, 'erweitert')

    expect(ansichtLesen().modus).toBe('erweitert')
  })

  it('steht bei beiden Overrides auf "Systemeinstellung folgen" (§7)', () => {
    rendereMitProvidern(<Profil />)

    expect(screen.getByLabelText('Textgröße')).toHaveValue('system')
    expect(screen.getByLabelText('Darstellung')).toHaveValue('system')
  })

  it('überschreibt Textgröße und Darstellung', async () => {
    rendereMitProvidern(<Profil />)

    await userEvent.selectOptions(screen.getByLabelText('Textgröße'), 'sehr-gross')
    await userEvent.selectOptions(screen.getByLabelText('Darstellung'), 'dunkel')

    expect(ansichtLesen()).toMatchObject({ textgroesse: 'sehr-gross', darstellung: 'dunkel' })
  })
})

const VORSORGE: LesbarerFall = { ...LESBAR, status: 'vorsorge', sterbedatum: null }

describe('Erbstatus im Profil (ERBE_DESIGN.md §6)', () => {
  beforeEach(() => {
    useCase.mockReturnValue(
      falldaten({ status: 'bereit', aktiver: LESBAR, faelle: [LESBAR] }),
    )
  })

  it('zeigt den eigenen Status, sobald der Fragebaum durchlaufen ist', () => {
    mockFragebaum.mockReturnValue({
      knotenId: 'n6',
      pfad: ['n0', 'n1', 'n2', 'n3', 'n4', 'n6'],
      status: 'erbe',
      am: '2026-08-25T10:00:00.000Z',
    })

    rendereMitProvidern(<Profil />)

    expect(screen.getByText('Erbstatus')).toBeInTheDocument()
    expect(screen.getByText('Erbe')).toBeInTheDocument()
  })

  it('zeigt keine Zeile, solange K_p noch unterwegs ist', () => {
    // `fragebaum` ist bis dahin `null`, weil das Item unlesbar ist, und nicht,
    // weil es keins gäbe (§3.7). Die Zeile kommt, wenn sie stimmt.
    mockGeladen.mockReturnValue(false)
    mockFragebaum.mockReturnValue({
      knotenId: 'n6',
      pfad: ['n0', 'n1', 'n2', 'n3', 'n4', 'n6'],
      status: 'erbe',
      am: '2026-08-25T10:00:00.000Z',
    })

    rendereMitProvidern(<Profil />)

    expect(screen.queryByText('Erbstatus')).not.toBeInTheDocument()
  })

  it('zeigt keine Zeile, solange kein Ergebnis vorliegt', () => {
    // Ein "Noch nicht ermittelt" in einer Einstellungsliste wäre eine
    // Aufforderung an einer Stelle, an der man nichts erledigen kann.
    rendereMitProvidern(<Profil />)

    expect(screen.queryByText('Erbstatus')).not.toBeInTheDocument()
  })

  it('zeigt keine Zeile bei einem Ergebnis ohne Status', () => {
    // Wer auf der Seite zur Testamentsanfechtung landet, hat etwas gelernt,
    // aber nichts über seine Erbenstellung (§6).
    mockFragebaum.mockReturnValue({
      knotenId: 'n52',
      pfad: ['n0', 'n50', 'n52'],
      status: null,
      am: '2026-08-25T10:00:00.000Z',
    })

    rendereMitProvidern(<Profil />)

    expect(screen.queryByText('Erbstatus')).not.toBeInTheDocument()
  })

  it('zeigt im Vorsorgefall keinen Erbstatus', () => {
    mockFragebaum.mockReturnValue({
      knotenId: 'n6',
      pfad: ['n0'],
      status: 'erbe',
      am: '2026-08-25T10:00:00.000Z',
    })
    useCase.mockReturnValue(
      falldaten({ status: 'bereit', aktiver: VORSORGE, faelle: [VORSORGE] }),
    )

    rendereMitProvidern(<Profil />)

    expect(screen.queryByText('Erbstatus')).not.toBeInTheDocument()
  })
})
