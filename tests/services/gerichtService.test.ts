import { describe, expect, it } from 'vitest'
import {
  aktualisiereNotizMitGericht,
  extrahierePlzAusNotiz,
  findeNachlassgericht,
  formatGerichtNotiz,
} from '../../src/services/gerichtService.ts'

describe('gerichtService', () => {
  describe('findeNachlassgericht', () => {
    it('findet ein Gericht bei gültiger bekannter PLZ', () => {
      const ergebnis = findeNachlassgericht('74199')
      expect(ergebnis.status).toBe('gefunden')
      if (ergebnis.status === 'gefunden') {
        expect(ergebnis.gericht.name).toBe('Amtsgericht Heilbronn')
        expect(ergebnis.gericht.lieferanschrift).toContain('Heilbronn')
        expect(ergebnis.gericht.telefon).toBeDefined()
        expect(ergebnis.gericht.email).toBeDefined()
      }
    })

    it('findet Großstadtgerichte (z. B. München 80331, Dresden 01067)', () => {
      const ergebnisMuenchen = findeNachlassgericht('80331')
      expect(ergebnisMuenchen.status).toBe('gefunden')
      if (ergebnisMuenchen.status === 'gefunden') {
        expect(ergebnisMuenchen.gericht.name).toContain('München')
      }

      const ergebnisDresden = findeNachlassgericht('01067')
      expect(ergebnisDresden.status).toBe('gefunden')
      if (ergebnisDresden.status === 'gefunden') {
        expect(ergebnisDresden.gericht.name).toContain('Dresden')
        expect(ergebnisDresden.gericht.lieferanschrift).toContain('Roßbachstraße 6')
      }
    })

    it('behandelt mehrdeutige PLZs mit Status mehrdeutig', () => {
      const ergebnis = findeNachlassgericht('02923')
      expect(ergebnis.status).toBe('mehrdeutig')
      if (ergebnis.status === 'mehrdeutig') {
        expect(ergebnis.hinweis).toContain('unterschiedliche Zuständigkeiten')
        expect(ergebnis.linkUrl).toContain('02923')
      }
    })

    it('behandelt Sonder-/Großempfänger-PLZs mit Status nicht_gefunden', () => {
      const ergebnis = findeNachlassgericht('01053')
      expect(ergebnis.status).toBe('nicht_gefunden')
      if (ergebnis.status === 'nicht_gefunden') {
        expect(ergebnis.hinweis).toContain('Postfach oder Großempfänger')
      }
    })

    it('weist ungültige PLZ-Formate ab', () => {
      expect(findeNachlassgericht('123').status).toBe('ungueltig')
      expect(findeNachlassgericht('abcde').status).toBe('ungueltig')
      expect(findeNachlassgericht('').status).toBe('ungueltig')
      expect(findeNachlassgericht('123456').status).toBe('ungueltig')
    })

    it('trimmt Leerzeichen um die Eingabe', () => {
      const ergebnis = findeNachlassgericht('  74199  ')
      expect(ergebnis.status).toBe('gefunden')
      if (ergebnis.status === 'gefunden') {
        expect(ergebnis.gericht.name).toBe('Amtsgericht Heilbronn')
      }
    })
  })

  describe('formatGerichtNotiz', () => {
    it('erzeugt vollständige Notiz mit allen Feldern', () => {
      const gericht = {
        id: 1,
        name: 'Amtsgericht Heilbronn',
        lieferanschrift: 'Knorrstr. 1, 74074 Heilbronn',
        postanschrift: '74064 Heilbronn',
        telefon: '07131 64-1',
        fax: '07131 64-34000',
        internet: 'https://amtsgericht-heilbronn.justiz-bw.de',
        email: 'poststelle@agheilbronn.justiz.bwl.de',
      }

      const notiz = formatGerichtNotiz(gericht, '74199')

      expect(notiz).toContain('Zuständiges Nachlassgericht (PLZ 74199):')
      expect(notiz).toContain('Amtsgericht Heilbronn')
      expect(notiz).toContain('Lieferanschrift: Knorrstr. 1, 74074 Heilbronn')
      expect(notiz).toContain('Postanschrift: 74064 Heilbronn')
      expect(notiz).toContain('Telefon: 07131 64-1')
      expect(notiz).toContain('Fax: 07131 64-34000')
      expect(notiz).toContain('E-Mail: poststelle@agheilbronn.justiz.bwl.de')
      expect(notiz).toContain('Internet: https://amtsgericht-heilbronn.justiz-bw.de')
    })
  })

  describe('extrahierePlzAusNotiz', () => {
    it('extrahiert PLZ aus formatierter Gerichtsnotiz', () => {
      const notiz = 'Zuständiges Nachlassgericht (PLZ 74199):\nAmtsgericht Heilbronn'
      expect(extrahierePlzAusNotiz(notiz)).toBe('74199')
    })

    it('extrahiert PLZ aus Wohnort-Angabe', () => {
      expect(extrahierePlzAusNotiz('Letzter Wohnort (PLZ): 80331')).toBe('80331')
      expect(extrahierePlzAusNotiz('Letzter Wohnort (PLZ) 01067 → Amtsgericht Dresden')).toBe('01067')
    })

    it('gibt null zurück, wenn keine PLZ in den Notizen vorhanden ist', () => {
      expect(extrahierePlzAusNotiz('')).toBeNull()
      expect(extrahierePlzAusNotiz('Einfache Notiz ohne Postleitzahl')).toBeNull()
    })
  })

  describe('aktualisiereNotizMitGericht', () => {
    const gerichtHeilbronn = {
      id: 1,
      name: 'Amtsgericht Heilbronn',
      lieferanschrift: 'Knorrstr. 1, 74074 Heilbronn',
      postanschrift: null,
      telefon: '07131 64-1',
      fax: null,
      internet: null,
      email: null,
    }

    const gerichtMuenchen = {
      id: 2,
      name: 'Amtsgericht München',
      lieferanschrift: 'Pacellistraße 5, 80333 München',
      postanschrift: null,
      telefon: '089 5597-01',
      fax: null,
      internet: null,
      email: null,
    }

    it('erstellt neue Notiz bei zuvor leerer Notiz', () => {
      const notiz = aktualisiereNotizMitGericht('', gerichtHeilbronn, '74199')
      expect(notiz).toContain('Zuständiges Nachlassgericht (PLZ 74199):')
      expect(notiz).toContain('Amtsgericht Heilbronn')
    })

    it('ersetzt bestehenden Gerichtsblock und behält weitere Abschnitte', () => {
      const alt = [
        'Zuständiges Nachlassgericht (PLZ 74199):',
        'Amtsgericht Heilbronn',
        'Lieferanschrift: Knorrstr. 1, 74074 Heilbronn',
        '',
        'Vom Anfechtungsgrund erfahren am: 2026-05-12',
        'Die Frist beträgt ein Jahr ab diesem Tag.',
      ].join('\n')

      const neu = aktualisiereNotizMitGericht(alt, gerichtMuenchen, '80331')
      expect(neu).toContain('Zuständiges Nachlassgericht (PLZ 80331):')
      expect(neu).toContain('Amtsgericht München')
      expect(neu).not.toContain('74199')
      expect(neu).not.toContain('Amtsgericht Heilbronn')
      expect(neu).toContain('Vom Anfechtungsgrund erfahren am: 2026-05-12')
    })

    it('fügt Gerichtsangabe vor bestehenden manuellen Notizen ein', () => {
      const alt = 'Dokumente liegen im Schrank bei den Eltern.'
      const neu = aktualisiereNotizMitGericht(alt, gerichtHeilbronn, '74199')
      expect(neu).toContain('Zuständiges Nachlassgericht (PLZ 74199):')
      expect(neu).toContain('Dokumente liegen im Schrank bei den Eltern.')
    })
  })
})

