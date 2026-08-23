import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { Button } from '../../src/ui/Button/Button.tsx'

describe('Button', () => {
  it('ist standardmaessig type="button"', () => {
    // Ohne das waere jede Schaltflaeche in einem Formular ein Absenden-Knopf,
    // auch die zum Abbrechen.
    render(<Button>Weiter</Button>)

    expect(screen.getByRole('button', { name: 'Weiter' })).toHaveAttribute('type', 'button')
  })

  it('laesst sich auf submit stellen', () => {
    render(<Button type="submit">Fall anlegen</Button>)

    expect(screen.getByRole('button', { name: 'Fall anlegen' })).toHaveAttribute('type', 'submit')
  })

  it('haengt den Vorlesetext an den zugaenglichen Namen (§7)', () => {
    render(<Button vorleseText="Gerät iPhone umbenennen">Umbenennen</Button>)

    /*
     * Als Muster, nicht als feste Zeichenkette: Ob zwischen sichtbarem Label
     * und Vorlesetext ein Leerzeichen steht, entscheidet die Darstellung. Ein
     * echter Browser setzt eines zwischen die beiden Boxen, jsdom laedt die
     * CSS-Module nicht und haengt die Textknoten direkt aneinander. Geprueft
     * wird, worauf es ankommt: Beides steht im Namen, in dieser Reihenfolge.
     */
    expect(screen.getByRole('button', { name: /Umbenennen\s*Gerät iPhone umbenennen/ })).toBeVisible()
  })

  it('meldet Klicks', async () => {
    const beiKlick = vi.fn()
    render(<Button onClick={beiKlick}>Weiter</Button>)

    await userEvent.click(screen.getByRole('button', { name: 'Weiter' }))

    expect(beiKlick).toHaveBeenCalledOnce()
  })

  it('meldet keine Klicks, solange sie deaktiviert ist', async () => {
    const beiKlick = vi.fn()
    render(
      <Button onClick={beiKlick} disabled>
        Weiter
      </Button>,
    )

    await userEvent.click(screen.getByRole('button', { name: 'Weiter' }))

    expect(beiKlick).not.toHaveBeenCalled()
  })

  it('traegt die Varianten- und Breitenklassen und behaelt die eigene', () => {
    const { container } = render(
      <Button variante="sekundaer" volleBreite className="eigene">
        Abbrechen
      </Button>,
    )

    const knopf = container.querySelector('button')
    expect(knopf?.className).toContain('eigene')
    // CSS-Module werden im Test nicht aufgeloest; geprueft wird, dass ueberhaupt
    // mehrere Klassen zusammenkommen statt einer, die die anderen verschluckt.
    expect(knopf?.className.split(' ').length).toBeGreaterThan(1)
  })
})
