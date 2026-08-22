# LoveNeverDies

Mobile-first PWA, die Angehörige nach einem Todesfall durch die rechtlichen und
organisatorischen Aufgaben begleitet. Deutschsprachig, Ende-zu-Ende-verschlüsselt,
post-quantum-sicher.

Gebaut für Legal Loves Tech 2026, Abschlusspitch am 27. August 2026.

## 1. Grundentscheidungen

| Bereich         | Entscheidung                                                                   |
| --------------- | ------------------------------------------------------------------------------ |
| Client          | Vite + React + TypeScript, PWA (`vite-plugin-pwa`), mobile-only                |
| Sprache         | Deutsch, durchgehend "Sie"                                                     |
| Auth            | Clerk, hinter einem `AuthProvider`-Adapter (austauschbar)                      |
| Backend         | Supabase (Region EU/Frankfurt): Postgres + RLS + Realtime + Storage            |
| Serverlogik     | Genau eine Edge Function (`vault-release`), sonst nichts                       |
| Autorisierung   | Postgres RLS, von der Datenbank erzwungen, nicht von Anwendungscode            |
| KEM             | X-Wing (`ml_kem768_x25519`) aus `@noble/post-quantum` (Version gepinnt; 0.7.0) |
| Signatur        | ML-DSA-65 + Ed25519, zusammengesetzt; beide müssen verifizieren                |
| Content-Chiffre | AES-256-GCM (WebCrypto)                                                        |
| Secret Sharing  | `shamir-secret-sharing` (Privy-io, auditiert von Cure53 + Zellic; v0.0.3)      |
| Architektur     | Layered mit Feature-Unterordnern, `core/crypto` als importgekapselter Kern     |

Die Signatur ist hybrid aufgebaut wie das KEM. X-Wing kombiniert ML-KEM-768 mit X25519,
die Signatur kombiniert ML-DSA-65 mit Ed25519. Keinem Verfahren wird allein vertraut,
weder beim Verschlüsseln noch beim Signieren. Das kostet 64 zusätzliche Bytes pro
Signatur. Dafür reicht ein Bruch in einem einzelnen Algorithmus nicht aus, um einen
Menschen für tot erklären zu lassen.

---

## 2. Datenmodell: "Fall"

Die zentrale Entität ist ein Fall um genau eine Person.
Zwei verstorbene Elternteile sind zwei Fälle.

- Code und Datenbank: `case`, `case_id`, Fallschlüssel `K_c`
- UI: kein Sammelbegriff. Alles wird über die Person benannt,
  "Hans Weber · Trauerfall seit 12. Mai 2026", "Maria Weber · Vorsorge".
  Der Umschalter in Profil heißt "Für wen?", die Personen heißen "Angehörige".

### Lebenszyklus

```
    ┌──────────────┐   K_v rekonstruiert (k von n)     ┌────────────────┐
    │  vorsorge    │ ────────────────────────────────► │  trauerfall    │
    └──────────────┘                                   └────────────────┘
  Nur Erbe/Dokumente aktiv,                     Tresor geöffnet, Sterbedatum
  Tresor versiegelt, keine Aufgaben             gesetzt, Katalog instanziiert
                                                und erst jetzt eingefroren
```

Ein Fall, der nach einem Todesfall angelegt wird, startet direkt in `trauerfall`. Er hat
keinen Preparer, keinen Tresor und keine Bestätigungsschritte.

Der Preparer bestätigt nie den eigenen Tod. `n` zählt ausschließlich die Angehörigen ohne
ihn.

Den Übergang löst nicht der Freigabezähler aus, sondern ein kryptographischer Nachweis,
dass `K_v` tatsächlich rekonstruiert wurde (§3.5).

---

## 3. Kryptographie

### 3.1 Schlüsselhierarchie

```
GERÄT (IndexedDB)
├── Identitäts-Keypair : X-Wing (ML-KEM-768 + X25519), pro Gerät
│   │   sk_u : 32-Byte-Seed, verlässt das Gerät nie,
│   │          at-rest verschlüsselt unter einem non-extractable AES-GCM CryptoKey
│   │   pk_u : 1216 B, öffentlich, liegt im Klartext auf dem Server
│   │
│   └── entpackt ↓  (X-Wing decapsulate + AES-GCM unwrap)
│       │
│       ├── K_c : Fallschlüssel, AES-256-GCM, pro Fall und Generation
│       │   │     kid = "case_<uuid>:<gen>"
│       │   │     liegt serverseitig ausschließlich als Wrap pro Gerät vor
│       │   │
│       │   └── entpackt ↓
│       │       DEK : pro Item / pro Datei, 32 Byte zufällig, ändert sich nie
│       │       └── verschlüsselt → payload (Postgres) bzw. Dateibytes (Storage)
│       │
│       └── K_p : persönlicher Schlüssel, pro Person UND pro Fall
│                 kid = 32 Byte zufällig, undurchsichtig
│                 verschlüsselt die DEKs privater Aufgaben (§3.7)
│
└── Signatur-Keypair : ML-DSA-65 (1952 B pk) + Ed25519 (32 B pk), pro Gerät
        signiert Tresorfreigaben und Schlüssel-Wraps (§3.5, §3.6)

SEPARAT, nur bei Vorsorge
└── K_v : Tresorschlüssel, AES-256-GCM, verschlüsselt die DEKs der Tresor-Items
    └── Shamir-Split in n Shares, share_i gewrappt an die Geräte von Angehörigem i
        → k Shares nötig zur Rekonstruktion
        → nach dem Split von jedem Gerät gelöscht: niemand besitzt K_v
```

DEKs liegen pro Item, damit eine Schlüsselrotation nur die 32-Byte-DEKs neu wrappen muss.
Der Payload wird dabei nie neu verschlüsselt und eine 15-MB-Datei nie neu hochgeladen.
Rotation eines Falls mit 40 Aufgaben und 10 Scans kostet wenige Kilobyte statt hunderte
Megabyte. `kid` behandelt Schlüsselrotation, `v` behandelt Algorithmuswechsel; die beiden
Achsen sind vollständig entkoppelt.

**Warum ein zweites Keypair.** Ein KEM beweist, dass jemand lesen darf. Wer etwas
geschrieben hat, beweist es nie. Sobald eine einzelne hochgeladene Zeile darüber
entscheidet, ob ein Fall in den Trauerfall kippt, reicht das nicht mehr. X-Wing kann nicht
signieren, also bekommt jedes Gerät ein Signaturpaar dazu.

### 3.2 Envelope-Format (versioniert)

Jeder Ciphertext ist selbstbeschreibend, damit alte und neue Blobs koexistieren können.
Migration läuft lazy. Ein Blob wird erst beim nächsten Schreibzugriff migriert, und es
lässt sich nie beweisen, dass jede Zeile angefasst wurde.

```
payload      := "LN" | v:u8 | alg:u8 | nonce:12B | ciphertext+tag
wrapped_dek  := "LN" | v:u8 | alg:u8 | nonce:12B | ciphertext+tag   (48B Nutzlast)
signature    := "LN" | v:u8 | sig:u8 | mldsa:3309B | ed25519:64B

v   = 1
alg = 1  ->  xwing-mlkem768-x25519 + aes-256-gcm
sig = 1  ->  ml-dsa-65 + ed25519   (beide müssen verifizieren)
```

