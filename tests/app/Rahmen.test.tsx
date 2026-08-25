import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Falldaten } from '../../src/hooks/useCase.ts'
import type { LesbarerFall } from '../../src/services/fallService.ts'

/**
 * Der Rahmen setzt die untere Leiste unter einen Hauptscreen (DESIGN.md §7).
 *
 * Was die Leiste darstellt, prüft `tests/ui/Leiste.test.tsx`. Hier steht die
 * eine Frage, die diese Schicht beantwortet: Was liest sie aus dem Fallzustand
 * heraus — der Freigabe-Hinweis aus §3.6 und die Sperre aus §7.
 */

const useCase = vi.fn<() => Falldaten>()
vi.mock('../../src/hooks/useCase.ts', () => ({ useCase: () => useCase() }))

const { Rahmen } = await import('../../src/app/Rahmen.tsx')

const LESBAR = { zustand: 'lesbar', id: 'fall-1' } as unknown as LesbarerFall
const GESPERRT = { zustand: 'gesperrt' as const, id: 'fall-2', grund: 'Kein Schlüssel.' }

function falldaten(zustand: Falldaten['zustand']): Falldaten {
  return {
    zustand,
    legeTrauerfallAn: vi.fn(),
    legeVorsorgefallAn: vi.fn(),
    loescheVorsorgefall: vi.fn(),
    verlasseFall: vi.fn(),
    aktualisiere: vi.fn(),
  } as unknown as Falldaten
}

function rendere() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <Rahmen>
        <p>Screeninhalt</p>
      </Rahmen>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  useCase.mockReturnValue(
    falldaten({ status: 'bereit', faelle: [LESBAR], aktiver: LESBAR }),
  )
})

describe('Rahmen', () => {
  it('stellt den Screen über die Leiste', () => {
    rendere()

    expect(screen.getByText('Screeninhalt')).toBeVisible()
    expect(screen.getByRole('navigation', { name: 'Hauptbereiche' })).toBeVisible()
  })

  it('setzt den Freigabe-Hinweis an den Profil-Tab, sobald ein Fall gesperrt ist (§3.6)', () => {
    /*
     * Ablesbar ist das nur lokal: Die Wraps fremder Geräte sieht dieses Gerät
     * nicht (§4). Der aktive Fall darf dabei lesbar sein — der Hinweis hängt an
     * der Liste, nicht daran, welchen Fall man gerade ansieht.
     */
    useCase.mockReturnValue(
      falldaten({ status: 'bereit', faelle: [LESBAR, GESPERRT], aktiver: LESBAR }),
    )

    rendere()

    expect(screen.getByRole('link', { name: 'Profil, Freigabe nötig' })).toBeVisible()
  })

  it('lässt den Hinweis weg, solange jeder Fall lesbar ist', () => {
    rendere()

    expect(screen.queryByText(/Freigabe nötig/)).toBeNull()
  })

  it('stellt Erbe und Alle still, solange es keinen Fall gibt (§7)', () => {
    useCase.mockReturnValue(falldaten({ status: 'kein-fall' }))

    rendere()

    expect(screen.getByText('Erbe').closest('[role="link"]')).toHaveAttribute(
      'aria-disabled',
      'true',
    )
    expect(screen.getByText('Alle').closest('[role="link"]')).toHaveAttribute(
      'aria-disabled',
      'true',
    )
  })
})
