import { screen } from '@testing-library/react'
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

function falldaten(zustand: Falldaten['zustand'] = { status: 'kein-fall' }): Falldaten {
  return { zustand, legeTrauerfallAn: vi.fn() }
}

const LESBAR = {
  zustand: 'lesbar' as const,
  id: 'fall-1',
  status: 'trauerfall' as const,
  personName: 'Hans Weber',
  sterbedatum: '2024-03-15',
  kid: 'case_fall-1:1',
  kc: new Uint8Array([1]),
  kcat: new Uint8Array([2]),
}

beforeEach(() => {
  useCase.mockReturnValue(falldaten())
})

/**
 * Profil (DESIGN.md §7). In diesem Stand: die eigene Person, „Für wen?" sobald
 * es einen lesbaren Fall gibt, und die Geräte.
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
})
