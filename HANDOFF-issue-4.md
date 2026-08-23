# Handoff: Issue #4 — Trauerfall anlegen (K_c, K_cat, verschlüsselter Fall-Payload)

Branch: `issue-4-trauerfall-anlegen`. Issue: <https://github.com/EmanuelMedinaAraujo/LoveNeverDies/issues/4>

**Der Stand ist absichtlich rot.** `tests/services/fallService.test.ts` importiert
`src/services/fallService.ts`, und diese Datei gibt es noch nicht. Der Test ist die
Spezifikation für den nächsten Schritt — er wurde vor der Implementierung geschrieben und
soll unverändert grün werden.

```
npx vitest run tests/crypto/wrap.test.ts tests/db        # grün (28 Tests)
npx vitest run tests/services/fallService.test.ts        # rot: Modul fehlt
```

---

## Was fertig ist

### Kryptokern

- **`src/core/crypto/wrap.ts`** (neu) — `wrappeSchluessel` / `entpackeSchluessel` / `WrapFehler`.
  Signatur über `"LN-wrap-v1" ‖ case_id ‖ kid ‖ device_id ‖ SHA-256(kem_ct ‖ wrapped_key)`,
  und sie wird **vor** dem Entkapseln geprüft. Ein abgewiesener Wrap wirft `WrapFehler`, ein
  Wrap für ein fremdes Gerät scheitert dagegen erst am GCM-Tag (`AeadFehler`) — die beiden
  Fälle sind bewusst unterscheidbar.
- **`src/core/crypto/sign.ts`** — `signaturSchluesselAusBytes(pkSig)` ergänzt: die
  Gegenrichtung zu `pkSigBytes`, mit Längenprüfung, für `device_keys.sig_public_key`.
- **`src/core/crypto/bytes.ts`** — `bytesText` ergänzt, `TextDecoder` mit `fatal: true`.
- **`tests/crypto/wrap.test.ts`** — 12 Tests, grün.

### Datenbank

- **`supabase/migrations/20260823200000_schluesselwraps.sql`** — Tabelle `key_wraps` nach §4,
  zwei Indizes auf die Fremdschlüssel, RLS:
  - `select`: nur Wraps für die eigenen Geräte
  - `insert`: `is_member(case_id)` **und** `wrapped_by` gehört dem Schreibenden
  - `delete`: nur der Besitzer des betroffenen Geräts
  - **kein** `update` — weder Policy noch Grant. `grant select, insert, delete`.
- **`supabase/migrations/20260823200100_fallanlage.sql`** — `lege_trauerfall_an(...)`,
  `security definer`. Legt `cases` + `memberships` + beide `key_wraps` in einer Transaktion
  an. Prüft: `sub` vorhanden, `p_kid_fall = 'case_<id>:1'`, `p_kid_katalog = 'cat_<id>'`,
  `p_geraet` gehört der angemeldeten Person. `revoke ... from public`, `grant ... to authenticated`.
  Parameterreihenfolge: `(p_fall_id, p_kid_fall, p_kid_katalog, p_payload, p_geraet,
  p_fall_kem_ct, p_fall_wrapped_key, p_fall_signatur, p_kat_kem_ct, p_kat_wrapped_key, p_kat_signatur)`.
- **`tests/db/faelle.test.ts`** — 16 Tests, grün. Deckt die Acceptance Criteria zur Datenbank ab:
  erster Schreiber gewinnt, UPDATE für alle zu, DELETE nur eigenes Gerät, fremder Fall
  unsichtbar auf `cases` und `key_wraps`, RPC atomar und ohne Anmeldung wirkungslos.
- **`tests/db/geraeteschluessel.test.ts`** — Tabellenliste um `key_wraps` erweitert.

### Ports (Schnittstellen, noch ohne Supabase-Umsetzung)

- **`src/core/db/faelle.ts`** — `FallZeile`, `NeuerTrauerfall`, `FaelleTabelle`
  (`legeTrauerfallAn`, `eigene`).
- **`src/core/db/fallschluessel.ts`** — `SchluesselwrapZeile`, `SchluesselwrapTabelle`
  (`fuerGeraet(fallId, geraeteId)`).
- **`src/core/db/geraeteschluessel.ts`** — `nachId(id)` ergänzt (für `wrapped_by` → `pk_sig`).

---

## Was noch fehlt

### 1. `src/services/fallService.ts` — macht den roten Test grün

Der Test gibt die Form vor; hier steht sie noch einmal in Worten:

```ts
export class FallFehler extends Error {}

export type Trauerfallangaben = { personName: string; sterbedatum: string }   // ISO YYYY-MM-DD

export type LesbarerFall = {
  zustand: 'lesbar'
  id: string
  status: Fallstatus            // 'trauerfall' | 'vorsorge'  (aus core/db/faelle.ts)
  personName: string
  sterbedatum: string | null
  kid: string                   // current_kid
  kc: Uint8Array
  kcat: Uint8Array
}
export type GesperrterFall = { zustand: 'gesperrt'; id: string; grund: string }
export type Fall = LesbarerFall | GesperrterFall

export function legeTrauerfallAn(
  faelle: FaelleTabelle, identitaet: Geraeteidentitaet, geraeteId: string,
  angaben: Trauerfallangaben,
): Promise<LesbarerFall>

export function ladeFaelle(
  faelle: FaelleTabelle, wraps: SchluesselwrapTabelle, geraete: GeraeteschluesselTabelle,
  identitaet: Geraeteidentitaet, geraeteId: string,
): Promise<Fall[]>
```

