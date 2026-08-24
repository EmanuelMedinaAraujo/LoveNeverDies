-- Fälle und Mitgliedschaften (DESIGN.md §4)
--
-- Angelegt wird ein Fall erst im nächsten Slice; hier entstehen die Tabellen und
-- die eine Funktion, an der jede weitere Policy dieses Projekts hängt.

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
  vault_resplit_pending     boolean not null default false,
  vault_k                   int,
  vault_n                   int,
  vault_commitment          bytea,                       -- SHA-256("LN-open-v1" ‖ K_v)
  preparer_id               text,                        -- Clerk sub, nur bei Vorsorge
  payload                   bytea not null,              -- {personName, sterbedatum?}
  created_at                timestamptz not null default now()
);

create table memberships (
  case_id   uuid references cases(id) on delete cascade,
  user_id   text not null,                         -- Clerk sub
  joined_at timestamptz not null default now(),
  primary key (case_id, user_id)
);

create index memberships_user_id_idx on memberships (user_id);

-- Die Zugehörigkeitsprüfung, auf der jede Policy steht (§4).
--
-- `security definer`, weil sie `memberships` lesen muss, ohne selbst durch die
-- Policy auf `memberships` zu laufen. Sonst prüfte die Policy sich rekursiv
-- selbst. `set search_path = public` schließt aus, dass jemand über einen
-- eigenen Suchpfad eine andere `memberships` unterschiebt.
create function public.is_member(p_case uuid) returns boolean
  language sql security definer stable set search_path = public as $fn$
  select exists (
    select 1 from memberships m
    where m.case_id = p_case and m.user_id = auth.jwt() ->> 'sub');
$fn$;

alter table cases enable row level security;
create policy cases_read on cases for select using (is_member(id));

alter table memberships enable row level security;
create policy memberships_read on memberships for select using (is_member(case_id));

-- Schreibend ist beides noch zu: Fallanlage und Beitritt sind eigene Abläufe
-- mit eigenen Policies (§4, §6). Eine Tabelle ohne Insert-Policy nimmt nichts
-- an, und das ist hier die richtige Voreinstellung.
