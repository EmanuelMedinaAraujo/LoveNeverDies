-- Todesfall bestätigen: Proof-Gate und Übergang nach `trauerfall` (DESIGN.md §3.5, §5, §8)
--
-- Der heikelste Schritt des Projekts, und der einzige, der einen Fall von
-- `vorsorge` nach `trauerfall` bewegt. Ausgelöst wird er **nicht** vom Zähler
-- der Freigaben, sondern von einem Nachweis, dass `K_v` wirklich
-- rekonstruiert wurde: `proof = SHA-256("LN-open-v1" ‖ K_v)`, verglichen mit
-- dem `vault_commitment`, das seit dem Versiegeln auf dem Fall steht.
--
-- Warum der Zähler nichts auslöst (§3.5): Ein Mitglied kann jederzeit einen
-- unbrauchbaren Share hochladen, korrekt signiert und mit echter Identität.
-- Der Zähler stiege trotzdem, und am Ende stünde ein `trauerfall` an einer
-- lebenden Person. Prüfen kann der Server die Richtigkeit eines Shares
-- prinzipiell nicht, weil er unter `K_c` liegt. Also entscheidet der Zähler
-- nichts, er zeigt nur an.

-- 1. Die Kennung der angemeldeten Person ------------------------------------
--
-- Die Edge Function `vault-release` (§9) darf die `user_id` niemals aus dem
-- Request-Body nehmen. Sie holt sie über diese Funktion, und zwar mit dem
-- Token des Aufrufers: PostgREST prüft es gegen den Anbieter, bevor eine
-- Anfrage überhaupt in der Datenbank ankommt. Damit steht die Identität auf
-- derselben geprüften Grundlage wie jede Policy dieses Projekts.
create function public.angemeldete_kennung() returns text
  language sql stable as $fn$
  select (select auth.jwt()) ->> 'sub';
$fn$;

revoke execute on function public.angemeldete_kennung() from public;
grant execute on function public.angemeldete_kennung() to authenticated;

-- 2. Die Generation, unter der eine Freigabe liegt --------------------------
--
-- §3.5 verlangt, dass der `kid` mitkommt: Zwischen Freigabe und Öffnen kann ein
-- Mitglied austreten und `K_c` rotieren (§3.4). Ohne ihn wüsste das öffnende
-- Gerät nicht, unter welcher Generation der Blob liegt, und müsste blind alle
-- durchprobieren. Er steht zugleich **in** der Signatur, damit ihn niemand
-- nachträglich verdreht und eine gültige Freigabe so unlesbar macht.
--
-- Der Vorgabewert steht nur da, damit die Spalte an einer bereits benutzten
-- Tabelle entstehen kann, und geht sofort wieder: Eine Freigabe ohne
-- Generation ist keine, und der Client behandelt sie wie einen kaputten Share.
alter table vault_releases add column kid text not null default '';
alter table vault_releases alter column kid drop default;

-- 3. Rechte der Service-Role für `vault-release` ----------------------------
--
-- `service_role` umgeht RLS, nicht aber die Tabellenrechte: Ohne diese Zeilen
-- antwortet PostgREST mit `permission denied for table`, an jeder Policy
-- vorbei (siehe 20260823120300_datenapi_zugriff.sql).
--
-- Erteilt wird genau das, was die Function tut: Gerät und Mitgliedschaft
-- nachschlagen, eine Freigabe eintragen oder ersetzen. Kein `delete`: Eine
-- Freigabe verschwindet ausschließlich beim Re-Split (§3.5), und der läuft
-- über `resplit_vault`.
grant select on device_keys to service_role;
grant select on memberships to service_role;
grant select, insert, update on vault_releases to service_role;

