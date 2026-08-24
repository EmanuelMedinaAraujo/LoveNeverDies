-- Kopplung: Angehörige einladen und ein zweites Gerät freigeben (DESIGN.md §6, §3.6, §4)
--
-- Die öffentlichen Schlüssel eines Geräts sind zusammen über 3 KB groß. Am
-- Telefon nennbar ist das nicht, und ein QR-Code dieser Größe ist auf einem
-- Küchentisch auch nichts, worauf man eine Familie verweisen möchte. Deshalb
-- ein kurzer Code mit Server-Rendezvous: Die beitretende Seite legt ihre
-- Schlüssel ab und bekommt acht Zeichen zurück; die einladende Seite gibt sie
-- ein und holt sich damit die Schlüssel.
--
-- Der Ablauf ist für beide Zwecke derselbe (§6):
--
--   `join`   — eine andere Person kommt in einen Fall
--   `device` — ein zweites Gerät derselben Person wird freigeschaltet
--
-- Der einzige Unterschied steht in `loese_kopplungscode_ein`: Bei `join` muss
-- die einlösende eine **andere** Person sein, bei `device` dieselbe.
--
-- **Zwei Schritte, nicht einer.** Zwischen "Code eingegeben" und "Schlüssel
-- übergeben" liegt der mündliche Prüfcode-Abgleich (§3.6) — der einzige Schutz
-- gegen einen Server, der beim Rendezvous fremde Schlüssel unterschiebt. Ein
-- Ablauf, der in einem Aufruf durchliefe, hätte für diesen Abgleich keine
-- Stelle. Deshalb `loese_kopplungscode_ein` (zeigt, wer da ist) und danach
-- `schliesse_kopplung_ab` (übergibt die Schlüssel).

create table pairing_codes (
  code        text primary key,                    -- 8 Zeichen, ohne O/0/I/1
  user_id     text not null,                       -- Clerk sub der beitretenden Seite
  device_id   uuid not null references device_keys(id) on delete cascade,
  purpose     text not null check (purpose in ('join','device')),
  expires_at  timestamptz not null,
  consumed    boolean not null default false,

  -- Steht nicht in der Skizze in §4 und folgt aus den zwei Schritten oben:
  -- Zwischen Einlösen und Abschließen muss die Datenbank wissen, wer den Code
  -- eingelöst hat. Ohne diese beiden Spalten dürfte `schliesse_kopplung_ab`
  -- entweder jedem offenstehen, der einen verbrauchten Code kennt, oder es
  -- müsste den Abgleich vorwegnehmen und den Code sofort einlösen.
  redeemed_by text,
  redeemed_at timestamptz
);

-- `device_id` ist `not null`, anders als in der Skizze in §4: Ein Kopplungscode
-- ohne Gerät trägt nichts zu übergeben und wäre eine Zeile, die nur scheitern
-- kann.

create index pairing_codes_device_id_idx on pairing_codes (device_id);

/*
 * Jeder Einlöseversuch, gelungen oder nicht (§4: "mit Rate-Limit").
 *
 * Eine eigene Tabelle und kein Zähler in `pairing_codes`: Gezählt werden muss,
 * was **keinen** Code trifft — ein Zähler auf der Zeile bekäme einen Fehlgriff
 * nie zu sehen. Und ohne Zeitfenster wäre es kein Limit, sondern ein Kontingent
 * auf Lebenszeit.
 */
create table pairing_attempts (
  id         bigint generated always as identity primary key,
  user_id    text not null,
  attempted_at timestamptz not null default now()
);

create index pairing_attempts_user_idx on pairing_attempts (user_id, attempted_at desc);

alter table pairing_codes enable row level security;
alter table pairing_attempts enable row level security;

/*
 * Beide Tabellen bekommen keine Policy und kein Recht (§4: "`pairing_codes`
 * ist nicht offen selektierbar").
 *
 * RLS allein täte es schon — eine eingeschaltete Tabelle ohne Policy ist für
 * jede Rolle außer `service_role` leer. Das fehlende `grant` ist die zweite
 * Sperre, und sie steht hier aus demselben Grund wie in
 * `20260823120300_datenapi_zugriff.sql`: Erteilt wird je Tabelle genau das,
 * wofür es eine Policy gibt. Eine `select`-Policy, die eines Tages
 * versehentlich zu weit gerät, hätte damit immer noch kein Leserecht hinter
 * sich. Der einzige Weg an diese Zeilen führt über die drei `security
 * definer`-Funktionen unten.
 */

