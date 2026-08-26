import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { Klapp } from '../../src/ui/Klapp/Klapp.tsx'

/**
 * Ein Aufklapp-Element: zu, bis jemand tippt.
 *
 * Dasselbe Muster wie das lokale `Klapp` im Fragebaum
 * (`tests/screens/Fragebaum.test.tsx` prüft jenes); hier steht die
 * wiederverwendbare Fassung unter `src/ui/`.
 */
describe('Klapp', () => {
  it('ist zu Anfang zu und zeigt die Kinder nicht', () => {
    render(
      <Klapp titel="3 erledigte Aufgaben anzeigen">
        <p>Versteckter Inhalt</p>
      </Klapp>,
    )

    expect(screen.getByRole('button', { name: '3 erledigte Aufgaben anzeigen' })).toBeVisible()
    expect(screen.queryByText('Versteckter Inhalt')).toBeNull()
  })

  it('zeigt die Kinder nach einem Klick und sagt sich als ausgeklappt an', async () => {
    render(
      <Klapp titel="3 erledigte Aufgaben anzeigen" offenText="Erledigte Aufgaben ausblenden">
        <p>Versteckter Inhalt</p>
      </Klapp>,
    )

    const schalter = screen.getByRole('button', { name: '3 erledigte Aufgaben anzeigen' })
    expect(schalter).toHaveAttribute('aria-expanded', 'false')

    await userEvent.click(schalter)

    expect(screen.getByText('Versteckter Inhalt')).toBeVisible()
    const offenerSchalter = screen.getByRole('button', { name: 'Erledigte Aufgaben ausblenden' })
    expect(offenerSchalter).toHaveAttribute('aria-expanded', 'true')
  })

  it('klappt wieder zu und versteckt die Kinder erneut', async () => {
    render(
      <Klapp titel="3 erledigte Aufgaben anzeigen" offenText="Erledigte Aufgaben ausblenden">
        <p>Versteckter Inhalt</p>
      </Klapp>,
    )

    await userEvent.click(screen.getByRole('button', { name: '3 erledigte Aufgaben anzeigen' }))
    await userEvent.click(screen.getByRole('button', { name: 'Erledigte Aufgaben ausblenden' }))

    expect(screen.queryByText('Versteckter Inhalt')).toBeNull()
    expect(screen.getByRole('button', { name: '3 erledigte Aufgaben anzeigen' })).toHaveAttribute(
      'aria-expanded',
      'false',
    )
  })

  it('fällt ohne eigenen Offen-Text auf den Titel zurück', async () => {
    render(
      <Klapp titel="Details">
        <p>Versteckter Inhalt</p>
      </Klapp>,
    )

    await userEvent.click(screen.getByRole('button', { name: 'Details' }))

    expect(screen.getByText('Versteckter Inhalt')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Details' })).toHaveAttribute('aria-expanded', 'true')
  })
})
