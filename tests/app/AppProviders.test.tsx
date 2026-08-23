import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

/**
 * Die Provider-Schicht (DESIGN.md §9).
 *
 * Die Reihenfolge ist keine Geschmacksfrage, deshalb steht sie hier fest:
 * Die ErrorBoundary liegt aussen, sonst finge sie einen Fehler aus den
 * Providern selbst nicht mehr. Supabase liegt innerhalb von Clerk, weil sein
 * Client das Token von dort holt (§4).
 */

vi.mock('../../src/core/auth/clerkAdapter.tsx', () => ({
  ClerkAuthProvider: ({ children }: { children: ReactNode }) => (
    <div data-testid="clerk">{children}</div>
  ),
}))
vi.mock('../../src/core/db/supabaseProvider.tsx', () => ({
  SupabaseProvider: ({ children }: { children: ReactNode }) => (
    <div data-testid="supabase">{children}</div>
  ),
}))

const { AppProviders } = await import('../../src/app/AppProviders.tsx')

describe('AppProviders', () => {
  it('rendert die Kinder', () => {
    render(
      <AppProviders>
        <p>Inhalt</p>
      </AppProviders>,
    )

    expect(screen.getByText('Inhalt')).toBeVisible()
  })

  it('legt Supabase innerhalb von Clerk ab', () => {
    render(
      <AppProviders>
        <p>Inhalt</p>
      </AppProviders>,
    )

    expect(screen.getByTestId('clerk')).toContainElement(screen.getByTestId('supabase'))
  })

  it('faengt einen Fehler aus dem Inneren ab', () => {
    const stille = vi.spyOn(console, 'error').mockImplementation(() => {})

    function Wirft(): never {
      throw new Error('Kaputt')
    }

    try {
      render(
        <AppProviders>
          <Wirft />
        </AppProviders>,
      )

      expect(screen.getByRole('heading', { name: 'Da ist etwas schiefgegangen' })).toBeVisible()
    } finally {
      stille.mockRestore()
    }
  })
})
