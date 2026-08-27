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

  it('zeigt im Vorsorgefall Nachlass · Alle · Profil, ohne Start (§3.5)', () => {
    /*
     * Wer für sich selbst vorsorgt, hat keine zugewiesenen Aufgaben: „Start"
     * wäre dort auf Dauer der Satz "Für Sie ist gerade nichts eingetragen".
     */
    rendere({ vorsorge: true })

    const leiste = screen.getByRole('navigation', { name: 'Hauptbereiche' })
    const beschriftungen = within(leiste)
      .getAllByRole('link')
      .map((tab) => tab.textContent)

    expect(beschriftungen).toEqual(['Nachlass', 'Alle', 'Profil'])
    expect(screen.getByRole('link', { name: 'Nachlass' })).toHaveAttribute('href', '/nachlass')
    expect(screen.queryByRole('link', { name: 'Erbe' })).toBeNull()
  })

  it('markiert den Nachlass-Tab auch auf seinen Unterseiten', () => {
    // Ohne `end`: `/nachlass/checkliste/fragen` gehört sichtbar dazu.
    rendere({ vorsorge: true }, '/nachlass/checkliste/fragen')

    expect(screen.getByRole('link', { name: 'Nachlass' })).toHaveAttribute('aria-current', 'page')
  })

  it('trägt den Freigabe-Hinweis auch im Vorsorgefall am Profil-Tab (§3.6)', () => {
    rendere({ vorsorge: true, freigabeNoetig: true })

    expect(screen.getByRole('link', { name: 'Profil, Freigabe nötig' })).toBeVisible()
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
})
