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

## Schichtung

`core/crypto` importiert weder React noch Supabase, Abhängigkeiten zeigen
ausschließlich nach unten (§9). Das setzt `eslint.config.js` durch, und
`tests/importBoundaries.test.ts` prüft, dass es das wirklich tut. Ein neuer
Ordner unter `src/`, der zu keiner Schicht gehört, lässt den Lint-Lauf
fehlschlagen — sonst ließe sich die Grenze durch Danebenlegen umgehen.
