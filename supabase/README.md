# Supabase

Schema, RLS und die Edge Functions (DESIGN.md §4, §9).

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

## Auf einem zweiten Rechner

Das Projekt existiert schon (`pgljqnvkvgusmerruicl`), es wird also nichts
angelegt, sondern nur verknüpft:

```bash
supabase login
supabase link --project-ref pgljqnvkvgusmerruicl
```

`supabase init` ist nicht nötig und wäre eher hinderlich — `link` legt sich
`supabase/.temp/` selbst an, und beides ist gitignored. Ein `db push` direkt
danach meldet, dass nichts zu tun ist; das ist die Probe, dass die Verknüpfung
sitzt.

Was **nicht** aus dem Repo kommt, ist `.env.local` (siehe unten). Und die
Geräteschlüssel schon gar nicht: Der zweite Rechner erzeugt beim ersten Start
ein eigenes Schlüsselpaar und trägt sich als weiteres Gerät in `device_keys`
ein (§3.6). Das ist keine Panne, sondern der Entwurf — der private Seed
verlässt kein Gerät, deshalb *kann* er nicht mitkopiert werden.

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
| `20260823120300_datenapi_zugriff.sql`   | Welche Rolle die Tabellen überhaupt kennt          |
| `20260823171924_rls_initplan.sql`       | Den Clerk-`sub` einmal je Abfrage, nicht je Zeile  |
| `20260823172125_rls_initplan_schreibweise.sql` | Dieselbe Optimierung, für den Linter lesbar |
| `20260823200000_schluesselwraps.sql`    | `key_wraps`, insert-only, mit Signatur je Zeile     |
| `20260823200100_fallanlage.sql`         | `lege_trauerfall_an`: Fall, Mitgliedschaft, Wraps   |
| `20260823210000_aufgaben.sql`           | `items`, Sequenzzähler, Tombstone-Finalität        |
| `20260824090000_tuerklingel.sql`        | Die `cases`-Zeile für Realtime veröffentlichen     |
| `20260824100000_rechtskatalog.sql`      | Katalogstand einfrieren, `lege_trauerfall_an` neu |
| `20260824110000_profile.sql`            | `profiles`: Anzeigename und E-Mail je Person       |
| `20260824110100_mitgliedschaft.sql`     | `on_membership_created`: Beitritt setzt Re-Split   |
| `20260824110200_kopplung.sql`           | `pairing_codes` und die drei Kopplungs-RPCs (§6)   |

`pairing_codes` und `pairing_attempts` haben als einzige Tabellen weder Policy
noch `grant`. Das ist kein Versehen: §4 verlangt, dass Kopplungscodes nicht
offen selektierbar sind, und der einzige Weg an diese Zeilen führt über die drei
`security definer`-Funktionen `erzeuge_kopplungscode`,
`loese_kopplungscode_ein` und `schliesse_kopplung_ab`.

`20260823120300_datenapi_zugriff.sql` ist die unscheinbarste Datei der Kette
und die, ohne die nichts geht. RLS
entscheidet über Zeilen, nicht über Tabellen: Neue Supabase-Projekte erteilen
`anon` und `authenticated` in `public` keine Lese- und Schreibrechte mehr, und
ohne sie antwortet PostgREST mit `permission denied for table` — an jeder
Policy vorbei, die dafür gar nichts kann. `tests/db/postgres.ts` richtet
seither dieselbe Voreinstellung ein, damit ein vergessenes `grant` im Test
auffällt und nicht erst im Browser.

## Dokumente: Bucket und Aufräumjob

`20260824140000_dokumente.sql` legt den privaten Bucket `documents` an (15 MB,
§7), bindet den Pfad eines Dokuments per CHECK an `{case_id}/{item_id}` und
öffnet ihn über drei Policies auf `storage.objects` — lesen, schreiben,
löschen, jeweils für `is_member((storage.foldername(name))[1]::uuid)`. Ein
UPDATE gibt es nicht: Ein Dokument entsteht und wird gelöscht, nie ersetzt.

