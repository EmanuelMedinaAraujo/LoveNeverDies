/**
 * Je Browser-Projekt eine eigene Testperson und ein eigener Sitzungszustand.
 *
 * Warum getrennt und nicht ein Account fuer alle: Die Projekte laufen
 * parallel gegen dieselbe lokale Postgres, die `npm run test:e2e` genau einmal
 * zuruecksetzt. `fall-lebenszyklus.spec.ts` setzt voraus, dass die Person noch
 * keinen Fall hat, legt dann einen an und prueft, dass kein zweiter entsteht.
 * Mit einem gemeinsamen Account saehe das zweite Projekt den Fall des ersten,
 * und zwar gesperrt, weil sein Geraeteschluessel fuer keinen Wrap dieses Falls
 * vorliegt (`Fuer dieses Geraet liegt noch kein Schluessel zu diesem Fall
 * vor`). Getrennte Personen entkoppeln die Projekte vollstaendig.
 */

export type Projektname = 'mobile-webkit' | 'desktop-chromium'

interface Testperson {
  /** Name der zugehoerigen Umgebungsvariablen in `.env.test`. */
  readonly variable: string
  /** Sitzungszustand aus `auth.setup.ts`, gitignored (echtes Clerk-Token). */
  readonly authDatei: string
}

const PERSONEN: Record<Projektname, Testperson> = {
  'mobile-webkit': {
    variable: 'E2E_CLERK_USER_EMAIL_MOBILE_WEBKIT',
    authDatei: 'tests/e2e/.auth/mobile-webkit.json',
  },
  'desktop-chromium': {
    variable: 'E2E_CLERK_USER_EMAIL_DESKTOP_CHROMIUM',
    authDatei: 'tests/e2e/.auth/desktop-chromium.json',
  },
}

export function authDatei(projekt: Projektname): string {
  return PERSONEN[projekt].authDatei
}

/**
 * Die Adresse der Testperson dieses Projekts. Wirft mit dem Namen der
 * fehlenden Variablen, statt die Anmeldung ins Leere laufen zu lassen.
 */
export function testpersonAdresse(projekt: Projektname): string {
  const person = PERSONEN[projekt]
  const adresse = process.env[person.variable]

  if (!adresse) {
    throw new Error(
      `${person.variable} fehlt. Siehe tests/e2e/README.md, um die Testperson fuer "${projekt}" anzulegen und in .env.test einzutragen.`,
    )
  }

  return adresse
}

/**
 * Die Personen der Kopplung (tests/e2e/kopplung.spec.ts).
 *
 * Bewusst nicht in `PERSONEN` oben: Die dortigen Personen haengen je an einem
 * Browser-Projekt und melden sich einmalig in `auth.setup.ts` an. Die Kopplung
 * braucht das Gegenteil: mehrere Personen gleichzeitig im selben Test, jede
 * in einem eigenen Kontext, weil die Geraeteidentitaet in IndexedDB liegt und
 * ein geteilter Kontext ein geteiltes Geraet waere. Ein gespeicherter
 * Sitzungszustand nuetzt dabei nichts; jeder Kontext meldet sich selbst an.
 */
export type Kopplungsrolle = 'a' | 'b' | 'c' | 'd'

export function kopplungsperson(rolle: Kopplungsrolle): string {
  const variable = `E2E_CLERK_USER_EMAIL_KOPPLUNG_${rolle.toUpperCase()}`
  const adresse = process.env[variable]

  if (!adresse) {
    throw new Error(
      `${variable} fehlt. Siehe tests/e2e/README.md, um die Kopplungspersonen anzulegen und in .env.test einzutragen.`,
    )
  }

  return adresse
}
