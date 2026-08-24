import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Badge } from '../../src/ui/Badge/Badge.tsx'

/**
 * Das Fristen-Badge (DESIGN.md §7, §12).
 *
 * Die Zusage, die hier geprüft wird, ist keine Farbe: Der Text trägt die
 * Aussage allein. Ein Badge, dessen Dringlichkeit nur in der Farbe steckt,
 * käme bei einer Vorlesestimme als Zahl ohne Warnung an.
 */

describe('Badge', () => {
  it('zeigt seinen Text', () => {
    render(<Badge>noch 3 Tage</Badge>)

    expect(screen.getByText('noch 3 Tage')).toBeVisible()
  })

  it('unterscheidet die drei Lagen sichtbar', () => {
    const { rerender } = render(<Badge lage="ruhig">Text</Badge>)
    const ruhig = screen.getByText('Text').className

    rerender(<Badge lage="knapp">Text</Badge>)
    const knapp = screen.getByText('Text').className

    rerender(<Badge lage="abgelaufen">Text</Badge>)
    const abgelaufen = screen.getByText('Text').className

    expect(new Set([ruhig, knapp, abgelaufen]).size).toBe(3)
  })

  it('setzt den Freigabe-Hinweis von den Fristen ab', () => {
    // §3.6: "Freigabe nötig" ist keine Frist. Dieselbe Form, eine andere Farbe,
    // und der Text sagt es ohnehin.
    const { rerender } = render(<Badge lage="ruhig">Text</Badge>)
    const ruhig = screen.getByText('Text').className

    rerender(<Badge lage="hinweis">Text</Badge>)

    expect(screen.getByText('Text').className).not.toBe(ruhig)
  })

  it('nimmt eine zusätzliche Klasse an, ohne die eigenen zu verlieren', () => {
    render(<Badge className="daneben">Freigabe nötig</Badge>)

    const badge = screen.getByText('Freigabe nötig')

    expect(badge).toHaveClass('daneben')
    expect(badge.className.split(' ')).toHaveLength(3)
  })
})
