import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Falldaten } from '../../src/hooks/useCase.ts'
import { rendereMitProvidern } from './harness.tsx'

const navigiere = vi.fn()
const useCase = vi.fn<() => Falldaten>()

vi.mock('react-router-dom', async () => {
  const echt = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return { ...echt, useNavigate: () => navigiere }
})

vi.mock('../../src/hooks/useCase.ts', () => ({ useCase: () => useCase() }))

/*
 * §3.3: Der eigene Name geht nicht in den Fall, sondern in `profiles`. Hier
 * steht nur, ob der Screen ihn erfragt und weiterreicht; was dann geschieht,
 * prueft `tests/hooks/useProfil.test.tsx`.
 */
const speichereNamen = vi.fn<(name: string) => Promise<void>>()
let hinterlegterName = ''

vi.mock('../../src/hooks/useProfil.ts', () => ({
  useProfilAbgleich: () => ({
    zustand: { status: 'bereit' },
    name: hinterlegterName,
    nameFehlt: hinterlegterName === '',
    speichereNamen,
    nochmal: vi.fn(),
  }),
}))

const { Todesfall } = await import('../../src/screens/shared/Todesfall/Todesfall.tsx')

function falldaten(ueberschreibung: Partial<Falldaten> = {}): Falldaten {
  return {
    zustand: { status: 'kein-fall' },
    legeTrauerfallAn: vi.fn().mockResolvedValue(undefined),
    legeVorsorgefallAn: vi.fn().mockResolvedValue(undefined),
    loescheVorsorgefall: vi.fn().mockResolvedValue(undefined),
    verlasseFall: vi.fn().mockResolvedValue(undefined),
    aktualisiere: vi.fn(),
    ...ueberschreibung,
  }
}

beforeEach(() => {
  navigiere.mockClear()
  speichereNamen.mockReset()
  speichereNamen.mockResolvedValue(undefined)
  hinterlegterName = 'Anna Müller'
  useCase.mockReturnValue(falldaten())
})

/**
 * Einen Trauerfall anlegen (DESIGN.md §2, §3.1).
 *
 * Der Screen selbst verschlüsselt nichts. Das tut `fallService`, geprüft in
 * `tests/services/fallService.test.ts`. Hier geht es darum, was das Formular
 * mit den Eingaben macht und was es zeigt, wenn das Anlegen scheitert.
 */
