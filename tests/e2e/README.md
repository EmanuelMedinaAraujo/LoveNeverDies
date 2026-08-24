# E2E-Tests (Playwright)

Laufen gegen den echten Produktionsbuild, lokal serviert (`vite preview`), mit
zwei realen Diensten dahinter:

- **Supabase**: der lokale Docker-Stack aus `npx supabase start` (siehe
  `supabase/README.md`) — kostenlos, kein Cloud-Projekt betroffen.
- **Clerk**: die echte Dev-Instanz aus `.env.local`, aber ausschliesslich über
  dedizierte Testpersonen — eine je Browser-Projekt.

## Browser-Projekte

| Projekt            | Engine   | Viewport            | Testperson                |
| ------------------ | -------- | ------------------- | ------------------------- |
| `mobile-webkit`    | WebKit   | iPhone 13           | `e2e-webkit@gmail.com`    |
| `desktop-chromium` | Chromium | Desktop Chrome      | `e2e-chromium@gmail.com`  |
| `kopplung`         | WebKit   | iPhone 13           | vier eigene, siehe unten  |

`mobile-webkit` ist der Hauptfall: Mobile-first PWA, und auf iOS gibt es
praktisch nur WebKit. Playwrights WebKit ist allerdings **nicht** Safari — es
fängt Engine-Unterschiede, ersetzt aber keinen Test auf echtem iOS.
`desktop-chromium` deckt Chrome und Edge ab.

**Warum je Projekt eine eigene Person:** Die Projekte laufen parallel gegen
dieselbe lokale Postgres, die pro Lauf genau einmal zurückgesetzt wird.
`fall-lebenszyklus.spec.ts` setzt voraus, dass die Person noch keinen Fall hat.
Mit einem gemeinsamen Account sähe das zweite Projekt den Fall des ersten — und
zwar gesperrt, weil sein Geräteschlüssel für keinen Wrap dieses Falls vorliegt.
Die Zuordnung Projekt → Variable → Ablage steht in `tests/e2e/nutzer.ts`.

### Das Projekt `kopplung`

`kopplung.spec.ts` fällt aus dem obigen Schema heraus und hat deshalb ein
eigenes Projekt — ohne Setup und ohne gespeicherten Sitzungszustand.

Die Kopplung (DESIGN.md §6) braucht **mehrere Personen gleichzeitig**, jede in
einem eigenen Browserkontext: Die Geräteidentität liegt in IndexedDB
(`core/crypto/keystore.ts`), und die teilen sich zwei Tabs desselben Kontexts.
Zwei Tabs wären ein Gerät, und die Kopplung hätte nichts zu tun. Ein
`storageState` wäre hier sogar schädlich — er brächte in jeden Kontext dieselbe
Person. Jeder Kontext meldet sich darum im Test selbst an.

Dass die vier Personen einen echten Vor- und Nachnamen tragen, ist kein
Beiwerk: Der Bestätigungsscreen aus §6 zeigt genau den, und wer nur eine
Adresse hinterlegt hat, prüft an dieser Stelle nichts.

Der Test läuft nur auf dem Handy-Projekt und nicht zusätzlich auf Desktop: Er
verbraucht je Lauf vier Personen und legt Fälle an, die er nicht wieder
abräumen kann. Ein zweiter Durchlauf derselben Personen liefe gegen bereits
bestehende Fälle. Da `npm run test:e2e` die Datenbank vor jedem Lauf einmal
zurücksetzt, sind die Personen zwischen zwei Läufen wieder unbelastet.

## Einmalig einrichten

1. `npx supabase init` (legt `supabase/config.toml` an) und darin Clerk als
   Drittanbieter-Auth eintragen — **`config.toml` ist gitignored**, also macht
   das jede Person auf ihrem Rechner selbst:

   ```toml
   [auth.third_party.clerk]
   enabled = true
   domain = "honest-hornet-2314.clerk.accounts.dev"
   ```

   Ohne diesen Eintrag weist das lokale PostgREST jedes echte Clerk-JWT ab, und
   jeder Test scheitert mit `permission denied` bzw. leeren Mengen. Die Domain
   steht base64-kodiert im `VITE_CLERK_PUBLISHABLE_KEY`.
2. `npx supabase start` — startet Postgres, PostgREST und Auth lokal.
   **Reihenfolge beachten:** Läuft der Stack schon, bevor Schritt 1 die
   Clerk-Zeilen in `config.toml` schreibt, holt PostgREST das Clerk-JWKS nicht.
   Jeder Test scheitert dann an `No suitable key or wrong key type`. Heilmittel:
   `npx supabase stop && npx supabase start`. Prüfen lässt sich das mit
   `docker inspect supabase_rest_<projekt> --format '{{.Config.Env}}'` — im
   `PGRST_JWT_SECRET` muss ein RSA-Schlüssel mit `kid: ins_…` stehen.
