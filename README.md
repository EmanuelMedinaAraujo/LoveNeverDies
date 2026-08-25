# LoveNeverDies

Mobile-first PWA, die Angehörige nach einem Todesfall durch die rechtlichen und
organisatorischen Aufgaben begleitet. Deutschsprachig, Ende-zu-Ende-verschlüsselt,
post-quantum-sicher.

Der Entwurf steht in [`docs/DESIGN.md`](docs/DESIGN.md). Er ist die Quelle für
alles Weitere; der Code verweist an den Stellen, an denen es darauf ankommt, mit
Paragraphennummern dorthin.

## Einrichten

```bash
npm install
```

Danach die Clerk-Zugangsdaten holen. Sie stehen **nicht** im Repo — jede Person
zieht sie sich selbst aus der verknüpften Clerk-Anwendung:

```bash
clerk link --app app_3IEII7CYI5MAH2RIajEorZ1Fd8U
clerk env pull --file .env.local
```

Das schreibt `VITE_CLERK_PUBLISHABLE_KEY` (und einen `CLERK_SECRET_KEY`, den
diese App nicht braucht) nach `.env.local`. Die Datei ist gitignored und gehört
dort auch hin: Der Secret Key erlaubt vollen Zugriff auf die Clerk-Instanz, und
was einmal in der Git-History steht, steht dort dauerhaft.

Ohne Clerk-Zugang: `.env.example` nach `.env.local` kopieren und den
Publishable Key eintragen. Er ist öffentlich und liegt ohnehin im ausgelieferten
JavaScript — schützenswert ist allein der Secret Key.

Dazu die Supabase-Zugangsdaten: `VITE_SUPABASE_URL` und
`VITE_SUPABASE_ANON_KEY`. Wie das Projekt angelegt und verknüpft wird, steht in
[`supabase/README.md`](supabase/README.md). Ohne sie läuft die App bis zur
Anmeldung und meldet danach, dass die Geräte nicht abrufbar sind.

```bash
npm run dev
```

## Befehle

| Befehl               | Wirkung                                           |
| -------------------- | ------------------------------------------------- |
| `npm run dev`        | Dev-Server samt Service Worker                    |
| `npm run build`      | Produktionsbuild inklusive CSP und PWA-Manifest   |
| `npm run preview`    | Den Produktionsbuild lokal ausliefern             |
| `npm run preview:cf` | Denselben Build unter Cloudflares Asset-Router    |
| `npm run typecheck`  | TypeScript ohne Emit                              |
| `npm run lint`       | ESLint samt der Importgrenzen aus §9              |
| `npm test`           | Vitest                                            |
| `npm run icons`      | PWA-Icons aus den Farbwerten in §12 neu erzeugen  |
| `npm run deploy:dry` | Bauen und den Deploy prüfen, ohne ihn auszuführen |
| `npm run deploy`     | Bauen und auf Cloudflare ausliefern               |

## Ausliefern

Die App liegt auf Cloudflare Workers unter
<https://loveneverdies.emanuel-andre.workers.dev>. Die Konfiguration steht in
`wrangler.jsonc`.

```bash
npm run deploy
```

Es gibt **kein** `main` und damit keinen Worker-Code: ausgeliefert werden nur
die Dateien aus `dist/`. Wo kein Server-Code läuft, liegt auch kein Schlüssel
und kein Token, das jemand herausholen könnte — alles Serverseitige steht in
Supabase (§4). `not_found_handling: "single-page-application"` sorgt dafür, dass
ein Reload auf `/fall/<id>` nicht im 404 endet; die Routen kennt react-router,
nicht der Hoster.

### Sicherheits-Header

`build/headers.ts` erzeugt beim Bauen eine Datei `dist/_headers`, die Cloudflare
liest und in Response-Header übersetzt. Sie wird nicht selbst ausgeliefert.

