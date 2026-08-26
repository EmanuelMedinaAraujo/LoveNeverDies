import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom'
import { Zurueck } from '../../src/ui/Zurueck/Zurueck.tsx'

/**
 * Der Weg zurueck, oben links (DESIGN.md §7).
 *
 * Zwei Zusagen, und die zweite ist die, wegen der es die Komponente gibt: Ein
 * gewoehnlicher Klick geht in der Historie zurueck, damit jemand dort landet,
 * wo er hergekommen ist. Nur wenn es keine Historie gibt — geteilter Link,
 * Lesezeichen, installierte App auf dieser Adresse gestartet — nimmt er das
 * `ziel`.
 */

function Anderswo({ zurueck }: { zurueck?: string } = {}) {
  const navigate = useNavigate()

  return (
    <button
      type="button"
      onClick={() =>
        navigate('/detail', zurueck === undefined ? undefined : { state: { zurueck } })
      }
    >
      Weiter zum Detail
    </button>
  )
}

function Buehne({ start = '/detail' }: { start?: string } = {}) {
  return (
    <MemoryRouter initialEntries={[start]}>
      <Routes>
        <Route path="/liste" element={<Anderswo />} />
        <Route path="/start" element={<p>Startseite</p>} />
        <Route path="/detail" element={<Zurueck ziel="/start" />} />
      </Routes>
    </MemoryRouter>
  )
}

describe('Zurueck', () => {
  it('ist ein Link mit dem Ziel als href', () => {
    // Ein echtes `href`: in einem neuen Tab zu oeffnen, als Link vorgelesen.
    render(<Buehne />)

    expect(screen.getByRole('link', { name: 'Zurück' })).toHaveAttribute('href', '/start')
  })

  it('geht in der Historie zurueck, nicht zum Ziel', async () => {
    const nutzer = userEvent.setup()
    render(<Buehne start="/liste" />)

    await nutzer.click(screen.getByRole('button', { name: 'Weiter zum Detail' }))
    await nutzer.click(screen.getByRole('link', { name: 'Zurück' }))

    // Zurueck zur Liste, aus der man kam — und nicht auf `/start`.
    expect(screen.getByRole('button', { name: 'Weiter zum Detail' })).toBeVisible()
  })

  it('nimmt das Ziel, wenn es keine Historie gibt', async () => {
    const nutzer = userEvent.setup()
    render(<Buehne />)

    await nutzer.click(screen.getByRole('link', { name: 'Zurück' }))

    expect(screen.getByText('Startseite')).toBeVisible()
  })

  it('nimmt das erzwungene Ziel aus dem Navigationsstatus statt der Historie', async () => {
    // Der Fragebaum oeffnet so eine angelegte Aufgabe: Zurueck fuehrt zu den
    // Aufgaben, nicht auf die Frage, aus der sie entstanden ist.
    const nutzer = userEvent.setup()

    render(
      <MemoryRouter initialEntries={['/liste']}>
        <Routes>
          <Route path="/liste" element={<Anderswo zurueck="/start" />} />
          <Route path="/start" element={<p>Startseite</p>} />
          <Route path="/detail" element={<Zurueck ziel="/anderswohin" />} />
        </Routes>
      </MemoryRouter>,
    )

    await nutzer.click(screen.getByRole('button', { name: 'Weiter zum Detail' }))

    // Auch das `href` zeigt dorthin: der Link verspricht, was der Klick tut.
    expect(screen.getByRole('link', { name: 'Zurück' })).toHaveAttribute('href', '/start')

    await nutzer.click(screen.getByRole('link', { name: 'Zurück' }))

    expect(screen.getByText('Startseite')).toBeVisible()
  })

  it('traegt eine eigene Beschriftung, wo "Zurück" zu wenig sagt', () => {
    render(
      <MemoryRouter>
        <Zurueck ziel="/erbe" beschriftung="Zurück zum Tresor" />
      </MemoryRouter>,
    )

    expect(screen.getByRole('link', { name: 'Zurück zum Tresor' })).toBeVisible()
  })
})
