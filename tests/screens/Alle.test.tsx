import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Aufgabendaten } from '../../src/hooks/useAufgaben.ts'
import type { Falldaten } from '../../src/hooks/useCase.ts'
import type { Aufgabe } from '../../src/services/aufgabenService.ts'
import type { LesbarerFall } from '../../src/services/fallService.ts'
import { rendereMitProvidern } from './harness.tsx'

const useCase = vi.fn<() => Falldaten>()
const useAufgaben = vi.fn<() => Aufgabendaten>()

vi.mock('../../src/hooks/useCase.ts', () => ({ useCase: () => useCase() }))
vi.mock('../../src/hooks/useAufgaben.ts', () => ({ useAufgaben: () => useAufgaben() }))

const { Alle } = await import('../../src/screens/shared/Alle/Alle.tsx')

/**
 * Der Tab "Alle" (DESIGN.md §7).
 *
 * Der Screen verschlüsselt nichts — das tut `aufgabenService`, geprüft in
 * `tests/services/aufgabenService.test.ts`. Hier geht es darum, was er aus
 * einem Zustand macht: welche Schaltflächen es gibt, was vor dem Löschen
 * gefragt wird und was passiert, wenn eine Änderung abgelehnt wird.
 */

const LESBAR: LesbarerFall = {
  zustand: 'lesbar',
  id: 'fall-1',
  status: 'trauerfall',
  personName: 'Hans Weber',
  sterbedatum: '2024-03-15',
  kid: 'case_fall-1:1',
  kc: new Uint8Array([1]),
  kcat: new Uint8Array([2]),
}

function aufgabe(ueberschreibung: Partial<Aufgabe> = {}): Aufgabe {
  return {
    id: 'item-1',
    titel: 'Sterbeurkunde beantragen',
    beschreibung: '',
    erledigt: false,
    dek: new Uint8Array([9]),
    kid: LESBAR.kid,
    ...ueberschreibung,
  }
}

function falldaten(ueberschreibung: Partial<Falldaten> = {}): Falldaten {
  return {
    zustand: { status: 'bereit', faelle: [LESBAR], aktiver: LESBAR },
    legeTrauerfallAn: vi.fn().mockResolvedValue(undefined),
    ...ueberschreibung,
  }
}

function aufgabendaten(ueberschreibung: Partial<Aufgabendaten> = {}): Aufgabendaten {
  return {
    zustand: { status: 'bereit', aufgaben: [aufgabe()], uebersprungen: 0 },
    legeAn: vi.fn().mockResolvedValue(undefined),
    schreibe: vi.fn().mockResolvedValue(undefined),
    hakeAb: vi.fn().mockResolvedValue(undefined),
    loesche: vi.fn().mockResolvedValue(undefined),
    ...ueberschreibung,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  useCase.mockReturnValue(falldaten())
  useAufgaben.mockReturnValue(aufgabendaten())
})

