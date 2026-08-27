import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { SprachagentBlase } from '../../src/ui/SprachagentBlase/SprachagentBlase.tsx'

describe('SprachagentBlase Component (3D Metallic Orb & Circle Buttons)', () => {
  it('rendert das Vollbild-Overlay mit dem 3D Metallic Orb und Mute/Stop-Knöpfen', () => {
    render(
      <SprachagentBlase
        status="listening"
        isMuted={false}
        lautstaerke={0.5}
        onPauseToggle={vi.fn()}
        onStop={vi.fn()}
      />,
    )

    expect(screen.getByRole('dialog', { name: 'Fragebaum Sprachassistent' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sprachdialog beenden' })).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Mikrofon stummschalten' })).toHaveLength(2) // Orb + Mute-Knopf
  })

  it('zeigt KEINEN sichtbaren Text (weder Transkript noch Status-Texte noch Chatboxen)', () => {
    const { container } = render(
      <SprachagentBlase
        status="speaking"
        isMuted={false}
        lautstaerke={0.8}
        onPauseToggle={vi.fn()}
        onStop={vi.fn()}
      />,
    )

    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(screen.queryByText(/Hört zu/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/Berater/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/Transkript/i)).not.toBeInTheDocument()
    expect(container.textContent?.trim()).toBe('')
  })

  it('toggelt Stummschaltung bei Klick auf den Mute-Knopf', async () => {
    const user = userEvent.setup()
    const onPauseToggle = vi.fn()

    const { rerender } = render(
      <SprachagentBlase
        status="listening"
        isMuted={false}
        onPauseToggle={onPauseToggle}
        onStop={vi.fn()}
      />,
    )

    const stummKnopf = screen.getAllByRole('button', { name: 'Mikrofon stummschalten' })[1]!
    await user.click(stummKnopf)
    expect(onPauseToggle).toHaveBeenCalledTimes(1)

    // Neu rendern mit Status 'paused'
    rerender(
      <SprachagentBlase
        status="paused"
        isMuted={true}
        onPauseToggle={onPauseToggle}
        onStop={vi.fn()}
      />,
    )

    expect(screen.getAllByRole('button', { name: 'Mikrofon einschalten' })).toHaveLength(2)
  })

  it('ruft onStop auf bei Klick auf den runden Beenden-Knopf', async () => {
    const user = userEvent.setup()
    const onStop = vi.fn()

    render(
      <SprachagentBlase
        status="listening"
        isMuted={false}
        onPauseToggle={vi.fn()}
        onStop={onStop}
      />,
    )

    const beendenKnopf = screen.getByRole('button', { name: 'Sprachdialog beenden' })
    await user.click(beendenKnopf)
    expect(onStop).toHaveBeenCalledTimes(1)
  })

  it('beendet den Dialog beim Drücken der Escape-Taste', async () => {
    const user = userEvent.setup()
    const onStop = vi.fn()

    render(
      <SprachagentBlase
        status="listening"
        isMuted={false}
        onPauseToggle={vi.fn()}
        onStop={onStop}
      />,
    )

    await user.keyboard('{Escape}')
    expect(onStop).toHaveBeenCalledTimes(1)
  })
})
