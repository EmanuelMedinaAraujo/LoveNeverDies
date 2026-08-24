import js from '@eslint/js'
import boundaries from 'eslint-plugin-boundaries'
import reactHooks from 'eslint-plugin-react-hooks'
import globals from 'globals'
import tseslint from 'typescript-eslint'

/**
 * Die Schichtung aus DESIGN.md §9, vom Linter durchgesetzt.
 *
 * Zwei Regeln halten sie zusammen:
 *   1. `core/crypto` importiert weder React noch Supabase.
 *   2. Abhaengigkeiten zeigen ausschliesslich nach unten.
 *
 * Der Kryptokern bleibt damit ein herausloesbares, vollstaendig testbares Modul.
 */

/**
 * Von oben nach unten. `ui`, `content` und `types` sind blattnah: Sie liegen
 * unter allem, was sie benutzt, importieren aber ihrerseits nur `types`. Ein
 * reiner Rang reichte dafuer nicht, deshalb stehen die Erlaubnisse ausdruecklich da.
 */
const ERLAUBT = {
  app: ['app', 'screens', 'hooks', 'services', 'core', 'crypto', 'ui', 'content', 'types'],
  screens: ['screens', 'hooks', 'services', 'core', 'crypto', 'ui', 'content', 'types'],
  hooks: ['hooks', 'services', 'core', 'crypto', 'ui', 'types'],
  services: ['services', 'core', 'crypto', 'content', 'types'],
  core: ['core', 'crypto', 'types'],
  crypto: ['crypto', 'types'],
  ui: ['ui', 'types'],
  content: ['content', 'types'],
  types: ['types'],
}

const schichtenPolicies = Object.entries(ERLAUBT).map(([from, nachUnten]) => ({
  from: [{ element: { type: from } }],
  allow: nachUnten.map((to) => ({ to: { element: { type: to } } })),
}))

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'dev-dist/**',
      'coverage/**',
      'node_modules/**',
      // `supabase start` erzeugt hier eine Edge-Runtime-Kopie fuer den lokalen
      // Stack (supabase/README.md). Das ist kein Quellcode und bereits in .gitignore.
      'supabase/.temp/**',
      'supabase/.branches/**',
      'playwright-report/**',
      'test-results/**',
      // Edge Functions laufen unter Deno, nicht im Browser und nicht in Node:
      // eigene Globals (`Deno`), eigene Importspezifizierer (`jsr:`). Sie
      // gegen die Regeln dieser App zu pruefen, meldete ausschliesslich
      // Falsches.
      'supabase/functions/**',
    ],
  },

  js.configs.recommended,
  tseslint.configs.recommended,

  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2023,
      globals: globals.browser,
    },
  },

  {
    files: ['src/**/*.{ts,tsx}'],
    plugins: { boundaries, 'react-hooks': reactHooks },
    settings: {
      'boundaries/include': ['src/**/*'],
      // Der Einstiegspunkt und die Typdeklarationen gehoeren zu keiner Schicht
      // und sollen es auch nicht. Alles andere muss.
      'boundaries/ignore': ['src/main.tsx', 'src/vite-env.d.ts'],
      // Ohne diese Endungen loest der Node-Resolver `../../hooks/useCase` nicht
      // auf, und eine nicht aufgeloeste Abhaengigkeit prueft `boundaries` nicht:
      // Die Regel liefe still ins Leere.
      'import/resolver': {
        node: { extensions: ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.json'] },
      },
      // Reihenfolge zaehlt: `crypto` steht vor `core`, sonst schluckt das
      // breitere Muster den Kern.
      'boundaries/elements': [
        { type: 'app', pattern: 'src/app', partialMatch: false },
        { type: 'screens', pattern: 'src/screens', partialMatch: false },
        { type: 'hooks', pattern: 'src/hooks', partialMatch: false },
        { type: 'services', pattern: 'src/services', partialMatch: false },
        { type: 'crypto', pattern: 'src/core/crypto', partialMatch: false },
        { type: 'core', pattern: 'src/core', partialMatch: false },
        { type: 'ui', pattern: 'src/ui', partialMatch: false },
        { type: 'content', pattern: 'src/content', partialMatch: false },
        { type: 'types', pattern: 'src/types', partialMatch: false },
      ],
    },
    rules: {
      ...reactHooks.configs.recommended.rules,

      /*
       * `boundaries/dependencies` prueft ausschliesslich Dateien, die zu einer
       * erklaerten Schicht gehoeren. Ohne diese Regel liesse sich die
       * Schichtung durch einen neuen Ordner umgehen: Ein `src/lib/` duerfte
       * React importieren und trotzdem den Kryptokern anfassen, und der
       * Lint-Lauf saehe nichts. Neue Ordner erzwingen so eine Entscheidung,
       * wohin sie gehoeren.
       */
      'boundaries/no-unknown-files': 'error',

      'boundaries/dependencies': [
        'error',
        {
          default: 'disallow',
          message:
            '{{from.type}} darf {{target.type}} nicht importieren — Abhaengigkeiten zeigen ausschliesslich nach unten (DESIGN.md §9).',
          policies: schichtenPolicies,
        },
      ],
    },
  },

  /**
   * Der Kryptokern und seine Abhaengigkeitsliste. `boundaries` traegt das allein
   * nicht: Es kann nur pruefen, was aufloesbar installiert ist, und ein Verbot,
   * das bei einem nicht installierten Paket stillschweigend durchlaesst, ist keins.
   */
  {
    files: ['src/core/crypto/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                'react',
                'react/*',
                'react-dom',
                'react-dom/*',
                'react-router',
                'react-router/*',
                'react-router-dom',
                'react-router-dom/*',
              ],
              message:
                'core/crypto importiert kein React (DESIGN.md §9). Der Kryptokern bleibt herausloesbar.',
            },
            {
              group: ['@supabase/*', '@clerk/*'],
              message:
                'core/crypto importiert weder Supabase noch Clerk (DESIGN.md §9). Der Kryptokern kennt keinen Server und keine Anmeldung.',
            },
          ],
        },
      ],
    },
  },

  {
    files: ['*.{js,ts,mjs}', 'scripts/**/*.{js,mjs}', 'build/**/*.ts', 'tests/**/*.{ts,tsx}'],
    languageOptions: {
      globals: globals.node,
    },
  },

  /**
   * Die Komponententests rendern echtes JSX. `globals.node` allein reicht
   * ihnen nicht: Sie greifen auf `document` und `window` zu, die im
   * jsdom-Projekt (vitest.config.ts) da sind.
   */
  {
    files: ['tests/**/*.tsx'],
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
    },
  },
)
