import { describe, expect, it } from 'vitest'
import { knoten } from '../../src/services/fragebaumService.ts'
import {
  FRAGEBAUM_AGENT_NAME,
  FRAGEBAUM_CLIENT_TOOLS,
  erstelleFragebaumSystemPrompt,
  extrahiereFaktenAusSprache,
  findeFolgeknoten,
  formatiereSprachausgabe,
  generiereBaumUebersicht,
  holeElevenLabsAgentKonfiguration,
} from '../../src/services/voiceAgentService.ts'

describe('voiceAgentService', () => {
  describe('System Prompt & Konfiguration', () => {
    it('erzeugt einen strukturierten deutschen System-Prompt mit Vorgaben', () => {
      const prompt = erstelleFragebaumSystemPrompt('Erika Mustermann')

      expect(prompt).toContain('LoveNeverDies')
      expect(prompt).toContain('Erika Mustermann')
      expect(prompt).toContain('AUSSCHLIESSLICH Deutsch')
      expect(prompt).toContain('syncFragebaumNode')
      expect(prompt).toContain('KONTEXT-GEDÄCHTNIS')
      expect(prompt).toContain('Wurzel: n0')
    })

    it('erzeugt die Baum-Übersicht aller Fragen und Ergebnisse', () => {
      const baum = generiereBaumUebersicht()

      expect(baum).toContain('Knoten n0 (Frage)')
      expect(baum).toContain('Knoten n1 (Frage)')
      expect(baum).toContain('Knoten n6 (Ergebnis')
      expect(baum).toContain('Knoten n7 (Ergebnis')
    })

    it('definiert das Client-Tool syncFragebaumNode mit vollständigem Schema', () => {
      expect(FRAGEBAUM_CLIENT_TOOLS.length).toBeGreaterThanOrEqual(1)
      const tool = FRAGEBAUM_CLIENT_TOOLS.find((t) => t.name === 'syncFragebaumNode')

      expect(tool).toBeDefined()
      expect(tool?.parameters.properties.nodeId).toBeDefined()
      expect(tool?.parameters.properties.path).toBeDefined()
      expect(tool?.parameters.required).toContain('nodeId')
      expect(tool?.parameters.required).toContain('path')
    })

    it('liefert die vollständige ElevenLabs Agent Konfiguration', () => {
      const config = holeElevenLabsAgentKonfiguration('Max Mustermann')

      expect(config.name).toBe(FRAGEBAUM_AGENT_NAME)
      expect(config.conversation_config.agent.language).toBe('de')
      expect(config.conversation_config.agent.prompt.prompt).toContain('Max Mustermann')
      expect(config.conversation_config.agent.prompt.tools).toHaveLength(1)
      expect(config.conversation_config.tts.model_id).toBe('eleven_multilingual_v2')
    })
  })

  describe('Folgeknoten-Erkennung (findeFolgeknoten)', () => {
    it('findet den Folgeknoten bei exakten und typischen Antworten', () => {
      // n0: Sind Sie Erbe? -> Ja (n1), Nein (n50), Ich weiß es nicht (n57)
      const folgeJa = findeFolgeknoten('n0', 'Ja')
      expect(folgeJa?.zielId).toBe('n1')

      const folgeNein = findeFolgeknoten('n0', 'Nein')
      expect(folgeNein?.zielId).toBe('n50')

      const folgeUnsicher = findeFolgeknoten('n0', 'Ich weiß es nicht')
      expect(folgeUnsicher?.zielId).toBe('n57')
    })

    it('erkennt umgangssprachliche Bestätigungen und Verneinungen', () => {
      const folgeJa = findeFolgeknoten('n0', 'Ja, genau')
      expect(folgeJa?.zielId).toBe('n1')

      const folgeNein = findeFolgeknoten('n0', 'Nein, überhaupt nicht')
      expect(folgeNein?.zielId).toBe('n50')
    })

    it('gibt null zurück bei ungültigem oder nicht vorhandenem Knoten', () => {
      expect(findeFolgeknoten('unbekannt', 'Ja')).toBeNull()
      expect(findeFolgeknoten('n6', 'Ja')).toBeNull() // n6 ist Ergebnis, keine Frage
    })
  })

  describe('Kontext-Extraktion & Gedächtnis (extrahiereFaktenAusSprache)', () => {
    it('extrahiere Fakten zu Erbenstellung und Testament', () => {
      const text = 'Ich bin Alleinerbe und wir haben ein handschriftliches Testament gefunden.'
      const fakten = extrahiereFaktenAusSprache(text)

      expect(fakten.istErbe).toBe('ja')
      expect(fakten.hatTestament).toBe('ja')
    })

    it('extrahiere Fakten zu Ausschlagungsabsicht', () => {
      const text = 'Ich möchte das Erbe auf keinen Fall annehmen und ausschlagen.'
      const fakten = extrahiereFaktenAusSprache(text)

      expect(fakten.willErbe).toBe('nein')
    })

    it('extrahiere Verwandtschaftsverhältnisse', () => {
      const textKind = 'Ich bin das Kind des Verstorbenen.'
      expect(extrahiereFaktenAusSprache(textKind).verwandtschaft).toBe('kind')

      const textEhegatte = 'Ich war der Ehepartner.'
      expect(extrahiereFaktenAusSprache(textEhegatte).verwandtschaft).toBe('ehepartner')
    })
  })

  describe('Sprachausgabe Formatierung (formatiereSprachausgabe)', () => {
    it('bereinigt Markdown und Platzhalter aus Knotentexten für die Sprachausgabe', () => {
      const k = knoten('n65')!
      const ausgabe = formatiereSprachausgabe(k, 'Erika Mustermann')

      expect(ausgabe).toBe('Ich bin Erika Mustermanns …')
      expect(ausgabe).not.toContain('{person}')
      expect(ausgabe).not.toContain('**')
    })
  })
})
