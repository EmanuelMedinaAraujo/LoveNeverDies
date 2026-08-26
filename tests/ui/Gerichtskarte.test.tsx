import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Gerichtskarte } from '../../src/ui/Gerichtskarte/Gerichtskarte.tsx'
import type { Nachlassgericht } from '../../src/types/gericht.ts'

describe('Gerichtskarte', () => {
  const beispielGericht: Nachlassgericht = {
    id: 1,
    name: 'Amtsgericht Heilbronn',
    lieferanschrift: 'Knorrstr. 1, 74074 Heilbronn',
    postanschrift: '74064 Heilbronn',
    telefon: '07131 64-1',
    fax: '07131 64-34000',
    internet: 'https://amtsgericht-heilbronn.justiz-bw.de',
    email: 'poststelle@agheilbronn.justiz.bwl.de',
  }

  it('rendert alle vorhandenen Kontaktdaten sauber', () => {
    render(<Gerichtskarte gericht={beispielGericht} />)

    expect(screen.getByRole('heading', { name: 'Amtsgericht Heilbronn' })).toBeVisible()
    expect(screen.getByText('Knorrstr. 1, 74074 Heilbronn')).toBeVisible()
    expect(screen.getByText('74064 Heilbronn')).toBeVisible()
    expect(screen.getByText('07131 64-34000')).toBeVisible()

    const telLink = screen.getByRole('link', { name: '07131 64-1' })
    expect(telLink).toHaveAttribute('href', 'tel:0713164-1')

    const mailLink = screen.getByRole('link', { name: 'poststelle@agheilbronn.justiz.bwl.de' })
    expect(mailLink).toHaveAttribute('href', 'mailto:poststelle@agheilbronn.justiz.bwl.de')

    const webLink = screen.getByRole('link', { name: 'https://amtsgericht-heilbronn.justiz-bw.de' })
    expect(webLink).toHaveAttribute('href', 'https://amtsgericht-heilbronn.justiz-bw.de')
    expect(webLink).toHaveAttribute('target', '_blank')
    expect(webLink).toHaveAttribute('rel', 'noreferrer')
  })

  it('lässt optionale Felder aus, wenn sie null sind', () => {
    const minGericht: Nachlassgericht = {
      id: 2,
      name: 'Amtsgericht Musterstadt',
      lieferanschrift: null,
      postanschrift: null,
      telefon: null,
      fax: null,
      internet: null,
      email: null,
    }

    render(<Gerichtskarte gericht={minGericht} />)
    expect(screen.getByRole('heading', { name: 'Amtsgericht Musterstadt' })).toBeVisible()
    expect(screen.queryByText('Lieferanschrift:')).toBeNull()
    expect(screen.queryByText('Telefon:')).toBeNull()
  })
})
