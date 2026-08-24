-- Ein Beitritt macht die Tresor-Shares ungültig (DESIGN.md §3.5, §4, §6)
--
-- §4 gibt die Funktion wörtlich vor. Sie steht hier und nicht in der
-- Kopplungsmigration daneben, weil sie an der Tabelle hängt und nicht am
-- Ablauf: Jede Zeile in `memberships` löst sie aus, gleich ob sie aus
-- `schliesse_kopplung_ab` kommt, aus einer späteren Wiederherstellung oder aus
-- einem Eingriff mit Service-Role.
--
-- **Warum ein Beitritt die Shares betrifft.** `K_v` ist über die Mitglieder
-- verteilt (§3.5). Wer dazukommt, hat keinen Share — und `n` stimmt nicht mehr
-- mit der Zahl der Personen überein, an denen der Schwellwert `k` bemessen war.
-- Neu verteilt wird nicht hier: Das kann nur der Preparer, weil nur er `K_v`
-- besitzt. Der Trigger setzt deshalb bloß die Fahne, und der Preparer sieht sie
-- beim nächsten Öffnen (greift mit #14).
--
-- `preparer_id is distinct from new.user_id` schließt den einen Fall aus, in
-- dem nichts zu tun ist: Der Preparer selbst tritt seinem eigenen Vorsorgefall
-- bei, etwa mit einem zweiten Gerät. Seine Shares liegen bereits, wo sie
-- hingehören.

create function public.on_membership_created() returns trigger
  language plpgsql security definer set search_path = public as $fn$
begin
  update cases set vault_resplit_pending = true
   where id = new.case_id
     and status = 'vorsorge'
     and preparer_id is distinct from new.user_id;
  return new;
end $fn$;

-- `after insert`: Der Trigger ändert die einfügende Zeile nicht, und `cases`
-- soll erst hochgezählt werden, wenn die Mitgliedschaft wirklich steht.
create trigger memberships_created after insert on memberships
  for each row execute function public.on_membership_created();
