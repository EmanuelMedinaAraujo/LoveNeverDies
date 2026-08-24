-- Rechtskatalog: einfrieren bei der Fallanlage (DESIGN.md §8)
--
-- Ein Trauerfall ohne Katalogstand gibt es nicht. §8 sagt, wann eingefroren
-- wird, nämlich beim Übergang nach `trauerfall`, nicht bei der Fallanlage. Ein
-- direkt in `trauerfall` angelegter Fall friert deshalb sofort ein, nach
-- derselben Regel und ohne Sonderfall.
--
-- Bis dahin bleibt `catalog_version` NULL: Ein 2026 angelegter Vorsorgefall
-- instanziierte sonst 2031 das Recht von 2026.
--
-- Der CHECK macht aus der Regel eine Zusage der Datenbank. Ohne ihn wäre sie
-- eine Absprache zwischen zwei Funktionen, und die zweite (der Übergang aus
-- der Vorsorge, #15) ist noch nicht geschrieben.

alter table cases
  add constraint cases_trauerfall_hat_katalogstand
  check (status <> 'trauerfall' or catalog_version is not null);

/*
 * `lege_trauerfall_an` bekommt den Katalogstand dazu.
 *
 * Ein `create or replace` reicht nicht: Die Signatur ändert sich, und Postgres
 * legte daneben eine zweite Überladung an. Zwei Funktionen gleichen Namens, von
 * denen eine Fälle ohne Katalogstand anlegt, sind genau die Lücke, die der
 * CHECK darüber schließen soll.
 */
drop function public.lege_trauerfall_an(
  uuid, text, text, bytea, uuid, bytea, bytea, bytea, bytea, bytea, bytea);

create function public.lege_trauerfall_an(
  p_fall_id          uuid,
  p_kid_fall         text,    -- "case_<uuid>:1"
  p_kid_katalog      text,    -- "cat_<uuid>"
  p_payload          bytea,   -- {personName, sterbedatum} unter K_c
  p_katalog_version  text,    -- der eingefrorene Katalogstand (§8)
  p_geraet           uuid,    -- das anlegende Gerät: Empfänger und Absender zugleich
  p_fall_kem_ct      bytea,
  p_fall_wrapped_key bytea,
  p_fall_signatur    bytea,
  p_kat_kem_ct       bytea,
  p_kat_wrapped_key  bytea,
  p_kat_signatur     bytea
) returns uuid
  language plpgsql security definer set search_path = public as $fn$
declare
  v_user text := (select auth.jwt()) ->> 'sub';
begin
  if v_user is null then
    raise exception 'Ohne Anmeldung wird kein Fall angelegt.' using errcode = '42501';
  end if;

  /*
   * Beide `kid` sind aus der `case_id` herleitbar, und genau das ist ihr Sinn:
   * Ein zweites Gerät findet den Wrap, ohne ihn zu suchen. Sie stehen trotzdem
   * als Parameter da, weil sie in die Wrap-Signatur eingehen (§3.2). Würde die
   * Funktion sie selbst bilden, führte eine abweichende Schreibweise im Client
   * zu einer Signatur, die niemand mehr verifizieren kann. So scheitert
   * stattdessen der Aufruf, laut und sofort.
   */
  if p_kid_fall is distinct from format('case_%s:1', p_fall_id)
     or p_kid_katalog is distinct from format('cat_%s', p_fall_id) then
    raise exception 'Das kid % bzw. % gehört nicht zum Fall %.',
      p_kid_fall, p_kid_katalog, p_fall_id using errcode = '22023';
  end if;

  -- Der Katalogstand benennt, woraus die Aufgaben dieses Falls aufgesetzt
  -- wurden (§8). Eine leere Angabe benennt nichts.
  if coalesce(btrim(p_katalog_version), '') = '' then
    raise exception 'Ein Trauerfall braucht den Katalogstand, aus dem er aufgesetzt wird.'
      using errcode = '22023';
  end if;

  -- Ein fremdes Gerät als Empfänger hieße: Der Fall entsteht und ist für die
  -- Person, die ihn anlegt, von Anfang an unlesbar.
  if not exists (select 1 from device_keys d where d.id = p_geraet and d.user_id = v_user) then
    raise exception 'Das Gerät % gehört nicht zur angemeldeten Person.', p_geraet
      using errcode = '42501';
  end if;

  insert into cases (id, status, current_kid, catalog_version, payload)
    values (p_fall_id, 'trauerfall', p_kid_fall, p_katalog_version, p_payload);

  insert into memberships (case_id, user_id) values (p_fall_id, v_user);

  insert into key_wraps (case_id, kid, device_id, kem_ct, wrapped_key, wrapped_by, signature)
    values (p_fall_id, p_kid_fall,    p_geraet, p_fall_kem_ct, p_fall_wrapped_key, p_geraet, p_fall_signatur),
           (p_fall_id, p_kid_katalog, p_geraet, p_kat_kem_ct,  p_kat_wrapped_key,  p_geraet, p_kat_signatur);

  return p_fall_id;
end $fn$;

-- Wie zuvor: Postgres gibt neuen Funktionen `execute` an `public`, und `anon`
-- erbt das. Eine Funktion, die einen Fall anlegt, darf niemandem offenstehen,
-- der keinen `sub` mitbringt.
revoke execute on function public.lege_trauerfall_an(
  uuid, text, text, bytea, text, uuid, bytea, bytea, bytea, bytea, bytea, bytea) from public;
grant execute on function public.lege_trauerfall_an(
  uuid, text, text, bytea, text, uuid, bytea, bytea, bytea, bytea, bytea, bytea) to authenticated;
