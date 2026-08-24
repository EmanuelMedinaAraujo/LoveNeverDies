-- Geräteschlüssel (DESIGN.md §4)
--
-- Die erste Tabelle des Projekts, weil alles Weitere auf ihr steht: `cases`
-- verweist für den Rotationsanspruch auf sie, `key_wraps` für den Empfänger.
--
-- Hier liegen ausschließlich öffentliche Schlüssel. Der private Seed `sk_u`
-- verlässt das Gerät nie (§3.1) und hat in dieser Tabelle keine Spalte, in die
-- er versehentlich geraten könnte.

create table device_keys (
  id             uuid primary key default gen_random_uuid(),
  user_id        text not null,                    -- Clerk sub
  public_key     bytea not null,                   -- KEM-pk, 1216 B
  sig_public_key bytea not null,                   -- ML-DSA-65 pk ‖ Ed25519 pk
  label          text,                             -- "iPhone von Anna"
  created_at     timestamptz not null default now()
);

create index device_keys_user_id_idx on device_keys (user_id);

-- Ein Gerät, eine Zeile.
--
-- Steht nicht in §4, folgt aber aus §3.6: Die Registrierung läuft bei jedem
-- Start und muss idempotent sein. Ohne diese Zusage legten zwei gleichzeitig
-- geladene Tabs zwei Zeilen für dasselbe Gerät an, und `key_wraps` zeigte
-- danach auf eine davon; welche, entschiede der Zufall. Der Client kann sich
-- darauf verlassen und mit `on conflict` registrieren, statt vorher zu suchen.
create unique index device_keys_pk_unique on device_keys (user_id, public_key);

-- RLS folgt in `20260823120200_geraeteschluessel_rls.sql`: Sie braucht
-- `memberships`, und das braucht `cases`, und das wiederum braucht diese
-- Tabelle. Bis dahin ist die Tabelle eingeschaltet und ohne Policy, also für
-- jede Rolle außer `service_role` leer.
alter table device_keys enable row level security;
