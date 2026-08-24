-- Vorsorgefall anlegen und Tresor versiegeln (DESIGN.md §2, §3.5, §4)
--
-- Ein Vorsorgefall entsteht um die eigene Person, ohne Aufgaben und mit
-- versiegeltem Tresor (`catalog_version = NULL`). Der Tresorschlüssel K_v liegt
-- gewrappt ausschließlich auf den Geräten des Preparers (`vault_key_wraps`).
--
-- Die Schlüsselanteile (`vault_shares`) werden über `resplit_vault` an die
-- Angehörigen verteilt. Der Preparer kann einen versiegelten Fall nicht
-- verlassen, sondern nur kaskadierend löschen.

-- 1. Tresorschlüssel des Preparers ------------------------------------------
create table vault_key_wraps (
  case_id     uuid references cases(id) on delete cascade,
  device_id   uuid references device_keys(id) on delete cascade,
  kem_ct      bytea not null,
  wrapped_key bytea not null,                      -- AES-GCM(ss, K_v)
  primary key (case_id, device_id)
);

create index vault_key_wraps_device_id_idx on vault_key_wraps (device_id);

alter table vault_key_wraps enable row level security;

-- Nur der Preparer des Falls darf K_v lesen, schreiben oder löschen (§3.5, §4).
create policy vault_key_wraps_read on vault_key_wraps for select
  using (exists (select 1 from cases c
                  where c.id = vault_key_wraps.case_id
                    and c.preparer_id = (select auth.jwt()) ->> 'sub'));

create policy vault_key_wraps_write on vault_key_wraps for insert
  with check (exists (select 1 from cases c
                       where c.id = vault_key_wraps.case_id
                         and c.preparer_id = (select auth.jwt()) ->> 'sub'));

create policy vault_key_wraps_delete on vault_key_wraps for delete
  using (exists (select 1 from cases c
                  where c.id = vault_key_wraps.case_id
                    and c.preparer_id = (select auth.jwt()) ->> 'sub'));

grant select, insert, delete on vault_key_wraps to authenticated;

-- 2. Tresor-Shares der Angehörigen -----------------------------------------
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

create index vault_shares_device_id_idx on vault_shares (device_id);
create index vault_shares_user_id_idx on vault_shares (user_id);

alter table vault_shares enable row level security;

create policy vault_shares_read on vault_shares for select
  using (is_member(case_id));

-- Schreiben auf vault_shares läuft ausschließlich über die RPC resplit_vault.
grant select on vault_shares to authenticated;

-- 3. Freigaben -------------------------------------------------------------
create table vault_releases (
  case_id          uuid references cases(id) on delete cascade,
  user_id          text not null,                  -- eine Person = eine Zeile
  signed_by_device uuid not null references device_keys(id) on delete restrict,
  released_share   bytea not null,                 -- Share unter K_c
  signature        bytea not null,                 -- "LN-rel-v1", §3.2
  released_at      timestamptz not null default now(),
  primary key (case_id, user_id)
);

create index vault_releases_signed_by_device_idx on vault_releases (signed_by_device);

alter table vault_releases enable row level security;

create policy vault_releases_read on vault_releases for select
  using (is_member(case_id));

grant select on vault_releases to authenticated;

-- 4. Vorsorgefall anlegen (RPC) --------------------------------------------
create function public.lege_vorsorgefall_an(
  p_fall_id           uuid,
  p_kid_fall          text,    -- "case_<uuid>:1"
  p_kid_katalog       text,    -- "cat_<uuid>"
  p_payload           bytea,   -- {personName} unter K_c
  p_geraet            uuid,    -- das anlegende Gerät
  p_fall_kem_ct       bytea,
  p_fall_wrapped_key  bytea,
  p_fall_signatur     bytea,
  p_kat_kem_ct        bytea,
  p_kat_wrapped_key   bytea,
  p_kat_signatur      bytea,
  p_vault_commitment  bytea,   -- SHA-256("LN-open-v1" || K_v)
  p_vault_kem_ct      bytea,
  p_vault_wrapped_key bytea
) returns uuid
  language plpgsql security definer set search_path = public as $fn$
declare
  v_user text := (select auth.jwt()) ->> 'sub';
begin
  if v_user is null then
    raise exception 'Ohne Anmeldung wird kein Fall angelegt.' using errcode = '42501';
  end if;

  if p_kid_fall is distinct from format('case_%s:1', p_fall_id)
     or p_kid_katalog is distinct from format('cat_%s', p_fall_id) then
    raise exception 'Das kid % bzw. % gehört nicht zum Fall %.',
      p_kid_fall, p_kid_katalog, p_fall_id using errcode = '22023';
  end if;

  if not exists (select 1 from device_keys d where d.id = p_geraet and d.user_id = v_user) then
    raise exception 'Das Gerät % gehört nicht zur angemeldeten Person.', p_geraet
      using errcode = '42501';
  end if;

  insert into cases (
    id, status, current_kid, preparer_id, vault_commitment,
    payload, catalog_version, vault_n, vault_k, vault_resplit_pending
  ) values (
    p_fall_id, 'vorsorge', p_kid_fall, v_user, p_vault_commitment,
    p_payload, null, 0, null, false
  );

  insert into memberships (case_id, user_id) values (p_fall_id, v_user);

  insert into key_wraps (case_id, kid, device_id, kem_ct, wrapped_key, wrapped_by, signature)
    values (p_fall_id, p_kid_fall,    p_geraet, p_fall_kem_ct, p_fall_wrapped_key, p_geraet, p_fall_signatur),
           (p_fall_id, p_kid_katalog, p_geraet, p_kat_kem_ct,  p_kat_wrapped_key,  p_geraet, p_kat_signatur);

  insert into vault_key_wraps (case_id, device_id, kem_ct, wrapped_key)
    values (p_fall_id, p_geraet, p_vault_kem_ct, p_vault_wrapped_key);

  return p_fall_id;