-- Acht Zeichen aus einem Alphabet ohne O, 0, I und 1 (§6).
--
-- Die vier fehlen, weil dieser Code am Telefon genannt wird. "Null oder O" ist
-- die Rückfrage, die den Ablauf für die Zielgruppe kaputt macht, und sie lässt
-- sich nicht beantworten, sondern nur vermeiden.
--
-- Der Zufall kommt aus `gen_random_uuid()` und nicht aus `random()`: Das eine
-- zieht aus dem starken Zufallsgenerator von Postgres, das andere aus einem
-- vorhersagbaren PRNG. Wer den nächsten Code vorhersagen kann, koppelt sich
-- selbst in einen fremden Fall, bevor die eingeladene Person ihn überhaupt
-- vorgelesen hat.
--
-- **Nicht jedes Byte einer UUID ist zufällig.** Ein UUIDv4 trägt in Byte 6 die
-- Versionsnummer im oberen Halbbyte und in Byte 8 zwei feste Variantenbits;
-- diese beiden liefern nur 16 bzw. 64 Werte statt 256. Wer sie mitnähme,
-- schränkte zwei der acht Stellen still auf die Hälfte des Alphabets ein — ein
-- Bit weniger, und niemand sähe es dem Code an. Genommen werden deshalb die
-- Bytes 0–5 und 9–10, die vollständig aus dem Zufallsgenerator stammen.
--
-- 256 mod 32 = 0, also verzerrt der Rest die Verteilung nicht. Bei einem
-- Alphabet mit anderer Länge wäre genau das der Fehler, den niemand sieht.
create function public.kopplungscode_zufall() returns text
  language plpgsql as $fn$
declare
  alphabet constant text := '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  stellen constant int[] := array[0, 1, 2, 3, 4, 5, 9, 10];
  bytes bytea := uuid_send(gen_random_uuid());
  code text := '';
begin
  for stelle in 1..8 loop
    code := code || substr(alphabet, (get_byte(bytes, stellen[stelle]) % 32) + 1, 1);
  end loop;

  return code;
end $fn$;

/*
 * Einen Kopplungscode ausgeben (§6, Schritt 2).
 *
 * `security definer`, weil `pairing_codes` niemandem offensteht. Die Funktion
 * prüft dafür selbst, was die Policy sonst prüfte: Das Gerät gehört der
 * angemeldeten Person, und es gibt ein Profil, aus dem die einladende Seite
 * später einen Namen liest.
 *
 * **Warum ohne Profil kein Code entsteht.** §6 verlangt, dass die einladende
 * Person einen echten Namen sieht, bevor sie das Familiengeheimnis weitergibt.
 * Ein Code, dessen Einlösung "(kein Name)" zeigt, unterläuft genau diesen
 * Schritt — und zwar an der Stelle, an der niemand mehr Nein sagt, weil der
 * Anruf ja schon läuft. Also scheitert lieber das Ausgeben.
 */
create function public.erzeuge_kopplungscode(
  p_geraet uuid,
  p_zweck  text
) returns table (code text, expires_at timestamptz)
  language plpgsql security definer set search_path = public as $fn$
declare
  v_user text := (select auth.jwt()) ->> 'sub';
  v_code text;