Der Grund für die Datei: Ein `<meta http-equiv>` trägt `frame-ancestors` und
`upgrade-insecure-requests` nicht — Browser verwerfen beide an dieser Stelle —,
und wer das erste Byte des Dokuments kontrolliert, kontrolliert auch das
Meta-Tag. Beide Wege fallen aus derselben Quelle (`build/csp.ts`), damit sie
nicht auseinanderlaufen; das Meta-Tag bleibt für den Fall, dass die Datei
niemand liest, etwa unter `npm run preview`.

Dazu HSTS, `nosniff`, `X-Frame-Options`, `Referrer-Policy` und eine
`Permissions-Policy`, die alles abschaltet, was die App nicht braucht. Zwei
Ausnahmen sind bewusst gesetzt und in `build/headers.ts` begründet:
`Cross-Origin-Opener-Policy` steht auf `same-origin-allow-popups`, weil Clerks
Anmelde-Popup sonst seinen Rückweg verliert, und `camera` bleibt offen, weil
hinter dem Beleg-Upload ein `<input type="file" capture="environment">` steht.
Ein `Cross-Origin-Embedder-Policy` gibt es nicht: Weder Clerks Frontend-API noch
Turnstile liefern das nötige CORP-Bekenntnis, die Anmeldung wäre tot.

Geprüft ist das in `tests/build/headers.test.ts`.

### Clerk

Ausgeliefert wird mit der **Entwicklungsinstanz**. Eine Produktionsinstanz
(`pk_live_...`) verlangt eine eigene Domain samt `clerk.<domain>`-CNAME, und
`*.workers.dev` gehört uns nicht. Was das kostet: höchstens 100 Konten, ein
"Development mode"-Hinweis unter dem Anmeldeformular, und die Instanz nimmt
jeden Origin an, statt sich an eine Domain zu binden. Für eine Demo trägt das;
für echte Daten gehört eine Domain davor und danach `clerk deploy`.

ClerkJS meldet standardmäßig Nutzungsdaten an `clerk-telemetry.com`. Das ist in
`core/auth/clerkAdapter.tsx` abgeschaltet — eine App, die ihre Inhalte vor dem
eigenen Server verbirgt, soll ihr Nutzungsverhalten nicht an einen Dritten
geben. Die CSP kennt den Host ohnehin nicht.

## Abhängigkeiten

Alle Versionen sind exakt gepinnt (`save-exact=true` in `.npmrc`). §11.2 nennt
die kurze, kontrollierte Abhängigkeitsliste als Gegenmaßnahme gegen XSS im
eigenen Origin — die Kryptobibliotheken dürfen sich nicht unbemerkt bewegen.

## Kryptokern

`src/core/crypto` steht für sich: kein React, kein Supabase, kein Clerk, und
außer WebCrypto keine Browser-Abhängigkeit — die Edge Function `vault-release`
soll dieselben Präfixe und denselben Verifikationscode benutzen können (§9).

| Datei            | Wofür                                                             |
| ---------------- | ----------------------------------------------------------------- |
| `domain.ts`      | Die fünf Domain-Trennungs-Präfixe aus §3.2, an genau einer Stelle |
| `envelope.ts`    | Das versionierte Format aus §3.2 samt Versions-Dispatch           |
| `aead.ts`        | AES-256-GCM über WebCrypto                                        |
| `kem.ts`         | ML-KEM-768 + X25519: kapseln und entkapseln (zum Namen: §1)       |
| `sign.ts`        | ML-DSA-65 **und** Ed25519; gültig nur, wenn beide verifizieren    |
| `shamir.ts`      | `K_v` teilen und zusammensetzen (ohne `n = 1`, siehe §3.5)        |
| `commitment.ts`  | Tresor-Commitment, Freigabe- und Wrap-Nachricht, Katalog-Item-ID  |
| `fingerprint.ts` | Geräte-Fingerprint und der 6-stellige Prüfcode aus §3.6           |
| `bytes.ts`       | Verketten, Vergleichen, Zufall, SHA-256 und HMAC                  |
| `keystore.ts`    | Der Geräte-Seed in IndexedDB, verschlüsselt und ohne Weg zurück   |

