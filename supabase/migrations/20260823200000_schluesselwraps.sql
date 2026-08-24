-- Fall- und Katalogschlüssel, gewrappt pro Gerät (DESIGN.md §3.6, §4)
--
-- `K_c` und `K_cat` liegen serverseitig ausschließlich hier und ausschließlich
-- in dieser Form: an den öffentlichen Schlüssel genau eines Geräts gekapselt,
-- unter dem geteilten Geheimnis verschlüsselt, vom wrappenden Gerät signiert.
-- Eine Spalte für den Schlüssel selbst gibt es nicht, damit es keine gibt.

create table key_wraps (
  case_id     uuid references cases(id) on delete cascade,
  kid         text not null,                       -- "case_<uuid>:<gen>" | "cat_<uuid>"
  device_id   uuid references device_keys(id) on delete cascade,
  kem_ct      bytea not null,                      -- KEM-Ciphertext
  wrapped_key bytea not null,                      -- AES-GCM(ss, K_c bzw. K_cat)
  wrapped_by  uuid not null references device_keys(id) on delete restrict,
  signature   bytea not null,                      -- "LN-wrap-v1", §3.2
  primary key (case_id, kid, device_id)
);

-- Der Primärschlüssel ist zugleich die Zusage "erster Schreiber gewinnt" (§3.6).
-- Rotation erzeugt ohnehin ein neues `kid` und kollidiert deshalb nie.

-- Zwei Indizes für zwei Fremdschlüssel, die beide ohne sie sequenziell gelesen
-- würden: `device_id` steht in jeder Policy dieser Tabelle und wird beim
-- Löschen eines Geräts kaskadiert, `wrapped_by` hält mit `on delete restrict`
-- jedes Löschen eines Geräts auf, bis geprüft ist, dass es nichts gewrappt hat.
create index key_wraps_device_id_idx on key_wraps (device_id);
create index key_wraps_wrapped_by_idx on key_wraps (wrapped_by);

alter table key_wraps enable row level security;

/*
 * Lesen: nur die Wraps für die eigenen Geräte (§4).
 *
 * Nicht "alle Wraps des Falls": Ein Mitglied darf für ein fremdes Gerät
 * schreiben, aber nichts darüber erfahren, was dort schon liegt. Der Wrap
 * selbst gibt `K_c` nicht preis, die Einschränkung kostet nichts und nimmt
 * einer späteren Lücke im Kryptokern die Reichweite.
 */
create policy key_wraps_read on key_wraps for select
  using (exists (select 1 from device_keys d
                  where d.id = key_wraps.device_id
                    and d.user_id = (select auth.jwt()) ->> 'sub'));

/*
 * Schreiben: jedes Mitglied des Falls, aber nur im eigenen Namen.
 *
 * Der erste Teil ist der Zweck der Tabelle: ein neues Gerät liest nichts, bis
 * ein anderes Mitglied `K_c` daran wrappt (§3.6). Der zweite Teil bindet
 * `wrapped_by` an den Schreibenden: Gegen dieses Gerät prüft der Empfänger die
 * Signatur. Stünde dort ein fremdes, prüfte er gegen einen Schlüssel, den der
 * Absender nie besaß, und der Wrap wäre unentpackbar statt abgewiesen.
 */
create policy key_wraps_write on key_wraps for insert
  with check (is_member(case_id)
              and exists (select 1 from device_keys d
                           where d.id = wrapped_by
                             and d.user_id = (select auth.jwt()) ->> 'sub'));

/*
 * Es gibt keine UPDATE-Policy, und das ist die eigentliche Aussage dieser
 * Datei. Ein überschriebener Wrap ist der Angriff aus §3.6: Ein Mitglied
 * stellt einen formal gültigen Wrap eines falschen `K_c` ein und sperrt ein
 * Gerät dauerhaft aus. Ohne UPDATE bleibt als Weg nur DELETE, und der steht
 * ausschließlich dem Besitzer des betroffenen Geräts offen, damit er einen
 * fehlerhaften Wrap verwerfen und sich einen korrekten nachliefern lassen kann.
 */
create policy key_wraps_delete on key_wraps for delete
  using (exists (select 1 from device_keys d
                  where d.id = key_wraps.device_id
                    and d.user_id = (select auth.jwt()) ->> 'sub'));

-- Je Tabelle genau das, wofür es eine Policy gibt (§4). `update` fehlt hier
-- nicht aus Versehen: Ohne das Recht scheitert der Versuch schon vor der RLS.
grant select, insert, delete on key_wraps to authenticated;