`kid` steht als Klartextspalte daneben, weil der Server danach gruppieren können muss.

**Domain-Trennung.** Jeder Hash und jede Signatur trägt ein Präfix, damit ein Wert aus
einem Kontext in keinem anderen gilt:

```
"LN-fp-v1"    Geräte-Fingerprint      SHA-256(pk_kem ‖ pk_sig)
"LN-open-v1"  Tresor-Commitment       SHA-256(K_v)
"LN-rel-v1"   Freigabe-Signatur       case_id ‖ user_id ‖ SHA-256(released_share)
"LN-wrap-v1"  Wrap-Signatur           case_id ‖ kid ‖ device_id ‖ SHA-256(kem_ct ‖ wrapped_key)
"LN-cat-v1"   Katalog-Item-ID         HMAC-SHA256(K_c, catalog_task_id)
```

### 3.3 Was der Server sieht

Im Klartext liegen: `case_id`, `seq`, `updated_at`, `kind` (`item` | `file`), `deleted`,
`in_vault`, `kid`, `key_generation`, Mitgliedschaften, öffentliche Geräte- und
Signaturschlüssel, `share_hash` je Share, `vault_commitment`, Freigabesignaturen und die
Zahl der Freigaben.

Verschlüsselt sind: Titel, Beschreibung, Fristen, Zuständigkeit/Assignee, Notizen,
Dokumente, Rechtsgrundlagen, Elternbeziehungen (`parentId`), Abhängigkeiten (`dependsOn`),
Item-Typ, Name und Sterbedatum der verstorbenen Person.

Dass Unteraufgaben eigene Zeilen sind (§7), verrät dem Server nichts über die Baumstruktur.
`kind` unterscheidet nur `item` von `file`, die Elternbeziehung liegt im verschlüsselten
Payload.

> Der Server weiß, wer zu wem gehört. Er weiß nichts über den Inhalt.

Eine Einschränkung gehört offen benannt. Über den Join
`items.kid → personal_key_wraps.kid → user_id` erkennt der Server, welche Items privat sind
und wem sie gehören. Ihren Inhalt sieht er nie. Verbergen ließe sich das nicht, solange
private Items von mehr als einem Gerät lesbar sein sollen: Der Schlüssel muss benannt
werden, damit ihn jemand wiederfindet.

Daraus folgt der Verzicht auf Server-Push. Alle Erinnerungen werden lokal aus
entschlüsselten Fristen geplant und bei jeder Synchronisation neu berechnet. Der
Start-Screen filtert clientseitig nach dem Entschlüsseln.

### 3.4 Schlüsselrotation beim Verlassen eines Falls

Es gibt kein "Entfernen" durch andere, nur freiwilliges Verlassen.

1. Der Client der austretenden Person löscht lokal `sk_u`, `K_c`, `K_p` und den Cache.
2. Die Mitgliedschaft wird gelöscht → RLS sperrt sofort jeden Blob-Zugriff.
3. Ein Trigger setzt `rotation_pending = true` und tombstonet die privaten Items der
   austretenden Person (§3.7). Sonst blieben sie als für niemanden lesbare Zeilen liegen
   und würden bei jeder Synchronisation von jedem Mitglied mitgeladen.
4. Das nächste verbleibende Mitglied, das die App öffnet, rotiert.

**Nebenläufigkeit.** Öffnen zwei Mitglieder gleichzeitig, erzeugten beide ein `K_c` für
Generation +1 und überschrieben sich gegenseitig die Wraps. Geräte, deren Wrap vom
Verlierer stammt, wären dauerhaft ausgesperrt. Deshalb:

```
claim_rotation(case_id, expected_generation, device_id)
    → Zeilensperre auf cases, prüft die Generation, vergibt ein Mandat für 2 Minuten
    → false, wenn ein fremdes Mandat läuft oder die Generation nicht mehr stimmt

… der Mandatsinhaber erzeugt K_c(gen+1), wrappt alle DEKs um, schreibt alle key_wraps …

commit_rotation(case_id, expected_generation, new_kid, device_id)
    → Compare-and-Swap: setzt key_generation nur, wenn sie noch expected_generation ist
```

Das Mandat ist zugleich der einzige Weg, "Schlüssel werden erneuert…" ehrlich anzuzeigen,
statt die App wortlos hängen zu lassen. Läuft es ab, darf ein anderes Mitglied übernehmen;
der CAS am Ende verhindert, dass ein verspäteter Verlierer noch etwas kaputt macht.

`K_p` rotiert dabei nicht. Die austretende Person hat die persönlichen Schlüssel der
anderen nie besessen. Neu gewrappt wird `K_p` ausschließlich, wenn seine Besitzerin ein
Gerät hinzufügt.

> Die austretende Person führt die Rotation nicht selbst durch, sie würde sonst den neuen
> Schlüssel erfahren. Das Zeitfenster bis zur Rotation ist unkritisch, weil der
> Serverzugriff bereits in Schritt 2 endet.

Eine Grenze bleibt. Daten, die vor dem Austritt schon auf das Gerät synchronisiert wurden,
holt keine Software zurück. Rotation schützt gegen ein später gestohlenes Altgerät, gegen
Backups und gegen erneuten Zugriff. Gegen bereits Gelesenes nicht.

### 3.5 Tresor: Verteilen und Freigeben

- `n` = Anzahl Angehöriger ohne Preparer
- `k = max(1, ⌈2n/3⌉)`
- Bei `n = 0` werden keine Shares verteilt. Der Fall trägt den Zustand
  "nicht freigabefähig", und das Onboarding drängt sichtbar auf die erste Einladung.
- Bei `n = 1` ist `k = 1`. Die App sagt das im Klartext: "Solange nur Anna hinterlegt ist,
  kann Anna den Tresor allein öffnen." Ein Schutz vor der einen unehrlichen Person wäre
  wertlos, wenn er den Fall der einen ehrlichen Person mit blockiert.
- Shares werden bei jeder Mitgliederänderung neu verteilt. Das setzt voraus, dass der
  Preparer lebt und online ist. Nach dem Tod frieren `n` und `k` beim letzten Stand ein.

#### Warum der Zähler nichts auslöst

Naheliegend wäre, den Server Freigaben zählen und den Status bei `k` kippen zu lassen. Das
ist angreifbar. Ein Mitglied kann jederzeit einen unbrauchbaren Share hochladen, korrekt
signiert und mit seiner echten Identität, und der Zähler stiege trotzdem. Am Ende stünde
ein `trauerfall` an einer lebenden Person. Einen schlimmeren Fehler kann diese App nicht
machen.

Eine Signatur beweist die Herkunft einer Freigabe, niemals ihre Richtigkeit. Prüfen kann
der Server die Richtigkeit prinzipiell nicht, weil der Share unter `K_c` liegt. Also
entscheidet der Zähler nichts, er zeigt nur an. Die Entscheidung hängt an einem Nachweis,
den nur besitzt, wer `K_v` wirklich rekonstruiert hat.

