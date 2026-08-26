import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Aufgabendaten } from '../../../src/hooks/useAufgaben.ts'
import type { Falldaten } from '../../../src/hooks/useCase.ts'
import type { Aufgabe as Aufgabendatensatz } from '../../../src/services/aufgabenService.ts'
import { NIEMAND, personen } from '../../../src/services/zuweisung.ts'
import { rendereMitProvidern } from '../harness.tsx'
import { BAUPLAENE } from '../../../src/services/fragebaumService.ts'
import {
  BERT,
  ICH,
  LESBAR,
  aufgabe,
  aufgabendaten,
  falldaten,
  herkunft,
  mitAufgaben,
} from './fixtures.tsx'

const useCase = vi.fn<() => Falldaten>()
const useAufgaben = vi.fn<() => Aufgabendaten>()

vi.mock('../../../src/hooks/useCase.ts', () => ({ useCase: () => useCase() }))
vi.mock('../../../src/hooks/useAufgaben.ts', () => ({ useAufgaben: () => useAufgaben() }))

/*
 * Die Dokumente hängen an Storage und an `items` (§7) und haben ihren eigenen
 * Screentest daneben. Hier steht die Attrappe, damit das Aufgabendetail ohne
 * Supabase-Provider rendert.
 */
vi.mock('../../../src/hooks/useDokumente.ts', () => ({
  useDokumente: () => ({
    dokumente: [],
    uebersprungen: 0,
    online: true,
    nimmAuf: vi.fn(),
    oeffne: vi.fn(),
    loesche: vi.fn(),
  }),
}))

const { Aufgabe } = await import('../../../src/screens/einfach/Aufgabe/Aufgabe.tsx')

/**
 * Das Aufgabendetail in der einfachen Ansicht (DESIGN.md §7, §8).
 *
 * Geprüft wird, was diese Fassung anders macht: keine verschachtelte
 * Navigation, Verben statt Substantive, eine Rückfrage vor jeder Handlung, die
 * sich nicht zurücknehmen lässt. Dass die Rechtsgrundlage aus dem Item kommt
 * und nicht aus dem heutigen Katalog, steht im Test der erweiterten Fassung.
 */

/** Der Screen unter seiner echten Route, sonst gibt `useParams` keine ID her. */
function zeigeDetail(id = 'item-1') {
  return rendereMitProvidern(
    <Routes>
      <Route path="/aufgabe/:id" element={<Aufgabe />} />
      <Route path="/alle" element={<p>Alle Aufgaben</p>} />
    </Routes>,
    { pfad: `/aufgabe/${id}` },
  )
}

function mitDetail(aufgaben: Aufgabendatensatz[], rest: Partial<Aufgabendaten> = {}) {
  const daten = mitAufgaben(useAufgaben, aufgaben, rest)

  zeigeDetail()

  return daten
}

beforeEach(() => {
  vi.clearAllMocks()
  useCase.mockReturnValue(falldaten())
  useAufgaben.mockReturnValue(aufgabendaten())
})

