# LoveNeverDies — Design Document

Mobile-first PWA, die Angehörige nach einem Todesfall durch die rechtlichen und
organisatorischen Aufgaben begleitet. Deutschsprachig, Ende-zu-Ende-verschlüsselt,
post-quantum-sicher.

## **Hackathon:** Legal Loves Tech 2026, Abschlusspitch 27. August 2026.

## 1. Grundentscheidungen

| Bereich         | Entscheidung                                                                   |
| --------------- | ------------------------------------------------------------------------------ |
| Client          | Vite + React + TypeScript, PWA (`vite-plugin-pwa`), mobile-only                |
| Sprache         | Deutsch, durchgehend „Sie"                                                     |
| Auth            | Clerk, hinter einem `AuthProvider`-Adapter (austauschbar)                      |
| Backend         | Supabase (Region EU/Frankfurt): Postgres + RLS + Realtime + Storage            |
| Autorisierung   | **Postgres RLS** — von der DB erzwungen, nicht von Anwendungscode              |
| KEM             | X-Wing (`ml_kem768_x25519`) aus `@noble/post-quantum` (Version gepinnt; 0.7.0) |
| Content-Chiffre | AES-256-GCM (WebCrypto)                                                        |
| Secret Sharing  | `shamir-secret-sharing` (Privy-io, auditiert von Cure53 + Zellic; v0.0.3)      |
| Architektur     | Layered mit Feature-Unterordnern, `core/crypto` als importgekapselter Kern     |

---

## 2. Datenmodell: „Fall"

Die zentrale Entität ist **ein Fall um genau eine Person**.
Zwei verstorbene Elternteile sind zwei Fälle.

- **Code/DB:** `case`, `case_id`, Fallschlüssel `K_c`
- **UI:** kein Sammelbegriff. Alles wird über die Person benannt:
  „Hans Weber · Trauerfall seit 12. Mai 2026", „Maria Weber · Vorsorge".
  Der Umschalter in Profil heißt **„Für wen?"**, die Personen heißen **„Angehörige"**.

### Lebenszyklus

```
    ┌──────────────┐   Todesfall bestätigt (k von n)   ┌────────────────┐
    │  vorsorge    │ ────────────────────────────────► │  trauerfall    │
    └──────────────┘                                   └────────────────┘
  Nur Erbe/Dokumente aktiv,                     Tresor geöffnet, Sterbedatum
  Tresor versiegelt, keine Aufgaben             gesetzt, Katalog instanziiert
```

Ein Fall, der **nach** einem Todesfall angelegt wird, startet direkt in `trauerfall`,
hat keinen Preparer, keinen Tresor und keine Bestätigungsschritte.

Der **Preparer bestätigt nie den eigenen Tod** — `n` zählt ausschließlich die Angehörigen
ohne den Preparer.

---

## 3. Kryptographie

### 3.1 Schlüsselhierarchie

```
GERÄT (IndexedDB)
└── Identitäts-Keypair — X-Wing (ML-KEM-768 + X25519), pro Gerät
    │   sk_u : 32-Byte-Seed, verlässt das Gerät nie,
    │          at-rest verschlüsselt unter einem non-extractable AES-GCM CryptoKey
    │   pk_u : ~1,2 KB, öffentlich, liegt im Klartext auf dem Server
    │
    └── entpackt ↓  (X-Wing decapsulate + AES-GCM unwrap)
        K_c — Fallschlüssel, AES-256-GCM, pro Fall und Generation
        │     kid = "case_<uuid>:<gen>"
        │     liegt serverseitig ausschließlich als Wrap pro Gerät vor
        │
        └── entpackt ↓
            DEK — pro Item / pro Datei, 32 Byte zufällig, ändert sich nie
            └── verschlüsselt → payload (Postgres) bzw. Dateibytes (Storage)

SEPARAT, nur bei Vorsorge
└── K_v — Tresorschlüssel, AES-256-GCM, verschlüsselt die DEKs der Tresor-Items
    └── Shamir-Split in n Shares, share_i gewrappt an die Geräte von Angehörigem i
        → k Shares nötig zur Rekonstruktion
```