#### Versiegeln (Gerät des Preparers, bei Vorsorge)

1. `K_v` erzeugen, die Tresor-DEKs darunter wrappen.
2. Shamir-Split in `n` Teile mit Schwelle `k`.
3. `share_i` an jedes Gerät von Angehörigem *i* wrappen → `vault_shares`.
4. `share_hash_i = SHA-256(share_i)` als Klartextspalte ablegen.
5. `vault_commitment = SHA-256("LN-open-v1" ‖ K_v)` als Klartext auf `cases` ablegen.
6. `K_v` löschen. Ab hier besitzt ihn niemand mehr.

#### Freigeben (Gerät von Angehörigem *i*, nach dem Tod)

1. `share_i` mit `sk_u` entpacken.
2. Gegen `share_hash_i` prüfen. Das fängt einen kaputten Wrap ab, bevor irgendetwas
   passiert.
3. Unter `K_c` neu verschlüsseln → `released_share`.
4. `msg = "LN-rel-v1" ‖ case_id ‖ user_id ‖ SHA-256(released_share)` zweifach signieren,
   mit ML-DSA-65 und mit Ed25519.
5. An die Edge Function `vault-release` senden, zusammen mit dem Clerk-JWT.

#### Edge Function `vault-release` (Deno, Service-Role)

Sie prüft das JWT und entnimmt ihm die `user_id`, nie dem Request-Body. Sie prüft, dass
`device_id` dieser Person gehört und dass die Mitgliedschaft besteht. Sie verifiziert beide
Signaturen gegen `device_keys.sig_public_key`. Dann schreibt sie
`insert into vault_releases … on conflict (case_id, user_id) do nothing`.

Der Primärschlüssel `(case_id, user_id)` setzt durch, dass Personen gezählt werden und
nicht Geräte. Von welchem ihrer Geräte jemand signiert, ändert nichts, es entsteht genau
eine Zeile. Direktes INSERT auf `vault_releases` ist per RLS für alle ausgeschlossen.

Ob der Share der richtige ist, kann die Function nicht prüfen. Sie weiß ausschließlich,
dass eine authentifizierte Person X diesen Blob signiert hat.

#### Öffnen (Gerät irgendeines Mitglieds, sobald der Zähler `k` erreicht)

1. Alle `released_share` mit `K_c` entschlüsseln.
2. Jeden gegen sein `share_hash` prüfen. Hier scheitert ein gültig signierter Müll-Share,
   und die App kann benennen, von wem er kam, statt nur "geht nicht" zu melden.
3. Bleiben ≥ `k` gültige Teile: Shamir-Kombination → `K_v`.
4. `proof = SHA-256("LN-open-v1" ‖ K_v)` berechnen.
5. `open_vault(case_id, proof, catalog_version)` aufrufen. Die RPC nimmt eine Zeilensperre,
   vergleicht `proof` mit `vault_commitment`, ist bei bereits gesetztem `trauerfall`
   folgenlos idempotent und setzt sonst Status und `catalog_version` atomar.
6. Danach der Client: Tresor-DEKs von `K_v` auf `K_c` umwrappen (`in_vault = false`),
   Sterbedatum in den Fall-Payload schreiben, Katalog instanziieren (§8).

Das Sterbedatum trägt die Person ein, die die Bestätigung startet. Es wird unter `K_c`
verschlüsselt abgelegt, die Fristen werden clientseitig daraus berechnet.

> **Grenze des Nachweises.** Der `proof` ist wiedereinspielbar, sobald jemand ihn gesehen
> hat. Das bleibt folgenlos, weil der Übergang einmalig und idempotent ist. Ein bösartiger
> Server kann `status` ohnehin direkt setzen. Das Proof-Gate schützt gegen ein bösartiges
> Mitglied, und genau darauf ist das Bedrohungsmodell in §11 zugeschnitten.

### 3.6 Geräte

Der private Schlüssel ist gerätegebunden. Mitgliedschaft überlebt einen Gerätewechsel,
Entschlüsselbarkeit nicht.

- Neues Gerät → neues Keypair-Paar → sieht den Fall, kann synchronisieren, liest aber
  nichts, bis ein anderes Mitglied `K_c` an den neuen öffentlichen Schlüssel wrappt.
- Freigegeben wird in Profil, mit Badge in der unteren Leiste als Hinweis.
- Der Bestätigungsdialog zeigt Name, E-Mail und einen 6-stelligen Prüfcode, den beide
  Seiten vergleichen. Der Code sind die ersten 6 Ziffern von
  `SHA-256("LN-fp-v1" ‖ pk_kem ‖ pk_sig)`.

**Der Fingerprint deckt beide Schlüssel ab.** Deckte er nur den KEM-Schlüssel, könnte ein
bösartiger Server den Signaturschlüssel austauschen, ohne dass der mündliche Abgleich es
bemerkt. Der mündliche Abgleich ist bei dieser Zielgruppe die verletzlichste Stelle des
Protokolls, also darf er nicht die Hälfte übersehen.

**Schutz der Wraps.** `key_wraps` ist insert-only, UPDATE ist entzogen. Der Primärschlüssel
`(case_id, kid, device_id)` sorgt für "erster Schreiber gewinnt", und Rotation erzeugt
ohnehin ein neues `kid`, kollidiert also nie. Jeder Wrap trägt die Signatur des wrappenden
Geräts; das Empfängergerät verifiziert sie, bevor es entpackt. DELETE ist ausschließlich
dem Besitzer des betroffenen Geräts erlaubt, damit er einen fehlerhaften Wrap verwerfen und
sich einen korrekten nachliefern lassen kann.

Ein gestohlenes Clerk-Passwort allein reicht damit nicht zum Entschlüsseln.

**Warum `sk_u` gerätegebunden bleibt.** Es gibt bewusst keinen portablen Seed, keine
Wiederherstellungsphrase und keinen aus dem Login-Passwort abgeleiteten Schlüssel. Drei
Varianten wurden geprüft und verworfen.

Eine Wiederherstellungsphrase verlagert das Problem auf einen Zettel. Die Zielgruppe dieser
App verwahrt ihn im selben Ordner wie die Zugangsdaten. Wer ihn findet, entschlüsselt den
ganzen Nachlass, ohne sich je anmelden zu müssen.

Ein passwortabgeleiteter Schlüssel klingt bequem und macht jeden Passwort-Reset zum
Totalverlust. Clerk setzt das Passwort zurück, ohne den alten Klartext zu kennen; die
Ableitung wäre unwiederbringlich weg. Ein Reset-Klick darf keinen Nachlass vernichten.

WebAuthn-PRF wäre der saubere Weg, weil der Passkey selbst den Schlüssel ableitet. Clerks
Passkey-API reicht WebAuthn-Extensions aber nicht durch, die PRF-Extension ist darüber also
nicht erreichbar. Das begrenzt die Auth-Schicht, nicht der Browser. Fällt die Grenze,
lässt sich der Wiederherstellungsweg nachrüsten, ohne das Datenmodell anzufassen.

