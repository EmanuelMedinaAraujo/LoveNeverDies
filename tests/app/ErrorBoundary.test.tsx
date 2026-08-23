import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ErrorBoundary } from '../../src/app/ErrorBoundary.tsx'

function Wirft(): never {
  throw new Error('Kaputt in einer Komponente')
}

describe('ErrorBoundary', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('laesst heile Kinder in Ruhe', () => {
    render(
      <ErrorBoundary>
        <p>Alles gut</p>
      </ErrorBoundary>,
    )

    expect(screen.getByText('Alles gut')).toBeVisible()
  })

  it('zeigt statt eines weissen Bildschirms eine Meldung ohne Technik', () => {
    // React schreibt den Fehler selbst in die Konsole; das gehoert zum
    // erwarteten Ablauf und soll den Testlauf nicht rot faerben.
    vi.spyOn(console, 'error').mockImplementation(() => {})

    render(
      <ErrorBoundary>
        <Wirft />
      </ErrorBoundary>,
    )

    expect(screen.getByRole('heading', { name: 'Da ist etwas schiefgegangen' })).toBeVisible()
    expect(screen.getByText(/Ihre Daten sind davon nicht betroffen/)).toBeVisible()

    /*
     * Die Meldung steht vor jemandem, der gerade einen Angehoerigen verloren
     * hat. Die technische Ursache gehoert in die Konsole, nicht auf den Schirm.
     */
    expect(screen.queryByText(/Kaputt in einer Komponente/)).toBeNull()
  })

  it('schreibt den Fehler in die Konsole', () => {
    const konsole = vi.spyOn(console, 'error').mockImplementation(() => {})

    render(
      <ErrorBoundary>
        <Wirft />
      </ErrorBoundary>,
    )

    expect(
      konsole.mock.calls.some(
        (argumente) =>
          typeof argumente[0] === 'string' && argumente[0].includes('Unbehandelter Fehler'),
      ),
    ).toBe(true)
  })
})
