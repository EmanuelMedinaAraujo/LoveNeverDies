import { fileURLToPath } from 'node:url'
import { ESLint } from 'eslint'
import { beforeAll, describe, expect, it } from 'vitest'

/**
 * Nahtstelle: die ESLint-Import-Boundary-Regel aus DESIGN.md §9.
 *
 * `core/crypto` importiert weder React noch Supabase, und Abhaengigkeiten zeigen
 * ausschliesslich nach unten. Getestet wird der echte Lint-Lauf gegen die echte
 * Konfiguration — nicht die Konfiguration als Datenstruktur. Deshalb `lintText`
 * mit einem virtuellen Dateipfad: Es entstehen keine Fixture-Dateien, die der
 * normale `npm run lint` mitlinten und daran scheitern wuerde.
 */

const repoRoot = fileURLToPath(new URL('..', import.meta.url))

let eslint: ESLint

beforeAll(() => {
  eslint = new ESLint({ cwd: repoRoot })
})

async function lint(filePath: string, code: string) {
  const [result] = await eslint.lintText(code, { filePath, warnIgnored: false })
  return result.messages.filter((message) => message.severity === 2)
}

describe('core/crypto ist importgekapselt', () => {
  it('weist einen React-Import zurueck', async () => {
    const errors = await lint(
      'src/core/crypto/aead.ts',
      "import { useState } from 'react'\nexport const x = useState\n",
    )

    expect(errors).not.toHaveLength(0)
  })

  it('weist einen Supabase-Import zurueck', async () => {
    const errors = await lint(
      'src/core/crypto/kem.ts',
      "import { createClient } from '@supabase/supabase-js'\nexport const x = createClient\n",
    )

    expect(errors).not.toHaveLength(0)
  })

  it('laesst die Kryptobibliotheken aus §1 durch', async () => {
    const errors = await lint(
      'src/core/crypto/kem.ts',
      "import { ml_kem768 } from '@noble/post-quantum/ml-kem.js'\nexport const kem = ml_kem768\n",
    )

    expect(errors).toEqual([])
  })
})

describe('Abhaengigkeiten zeigen nach unten', () => {
  it('weist einen Import aus core/crypto nach oben in hooks zurueck', async () => {
    const errors = await lint(
      'src/core/crypto/envelope.ts',
      "import { useCase } from '../../hooks/useCase'\nexport const c = useCase\n",
    )

    expect(errors).not.toHaveLength(0)
  })

  it('laesst den Import aus hooks nach unten in core/crypto durch', async () => {
    const errors = await lint(
      'src/hooks/useVault.ts',
      "import { DOMAIN_SEPARATION } from '../core/crypto/domain'\nexport const p = DOMAIN_SEPARATION\n",
    )

    expect(errors).toEqual([])
  })
})

describe('Kein Schlupfloch neben den Schichten', () => {
  it('weist eine Datei zurueck, die in keiner Schicht liegt', async () => {
    // Ohne diese Regel liesse sich die Schichtung umgehen, indem man einen
    // neuen Ordner anlegt: `boundaries` prueft ausschliesslich Dateien, die zu
    // einem erklaerten Element gehoeren. Ein `src/lib/schluessel.ts` duerfte
    // dann React importieren und trotzdem Krypto anfassen.
    const errors = await lint(
      'src/lib/schluessel.ts',
      "import { useState } from 'react'\nexport const x = useState\n",
    )

    expect(errors).not.toHaveLength(0)
  })

  it('laesst den Einstiegspunkt in Ruhe', async () => {
    const errors = await lint(
      'src/main.tsx',
      "import { App } from './app/App.tsx'\nexport const a = App\n",
    )

    expect(errors).toEqual([])
  })
})
