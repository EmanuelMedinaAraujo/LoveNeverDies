import { screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DUNKEL, HELL } from '../../src/ui/farben.ts'
import { authWert, rendereMitProvidern } from './harness.tsx'

/**
 * Die Kontoeinstellungen (DESIGN.md §7, §1).
 *
 * Clerk rendert die Oberfläche selbst; hier steht, was diese App darum herum
 * tut — und vor allem, was sie darin *nicht* verspricht: Die Seite ändert die
 * Anmeldung und nicht die Schlüssel (§3.6).
 *
 * `UserProfile` ist ersetzt, wie `SignIn` in `Anmelden.test.tsx`. Was Clerk
 * zeigt, ist Clerks Sache; getestet wird, dass die App es einhängt und mit der
 * Palette aus §12 versorgt.
 */
const userProfileAufrufe: { routing?: string; appearance?: unknown }[] = []

vi.mock('@clerk/react', () => ({
  UserProfile: (props: { routing?: string; appearance?: unknown }) => {
    userProfileAufrufe.push(props)
    return <p>Clerk-Kontoansicht</p>
  },
}))

const useFarbschema = vi.fn<() => { schema: 'hell' | 'dunkel'; palette: typeof HELL }>()

vi.mock('../../src/hooks/useFarbschema.ts', () => ({ useFarbschema: () => useFarbschema() }))

const { Konto } = await import('../../src/screens/shared/Konto/Konto.tsx')

beforeEach(() => {
  userProfileAufrufe.length = 0
  useFarbschema.mockReturnValue({ schema: 'hell', palette: HELL })
})

describe('Konto', () => {
  it('haengt Clerks Kontoansicht ein', () => {
    rendereMitProvidern(<Konto />)

    expect(screen.getByText('Clerk-Kontoansicht')).toBeVisible()
    expect(screen.getByRole('heading', { name: 'Konto' })).toBeVisible()
  })

  it('sagt, dass die Aufgaben nicht am Passwort haengen (§3.6)', () => {
    /*
     * Wer sein Passwort ändert, verliert keinen Zugriff, und wer ein
     * gestohlenes hat, gewinnt keinen: `sk_u` liegt gerätegebunden im
     * Keystore. Das gehört auf die Seite, auf der jemand das Passwort ändert.
     */
    rendereMitProvidern(<Konto />)

    expect(screen.getByText(/hängen an diesem Gerät, nicht an Ihrem Passwort/)).toBeVisible()
  })

  it('haelt die Unterseiten von Clerk in dieser einen Route', () => {
    rendereMitProvidern(<Konto />)

    expect(userProfileAufrufe[0]?.routing).toBe('hash')
  })

  it('reicht die Palette der gewaehlten Darstellung durch (§12)', () => {
    // Der Override aus Profil gewinnt gegen die Systemeinstellung: Sonst stünde
    // Clerks Ansicht als einziger Teil der App in der Farbe des Systems (§7).
    useFarbschema.mockReturnValue({ schema: 'dunkel', palette: DUNKEL })

    rendereMitProvidern(<Konto />)

    expect(userProfileAufrufe[0]?.appearance).toEqual(
      expect.objectContaining({
        variables: expect.objectContaining({ colorPrimary: DUNKEL.akzent }),
      }),
    )
  })

  it('schickt weg, wer nicht angemeldet ist', () => {
    rendereMitProvidern(<Konto />, { auth: authWert({ status: 'abgemeldet' }) })

    expect(screen.queryByText('Clerk-Kontoansicht')).toBeNull()
  })

  it('traegt den Weg zurueck ins Profil', () => {
    rendereMitProvidern(<Konto />)

    expect(screen.getByRole('link', { name: 'Zurück' })).toHaveAttribute('href', '/profil')
  })
})