end $fn$;

revoke execute on function public.lege_vorsorgefall_an(
  uuid, text, text, bytea, uuid, bytea, bytea, bytea, bytea, bytea, bytea, bytea, bytea, bytea) from public;
grant execute on function public.lege_vorsorgefall_an(
  uuid, text, text, bytea, uuid, bytea, bytea, bytea, bytea, bytea, bytea, bytea, bytea, bytea) to authenticated;

-- 5. Neuverteilung / Resplit (RPC) -----------------------------------------
create type public.resplit_share_input as (
  user_id       text,
  device_id     uuid,
  share_index   int,
  share_hash    bytea,
  kem_ct        bytea,
  wrapped_share bytea
);

create or replace function public.resplit_vault(
  p_fall_id uuid,
  p_n       int,
  p_k       int,
  p_shares  public.resplit_share_input[]
) returns void
  language plpgsql security definer set search_path = public as $fn$
declare
  v_user      text := (select auth.jwt()) ->> 'sub';
  v_preparer  text;
  v_share     public.resplit_share_input;
begin
  if v_user is null then
    raise exception 'Ohne Anmeldung können keine Shares verteilt werden.' using errcode = '42501';
  end if;

  select preparer_id into v_preparer from cases where id = p_fall_id;
  if v_preparer is distinct from v_user then
    raise exception 'Nur der Preparer darf die Tresor-Shares verteilen.' using errcode = '42501';
  end if;

  -- 1. Bestehende vault_shares des Falls löschen
  delete from vault_shares where case_id = p_fall_id;

  -- 2. Alle vault_releases des Falls löschen (Pflicht gemäß §3.5)
  delete from vault_releases where case_id = p_fall_id;

  -- 3. Neue Shares eintragen
  if p_shares is not null and array_length(p_shares, 1) > 0 then
    foreach v_share in array p_shares loop
      insert into vault_shares (case_id, user_id, device_id, share_index, share_hash, kem_ct, wrapped_share)
        values (p_fall_id, v_share.user_id, v_share.device_id, v_share.share_index, v_share.share_hash, v_share.kem_ct, v_share.wrapped_share);
    end loop;
  end if;

  -- 4. Status auf cases aktualisieren
  update cases
     set vault_resplit_pending = false,
         vault_n = p_n,
         vault_k = p_k
   where id = p_fall_id;
end $fn$;

revoke execute on function public.resplit_vault(uuid, int, int, public.resplit_share_input[]) from public;
grant execute on function public.resplit_vault(uuid, int, int, public.resplit_share_input[]) to authenticated;

-- 6. Trigger: Preparer darf versiegelten Fall nicht verlassen ---------------
create function public.on_membership_before_delete() returns trigger
  language plpgsql security definer set search_path = public as $fn$
begin
  if exists (
    select 1 from cases c
     where c.id = old.case_id
       and c.preparer_id = old.user_id
       and c.vault_commitment is not null
  ) then
    raise exception 'Der Preparer eines versiegelten Falls kann die Mitgliedschaft nicht verlassen.'
      using errcode = '23514';
  end if;
  return old;
end $fn$;

create trigger memberships_prevent_preparer_leave
  before delete on memberships
  for each row execute function public.on_membership_before_delete();

-- 7. Trigger: Austritt setzt vault_resplit_pending und löscht Shares -------
create or replace function public.on_membership_deleted() returns trigger
  language plpgsql security definer set search_path = public as $fn$
begin
  delete from vault_shares
   where case_id = old.case_id and user_id = old.user_id;

  update cases
     set rotation_pending      = true,
         vault_resplit_pending = (status = 'vorsorge')
   where id = old.case_id;
  return old;
end $fn$;

create trigger memberships_deleted
  after delete on memberships
  for each row execute function public.on_membership_deleted();

-- 8. Mitgliedschaft verlassen (§3.4, §4) ------------------------------------
create policy memberships_delete on memberships for delete
  using ((select auth.jwt()) ->> 'sub' = user_id);

grant delete on memberships to authenticated;

-- 9. Fall löschen (für den Preparer) ----------------------------------------
create policy cases_delete on cases for delete
  using ((select auth.jwt()) ->> 'sub' = preparer_id and status = 'vorsorge');

grant delete on cases to authenticated;
