import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { Button } from '../../src/ui/Button/Button.tsx'
import { Dialog } from '../../src/ui/Dialog/Dialog.tsx'

/**
 * Der Dialog (DESIGN.md §7).
 *
 * Geprüft wird, was ihn zu einem Dialog macht und nicht bloss zu einer Schicht
 * über der Seite: dass eine Vorlesestimme ihn als solchen findet, dass es einen
 * Weg heraus gibt, den man nicht suchen muss, und dass Tastatur und Fokus in
 * ihm bleiben, solange er offen ist.
 */
describe('Dialog', () => {
  it('ist ein benannter, modaler Dialog', () => {
    render(
      <Dialog titel="Neue Aufgabe" aufSchliessen={vi.fn()}>
        <p>Inhalt</p>
      </Dialog>,
    )

    const dialog = screen.getByRole('dialog', { name: 'Neue Aufgabe' })

    expect(dialog).toBeVisible()
    expect(dialog).toHaveAttribute('aria-modal', 'true')
  })

  it('schliesst über das Kreuz oben links', async () => {
    const aufSchliessen = vi.fn()

    render(
      <Dialog titel="Neue Aufgabe" aufSchliessen={aufSchliessen}>
        <p>Inhalt</p>
      </Dialog>,
    )

    // Ein Kreuz ohne Text braucht einen Namen, sonst hört eine blinde Person
    // "Schaltfläche" und sonst nichts (§7).
    await userEvent.click(screen.getByRole('button', { name: 'Abbrechen' }))

    expect(aufSchliessen).toHaveBeenCalled()
  })

  it('schliesst mit Escape', async () => {
    const aufSchliessen = vi.fn()

    render(
      <Dialog titel="Aufgabe löschen" aufSchliessen={aufSchliessen}>
        <p>Wirklich?</p>
      </Dialog>,
    )

    await userEvent.keyboard('{Escape}')

    expect(aufSchliessen).toHaveBeenCalled()
  })

  it('stellt die Kopfaktion oben rechts hin', () => {
    render(
      <Dialog
        titel="Neue Aufgabe"
        aufSchliessen={vi.fn()}
        kopfaktion={<Button variante="text">Speichern</Button>}
      >
        <p>Inhalt</p>
      </Dialog>,
    )

    expect(screen.getByRole('button', { name: 'Speichern' })).toBeVisible()
  })

  it('nimmt den Fokus hinein und gibt ihn beim Schliessen zurück', async () => {
    function Huelle() {
      return (
        <>
          <button type="button">Öffner</button>
          <Dialog titel="Neue Aufgabe" aufSchliessen={vi.fn()}>
            <button type="button">Drinnen</button>
          </Dialog>
        </>
      )
    }

    const oeffner = document.createElement('button')
    document.body.append(oeffner)
    oeffner.focus()

    const { unmount } = render(<Huelle />)

    // Der Fokus steht im Dialog und nicht mehr auf der Seite dahinter.
    expect(screen.getByRole('dialog')).toHaveFocus()

    unmount()

    // Zurück auf die Schaltfläche, die den Dialog geöffnet hat: Sonst fängt
    // die Tabulatortaste danach wieder ganz oben an.
    expect(oeffner).toHaveFocus()
    oeffner.remove()
  })

  it('nimmt einem Feld mit autoFocus den Fokus nicht wieder weg', () => {
    /*
     * Kindeffekte laufen vor Elterneffekten: Ohne die Pruefung im Dialog
     * ginge die Tastatur auf und die Schreibmarke stuende nirgends.
     */
    render(
      <Dialog titel="Neue Aufgabe" aufSchliessen={vi.fn()}>
        <input aria-label="Titel" autoFocus />
      </Dialog>,
    )

    expect(screen.getByLabelText('Titel')).toHaveFocus()
  })

  it('haelt die Tabulatortaste im Dialog', async () => {
    render(
      <>
        <button type="button">Dahinter</button>
        <Dialog
          titel="Neue Aufgabe"
          aufSchliessen={vi.fn()}
          kopfaktion={<Button variante="text">Speichern</Button>}
        >
          <input aria-label="Titel" />
        </Dialog>
      </>,
    )

    // Kreuz, Kopfaktion, Feld: drei Ziele, danach geht es im Kreis weiter und
    // nicht auf die Seite dahinter, die gerade niemand bedienen kann.
    await userEvent.tab()
    expect(screen.getByRole('button', { name: 'Abbrechen' })).toHaveFocus()

    await userEvent.tab()
    expect(screen.getByRole('button', { name: 'Speichern' })).toHaveFocus()

    await userEvent.tab()
    expect(screen.getByLabelText('Titel')).toHaveFocus()

    await userEvent.tab()
    expect(screen.getByRole('button', { name: 'Abbrechen' })).toHaveFocus()

    await userEvent.tab({ shift: true })
    expect(screen.getByLabelText('Titel')).toHaveFocus()
  })

  it('gibt die Seite darunter erst wieder frei, wenn er weg ist', () => {
    const { unmount } = render(
      <Dialog titel="Neue Aufgabe" aufSchliessen={vi.fn()}>
        <p>Inhalt</p>
      </Dialog>,
    )

    expect(document.body.style.overflow).toBe('hidden')

    unmount()

    expect(document.body.style.overflow).toBe('')
  })
})