**Warum DEKs pro Item:** Eine Schlüsselrotation muss dann nur die 32-Byte-DEKs neu
wrappen — nie den Payload und nie eine 15-MB-Datei neu hochladen. Rotation eines Falls
mit 40 Aufgaben und 10 Scans kostet wenige Kilobyte statt hunderte Megabyte. `kid`
behandelt Schlüsselrotation, `v` behandelt Algorithmuswechsel; die beiden Achsen sind
vollständig entkoppelt.

### 3.2 Envelope-Format (versioniert)

Jeder Ciphertext ist selbstbeschreibend, damit alte und neue Blobs koexistieren können.
Migration ist **lazy**: ein Blob wird erst beim nächsten Schreibzugriff migriert, und es
lässt sich nie beweisen, dass jede Zeile angefasst wurde.

```
payload      := "LN" | v:u8 | alg:u8 | nonce:12B | ciphertext+tag
wrapped_dek  := "LN" | v:u8 | alg:u8 | nonce:12B | ciphertext+tag   (48B Nutzlast)

v   = 1
alg = 1  ->  xwing-mlkem768-x25519 + aes-256-gcm
```

`kid` steht als Klartextspalte daneben, weil der Server danach gruppieren können muss.

### 3.3 Was der Server sieht

**Klartext:** `case_id`, `seq`, `updated_at`, `kind` (`item` | `file`), `deleted`, `kid`,
Mitgliedschaften (wer gehört zu welchem Fall), öffentliche Geräteschlüssel.

**Verschlüsselt:** Titel, Beschreibung, Fristen, Zuständigkeit/Assignee, Notizen,
Dokumente, Rechtsgrundlagen, Elternbeziehungen (`parentId`), Abhängigkeiten
(`dependsOn`), Item-Typ, Name und Sterbedatum der verstorbenen Person.

> Der Server weiß, wer zu wem gehört. Er weiß nichts über den Inhalt.

Konsequenz, bewusst akzeptiert: **Kein Server-Push.** Alle Erinnerungen werden lokal aus
entschlüsselten Fristen geplant und bei jeder Synchronisation neu berechnet. Der
Start-Screen filtert clientseitig nach dem Entschlüsseln.

### 3.4 Schlüsselrotation beim Verlassen eines Falls

Es gibt kein „Entfernen" durch andere — nur freiwilliges Verlassen.

1. Der Client der austretenden Person **löscht lokal** `sk_u`, `K_c` und den gesamten Cache.
2. Die Mitgliedschaft wird gelöscht → RLS sperrt sofort **jeden** Blob-Zugriff.
3. Der Server setzt `rotation_pending = true`.
4. **Das nächste verbleibende Mitglied**, das die App öffnet, rotiert: neues `K_c`
   (Generation +1), alle DEKs neu gewrappt, neue `key_wraps` für alle verbleibenden Geräte.

> Die austretende Person führt die Rotation **nicht** selbst durch — sie würde sonst den
> neuen Schlüssel erfahren. Das Zeitfenster bis zur Rotation ist unkritisch, weil der
> Serverzugriff bereits in Schritt 2 endet.

**Ehrliche Grenze:** Daten, die vor dem Austritt bereits auf das Gerät synchronisiert
wurden, kann keine Software zurückholen. Rotation schützt gegen ein später gestohlenes
Altgerät, gegen Backups und gegen einen erneuten Zugriff — nicht gegen bereits Gelesenes.

### 3.5 Tresor: Verteilen und Freigeben

- `n` = Anzahl Angehöriger **ohne** Preparer
- `k` = 'ceil(2n/3)'
- Shares werden bei jeder Mitgliederänderung **neu verteilt** — das setzt voraus, dass der
  Preparer lebt und online ist. Nach dem Tod frieren `n` und `k` beim letzten Stand ein.

**Freigabeprotokoll** (der Server lernt dabei nichts):

