-- Schlüsselrotation und persönlicher Schlüsselspeicher (DESIGN.md §3.4, §4, §7)
--
-- Jemand verlässt einen Fall. RLS sperrt sofort jeden Blob-Zugriff, der Client
-- löscht lokal alle Schlüssel und Caches des Falls (sk_u bleibt), und der
-- Trigger on_membership_deleted tombstonet die privaten Items, löscht die
-- vault_shares und setzt rotation_pending = true.
--
-- Das nächste verbleibende Mitglied beansprucht ein Mandat für 2 Minuten über
-- claim_rotation, rotiert K_c und bestätigt die neue Generation atomar über
-- commit_rotation als Compare-and-Swap.

-- 1. Persönliche Schlüssel (private Items) ------------------------------------
create table personal_key_wraps (
  case_id     uuid references cases(id) on delete cascade,
  user_id     text not null,
  kid         text not null,                       -- 32 B zufällig, undurchsichtig
  device_id   uuid references device_keys(id) on delete cascade,
  kem_ct      bytea not null,
  wrapped_key bytea not null,                      -- AES-GCM(ss, K_p)
  primary key (case_id, kid, device_id)
);

create index personal_key_wraps_device_id_idx on personal_key_wraps (device_id);
create index personal_key_wraps_user_id_idx on personal_key_wraps (user_id);

alter table personal_key_wraps enable row level security;

create policy personal_key_wraps_read on personal_key_wraps for select
  using (user_id = (select auth.jwt()) ->> 'sub');

create policy personal_key_wraps_write on personal_key_wraps for insert
  with check (is_member(case_id) and user_id = (select auth.jwt()) ->> 'sub');

create policy personal_key_wraps_delete on personal_key_wraps for delete
  using (user_id = (select auth.jwt()) ->> 'sub');

grant select, insert, delete on personal_key_wraps to authenticated;

-- 2. Trigger: Austritt setzt rotation_pending, löscht Shares & tombstonet private Items
create or replace function public.on_membership_deleted() returns trigger
  language plpgsql security definer set search_path = public as $fn$
begin
  update items i
     set deleted = true, payload = ''::bytea, wrapped_dek = ''::bytea
   where i.case_id = old.case_id
     and exists (select 1 from personal_key_wraps p
                  where p.case_id = i.case_id
                    and p.kid = i.kid and p.user_id = old.user_id);

  delete from personal_key_wraps
   where case_id = old.case_id and user_id = old.user_id;

  delete from vault_shares
   where case_id = old.case_id and user_id = old.user_id;

  update cases
     set rotation_pending      = true,
         vault_resplit_pending = (status = 'vorsorge')
   where id = old.case_id;
  return old;
end $fn$;

-- 3. claim_rotation: Mandat für 2 Minuten mit Zeilensperre -------------------
create function public.claim_rotation(
  p_case_id             uuid,
  p_expected_generation int,
  p_device_id           uuid
) returns boolean
  language plpgsql security definer set search_path = public as $fn$
declare
  v_user      text := (select auth.jwt()) ->> 'sub';
  v_fall      cases%rowtype;
begin
  if v_user is null then
    raise exception 'Ohne Anmeldung wird kein Mandat vergeben.' using errcode = '42501';
  end if;

  if not exists (
    select 1 from memberships m where m.case_id = p_case_id and m.user_id = v_user
  ) then
    raise exception 'Nur ein Mitglied dieses Falls kann ein Mandat anfordern.'
      using errcode = '42501';
  end if;

  if not exists (
    select 1 from device_keys d where d.id = p_device_id and d.user_id = v_user
  ) then
    raise exception 'Das Gerät % gehört nicht zur angemeldeten Person.', p_device_id
      using errcode = '42501';
  end if;

  select * into v_fall from cases where id = p_case_id for update;

  if not found then
    return false;
  end if;

  if not v_fall.rotation_pending or v_fall.key_generation <> p_expected_generation then
    return false;
  end if;

  if v_fall.rotation_claimed_by is not null
     and v_fall.rotation_claimed_by <> p_device_id
     and v_fall.rotation_claim_expires_at > now() then
    return false;
  end if;

  update cases
     set rotation_claimed_by       = p_device_id,
         rotation_claim_expires_at = now() + interval '2 minutes'
   where id = p_case_id;

  return true;
end $fn$;

revoke execute on function public.claim_rotation(uuid, int, uuid) from public;
grant execute on function public.claim_rotation(uuid, int, uuid) to authenticated;

-- 4. commit_rotation: Compare-and-Swap auf key_generation -------------------
create function public.commit_rotation(
  p_case_id             uuid,
  p_expected_generation int,
  p_new_kid             text,
  p_device_id           uuid,
  p_payload             bytea default null
) returns boolean
  language plpgsql security definer set search_path = public as $fn$
declare
  v_user      text := (select auth.jwt()) ->> 'sub';
  v_fall      cases%rowtype;
begin
  if v_user is null then
    raise exception 'Ohne Anmeldung wird keine Rotation bestätigt.' using errcode = '42501';
  end if;

  if not exists (
    select 1 from memberships m where m.case_id = p_case_id and m.user_id = v_user
  ) then
    raise exception 'Nur ein Mitglied dieses Falls kann die Rotation bestätigen.'
      using errcode = '42501';
  end if;

  if not exists (
    select 1 from device_keys d where d.id = p_device_id and d.user_id = v_user
  ) then
    raise exception 'Das Gerät % gehört nicht zur angemeldeten Person.', p_device_id
      using errcode = '42501';
  end if;

  select * into v_fall from cases where id = p_case_id for update;

  if not found then
    return false;
  end if;

  if v_fall.key_generation <> p_expected_generation then
    return false;
  end if;

  if v_fall.rotation_claimed_by is not null
     and v_fall.rotation_claimed_by <> p_device_id
     and v_fall.rotation_claim_expires_at > now() then
    return false;
  end if;

  if coalesce(btrim(p_new_kid), '') = '' then
    raise exception 'Ein neuer kid muss angegeben werden.' using errcode = '22023';
  end if;

  update cases
     set key_generation            = p_expected_generation + 1,
         current_kid               = p_new_kid,
         payload                   = coalesce(p_payload, payload),
         rotation_pending          = false,
         rotation_claimed_by       = null,
         rotation_claim_expires_at = null
   where id = p_case_id;

  return true;
end $fn$;

revoke execute on function public.commit_rotation(uuid, int, text, uuid, bytea) from public;
grant execute on function public.commit_rotation(uuid, int, text, uuid, bytea) to authenticated;