begin
  if v_user is null then
    raise exception 'Ohne Anmeldung gibt es keinen Kopplungscode.' using errcode = '42501';
  end if;

  if p_zweck is distinct from 'join' and p_zweck is distinct from 'device' then
    raise exception 'Unbekannter Kopplungszweck %.', p_zweck using errcode = '22023';
  end if;

  if not exists (select 1 from device_keys d where d.id = p_geraet and d.user_id = v_user) then
    raise exception 'Das Gerät % gehört nicht zur angemeldeten Person.', p_geraet
      using errcode = '42501';
  end if;

  if not exists (select 1 from profiles p where p.user_id = v_user) then
    raise exception 'Ohne hinterlegten Namen gibt es keinen Kopplungscode.'
      using errcode = '42501';
  end if;

  /*
   * Ältere, noch offene Codes derselben Person für denselben Zweck fallen weg.
   * Sonst blieben mehrere gültige Codes gleichzeitig im Umlauf — der Zettel vom
   * ersten Versuch öffnet dann noch eine Viertelstunde lang dieselbe Tür wie
   * der Code, den gerade jemand am Telefon vorliest.
   */
  delete from pairing_codes
   where user_id = v_user and purpose = p_zweck and not consumed;

  -- Acht Zeichen aus 32 sind 40 Bit; eine Kollision unter den wenigen
  -- gleichzeitig offenen Codes ist unwahrscheinlich, aber nicht unmöglich. Ein
  -- `insert`, der sie erst am Primärschlüssel bemerkt, ist der ehrlichere Weg
  -- als ein `select`, der vorher nachsieht und dabei nichts sperrt.
  for versuch in 1..8 loop
    v_code := kopplungscode_zufall();

    begin
      return query
        insert into pairing_codes (code, user_id, device_id, purpose, expires_at)
          values (v_code, v_user, p_geraet, p_zweck, now() + interval '15 minutes')
        returning pairing_codes.code, pairing_codes.expires_at;
      return;
    exception when unique_violation then
      -- Nächster Versuch.
    end;
  end loop;

  raise exception 'Es war kein freier Kopplungscode zu finden.' using errcode = '40001';
end $fn$;

/*
 * Einen Kopplungscode einlösen (§6, Schritt 4).
 *
 * Gibt zurück, was die einladende Person **vor** der Bestätigung sehen muss:
 * Name, E-Mail und beide öffentlichen Schlüssel, aus denen ihre Seite denselben
 * Prüfcode rechnet wie die beitretende (§3.6).
 *
 * **Warum ein `status` statt einer Ausnahme.** Jeder Aufruf wird gezählt, und
 * eine Ausnahme rollt die Zählung mit zurück — ein Rate-Limit, das nur
 * erfolgreiche Versuche zählt, ist keines. Die Fehlgründe stehen deshalb im
 * Ergebnis:
 *
 *   `ok`         — eingelöst, die übrigen Spalten sind gefüllt
 *   `gesperrt`   — zu viele Versuche in den letzten 15 Minuten
 *   `unbekannt`  — diesen Code gibt es nicht
 *   `abgelaufen` — älter als 15 Minuten
 *   `verbraucht` — schon eingelöst
 *   `selbst`     — ein `join`-Code der eigenen Person
 *   `fremd`      — ein `device`-Code einer anderen Person
 *
 * Verbraucht wird ausschließlich bei `ok`. Ein Fehlgriff darf keinen fremden
 * Code verbrennen: Sonst genügte Raten, um eine Kopplung zu verhindern, und
 * das ist billiger als sie zu übernehmen.
 */
create function public.loese_kopplungscode_ein(p_code text)
  returns table (
    status         text,
    purpose        text,
    user_id        text,
    display_name   text,
    email          text,
    device_id      uuid,
    public_key     bytea,
    sig_public_key bytea
  )
  language plpgsql security definer set search_path = public as $fn$
declare
  v_user     text := (select auth.jwt()) ->> 'sub';
  v_code     text;
  v_versuche int;
  v_zeile    pairing_codes%rowtype;
  v_profil   profiles%rowtype;
  v_geraet   device_keys%rowtype;