- `zustand` heißt so und nicht `status`, weil `status` schon der Fallstatus aus §2 ist.
- `legeTrauerfallAn`: `crypto.randomUUID()` für die Fall-ID, daraus beide `kid`.
  `K_c` und `K_cat` je `erzeugeAesSchluessel()`. Payload ist
  `JSON.stringify({ personName, sterbedatum })` unter `K_c`. Beide Schlüssel an das eigene
  Gerät wrappen (`identitaet.pkKem`, signiert mit `identitaet.signatur.geheim`).
- Validierung wirft `FallFehler`: leerer/nur-Leerzeichen-Name, Sterbedatum nicht
  `YYYY-MM-DD` oder kein realer Kalendertag (`2026-02-30` muss scheitern).
- `ladeFaelle`: je Fall die Wraps für dieses Gerät holen, `wrappedBy` über
  `geraete.nachId` auflösen, `signaturSchluesselAusBytes(zeile.pkSig)`, verifizieren,
  entpacken, Payload entschlüsseln. **Jeder Fehlschlag ergibt `gesperrt`, kein Wurf** —
  fehlender Wrap, unauffindbares `wrapped_by`, ungültige Signatur, GCM-Tag.
  `grund` ist ein Satz für die Oberfläche.

### 2. Supabase-Adapter

- `src/core/db/supabaseFaelle.ts` — `legeTrauerfallAn` über `client.rpc('lege_trauerfall_an', {...})`
  mit `alsBytea(...)` für jedes Byte-Feld; `eigene()` über `select` auf `cases`
  (RLS filtert), Spalten `id, status, current_kid, key_generation, version, payload, created_at`.
- `src/core/db/supabaseFallschluessel.ts` — `fuerGeraet` über
  `select ... where case_id = ? and device_id = ?`, Byte-Felder durch `ausBytea`.
- `src/core/db/supabaseGeraeteschluessel.ts` — `nachId` ergänzen (`.eq('id', id).maybeSingle()`).
  Vorbild für Fehlerbehandlung und `\x`-Hex-Kodierung ist die bestehende Datei.

### 3. Oberfläche

- `src/hooks/useGeraete.ts` — `AnmeldungZustand` im Zweig `bereit` um `geraet: Geraet`
  erweitern (heute fällt die Zeile weg, aber `geraet.id` ist die `device_id` für die Wraps).
- `src/hooks/useCase.ts` — echter Hook statt der Attrappe. Vorschlag:
  `{ status: 'laedt' | 'kein-fall' | 'fehler' } | { status: 'bereit'; faelle: Fall[]; aktiver: Fall }`
  plus eine Aktion zum Anlegen. Muster für Laden/Fehler/Neuladen steht in `useGeraete.ts`.
- `src/screens/shared/Todesfall/` — Formular Name + Sterbedatum, legt an, navigiert auf `/`.
- Anzeige des Falls nach dem Neuladen: "Hans Weber · Trauerfall seit 12. Mai 2026" (§2).
  Die Beschriftung gehört in ein eigenes kleines Modul mit Test, Vorbild
  `src/services/geraetename.ts` + `tests/services/geraetename.test.ts`; Datum über
  `Intl.DateTimeFormat('de-DE', { day: 'numeric', month: 'long', year: 'numeric' })`.
- `src/screens/shared/KeinFall/KeinFall.tsx` — die erste Schaltfläche scharf schalten
  (die beiden anderen bleiben `disabled`, sie gehören zu späteren Slices).
- `src/screens/shared/Profil/Profil.tsx` — Abschnitt **"Für wen?"** mit dem Namen der Person,
  kein Sammelbegriff (Acceptance Criterion).
- `src/app/App.tsx` — Route `/todesfall`, und `FallSperre` zeigt bei vorhandenem Fall nicht
  mehr `KeinFall`.

### 4. Abschluss

`npm run typecheck`, `npm run lint`, `npm test` (voll), dann `/code-review`, dann committen.
`tests/importBoundaries.test.ts` läuft mit und braucht einen kalten ESLint-Cache-Puffer —
die Timeouts in `vitest.config.ts` sind dafür schon hochgesetzt.

---

## Entscheidungen, die man sonst noch einmal treffen müsste

- **Warum eine RPC und keine INSERT-Policies auf `cases`/`memberships`.** Ein Fall ohne
  Mitgliedschaft ist eine Zeile, die niemand sehen und niemand löschen kann; ein Fall ohne
  Wraps ist nach dem nächsten Neuladen unlesbar, weil `K_c` nur im Arbeitsspeicher lag.
  Beides muss atomar entstehen, und für `cases` gibt es deshalb bewusst keine
  INSERT-Policy — die Langfassung steht im Kopf der Migration.
- **Warum beide `kid` als Parameter, obwohl der Server sie herleiten könnte.** Sie gehen in
  die Wrap-Signatur ein. Bildete der Server sie selbst, führte eine abweichende Schreibweise
  im Client zu einer Signatur, die niemand mehr verifiziert; so scheitert stattdessen der
  Aufruf.
- **Warum `key_wraps` nur die eigenen Wraps lesbar macht**, obwohl jedes Mitglied schreiben
  darf: Ein Wrap gibt `K_c` nicht preis, die Einschränkung kostet nichts und nimmt einer
  späteren Lücke im Kryptokern die Reichweite.
- **`(select auth.jwt()) ->> 'sub'`**, nicht `(select auth.jwt() ->> 'sub')` — sonst meldet
  der Supabase-Linter weiter `auth_rls_initplan`. Der Grund steht in
  `20260823172125_rls_initplan_schreibweise.sql`.
- **Vorsorge ist absichtlich nicht mitgebaut.** Ein Vorsorgefall braucht Preparer, Tresor und
  Commitment (§3.5) und bekommt eine eigene Funktion, statt hier als `status`-Parameter
  mitzulaufen.

Diese Datei wird gelöscht, wenn der Slice fertig ist.
