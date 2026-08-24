import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { FallZustand } from '../../src/hooks/useCase.ts'
import { Vorsorge } from '../../src/screens/shared/Vorsorge/Vorsorge.tsx'
import { BENUTZER, rendereMitProvidern } from './harness.tsx'

const navigiere = vi.fn()
const mockLegeVorsorgefallAn = vi.fn()

let mockZustand: FallZustand = { status: 'kein-fall' }

vi.mock('react-router-dom', async () => {
  const echt = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return {
    ...echt,
    useNavigate: () => navigiere,
  }
})

vi.mock('../../src/hooks/useCase.ts', () => ({
  useCase: () => ({
    zustand: mockZustand,
    legeVorsorgefallAn: mockLegeVorsorgefallAn,
    legeTrauerfallAn: vi.fn(),
    loescheVorsorgefall: vi.fn(),
  }),
}))

describe('Vorsorge Screen (§2, §3.5)', () => {
  beforeEach(() => {
    navigiere.mockClear()
    mockLegeVorsorgefallAn.mockClear()
    mockZustand = { status: 'kein-fall' }
  })

  it('zeigt Formular mit vorausgefülltem Namen des Nutzers', () => {
    rendereMitProvidern(<Vorsorge />)

    expect(screen.getByRole('heading', { name: 'Für später vorsorgen' })).toBeVisible()
    const eingabe = screen.getByLabelText('Ihr Name')
    expect(eingabe).toHaveValue(BENUTZER.anzeigename)
  })

  it('legt Vorsorgefall an und leitet zu /erbe weiter', async () => {
    mockLegeVorsorgefallAn.mockResolvedValue(undefined)
    rendereMitProvidern(<Vorsorge />)

    const eingabe = screen.getByLabelText('Ihr Name')
    await userEvent.clear(eingabe)
    await userEvent.type(eingabe, 'Maximilian Mustermann')

    await userEvent.click(screen.getByRole('button', { name: 'Vorsorge anlegen' }))

    expect(mockLegeVorsorgefallAn).toHaveBeenCalledWith({
      personName: 'Maximilian Mustermann',
    })
    expect(navigiere).toHaveBeenCalledWith('/erbe', { replace: true })
  })

  it('zeigt Fehlermeldung bei Fehlschlag', async () => {
    mockLegeVorsorgefallAn.mockRejectedValue(new Error('Netzwerkfehler.'))
    rendereMitProvidern(<Vorsorge />)

    await userEvent.click(screen.getByRole('button', { name: 'Vorsorge anlegen' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/Netzwerkfehler/)
  })
})
