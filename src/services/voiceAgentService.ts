/**
 * Voice Agent Service für den Erbe-Fragebaum mit ElevenLabs Conversational AI.
 *
 * Verwaltet den deutschen System-Prompt, die Client-Tools zur Synchronisation
 * des Fragebaum-Zustands sowie die Erkennungs- und Inferenzlogik für vorab
 * erwähnte Nutzerangaben (damit sich Nutzer nicht wiederholen müssen).
 */

import { FRAGEBAUM } from '../content/fragebaum.ts'
import type { Fragebaumknoten } from '../types/fragebaum.ts'
import { knoten as holeKnoten } from './fragebaumService.ts'

export const FRAGEBAUM_AGENT_NAME = 'LoveNeverDies Fragebaum-Berater'
export const ELEVENLABS_DEFAULT_VOICE_ID = 'TX3LPaxmHKxFdv7VOQHJ' // Liam / Multilingual German voice
export const ELEVENLABS_DEFAULT_MODEL = 'eleven_multilingual_v2'

export interface SyncFragebaumNodeArgs {
  nodeId: string
  path: string[]
  answer?: string
  isComplete?: boolean
  summary?: string
}

export interface ClientToolDefinition {
  name: string
  description: string
  parameters: {
    type: 'object'
    properties: Record<string, unknown>
    required: string[]
  }
}

/**
 * Client-Tools für ElevenLabs Conversational AI
 */
export const FRAGEBAUM_CLIENT_TOOLS: ClientToolDefinition[] = [
  {
    name: 'syncFragebaumNode',
    description:
      'Synchronisiert den aktuellen Fragebaum-Knoten und den bisherigen Pfad mit der LoveNeverDies App. MUSS bei jeder Frage und bei jedem Ergebnis aufgerufen werden.',
    parameters: {
      type: 'object',
      properties: {
        nodeId: {
          type: 'string',
          description: 'Die ID des aktuellen Knotens (z. B. n0, n1, n2, n6, n7, n65 usw.).',
        },
        path: {
          type: 'array',
          description: 'Der vollständige Pfad von der Wurzel (n0) bis zum aktuellen Knoten.',
          items: {
            type: 'string',
            description: 'Knoten ID im Pfad wie n0, n1, n2',
          },
        },
        answer: {
          type: 'string',
          description: 'Die vom Nutzer gewählte oder erkannte Antwort (z. B. Ja, Nein).',
        },
        isComplete: {
          type: 'boolean',
          description: 'True, falls ein Ergebnisknoten erreicht wurde.',
        },
        summary: {
          type: 'string',
          description: 'Kurze deutsche Zusammenfassung des aktuellen Stands oder Ergebnisses.',
        },
      },
      required: ['nodeId', 'path'],
    },
  },
]

/**
 * Erstellt die komprimierte Baumstruktur für den System-Prompt des Agenten.
 */
export function generiereBaumUebersicht(): string {
  const zeilen: string[] = []

  for (const k of FRAGEBAUM) {
    if (k.art === 'frage') {
      const antwortenStr = k.antworten.map((a) => `"${a.text}" -> ${a.ziel}`).join(' | ')
      const extra = k.hinweis ? ` [Hinweis: ${k.hinweis.slice(0, 80)}...]` : ''
      zeilen.push(`Knoten ${k.id} (Frage): "${k.text.split('\n')[0]}" => Antworten: [${antwortenStr}]${extra}`)
    } else {
      const statusStr = k.status ? ` (Status: ${k.status})` : ''
      zeilen.push(`Knoten ${k.id} (Ergebnis${statusStr}): "${k.text.split('\n')[0]}"`)
    }
  }

  return zeilen.join('\n')
}

/**
 * Erstellt den vollständigen, instruktionsgetreuen System-Prompt für den ElevenLabs Voice Agenten.
 */
