-- Zugriff auf die Daten-API (DESIGN.md §4)
--
-- RLS entscheidet, welche *Zeilen* jemand sieht. Ob die Tabelle für die Rolle
-- überhaupt existiert, entscheidet Postgres davor. Darauf hat RLS keinen
-- Einfluss. Neue Supabase-Projekte statten `public` nicht mehr mit
-- Lese- und Schreibrechten für `anon` und `authenticated` aus; ohne die Rechte
-- hier antwortet PostgREST mit `permission denied for table`, egal wie richtig
-- die Policies sind.
--
-- Erteilt wird je Tabelle genau das, wofür es eine Policy gibt. `cases` und
-- `memberships` sind schreibend noch zu (§4, §6); die Rechte dafür kommen mit
-- den Policies, die sie brauchen, und keinen Schritt früher.
--
-- `anon` bekommt nichts. Jede Policy dieses Projekts vergleicht gegen
-- `auth.jwt() ->> 'sub'`, und ohne Anmeldung gibt es keinen. Eine Rolle, die
-- ohnehin nur leere Mengen sähe, braucht die Tabelle nicht zu kennen.

grant select, insert, update, delete on device_keys to authenticated;
grant select on cases to authenticated;
grant select on memberships to authenticated;

-- Die beiden Prüffunktionen stehen in `public` und sind damit über
-- `/rest/v1/rpc/...` erreichbar. Postgres gibt neuen Funktionen `execute` an
-- `public`, und `anon` erbt das, auch wenn die Funktionen dort nichts als
-- `false` liefern können. Entzogen und gezielt neu erteilt: Die Policies rufen
-- sie als `authenticated` auf, und nur die Rolle braucht sie.
revoke execute on function public.is_member(uuid) from public;
revoke execute on function public.teilt_fall(text) from public;
grant execute on function public.is_member(uuid) to authenticated;
grant execute on function public.teilt_fall(text) to authenticated;
