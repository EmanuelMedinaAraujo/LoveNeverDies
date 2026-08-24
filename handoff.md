# Handoff: Delta-Sync nach DESIGN.md §5

Branch: `sync/delta-tuerklingel` (von `main`, Stand `e7e6b7e`)

## Was das ist

Umsetzung von §5 aus `DESIGN.md`: Kaltstart aus dem Cache, Delta-Sync über
`seq > watermark`, Türklingel per Realtime auf der `cases`-Zeile, Offline-Queue
mit optimistischer Anzeige. Alle vier Bausteine liegen in `src/core/sync/` und
werden in `src/hooks/useSync.ts` zusammengesetzt; `useAufgaben` sitzt darüber
und entschlüsselt.

## Neu (untracked vor diesem Commit)

| Datei | Zweck |
| --- | --- |
| `supabase/migrations/20260824090000_tuerklingel.sql` | Publikation `cases` für Realtime (Türklingel ohne Nutzlast) |
| `src/core/sync/watermark.ts` | `brauchtDelta`, `geruecktesWasserzeichen` |
| `src/core/sync/queue.ts` | Outbox (`arbeiteAb`), ablehnt Mutationen nie stillschweigend |
| `src/core/sync/reconciler.ts` | `vereine` (LWW über Server-`seq`, Tombstone gewinnt), `wendeAn` (Queue-Overlay) |
| `src/core/sync/realtime.ts` | `tuerklingel` — Realtime-Abo auf die eine `cases`-Zeile |
| `src/core/db/idb.ts` | Ciphertext-Cache + Queue-Persistenz in IndexedDB |
| `src/hooks/useSync.ts` | Rundlauf: Queue → version-Check → Delta → verrechnen → Cache; Reconnect via `online` |
| `tests/sync/*.test.ts(x)`, `tests/db/delta.test.ts` | Einheitstests zu allen Bausteinen — alle grün |

## Geändert

- `src/hooks/useAufgaben.ts` — komplett auf `useSync` umgebaut. Neues
  `AufgabenZustand`: `'laedt' | 'bereit'`; der Status `'fehler'` ist weg,
  stattdessen tragen `bereit` jetzt `laedtNetz` und `netzfehler` (§5: Die Liste
  bleibt stehen, die Ladeanzeige gehört dem Fetch). Dazu neu: `abgelehnt` mit
  entschlüsselten Titeln verworfener Mutationen und `bestaetige()`.
- `src/services/aufgabenService.ts`, `src/core/db/{inhalte,supabaseInhalte,supabaseFaelle,faelle}.ts`
  — Delta-Abfrage `seit(fallId, wasserzeichen)`, `version(fallId)`,
  Batch-Schreiben für die Queue, `beschreibeAbgelehnte`.
- Zugehörige Adapter- und Service-Tests aktualisiert — grün.

## Bekannt kaputt (das ist die Restarbeit)

1. **Typecheck schlägt fehl** (`npm run typecheck`):
   - `src/screens/shared/Alle/Alle.tsx` (~Zeile 259): vergleicht noch gegen den
     entfernten Status `'fehler'`. Auf die neue Form umstellen: Netzfehler als
     Banner neben stehender Liste (`zustand.netzfehler`), Ladeanzeige nur bei
     `laedtNetz`.
   - `tests/screens/Alle.test.tsx`: Fixtures müssen `laedtNetz`/`netzfehler`
     liefern und `'fehler'`-Fälle durch `netzfehler`-Fälle ersetzen.
2. **`tests/hooks/useAufgaben.test.tsx` — 10 von 10 Tests rot.** Die Mocks
   zielen auf die alte API (direktes Nachladen pro Mutation). `useAufgaben`
   hängt jetzt an `useSync` (Queue, Cache, Türklingel); die Tests brauchen
   entweder gemockte Sync-Daten oder ein Rewrite gegen den neuen Ablauf. Erster
   Fehler kommt aus `useAufgaben.ts:88` (`aufgabenAusZeilen`-Mock passt nicht
   mehr zum Aufrufmuster).
3. Danach: `npm run lint`, volle Suite, und einmal
   `npm run test:e2e` (zieht die Migration per `supabase db reset`).

## Verifizieren

```sh
npm run typecheck   # derzeit rot — siehe oben
npm test            # 61/62 Dateien grün, nur useAufgaben.test.tsx rot
npm run lint
```

## Sonstiges

- Kommentare und Bezeichner sind bewusst deutsch gehalten — Stil beibehalten.
- §5 verlangt „byteidentisch zum Server" im Cache; deshalb trägt `useSync`
  Ciphertext und entschlüsselt erst `useAufgaben`. Diesen Schnitt nicht wieder
  zusammenziehen.
- Reihenfolge im Reconciler sortiert über `id` (UUIDv7), nicht `seq` — sonst
  wandert ein abgehaktes Task beim Rendern ans Ende.
