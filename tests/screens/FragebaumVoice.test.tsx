import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthKontextProvider } from '../../src/core/auth/authProvider.ts'
import type { Falldaten } from '../../src/hooks/useCase.ts'
import type { LesbarerFall } from '../../src/services/fallService.ts'
import { authWert } from './harness.tsx'

const useCase = vi.fn<() => Falldaten>()
const speichereFragebaum = vi.fn()
const legeFragebaumAufgabeAn = vi.fn()

vi.mock('../../src/hooks/useCase.ts', () => ({ useCase: () => useCase() }))
vi.mock('../../src/hooks/useAnsichtsmodus.ts', () => ({ useAnsichtsmodus: () => 'erweitert' }))

vi.mock('../../src/hooks/useAufgaben.ts', () => ({
  useAufgaben: () => ({
    fragebaum: null,
    fragebaumGeladen: true,
    speichereFragebaum,
    fragebaumAufgabe: () => null,
    legeFragebaumAufgabeAn,
    setzeKenntnisAm: vi.fn(),
    setzeAnfechtungKenntnisAm: vi.fn(),
    fristbezug: { sterbedatum: null, kenntnisAm: null, anfechtungKenntnisAm: null },
    nachlass: [],
  }),
}))

const { Fragebaum } = await import('../../src/screens/shared/Fragebaum/Fragebaum.tsx')

const LESBAR: LesbarerFall = {
  zustand: 'lesbar',
  id: 'fall-1',
  status: 'trauerfall',
  personName: 'Hans Weber',
  sterbedatum: '2026-03-15',
  kid: 'case_fall-1:1',
  keyGeneration: 1,
  rotationPending: false,
  kc: new Uint8Array([1]),
  kcat: new Uint8Array([2]),
  preparerId: 'user_1',
  vaultCommitment: null,
  katalogVersion: null,
  kv: null,
  vaultResplitPending: false,
  vaultK: null,
  vaultN: 0,
}

function zeige(pfadAdresse = '/erbe/fragebaum') {
  return render(
    <AuthKontextProvider value={authWert()}>
      <MemoryRouter initialEntries={[pfadAdresse]}>
        <Routes>
          <Route path="/erbe/fragebaum" element={<Fragebaum />} />
          <Route path="/erbe/fragebaum/:knotenId" element={<Fragebaum />} />
          <Route path="/erbe" element={<p>Erbe-Übersicht</p>} />
        </Routes>
      </MemoryRouter>
    </AuthKontextProvider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  useCase.mockReturnValue({
    zustand: { status: 'bereit', aktiver: LESBAR, faelle: [LESBAR] },
    legeTrauerfallAn: vi.fn(),
    legeVorsorgefallAn: vi.fn(),
    loescheVorsorgefall: vi.fn(),
    verlasseFall: vi.fn(),
    aktualisiere: vi.fn(),
  })
})

describe('Fragebaum Sprachagent Integration', () => {
  it('zeigt den Sprachassistent-Button in der Navigation', () => {
    zeige()

    expect(
      screen.getByRole('button', { name: 'Fragebaum mit Sprachassistent starten' }),
    ).toBeInTheDocument()
  })

  it('öffnet das Vollbild-Overlay beim Klick auf Sprachassistent', async () => {
    const user = userEvent.setup()
    zeige()

    await user.click(
      screen.getByRole('button', { name: 'Fragebaum mit Sprachassistent starten' }),
    )

    expect(screen.getByRole('dialog', { name: 'Fragebaum Sprachassistent' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sprachdialog beenden' })).toBeInTheDocument()
  })

  it('beendet den Sprachmodus und bleibt an der aktuellen Frage', async () => {
    const user = userEvent.setup()
    zeige()

    // Sprachmodus starten
    await user.click(
      screen.getByRole('button', { name: 'Fragebaum mit Sprachassistent starten' }),
    )
    expect(screen.getByRole('dialog', { name: 'Fragebaum Sprachassistent' })).toBeInTheDocument()

    // Sprachmodus beenden
    await user.click(screen.getByRole('button', { name: 'Sprachdialog beenden' }))

    // Overlay geschlossen, wir sind bei der Frage "Sind Sie Erbe?"
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Fragebaum Sprachassistent' })).not.toBeInTheDocument()
    })
    expect(screen.getByRole('heading', { name: 'Sind Sie Erbe?' })).toBeInTheDocument()
  })
})
