import { render, type RenderResult } from '@testing-library/react'
import type { ReactElement, ReactNode } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { vi } from 'vitest'
import {
  AuthKontextProvider,
  type AuthKontextWert,
  type AuthZustand,
} from '../../src/core/auth/authProvider.ts'
import type { Geraet } from '../../src/services/geraeteService.ts'

/**
 * Die Provider, die jeder Screen um sich herum erwartet (DESIGN.md §9).
 *
 * Was hier nicht steht, ist Absicht: kein echter Supabase-Client und kein
 * Clerk. Die Screens sprechen ausschließlich über die Hooks mit beidem, und
 * die Hooks werden in den einzelnen Tests ersetzt. So prüfen die Screentests,
 * was ein Screen aus einem Zustand macht, nicht, ob Supabase antwortet.
 */

export const BENUTZER = { id: 'user_1', anzeigename: 'Anna Müller', email: 'anna@example.de' }

export const ANGEMELDET: AuthZustand = { status: 'angemeldet', benutzer: BENUTZER }

export function authWert(zustand: AuthZustand = ANGEMELDET): AuthKontextWert {
  return {
    zustand,
    abmelden: vi.fn().mockResolvedValue(undefined),
    zugangstoken: vi.fn().mockResolvedValue('token'),
  }
}

export function Huelle({
  children,
  auth = authWert(),
  pfad = '/',
}: {
  children: ReactNode
  auth?: AuthKontextWert
  pfad?: string
}) {
  return (
    <AuthKontextProvider value={auth}>
      <MemoryRouter initialEntries={[pfad]}>{children}</MemoryRouter>
    </AuthKontextProvider>
  )
}

export function rendereMitProvidern(
  element: ReactElement,
  optionen: { auth?: AuthKontextWert; pfad?: string } = {},
): RenderResult {
  return render(
    <Huelle auth={optionen.auth} pfad={optionen.pfad}>
      {element}
    </Huelle>,
  )
}

/** Ein Gerät, wie `geraeteService` es liefert. */
export function geraet(ueberschreibung: Partial<Geraet> = {}): Geraet {
  return {
    id: 'geraet-1',
    label: 'iPhone von Anna',
    pruefcode: '481253',
    angelegtAm: '2026-08-23T10:00:00Z',
    diesesGeraet: true,
    ...ueberschreibung,
  }
}