-- 4. Der Übergang: open_vault ------------------------------------------------
--
-- Nimmt eine Zeilensperre, vergleicht den Nachweis mit dem Commitment, ist bei
-- bereits gesetztem `trauerfall` folgenlos idempotent und gibt die gültige
-- `catalog_version` zurück — die eigene oder die eines schnelleren Clients.
--
-- **Warum der Payload mitkommt.** §3.5 lässt das Sterbedatum von der Person
-- eintragen, die den Übergang vollzieht. Auf `cases` gibt es aber bewusst kein
-- UPDATE für `authenticated` (20260823210000_aufgaben.sql): Wer einen Fall
-- ändern darf, entscheidet nicht die Tabelle. Also geht der Payload durch
-- dieselbe Tür wie der Statuswechsel und wird mit ihm zusammen wirksam, oder
-- gar nicht. Der zweite Client überschreibt ihn nicht: Beim Übergang gewinnt,
-- wer zuerst da war, samt seinem Sterbedatum.
--
-- **Warum `version` unberührt bleibt.** `cases.version` ist das Wasserzeichen
-- des Delta-Sync (§5): Der Client holt `items` mit `seq > wasserzeichen` und
-- setzt es danach auf die höchste gesehene `seq`. Ein Sprung ohne neue Zeile
-- in `items` liesse ihn bei jeder Runde erneut ein leeres Delta abrufen. Die
-- Türklingel feuert ohnehin, denn sie sitzt auf der Zeile und nicht auf der
-- Spalte (20260824090000_tuerklingel.sql).
create function public.open_vault(
  p_fall_id         uuid,
  p_proof           bytea,   -- SHA-256("LN-open-v1" ‖ K_v)
  p_katalog_version text,    -- der Stand, den dieser Client mitbringt (§8)
  p_payload         bytea default null   -- {personName, sterbedatum} unter K_c
) returns text
  language plpgsql security definer set search_path = public as $fn$
declare
  v_user text := (select auth.jwt()) ->> 'sub';
  v_fall cases%rowtype;
begin
  if v_user is null then
    raise exception 'Ohne Anmeldung wird kein Tresor geöffnet.' using errcode = '42501';
  end if;

  if not exists (
    select 1 from memberships m where m.case_id = p_fall_id and m.user_id = v_user
  ) then
    raise exception 'Nur ein Mitglied dieses Falls kann den Tresor öffnen.'
      using errcode = '42501';
  end if;

  -- Die Zeilensperre. Sie hält den zweiten Client so lange auf, bis der erste
  -- committet hat; danach sieht er `trauerfall` und nimmt den Weg unten
  -- heraus, statt einen zweiten Katalogstand einzutragen.
  select * into v_fall from cases where id = p_fall_id for update;

  if not found then
    raise exception 'Diesen Fall gibt es nicht.' using errcode = '42501';
  end if;

  -- Folgenlos idempotent: Der Fall steht schon offen, und die gültige Version
  -- ist die, die dort steht — nicht die, die dieser Client mitbringt (§3.5).
  if v_fall.status = 'trauerfall' then
    return v_fall.catalog_version;
  end if;

  if v_fall.vault_commitment is null then
    raise exception 'Dieser Fall hat keinen versiegelten Tresor.' using errcode = '22023';
  end if;

  -- Der ganze Übergang hängt an dieser einen Zeile.
  if p_proof is null or p_proof is distinct from v_fall.vault_commitment then
    raise exception 'Der Nachweis über den Tresorschlüssel stimmt nicht.'
      using errcode = '42501';
  end if;

  /*
   * Ein Boden, kein Auslöser.
   *
   * Der Zähler entscheidet weiterhin nichts (§3.5) — er kann den Übergang nur
   * verhindern, nie herbeiführen. Nötig ist er trotzdem, und zwar wegen einer
   * Eigenschaft des Nachweises selbst: `proof` **ist** `vault_commitment`, und
   * die Spalte steht jedem Mitglied offen (`cases_read`). Ohne diese Zeile
   * genügte es, sie abzuschreiben, um einen Fall an einer lebenden Person in
   * den Trauerfall zu kippen — ohne einen einzigen Anteil zu besitzen.
   *
   * Eine Freigabe je Person setzt der Primärschlüssel durch. Wer die Schwelle
   * erreicht, hat also `k` Menschen hinter sich, und `k` Menschen können `K_v`
   * ohnehin zusammensetzen. Der Boden blockiert damit keinen einzigen
   * berechtigten Übergang: Jede gelungene Rekonstruktion braucht `k` gültige
   * Teile, und jeder davon kommt aus einer eigenen Zeile.
   */
  if (select count(*) from vault_releases r where r.case_id = p_fall_id)
     < greatest(coalesce(v_fall.vault_k, 1), 1) then
    raise exception 'Es liegen noch nicht genügend Freigaben für diesen Fall vor.'
      using errcode = '42501';
  end if;

  if coalesce(btrim(p_katalog_version), '') = '' then
    raise exception 'Ein Trauerfall braucht den Katalogstand, aus dem er aufgesetzt wird.'
      using errcode = '22023';
  end if;

  update cases
     set status                = 'trauerfall',
         catalog_version       = p_katalog_version,
         payload               = coalesce(p_payload, payload),
         vault_resplit_pending = false
   where id = p_fall_id;

  return p_katalog_version;
