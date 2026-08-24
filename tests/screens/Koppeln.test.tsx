import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { LesbarerFall } from '../../src/services/fallService.ts'
import type { Kopplungsanfrage } from '../../src/services/kopplungService.ts'
import { rendereMitProvidern } from './harness.tsx'

/**
 * Die einladende Seite (DESIGN.md §6, Schritt 4 bis 6).
 *
 * Der Test hält vor allem eines fest: Zwischen Eingabe und Bestätigung steht
 * der Prüfcode, und die Bestätigung ist ein eigener Schritt. Ein Formular, das
 * beides in einem Zug erledigte, hätte für den mündlichen Abgleich keine
 * Stelle, und der ist der einzige Schutz gegen einen bösartigen Server (§3.6).
 */

const useEinloesung = vi.fn()
const einloesen = vi.fn()
const bestaetigen = vi.fn()
const abbrechen = vi.fn()

vi.mock('../../src/hooks/useKopplung.ts', () => ({
  useEinloesung: () => useEinloesung(),
}))

const { Koppeln } = await import('../../src/screens/shared/Koppeln/Koppeln.tsx')

function fall(id: string, personName: string): LesbarerFall {
  return {
    zustand: 'lesbar',
    id,
    status: 'trauerfall',
    personName,
    sterbedatum: '2026-05-12',
    kid: `case_${id}:1`,
    keyGeneration: 1,
    rotationPending: false,
    katalogVersion: '2026-08+testtest',
    kc: new Uint8Array([1]),
    kcat: new Uint8Array([2]),
    kv: null,
    preparerId: null,
    vaultCommitment: null,
    vaultResplitPending: false,
    vaultK: null,
    vaultN: null,
  }
}

const ANFRAGE: Kopplungsanfrage = {
  code: 'K4M7QP2X',
  pruefcode: '481253',
  angebot: {
    zweck: 'join',
    userId: 'user_anna',
    anzeigename: 'Anna Müller',
    email: 'anna@example.de',
    geraeteId: 'geraet-2',
    pkKem: new Uint8Array([1]),
    pkSig: new Uint8Array([2]),
  },
}

function daten(
  zustand: unknown,
  lesbareFaelle: LesbarerFall[] = [fall('fall-1', 'Hans Weber')],
  ueberschreibung: { laeuft?: boolean; faelleBereit?: boolean } = {},
) {
  return {
    zustand,
    laeuft: false,
    faelleBereit: true,
    lesbareFaelle,
    einloesen,
    bestaetigen,
    abbrechen,
    ...ueberschreibung,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  useEinloesung.mockReturnValue(daten({ status: 'leer', fehler: null }))
})

describe('Koppeln: Code eingeben (§6, Schritt 4)', () => {
  it('nimmt den Code entgegen, wie er am Telefon genannt wurde', async () => {
    rendereMitProvidern(<Koppeln />)

    await userEvent.type(screen.getByLabelText('Kopplungscode'), 'k4m7-qp2x')
    await userEvent.click(screen.getByRole('button', { name: 'Weiter' }))

    expect(einloesen).toHaveBeenCalledWith('k4m7-qp2x')
  })

  it('nennt den Grund, wenn der Code nicht durchging', () => {
    useEinloesung.mockReturnValue(
      daten({ status: 'leer', fehler: 'Dieser Kopplungscode ist abgelaufen.' }),
    )

    rendereMitProvidern(<Koppeln />)

    expect(screen.getByRole('alert')).toHaveTextContent('abgelaufen')
  })
})

