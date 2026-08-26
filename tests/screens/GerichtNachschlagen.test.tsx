import { render, screen, fireEvent } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import {
  GerichtNachschlagen,
  istGerichtStelle,
} from '../../src/screens/shared/Gericht/GerichtNachschlagen.tsx'

describe('GerichtNachschlagen', () => {
  it('erkennt Gericht-Behördenbezeichnungen', () => {
    expect(istGerichtStelle('Nachlassgericht (Amtsgericht)')).toBe(true)
    expect(istGerichtStelle('Amtsgericht')).toBe(true)
    expect(istGerichtStelle('Nachlassgericht')).toBe(true)
    expect(istGerichtStelle('Standesamt')).toBe(false)
    expect(istGerichtStelle('Finanzamt')).toBe(false)
  })

  it('öffnet die Suche und findet ein Gericht per PLZ', () => {
    render(<GerichtNachschlagen />)

    const oeffnenKnopf = screen.getByRole('button', { name: 'Zuständiges Gericht ermitteln (PLZ)' })
    fireEvent.click(oeffnenKnopf)

    const eingabe = screen.getByPlaceholderText(/PLZ z\. B\./i)
    fireEvent.change(eingabe, { target: { value: '74199' } })

    expect(screen.getByRole('heading', { name: 'Amtsgericht Heilbronn' })).toBeVisible()
  })

  it('zeigt einen Hinweis bei mehrdeutiger PLZ', () => {
    render(<GerichtNachschlagen />)

    fireEvent.click(screen.getByRole('button', { name: 'Zuständiges Gericht ermitteln (PLZ)' }))

    const eingabe = screen.getByPlaceholderText(/PLZ z\. B\./i)
    fireEvent.change(eingabe, { target: { value: '02923' } })

    expect(screen.getByText(/unterschiedliche Zuständigkeiten/i)).toBeVisible()
  })

  it('schließt die Suche wieder', () => {
    render(<GerichtNachschlagen />)

    fireEvent.click(screen.getByRole('button', { name: 'Zuständiges Gericht ermitteln (PLZ)' }))
    expect(screen.getByPlaceholderText(/PLZ z\. B\./i)).toBeVisible()

    fireEvent.click(screen.getByRole('button', { name: 'Schließen' }))
    expect(screen.queryByPlaceholderText(/PLZ z\. B\./i)).toBeNull()
  })
})
