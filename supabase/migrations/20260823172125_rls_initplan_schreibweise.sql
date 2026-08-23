-- Dieselbe Optimierung, in der Schreibweise, die der Linter erkennt
--
-- `20260823171924` hat getan, was es sollte: `explain` zeigt für
-- `select ... from device_keys` einen InitPlan, der Clerk-sub wird einmal je
-- Abfrage gelesen und nicht einmal je Zeile. Der Advisor meldet trotzdem
-- weiter `auth_rls_initplan` — er sucht wörtlich nach `select auth.<name>()`,
-- und Postgres schreibt `(select auth.jwt() ->> 'sub')` beim Speichern zu
-- `( SELECT (auth.jwt() ->> 'sub'))` um. Die Klammer zwischen `select` und
-- `auth` reicht, damit das Muster nicht mehr passt.
--
-- Gewrappt wird deshalb nur noch der Funktionsaufruf, nicht der ganze
-- Ausdruck: `(select auth.jwt()) ->> 'sub'`. Der Plan bleibt derselbe — ein
-- InitPlan, ein Vergleich je Zeile —, aber die gespeicherte Form enthält jetzt
-- `SELECT auth.jwt()` am Stück.
--
-- Ein Linter, der dauerhaft vier Warnungen zeigt, die niemand mehr liest, ist
-- schlimmer als keiner. Das ist der ganze Grund für diese Datei; schneller
-- wird nichts mehr.

alter policy device_keys_read on device_keys
  using (user_id = (select auth.jwt()) ->> 'sub' or teilt_fall(user_id));

alter policy device_keys_write on device_keys
  with check (user_id = (select auth.jwt()) ->> 'sub');

alter policy device_keys_edit on device_keys
  using (user_id = (select auth.jwt()) ->> 'sub')
  with check (user_id = (select auth.jwt()) ->> 'sub');

alter policy device_keys_delete on device_keys
  using (user_id = (select auth.jwt()) ->> 'sub');
