#!/usr/bin/env node

/**
 * Erstellt oder aktualisiert den LoveNeverDies Fragebaum Sprachagenten bei ElevenLabs.
 *
 * Ausführung:
 *   node scripts/setup-elevenlabs-agent.mjs
 */

import { execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

// Inlined configuration for script execution
const AGENT_NAME = 'LoveNeverDies Fragebaum-Berater'
const VOICE_ID = 'TX3LPaxmHKxFdv7VOQHJ' // Liam / Multilingual Voice with German support
const MODEL_ID = 'eleven_multilingual_v2'

const SYSTEM_PROMPT = `Du bist der einfühlsame, hilfsbereite und rechtlich präzise Sprachassistent der App "LoveNeverDies".
Deine Aufgabe ist es, Hinterbliebene durch den Erbe-Fragebaum zu führen, um zu klären, ob und in welcher Form sie Erbe nach der verstorbenen Person sind.

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

STARTE IMMER BEI KNOTEN n0 ("Sind Sie Erbe?"). Begrüße den Nutzer herzlich und stelle die erste Frage.`

const payload = {
  name: AGENT_NAME,
  conversation_config: {
    agent: {
      first_message:
        'Guten Tag. Ich begleite Sie gerne Schritt für Schritt durch den Fragebaum, um zu klären, welche Rechte, Pflichten und Fristen bezüglich des Erbes für Sie gelten. Zu Beginn: Wissen Sie bereits, ob Sie Erbe sind?',
      language: 'de',
      prompt: {
        prompt: SYSTEM_PROMPT,
        tools: [
          {
            type: 'client',
            name: 'syncFragebaumNode',
            description:
              'Synchronisiert den aktuellen Fragebaum-Knoten und den bisherigen Pfad mit der LoveNeverDies App.',
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
                    description: 'Node ID im Pfad wie n0, n1, n2',
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
              },
              required: ['nodeId', 'path'],
            },
          },
        ],
      },
    },
    tts: {
      voice_id: VOICE_ID,
      model_id: MODEL_ID,
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

async function main() {
  console.log('Erstelle/Aktualisiere ElevenLabs Sprachagenten für den Fragebaum...')

  const tempJsonPath = path.resolve('.temp-agent-config.json')
  fs.writeFileSync(tempJsonPath, JSON.stringify(payload, null, 2), 'utf-8')

  try {
    const output = execSync(
      `elevenlabs agents create --json "$(cat "${tempJsonPath}")" --format json`,
      { encoding: 'utf-8' },
    )
    const result = JSON.parse(output)
    const agentId = result.agent_id

    console.log('✓ ElevenLabs Agent erfolgreich registriert!')
    console.log(`  Agent-ID: ${agentId}`)

    // Update .env / .env.local
    const envPath = path.resolve('.env.local')
    let envContent = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf-8') : ''
    if (envContent.includes('VITE_ELEVENLABS_AGENT_ID=')) {
      envContent = envContent.replace(
        /VITE_ELEVENLABS_AGENT_ID=.*/,
        `VITE_ELEVENLABS_AGENT_ID=${agentId}`,
      )
    } else {
      envContent += `\nVITE_ELEVENLABS_AGENT_ID=${agentId}\n`
    }
    fs.writeFileSync(envPath, envContent.trim() + '\n', 'utf-8')
    console.log(`✓ VITE_ELEVENLABS_AGENT_ID in .env.local aktualisiert.`)

    return agentId
  } catch (err) {
    console.error('Fehler bei der Registrierung über ElevenLabs CLI:', err)
    process.exit(1)
  } finally {
    if (fs.existsSync(tempJsonPath)) {
      fs.unlinkSync(tempJsonPath)
    }
  }
}

main()
