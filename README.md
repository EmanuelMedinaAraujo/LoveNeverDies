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

| Befehl              | Wirkung                                                    |
| ------------------- | ---------------------------------------------------------- |
| `npm run dev`       | Dev-Server samt Service Worker                             |
| `npm run build`     | Produktionsbuild inklusive CSP und PWA-Manifest            |
| `npm run preview`   | Den Produktionsbuild lokal ausliefern                      |
| `npm run typecheck` | TypeScript ohne Emit                                       |
| `npm run lint`      | ESLint samt der Importgrenzen aus §9                       |
| `npm test`          | Vitest                                                     |
| `npm run icons`     | PWA-Icons aus den Farbwerten in §12 neu erzeugen           |

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