1. Angehörige:r _i_ entschlüsselt den eigenen Share mit `sk_u`.
2. Verschlüsselt ihn **unter `K_c`** neu (den alle Mitglieder besitzen) und lädt ihn hoch.
3. Der Server zählt nur — er kann „2 von 3 haben bestätigt" anzeigen, ohne etwas zu erfahren.
4. Sobald `k` freigegebene Shares vorliegen, rekonstruiert der Client von irgendjemandem
   lokal `K_v`, wrappt die Tresor-DEKs unter `K_c` um (der Tresor wird zu normalem Inhalt),
   setzt `status = trauerfall` samt Sterbedatum und instanziiert den Aufgabenkatalog.

Das Sterbedatum trägt die Person ein, die die Bestätigung **startet**; es wird unter `K_c`
verschlüsselt abgelegt, die Fristen werden clientseitig daraus berechnet.

### 3.6 Geräte

Der private Schlüssel ist **gerätegebunden**. Mitgliedschaft überlebt einen Gerätewechsel,
Entschlüsselbarkeit nicht.

- Neues Gerät → neues Keypair → sieht den Fall, kann synchronisieren, **liest aber nichts**,
  bis ein anderes Mitglied `K_c` an den neuen öffentlichen Schlüssel wrappt.
- Freigabe erfolgt in **Profil**, mit Badge in der unteren Leiste als Hinweis.
- Bestätigungsdialog zeigt Name, E-Mail und einen 6-stelligen Prüfcode (erste 6 Ziffern von
  SHA-256 über `pk_u`), den beide Seiten vergleichen.

Damit gilt: **ein gestohlenes Clerk-Passwort allein reicht nicht zum Entschlüsseln.**

**Bewusst akzeptiertes Risiko (Entscheidung: kein Backup).**

---

## 4. Datenbankschema

```sql
-- Fälle -------------------------------------------------------------------
create table cases (
  id               uuid primary key default gen_random_uuid(),
  status           text not null check (status in ('vorsorge','trauerfall')),
  version          bigint not null default 0,      -- Sync-Türklingel
  catalog_version  text,                           -- bei Anlage eingefroren
  rotation_pending boolean not null default false,
  current_kid      text not null,
  vault_k          int,                            -- Shamir-Schwelle
  vault_n          int,
  preparer_id      text,                           -- Clerk sub, nur bei Vorsorge
  payload          bytea not null,                 -- {personName, sterbedatum?} unter K_c
  created_at       timestamptz not null default now()
);

-- Mitgliedschaften ---------------------------------------------------------
create table memberships (
  case_id   uuid references cases(id) on delete cascade,
  user_id   text not null,                         -- Clerk sub
  joined_at timestamptz not null default now(),
  primary key (case_id, user_id)
);

-- Geräteschlüssel (öffentlich) ---------------------------------------------
create table device_keys (
  id         uuid primary key default gen_random_uuid(),
  user_id    text not null,
  public_key bytea not null,                       -- X-Wing pk, ~1,2 KB
  label      text,                                 -- "iPhone von Anna"
  created_at timestamptz not null default now()
);

-- Fallschlüssel, gewrappt pro Gerät ----------------------------------------
create table key_wraps (
  case_id     uuid references cases(id) on delete cascade,
  kid         text not null,
  device_id   uuid references device_keys(id) on delete cascade,
  kem_ct      bytea not null,                      -- X-Wing Ciphertext
  wrapped_key bytea not null,                      -- AES-GCM(ss, K_c)
  primary key (case_id, kid, device_id)
);

-- Inhalte ------------------------------------------------------------------
create table items (
  id           uuid primary key,                   -- clientseitig, UUIDv7
  case_id      uuid not null references cases(id) on delete cascade,
  seq          bigserial,                          -- serverseitig, treibt LWW
  updated_at   timestamptz not null default now(),
  kind         text not null check (kind in ('item','file')),
  deleted      boolean not null default false,     -- Tombstone
  in_vault     boolean not null default false,     -- DEK unter K_v statt K_c
  kid          text not null,
  wrapped_dek  bytea not null,
  payload      bytea not null,
  storage_path text                                -- nur bei kind = 'file'
);
create index on items (case_id, seq);

-- Tresor -------------------------------------------------------------------
create table vault_shares (
  case_id       uuid references cases(id) on delete cascade,
  user_id       text not null,
  device_id     uuid references device_keys(id) on delete cascade,
  kem_ct        bytea not null,
  wrapped_share bytea not null,
  primary key (case_id, device_id)
);

create table vault_releases (
  case_id        uuid references cases(id) on delete cascade,
  user_id        text not null,
  released_share bytea not null,                   -- Share unter K_c
  released_at    timestamptz not null default now(),
  primary key (case_id, user_id)
);

-- Kopplungscodes -----------------------------------------------------------
create table pairing_codes (
  code       text primary key,                     -- 8 Zeichen, ohne O/0/I/1
  user_id    text not null,
  device_id  uuid references device_keys(id) on delete cascade,
  purpose    text not null check (purpose in ('join','device')),
  case_id    uuid,                                 -- nur bei purpose = 'device'
  expires_at timestamptz not null,
  consumed   boolean not null default false
);
```

