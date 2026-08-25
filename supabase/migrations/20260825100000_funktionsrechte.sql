-- Rechte und Suchpfad der Funktionen (DESIGN.md §4, §11.2)
--
-- `20260823120300_datenapi_zugriff.sql` hat den Gedanken für `is_member` und
-- `teilt_fall` schon aufgeschrieben: Postgres gibt jeder neuen Funktion
-- `execute` an `public`, und was in `public` steht, steht damit unter
-- `/rest/v1/rpc/...` offen. Die Triggerfunktionen sind dabei durchgerutscht.
--
-- Sie sind kein Loch: Ruft jemand `/rest/v1/rpc/on_membership_created` auf,
-- weist Postgres es ab — eine Triggerfunktion lässt sich nicht als gewöhnliche
-- Funktion aufrufen. Aber ein Recht, das niemand braucht, gehört auch niemandem
-- erteilt, und der Linter zählt sie zu Recht auf.
--
-- Der Trigger selbst bleibt davon unberührt: Postgres prüft `execute` beim
-- Anlegen des Triggers, nicht bei jedem Auslösen. Was hier entzogen wird, ist
-- allein der Weg über die Daten-API.

revoke execute on function public.items_assign_seq() from public;
revoke execute on function public.items_forbid_undelete() from public;
revoke execute on function public.items_reject_private_vault() from public;
revoke execute on function public.on_membership_before_delete() from public;
revoke execute on function public.on_membership_created() from public;
revoke execute on function public.on_membership_deleted() from public;

-- Ein Suchpfad, der dem Aufrufer gehört, ist ein Suchpfad, den der Aufrufer
-- umstellen kann. Bei `security definer` entscheidet er dann, welche Tabelle
-- eine unqualifizierte Referenz trifft — mit den Rechten des Eigentümers. Die
-- übrigen Funktionen dieses Projekts stehen längst auf `search_path = public`;
-- diese drei sind ohne geblieben.
--
-- `public` und nicht `''`: Die drei greifen auf nichts ausserhalb zu.
-- `angemeldete_kennung` nennt `auth.jwt()` ausdrücklich mit Schema, und
-- `kopplungscode_zufall` kommt mit `gen_random_uuid` und `get_byte` aus dem
-- Kern aus — pgcrypto liegt in `extensions` und wird hier nicht gebraucht.
alter function public.angemeldete_kennung() set search_path = public;
alter function public.kopplungscode_zufall() set search_path = public;
alter function public.items_forbid_undelete() set search_path = public;
