import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { KeinFall } from '../../src/screens/shared/KeinFall/KeinFall.tsx'
import { rendereMitProvidern } from './harness.tsx'

const navigiere = vi.fn()

vi.mock('react-router-dom', async () => {
  const echt = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return { ...echt, useNavigate: () => navigiere }
})

/**
 * Die Fallweiche aus DESIGN.md §7: Ohne Fall ist die App gesperrt, ein Screen,
 * drei Schaltflächen.
 */
describe('KeinFall', () => {
  it('nennt die drei Wege', () => {
    rendereMitProvidern(<KeinFall />)

    expect(screen.getByRole('heading', { name: 'Willkommen' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Ein Todesfall ist eingetreten' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Ich möchte für später vorsorgen' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Ich wurde eingeladen' })).toBeEnabled()
  })

  it('führt zur Fallanlage für Todesfall', async () => {
    navigiere.mockClear()
    rendereMitProvidern(<KeinFall />)

    await userEvent.click(screen.getByRole('button', { name: 'Ein Todesfall ist eingetreten' }))

    expect(navigiere).toHaveBeenCalledWith('/todesfall')
  })

  it('führt zur Vorsorgeanlage', async () => {
    navigiere.mockClear()
    rendereMitProvidern(<KeinFall />)

    await userEvent.click(screen.getByRole('button', { name: 'Ich möchte für später vorsorgen' }))

    expect(navigiere).toHaveBeenCalledWith('/vorsorge')
  })

  it('führt zum Kopplungscode, wer eingeladen wurde', async () => {
    navigiere.mockClear()
    rendereMitProvidern(<KeinFall />)

    await userEvent.click(screen.getByRole('button', { name: 'Ich wurde eingeladen' }))

    expect(navigiere).toHaveBeenCalledWith('/beitreten')
  })

  it('verlinkt Profil und Geräte', () => {
    rendereMitProvidern(<KeinFall />)

    expect(screen.getByRole('link', { name: 'Profil und Geräte' })).toHaveAttribute(
      'href',
      '/profil',
    )
  })
})
