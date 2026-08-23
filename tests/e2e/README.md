# E2E-Tests (Playwright)

Laufen gegen den echten Produktionsbuild, lokal serviert (`vite preview`), mit
zwei realen Diensten dahinter:

- **Supabase**: der lokale Docker-Stack aus `npx supabase start` (siehe
  `supabase/README.md`) — kostenlos, kein Cloud-Projekt betroffen.
- **Clerk**: die echte Dev-Instanz aus `.env.local`, aber ausschliesslich über
  eine dedizierte Testperson.

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
3. In Clerk eine Testperson anlegen: Dashboard → **Users** → **Create user**.
   Eine dedizierte E-Mail-Adresse, kein privater Account. Passwort und
   E-Mail-Verifizierung sind egal — `@clerk/testing` meldet sie über eine von
   Clerks Backend-API ausgestellte Anmelde-Ticket an, nicht über das Formular.
4. Diese E-Mail-Adresse in `.env.test` eintragen:
   ```
   E2E_CLERK_USER_EMAIL=<die-angelegte-adresse>
   ```
   `.env.test` ist gitignored (`.env.*` in der Wurzel-`.gitignore`) und enthält
   sonst denselben `VITE_CLERK_PUBLISHABLE_KEY` wie `.env.local`, dazu
   `CLERK_SECRET_KEY` (schon vorhanden, wenn `clerk env pull` einmal lief) und
   die URL/den Anon-Key des lokalen Supabase-Stacks.

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
`tests/e2e/auth.setup.ts` läuft als eigenes Playwright-Projekt vor allen
Specs, meldet die Testperson an und legt den Sitzungszustand unter
`tests/e2e/.auth/user.json` ab (gitignored — enthält ein echtes Session-Token).
Jede Spec im Projekt `mobile-chromium` startet bereits angemeldet.

## Warum der lokale Supabase-Stack statt eines Branches oder des Dev-Projekts

Supabase-Branches sind ein bezahlter Feature (laufende Compute-Kosten), und
Tests gegen das echte Dev-Projekt liefen neben echten Entwicklungsdaten. Der
lokale Stack ist kostenlos, isoliert und läuft dieselben Migrationen wie die
Cloud (`supabase/migrations/`). `supabase/config.toml` trägt dafür
`[auth.third_party.clerk]` mit der Frontend-API-Domain der Dev-Instanz — ohne
das würde PostgREST lokal ein echtes Clerk-JWT als ungültig zurückweisen.
