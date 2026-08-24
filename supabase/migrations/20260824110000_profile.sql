-- Anzeigename und E-Mail je Person (DESIGN.md §3.3, §4, §6)
--
-- Die eine Tabelle dieses Projekts, die personenbezogene Klartextdaten trägt,
-- und §3.3 benennt sie ausdrücklich als "bewusste Verbreiterung". Der Grund
-- steht in §6: Die einladende Person sieht Name und E-Mail der beitretenden,
-- **bevor** ein gemeinsamer Schlüssel existiert. Das ist nicht ein Nebeneffekt
-- des Ablaufs, sondern sein Zweck — ein öffentlicher Schlüssel ist keine
-- Identität, und wer das Familiengeheimnis weitergibt, soll vorher einen
-- echten Namen lesen.
--
-- Verschlüsseln ließe sich die Tabelle deshalb nicht: Zum Zeitpunkt der Anzeige
-- gibt es keinen Schlüssel, den beide Seiten hätten. Clerk kennt Name und
-- E-Mail ohnehin; neu ist allein, dass Supabase sie auch kennt.

create table profiles (
  user_id      text primary key,                   -- Clerk sub
  display_name text not null,
  email        text,
  updated_at   timestamptz not null default now()
);

alter table profiles enable row level security;

/*
 * Lesbar für die eigene Person und für alle, mit denen man einen Fall teilt —
 * dieselbe Regel wie bei `device_keys` (§4) und aus demselben Grund: Sonst wäre
 * die Tabelle ein Verzeichnis aller Namen und E-Mail-Adressen aller Personen.
 *
 * Die Kopplung aus §6 braucht mehr, nämlich den Namen einer Person, mit der man
 * noch **keinen** Fall teilt. Genau dafür ist `loese_kopplungscode_ein`
 * `security definer` (§4): Der Weg an dieser Policy vorbei führt über einen
 * Code, den die beitretende Person selbst erzeugt und selbst weitergegeben hat,
 * und über keinen anderen.
 */
create policy profiles_read on profiles for select
  using (user_id = (select auth.jwt()) ->> 'sub' or teilt_fall(user_id));

create policy profiles_write on profiles for insert
  with check (user_id = (select auth.jwt()) ->> 'sub');

create policy profiles_edit on profiles for update
  using (user_id = (select auth.jwt()) ->> 'sub')
  with check (user_id = (select auth.jwt()) ->> 'sub');

-- Kein DELETE. Ein Profil ohne Zeile ist kein Löschwunsch, sondern eine Person,
-- deren Name in jedem laufenden Kopplungsangebot fehlt; das Löschen eines
-- Kontos ist ein eigener Ablauf und nicht diese Policy.
grant select, insert, update on profiles to authenticated;