describe('Koppeln: bestätigen (§6, Schritt 5 und 6)', () => {
  beforeEach(() => {
    useEinloesung.mockReturnValue(daten({ status: 'angebot', anfrage: ANFRAGE, fehler: null }))
  })

  it('zeigt Name, E-Mail und Prüfcode, bevor irgendetwas übergeben wird', () => {
    rendereMitProvidern(<Koppeln />)

    expect(screen.getByText('Anna Müller')).toBeVisible()
    expect(screen.getByText('anna@example.de')).toBeVisible()
    expect(screen.getByText('481 253')).toBeVisible()
    // Zum Vorlesen die Ziffern einzeln: Verglichen werden Ziffern.
    expect(screen.getByText('4 8 1 2 5 3')).toBeInTheDocument()
    expect(bestaetigen).not.toHaveBeenCalled()
  })

  it('benennt die Bestätigung nach dem, was sie bestätigt', () => {
    rendereMitProvidern(<Koppeln />)

    expect(
      screen.getByRole('button', { name: 'Prüfcode stimmt überein — bestätigen' }),
    ).toBeEnabled()
  })

  it('übergibt den Fall, den die einladende Person gewählt hat', async () => {
    useEinloesung.mockReturnValue(
      daten({ status: 'angebot', anfrage: ANFRAGE, fehler: null }, [
        fall('fall-1', 'Hans Weber'),
        fall('fall-2', 'Erika Weber'),
      ]),
    )

    rendereMitProvidern(<Koppeln />)

    await userEvent.selectOptions(screen.getByLabelText('Fall'), 'fall-2')
    await userEvent.click(screen.getByRole('button', { name: /bestätigen/ }))

    expect(bestaetigen).toHaveBeenCalledWith('fall-2')
  })

  it('fragt bei einem einzigen Fall nicht nach', () => {
    rendereMitProvidern(<Koppeln />)

    expect(screen.queryByLabelText('Fall')).toBeNull()
  })

  it('sagt es, wenn dieses Gerät gar nichts weiterzugeben hat', () => {
    useEinloesung.mockReturnValue(daten({ status: 'angebot', anfrage: ANFRAGE, fehler: null }, []))

    rendereMitProvidern(<Koppeln />)

    expect(screen.getByRole('alert')).toHaveTextContent('nur teilen, was Sie selbst lesen können')
    expect(screen.getByRole('button', { name: /bestätigen/ })).toBeDisabled()
  })

  it('lässt niemanden bestätigen, solange die Fallliste noch lädt', () => {
    /*
     * Der Code ist zu diesem Zeitpunkt eingelöst. Ein Klick auf eine Liste, die
     * es noch nicht gibt, verbrennte ihn: bei `device` sogar mit einer Meldung,
     * die wie ein Erfolg aussieht.
     */
    useEinloesung.mockReturnValue(
      daten({ status: 'angebot', anfrage: ANFRAGE, fehler: null }, [], { faelleBereit: false }),
    )

    rendereMitProvidern(<Koppeln />)

    expect(screen.getByRole('button', { name: /bestätigen/ })).toBeDisabled()
    // Und keine Behauptung darüber, was dieses Gerät weitergeben kann: Das
    // weiss noch niemand.
    expect(screen.queryByText(/nur teilen, was Sie selbst lesen können/)).toBeNull()
  })

  it('lässt das Angebot stehen, wenn das Bestätigen scheitert', () => {
    useEinloesung.mockReturnValue(
      daten({ status: 'angebot', anfrage: ANFRAGE, fehler: 'Kein Netz.' }),
    )

    rendereMitProvidern(<Koppeln />)

    expect(screen.getByText('Anna Müller')).toBeVisible()
    expect(screen.getByRole('alert')).toHaveTextContent('Kein Netz.')
    expect(screen.getByRole('button', { name: /bestätigen/ })).toBeEnabled()
  })

  it('lässt abbrechen, wenn der Prüfcode nicht stimmt', async () => {
    rendereMitProvidern(<Koppeln />)

    await userEvent.click(screen.getByRole('button', { name: 'Abbrechen' }))

    expect(abbrechen).toHaveBeenCalled()
  })

  it('benennt bei einem device-Code die Grenze der Freigabe', () => {
    useEinloesung.mockReturnValue(
      daten({
        status: 'angebot',
        anfrage: { ...ANFRAGE, angebot: { ...ANFRAGE.angebot, zweck: 'device' } },
        fehler: null,
      }),
    )

    rendereMitProvidern(<Koppeln />)

    expect(screen.getByRole('heading', { name: 'Gerät freischalten?' })).toBeVisible()
    expect(screen.getByText(/bleiben es auch dort/)).toBeVisible()
    // Kein Fallwähler: Ein zweites Gerät bekommt alles, was dieses lesen kann.
    expect(screen.queryByLabelText('Fall')).toBeNull()
  })
})

describe('Koppeln: fertig (§4)', () => {
  it('benennt die Zahl der freigeschalteten Fälle', () => {
    useEinloesung.mockReturnValue(
      daten({ status: 'fertig', nachricht: '2 von 3 Fällen freigeschaltet' }),
    )

    rendereMitProvidern(<Koppeln />)

    expect(screen.getByRole('status')).toHaveTextContent('2 von 3 Fällen freigeschaltet')
  })
})
