-- Türklingel: die cases-Zeile für Realtime veröffentlichen (DESIGN.md §5)
--
-- §5 verlangt drei Dinge in dieser Reihenfolge: einen billigen Check
-- (`select version from cases`), ein Delta (`seq > watermark`) und eine
-- Türklingel. Die ersten beiden sind Abfragen und brauchen nichts weiter — den
-- Zähler, gegen den sie laufen, gibt es seit `items_assign_seq`. Die dritte
-- braucht diese Migration.
--
-- **Warum `cases` und nicht `items`.** Die Türklingel trägt keine Nutzlast. Sie
-- sagt „da war was", und was es war, holt der Delta-Sync über PostgREST — durch
-- die RLS und mit den Bytes, die der Client ohnehin entschlüsseln muss. Stünde
-- `items` in der Publikation, liefe daneben ein zweiter Auslieferungsweg für
-- dieselben Daten, mit eigener Reihenfolge, eigener Rechteprüfung und der
-- Möglichkeit, dass ein Gerät eine Zeile über den einen Weg sieht und über den
-- anderen nicht. Die eine Zeile in `cases` reicht: Ihr `version` hebt der
-- Trigger bei **jeder** Inhaltsänderung des Falls mit (§4).
--
-- `replica identity` bleibt auf der Voreinstellung. Realtime prüft die
-- Leseregel gegen die geänderte Zeile, und `cases_read` fragt `is_member(id)` —
-- die `id` ist der Primärschlüssel und liegt damit ohnehin bei.

do $$
begin
  -- Ein Supabase-Projekt bringt die Publikation mit; ein leeres Postgres nicht.
  -- Ohne diesen Zweig liefe die Migrationskette gegen eine frische Datenbank
  -- ins Leere, und das ist der Lauf, an dem sich §4 messen lassen muss.
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;

  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'cases'
  ) then
    alter publication supabase_realtime add table public.cases;
  end if;
end $$;