describe('Todesfall', () => {
  it('erklaert, was mit den Angaben passiert', () => {
    rendereMitProvidern(<Todesfall />)

    expect(screen.getByRole('heading', { name: 'Ein Todesfall ist eingetreten' })).toBeVisible()
    expect(screen.getByText(/bleiben verschlüsselt/)).toBeVisible()
  })

  it('reicht Name und Sterbedatum weiter und geht danach zurueck', async () => {
    const legeTrauerfallAn = vi.fn().mockResolvedValue(undefined)
    useCase.mockReturnValue(falldaten({ legeTrauerfallAn }))

    rendereMitProvidern(<Todesfall />)

    await userEvent.type(screen.getByLabelText('Name der verstorbenen Person'), 'Hans Weber')
    await userEvent.type(screen.getByLabelText('Sterbedatum'), '2024-03-15')
    await userEvent.click(screen.getByRole('button', { name: 'Fall anlegen' }))

    await waitFor(() => {
      expect(legeTrauerfallAn).toHaveBeenCalledWith({
        personName: 'Hans Weber',
        sterbedatum: '2024-03-15',
      })
    })

    expect(navigiere).toHaveBeenCalledWith('/', { replace: true })
  })

  it('fragt den eigenen Namen auf derselben Seite und hinterlegt ihn (§3.3)', async () => {
    /*
     * §6: Die eingeladene Person sieht diesen Namen, bevor sie irgendetwas
     * bestätigt. Er gehört nicht in den Fall — dort steht der Name der
     * verstorbenen Person —, sondern in `profiles`.
     */
    hinterlegterName = ''
    const legeTrauerfallAn = vi.fn().mockResolvedValue(undefined)
    useCase.mockReturnValue(falldaten({ legeTrauerfallAn }))

    rendereMitProvidern(<Todesfall />)

    const eigenes = screen.getByLabelText('Ihr Name')
    expect(eigenes).toHaveValue('')
    expect(eigenes).toBeRequired()

    await userEvent.type(screen.getByLabelText('Name der verstorbenen Person'), 'Hans Weber')
    await userEvent.type(screen.getByLabelText('Sterbedatum'), '2024-03-15')
    await userEvent.type(eigenes, 'Anna Müller')
    await userEvent.click(screen.getByRole('button', { name: 'Fall anlegen' }))

    await waitFor(() => expect(speichereNamen).toHaveBeenCalledWith('Anna Müller'))
    expect(legeTrauerfallAn).toHaveBeenCalled()
  })

  it('legt keinen Fall an, solange der eigene Name fehlt (§3.3)', async () => {
    hinterlegterName = ''
    const legeTrauerfallAn = vi.fn().mockResolvedValue(undefined)
    useCase.mockReturnValue(falldaten({ legeTrauerfallAn }))

    rendereMitProvidern(<Todesfall />)

    await userEvent.type(screen.getByLabelText('Name der verstorbenen Person'), 'Hans Weber')
    await userEvent.type(screen.getByLabelText('Sterbedatum'), '2024-03-15')
    await userEvent.click(screen.getByRole('button', { name: 'Fall anlegen' }))

    expect(legeTrauerfallAn).not.toHaveBeenCalled()
    expect(speichereNamen).not.toHaveBeenCalled()
  })

  it('legt den Fall nicht an, wenn der Name nicht zu hinterlegen war', async () => {
    /*
     * Sonst stünde ein Fall da, dessen Anlegerin für alle anderen namenlos
     * bleibt — und der zweite Versuch führte über diesen Screen, den sie nicht
     * mehr sieht: Wer einen Fall hat, wird von hier weitergeleitet.
     */
    hinterlegterName = ''
    speichereNamen.mockRejectedValue(new Error('Kein Netz.'))
    const legeTrauerfallAn = vi.fn().mockResolvedValue(undefined)
    useCase.mockReturnValue(falldaten({ legeTrauerfallAn }))

    rendereMitProvidern(<Todesfall />)

    await userEvent.type(screen.getByLabelText('Name der verstorbenen Person'), 'Hans Weber')
    await userEvent.type(screen.getByLabelText('Sterbedatum'), '2024-03-15')
    await userEvent.type(screen.getByLabelText('Ihr Name'), 'Anna Müller')
    await userEvent.click(screen.getByRole('button', { name: 'Fall anlegen' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Kein Netz.')
    expect(legeTrauerfallAn).not.toHaveBeenCalled()
  })

  it('zeigt den Grund, wenn das Anlegen scheitert, und laesst es erneut versuchen', async () => {
    const legeTrauerfallAn = vi
      .fn()
      .mockRejectedValue(new Error('Der Server war nicht erreichbar.'))
    useCase.mockReturnValue(falldaten({ legeTrauerfallAn }))

    rendereMitProvidern(<Todesfall />)

    await userEvent.type(screen.getByLabelText('Name der verstorbenen Person'), 'Hans Weber')
    await userEvent.type(screen.getByLabelText('Sterbedatum'), '2024-03-15')
    await userEvent.click(screen.getByRole('button', { name: 'Fall anlegen' }))

    const meldung = await screen.findByRole('alert')
    expect(meldung).toHaveTextContent('Der Fall war nicht anzulegen.')
    expect(meldung).toHaveTextContent('Der Server war nicht erreichbar.')

    // Der Knopf muss wieder bedienbar sein, sonst waere der Fehler eine
    // Sackgasse.
    expect(screen.getByRole('button', { name: 'Fall anlegen' })).toBeEnabled()
    expect(navigiere).not.toHaveBeenCalled()
  })

  it('sperrt den Knopf, solange das Anlegen laeuft', async () => {
    // Zweimal tippen hiesse zwei Faelle.
    let loese: () => void = () => {}
    const legeTrauerfallAn = vi.fn().mockReturnValue(
      new Promise<void>((erfuellen) => {
        loese = erfuellen
      }),
    )
    useCase.mockReturnValue(falldaten({ legeTrauerfallAn }))

    rendereMitProvidern(<Todesfall />)

    await userEvent.type(screen.getByLabelText('Name der verstorbenen Person'), 'Hans Weber')
    await userEvent.type(screen.getByLabelText('Sterbedatum'), '2024-03-15')
    await userEvent.click(screen.getByRole('button', { name: 'Fall anlegen' }))

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Fall anlegen' })).toBeDisabled()
    })

    loese()
  })

  it('leitet weiter, wer schon einen Fall hat', () => {
    /*
     * Sonst entstuende eine zweite, fuer niemanden erreichbare Zeile in
     * `cases` (§2).
     */
    useCase.mockReturnValue(
      falldaten({
        zustand: {
          status: 'bereit',
          faelle: [],
          aktiver: { zustand: 'gesperrt', id: 'fall-1', grund: 'egal' },
        },
      }),
    )

    rendereMitProvidern(<Todesfall />)

    expect(screen.queryByRole('button', { name: 'Fall anlegen' })).toBeNull()
  })
})