Was bleibt, ist der zweite Mensch. Sobald ein weiteres Mitglied im Fall ist, wrappt es
`K_c` an das neue Gerät. Die Lücke davor steht als erste Zeile in §11.

### 3.7 Private Aufgaben

Eine Person muss eine Aufgabe anlegen können, die die anderen Mitglieder nicht sehen. Der
Anlass ist konkret: Wer eine Erbausschlagung erwägt, hat gute Gründe, das nicht mit den
Geschwistern zu teilen, bevor es entschieden ist.

Unter `K_c` geht das nicht, den besitzen alle. Deshalb `K_p`:

- ein Zufallsschlüssel pro Person und Fall, an die eigenen Geräte gewrappt, in
  `personal_key_wraps`. RLS beschränkt Lesen und Schreiben auf die eigene Person, anders
  als bei `key_wraps`, wo jedes Mitglied für andere schreiben darf.
- `kid` ist ein undurchsichtiger Zufallswert, kein sprechender Name.
- Freigeben heißt, den DEK von `K_p` auf `K_c` umzuwrappen. Danach ist es ein gewöhnliches
  Item. Der Codepfad ist derselbe wie bei der Tresorfreigabe in §3.5.
- Freigegebene Aufgaben sind für andere sichtbar, aber nicht bearbeitbar, solange sie ihnen
  nicht zugewiesen sind (§7).

Private Items liegen in derselben `items`-Tabelle wie alles andere und tragen keinen
Marker. Wer sie nicht entschlüsseln kann, filtert sie still weg. Andere Mitglieder laden
sie also mit und verwerfen sie, bei zehn privaten Aufgaben rund 20 KB, einmalig.

> **Preis dieser Entscheidung.** Die Regel "nicht entschlüsselbar → verwerfen" verschluckt
> auch Items, die aus einem echten Defekt heraus unlesbar sind. Einen Zähler übersprungener
> Einträge gibt es ausschließlich im Dev-Modus, in Produktion nie.

Zwei Einschränkungen halten den Aufgabenbaum widerspruchsfrei (§7): Private Aufgaben sind
immer Wurzelaufgaben, und nichts darf von ihnen abhängen.

---

## 4. Datenbankschema

```sql
-- Geräteschlüssel (öffentlich) ---------------------------------------------
create table device_keys (
  id             uuid primary key default gen_random_uuid(),
  user_id        text not null,
  public_key     bytea not null,                   -- X-Wing pk, 1216 B
  sig_public_key bytea not null,                   -- ML-DSA-65 pk ‖ Ed25519 pk
  label          text,                             -- "iPhone von Anna"
  created_at     timestamptz not null default now()
);

-- Fälle -------------------------------------------------------------------
create table cases (
  id                        uuid primary key default gen_random_uuid(),
  status                    text not null check (status in ('vorsorge','trauerfall')),
  version                   bigint not null default 0,   -- Sync-Zähler UND Wasserzeichen
  catalog_version           text,                        -- NULL bis zum Übergang
  key_generation            int  not null default 1,
  current_kid               text not null,
  rotation_pending          boolean not null default false,
  rotation_claimed_by       uuid references device_keys(id) on delete set null,
  rotation_claim_expires_at timestamptz,
  vault_k                   int,
  vault_n                   int,
  vault_commitment          bytea,                       -- SHA-256("LN-open-v1" ‖ K_v)
  preparer_id               text,                        -- Clerk sub, nur bei Vorsorge
  payload                   bytea not null,              -- {personName, sterbedatum?}
  created_at                timestamptz not null default now()
);

-- Mitgliedschaften ---------------------------------------------------------
create table memberships (
  case_id   uuid references cases(id) on delete cascade,
  user_id   text not null,                         -- Clerk sub
  joined_at timestamptz not null default now(),
  primary key (case_id, user_id)
);

-- Fallschlüssel, gewrappt pro Gerät, signiert vom Absender ------------------
create table key_wraps (
  case_id     uuid references cases(id) on delete cascade,
  kid         text not null,
  device_id   uuid references device_keys(id) on delete cascade,
  kem_ct      bytea not null,                      -- X-Wing Ciphertext
  wrapped_key bytea not null,                      -- AES-GCM(ss, K_c)
  wrapped_by  uuid not null references device_keys(id) on delete restrict,
  signature   bytea not null,                      -- "LN-wrap-v1", §3.2
  primary key (case_id, kid, device_id)
);

-- Persönliche Schlüssel (private Aufgaben) ---------------------------------
create table personal_key_wraps (
  case_id     uuid references cases(id) on delete cascade,
  user_id     text not null,
  kid         text not null,                       -- 32 B zufällig, undurchsichtig
  device_id   uuid references device_keys(id) on delete cascade,
  kem_ct      bytea not null,
  wrapped_key bytea not null,                      -- AES-GCM(ss, K_p)
  primary key (case_id, kid, device_id)
);

-- Inhalte ------------------------------------------------------------------
create table items (
  id           uuid primary key,                   -- UUIDv7; Katalog-Items UUIDv5 (§8)
  case_id      uuid not null references cases(id) on delete cascade,
  seq          bigint not null,                    -- vom Trigger, nie vom Client
  updated_at   timestamptz not null default now(),
  kind         text not null check (kind in ('item','file')),
  deleted      boolean not null default false,     -- Tombstone
  in_vault     boolean not null default false,     -- DEK unter K_v statt K_c
  kid          text not null,                      -- K_c-, K_v- oder K_p-Generation
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
  share_index   int  not null,
  share_hash    bytea not null,                    -- SHA-256(share_i), Klartext
  kem_ct        bytea not null,
  wrapped_share bytea not null,
  primary key (case_id, device_id)
);

create table vault_releases (
  case_id          uuid references cases(id) on delete cascade,
  user_id          text not null,                  -- eine Person = eine Zeile
  signed_by_device uuid not null references device_keys(id) on delete restrict,
  released_share   bytea not null,                 -- Share unter K_c
  signature        bytea not null,                 -- "LN-rel-v1", §3.2
  released_at      timestamptz not null default now(),
  primary key (case_id, user_id)
);

-- Kopplungscodes -----------------------------------------------------------
create table pairing_codes (
  code       text primary key,                     -- 8 Zeichen, ohne O/0/I/1
  user_id    text not null,
  device_id  uuid references device_keys(id) on delete cascade,
  purpose    text not null check (purpose in ('join','device')),
  expires_at timestamptz not null,
  consumed   boolean not null default false
);
```

