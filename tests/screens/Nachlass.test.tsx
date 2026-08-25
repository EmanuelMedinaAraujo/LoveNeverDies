import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { FallZustand } from '../../src/hooks/useCase.ts'
import { Nachlass } from '../../src/screens/shared/Nachlass/Nachlass.tsx'
import type { Nachlasseintrag } from '../../src/services/aufgabenService.ts'
import type { LesbarerFall } from '../../src/services/fallService.ts'
import { rendereMitProvidern } from './harness.tsx'

/**
 * Der geöffnete Nachlass-Tresor (DESIGN.md §3.5, §7).
 *
 * Der Screen, den es vorher nicht gab: Was die vorsorgende Person hinterlegt
 * hat, war nach dem Öffnen nirgends zu sehen. Geprüft wird, dass er es zeigt,
 * dass er es zugeklappt zeigt, und dass er nichts anbietet, womit sich etwas
 * davon ändern oder löschen ließe.
 */

let mockFallZustand: FallZustand
let mockNachlass: Nachlasseintrag[]
let mockAufgabenZustand: { status: 'laedt' } | { status: 'bereit'; laedtNetz: boolean }

vi.mock('../../src/hooks/useCase.ts', () => ({
  useCase: () => ({
    zustand: mockFallZustand,
    loescheVorsorgefall: vi.fn(),
    legeVorsorgefallAn: vi.fn(),
    legeTrauerfallAn: vi.fn(),
    verlasseFall: vi.fn(),
    aktualisiere: vi.fn(),
  }),
}))

vi.mock('../../src/hooks/useAufgaben.ts', () => ({
  useAufgaben: () => ({
    zustand:
      mockAufgabenZustand.status === 'laedt'
        ? { status: 'laedt' }
        : {
            status: 'bereit',
            laedtNetz: mockAufgabenZustand.laedtNetz,
            netzfehler: null,
            aufgaben: [],
            baum: [],
            uebersprungen: 0,
          },
    nachlass: mockNachlass,
    zeilen: [],
    mutiere: vi.fn(),
    aktualisiere: vi.fn(),
    bestaetige: vi.fn(),
  }),
}))

function fall(ueberschreibung: Partial<LesbarerFall> = {}): LesbarerFall {
  return {
    zustand: 'lesbar',
    id: 'fall-1',
    personName: 'Karl Müller',
    sterbedatum: '2026-03-15',
    status: 'trauerfall',
    kid: 'case_fall-1:1',
    kc: new Uint8Array([1]),
    kcat: new Uint8Array([2]),
    katalogVersion: '2026-08+test',
    rotationPending: false,
    preparerId: 'user_2',
    kv: null,
    vaultCommitment: null,
    vaultK: null,
    ...ueberschreibung,
  } as LesbarerFall
}

function zeige(
  eintraege: Nachlasseintrag[] = [],
  fallUeber: Partial<LesbarerFall> = {},
  laedtNetz = false,
) {
  const einer = fall(fallUeber)

  mockFallZustand = { status: 'bereit', faelle: [einer], aktiver: einer }
  mockNachlass = eintraege
  mockAufgabenZustand = { status: 'bereit', laedtNetz }

  return rendereMitProvidern(<Nachlass />)
}

const EINTRAG: Nachlasseintrag = {
  id: '0192-a',
  titel: 'Zugang Sparkasse',
  inhalt: 'Kennwort liegt im Umschlag\nim Schreibtisch.',
  geaendertAm: '2026-03-16T10:00:00.000Z',
}

beforeEach(() => {
  mockNachlass = []
  mockAufgabenZustand = { status: 'bereit', laedtNetz: false }
})

describe('Nachlass-Tresor (§3.5)', () => {
  it('nennt die verstorbene Person und den Weg zurück', () => {
    zeige([EINTRAG])

    expect(screen.getByRole('heading', { level: 1, name: 'Nachlass-Tresor' })).toBeVisible()
    expect(screen.getByRole('link', { name: 'Zurück' })).toHaveAttribute('href', '/erbe')
  })

  it('zeigt die Einträge zugeklappt: Titel ja, Inhalt erst auf Tippen', async () => {
    /*
     * Ein Zugang stünde sonst offen auf einem Bildschirm, den jemand am
     * Küchentisch weiterreicht. Kein Schutz — wer den Fall lesen darf, liest
     * alles —, aber der Unterschied zwischen "nachsehen" und "danebenliegen".
     */
    zeige([EINTRAG])

    expect(screen.getByText('Zugang Sparkasse')).toBeVisible()
    expect(screen.queryByText(/Kennwort liegt im Umschlag/)).not.toBeVisible()

    await userEvent.click(screen.getByText('Zugang Sparkasse'))

    expect(screen.getByText(/Kennwort liegt im Umschlag/)).toBeVisible()
  })

  it('bietet nichts an, womit sich ein Eintrag ändern oder löschen ließe', () => {
    /*
     * Eine hinterlegte Notiz ist keine Aufgabe, die jemand abhakt, und ein
     * Löschen wäre hier endgültig (§5): die letzte Nachricht einer verstorbenen
     * Person, einen Fehltipp von der Auslöschung entfernt.
     */
    zeige([EINTRAG])

    expect(screen.queryByRole('checkbox')).toBeNull()
    expect(screen.queryByRole('button', { name: /Löschen/ })).toBeNull()
    expect(screen.queryByRole('textbox')).toBeNull()
  })

  it('sagt es, wenn nichts hinterlegt wurde', () => {
    zeige([])

    expect(screen.getByText('Karl Müller hat nichts im Tresor hinterlegt.')).toBeVisible()
  })

  it('unterscheidet den leeren Tresor vom noch ladenden (§5)', () => {
    // Ein leerer Cache und ein laufender erster Abruf sind nicht dasselbe wie
    // "da liegt nichts". Solange der Abruf laeuft, sagt der Screen das.
    zeige([], {}, true)

    expect(screen.queryByText(/hat nichts im Tresor hinterlegt/)).toBeNull()
    expect(screen.getByText('Der Tresor wird geöffnet…')).toBeVisible()
  })

  it('schickt in den Tab Erbe zurück, solange der Fall in der Vorsorge steht', () => {
    // §3.5: Dort liegen die Einträge unter `K_v`. Es gäbe nichts zu zeigen,
    // und der Freigabestand steht im Tab Erbe.
    zeige([], { status: 'vorsorge', sterbedatum: null })

    expect(screen.queryByRole('heading', { level: 1, name: 'Nachlass-Tresor' })).toBeNull()
  })
})
