import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Falldaten } from '../../src/hooks/useCase.ts'
import { authWert, rendereMitProvidern } from './harness.tsx'

const useCase = vi.fn<() => Falldaten>()

vi.mock('../../src/hooks/useCase.ts', () => ({ useCase: () => useCase() }))

// Die Geräteliste hat ihren eigenen Test; hier steht sie nur im Weg.
vi.mock('../../src/screens/shared/Profil/Geraeteliste.tsx', () => ({
  Geraeteliste: () => <p>Geräteliste</p>,
}))

const { Profil } = await import('../../src/screens/shared/Profil/Profil.tsx')

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

  it('laesst den Abschnitt zur Person weg, solange niemand angemeldet ist', () => {
    rendereMitProvidern(<Profil />, { auth: authWert({ status: 'laedt' }) })

    expect(screen.queryByRole('heading', { name: 'Sie' })).toBeNull()
  })

  it('zeigt "Fuer wen?", sobald ein Fall lesbar ist', () => {
    useCase.mockReturnValue(falldaten({ status: 'bereit', faelle: [LESBAR], aktiver: LESBAR }))

    rendereMitProvidern(<Profil />)

    expect(screen.getByRole('heading', { name: 'Für wen?' })).toBeVisible()
    expect(screen.getByText('Hans Weber')).toBeVisible()
  })

  it('zeigt "Fuer wen?" nicht bei einem gesperrten Fall', () => {
    // Aus einem gesperrten Fall laesst sich der Name nicht lesen (§3.6).
    const gesperrt = { zustand: 'gesperrt' as const, id: 'fall-1', grund: 'Kein Schlüssel.' }
    useCase.mockReturnValue(falldaten({ status: 'bereit', faelle: [gesperrt], aktiver: gesperrt }))

    rendereMitProvidern(<Profil />)

    expect(screen.queryByRole('heading', { name: 'Für wen?' })).toBeNull()
  })

  it('zeigt die Geraete und den Weg zurueck', () => {
    rendereMitProvidern(<Profil />)

    expect(screen.getByRole('heading', { name: 'Geräte' })).toBeVisible()
    expect(screen.getByText('Geräteliste')).toBeVisible()
    expect(screen.getByRole('link', { name: 'Zurück' })).toHaveAttribute('href', '/')
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

  it('fuehrt immer zur Freischaltung dieses Geraets', () => {
    // Der Weg steht auch dann da, wenn gerade nichts gesperrt ist: Ein zweites
    // Geraet holt sich hier seinen Code, bevor es ueberhaupt einen Fall sieht.
    rendereMitProvidern(<Profil />)

    expect(
      screen.getByRole('link', { name: 'Dieses Gerät freischalten lassen' }),
    ).toHaveAttribute('href', '/geraet-freischalten')
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

    expect(screen.getByRole('heading', { name: 'Fall verlassen' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Fall verlassen' })).toBeVisible()
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

    expect(screen.getByText(/Möchten Sie den Fall für „Hans Weber“ wirklich verlassen\?/)).toBeVisible()
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

  it('zeigt Hinweis für den Preparer eines versiegelten Vorsorgefalls', () => {
    const versiegelterVorsorgeFall: LesbarerFall = {
      ...LESBAR,
      id: 'fall-vorsorge',
      status: 'vorsorge',
      preparerId: 'user_1',
      vaultCommitment: new Uint8Array([1, 2, 3]),
    }

    useCase.mockReturnValue(
      falldaten({
        status: 'bereit',
        faelle: [versiegelterVorsorgeFall],
        aktiver: versiegelterVorsorgeFall,
      }),
    )

    rendereMitProvidern(<Profil />, {
      auth: authWert({
        status: 'angemeldet',
        benutzer: { id: 'user_1', anzeigename: 'Anna Müller', email: 'anna@example.de' },
      }),
    })

    expect(
      screen.getByText(/Als Ersteller dieses versiegelten Vorsorgefalls können Sie die Mitgliedschaft nicht verlassen/),
    ).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Fall verlassen' })).toBeNull()
  })
})