begin
  if v_user is null then
    raise exception 'Ohne Anmeldung lässt sich kein Kopplungscode einlösen.' using errcode = '42501';
  end if;

  -- Bindestriche und Kleinschreibung sind Darstellung, nicht Inhalt: "k4m7-qp2x"
  -- und "K4M7QP2X" sind derselbe Code. Wer ihn vom Telefon abschreibt, soll
  -- nicht an der Schreibweise scheitern.
  v_code := upper(regexp_replace(coalesce(p_code, ''), '[^0-9A-Za-z]', '', 'g'));

  insert into pairing_attempts (user_id) values (v_user);

  select count(*) into v_versuche
    from pairing_attempts a
   where a.user_id = v_user
     and a.attempted_at > now() - interval '15 minutes';

  -- Zehn in einer Viertelstunde. Wer einen Code vom Telefon abschreibt, braucht
  -- einen oder zwei; wer rät, kommt damit nicht weit genug, um es zu versuchen.
  if v_versuche > 10 then
    return query select 'gesperrt'::text, null::text, null::text, null::text, null::text,
                        null::uuid, null::bytea, null::bytea;
    return;
  end if;

  select * into v_zeile from pairing_codes c where c.code = v_code;

  if not found then
    return query select 'unbekannt'::text, null::text, null::text, null::text, null::text,
                        null::uuid, null::bytea, null::bytea;
    return;
  end if;

  if v_zeile.consumed then
    return query select 'verbraucht'::text, null::text, null::text, null::text, null::text,
                        null::uuid, null::bytea, null::bytea;
    return;
  end if;

  if v_zeile.expires_at <= now() then
    return query select 'abgelaufen'::text, null::text, null::text, null::text, null::text,
                        null::uuid, null::bytea, null::bytea;
    return;
  end if;

  -- Ein `join`-Code holt eine andere Person in einen Fall. Wer ihn selbst
  -- einlöst, hat sich vertan — und der Code soll die Viertelstunde überleben,
  -- in der die andere Seite noch auf ihn wartet.
  if v_zeile.purpose = 'join' and v_zeile.user_id = v_user then
    return query select 'selbst'::text, null::text, null::text, null::text, null::text,
                        null::uuid, null::bytea, null::bytea;
    return;
  end if;

  -- Ein `device`-Code gibt ein zweites Gerät **derselben** Person frei. Eine
  -- fremde Person, die ihn einlöst, bekäme `K_c` an ein Gerät gewrappt, das ihr
  -- nicht gehört — und das ist kein Versehen, das man durchgehen lässt.
  if v_zeile.purpose = 'device' and v_zeile.user_id is distinct from v_user then
    return query select 'fremd'::text, null::text, null::text, null::text, null::text,
                        null::uuid, null::bytea, null::bytea;
    return;
  end if;

  select * into v_profil from profiles p where p.user_id = v_zeile.user_id;
  select * into v_geraet from device_keys d where d.id = v_zeile.device_id;

  update pairing_codes
     set consumed = true, redeemed_by = v_user, redeemed_at = now()
   where pairing_codes.code = v_zeile.code;

  return query select 'ok'::text, v_zeile.purpose, v_zeile.user_id,
                      v_profil.display_name, v_profil.email,
                      v_geraet.id, v_geraet.public_key, v_geraet.sig_public_key;
end $fn$;

/*
 * Die Kopplung abschließen (§6, Schritt 6).
 *
 * Läuft, nachdem beide Seiten denselben Prüfcode gelesen haben. Sie legt für
 * `join` die Mitgliedschaft an und wrappt in jedem Fall `K_c` und `K_cat` an
 * das Gerät der anderen Seite — in einem Zug, aus demselben Grund wie
 * `lege_trauerfall_an` (§4): Eine Mitgliedschaft ohne Wraps ist ein Fall, den
 * die beitretende Person sieht und nicht lesen kann, und Wraps ohne
 * Mitgliedschaft sieht sie überhaupt nicht.
 *
 * **Mehrfach aufrufbar, und das ist gewollt.** Ein `device`-Code schaltet alle
 * Fälle frei, die das freigebende Gerät lesen kann (§4) — das sind mehrere
 * Aufrufe mit demselben Code. Der Code ist dabei längst verbraucht; was den
 * Aufruf trägt, ist `redeemed_by` zusammen mit dem Fenster darunter.
 */
create function public.schliesse_kopplung_ab(
  p_code             text,
  p_fall_id          uuid,
  p_kid_fall         text,
  p_kid_katalog      text,
  p_absender         uuid,   -- das wrappende Gerät, gehört der aufrufenden Person
  p_fall_kem_ct      bytea,
  p_fall_wrapped_key bytea,
  p_fall_signatur    bytea,
  p_kat_kem_ct       bytea,
  p_kat_wrapped_key  bytea,
  p_kat_signatur     bytea
) returns void
  language plpgsql security definer set search_path = public as $fn$
declare
  v_user  text := (select auth.jwt()) ->> 'sub';
  v_code  text;
  v_zeile pairing_codes%rowtype;
  v_kid   text;
