-- RLS für device_keys (DESIGN.md §4)
--
-- "Lesbar für die eigene Person und für alle, mit denen man einen Fall teilt,
-- schreibbar nur für sich selbst."
--
-- Warum überhaupt lesbar für andere: Um `K_c` an ein fremdes Gerät zu wrappen
-- (§3.6), braucht man dessen `public_key`. Warum nur für Mitglieder desselben
-- Falls: Sonst wäre die Tabelle ein Verzeichnis aller Geräte aller Personen.
--
-- Warum nur für sich selbst schreibbar: Wer eine fremde Zeile ändern könnte,
-- tauschte den Schlüssel aus, an den die anderen wrappen, und läse ab dann mit.
-- Der Prüfcode aus §3.6 fängt das beim Koppeln ab — aber nur dort, und ein
-- bereits freigegebenes Gerät wird nie wieder verglichen.

create function public.teilt_fall(p_user text) returns boolean
  language sql security definer stable set search_path = public as $fn$
  select exists (
    select 1
    from memberships meine
    join memberships fremde on fremde.case_id = meine.case_id
    where meine.user_id = auth.jwt() ->> 'sub'
      and fremde.user_id = p_user);
$fn$;

create policy device_keys_read on device_keys for select
  using (user_id = auth.jwt() ->> 'sub' or teilt_fall(user_id));

create policy device_keys_write on device_keys for insert
  with check (user_id = auth.jwt() ->> 'sub');

-- UPDATE gibt es für das Label (§3.6: "mit einem Label, das die Person vergeben
-- kann"). `with check` steht daneben, damit niemand die eigene Zeile im selben
-- Zug einer anderen Person zuschreibt.
create policy device_keys_edit on device_keys for update
  using (user_id = auth.jwt() ->> 'sub')
  with check (user_id = auth.jwt() ->> 'sub');

create policy device_keys_delete on device_keys for delete
  using (user_id = auth.jwt() ->> 'sub');
