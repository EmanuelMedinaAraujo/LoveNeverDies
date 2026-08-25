import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { ansichtLesen, ansichtZuruecksetzen } from '../../src/core/storage/ansicht.ts'
import { Ansichtswahl } from '../../src/screens/shared/Onboarding/Ansichtswahl.tsx'
import { rendereMitProvidern } from './harness.tsx'

/**
 * "Wie möchten Sie die App nutzen?" (DESIGN.md §7).
 *
 * Der Screen steht vor der Fallweiche; dass niemand an ihm vorbeikommt, steht
 * in `tests/app/App.test.tsx`. Hier geht es um die Frage selbst: "Einfach" ist
 * vorausgewählt, und geschrieben wird erst, wenn jemand weitergeht.
 */

beforeEach(() => {
  localStorage.clear()
  ansichtZuruecksetzen()
})

describe('Ansichtswahl', () => {
  it('stellt die Frage aus §7 und wählt "Einfach" vor', () => {
    rendereMitProvidern(<Ansichtswahl />)

    expect(
      screen.getByRole('heading', { level: 1, name: 'Wie möchten Sie die App nutzen?' }),
    ).toBeVisible()
    expect(screen.getByRole('radio', { name: /Einfach/ })).toBeChecked()
    expect(screen.getByRole('radio', { name: /Erweitert/ })).not.toBeChecked()
  })

  it('schreibt nichts, solange niemand weitergeht', async () => {
    rendereMitProvidern(<Ansichtswahl />)

    await userEvent.click(screen.getByRole('radio', { name: /Erweitert/ }))

    // Unbeantwortet heißt unbeantwortet: Ein Neustart mitten im Onboarding
    // stellt die Frage noch einmal.
    expect(ansichtLesen().modus).toBeNull()
  })

  it('übernimmt die Vorauswahl mit einem Tipp auf "Weiter"', async () => {
    rendereMitProvidern(<Ansichtswahl />)

    await userEvent.click(screen.getByRole('button', { name: 'Weiter' }))

    expect(ansichtLesen().modus).toBe('einfach')
  })

  it('übernimmt die andere Wahl', async () => {
    rendereMitProvidern(<Ansichtswahl />)

    await userEvent.click(screen.getByRole('radio', { name: /Erweitert/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Weiter' }))

    expect(ansichtLesen().modus).toBe('erweitert')
  })

  it('sagt, dass die Wahl umkehrbar ist', () => {
    // Sie soll nicht schwerer wiegen, als sie ist: Umgestellt wird in Profil,
    // jederzeit und in beide Richtungen (§7).
    rendereMitProvidern(<Ansichtswahl />)

    expect(screen.getByText(/jederzeit in Profil wechseln/)).toBeVisible()
  })
})