**Der Aufräumjob ist eine Edge Function und kein SQL-Statement.** Eine Zeile in
`storage.objects` ist der Katalogeintrag, die Bytes liegen im Objektspeicher;
ein `delete` per SQL nähme den Eintrag und liesse die Datei liegen. Die
Plattform weist es deshalb ab („Direct deletion from storage tables is not
allowed"). Die Arbeit ist entsprechend geteilt:

- `public.dokumente_zum_aufraeumen(interval)` sagt, was fällig ist — die Dateien
  zu Items, deren Tombstone älter als die Karenz ist, und die, zu denen nie ein
  Item entstand. Die Funktion steht ausschliesslich `service_role` offen.
- `functions/dokumente-aufraeumen/` holt diese Liste und entfernt sie über die
  Storage-API.

Von Hand ausprobieren, gegen den lokalen Stack:

```bash
supabase functions serve --no-verify-jwt
curl http://127.0.0.1:54321/functions/v1/dokumente-aufraeumen
```

Ausgeliefert und täglich eingeplant wird sie so — die Frist ist sieben Tage,
auf die Stunde kommt es nicht an:

```bash
supabase functions deploy dokumente-aufraeumen
```

Den Zeitplan legt das Dashboard unter **Integrations → Cron** an (täglich,
`30 3 * * *`, Ziel: diese Edge Function). Wer pg_cron und pg_net ohnehin
eingeschaltet hat, kann ihn auch in SQL setzen; der Aufruf braucht dann den
Secret Key im Vault und nicht in der Migration — deshalb steht er nicht in der
Migrationskette, sondern hier.

**Die Karenz ist kein Papierkorb.** Löschen gewinnt endgültig (§5); die sieben
Tage existieren allein, damit der Job kein Objekt unter einem Client wegzieht,
der gerade mitten im Download ist.

## Clerk als Auth-Anbieter eintragen

Supabase prüft die Token nicht selbst, sondern akzeptiert die von Clerk. Im
Dashboard unter **Authentication → Sign In / Providers → Third Party Auth** die
Clerk-Domain eintragen — für die Entwicklungsinstanz dieses Projekts
`honest-hornet-2314.clerk.accounts.dev`. In Clerk gehört umgekehrt unter
**Configure → Integrations** die Supabase-Integration eingeschaltet; erst dann
legt Clerk `"role": "authenticated"` ins Token, und ohne diesen Anspruch landet
jede Anfrage bei `anon` und damit bei `permission denied`.

Danach steht in jeder Policy `auth.jwt() ->> 'sub'` für denselben Clerk-`sub`,
der in `memberships.user_id` und `device_keys.user_id` liegt (§3.3).

Ohne diesen Eintrag prüft Supabase das Clerk-Token gegen niemanden, verwirft es
und behandelt die Anfrage als `anon`. Und weil `anon` seit
`20260823120300_datenapi_zugriff.sql` keine Rechte auf diesen Tabellen hat,
kommt `permission denied for table` zurück — nicht die leere Menge, die man
hier erwartet. Die Meldung nennt die Rolle, nicht die Ursache; wer sie sieht,
sollte zuerst hier nachsehen und nicht in den Policies.

## Die Zugangsdaten in die App

Projekt-URL und Publishable Key stehen im Dashboard unter
**Project Settings → API Keys** und gehören nach `.env.local`:

```
VITE_SUPABASE_URL=https://pgljqnvkvgusmerruicl.supabase.co
VITE_SUPABASE_ANON_KEY=sb_publishable_...
```

Die Variable heißt aus historischen Gründen `ANON_KEY`, enthält aber den neuen
Publishable Key. Beide werden vom selben Gateway akzeptiert; die alten
Legacy-JWT-Keys (`anon`, `service_role`) laufen Ende 2026 aus und sind in
diesem Projekt unter **Settings → API Keys → Legacy API Keys** abgeschaltet.
Wer sie doch verwendet, bekommt `Legacy API keys are disabled` zurück.

Der Publishable Key ist öffentlich und liegt ohnehin im ausgelieferten
JavaScript. Was jemand damit sieht, entscheidet die RLS. Der **Secret Key**
(`sb_secret_...`, früher `service_role`) umgeht sie vollständig; er gehört
niemals in eine `VITE_`-Variable und niemals ins Repo.
Gebraucht wird er serverseitig: von `dokumente-aufraeumen` (§7, siehe oben) und
später von `vault-release` (§3.5). In beiden Fällen setzt Supabase ihn selbst
als `SUPABASE_SERVICE_ROLE_KEY` in die Laufzeit der Funktion — einzutragen ist
er nirgends.

`supabase/config.toml` liegt bewusst nicht im Repo: `supabase init` erzeugt sie
passend zur installierten CLI-Version, und eine mitgelieferte Datei aus einer
anderen Version bricht `supabase start`, ohne dass es jemand kommen sieht.
