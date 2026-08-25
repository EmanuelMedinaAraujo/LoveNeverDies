-- Privat und im Tresor schließen sich aus (DESIGN.md §3.7, §4)
--
-- `personal_key_wraps` steht seit der Schlüsselrotation (§3.4). Was hier
-- dazukommt, ist die eine Regel, die die Datenbank über private Items
-- durchsetzen kann: Ein Item, dessen `kid` einem persönlichen Schlüssel
-- gehört, darf nicht zugleich im Tresor liegen.
--
-- Ein Tresor-Item ist für die Hinterbliebenen bestimmt. Privat und im Tresor
-- wäre ein Item, das nach dem Tod niemand mehr öffnen kann, und der Preparer
-- könnte es anlegen, ohne die Folge zu sehen.
--
-- Die beiden anderen Regeln aus §3.7 (private Aufgaben sind Wurzelaufgaben,
-- nichts hängt von einer privaten Aufgabe ab) stehen bewusst nicht hier:
-- `parentId` und `dependsOn` liegen verschlüsselt im Payload (§3.3), der
-- Server sieht sie nie. Sie werden beim Anlegen im Client validiert.

/*
 * `security definer`, und das ist der Kern dieser Datei: RLS auf
 * `personal_key_wraps` verbirgt die Zeilen fremder Personen (§3.7). Liefe die
 * Prüfung als Aufrufer, fände das `exists` das fremde `kid` nicht und ließe
 * die Zeile durch: Der Trigger versagte genau in dem Fall, für den er da ist,
 * nämlich beim untergeschobenen fremden `kid`.
 *
 * Die Rechteerweiterung ist eng: Die Funktion liest eine einzige Spalte einer
 * einzigen Tabelle und gibt nichts davon zurück; das `raise` nennt weder das
 * `kid` noch die Person, der es gehört.
 */
create function public.items_reject_private_vault() returns trigger
  language plpgsql security definer set search_path = public as $fn$
begin
  if new.in_vault and exists (
      select 1 from personal_key_wraps p
       where p.case_id = new.case_id and p.kid = new.kid) then
    raise exception 'Ein privates Item kann nicht im Tresor liegen.'
      using errcode = '23514';
  end if;

  return new;
end $fn$;

/*
 * Auch bei UPDATE: Sonst legte jemand das Item privat an und schöbe es mit
 * einem zweiten Aufruf in den Tresor. Der Weg dorthin ist derselbe, den die
 * Tresorfreigabe rückwärts geht (§3.5), und er darf beide Male scheitern.
 */
create trigger items_reject_private_vault before insert or update on items
  for each row execute function public.items_reject_private_vault();