Ein Blob mit unbekanntem `v` oder `aead` wird abgewiesen und nie stillschweigend
falsch gelesen; Migration läuft lazy, also müssen alte und neue nebeneinander
lesbar bleiben. Die Tests dazu liegen in `tests/crypto/`.

## Geräteidentität

Jedes Gerät hat zwei Keypairs (§3.1): ML-KEM-768 + X25519 für den
Schlüsseltransport, ML-DSA-65 + Ed25519 für Signaturen. Beide entstehen bei der
ersten Anmeldung aus einem 96-Byte-Seed, der in IndexedDB liegt — verschlüsselt
unter einem AES-GCM-`CryptoKey` mit `extractable: false`.

Der Seed verlässt das Gerät nie. Es gibt keinen portablen Seed, keine
Wiederherstellungsphrase und keine Ableitung aus dem Login-Passwort; die
Begründungen stehen in §3.6, die Konsequenz als Grenze 1 in §11. Wer sein
einziges Gerät verliert, verliert die Entschlüsselbarkeit — die Absicherung ist
ein zweites Gerät oder eine zweite Person im Fall.

Öffentlich wird davon nur, was öffentlich sein muss: `pk_kem` und `pk_sig`
stehen in `device_keys`. Der Prüfcode aus §3.6 fällt aus beiden zusammen und
steht in Profil → Geräte.

## Kopplung

Öffentliche Schlüssel sind zusammen über 3 KB groß und am Telefon nicht nennbar.
Deshalb der kurze Code mit Server-Rendezvous aus §6: Die beitretende Seite holt
sich acht Zeichen ohne O, 0, I und 1, nennt sie, und die einladende Seite sieht
danach Name, E-Mail und einen sechsstelligen Prüfcode.

```
beitretende Seite            Server                 einladende Seite
─────────────────            ──────                 ────────────────
Code holen ──────────────►   pairing_codes
       │  Code am Telefon ───────────────────────►  Code eingeben
       │                                            Name, E-Mail, Prüfcode
       │  ◄─── Prüfcode mündlich abgleichen ──────────────►  │
       ▼                                            bestätigen
 Fall wird lesbar  ◄────── K_c und K_cat, gewrappt ─────────┘
```

**Der mündliche Abgleich ist der Kern und nicht die Zierde.** Ein öffentlicher
Schlüssel ist keine Identität; dass der Server einen echten Namen dazu liefert,
bindet ihn an eine authentifizierte Clerk-Person, nicht an diesen Schlüssel.
Erst der Vergleich der sechs Ziffern schließt die Lücke — und er deckt beide
Schlüssel ab, weil ein Fingerprint nur über den KEM-Schlüssel den
Signaturschlüssel austauschbar ließe (§3.6).

Derselbe Ablauf gibt ein zweites Gerät derselben Person frei, nur mit
`purpose = device` und Einstieg über Profil. Freigeschaltet werden dabei alle
Fälle, die das freigebende Gerät selbst lesen kann; die übrigen bleiben gesperrt,
und die App benennt die Zahl ("2 von 3 Fällen freigeschaltet"), statt es
schweigend geschehen zu lassen.

`pairing_codes` ist nicht selektierbar. Ein Code lebt 15 Minuten und genau eine
Einlösung, und wer rät, läuft in ein Rate-Limit.

## Datenbank

Schema, RLS und Migrationen liegen unter [`supabase/`](supabase/README.md). Die
Kette wird bei jedem `npm test` gegen ein echtes Postgres eingespielt — PGlite,
also WASM statt Docker —, samt der RLS-Policies aus §4.

## Schichtung

`core/crypto` importiert weder React noch Supabase, Abhängigkeiten zeigen
ausschließlich nach unten (§9). Das setzt `eslint.config.js` durch, und
`tests/importBoundaries.test.ts` prüft, dass es das wirklich tut. Ein neuer
Ordner unter `src/`, der zu keiner Schicht gehört, lässt den Lint-Lauf
fehlschlagen — sonst ließe sich die Grenze durch Danebenlegen umgehen.
