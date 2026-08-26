import { render, screen, fireEvent } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
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

  it('ist direkt ausgeklappt und findet ein Gericht per PLZ', () => {
    const aufGerichtGefunden = vi.fn()
    render(<GerichtNachschlagen aufGerichtGefunden={aufGerichtGefunden} />)

    const eingabe = screen.getByPlaceholderText(/PLZ z\. B\./i)
    expect(eingabe).toBeVisible()

    fireEvent.change(eingabe, { target: { value: '74199' } })

    expect(screen.getByRole('heading', { name: 'Amtsgericht Heilbronn' })).toBeVisible()
    expect(aufGerichtGefunden).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Amtsgericht Heilbronn' }),
      '74199',
    )
  })

  it('initialisiert PLZ und Gerichtskarte aus vorhandenen Notizen', () => {
    const notiz = [
      'Zuständiges Nachlassgericht (PLZ 80331):',
      'Amtsgericht München',
      'Lieferanschrift: Pacellistraße 5, 80333 München',
    ].join('\n')

    render(<GerichtNachschlagen initialNotiz={notiz} />)

    const eingabe = screen.getByPlaceholderText(/PLZ z\. B\./i)
    expect(eingabe).toHaveValue('80331')
    expect(screen.getByRole('heading', { name: 'Amtsgericht München' })).toBeVisible()
  })

  it('zeigt einen Hinweis bei mehrdeutiger PLZ und persistiert nicht', () => {
    const aufGerichtGefunden = vi.fn()
    render(<GerichtNachschlagen aufGerichtGefunden={aufGerichtGefunden} />)

    const eingabe = screen.getByPlaceholderText(/PLZ z\. B\./i)
    fireEvent.change(eingabe, { target: { value: '02923' } })

    expect(screen.getByText(/unterschiedliche Zuständigkeiten/i)).toBeVisible()
    expect(aufGerichtGefunden).not.toHaveBeenCalled()
  })

  it('zeigt einen Hinweis bei Großempfänger/Nicht-Wohngebiet-PLZ und persistiert nicht', () => {
    const aufGerichtGefunden = vi.fn()
    render(<GerichtNachschlagen aufGerichtGefunden={aufGerichtGefunden} />)

    const eingabe = screen.getByPlaceholderText(/PLZ z\. B\./i)
    fireEvent.change(eingabe, { target: { value: '01053' } })

    expect(screen.getByText(/Postfach oder Großempfänger/i)).toBeVisible()
    expect(aufGerichtGefunden).not.toHaveBeenCalled()
  })

  it('zeigt einen Hinweis bei ungültiger PLZ und persistiert nicht', () => {
    const aufGerichtGefunden = vi.fn()
    render(<GerichtNachschlagen aufGerichtGefunden={aufGerichtGefunden} />)

    const eingabe = screen.getByPlaceholderText(/PLZ z\. B\./i)
    fireEvent.change(eingabe, { target: { value: '123' } })
    fireEvent.click(screen.getByRole('button', { name: 'Suchen' }))

    expect(screen.getByText(/gültige 5-stellige Postleitzahl/i)).toBeVisible()
    expect(aufGerichtGefunden).not.toHaveBeenCalled()
  })

  it('deaktiviert Eingabe und Suche bei gesperrt', () => {
    render(<GerichtNachschlagen gesperrt />)

    expect(screen.getByPlaceholderText(/PLZ z\. B\./i)).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Suchen' })).toBeDisabled()
  })
})

