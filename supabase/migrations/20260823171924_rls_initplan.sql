-- Den Clerk-sub einmal je Abfrage lesen, nicht einmal je Zeile (DESIGN.md §4)
--
-- `auth.jwt()` steht in den Policies aus `20260823120200` direkt im Ausdruck.
-- Postgres hält es dort für etwas, das von der Zeile abhängen könnte, und ruft
-- es deshalb für jede geprüfte Zeile erneut auf. Ein `select` darum herum sagt
-- das Gegenteil: Der Wert hängt von keiner Zeile ab, also wird er als InitPlan
-- einmal berechnet und danach nur noch verglichen.
--
-- Das ist derselbe Ausdruck und dieselbe Entscheidung: Wer was sehen und
-- ändern darf, ändert sich mit dieser Migration nicht. Nur der Aufwand ändert
-- sich, und zwar von "einmal je Zeile" auf "einmal".
--
-- `teilt_fall(user_id)` bleibt unangetastet: Sein Argument ist eine Spalte, es
-- hängt also wirklich von der Zeile ab und lässt sich nicht herausziehen.
-- Dass es trotzdem selten läuft, liegt an der Reihenfolge: `or` prüft die
-- linke Seite zuerst, und für die eigenen Geräte trifft sie zu.
--
-- `alter policy` statt `drop`/`create`: Zwischen den beiden Anweisungen gäbe
-- es einen Moment ohne Policy, und eine Tabelle mit RLS und ohne Policy ist
-- für niemanden lesbar. Innerhalb einer Migration ist das folgenlos, aber es
-- gibt keinen Grund, den Zustand überhaupt herzustellen.

alter policy device_keys_read on device_keys
  using (user_id = (select auth.jwt() ->> 'sub') or teilt_fall(user_id));

alter policy device_keys_write on device_keys
  with check (user_id = (select auth.jwt() ->> 'sub'));

alter policy device_keys_edit on device_keys
  using (user_id = (select auth.jwt() ->> 'sub'))
  with check (user_id = (select auth.jwt() ->> 'sub'));

alter policy device_keys_delete on device_keys
  using (user_id = (select auth.jwt() ->> 'sub'));
