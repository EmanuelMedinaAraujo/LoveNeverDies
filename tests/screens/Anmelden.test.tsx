import { screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DUNKEL, HELL } from '../../src/ui/farben.ts'
import { rendereMitProvidern } from './harness.tsx'

/**
 * Anmeldung (DESIGN.md §7, Onboarding-Schritt 1).
 *
 * Clerk rendert das Formular selbst. Hier wird deshalb nur festgehalten, was
 * dieser Screen dazu beiträgt: die eigene Ansprache und die Farben aus §12.
 * Das Doppel schreibt die übergebenen `appearance`-Variablen als JSON in die
 * Seite, damit der Test sie lesen kann, ohne Clerk zu laden.
 */
const signInAufrufe: { routing?: string; withSignUp?: boolean; appearance?: unknown }[] = []

vi.mock('@clerk/react', () => ({
  SignIn: (props: { routing?: string; withSignUp?: boolean; appearance?: unknown }) => {
    signInAufrufe.push(props)
    return <div data-testid="clerk-signin">{JSON.stringify(props.appearance)}</div>
  },
}))

const useFarbschema = vi.fn<() => { schema: 'hell' | 'dunkel'; palette: typeof HELL }>()

vi.mock('../../src/hooks/useFarbschema.ts', () => ({ useFarbschema: () => useFarbschema() }))

const { Anmelden } = await import('../../src/screens/shared/Anmelden/Anmelden.tsx')

beforeEach(() => {
  signInAufrufe.length = 0
  useFarbschema.mockReturnValue({ schema: 'hell', palette: HELL })
})

describe('Anmelden', () => {
  it('nennt die App und sagt, worum es geht', () => {
    rendereMitProvidern(<Anmelden />)

    expect(screen.getByRole('heading', { name: 'LoveNeverDies' })).toBeVisible()

    /*
     * Die Marke steht als Bild darueber, in der Fassung des gewaehlten
     * Farbschemas. Ihr `alt` ist leer: Der Name steht schon als Ueberschrift
     * daneben, und eine Vorlesestimme saegte ihn sonst zweimal.
     */
    const marke = document.querySelector('img')
    expect(marke).toHaveAttribute('alt', '')
    expect(marke?.getAttribute('src')).toMatch(/^\/logo-(hell|dunkel)-256\.png$/)
    expect(screen.getByText(/nach einem Todesfall zu erledigen sind/)).toBeVisible()
  })

  it('zeigt Clerks Formular mit Registrierung im selben Screen', () => {
    /*
     * `routing="hash"` haelt Anmeldung und Registrierung in dieser einen
     * Komponente, ohne dass die App dafuer eigene Routen braucht.
     */
    rendereMitProvidern(<Anmelden />)

    expect(screen.getByTestId('clerk-signin')).toBeVisible()
    expect(signInAufrufe[0]?.routing).toBe('hash')
    expect(signInAufrufe[0]?.withSignUp).toBe(true)
  })

  it('reicht die helle Palette aus §12 an Clerk durch', () => {
    rendereMitProvidern(<Anmelden />)

    const appearance = signInAufrufe[0]?.appearance as { variables: Record<string, string> }
    expect(appearance.variables.colorPrimary).toBe(HELL.akzent)
    expect(appearance.variables.colorBackground).toBe(HELL.karte)
    expect(appearance.variables.colorForeground).toBe(HELL.text)
  })

  it('folgt dem dunklen Schema', () => {
    // Sonst stuende ein helles Anmeldeformular in einer dunklen App.
    useFarbschema.mockReturnValue({ schema: 'dunkel', palette: DUNKEL })

    rendereMitProvidern(<Anmelden />)

    const appearance = signInAufrufe[0]?.appearance as { variables: Record<string, string> }
    expect(appearance.variables.colorPrimary).toBe(DUNKEL.akzent)
    expect(appearance.variables.colorBackground).toBe(DUNKEL.karte)
  })
})
