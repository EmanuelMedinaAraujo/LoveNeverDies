import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { Checkbox } from '../../src/ui/Checkbox/Checkbox.tsx'

/**
 * Haekchen (DESIGN.md §7).
 *
 * Die Zusage ist nicht das Aussehen, sondern dass es ein echtes Formularfeld
 * mit Beschriftung bleibt: ansagbar, per Tastatur bedienbar, und mit der ganzen
 * Zeile als Trefferflaeche.
 */

describe('Checkbox', () => {
  it('traegt die Beschriftung als zugaenglichen Namen', () => {
    render(<Checkbox label="Sterbeurkunde beantragen" />)

    expect(screen.getByRole('checkbox', { name: 'Sterbeurkunde beantragen' })).toBeVisible()
  })

  it('behaelt den zugaenglichen Namen, wenn nur das Kaestchen anzutippen ist', () => {
    /*
     * `nurKaestchen` arbeitet mit `pointer-events` und aendert deshalb nichts
     * an Name, Tastatur und Bildschirmleser. Genau das ist die Zusage: In den
     * Aufgabenlisten fuehrt ein Tipp auf den Titel ins Detail, aber wer die
     * Liste mit der Tastatur oder mit einer Vorlesestimme bedient, findet
     * dieselbe Beschriftung wie zuvor.
     *
     * Dass der Titel dort keine Tipps mehr annimmt, steht im E2E-Test: Es ist
     * eine Zusage der CSS, und jsdom rechnet kein Layout.
     */
    render(<Checkbox label="Sterbeurkunde beantragen" nurKaestchen />)

    expect(screen.getByRole('checkbox', { name: 'Sterbeurkunde beantragen' })).toBeVisible()
  })

  it('laesst sich ueber die Beschriftung umschalten', async () => {
    // Der Fingertipp trifft die ganze Zeile, nicht nur das Kaestchen.
    const geaendert = vi.fn()
    render(<Checkbox label="Konten kündigen" checked={false} onChange={geaendert} />)

    await userEvent.click(screen.getByText('Konten kündigen'))

    expect(geaendert).toHaveBeenCalledOnce()
  })

  it('nimmt den Zustand von aussen entgegen', () => {
    render(<Checkbox label="Erledigt" checked readOnly />)

    expect(screen.getByRole('checkbox', { name: 'Erledigt' })).toBeChecked()
  })

  it('laesst sich sperren, solange eine Aenderung laeuft', async () => {
    const geaendert = vi.fn()
    render(<Checkbox label="Gesperrt" disabled onChange={geaendert} />)

    await userEvent.click(screen.getByRole('checkbox', { name: 'Gesperrt' }))

    expect(geaendert).not.toHaveBeenCalled()
  })
})
