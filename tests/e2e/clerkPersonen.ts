import { tresorperson, TRESORPERSONEN, type Tresorrolle } from './nutzer.ts'

/**
 * Die Testpersonen, die dieser Lauf braucht, in Clerk anlegen -- falls es sie
 * noch nicht gibt.
 *
 * Bislang war das ein Schritt der Einrichtung von Hand: vier Personen im
 * Dashboard anklicken und ihre Adressen in `.env.test` eintragen
 * (tests/e2e/README.md). Fuer die Personen des Tresor-Specs geht das anders,
 * und zwar ueber Clerks eigenen Weg fuer Testdaten: **Test-Adressen mit
 * `+clerk_test`**. Clerk verschickt an sie keine Mail und verlangt keine
 * Bestaetigung; die Adressen sind hier deshalb fest verdrahtet statt in
 * `.env.test` konfiguriert. Es gibt nichts einzurichten und nichts zu
 * vergessen.
 *
 * **Idempotent, nicht bei jedem Lauf neu.** Gesucht wird zuerst; nur wer fehlt,
 * wird angelegt. `npm run test:e2e` setzt Postgres vor jedem Lauf zurueck
 * (`supabase db reset`), also stehen dieselben Personen beim naechsten Lauf
 * wieder ohne Fall da -- genau das, was die Specs voraussetzen. Ohne die
 * Suche sammelte die Dev-Instanz mit jedem Lauf zwei Karteileichen mehr.
 *
 * Ohne Passwort (`skip_password_requirement`): `@clerk/testing` meldet ueber
 * ein von der Backend-API ausgestelltes Ticket an, nicht ueber das Formular.
 * Ein Passwort waere ein Geheimnis, das niemand braucht und das trotzdem
 * irgendwo stuende.
 *
 * Direkt gegen die Backend-API und nicht ueber das Clerk-CLI: Die Specs
 * kennen `CLERK_SECRET_KEY` ohnehin (`clerkSetup()` braucht ihn), waehrend das
 * CLI eine angemeldete Sitzung auf dem jeweiligen Rechner voraussetzt.
 */

const BASIS = 'https://api.clerk.com/v1'

function schluessel(): string {
  const wert = process.env.CLERK_SECRET_KEY

  if (!wert) {
    throw new Error('CLERK_SECRET_KEY fehlt. Siehe tests/e2e/README.md.')
  }

  return wert
}

async function ruf(pfad: string, optionen: RequestInit = {}): Promise<unknown> {
  const antwort = await fetch(`${BASIS}${pfad}`, {
    ...optionen,
    headers: {
      authorization: `Bearer ${schluessel()}`,
      'content-type': 'application/json',
      ...optionen.headers,
    },
  })

  if (!antwort.ok) {
    throw new Error(`Clerk ${optionen.method ?? 'GET'} ${pfad}: ${antwort.status} ${await antwort.text()}`)
  }

  return antwort.json()
}

/** Ob es zu dieser Adresse schon eine Person gibt. */
async function existiert(adresse: string): Promise<boolean> {
  const treffer = await ruf(`/users?email_address=${encodeURIComponent(adresse)}&limit=1`)

  return Array.isArray(treffer) && treffer.length > 0
}

async function lege(rolle: Tresorrolle): Promise<void> {
  const person = TRESORPERSONEN[rolle]

  await ruf('/users', {
    method: 'POST',
    body: JSON.stringify({
      email_address: [person.adresse],
      first_name: person.vorname,
      /*
       * Der Bestaetigungsscreen aus §6 zeigt den Namen, und wer nur eine
       * Adresse hinterlegt hat, prueft an dieser Stelle nichts. Deshalb tragen
       * auch diese beiden einen echten Vor- und Nachnamen.
       */
      last_name: person.nachname,
      skip_password_requirement: true,
    }),
  })
}

export async function stelleTestpersonenSicher(): Promise<void> {
  for (const rolle of Object.keys(TRESORPERSONEN) as Tresorrolle[]) {
    if (!(await existiert(tresorperson(rolle)))) {
      await lege(rolle)
    }
  }
}
