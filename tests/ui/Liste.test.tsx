import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { Detailziel, Gruppe, Liste, Navizeile, Zeile } from '../../src/ui/Liste/Liste.tsx'

/**
 * Die gruppierte Liste (DESIGN.md §7).
 *
 * Die Zusagen, die hier geprüft werden, sind die, an denen der Umbau von
 * Kartenstapeln zu Listen hängt: Eine Liste ist eine `ul` mit `li` darin, damit
 * eine Vorlesestimme "Liste mit 3 Einträgen" ansagen kann; der Abschnittstitel
 * ist eine echte Überschrift; und der Weg ins Detail trägt einen eigenen Namen,
 * weil "Details" in einer Liste von zwanzig Aufgaben zwanzigmal dasselbe wäre.
 */

function inRouter(inhalt: React.ReactNode) {
  return render(<MemoryRouter>{inhalt}</MemoryRouter>)
}

describe('Liste', () => {
  it('ist eine Liste, und ihre Zeilen sind Einträge', () => {
    render(
      <Liste>
        <Zeile>eins</Zeile>
        <Zeile>zwei</Zeile>
      </Liste>,
    )

    expect(screen.getByRole('list')).toBeVisible()
    expect(screen.getAllByRole('listitem')).toHaveLength(2)
  })
})

describe('Gruppe', () => {
  it('macht aus dem Abschnittstitel eine Überschrift', () => {
    render(
      <Gruppe titel="Geräte">
        <Liste>
          <Zeile>iPhone</Zeile>
        </Liste>
      </Gruppe>,
    )

    expect(screen.getByRole('heading', { name: 'Geräte' })).toBeVisible()
  })

  it('kommt ohne Titel aus', () => {
    /*
     * "Fall verlassen" über einer Zeile "Fall verlassen" ist keine Überschrift,
     * sondern dasselbe Wort zweimal.
     */
    render(
      <Gruppe fussnote="Danach ist der Zugriff weg.">
        <Liste>
          <Zeile>Fall verlassen</Zeile>
        </Liste>
      </Gruppe>,
    )

    expect(screen.queryByRole('heading')).toBeNull()
    expect(screen.getByText('Danach ist der Zugriff weg.')).toBeVisible()
  })
})

describe('Navizeile', () => {
  it('macht die ganze Zeile zum Weg', () => {
    inRouter(
      <Liste>
        <Navizeile titel="Angehörige einladen" ziel="/koppeln" />
      </Liste>,
    )

    expect(screen.getByRole('link', { name: 'Angehörige einladen' })).toHaveAttribute(
      'href',
      '/koppeln',
    )
  })
})

describe('Detailziel', () => {
  it('nennt die Aufgabe, in die es führt', () => {
    // Ohne den Titel hörte eine blinde Person in einer Liste von zwanzig
    // Aufgaben zwanzigmal "Details" und wüsste nie, welche gemeint ist (§7).
    inRouter(<Detailziel ziel="/aufgabe/abc" titel="Sterbeurkunde beantragen" />)

    expect(
      screen.getByRole('link', { name: 'Details: „Sterbeurkunde beantragen“' }),
    ).toHaveAttribute('href', '/aufgabe/abc')
  })
})
