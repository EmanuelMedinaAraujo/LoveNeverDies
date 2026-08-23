-- Einen Trauerfall anlegen (DESIGN.md §2, §3.6, §4)
--
-- Ein Fall entsteht in einem Zug oder gar nicht. Drei Tabellen sind daran
-- beteiligt, und jede unvollständige Zwischenstufe wäre dauerhaft kaputt:
--
--   * `cases` ohne `memberships` — eine Zeile, die niemand sehen und niemand
--     löschen kann, weil jede Policy dieses Projekts an der Mitgliedschaft hängt.
--   * `memberships` ohne `key_wraps` — der Fall steht in der Liste, sein
--     Payload ist verschlüsselt, und `K_c` liegt nur noch im Arbeitsspeicher
--     des anlegenden Tabs. Nach dem nächsten Neuladen ist er fort, und mit ihm
--     der Name der verstorbenen Person.
--
-- Deshalb eine Funktion und keine drei Inserts. `security definer`, weil es
-- für `cases` und `memberships` bewusst keine INSERT-Policy gibt: Wer einen
-- Fall anlegen darf, ist keine Frage von Zeilen, sondern eine Frage des
-- Ablaufs, und der steht hier.
--
-- Nur `trauerfall`. Ein Vorsorgefall braucht Preparer, Tresor und Commitment
-- (§3.5) und ist ein anderer Ablauf mit anderen Zusagen; er bekommt seine
-- eigene Funktion, statt hier als Parameter mitzulaufen.

create function public.lege_trauerfall_an(
  p_fall_id          uuid,
  p_kid_fall         text,    -- "case_<uuid>:1"
  p_kid_katalog      text,    -- "cat_<uuid>"
  p_payload          bytea,   -- {personName, sterbedatum} unter K_c
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
   * als Parameter da, weil sie in die Wrap-Signatur eingehen (§3.2) — würde die
   * Funktion sie selbst bilden, führte eine abweichende Schreibweise im Client
   * zu einer Signatur, die niemand mehr verifizieren kann. So scheitert
   * stattdessen der Aufruf, laut und sofort.
   */
  if p_kid_fall is distinct from format('case_%s:1', p_fall_id)
     or p_kid_katalog is distinct from format('cat_%s', p_fall_id) then
    raise exception 'Das kid % bzw. % gehört nicht zum Fall %.',
      p_kid_fall, p_kid_katalog, p_fall_id using errcode = '22023';
  end if;

  -- Ein fremdes Gerät als Empfänger hieße: Der Fall entsteht und ist für die
  -- Person, die ihn anlegt, von Anfang an unlesbar.
  if not exists (select 1 from device_keys d where d.id = p_geraet and d.user_id = v_user) then
    raise exception 'Das Gerät % gehört nicht zur angemeldeten Person.', p_geraet
      using errcode = '42501';
  end if;

  insert into cases (id, status, current_kid, payload)
    values (p_fall_id, 'trauerfall', p_kid_fall, p_payload);

  insert into memberships (case_id, user_id) values (p_fall_id, v_user);

  insert into key_wraps (case_id, kid, device_id, kem_ct, wrapped_key, wrapped_by, signature)
    values (p_fall_id, p_kid_fall,    p_geraet, p_fall_kem_ct, p_fall_wrapped_key, p_geraet, p_fall_signatur),
           (p_fall_id, p_kid_katalog, p_geraet, p_kat_kem_ct,  p_kat_wrapped_key,  p_geraet, p_kat_signatur);

  return p_fall_id;
end $fn$;

-- Wie bei `is_member` und `teilt_fall` (§4): Postgres gibt neuen Funktionen
-- `execute` an `public`, und `anon` erbt das. Eine Funktion, die einen Fall
-- anlegt, darf niemandem offenstehen, der keinen `sub` mitbringt.
revoke execute on function public.lege_trauerfall_an(
  uuid, text, text, bytea, uuid, bytea, bytea, bytea, bytea, bytea, bytea) from public;
grant execute on function public.lege_trauerfall_an(
  uuid, text, text, bytea, uuid, bytea, bytea, bytea, bytea, bytea, bytea) to authenticated;
