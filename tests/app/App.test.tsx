import { render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthKontextProvider, type AuthZustand } from '../../src/core/auth/authProvider.ts'
import { authWert } from '../screens/harness.tsx'

/**
 * Der Anmeldezustand und das Routing aus DESIGN.md §7.
 *
 * Alle Screens sind ersetzt: Was sie zeigen, steht in ihren eigenen Tests. Hier
 * geht es um die Weiche davor — angemeldet oder nicht —, um die Routen, und
 * darum, dass §7 nach der Anmeldung `navigator.storage.persist()` still
 * mitlaufen lässt.
 *
 * **Die Fallsperre steht in `Start.test.tsx`.** Sie gehört zu dem Screen, der
 * sie zeigt: Ohne Fall ist die App gesperrt, und das ist der Startbildschirm
 * mit seiner Fallweiche (§7).
 */

const useGeraeteanmeldung = vi.fn()
const speicherDauerhaftAnfordern = vi.fn().mockResolvedValue('gewaehrt')

vi.mock('../../src/hooks/useGeraete.ts', () => ({
  useGeraeteanmeldung: () => useGeraeteanmeldung(),
}))
vi.mock('../../src/core/storage/persist.ts', () => ({
  speicherDauerhaftAnfordern: () => speicherDauerhaftAnfordern(),
}))
vi.mock('../../src/screens/shared/Anmelden/Anmelden.tsx', () => ({
  Anmelden: () => <p>Anmeldeformular</p>,
}))
vi.mock('../../src/screens/shared/Start/Start.tsx', () => ({ Start: () => <p>Startseite</p> }))
vi.mock('../../src/screens/shared/Alle/Alle.tsx', () => ({ Alle: () => <p>Aufgabenliste</p> }))
vi.mock('../../src/screens/shared/Profil/Profil.tsx', () => ({ Profil: () => <p>Profilseite</p> }))
vi.mock('../../src/screens/shared/Todesfall/Todesfall.tsx', () => ({
  Todesfall: () => <p>Fallanlage</p>,
}))

const { App } = await import('../../src/app/App.tsx')

function rendere(zustand: AuthZustand, pfad = '/') {
  function Huelle({ children }: { children: ReactNode }) {
    return (
      <AuthKontextProvider value={authWert(zustand)}>
        <MemoryRouter initialEntries={[pfad]}>{children}</MemoryRouter>
      </AuthKontextProvider>
    )
  }

  return render(<App />, { wrapper: Huelle })
}

const ANGEMELDET: AuthZustand = {
  status: 'angemeldet',
  benutzer: { id: 'user_1', anzeigename: 'Anna', email: null },
}

beforeEach(() => {
  vi.clearAllMocks()
  useGeraeteanmeldung.mockReturnValue({ status: 'laedt' })
})

describe('Anmeldezustand', () => {
  it('zeigt einen Hinweis, solange die Sitzung geladen wird', () => {
    rendere({ status: 'laedt' })

    expect(screen.getByRole('status')).toHaveTextContent('Einen Moment bitte')
  })

  it('zeigt ausschliesslich die Anmeldung, wer nicht angemeldet ist', () => {
    rendere({ status: 'abgemeldet' })

    expect(screen.getByText('Anmeldeformular')).toBeVisible()
    expect(screen.queryByText('Startseite')).toBeNull()
  })

  it('bittet erst nach der Anmeldung um dauerhaften Speicher', async () => {
    /*
     * Die Bitte steht hinter der Anmeldung, weil Browser sie eher gewaehren,
     * wenn jemand die Seite tatsaechlich benutzt (§7).
     */
    rendere({ status: 'abgemeldet' })
    expect(speicherDauerhaftAnfordern).not.toHaveBeenCalled()

    rendere(ANGEMELDET)
    await waitFor(() => expect(speicherDauerhaftAnfordern).toHaveBeenCalled())
  })

  it('setzt den Ansichtsmodus als data-dichte auf die Wurzel', async () => {
    rendere(ANGEMELDET)

    await waitFor(() => {
      expect(document.documentElement.dataset.dichte).toBe('erweitert')
    })
  })
})

describe('Routen', () => {
  it('fuehrt / zu "Meine Aufgaben"', () => {
    rendere(ANGEMELDET)

    expect(screen.getByText('Startseite')).toBeVisible()
  })

  it('fuehrt /todesfall zur Fallanlage', () => {
    rendere(ANGEMELDET, '/todesfall')

    expect(screen.getByText('Fallanlage')).toBeVisible()
  })

  it('fuehrt /alle zur Aufgabenliste', () => {
    rendere(ANGEMELDET, '/alle')

    expect(screen.getByText('Aufgabenliste')).toBeVisible()
  })

  it('fuehrt /profil zum Profil', () => {
    rendere(ANGEMELDET, '/profil')

    expect(screen.getByText('Profilseite')).toBeVisible()
  })

  it('leitet unbekannte Pfade auf die Startseite', () => {
    rendere(ANGEMELDET, '/gibt-es-nicht')

    expect(screen.getByText('Startseite')).toBeVisible()
  })
})