export function erstelleFragebaumSystemPrompt(personName?: string): string {
  const person = personName && personName.trim() !== '' ? personName : 'die verstorbene Person'
  const baumStruktur = generiereBaumUebersicht()

  return `Du bist der einfühlsame, hilfsbereite und rechtlich präzise Sprachassistent der App "LoveNeverDies".
Deine Aufgabe ist es, Hinterbliebene durch den Erbe-Fragebaum zu führen, um zu klären, ob und in welcher Form sie Erbe nach ${person} sind.

WICHTIGE GRUNDREGELN:
1. SPRACHE: Sprich AUSSCHLIESSLICH Deutsch. Verwende eine ruhige, respektvolle, verständnisvolle und klare Sprache.
2. ENTSCHEIDUNGSBAUM: Folge STRIKT dem vorgegebenen Fragebaum (Wurzel: n0).
3. CLIENT-TOOL AUFRUFEN: Rufe bei JEDER Frage und bei JEDEM erreichten Ergebnis unverzüglich das Tool \`syncFragebaumNode\` mit \`nodeId\` und \`path\` auf!
   Beispiel zu Beginn: \`syncFragebaumNode({ nodeId: "n0", path: ["n0"] })\`.
   Wenn der Nutzer mit "Ja" antwortet: \`syncFragebaumNode({ nodeId: "n1", path: ["n0", "n1"], answer: "Ja" })\`.
4. STRIKTE REGEL GEGEN WIEDERHOLUNGEN (FRAGEN NIEMALS DOPPELT STELLEN):
   - Sprich jede Frage aus dem Fragebaum GENAU EINMAL aus!
   - Wiederhole eine Frage NIEMALS doppelt — weder innerhalb desselben Satzes/Beitrags noch vor bzw. nach einer Begriffserklärung noch nach der Rückmeldung eines Tool-Aufrufs.
   - Wenn du eine Frage stellst, beende deinen Sprechbeitrag direkt nach der Frage und warte ruhig auf die Antwort des Nutzers.
   - Wiederhole eine Frage AUSSCHLIESSLICH DANN, wenn der Nutzer dich aktiv und ausdrücklich darum bittet (z. B. "Kannst du die Frage bitte noch einmal wiederholen?" oder "Ich habe das akustisch nicht verstanden").
5. ERKLÄRUNG SCHWIERIGER ODER JURISTISCHER BEGRIFFE:
   - Wenn im Fragetext Fachbegriffe oder juristische Ausdrücke vorkommen (wie z. B. 'Testament oder Erbvertrag', 'Erbschein', 'Ausschlagung', 'Pflichtteil', 'Gesetzliche Erbfolge', 'Berufungsgrund'), formuliere die Frage EINMAL und füge in einem einzigen fließenden Satz das Angebot hinzu, den Begriff bei Bedarf zu erklären (z. B. 'Haben Sie ein Testament oder einen Erbvertrag gefunden? Falls Sie unsicher sind, was ein Erbvertrag genau ist, erkläre ich es Ihnen gerne.').
   - Wiederhole danach die Frage NICHT noch einmal, sondern warte auf die Reaktion des Nutzers.
   - Bei Nachfrage des Nutzers erkläre den Begriff kurz, verständlich und ohne Amtsdeutsch.
6. KONTEXT-GEDÄCHTNIS & VORAB-INFORMATIONEN:
   - Höre dem Nutzer aufmerksam zu. Wenn der Nutzer bereits zu Beginn oder im Verlauf relevante Details nennt (z. B. "Mein Vater ist gestorben, es gibt kein Testament und ich bin das einzige Kind" oder "Ich möchte das Erbe auf keinen Fall annehmen"), merke dir diese Fakten!
   - Wenn eine spätere Frage des Baums durch eine bereits bekannte Information eindeutig beantwortet ist, stelle die Frage NICHT noch einmal von vorne!
   - Bestätige stattdessen kurz die Information (z. B. "Da Sie bereits erwähnt haben, dass kein Testament vorliegt...") und navigiere direkt zum entsprechenden Folgeknoten weiter. Rufe dabei sofort das Tool \`syncFragebaumNode\` für den neuen Knoten auf.
   - Der Nutzer soll sich niemals unnötig wiederholen müssen.
7. ERGEBNIS: Sobald ein Ergebnisknoten erreicht wird, rufe \`syncFragebaumNode\` mit \`isComplete: true\` auf. Erkläre dem Nutzer das Ergebnis verständlich und weise ggf. auf Fristen (z. B. 6 Wochen bei Ausschlagung) oder nächste Schritte hin.
8. ABSCHLUSS & BEENDIGUNG:
   - Sobald ein Ergebnisknoten erreicht und erklärt ist, verabschiede dich freundlich (z. B. 'Ich leite Sie nun direkt zur Übersicht und den nächsten Schritten in der App weiter. Auf Wiederhören!'), rufe \`syncFragebaumNode\` mit \`isComplete: true\` auf und schließe das Gespräch ab.
9. KEINE RECHTSBERATUNG: Erkläre sachlich die rechtliche Orientierung der App, weise aber bei komplexen Fragen freundlich darauf hin, dass die App keine individuelle anwaltliche oder notarielle Rechtsberatung ersetzt.

STRUKTUR DES FRAGEBAUMS:
${baumStruktur}

STARTE IMMER BEI KNOTEN n0 ("Sind Sie Erbe?"). Begrüße den Nutzer herzlich und stelle die erste Frage.`
}

/**
 * Vollständige ElevenLabs Agent Konfiguration
 */
export function holeElevenLabsAgentKonfiguration(personName?: string) {
  return {
    name: FRAGEBAUM_AGENT_NAME,
    conversation_config: {
      agent: {
        first_message: `Guten Tag. Ich begleite Sie gerne Schritt für Schritt durch den Fragebaum, um zu klären, welche Rechte, Pflichten und Fristen bezüglich des Erbes für Sie gelten. Zu Beginn: Wissen Sie bereits, ob Sie Erbe sind?`,
        language: 'de',
        prompt: {
          prompt: erstelleFragebaumSystemPrompt(personName),
          tools: FRAGEBAUM_CLIENT_TOOLS.map((tool) => ({
            type: 'client' as const,
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters,
          })),
        },
      },
      tts: {
        voice_id: ELEVENLABS_DEFAULT_VOICE_ID,
        model_id: ELEVENLABS_DEFAULT_MODEL,
        stability: 0.5,
        similarity_boost: 0.8,
      },
      asr: {
        quality: 'high',
      },
      turn: {
        turn_eagerness: 'normal',
      },
    },
  }
}

