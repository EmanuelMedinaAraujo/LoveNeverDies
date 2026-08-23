import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Geraeteliste as GeraetelisteDaten } from '../../src/hooks/useGeraete.ts'
import { geraet, rendereMitProvidern } from './harness.tsx'

const useGeraete = vi.fn<() => GeraetelisteDaten>()

vi.mock('../../src/hooks/useGeraete.ts', () => ({ useGeraete: () => useGeraete() }))

const { Geraeteliste, gruppierterPruefcode } = await import(
  '../../src/screens/shared/Profil/Geraeteliste.tsx'
)

function daten(ueberschreibung: Partial<GeraetelisteDaten> = {}): GeraetelisteDaten {
  return {
    zustand: { status: 'bereit', geraete: [geraet()] },
    umbenennen: vi.fn().mockResolvedValue(undefined),
    ...ueberschreibung,
  }
}

beforeEach(() => {
  useGeraete.mockReturnValue(daten())
})

describe('gruppierterPruefcode', () => {
  it('teilt die sechs Ziffern in zwei Gruppen', () => {
    // Am Telefon liest niemand "vierhunderteinundachtzigtausend".
    expect(gruppierterPruefcode('481253')).toBe('481 253')
  })
})

describe('Geraeteliste', () => {
  it('zeigt an, solange geladen wird', () => {
    useGeraete.mockReturnValue(daten({ zustand: { status: 'laedt' } }))

    rendereMitProvidern(<Geraeteliste />)

    expect(screen.getByRole('status')).toHaveTextContent('Ihre Geräte werden geladen')
  })

  it('nennt den Grund, wenn die Liste nicht abrufbar ist', () => {
    useGeraete.mockReturnValue(
      daten({ zustand: { status: 'fehler', nachricht: 'Kein Netz.' } }),
    )

    rendereMitProvidern(<Geraeteliste />)

    const meldung = screen.getByRole('alert')
    expect(meldung).toHaveTextContent('Ihre Geräte sind gerade nicht abrufbar.')
    expect(meldung).toHaveTextContent('Kein Netz.')
  })

  it('behauptet keine leere Liste, wenn die Registrierung nicht durchkam', () => {
    /*
     * Nach einer erfolgreichen Anmeldung steht hier immer mindestens dieses
     * Geraet. Leer heisst: Die Registrierung kam nicht durch — kein Grund fuer
     * eine Fehlermeldung, aber auch keiner, eine leere Liste zu behaupten.
     */
    useGeraete.mockReturnValue(daten({ zustand: { status: 'bereit', geraete: [] } }))

    rendereMitProvidern(<Geraeteliste />)

    expect(screen.getByRole('status')).toHaveTextContent('noch nicht angemeldet')
  })

  it('markiert das Geraet, an dem jemand sitzt', () => {
    useGeraete.mockReturnValue(
      daten({
        zustand: {
          status: 'bereit',
          geraete: [
            geraet(),
            geraet({ id: 'geraet-2', label: 'iPad', diesesGeraet: false, pruefcode: '900111' }),
          ],
        },
      }),
    )

    rendereMitProvidern(<Geraeteliste />)

    const zeilen = screen.getAllByRole('listitem')
    expect(zeilen).toHaveLength(2)
    expect(zeilen[0]).toHaveTextContent('Dieses Gerät')
    expect(zeilen[1]).not.toHaveTextContent('Dieses Gerät')
  })

  it('zeigt den Pruefcode gruppiert und zum Vorlesen einzeln', () => {
    /*
     * Screenreader machen aus "481 253" sonst zwei Zahlwoerter — verglichen
     * werden aber Ziffern (§3.6).
     */
    const { container } = rendereMitProvidern(<Geraeteliste />)

    expect(container.querySelector('[aria-hidden="true"]')).toHaveTextContent('481 253')
    expect(container.querySelector('.nur-vorlesen')).toHaveTextContent('4 8 1 2 5 3')
  })

  it('benennt ein Geraet um', async () => {
    const umbenennen = vi.fn().mockResolvedValue(undefined)
    useGeraete.mockReturnValue(daten({ umbenennen }))

    rendereMitProvidern(<Geraeteliste />)

    await userEvent.click(screen.getByRole('button', { name: /Umbenennen/ }))
    const feld = screen.getByLabelText('Name dieses Geräts')
    await userEvent.clear(feld)
    await userEvent.type(feld, 'Mein Testgerät')
    await userEvent.click(screen.getByRole('button', { name: 'Speichern' }))

    await waitFor(() => {
      expect(umbenennen).toHaveBeenCalledWith('geraet-1', 'Mein Testgerät')
    })
  })

  it('laesst sich das Umbenennen abbrechen', async () => {
    rendereMitProvidern(<Geraeteliste />)

    await userEvent.click(screen.getByRole('button', { name: /Umbenennen/ }))
    expect(screen.getByLabelText('Name dieses Geräts')).toBeVisible()

    await userEvent.click(screen.getByRole('button', { name: 'Abbrechen' }))

    expect(screen.queryByLabelText('Name dieses Geräts')).toBeNull()
  })

  it('speichert keinen leeren Namen', async () => {
    const umbenennen = vi.fn().mockResolvedValue(undefined)
    useGeraete.mockReturnValue(daten({ umbenennen }))

    rendereMitProvidern(<Geraeteliste />)

    await userEvent.click(screen.getByRole('button', { name: /Umbenennen/ }))
    await userEvent.clear(screen.getByLabelText('Name dieses Geräts'))

    expect(screen.getByRole('button', { name: 'Speichern' })).toBeDisabled()
    expect(umbenennen).not.toHaveBeenCalled()
  })

  it('sagt es, wenn der neue Name nicht angekommen ist', async () => {
    /*
     * Ohne diesen Zweig verschwaende ein gescheitertes Umbenennen spurlos: Das
     * Feld bliebe offen, der Knopf wieder bedienbar, und nichts sagte, dass
     * der eingetippte Name nirgends angekommen ist.
     */
    const umbenennen = vi.fn().mockRejectedValue(new Error('Gehört nicht Ihnen.'))
    useGeraete.mockReturnValue(daten({ umbenennen }))

    rendereMitProvidern(<Geraeteliste />)

    await userEvent.click(screen.getByRole('button', { name: /Umbenennen/ }))
    await userEvent.type(screen.getByLabelText('Name dieses Geräts'), '!')
    await userEvent.click(screen.getByRole('button', { name: 'Speichern' }))

    const meldung = await screen.findByRole('alert')
    expect(meldung).toHaveTextContent('Der neue Name ist nicht angekommen.')
    expect(meldung).toHaveTextContent('Gehört nicht Ihnen.')
  })
})
