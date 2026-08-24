-- Inhalte: `items`, Sequenzzähler und Tombstones (DESIGN.md §3.3, §4, §5)
--
-- Die erste Tabelle, in der etwas steht, das jemand geschrieben hat. Bis hier
-- trug das Schema ausschließlich Schlüssel und Zugehörigkeiten; ab hier gibt es
-- Inhalt, den mehrere Geräte abgleichen müssen. Deshalb entsteht mit der
-- Tabelle zugleich der Zähler, an dem der Delta-Sync hängt.
--
-- Im Klartext bleiben nur die Spalten aus §3.3. Titel, Beschreibung, Typ und
-- Erledigt-Status liegen im Payload, verschlüsselt unter einem DEK, der pro
-- Item erzeugt und unter `K_c` gewrappt wird (§3.1). Der Server kann eine
-- Aufgabe zählen, datieren und ausliefern, lesen kann er sie nie.

create table items (
  id           uuid primary key,                   -- UUIDv7 vom Client (§5)
  case_id      uuid not null references cases(id) on delete cascade,
  seq          bigint not null,                    -- vom Trigger, nie vom Client
  updated_at   timestamptz not null default now(),
  kind         text not null check (kind in ('item','file')),
  deleted      boolean not null default false,     -- Tombstone
  in_vault     boolean not null default false,     -- DEK unter K_v statt K_c
  kid          text not null,                      -- K_c-, K_v- oder K_p-Generation
  wrapped_dek  bytea not null,
  payload      bytea not null,
  storage_path text                                -- nur bei kind = 'file'
);

/*
 * §4 verlangt hier einen Index auf `(case_id, seq)`, weil `seq > watermark`
 * der ganze Delta-Sync ist (§5). Er ist zusätzlich eindeutig.
 *
 * Die strenge Monotonie trägt die Zeilensperre in `items_assign_seq`. Der
 * eindeutige Index ändert daran nichts und macht die Zusage auch nicht wahr.
 * Er sorgt dafür, dass sie nicht still gebrochen werden kann. Ein Trigger, der
 * die Sperre eines Tages verlöre, schriebe sonst zwei Zeilen mit derselben
 * Nummer, und ein Client mit dieser Nummer als Wasserzeichen sähe eine davon
 * nie wieder. Kosten: keine, denn genau diese Spalten stünden ohnehin im Index.
 */
create unique index items_case_seq_idx on items (case_id, seq);

/*
 * Die Nummer vergibt der Fall, nicht die Tabelle (§4).
 *
 * `bigserial` scheidet aus zwei Gründen aus: Es inkrementiert bei UPDATE nicht,
 * also übersähe der Delta-Sync jedes Edit und jeden Soft-Delete, und es vergibt
 * Nummern vor dem Commit: Eine Transaktion mit `seq = 41` könnte nach einer
 * mit `seq = 42` committen, und ein Client, der 42 gesehen hat, bekäme 41 nie
 * zu Gesicht.
 *
 * Das `update` sperrt die `cases`-Zeile bis zum Ende der schreibenden
 * Transaktion. Schreibvorgänge eines Falls serialisieren sich damit, und die
 * Commit-Reihenfolge entspricht exakt der `seq`-Reihenfolge. Bei Fällen von
 * höchstens zehn Personen ist der Durchsatzverlust kein Argument.
 *
 * `cases.version` ist dabei kein zweiter Zähler neben `seq`, sondern derselbe:
 * eine einzige Wahrheit, gegen die der billige Check aus §5 läuft
 * (`version > watermark`) und auf der die Realtime-Subscription sitzt.
 *
 * `security definer`, anders als in der Skizze in §4. Auf `cases` gibt es
 * bewusst keine UPDATE-Policy und kein UPDATE-Recht für `authenticated`: Wer
 * einen Fall ändern darf, entscheidet nicht diese Tabelle. Liefe der Trigger
 * als Aufrufer, träfe sein `update` auf keine Zeile, `v` bliebe NULL und jeder
 * Schreibvorgang scheiterte an `seq not null`. Die Rechteerweiterung ist eng:
 * Die Funktion zählt genau den Fall hoch, in den gerade geschrieben wird, und
 * *dass* dort geschrieben werden darf, hat die Policy auf `items` bereits
 * entschieden.
 */
create function public.items_assign_seq() returns trigger
  language plpgsql security definer set search_path = public as $fn$
declare v bigint;
begin
  update cases set version = version + 1
   where id = new.case_id
   returning version into v;

  -- Der Fremdschlüssel greift erst am Ende der Anweisung. Ohne diese Zeile
  -- meldete ein Item ohne Fall "seq darf nicht NULL sein" statt zu sagen, was
  -- wirklich fehlt.
  if v is null then
    raise exception 'Zu diesem Item gibt es keinen Fall %.', new.case_id using errcode = '23503';
  end if;

  new.seq        := v;
  new.updated_at := now();
  return new;
end $fn$;

create trigger items_seq before insert or update on items
  for each row execute function public.items_assign_seq();

/*
 * Löschen gewinnt endgültig (§5).
 *
 * `items_assign_seq` hebt `seq` auch bei einem `deleted -> false`, und
 * Last-Write-Wins trüge die Auferstehung an jedes Gerät. Ohne Durchsetzung
 * wäre die Regel eine Hoffnung.
 *
 * Der Trigger heißt `items_no_undelete` und läuft damit vor `items_seq`:
 * Postgres feuert BEFORE-Trigger in alphabetischer Reihenfolge. Am Ergebnis
 * ändert das nichts, eine Ausnahme rollt die ganze Anweisung zurück, aber
 * die abgewiesene Auferstehung fasst so keine zweite Tabelle an.
 *
 * Verboten ist ausschließlich der Rückweg. Ein UPDATE auf einem bereits
 * gelöschten Item bleibt erlaubt: Der Aufräumtrigger aus §4 leert Payload und
 * DEK einer getombsteten Zeile, und der Weg dorthin darf nicht zu sein.
 */
create function public.items_forbid_undelete() returns trigger
  language plpgsql as $fn$
begin
  if old.deleted and not new.deleted then
    raise exception 'Ein geloeschtes Item kann nicht wiederbelebt werden.'
      using errcode = '23514';
  end if;
  return new;
end $fn$;

create trigger items_no_undelete before update on items
  for each row execute function public.items_forbid_undelete();

alter table items enable row level security;

create policy items_read on items for select using (is_member(case_id));

create policy items_write on items for insert with check (is_member(case_id));

/*
 * Kein eigenes `with check`: Fehlt es, nimmt Postgres den `using`-Ausdruck
 * auch für die geänderte Zeile. Das ist hier die richtige Regel und nicht bloß
 * die kürzere: Sonst schöbe ein Mitglied seine Items per `case_id` in einen
 * fremden Fall, in dem es nichts zu suchen hat.
 */
create policy items_edit on items for update using (is_member(case_id));

/*
 * Kein DELETE, für niemanden (§4).
 *
 * Nicht bloß keine Policy, sondern auch kein Recht: Die Zeilen wurden zuvor an
 * alle Mitglieder synchronisiert und liegen in deren Ciphertext-Caches. Ein
 * hartes Löschen käme dort nie an, weil der Delta-Sync ausschließlich Zuwachs
 * trägt: Die Aufgabe verschwände auf einem Gerät und bliebe auf allen
 * anderen stehen. Gelöscht wird über `deleted = true`, und das ist ein UPDATE,
 * das `seq` hebt und deshalb wie jede andere Änderung ankommt.
 */
grant select, insert, update on items to authenticated;