/**
 * Hilfsfunktion: Validiert und findet den Folgeknoten anhand einer Textantwort.
 */
export function findeFolgeknoten(
  aktuellerKnotenId: string,
  antwortText: string,
): { zielId: string; antwortLabel: string } | null {
  const knoten = holeKnoten(aktuellerKnotenId)
  if (!knoten || knoten.art !== 'frage') {
    return null
  }

  const normalisiert = antwortText.trim().toLowerCase()

  // Direkter oder unscharfer Textabgleich
  for (const a of knoten.antworten) {
    const antwortNorm = a.text.toLowerCase()
    if (
      normalisiert === antwortNorm ||
      normalisiert.includes(antwortNorm) ||
      antwortNorm.includes(normalisiert) ||
      (normalisiert.startsWith('ja') && antwortNorm.startsWith('ja')) ||
      (normalisiert.startsWith('nein') && antwortNorm.startsWith('nein')) ||
      (normalisiert.includes('unsicher') && antwortNorm.includes('unsicher')) ||
      (normalisiert.includes('weiß nicht') && antwortNorm.includes('weiß'))
    ) {
      return { zielId: a.ziel, antwortLabel: a.text }
    }
  }

  return null
}

/**
 * Ermittelt automatisch anhand von im Freitext genannten Fakten einen passenden Pfad im Fragebaum.
 */
export function extrahiereFaktenAusSprache(
  text: string,
): {
  istErbe?: 'ja' | 'nein' | 'unsicher'
  hatTestament?: 'ja' | 'nein' | 'unsicher'
  willErbe?: 'ja' | 'nein'
  verwandtschaft?: string
  nachlassgerichtGemeldet?: 'ja' | 'nein'
} {
  const norm = text.toLowerCase()
  const fakten: ReturnType<typeof extrahiereFaktenAusSprache> = {}

  if (norm.includes('bin erbe') || norm.includes('alleinerbe') || norm.includes('als erbe eingesetzt')) {
    fakten.istErbe = 'ja'
  } else if (norm.includes('kein erbe') || norm.includes('enterbt') || norm.includes('nicht erbe')) {
    fakten.istErbe = 'nein'
  } else if (norm.includes('weiß nicht ob ich erbe') || norm.includes('keine ahnung ob ich erbe')) {
    fakten.istErbe = 'unsicher'
  }

  if (
    norm.includes('testament gefunden') ||
    norm.includes('gibt ein testament') ||
    norm.includes('handschriftliches testament') ||
    norm.includes('notarielles testament')
  ) {
    fakten.hatTestament = 'ja'
  } else if (norm.includes('kein testament') || norm.includes('ohne testament')) {
    fakten.hatTestament = 'nein'
  }

  if (
    norm.includes('ausschlagen') ||
    norm.includes('nicht erben') ||
    norm.includes('erbe ablehnen') ||
    norm.includes('erbe nicht will') ||
    norm.includes('erbe nicht haben')
  ) {
    fakten.willErbe = 'nein'
  } else if (
    norm.includes('erbe annehmen') ||
    norm.includes('erbe antreten') ||
    norm.includes('will das erbe') ||
    norm.includes('erbe haben')
  ) {
    fakten.willErbe = 'ja'
  }

  const verwandtschaften = [
    'ehegatte',
    'ehepartner',
    'partner',
    'lebenspartner',
    'kind',
    'tochter',
    'sohn',
    'enkel',
    'enkelin',
    'eltern',
    'mutter',
    'vater',
    'geschwister',
    'bruder',
    'schwester',
    'nichte',
    'neffe',
    'großmutter',
    'großvater',
    'oma',
    'opa',
    'onkel',
    'tante',
    'cousin',
    'cousine',
  ]

  for (const v of verwandtschaften) {
    if (norm.includes(v)) {
      fakten.verwandtschaft = v
      break
    }
  }

  if (norm.includes('nachlassgericht hat sich gemeldet') || norm.includes('post vom nachlassgericht')) {
    fakten.nachlassgerichtGemeldet = 'ja'
  } else if (norm.includes('nachlassgericht hat sich nicht gemeldet') || norm.includes('keine post vom gericht')) {
    fakten.nachlassgerichtGemeldet = 'nein'
  }

  return fakten
}

/**
 * Duzt oder siezt im Sprachdialog konsistent in Höflichkeitsform "Sie".
 */
export function formatiereSprachausgabe(knoten: Fragebaumknoten, personName: string): string {
  const bereinigt = knoten.text.replaceAll('{person}', personName)
  const ersteZeile = bereinigt.split('\n')[0] ?? bereinigt
  return ersteZeile.replaceAll('**', '').replaceAll(/\[(gruen|rot):([^\]]+)\]/g, '$2')
}