`pairing_codes` trägt keine `case_id`. Ein autorisiertes Neugerät bekommt `K_c` für alle
Fälle, die das freigebende Gerät selbst lesen kann; bei `purpose = 'join'` wählt die
einladende Person den Fall ohnehin auf ihrer Seite. Fälle, die das freigebende Gerät nicht
lesen kann, bleiben gesperrt. Die UI benennt das ausdrücklich ("2 von 3 Fällen
freigeschaltet"), statt es schweigend geschehen zu lassen.

### Sequenz und Türklingel

`bigserial` wäre hier falsch, aus zwei Gründen. Es inkrementiert bei `UPDATE` nicht, also
übersähe der Delta-Sync (`seq > watermark`) jede Änderung und jeden Soft-Delete. Und es
vergibt Nummern vor dem Commit. Eine Transaktion mit `seq = 41` kann nach einer mit
`seq = 42` committen; ein Client liest dazwischen, setzt sein Wasserzeichen auf 42 und
sieht Item 41 nie wieder. Das ist stiller Datenverlust, und er wird mit steigender
Schreiblast wahrscheinlicher.

Beides verschwindet mit einem Pro-Fall-Zähler unter Zeilensperre:

```sql
create function public.items_assign_seq() returns trigger
  language plpgsql as $fn$
declare v bigint;
begin
  -- Sperrt die cases-Zeile: Schreibvorgänge eines Falls serialisieren sich,
  -- damit die Commit-Reihenfolge exakt der seq-Reihenfolge entspricht.
  update cases set version = version + 1
   where id = new.case_id
   returning version into v;
  new.seq        := v;
  new.updated_at := now();
  return new;
end $fn$;

create trigger items_seq before insert or update on items
  for each row execute function public.items_assign_seq();
```

`cases.version` ist damit der Zähler, eine einzige Wahrheit statt zweier. Der billige Check
aus §5 wird `version > watermark`, und die Realtime-Subscription auf die `cases`-Zeile
feuert bei jeder Inhaltsänderung von selbst. Der Durchsatzverlust ist bei Fällen von ≤ 10
Personen kein Argument.

Ein zweiter Trigger verhindert eine Kombination, die sich sonst nicht ausdrücken lässt.
Naheliegend wäre ein `CHECK`, aber Postgres verbietet in Constraints jeden
Unterabfrage-Zugriff auf andere Tabellen, und die Antwort auf "ist dieses `kid` ein
persönliches?" steht in `personal_key_wraps`. Also ein Trigger, mit derselben Wirkung:

```sql
create function public.items_reject_private_vault() returns trigger
  language plpgsql as $fn$
begin
  if new.in_vault and exists (
      select 1 from personal_key_wraps p where p.kid = new.kid) then
    raise exception 'ein privates Item kann nicht im Tresor liegen';
  end if;
  return new;
end $fn$;
```

Ein Tresor-Item ist für die Hinterbliebenen bestimmt. Privat und im Tresor wäre ein Item,
das nach dem Tod niemand mehr öffnen kann, und der Preparer könnte es anlegen, ohne die
Folge zu sehen.

### Aufräumen beim Austritt

```sql
create function public.on_membership_deleted() returns trigger
  language plpgsql security definer set search_path = public as $fn$
begin
  update items i
     set deleted = true, payload = ''::bytea, wrapped_dek = ''::bytea
   where i.case_id = old.case_id
     and exists (select 1 from personal_key_wraps p
                  where p.kid = i.kid and p.user_id = old.user_id);

  delete from personal_key_wraps
   where case_id = old.case_id and user_id = old.user_id;

  update cases set rotation_pending = true where id = old.case_id;
  return old;
end $fn$;
```

**Warum Tombstone statt DELETE.** Die Zeilen wurden zuvor an alle Mitglieder synchronisiert
und liegen in deren Ciphertext-Caches. Ein hartes Löschen käme dort nie an, weil der
Delta-Sync nur Zuwachs trägt. Der Trigger auf `items` hebt dabei `seq` und `version`, die
Aufräumung erreicht die anderen Geräte also auf demselben Weg wie jede andere Änderung.

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

Analog für `cases` und `vault_shares`. Darüber hinaus gilt:

- `key_wraps` lässt jedes Mitglied des Falls schreiben, damit man für andere wrappen kann,
  aber lesen nur die Wraps für die eigenen Geräte. UPDATE gibt es nicht, DELETE nur für den
  Besitzer des betroffenen `device_id`.
- `personal_key_wraps` ist lesbar und schreibbar ausschließlich für die eigene Person.
- `vault_releases` ist für jedes Mitglied lesbar und für niemanden schreibbar. Der einzige
  Weg hinein führt über die Edge Function mit Service-Role.
- `device_keys` ist lesbar für die eigene Person und für alle, mit denen man einen Fall
  teilt, schreibbar nur für sich selbst.
- `pairing_codes` ist nicht offen selektierbar. Eine `security definer`-RPC
  `redeem_pairing_code(code)` löst den Code ein, mit Rate-Limit, 15 Minuten TTL und
  Einmalverwendung.

**Storage.** Bucket `documents`, Pfad `{case_id}/{item_id}`, Policy über
`is_member((storage.foldername(name))[1]::uuid)`.

---

## 5. Synchronisation

### Protokoll

1. Billiger Check: `select version from cases where id = ?`, ein Integer.
   Gleich dem Wasserzeichen → kein Fetch.
2. Delta: `select * from items where case_id = ? and seq > watermark`.
3. Türklingel: Realtime-Subscription auf die `cases`-Zeile. Als Fallback Polling bei Fokus
   und alle 30 Sekunden, nur falls die Subscription nicht verfügbar ist oder fehlgeschlagen
   ist.
4. Tombstones werden nie garbage-collected. Vollständige Resynchronisation ist `seq > 0`.

### Regeln

- Last-Write-Wins über die serverseitig vergebene `seq`, ohne Client-Uhren.
- Löschen gewinnt endgültig. Ein späteres Edit belebt ein Item nicht wieder.
- Offline-Queue in IndexedDB: Jede Mutation wird optimistisch lokal angewandt und angehängt
  (`{op, itemId, payload, ts}`), beim Reconnect abgearbeitet. Item-IDs sind clientseitig
  erzeugte UUIDv7, damit Anlegen offline funktioniert.
- Abgelehnte Mutationen werden nie stillschweigend verworfen, sondern mit ihrem
  entschlüsselten Inhalt als Mitteilung angezeigt ("3 Änderungen konnten nicht gespeichert
  werden").
- Nicht entschlüsselbare Items werden still verworfen. Sie gehören in aller Regel einer
  anderen Person (§3.7). Ein Zähler dafür existiert nur im Dev-Modus.
- Kein Offline-Upload von Dokumenten.
- Tresorfreigabe und `open_vault` erfordern eine Verbindung und gehen nicht in die Queue.
  Eine irreversible, sozial schwere Handlung, deren Wirkung erst Stunden später eintritt,
  ist schlimmer als eine Fehlermeldung im Moment des Tippens. Eine versehentlich
  abgeschickte Todesbestätigung nimmt niemand zurück.

### Cache

Der lokale Cache speichert Ciphertext, byteidentisch zum Server, und entschlüsselt beim
Start in den Speicher. Der Cache auf dem Gerät ist damit genauso verschlüsselt wie der
Server. Entschlüsseln kostet einige Millisekunden; die Ladeanzeige bezieht sich auf den
Netzwerk-Fetch. Gecachte Inhalte werden sofort gerendert, sichtbare Screens aktualisieren
sich nur für tatsächlich geänderte Zeilen.

---

## 6. Kopplung und Einladung

Öffentliche Schlüssel sind zusammen über 3 KB groß. Deshalb ein kurzer Kopplungscode mit
Server-Rendezvous.

```
1. Beitretende:r meldet sich per Clerk an, erzeugt beide Keypairs, lädt sie hoch
2. Server gibt einen kurzen Code zurück:  K4M-7QP2   (ohne O/0/I/1)
3. Code wird telefonisch genannt oder als kleiner QR gezeigt
4. Einladende:r gibt ihn ein und sieht:
      "Anna Müller (anna@...) zum Fall hinzufügen?   Prüfcode: 481 253"
5. Anna sieht denselben Prüfcode -> mündlicher Abgleich
6. Bestätigung -> K_c wird an Annas pk gewrappt, signiert und hochgeladen
7. Annas App ist subscribed und schaltet innerhalb von Sekunden frei
```

Ein öffentlicher Schlüssel ist keine Identität. Deshalb bindet der Server ihn an eine
authentifizierte Clerk-Person, und die einladende Person sieht einen echten Namen, bevor
sie das Familiengeheimnis weitergibt. Der Prüfcode-Abgleich schließt die verbleibende
Lücke, den Schlüsseltausch durch einen bösartigen Server, und deckt beide Schlüssel ab
(§3.6).

Jedes Mitglied darf einladen. Das hier ist eine Familie, keine Organisation.

Der Ablauf für ein neues Gerät ist identisch, nur mit `purpose = device` und Einstieg über
Profil. Freigegeben werden dabei alle Fälle auf einmal, soweit das freigebende Gerät sie
lesen kann.

---

## 7. Oberfläche

### Navigation

Untere Leiste: Start · Erbe · Alle · Profil

| Tab    | Inhalt                                                                                     |
| ------ | ------------------------------------------------------------------------------------------ |
| Start  | H1 "Meine Aufgaben", nur die dem angemeldeten Nutzer zugewiesenen Aufgaben                 |
| Erbe   | Vorsorge / Nachlass-Tresor, Freigabestatus, "Todesfall bestätigen"                         |
| Alle   | Alle Aufgaben des Falls                                                                    |
| Profil | Name, Angehörige, Fallwechsel ("Für wen?"), Geräte, Textgröße, Darstellung, Fall verlassen |

### Onboarding

```
Clerk-Anmeldung
   -> Beide Keypairs erzeugen (still, ~sofort) + navigator.storage.persist()
   -> "Wie möchten Sie die App nutzen?"   Einfach (vorausgewählt) / Erweitert
   -> Dreiteilige Weiche:
        "Ein Todesfall ist eingetreten"    -> Fall in trauerfall, Person + Sterbedatum,
                                              Katalog wird instanziiert und eingefroren
        "Ich möchte für später vorsorgen"  -> Fall in vorsorge, Person = ich selbst
        "Ich wurde eingeladen"             -> Kopplungscode eingeben
```

Die Ansichtswahl kommt vor der Fallweiche, damit alle folgenden Screens bereits im
gewählten Modus erscheinen. Ohne Fall ist die App gesperrt: ein Screen, drei
Schaltflächen.

**Was das Onboarding bewusst nicht enthält.** Keinen Hinweis auf möglichen Speicherverlust
und keinen Installationsschritt. `navigator.storage.persist()` läuft still mit; schlägt es
fehl, sagt die App nichts.

Es geht dabei um Reihenfolge, nicht um Verharmlosung. Ein Mensch, der gerade seinen Vater
verloren hat, kann mit "Ihre Daten können verlorengehen, wenn Ihr Browser Speicher
freigibt" nichts anfangen. Er kann daraus keine Handlung ableiten und trägt die Sorge durch
den ganzen Ablauf. Ein "Zum Home-Bildschirm hinzufügen"-Schritt an derselben Stelle ist ein
technischer Umweg vor der ersten Aufgabe, und ein erheblicher Teil bricht dort ab.
Ausgerechnet dann, wenn das Vertrauen am dünnsten ist.

Beides ist verschoben, nicht gestrichen. Der Installationshinweis erscheint später in
Profil › Geräte, wo er eine Antwort auf eine bereits gestellte Frage ist. Und die
eigentliche Absicherung ist ohnehin die zweite Person im Fall (§3.6). Darauf drängt das
Onboarding sichtbar, denn das ist eine Handlung, die jemand in dieser Lage tatsächlich
ausführen kann.

### Zwei Ansichten

Getrennte Screen-Bäume (`screens/senior`, `screens/advanced`), gemeinsame UI-Primitiven mit
einem `density`-Token. Die einfache Ansicht ist nicht bloß größer gesetzt. Sie zeigt
weniger Elemente pro Screen, verzichtet auf verschachtelte Navigation, benennt Aktionen mit
Verben statt Substantiven und fragt vor jeder destruktiven Aktion nach. Die
Navigationsstruktur bleibt in beiden Modi identisch, damit Angehörige einander am Telefon
helfen können.

### Barrierefreiheit

- Systemeinstellungen werden immer automatisch übernommen: `prefers-reduced-motion`,
  Browser-Textskalierung
- In Profil zusätzlich ein Override, der auf "Systemeinstellung folgen" steht
- Durchgehend `rem`, kein `user-scalable=no`
- WCAG AA Kontrast, Touch-Ziele mindestens 48 px
- Alle Buttons mit Text zum Vorlesen, auch wenn der Text visuell nicht sichtbar ist

### Aufgabendetail

Ganzseitig. Enthält Rechtsgrundlage und Quelle, Frist, Dokumente, Notizen, Unteraufgaben
(eine Ebene, keine Verschachtelung) und optional `dependsOn`. Blockierte Aufgaben erscheinen
ausgegraut mit "Zuerst: …".

**Unteraufgaben sind eigene Zeilen**, keine Liste im Payload der Elternaufgabe. Damit hat
jede referenzierbare Sache eine UUID, und `dependsOn` ist eine schlichte UUID-Liste ohne
Sonderfälle. Wichtiger noch: Hakt Anna offline Unteraufgabe 1 ab und Bert Unteraufgabe 2,
überleben beide, weil LWW pro Zeile greift. Läge alles in einer Zeile, überlebte genau ein
Häkchen, und niemand erführe davon. Über den Baum erfährt der Server dadurch nichts,
`parentId` ist verschlüsselt (§3.3).

**Abschluss.** `erledigt` ist nur bei Blättern ein gespeichertes Feld. Bei Aufgaben mit
Unteraufgaben leitet der Client es bei jedem Rendern aus den Kindern ab. Damit gibt es
nichts zu synchronisieren und nichts, was divergieren kann.

- Eine Aufgabe ohne Unteraufgaben ist ein Blatt und wird direkt abgehakt.
- Eine Aufgabe mit Unteraufgaben gilt genau dann als erledigt, wenn alle Kinder es sind.
- Sind alle Kinder erledigt, gilt sie zwingend als erledigt. Fehlt inhaltlich noch etwas,
  fügt man eine Unteraufgabe hinzu. Das ist ehrlicher als eine Aufgabe, die trotz
  erledigter Kinder offen aussieht.

### Zuweisung

- Eine Aufgabe kann mehreren Personen gleichzeitig zugewiesen sein. "Alle" ist ein eigener
  Zuweisungswert.
- Bearbeiten darf nur, wem sie zugewiesen ist.
- Ist sie niemandem zugewiesen, kann sich jede:r selbst eintragen und sie so reservieren.
  Greifen zwei gleichzeitig zu, gewinnt LWW, und die unterlegene Person bekommt "Bert hat
  diese Aufgabe übernommen" statt eines stillen Verlusts.
- Eine Reservierung ist von jedem wieder lösbar, nicht nur von der reservierenden Person.
  In einer Familie fällt jemand aus, und eine Aufgabe, die niemand mehr freigeben kann,
  blockiert eine gesetzliche Frist.

> **Das ist eine Bearbeitungssperre, kein Zugriffsschutz.** `assignee` ist verschlüsselt,
> der Server kann eine Regel nicht durchsetzen, die er nicht lesen kann. Sie verhindert
> zuverlässig versehentliches Gleichzeitig-Bearbeiten. Sie verhindert nicht, dass ein
> Mitglied mit manipuliertem Client trotzdem schreibt. Das passt zu §11: Für Inhalte sind
> Mitglieder vertrauenswürdig.

### Private Aufgaben

In beiden Ansichten verfügbar. Der Anlass, eine Erbausschlagung zu erwägen, ohne dass die
Geschwister es erfahren, trifft die 78-jährige Witwe mindestens so hart wie den
40-jährigen Sohn. Und sie ist die Person, die in der einfachen Ansicht sitzt.

In der einfachen Ansicht so knapp wie möglich: ein Schalter "Nur für mich" auf der Aufgabe
und genau eine Aktion "Für alle sichtbar machen".

Zwei Regeln, beide beim Anlegen validiert:

- **Private Aufgaben sind immer Wurzelaufgaben.** Hinge eine private Unteraufgabe unter
  einer geteilten, hätte dieselbe Aufgabe für ihre Besitzerin drei Kinder und für alle
  anderen zwei. Die abgeleitete Erledigung zeigte den einen "erledigt" und der anderen
  "offen", ohne dass irgendwo ein Fehler im Code steckt.
- **Nichts darf von einer privaten Aufgabe abhängen.** Umgekehrt ist es erlaubt, "meine
  private Ausschlagung kann erst los, wenn der Erbschein da ist" funktioniert. Zeigte eine
  geteilte Aufgabe auf eine private, hätten die anderen eine UUID, zu der es für sie keine
  Aufgabe gibt. Die Aufgabe bliebe dauerhaft blockiert oder würde fälschlich freigegeben.

### Dokumente

Pro Datei ein zufälliger DEK, clientseitig AES-256-GCM, hochgeladen als eine
Storage-Datei. Maximal 15 MB, keine Chunks. Die Verschlüsselung läuft außerhalb des
Main-Threads, damit die Oberfläche nicht einfriert. Aufnahme direkt aus der App über
`<input type="file" capture="environment">`, in der UI benannt als "Dokument einfach
abfotografieren".

**Löschen entfernt auch die Datei.** Der Client löscht das Storage-Objekt beim Setzen des
Tombstones; ein serverseitiger Aufräumjob entfernt nach 7 Tagen alles, was zu einem
`deleted = true`-Item noch liegt. Die Karenz ist kein Papierkorb, Löschen gewinnt weiterhin
endgültig. Sie existiert nur, damit der Job kein Objekt unter einem Client wegzieht, der
gerade mitten im Download ist.

### Erinnerungen

Rein lokal, aus entschlüsselten Fristen, nach jeder Synchronisation neu geplant. Fristen
sind in der App sichtbar, als Badges und in sortierten Listen.

---

## 8. Rechtsinhalte

Die Juristinnen pflegen eine Tabelle, ein Datensatz pro Aufgabe:

```
id · titel · kurzbeschreibung · frist_tage · frist_ab (sterbedatum|kenntnis|leer)
rechtsgrundlage · zustaendige_stelle · benoetigte_dokumente (;) · subtasks (;)
depends_on (;) · hinweis · quelle_url · kategorie · reihenfolge
```

`pnpm import:content` validiert und erzeugt `src/content/catalog.de.json` (eingecheckt).

- Eine `frist` ohne `rechtsgrundlage` ist ein harter Importfehler.
- Fehlt eine gesetzliche Frist, bleibt das Feld leer. Erfunden wird nichts.
- Rechtsgrundlage und Quelle stehen im Aufgabendetail. Direkter lässt sich die juristische
  Arbeit nicht in das Bewertungskriterium "Rechtliche Qualität" übersetzen.

### Wann der Katalog eingefroren wird

Eingefroren wird beim Übergang nach `trauerfall`, nicht bei der Fallanlage. Ein
Vorsorgefall hat laut §2 gar keine Aufgaben. Bei Anlage würde also etwas eingefroren, das
noch nicht existiert, und ein 2026 angelegter Vorsorgefall instanziierte 2031 das Recht von
2026. Das Einfrieren soll einen laufenden Fall stabil halten, und das greift ab dem
Übergang. Bis dahin ist `catalog_version` NULL. Ein direkt in `trauerfall` angelegter Fall
friert sofort ein, nach derselben Regel, ohne Sonderfall.

Der Katalog initialisiert, mehr nicht. Danach sind es gewöhnliche Items: frei änderbar,
ergänzbar, löschbar. `catalog_version` ist eine Herkunftsangabe ("aufgesetzt aus
Katalogstand 2031-03") und keine lebende Verknüpfung. Rechtsgrundlage und Quelle werden
beim Instanziieren in das Item kopiert und altern mit ihm.

### Instanziierung ist strukturell idempotent

Zwei Clients können gleichzeitig freigeben und beide zu instanziieren beginnen.
Koordinieren kann der Server das nicht, indem er die Aufgaben selbst anlegt; sie sind
Ende-zu-Ende-verschlüsselt. Statt eines Mandats mit Ablauf und Aufräumlogik reicht ein
deterministischer Schlüssel:

```
item_id = UUIDv5(ns, HMAC-SHA256(K_c, "LN-cat-v1" ‖ catalog_task_id))
insert … on conflict do nothing
```

Alle Mitglieder berechnen bitgleiche IDs. Doppelte Instanziierung wird damit unmöglich
statt nur unwahrscheinlich. Der HMAC hat einen zweiten Zweck: Ein schlichtes
`UUIDv5(case_id, catalog_task_id)` könnte der Server für den öffentlichen Katalog
vorberechnen und jede Zeile ihrer Katalogaufgabe zuordnen. Er wüsste dann, wer eine
Erbausschlagung offen hat. Mit `K_c` im HMAC geht das nicht.

### Fristen ab Kenntnis

`frist_ab = kenntnis` betrifft Fristen, die nicht am Sterbedatum hängen. Allen voran die
Ausschlagungsfrist nach § 1944 BGB, die an die Kenntnis des jeweiligen Erben von Anfall und
Berufungsgrund anknüpft. Ein Sohn, der am Sterbetag anwesend war, und ein Bruder, der drei
Wochen später vom Notar erfährt, haben verschiedene Fristenden.

Deshalb liegt `kenntnis_am` pro Person vor und wird nie synchronisiert. Es steckt als
privates Item unter `K_p` (§3.7), ist standardmäßig leer und wird von jeder Person selbst
eingetragen. Aufgaben mit `frist_ab = kenntnis` bleiben ohne dieses Datum fristenlos. Die
App rechnet nicht mit einer Vermutung, denn eine falsch berechnete Ausschlagungsfrist
kostet den ganzen Nachlass.

---

## 9. Projektstruktur

```
src/
  app/            Routing, Provider, Error Boundaries
  core/
    crypto/       envelope.ts  kem.ts  sign.ts  aead.ts  keystore.ts
                  shamir.ts  commitment.ts  fingerprint.ts
    sync/         queue.ts  watermark.ts  realtime.ts  reconciler.ts
    db/           idb.ts (Ciphertext-Cache)  supabase.ts
    auth/         clerkAdapter.ts  (AuthProvider-Interface)
  services/       caseService.ts  taskService.ts  vaultService.ts  documentService.ts
                  pairingService.ts  personalKeyService.ts
  hooks/          useCase.ts  useTasks.ts  useVault.ts  useViewMode.ts  useSync.ts
  screens/
    senior/       Start/  Aufgabe/  Erbe/  Alle/  Profil/
    advanced/     Start/  Aufgabe/  Erbe/  Alle/  Profil/
    shared/       Onboarding/  Beitreten/  KeinFall/
  ui/             Button/  Card/  Checkbox/  Sheet/  Badge/  ProgressRing/  (density-Token)
  content/        catalog.de.json + import-Skript
  types/
supabase/
  migrations/     Schema, Trigger, RPCs, RLS
  functions/
    vault-release/  einzige Edge Function: prüft Signaturen, schreibt vault_releases
docs/
  DESIGN.md
```

Eine Regel hält die Schichtung zusammen: `core/crypto` importiert weder React noch
Supabase, Abhängigkeiten zeigen ausschließlich nach unten. Eine
ESLint-Import-Boundary-Regel setzt das durch, damit der Kryptokern ein herauslösbares,
vollständig getestetes Modul bleibt. `sign.ts` und `commitment.ts` teilen sich die
Domain-Trennungs-Präfixe aus §3.2 mit der Edge Function, und der Verifikationscode dort
nutzt dieselbe `@noble/post-quantum`-Version wie der Client.

---

## 10. Tests

- `core/crypto` gründlich: Envelope-Round-Trip, Versions-Dispatch, Rotation ohne
  Payload-Neuverschlüsselung, Shamir bei `k-1` (muss scheitern) und bei `k` (muss
  gelingen), Fingerprint-Stabilität über beide Schlüssel, zusammengesetzte Signatur (muss
  scheitern, wenn nur eines der beiden Verfahren verifiziert)
- Sequenz-Monotonie: nebenläufige Schreibvorgänge auf denselben Fall. Kein `seq` darf nach
  einem höheren committen, kein Delta darf eine Zeile überspringen.
- `seq` bei UPDATE: ein Edit und ein Soft-Delete müssen im Delta erscheinen
- Proof-Gate: `open_vault` mit falschem `proof` muss scheitern, mit richtigem gelingen und
  beim zweiten Aufruf folgenlos idempotent sein
- Freigabe: ein gültig signierter, inhaltlich falscher Share darf den Zähler heben, aber
  die Rekonstruktion nicht bestehen und den Status nicht kippen
- Signaturprüfung: die Edge Function weist eine Freigabe ab, wenn eine der beiden
  Signaturen falsch ist, wenn `device_id` einer anderen Person gehört oder wenn die
  Mitgliedschaft fehlt, jeweils ohne eine Zeile zu schreiben. Ein Empfängergerät entpackt
  keinen `key_wrap`, dessen Signatur nicht verifiziert.
- Katalog: zwei gleichzeitige Instanziierungen erzeugen identische IDs und keine Duplikate
- Aufräumen: nach dem Austritt sind die privaten Items der Person getombstonet und
  erreichen die übrigen Geräte über den normalen Delta-Sync
- Ausschluss: privat + `in_vault` muss von der Datenbank abgewiesen werden
- Ein Offline-Queue-Replay-Test inklusive abgelehnter Mutation
- Ein RLS-Test: Zugriff auf einen fremden Fall schlägt fehl, `key_wraps` eines fremden
  Geräts sind weder lesbar noch löschbar

---

## 11. Bewusst akzeptierte Grenzen

Diese Liste gehört ins Dokument, nicht zwischen die Zeilen.

**Bedrohungsmodell.** Der Server gilt als neugierig und potenziell aktiv, also auch als
jemand, der Schlüssel austauscht. Mitglieder gelten für Inhalte als vertrauenswürdig, für
Protokollintegrität nicht. Wer im Fall ist, darf lügen, was in einer Aufgabe steht.
Niemand darf einen falschen Trauerfall auslösen, einen fremden Wrap überschreiben oder den
Tresor unbrauchbar machen.

1. **Kein Wiederherstellungsweg.** `sk_u` ist gerätegebunden. Ein Vorsorgefall mit genau
   einem Gerät und ohne gekoppelte Person ist bei Geräteverlust oder gelöschten
   Browserdaten vollständig verloren. Auf iOS greift zusätzlich der 7-Tage-Verfall für
   script-schreibbaren Speicher, sofern die App nicht auf dem Home-Bildschirm liegt. Sobald
   eine zweite Person im Fall ist, greift Peer-Recovery: Sie wrappt `K_c` an das neue
   Gerät. Warum es keinen Seed, keine Wiederherstellungsphrase und keine Passwortableitung
   gibt, steht in §3.6.
2. **XSS im eigenen Origin entschlüsselt alles.** `extractable: false` schützt davor, dass
   die Rohbytes des Schlüssels ausgelesen werden, nicht davor, dass fremder Code im selben
   Origin ihn benutzt. Die Gegenmaßnahme ist eine strikte CSP ohne `unsafe-inline` und eine
   kurze Abhängigkeitsliste, keine Kryptographie.
3. **Der Server kann private Items einer Person zuordnen** (§3.3). Ihren Inhalt sieht er
   nie.
4. **Zuweisungsregeln sind nicht erzwungen** (§7), weil `assignee` verschlüsselt ist.
5. **Nicht entschlüsselbare Items verschwinden stumm** (§3.7), auch solche, die es aus
   einem echten Defekt heraus sind.
6. **Rotation schützt nicht gegen bereits Gelesenes** (§3.4).
7. **Ein bösartiger Server kann den Status direkt setzen.** Das Proof-Gate schützt gegen
   ein bösartiges Mitglied, nicht gegen den Betreiber der Datenbank.

Vorgesehen, aber bewusst nicht in diesem Stand: Signaturen auf `device_keys`. Ein neues
Gerät würde von einem bestehenden gegengezeichnet, wodurch der Prüfcode-Abgleich eine
dauerhafte Spur hinterließe, statt ein einmaliges Ritual zu bleiben. Eine
Trust-on-first-use-Wurzel bliebe auch dann: Das allererste Gerät kann niemand
gegenzeichnen.

---

## 12. Commit-Plan

Conventional Commits, ein Commit pro vertikalem Schnitt, nie pro Schicht.