end $fn$;

revoke execute on function public.open_vault(uuid, bytea, text, bytea) from public;
grant execute on function public.open_vault(uuid, bytea, text, bytea) to authenticated;

-- 5. Gerätewechsel eines Angehörigen vor dem Öffnen ------------------------
--
-- §3.5: "Wechselt ein Angehöriger das Gerät, bevor der Tresor geöffnet ist,
-- wrappt sein altes Gerät den eigenen Share an das neue. Der Preparer wird
-- dafür nicht gebraucht — und ist nach seinem Tod auch nicht mehr verfügbar."
--
-- Deshalb eine eigene RPC und kein `insert`: `vault_shares` hat keine
-- Schreib-Policy, weil die Verteilung dem Preparer gehört (`resplit_vault`).
-- Ein zweiter Schreibweg für alle wäre eine Tür in die Verteilung; dieser hier
-- ist so schmal wie der Anlass.
--
-- **`share_index` und `share_hash` kommen aus der bestehenden Zeile**, nicht
-- vom Aufrufer. Sonst schöbe jemand einen erfundenen Anteil samt passendem
-- Hash unter, und das Öffnen bemerkte es nicht: Die Hash-Prüfung beim Öffnen
-- misst den Share an genau dieser Spalte (§3.5).
--
-- Die alte Zeile bleibt stehen. Sie zu löschen wäre der Versuch, einen
-- Gerätewechsel von einem Geräteverlust zu unterscheiden — und wer sich
-- irrte, nähme sich den einzigen Anteil, den er noch hat. Der nächste
-- Re-Split räumt ohnehin auf.
create function public.uebergib_tresoranteil(
  p_fall_id       uuid,
  p_geraet        uuid,    -- das neue Gerät, es muss der eigenen Person gehören
  p_kem_ct        bytea,
  p_wrapped_share bytea
) returns void
  language plpgsql security definer set search_path = public as $fn$
declare
  v_user  text := (select auth.jwt()) ->> 'sub';
  v_index int;
  v_hash  bytea;
begin
  if v_user is null then
    raise exception 'Ohne Anmeldung wird kein Anteil übergeben.' using errcode = '42501';
  end if;

  if not exists (select 1 from device_keys d where d.id = p_geraet and d.user_id = v_user) then
    raise exception 'Das Gerät % gehört nicht zur angemeldeten Person.', p_geraet
      using errcode = '42501';
  end if;

  select s.share_index, s.share_hash into v_index, v_hash
    from vault_shares s
   where s.case_id = p_fall_id and s.user_id = v_user
   limit 1;

  if v_index is null then
    raise exception 'Zu diesem Fall halten Sie keinen Anteil, der zu übergeben wäre.'
      using errcode = '42501';
  end if;

  if not exists (select 1 from cases c where c.id = p_fall_id and c.status = 'vorsorge') then
    raise exception 'Der Tresor dieses Falls ist bereits geöffnet.' using errcode = '22023';
  end if;

  insert into vault_shares (case_id, user_id, device_id, share_index, share_hash, kem_ct, wrapped_share)
  values (p_fall_id, v_user, p_geraet, v_index, v_hash, p_kem_ct, p_wrapped_share)
  on conflict (case_id, device_id) do update
    set user_id       = excluded.user_id,
        share_index   = excluded.share_index,
        share_hash    = excluded.share_hash,
        kem_ct        = excluded.kem_ct,
        wrapped_share = excluded.wrapped_share;
end $fn$;

revoke execute on function public.uebergib_tresoranteil(uuid, uuid, bytea, bytea) from public;
grant execute on function public.uebergib_tresoranteil(uuid, uuid, bytea, bytea) to authenticated;