begin
  if v_user is null then
    raise exception 'Ohne Anmeldung wird keine Kopplung abgeschlossen.' using errcode = '42501';
  end if;

  v_code := upper(regexp_replace(coalesce(p_code, ''), '[^0-9A-Za-z]', '', 'g'));

  select * into v_zeile from pairing_codes c where c.code = v_code;

  if not found or not v_zeile.consumed or v_zeile.redeemed_by is distinct from v_user then
    raise exception 'Dieser Kopplungscode wurde nicht von Ihnen eingelöst.' using errcode = '42501';
  end if;

  /*
   * Ein eigenes Fenster ab dem Einlösen, nicht `expires_at`.
   *
   * Die 15 Minuten aus §6 begrenzen, wie lange ein Code herumliegen darf, bevor
   * ihn jemand einlöst. Was danach kommt, ist ein Telefonat: Prüfcode vorlesen,
   * vergleichen, bestätigen. Liefe dafür dieselbe Uhr weiter, scheiterte
   * ausgerechnet die Kopplung, bei der sich beide Seiten Zeit für den Abgleich
   * genommen haben — und der Abgleich ist der Teil, den man nicht überspringen
   * soll.
   */
  if v_zeile.redeemed_at + interval '15 minutes' <= now() then
    raise exception 'Zwischen Eingabe und Bestätigung ist zu viel Zeit vergangen.'
      using errcode = '22023';
  end if;

  if not is_member(p_fall_id) then
    raise exception 'Sie gehören nicht zum Fall %.', p_fall_id using errcode = '42501';
  end if;

  if not exists (select 1 from device_keys d where d.id = p_absender and d.user_id = v_user) then
    raise exception 'Das Gerät % gehört nicht zur angemeldeten Person.', p_absender
      using errcode = '42501';
  end if;

  -- Dieselbe Prüfung wie in `lege_trauerfall_an` und aus demselben Grund: Beide
  -- `kid` gehen in die Wrap-Signatur ein (§3.2). Bildete die Funktion sie
  -- selbst, führte eine abweichende Schreibweise im Client zu einer Signatur,
  -- die das Empfängergerät nicht mehr verifizieren kann — und dann liegt der
  -- Wrap da und ist nicht zu gebrauchen.
  select current_kid into v_kid from cases where id = p_fall_id;

  if p_kid_fall is distinct from v_kid
     or p_kid_katalog is distinct from format('cat_%s', p_fall_id) then
    raise exception 'Das kid % bzw. % gehört nicht zum Fall %.',
      p_kid_fall, p_kid_katalog, p_fall_id using errcode = '22023';
  end if;

  if v_zeile.purpose = 'join' then
    -- `on conflict do nothing`: Bei `join` ist der zweite Aufruf für denselben
    -- Fall ein Wiederholungsversuch, kein Fehler.
    insert into memberships (case_id, user_id)
      values (p_fall_id, v_zeile.user_id)
      on conflict do nothing;
  end if;

  -- „Erster Schreiber gewinnt" (§3.6). Ein vorhandener Wrap wird nicht
  -- überschrieben — das ist genau der Angriff, gegen den `key_wraps` kein
  -- UPDATE kennt, und `security definer` darf ihn nicht durch die Hintertür
  -- wieder möglich machen.
  insert into key_wraps (case_id, kid, device_id, kem_ct, wrapped_key, wrapped_by, signature)
    values (p_fall_id, p_kid_fall,    v_zeile.device_id, p_fall_kem_ct, p_fall_wrapped_key, p_absender, p_fall_signatur),
           (p_fall_id, p_kid_katalog, v_zeile.device_id, p_kat_kem_ct,  p_kat_wrapped_key,  p_absender, p_kat_signatur)
    on conflict do nothing;
end $fn$;

-- Wie bei jeder Funktion dieses Projekts (§4): Postgres gibt neuen Funktionen
-- `execute` an `public`, und `anon` erbt das. Drei Funktionen, die Fälle öffnen
-- und Mitgliedschaften anlegen, dürfen niemandem offenstehen, der keinen `sub`
-- mitbringt.
revoke execute on function public.kopplungscode_zufall() from public;
revoke execute on function public.erzeuge_kopplungscode(uuid, text) from public;
revoke execute on function public.loese_kopplungscode_ein(text) from public;
revoke execute on function public.schliesse_kopplung_ab(
  text, uuid, text, text, uuid, bytea, bytea, bytea, bytea, bytea, bytea) from public;

grant execute on function public.erzeuge_kopplungscode(uuid, text) to authenticated;
grant execute on function public.loese_kopplungscode_ein(text) to authenticated;
grant execute on function public.schliesse_kopplung_ab(
  text, uuid, text, text, uuid, bytea, bytea, bytea, bytea, bytea, bytea) to authenticated;

-- `kopplungscode_zufall` bleibt entzogen: Sie ist ein Baustein von
-- `erzeuge_kopplungscode` und für sich genommen nur ein Zufallsgenerator, den
-- niemand von außen braucht.