### RLS

```sql
create function public.is_member(p_case uuid) returns boolean
  language sql security definer stable set search_path = public as $fn$
  select exists (
    select 1 from memberships m
    where m.case_id = p_case and m.user_id = auth.jwt() ->> 'sub');
$fn$;

alter table items enable row level security;
create policy items_read  on items for select using (is_member(case_id));
create policy items_write on items for insert with check (is_member(case_id));
create policy items_edit  on items for update using (is_member(case_id));
-- kein DELETE: Löschen erfolgt ausschließlich über deleted = true
```

Analog für `cases`, `key_wraps`, `vault_shares`, `vault_releases`.

Bei `key_wraps` gilt asymmetrisch: **lesen** darf man nur Wraps für die eigenen Geräte,
**schreiben** darf jedes Mitglied des Falls (damit man für andere wrappen kann).

`device_keys`: lesbar für die eigene Person und für alle, mit denen man einen Fall teilt;
schreibbar nur für sich selbst.

Kopplungscodes werden **nicht** offen selektierbar gemacht, sondern über eine
`security definer`-RPC `redeem_pairing_code(code)` eingelöst — mit Rate-Limit, 15 Minuten
TTL und Einmalverwendung.

**Storage:** Bucket `documents`, Pfad `{case_id}/{item_id}`, Policy über
`is_member((storage.foldername(name))[1]::uuid)`.

---

## 5. Synchronisation

### Protokoll

1. **Billiger Check:** `select version from cases where id = ?` — ein Integer.
   Gleich dem Wasserzeichen → kein Fetch.
2. **Delta:** `select * from items where case_id = ? and seq > watermark`.
3. **Türklingel:** Realtime-Subscription auf die `cases`-Zeile.
   **Fallback:** Polling bei Fokus und alle 30 Sekunden. Nur falls subscription nicht verfügbar oder fehlgeschlagen.
4. **Tombstones** werden nie garbage-collected; vollständige Resynchronisation ist `seq > 0`.

### Regeln

- **Last-Write-Wins** über die serverseitig vergebene `seq` (keine Client-Uhren).
- **Löschen gewinnt endgültig** — ein späteres Edit belebt ein Item nicht wieder.
- **Offline-Queue** in IndexedDB: jede Mutation wird optimistisch lokal angewandt und
  angehängt (`{op, itemId, payload, ts}`), beim Reconnect abgearbeitet. Item-IDs sind
  clientseitig erzeugte **UUIDv7**, damit Anlegen offline funktioniert.