3. Browser holen: `npx playwright install chromium webkit`. Beide Engines sind
   nötig (siehe Tabelle oben), und die Builds sind an die Playwright-Version
   gebunden — nach einem Versionssprung ist der Befehl erneut fällig.
4. Je Browser-Projekt eine Testperson in Clerk anlegen: Dashboard → **Users** →
   **Create user**, oder per CLI:
   ```bash
   clerk users create --email e2e-webkit@gmail.com --password <zufällig> --instance dev --yes
   ```
   Dedizierte Adressen, keine privaten Accounts. Die Instanz verlangt ein
   Passwort, die Tests brauchen es nicht — `@clerk/testing` meldet über ein von
   Clerks Backend-API ausgestelltes Ticket an, nicht über das Formular. Das
   Passwort darf nicht der Adresse entsprechen, das weist Clerk ab.
5. Die Adressen in `.env.test` eintragen:
   ```
   E2E_CLERK_USER_EMAIL_MOBILE_WEBKIT=<adresse-1>
   E2E_CLERK_USER_EMAIL_DESKTOP_CHROMIUM=<adresse-2>
   ```
6. Die vier Personen für `kopplung.spec.ts` anlegen — hier zwingend **mit
   Namen**, siehe oben:
   ```bash
   clerk users create --email e2e-kopplung-a@gmail.com --password <zufällig>      --first-name Anna --last-name Berger --instance dev --yes
   ```
   Ebenso für `-b` (Bernd Claasen), `-c` (Clara Dietrich) und `-d` (Doris
   Engel), und in `.env.test` eintragen:
   ```
   E2E_CLERK_USER_EMAIL_KOPPLUNG_A=<adresse-a>
   E2E_CLERK_USER_EMAIL_KOPPLUNG_B=<adresse-b>
   E2E_CLERK_USER_EMAIL_KOPPLUNG_C=<adresse-c>
   E2E_CLERK_USER_EMAIL_KOPPLUNG_D=<adresse-d>
   ```
   Welche Rolle welche Person spielt, steht in `kopplung.spec.ts`.
   `.env.test` ist gitignored (`.env.*` in der Wurzel-`.gitignore`) und enthält
   sonst denselben `VITE_CLERK_PUBLISHABLE_KEY` wie `.env.local`, dazu
   `CLERK_SECRET_KEY` und die URL/den Anon-Key des lokalen Supabase-Stacks. Den
   Secret Key liefert `clerk env pull --instance dev --file <ziel>`, wenn das
   Clerk-CLI angemeldet und mit der App verknüpft ist (`clerk whoami`).

## Ausführen

```bash
npm run test:e2e        # headless
npm run test:e2e:ui     # Playwright UI Mode, zum Beobachten und Debuggen
```

Beides läuft über `node --env-file=.env.test`, sonst fehlen Supabase- und
Clerk-Variablen. `playwright.config.ts` baut den Build selbst
(`npm run build:test && npm run preview:test`) und wartet, bis
`http://127.0.0.1:4173` antwortet.

## Wie die Anmeldung funktioniert

`tests/e2e/global-setup.ts` holt einmal je Lauf einen Clerk-Testing-Token
(umgeht den Cloudflare-Turnstile-Bot-Schutz aus `build/csp.ts`).
`tests/e2e/auth.setup.ts` läuft als eigenes Playwright-Projekt vor den Specs —
einmal je Browser-Projekt, als `setup-mobile-webkit` und
`setup-desktop-chromium`. Aus dem Projektnamen fällt ab, welche Testperson
gemeint ist und wohin der Sitzungszustand geht: `tests/e2e/.auth/<projekt>.json`
(gitignored — enthält ein echtes Session-Token). Jede Spec startet damit im
eigenen Projekt bereits angemeldet.

## Warum der lokale Supabase-Stack statt eines Branches oder des Dev-Projekts

Supabase-Branches sind ein bezahlter Feature (laufende Compute-Kosten), und
Tests gegen das echte Dev-Projekt liefen neben echten Entwicklungsdaten. Der
lokale Stack ist kostenlos, isoliert und läuft dieselben Migrationen wie die
Cloud (`supabase/migrations/`). `supabase/config.toml` trägt dafür
`[auth.third_party.clerk]` mit der Frontend-API-Domain der Dev-Instanz — ohne
das würde PostgREST lokal ein echtes Clerk-JWT als ungültig zurückweisen.