describe('Aufgabe (einfach)', () => {
  it('trägt den Titel als Überschrift und oben links den Weg zurück', () => {
    mitDetail([aufgabe({ titel: 'Sterbefall anzeigen', katalog: herkunft() })])

    expect(screen.getByRole('heading', { level: 1, name: 'Sterbefall anzeigen' })).toBeVisible()
    expect(screen.getByRole('link', { name: 'Zurück' })).toHaveAttribute('href', '/alle')
  })

  it('zeigt weder Rechtsgrundlage noch Quelle (ADR-0003)', () => {
    mitDetail([aufgabe({ katalog: herkunft() })])

    expect(screen.getByText('Standesamt des Sterbeortes')).toBeVisible()
    expect(screen.queryByText(/§/)).toBeNull()
    expect(screen.queryByText('Rechtsgrundlage')).toBeNull()
    expect(screen.queryByRole('link', { name: /gesetze-im-internet/ })).toBeNull()
  })

  it('zeigt Nachlassgerichtssuche ausgeklappt und persistiert gefundene Gerichte in den Notizen', async () => {
    const daten = mitDetail([
      aufgabe({
        katalog: herkunft({
          zustaendigeStelle: 'Nachlassgericht (Amtsgericht)',
        }),
      }),
    ])

    const eingabe = screen.getByPlaceholderText(/PLZ z\. B\./i)
    expect(eingabe).toBeVisible()

    await userEvent.type(eingabe, '74199')

    expect(screen.getByRole('heading', { name: 'Amtsgericht Heilbronn' })).toBeVisible()
    expect(daten.schreibe).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'item-1' }),
      expect.objectContaining({
        notizen: expect.stringContaining('Amtsgericht Heilbronn'),
      }),
    )
  })

  it('zeigt bei einer unverzüglichen Frist den Fristtext und die Gerichtsermittlung', () => {
    mitDetail([
      aufgabe({
        katalog: herkunft({
          fristTage: null,
          fristAb: 'unverzueglich',
          zustaendigeStelle: 'Nachlassgericht (Amtsgericht)',
        }),
      }),
    ])

    expect(screen.getByText('Frist: unverzüglich')).toBeVisible()
    expect(screen.getByText('unverzüglich (ohne schuldhaftes Zögern)')).toBeVisible()
    expect(screen.getByText('Nachlassgericht (Amtsgericht)')).toBeVisible()
  })

  it('hat kein eigenes Häkchen: abgehakt wird in der Liste', () => {
    mitDetail([aufgabe({ katalog: herkunft() })])

    expect(screen.queryByRole('checkbox', { name: 'Diese Aufgabe ist erledigt' })).toBeNull()
    expect(screen.getByText('Offen. Abhaken können Sie sie in der Liste.')).toBeVisible()
  })

  it('zeigt bei Erbschein die neuen Verfahrensinformationen und einklappbaren Hintergrundtexte', () => {
    mitDetail([
      aufgabe({
        titel: BAUPLAENE.erbschein.titel,
        beschreibung: BAUPLAENE.erbschein.beschreibung,
        katalog: BAUPLAENE.erbschein.katalog,
      }),
    ])

    expect(screen.getByText('Wie beantragen Sie einen Erbschein?')).toBeVisible()
    expect(screen.getByText('Beim Notar oder beim Nachlassgericht')).toBeVisible()
    expect(
      screen.getByText(
        'Anrufen oder online Termin vereinbaren - die Stellen erklären Ihnen die weiteren Schritte',
      ),
    ).toBeVisible()
    expect(screen.getByText('Notar oder Nachlassgericht:')).toBeVisible()
    expect(
      screen.getByText(/Sie erhalten schneller und innerhalb der Frist einen Termin/),
    ).toBeVisible()
    expect(screen.getByText(/Ihnen fallen keine zusätzlichen Kosten an/)).toBeVisible()

    expect(screen.getByText('1. Was ist ein Erbschein?')).toBeVisible()
    expect(screen.getByText('2. Wofür wird er gebraucht?')).toBeVisible()
    expect(screen.getByText('3. Nicht nötig wenn:')).toBeVisible()
    expect(screen.getByText('4. Kosten')).toBeVisible()
  })

  it('zeigt bei Testamentsanfechtung die neuen Verfahrensinformationen und einklappbaren Abschnitte', () => {
    mitDetail([
      aufgabe({
        titel: BAUPLAENE.anfechtung.titel,
        beschreibung: BAUPLAENE.anfechtung.beschreibung,
        katalog: BAUPLAENE.anfechtung.katalog,
      }),
    ])

    // Einklappbare Abschnitte für Testamentsanfechtung (1 bis 6, ohne "Wie fechte ich...")
    expect(screen.getByText('1. Was ist das?')).toBeVisible()
    expect(screen.getByText('2. Wer darf anfechten?')).toBeVisible()
    expect(screen.getByText('3. Welche Gründe rechtfertigen eine Anfechtung?')).toBeVisible()
    expect(screen.getByText('4. Folge der Anfechtung')).toBeVisible()
    expect(screen.getByText('5. Frist')).toBeVisible()
    expect(screen.getByText('6. Kosten')).toBeVisible()
    expect(screen.queryByText('5. Wie fechte ich ein Testament an?')).toBeNull()

    // Zuständige Stelle Abschnitt
    expect(screen.getByRole('heading', { name: 'Zuständige Stelle' })).toBeVisible()
    expect(screen.queryByRole('heading', { name: 'Das gilt dafür' })).toBeNull()

    expect(screen.getByText('Wie fechte ich ein Testament an?')).toBeVisible()
    expect(screen.getByText('Es gibt zwei Möglichkeiten:')).toBeVisible()
    expect(screen.getByText('schriftlicher Antrag an das Nachlassgericht')).toBeInTheDocument()
    expect(screen.getByText('persönlich beim Nachlassgericht')).toBeInTheDocument()
    expect(
      screen.getByText(
        /Hinweis: Bei persönlichem Erscheinen vereinbaren Sie vorher einen Termin beim Nachlassgericht./,
      ),
    ).toBeInTheDocument()
  })

  it('zeigt bei Ausschlagung die neuen einheitlichen Schritte und einklappbaren Abschnitte', () => {
    mitDetail([
      aufgabe({
        titel: BAUPLAENE.ausschlagung.titel,
        beschreibung: BAUPLAENE.ausschlagung.beschreibung,
        katalog: BAUPLAENE.ausschlagung.katalog,
      }),
    ])

    // Einklappbare Abschnitte
    expect(screen.getByText('1. Frist')).toBeVisible()
    expect(screen.getByText('2. Wie können Sie das Erbe ablehnen?')).toBeVisible()
    expect(
      screen.getByText(/Gibt es ein Testament, läuft die Frist erst los/),
    ).toBeInTheDocument()

    expect(screen.getByText('Termin bei einem Notar vereinbaren')).toBeInTheDocument()
    expect(screen.getByText('Antrag auf Ausschlagung stellen')).toBeInTheDocument()
    expect(
      screen.getByText('Notar beurkundet den Antrag und schickt ihn an das Nachlassgericht'),
    ).toBeInTheDocument()
    expect(
      screen.getByText('telefonisch Termin beim Nachlassgericht vereinbaren'),
    ).toBeInTheDocument()
    expect(screen.getByText('persönlich beim Nachlassgericht erscheinen')).toBeInTheDocument()
    expect(
      screen.getByText(/Beim Notar erhalten Sie schneller und sicher innerhalb der Frist einen Termin/),
    ).toBeInTheDocument()
    expect(screen.getByText(/Beim Nachlassgericht fallen Ihnen keine zusätzlichen Kosten an/)).toBeInTheDocument()

    // Zuständige Stelle Abschnitt
    expect(screen.getByRole('heading', { name: 'Zuständige Stelle' })).toBeVisible()
    expect(screen.queryByRole('heading', { name: 'Das gilt dafür' })).toBeNull()

    // Hinweis mit rotem und fettem "Hinweis:"
    const hinweisLabel = screen.getByText('Hinweis:')
    expect(hinweisLabel.tagName).toBe('STRONG')
    expect(hinweisLabel).toHaveClass(/rot/)
  })

  it('übernimmt die Aufgabe mit einem Verb (§7)', async () => {
    const daten = mitDetail([aufgabe({ assignee: NIEMAND, katalog: herkunft() })])

    await userEvent.click(screen.getByRole('button', { name: 'Ich übernehme das' }))

    expect(daten.weiseZu).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'item-1' }),
      personen([ICH]),
    )
  })

  it('gibt eine Aufgabe wieder frei, auch eine fremde (§7)', async () => {
    // "Eine Reservierung ist von jedem wieder lösbar, nicht nur von der
    // reservierenden Person."
    const daten = mitDetail([aufgabe({ assignee: personen([BERT]), katalog: herkunft() })])

    await userEvent.click(screen.getByRole('button', { name: 'Freigeben' }))

    expect(daten.weiseZu).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'item-1' }),
      NIEMAND,
    )
  })

  it('bietet keine Namensliste an (§7)', () => {
    // Die Zuweisung an andere ist die erweiterte Fassung. Hier nimmt man sich
    // eine Aufgabe oder gibt sie ab.
    mitDetail([aufgabe({ katalog: herkunft() })])

    expect(screen.queryByRole('checkbox', { name: 'Allen' })).toBeNull()
    expect(screen.queryByRole('checkbox', { name: 'Bert Müller' })).toBeNull()
  })

  it('fragt vor dem Löschen und geht danach zurück in die Liste (§5, §7)', async () => {
    const daten = mitDetail([aufgabe({ titel: 'Konten kündigen', katalog: herkunft() })])

    await userEvent.click(screen.getByRole('button', { name: 'Diese Aufgabe löschen' }))
    expect(daten.loesche).not.toHaveBeenCalled()
    expect(screen.getByText(/wirklich löschen/)).toBeVisible()

    await userEvent.click(screen.getByRole('button', { name: 'Ja, löschen' }))

    expect(daten.loesche).toHaveBeenCalledWith(expect.objectContaining({ id: 'item-1' }))
    expect(await screen.findByText('Alle Aufgaben')).toBeVisible()
  })

  it('nimmt eine Rückfrage auch wieder zurück', async () => {
    const daten = mitDetail([aufgabe({ katalog: herkunft() })])

    await userEvent.click(screen.getByRole('button', { name: 'Diese Aufgabe löschen' }))
    await userEvent.click(screen.getByRole('button', { name: 'Abbrechen' }))

    expect(daten.loesche).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Diese Aufgabe löschen' })).toBeVisible()
  })

  it('hakt Schritte einzeln ab und verlinkt sie nicht weiter (§7)', async () => {
    /*
     * "verzichtet auf verschachtelte Navigation": Die erweiterte Ansicht führt
     * von jeder Unteraufgabe in ihr eigenes Detail. Hier wird sie an Ort und
     * Stelle abgehakt.
     */
    const daten = mitDetail([
      aufgabe({ id: 'item-1', titel: 'Sterbefall anzeigen', katalog: herkunft() }),
      aufgabe({ id: 'item-2', titel: 'Urkunden bestellen', parentId: 'item-1', katalog: null }),
    ])

    expect(screen.queryByRole('link', { name: /Zuständigkeit ändern/ })).toBeNull()

    await userEvent.click(screen.getByRole('checkbox', { name: 'Urkunden bestellen' }))

    expect(daten.hakeAb).toHaveBeenCalledWith(expect.objectContaining({ id: 'item-2' }), true)
  })

  it('fragt vor dem Löschen eines Schrittes (§7)', async () => {
    const daten = mitDetail([
      aufgabe({ id: 'item-1', katalog: herkunft() }),
      aufgabe({ id: 'item-2', titel: 'Urkunden bestellen', parentId: 'item-1', katalog: null }),
    ])

    await userEvent.click(screen.getByRole('button', { name: /Löschen: „Urkunden bestellen“/ }))
    expect(daten.loesche).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole('button', { name: 'Ja, löschen' }))

    expect(daten.loesche).toHaveBeenCalledWith(expect.objectContaining({ id: 'item-2' }))
  })

  it('gibt eine private Aufgabe nach Rückfrage für alle frei (§3.7)', async () => {
    /*
     * §7: "genau eine Aktion 'Für alle sichtbar machen'". Einen Weg zurück
     * gibt es nicht, und das gehört vor die Aktion gesagt.
     */
    const daten = mitDetail([
      aufgabe({ titel: 'Erbausschlagung erwägen', privat: true, katalog: null }),
    ])

    expect(screen.getByText('Nur für mich')).toBeVisible()

    await userEvent.click(screen.getByRole('button', { name: 'Für alle sichtbar machen' }))
    expect(daten.gibFuerAlleFrei).not.toHaveBeenCalled()
    expect(screen.getByText(/lässt sich nicht zurücknehmen/)).toBeVisible()

    await userEvent.click(screen.getByRole('button', { name: 'Ja, für alle sichtbar machen' }))

    expect(daten.gibFuerAlleFrei).toHaveBeenCalledWith(expect.objectContaining({ id: 'item-1' }))
  })

  it('nimmt das eigene Kenntnisdatum entgegen (§8)', async () => {
    /*
     * Die Ausschlagungsfrist nach § 1944 BGB hängt an der Kenntnis der
     * jeweiligen Person — der Fall, für den diese Ansicht gebaut ist.
     */
    const setzeKenntnisAm = vi.fn().mockResolvedValue(undefined)

    mitDetail(
      [aufgabe({ katalog: herkunft({ fristTage: 42, fristAb: 'kenntnis' }) })],
      { fristbezug: { sterbedatum: LESBAR.sterbedatum, kenntnisAm: null, anfechtungKenntnisAm: null }, setzeKenntnisAm },
    )

    const feld = screen.getByLabelText('Tag Ihrer Kenntnis')
    await userEvent.type(feld, '2024-03-20')
    await userEvent.click(screen.getByRole('button', { name: 'Datum speichern' }))

    expect(setzeKenntnisAm).toHaveBeenCalledWith('2024-03-20')
  })

  it('speichert Notizen', async () => {
    const daten = mitDetail([aufgabe({ katalog: herkunft() })])

    await userEvent.type(screen.getByLabelText('Was Sie sich merken möchten'), 'Termin am Montag')
    await userEvent.click(screen.getByRole('button', { name: 'Notizen speichern' }))

    expect(daten.schreibe).toHaveBeenCalledWith(expect.objectContaining({ id: 'item-1' }), {
      notizen: 'Termin am Montag',
    })
  })

  it('lässt eine fremde Aufgabe lesen, aber nicht ändern (§7)', () => {
    mitDetail([aufgabe({ assignee: personen([BERT]), katalog: herkunft() })])

    expect(screen.getByText('Bert Müller')).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Diese Aufgabe löschen' })).toBeNull()
    expect(screen.getByText('Standesamt des Sterbeortes')).toBeVisible()
  })
})
