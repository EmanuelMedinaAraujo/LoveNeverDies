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
    verlasseFall: vi.fn(),
    aktualisiere: vi.fn(),
  }),
}))

/*
 * §3.3: „Ihr Name" ist hier zweierlei — der Name des Falls und der Name dieser
 * Person in `profiles`. Der Screen fragt ihn einmal und schickt ihn an beide
 * Stellen.
 */
const mockSpeichereNamen = vi.fn<(name: string) => Promise<void>>()
let mockHinterlegterName = ''

vi.mock('../../src/hooks/useProfil.ts', () => ({
  useProfilAbgleich: () => ({
    zustand: { status: 'bereit' },
    name: mockHinterlegterName,
    nameFehlt: mockHinterlegterName === '',
    speichereNamen: mockSpeichereNamen,
    nochmal: vi.fn(),
  }),
}))

describe('Vorsorge Screen (§2, §3.5)', () => {
  beforeEach(() => {
    navigiere.mockClear()
    mockLegeVorsorgefallAn.mockClear()
    mockSpeichereNamen.mockReset()
    mockSpeichereNamen.mockResolvedValue(undefined)
    mockHinterlegterName = BENUTZER.anzeigename
    mockZustand = { status: 'kein-fall' }
  })

  it('zeigt Formular mit vorausgefülltem Namen des Nutzers', () => {
    rendereMitProvidern(<Vorsorge />)

    expect(screen.getByRole('heading', { name: 'Für später vorsorgen' })).toBeVisible()
    const eingabe = screen.getByLabelText('Ihr Name')
    expect(eingabe).toHaveValue(BENUTZER.anzeigename)
  })

  it('legt Vorsorgefall an und leitet zu /nachlass weiter', async () => {
    mockLegeVorsorgefallAn.mockResolvedValue(undefined)
    rendereMitProvidern(<Vorsorge />)

    const eingabe = screen.getByLabelText('Ihr Name')
    await userEvent.clear(eingabe)
    await userEvent.type(eingabe, 'Maximilian Mustermann')

    await userEvent.click(screen.getByRole('button', { name: 'Vorsorge anlegen' }))

    expect(mockLegeVorsorgefallAn).toHaveBeenCalledWith({
      personName: 'Maximilian Mustermann',
    })
    expect(navigiere).toHaveBeenCalledWith('/nachlass', { replace: true })
  })

  it('zeigt Fehlermeldung bei Fehlschlag', async () => {
    mockLegeVorsorgefallAn.mockRejectedValue(new Error('Netzwerkfehler.'))
    rendereMitProvidern(<Vorsorge />)

    await userEvent.click(screen.getByRole('button', { name: 'Vorsorge anlegen' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/Netzwerkfehler/)
  })

  it('hinterlegt denselben Namen auch als eigenen Namen (§3.3)', async () => {
    /*
     * „Ihr Name" ist hier der Name des Falls *und* der dieser Person: Wer
     * vorsorgt, lädt danach Angehörige ein, und die sehen ihn im
     * Kopplungsangebot (§6). Ohne hinterlegten Namen gibt es dort gar keinen
     * Code.
     */
    mockHinterlegterName = ''
    mockLegeVorsorgefallAn.mockResolvedValue(undefined)

    rendereMitProvidern(<Vorsorge />)

    const eingabe = screen.getByLabelText('Ihr Name')
    expect(eingabe).toHaveValue('')
    expect(eingabe).toBeRequired()

    await userEvent.type(eingabe, 'Anna Müller')
    await userEvent.click(screen.getByRole('button', { name: 'Vorsorge anlegen' }))

    expect(mockSpeichereNamen).toHaveBeenCalledWith('Anna Müller')
    expect(mockLegeVorsorgefallAn).toHaveBeenCalledWith({ personName: 'Anna Müller' })
  })

  it('legt keinen Vorsorgefall ohne Namen an', async () => {
    mockHinterlegterName = ''

    rendereMitProvidern(<Vorsorge />)

    await userEvent.click(screen.getByRole('button', { name: 'Vorsorge anlegen' }))

    expect(mockLegeVorsorgefallAn).not.toHaveBeenCalled()
    expect(mockSpeichereNamen).not.toHaveBeenCalled()
  })
})