describe('Alle', () => {
  it('zeigt die Aufgaben des Falls', () => {
    rendereMitProvidern(<Alle />)

    expect(screen.getByRole('heading', { name: 'Alle Aufgaben' })).toBeVisible()
    expect(screen.getByRole('checkbox', { name: 'Sterbeurkunde beantragen' })).toBeVisible()
  })

  it('sagt es, solange noch nichts da ist', () => {
    useAufgaben.mockReturnValue(
      aufgabendaten({ zustand: { status: 'bereit', aufgaben: [], uebersprungen: 0 } }),
    )

    rendereMitProvidern(<Alle />)

    expect(screen.getByText(/Hier ist noch nichts/)).toBeVisible()
  })

  it('legt eine Aufgabe an und leert danach das Feld', async () => {
    const legeAn = vi.fn().mockResolvedValue(undefined)
    useAufgaben.mockReturnValue(aufgabendaten({ legeAn }))

    rendereMitProvidern(<Alle />)

    const feld = screen.getByLabelText('Neue Aufgabe')
    await userEvent.type(feld, 'Konten kündigen')
    await userEvent.click(screen.getByRole('button', { name: 'Aufgabe hinzufügen' }))

    await waitFor(() => expect(legeAn).toHaveBeenCalledWith('Konten kündigen'))
    expect(feld).toHaveValue('')
  })

  it('hakt eine Aufgabe ab', async () => {
    const hakeAb = vi.fn().mockResolvedValue(undefined)
    useAufgaben.mockReturnValue(aufgabendaten({ hakeAb }))

    rendereMitProvidern(<Alle />)

    await userEvent.click(screen.getByRole('checkbox', { name: 'Sterbeurkunde beantragen' }))

    await waitFor(() => expect(hakeAb).toHaveBeenCalledWith(aufgabe(), true))
  })

  it('nimmt das Haekchen wieder zurueck', async () => {
    const hakeAb = vi.fn().mockResolvedValue(undefined)
    useAufgaben.mockReturnValue(
      aufgabendaten({
        hakeAb,
        zustand: {
          status: 'bereit',
          aufgaben: [aufgabe({ erledigt: true })],
          uebersprungen: 0,
        },
      }),
    )

    rendereMitProvidern(<Alle />)

    await userEvent.click(screen.getByRole('checkbox', { name: 'Sterbeurkunde beantragen' }))

    await waitFor(() => expect(hakeAb).toHaveBeenCalledWith(aufgabe({ erledigt: true }), false))
  })

  it('benennt eine Aufgabe um und nimmt die Beschreibung mit', async () => {
    const schreibe = vi.fn().mockResolvedValue(undefined)
    useAufgaben.mockReturnValue(aufgabendaten({ schreibe }))

    rendereMitProvidern(<Alle />)

    await userEvent.click(screen.getByRole('button', { name: /Ändern/ }))

    await userEvent.clear(screen.getByLabelText('Titel'))
    await userEvent.type(screen.getByLabelText('Titel'), 'Sterbeurkunde abholen')
    await userEvent.type(screen.getByLabelText('Beschreibung'), 'Sechs Ausfertigungen')
    await userEvent.click(screen.getByRole('button', { name: 'Speichern' }))

    await waitFor(() =>
      expect(schreibe).toHaveBeenCalledWith(aufgabe(), {
        titel: 'Sterbeurkunde abholen',
        beschreibung: 'Sechs Ausfertigungen',
      }),
    )
  })

  it('laesst das Umbenennen abbrechen, ohne etwas zu schreiben', async () => {
    const schreibe = vi.fn().mockResolvedValue(undefined)
    useAufgaben.mockReturnValue(aufgabendaten({ schreibe }))

    rendereMitProvidern(<Alle />)

    await userEvent.click(screen.getByRole('button', { name: /Ändern/ }))
    await userEvent.type(screen.getByLabelText('Titel'), 'verworfen')
    await userEvent.click(screen.getByRole('button', { name: 'Abbrechen' }))

    expect(schreibe).not.toHaveBeenCalled()
    expect(screen.getByRole('checkbox', { name: 'Sterbeurkunde beantragen' })).toBeVisible()
  })

  it('fragt vor dem Loeschen und nennt die Endgueltigkeit', async () => {
    // §5: Löschen gewinnt endgültig, die Datenbank weist eine Auferstehung ab.
    // Das gehört vor die Aktion gesagt.
    const loesche = vi.fn().mockResolvedValue(undefined)
    useAufgaben.mockReturnValue(aufgabendaten({ loesche }))

    rendereMitProvidern(<Alle />)

    await userEvent.click(screen.getByRole('button', { name: /Löschen/ }))

    expect(screen.getByText(/kommen nicht zurück/)).toBeVisible()
    expect(loesche).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole('button', { name: 'Endgültig löschen' }))

    await waitFor(() => expect(loesche).toHaveBeenCalledWith(aufgabe()))
  })

  it('laesst das Loeschen abbrechen', async () => {
    const loesche = vi.fn().mockResolvedValue(undefined)
    useAufgaben.mockReturnValue(aufgabendaten({ loesche }))

    rendereMitProvidern(<Alle />)

    await userEvent.click(screen.getByRole('button', { name: /Löschen/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Abbrechen' }))

    expect(loesche).not.toHaveBeenCalled()
    expect(screen.getByRole('checkbox', { name: 'Sterbeurkunde beantragen' })).toBeVisible()
  })

  it('nennt jede Schaltflaeche mit ihrer Aufgabe', async () => {
    // Ohne den Titel zum Vorlesen hoerte eine blinde Person in einer Liste von
    // zwanzig Aufgaben zwanzigmal „Ändern" (§7).
    useAufgaben.mockReturnValue(
      aufgabendaten({
        zustand: {
          status: 'bereit',
          aufgaben: [aufgabe(), aufgabe({ id: 'item-2', titel: 'Konten kündigen' })],
          uebersprungen: 0,
        },
      }),
    )

    rendereMitProvidern(<Alle />)

    // Der zugaengliche Name wird als regulaerer Ausdruck geprueft: Wie das
    // Trennzeichen zwischen sichtbarem und vorgelesenem Teil aussieht,
    // normalisiert jede Umgebung anders. Die Zusage ist, dass der Titel darin
    // vorkommt, nicht wie er angeklebt wird.
    expect(screen.getByRole('button', { name: /^Ändern.*Konten kündigen/ })).toBeVisible()
    expect(screen.getByRole('button', { name: /^Löschen.*Konten kündigen/ })).toBeVisible()
  })

  it('zeigt die Beschreibung, sobald es eine gibt', () => {
    useAufgaben.mockReturnValue(
      aufgabendaten({
        zustand: {
          status: 'bereit',
          aufgaben: [aufgabe({ beschreibung: 'Beim Standesamt Freiburg' })],
          uebersprungen: 0,
        },
      }),
    )

    rendereMitProvidern(<Alle />)

    expect(screen.getByText('Beim Standesamt Freiburg')).toBeVisible()
  })

  it('zeigt den Grund, wenn eine Aenderung abgelehnt wird', async () => {
    // §5: Abgelehnte Mutationen werden nie stillschweigend verworfen.
    const legeAn = vi.fn().mockRejectedValue(new Error('Die Aufgabe war nicht anzulegen.'))
    useAufgaben.mockReturnValue(aufgabendaten({ legeAn }))

    rendereMitProvidern(<Alle />)

    await userEvent.type(screen.getByLabelText('Neue Aufgabe'), 'Etwas')
    await userEvent.click(screen.getByRole('button', { name: 'Aufgabe hinzufügen' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Die Aufgabe war nicht anzulegen.')
    // Der eingetippte Titel bleibt stehen: Er ist nirgends gespeichert, und ein
    // geleertes Feld wäre der stille Verlust, den §5 ausschließt.
    expect(screen.getByLabelText('Neue Aufgabe')).toHaveValue('Etwas')
  })

  it('laesst einen Titel aus lauter Leerzeichen gar nicht erst abschicken', async () => {
    // `required` allein liesse ihn durch; der Dienst wiese ihn dann ab, und die
    // Meldung landete weit weg von der Zeile.
    const legeAn = vi.fn().mockResolvedValue(undefined)
    useAufgaben.mockReturnValue(aufgabendaten({ legeAn }))

    rendereMitProvidern(<Alle />)

    const hinzufuegen = screen.getByRole('button', { name: 'Aufgabe hinzufügen' })
    expect(hinzufuegen).toBeDisabled()

    await userEvent.type(screen.getByLabelText('Neue Aufgabe'), '   ')
    expect(hinzufuegen).toBeDisabled()

    await userEvent.type(screen.getByLabelText('Neue Aufgabe'), 'Etwas')
    expect(hinzufuegen).toBeEnabled()

    await userEvent.click(screen.getByRole('button', { name: /^Ändern/ }))
    await userEvent.clear(screen.getByLabelText('Titel'))
    expect(screen.getByRole('button', { name: 'Speichern' })).toBeDisabled()
  })

  it('haelt das Aenderungsformular offen, wenn das Speichern scheitert', async () => {
    const schreibe = vi.fn().mockRejectedValue(new Error('Die Aufgabe war nicht zu ändern.'))
    useAufgaben.mockReturnValue(aufgabendaten({ schreibe }))

    rendereMitProvidern(<Alle />)

    await userEvent.click(screen.getByRole('button', { name: /Ändern/ }))
    await userEvent.clear(screen.getByLabelText('Titel'))
    await userEvent.type(screen.getByLabelText('Titel'), 'Sterbeurkunde abholen')
    await userEvent.click(screen.getByRole('button', { name: 'Speichern' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('nicht zu ändern')
    expect(screen.getByLabelText('Titel')).toHaveValue('Sterbeurkunde abholen')
  })

  it('zeigt den Zaehler der uebersprungenen Eintraege nur im Dev-Modus', () => {
    // §3.7: In Produktion gibt es diesen Zähler nirgends zu sehen.
    useAufgaben.mockReturnValue(
      aufgabendaten({ zustand: { status: 'bereit', aufgaben: [], uebersprungen: 3 } }),
    )

    const { unmount } = rendereMitProvidern(<Alle />)
    expect(screen.getByText(/3 Einträge übersprungen/)).toBeVisible()
    unmount()

    vi.stubEnv('DEV', false)
    try {
      rendereMitProvidern(<Alle />)
      expect(screen.queryByText(/übersprungen/)).toBeNull()
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('meldet einen gesperrten Fall, statt eine leere Liste zu zeigen', () => {
    // Ohne `K_c` gibt es keine Aufgaben zu entschlüsseln. „Keine Aufgaben"
    // wäre an dieser Stelle eine Lüge (§3.6).
    useCase.mockReturnValue(
      falldaten({
        zustand: {
          status: 'bereit',
          faelle: [],
          aktiver: { zustand: 'gesperrt', id: 'fall-1', grund: 'Kein Schlüssel.' },
        },
      }),
    )

    rendereMitProvidern(<Alle />)

    expect(screen.getByRole('alert')).toHaveTextContent('Kein Schlüssel.')
    expect(screen.queryByLabelText('Neue Aufgabe')).toBeNull()
  })

  it('zeigt an, solange der Fall selbst noch geladen wird', () => {
    useCase.mockReturnValue(falldaten({ zustand: { status: 'laedt' } }))

    rendereMitProvidern(<Alle />)

    expect(screen.getByRole('status')).toHaveTextContent('Ihre Daten werden geladen')
    expect(screen.queryByRole('heading', { name: 'Alle Aufgaben' })).toBeNull()
  })

  it('schickt zur Startseite, wer ohne Fall hereinkommt', () => {
    // §7: Ohne Fall ist die App gesperrt, und die Fallweiche steht dort.
    useCase.mockReturnValue(falldaten({ zustand: { status: 'kein-fall' } }))

    rendereMitProvidern(<Alle />)

    expect(screen.queryByRole('heading', { name: 'Alle Aufgaben' })).toBeNull()
    expect(screen.queryByLabelText('Neue Aufgabe')).toBeNull()
  })

  it('zeigt an, solange die Aufgaben geladen werden', () => {
    useAufgaben.mockReturnValue(aufgabendaten({ zustand: { status: 'laedt' } }))

    rendereMitProvidern(<Alle />)

    expect(screen.getByRole('status')).toHaveTextContent('Ihre Aufgaben werden geladen')
  })

  it('zeigt den Grund, wenn die Aufgaben nicht abrufbar sind', () => {
    useAufgaben.mockReturnValue(
      aufgabendaten({ zustand: { status: 'fehler', nachricht: 'Kein Netz.' } }),
    )

    rendereMitProvidern(<Alle />)

    expect(screen.getByRole('alert')).toHaveTextContent('Kein Netz.')
  })

  it('fuehrt zurueck zur Startseite', () => {
    rendereMitProvidern(<Alle />)

    expect(screen.getByRole('link', { name: 'Zurück' })).toHaveAttribute('href', '/')
  })

  it('aendert genau die Aufgabe, deren Schaltflaeche gedrueckt wurde', async () => {
    const schreibe = vi.fn().mockResolvedValue(undefined)
    const zweite = aufgabe({ id: 'item-2', titel: 'Konten kündigen' })
    useAufgaben.mockReturnValue(
      aufgabendaten({
        schreibe,
        zustand: { status: 'bereit', aufgaben: [aufgabe(), zweite], uebersprungen: 0 },
      }),
    )

    rendereMitProvidern(<Alle />)

    await userEvent.click(screen.getByRole('button', { name: /^Ändern.*Konten kündigen/ }))

    // Nur eine Zeile steht im Änderungsmodus, also gibt es genau ein
    // „Speichern" — und der vorbelegte Titel verrät, welche Zeile es ist.
    expect(screen.getByLabelText('Titel')).toHaveValue('Konten kündigen')
    await userEvent.click(screen.getByRole('button', { name: 'Speichern' }))

    await waitFor(() =>
      expect(schreibe).toHaveBeenCalledWith(zweite, {
        titel: 'Konten kündigen',
        beschreibung: '',
      }),
    )
  })
})
