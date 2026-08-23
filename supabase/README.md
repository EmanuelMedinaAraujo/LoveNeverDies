# Supabase

Schema, RLS und später die eine Edge Function (DESIGN.md §4, §9).

## Das Projekt anlegen

Die Region ist **EU/Frankfurt** (`eu-central-1`) und keine Geschmacksfrage: In
diesen Tabellen liegen die Daten verstorbener Personen und ihrer Angehörigen,
und der Serverbetreiber gilt als neugierig und potenziell aktiv (§11).
Verschlüsselt ist das meiste davon, `user_id`, Zeitstempel und Fallzugehörigkeit
sind es nicht (§3.3).

```bash
supabase login
supabase projects create loveneverdies --region eu-central-1 --org-id <org>
supabase link --project-ref <ref>
```

## Die Migrationen einspielen

```bash
supabase db push
```

Die Kette in `migrations/` läuft von einer leeren Datenbank aus durch; genau das
prüft `tests/db/geraeteschluessel.test.ts` bei jedem Testlauf gegen ein echtes
Postgres (als WASM, ohne Docker). Neue Migrationen kommen mit
`supabase migration new <name>` dazu und werden nie nachträglich geändert —
was einmal eingespielt ist, ist eingespielt.

| Datei                                  | Was darin steht                                    |
| -------------------------------------- | -------------------------------------------------- |
| `20260823120000_geraeteschluessel.sql`  | `device_keys`, ein Gerät je Zeile                  |
| `20260823120100_faelle.sql`             | `cases`, `memberships`, `is_member()`              |
| `20260823120200_geraeteschluessel_rls.sql` | Wer welche Geräteschlüssel sehen und ändern darf |

## Clerk als Auth-Anbieter eintragen

Supabase prüft die Token nicht selbst, sondern akzeptiert die von Clerk. Im
Dashboard unter **Authentication → Sign In / Providers → Third Party Auth** die
Clerk-Domain eintragen. Danach steht in jeder Policy `auth.jwt() ->> 'sub'` für
denselben Clerk-`sub`, der in `memberships.user_id` und `device_keys.user_id`
liegt (§3.3).

Ohne diesen Eintrag antwortet PostgREST auf jede Anfrage mit leeren Mengen —
kein Fehler, keine Zeile. Das ist die richtige Voreinstellung und beim
Einrichten die häufigste Verwechslung.

## Die Zugangsdaten in die App

Projekt-URL und Anon-Key stehen im Dashboard unter **Project Settings → API**
und gehören nach `.env.local`:

```
VITE_SUPABASE_URL=https://<ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon key>
```

Der Anon-Key ist öffentlich und liegt ohnehin im ausgelieferten JavaScript. Was
jemand damit sieht, entscheidet die RLS. Der **Service-Role-Key** umgeht sie
vollständig; er gehört niemals in eine `VITE_`-Variable und niemals ins Repo.
Gebraucht wird er erst von der Edge Function `vault-release` (§3.5), und dort
serverseitig.

`supabase/config.toml` liegt bewusst nicht im Repo: `supabase init` erzeugt sie
passend zur installierten CLI-Version, und eine mitgelieferte Datei aus einer
anderen Version bricht `supabase start`, ohne dass es jemand kommen sieht.
