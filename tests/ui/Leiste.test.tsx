import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { Leiste } from '../../src/ui/Leiste/Leiste.tsx'

/**
 * Die untere Leiste (DESIGN.md §7).
 *
 * Sie ist eine Darstellung ohne Wissen über Fälle: Was sie zeigt, bekommt sie
 * gesagt. Deshalb steht hier kein Supabase-Ersatz und kein Fallzustand — nur
 * die vier Zusagen aus §7 und der Hinweis aus §3.6.
 */

function rendere(props: Parameters<typeof Leiste>[0] = {}, pfad = '/') {
  return render(
    <MemoryRouter initialEntries={[pfad]}>
      <Leiste {...props} />
    </MemoryRouter>,
  )
}

describe('Leiste', () => {
  it('zeigt Start · Alle · Erbe · Profil in dieser Reihenfolge (§7)', () => {
    rendere()

    const leiste = screen.getByRole('navigation', { name: 'Hauptbereiche' })
    const beschriftungen = within(leiste)
      .getAllByRole('link')
      .map((tab) => tab.textContent)


    expect(beschriftungen).toEqual(['Start', 'Alle', 'Erbe', 'Profil'])
  })

  it('führt zu den vier Hauptscreens', () => {
    rendere()

    expect(screen.getByRole('link', { name: 'Start' })).toHaveAttribute('href', '/')
    expect(screen.getByRole('link', { name: 'Erbe' })).toHaveAttribute('href', '/erbe')
    expect(screen.getByRole('link', { name: 'Alle' })).toHaveAttribute('href', '/alle')
    expect(screen.getByRole('link', { name: 'Profil' })).toHaveAttribute('href', '/profil')
  })

  it('markiert den Tab, auf dem man steht', () => {
    rendere({}, '/alle')

    expect(screen.getByRole('link', { name: 'Alle' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: 'Start' })).not.toHaveAttribute('aria-current')
  })

  it('markiert Start nur auf der Wurzel, nicht auf jedem Screen', () => {
    /*
     * Ohne `end` wäre „/" ein Präfix von „/erbe", und Start stünde überall als
     * aktiv da. Zwei markierte Tabs sind schlimmer als keiner: Sie sagen
     * jemandem, er sei woanders, als er ist.
     */
    rendere({}, '/erbe')

    expect(screen.getByRole('link', { name: 'Start' })).not.toHaveAttribute('aria-current')
    expect(screen.getByRole('link', { name: 'Erbe' })).toHaveAttribute('aria-current', 'page')
  })

  it('trägt den Freigabe-Hinweis am Profil-Tab (§3.6)', () => {
    rendere({ freigabeNoetig: true })

    expect(screen.getByRole('link', { name: 'Profil, Freigabe nötig' })).toBeVisible()
  })

  it('lässt den Freigabe-Hinweis weg, solange kein Gerät wartet', () => {
    rendere({ freigabeNoetig: false })

    expect(screen.getByRole('link', { name: 'Profil' })).toBeVisible()
    expect(screen.queryByText(/Freigabe nötig/)).toBeNull()
  })

  it('stellt Erbe und Alle still, solange es keinen Fall gibt (§7)', () => {
    /*
     * Ohne Fall ist die App gesperrt. Die beiden Tabs verschwinden trotzdem
     * nicht: Eine Leiste, die ihre Plätze wechselt, ist keine Leiste, und
     * §7 verlangt in beiden Ansichten dieselbe Struktur. Sie stehen gedämpft
     * da und sagen an, warum.
     */
    rendere({ ohneFall: true })

    for (const name of ['Erbe', 'Alle']) {
      const tab = screen.getByText(name).closest('[role="link"]')
      expect(tab).toHaveAttribute('aria-disabled', 'true')
      expect(tab).not.toHaveAttribute('href')
    }

    expect(screen.getByRole('link', { name: 'Profil' })).toHaveAttribute('href', '/profil')
    expect(screen.getByRole('link', { name: 'Start' })).toHaveAttribute('href', '/')
  })
})
