import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Card } from '../../src/ui/Card/Card.tsx'

describe('Card', () => {
  it('rendert die Kinder in einer section', () => {
    render(
      <Card>
        <h2>Geräte</h2>
      </Card>,
    )

    expect(screen.getByRole('heading', { name: 'Geräte' })).toBeVisible()
  })

  it('behaelt die uebergebene Klasse neben der eigenen', () => {
    const { container } = render(<Card className="eigene">Inhalt</Card>)

    const abschnitt = container.querySelector('section')
    expect(abschnitt?.className).toContain('eigene')
    expect(abschnitt?.className.split(' ').length).toBeGreaterThan(1)
  })

  it('stellt die Aktion neben den Titel', () => {
    /*
     * Rechts neben dem Titel und nicht unter dem Inhalt: Eine Aktion, die eine
     * Liste ergaenzt, muss am Anfang der Liste zu finden sein. Auf einem
     * Telefon steht "hinter der Liste" unter dem unteren Bildschirmrand,
     * sobald sie laenger als drei Zeilen ist.
     */
    render(
      <Card titel="Unteraufgaben" neben={<button type="button">Hinzufügen</button>}>
        Inhalt
      </Card>,
    )

    const titel = screen.getByRole('heading', { name: 'Unteraufgaben' })
    const aktion = screen.getByRole('button', { name: 'Hinzufügen' })

    expect(titel.parentElement).toBe(aktion.parentElement)
  })

  it('reicht weitere Attribute durch', () => {
    render(<Card aria-label="Meine Karte">Inhalt</Card>)

    expect(screen.getByLabelText('Meine Karte')).toBeVisible()
  })
})