- **Abgelehnte Mutationen** werden nie stillschweigend verworfen, sondern mit ihrem
  entschlüsselten Inhalt also Mitteilung angezeigt („3 Änderungen konnten nicht gespeichert werden").
- **Kein Offline-Upload von Dokumenten.**

### Cache

Der lokale Cache speichert **Ciphertext**, byteidentisch zum Server, und entschlüsselt beim
Start in den Speicher. Der Cache auf dem Gerät ist damit genauso verschlüsselt wie der
Server. Entschlüsseln kostet einige Millisekunden; die Ladeanzeige bezieht sich auf den
Netzwerk-Fetch. Gecachte Inhalte werden sofort gerendert, sichtbare Screens aktualisieren
sich nur für tatsächlich geänderte Zeilen.

---

## 6. Kopplung und Einladung

Öffentliche Schlüssel sind ~1,2 KB. Deshalb: **kurzer Kopplungscode mit Server-Rendezvous.**

```
1. Beitretende:r meldet sich per Clerk an, erzeugt Keypair, lädt pk hoch
2. Server gibt einen kurzen Code zurück:  K4M-7QP2   (ohne O/0/I/1)
3. Code wird telefonisch genannt oder als kleiner QR gezeigt
4. Einladende:r gibt ihn ein und sieht:
      "Anna Müller (anna@...) zum Fall hinzufügen?   Prüfcode: 481 253"
5. Anna sieht denselben Prüfcode -> mündlicher Abgleich
6. Bestätigung -> K_c wird an Annas pk gewrappt und hochgeladen
7. Annas App ist subscribed und schaltet innerhalb von Sekunden frei
```

Ein öffentlicher Schlüssel ist **keine Identität** — deshalb bindet der Server ihn an eine
authentifizierte Clerk-Person, und die einladende Person sieht einen echten Namen, bevor
sie das Familiengeheimnis weitergibt. Der Prüfcode-Abgleich schließt die verbleibende Lücke
(Schlüsseltausch durch einen bösartigen Server).

**Jedes Mitglied darf einladen** — das ist eine Familie, keine Organisation.

Der Ablauf für ein **neues Gerät** ist identisch, nur mit `purpose = device` und Einstieg
über Profil.

---

## 7. Oberfläche

### Navigation

Untere Leiste: **Start · Erbe · Alle · Profil**

| Tab        | Inhalt                                                                                     |
| ---------- | ------------------------------------------------------------------------------------------ |
| **Start**  | H1 „Meine Aufgaben" — nur die dem angemeldeten Nutzer zugewiesenen Aufgaben                |
| **Erbe**   | Vorsorge / Nachlass-Tresor, Freigabestatus, „Todesfall bestätigen"                         |
| **Alle**   | Alle Aufgaben des Falls                                                                    |
| **Profil** | Name, Angehörige, Fallwechsel („Für wen?"), Geräte, Textgröße, Darstellung, Fall verlassen |

### Onboarding

```
Clerk-Anmeldung
   -> Keypair erzeugen (still, ~sofort) + navigator.storage.persist()
   -> "Wie möchten Sie die App nutzen?"   Einfach (vorausgewählt) / Erweitert
   -> Dreiteilige Weiche:
        "Ein Todesfall ist eingetreten"    -> Fall in trauerfall, Person + Sterbedatum,
                                              Katalog wird instanziiert
        "Ich möchte für später vorsorgen"  -> Fall in vorsorge, Person = ich selbst
        "Ich wurde eingeladen"             -> Kopplungscode eingeben
```

Die Ansichtswahl kommt **vor** der Fallweiche, damit alle folgenden Screens bereits im
gewählten Modus erscheinen. Ohne Fall ist die App gesperrt: ein Screen, drei Schaltflächen.

### Zwei Ansichten

Getrennte Screen-Bäume (`screens/senior`, `screens/advanced`), gemeinsame UI-Primitiven mit
einem `density`-Token. Die einfache Ansicht unterscheidet sich nicht nur in der Größe:
weniger Elemente pro Screen, keine verschachtelte Navigation, Verben statt Substantive,
Rückfrage vor jeder destruktiven Aktion. Die Navigationsstruktur bleibt in beiden Modi
identisch, damit Angehörige einander am Telefon helfen können.

### Barrierefreiheit

- Systemeinstellungen werden **immer automatisch übernommen**: `prefers-reduced-motion`, Browser-Textskalierung
- In Profil zusätzlich ein Override, der auf **„Systemeinstellung folgen"** steht
- Durchgehend `rem`, **kein** `user-scalable=no`
- WCAG AA Kontrast, Touch-Ziele mindestens 48 px
- Alle Buttons mit Text zum Vorlesen (auch wenn Text visuell nicht sichtbar)

### Aufgabendetail

Ganzseitig. Enthält Unteraufgaben (eine Ebene, keine Verschachtelung), optional
`dependsOn` — blockierte Unteraufgaben erscheinen ausgegraut mit „Zuerst: …" — sowie
**Rechtsgrundlage und Quelle**, Frist, Dokumente und Notizen.

**Eine Aufgabe kann erst abgeschlossen werden, wenn alle Unteraufgaben erledigt sind.**
Parent Aufgaben können nicht manuell abgeschlossen werden, sondern nur automatisch, wenn alle Kinder Aufgaben erledigt sind.

### Dokumente

Pro Datei ein zufälliger DEK, clientseitig AES-256-GCM, als **eine** Storage-Datei
hochgeladen. **Maximal 15 MB, keine Chunks.** Verschlüsselung läuft außerhalb des
Main-Threads, damit die Oberfläche nicht einfriert. Aufnahme direkt aus der App über
`<input type="file" capture="environment">` — „Dokument einfach abfotografieren".

### Erinnerungen

Rein lokal, aus entschlüsselten Fristen, nach jeder Synchronisation neu geplant. Fristen in-App sichtbar (Badges, sortierte Listen).

---

## 8. Rechtsinhalte

Die Juristinnen pflegen eine Tabelle, ein Datensatz pro Aufgabe:

```
id · titel · kurzbeschreibung · frist_tage · frist_ab (sterbedatum|kenntnis|leer)
rechtsgrundlage · zustaendige_stelle · benoetigte_dokumente (;) · subtasks (;)
depends_on (;) · hinweis · quelle_url · kategorie · reihenfolge
```

`pnpm import:content` validiert und erzeugt `src/content/catalog.de.json` (eingecheckt).

- **Harter Fehler**, wenn eine `frist` ohne `rechtsgrundlage` gesetzt ist.
- Fehlt eine gesetzliche Frist, bleibt das Feld **leer** — es wird nichts erfunden.
- Der Katalog wird bei Fallanlage über `catalog_version` **eingefroren**; spätere
  Katalogänderungen wirken nicht rückwirkend.
- Rechtsgrundlage und Quelle sind **im Aufgabendetail sichtbar** — das ist die direkteste
  Übersetzung der juristischen Arbeit in das Bewertungskriterium „Rechtliche Qualität".

---

## 9. Projektstruktur

```
src/
  app/            Routing, Provider, Error Boundaries
  core/
    crypto/       envelope.ts  kem.ts  aead.ts  keystore.ts  shamir.ts  fingerprint.ts
    sync/         queue.ts  watermark.ts  realtime.ts  reconciler.ts
    db/           idb.ts (Ciphertext-Cache)  supabase.ts
    auth/         clerkAdapter.ts  (AuthProvider-Interface)
  services/       caseService.ts  taskService.ts  vaultService.ts  documentService.ts
                  pairingService.ts
  hooks/          useCase.ts  useTasks.ts  useVault.ts  useViewMode.ts  useSync.ts
  screens/
    senior/       Start/  Aufgabe/  Erbe/  Alle/  Profil/
    advanced/     Start/  Aufgabe/  Erbe/  Alle/  Profil/
    shared/       Onboarding/  Beitreten/  KeinFall/
  ui/             Button/  Card/  Checkbox/  Sheet/  Badge/  ProgressRing/  (density-Token)
  content/        catalog.de.json + import-Skript
  types/
supabase/
  migrations/     Schema + RLS
docs/
  DESIGN.md
```

**Regel, die die Schichtung vor dem Verfall bewahrt:** `core/crypto` importiert weder React
noch Supabase; Abhängigkeiten zeigen ausschließlich nach unten. Durchgesetzt per
ESLint-Import-Boundary-Regel, damit der Kryptokern ein herauslösbares, vollständig
getestetes Modul bleibt.

---

## 10. Tests

- `core/crypto` gründlich: Envelope-Round-Trip, Versions-Dispatch, Rotation ohne
  Payload-Neuverschlüsselung, Shamir bei `k-1` (muss scheitern) und bei `k` (muss gelingen),
  Fingerprint-Stabilität
- Ein Offline-Queue-Replay-Test inklusive abgelehnter Mutation
- Ein RLS-Test: Zugriff auf einen fremden Fall schlägt fehl

---

## 11. Commit-Plan

Conventional Commits, **ein Commit pro vertikalem Schnitt** — nie pro Schicht.
