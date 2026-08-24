-- Dokumente: Bucket, Pfadbindung, Zugriff und Aufräumjob (DESIGN.md §7, §4, §5)
--
-- Ein Dokument ist ein Item mit `kind = 'file'`. Im Klartext steht davon genau
-- eine Angabe mehr als bei einer Aufgabe: `storage_path`. Dateiname, MIME-Typ,
-- Größe und die Aufgabe, an der das Dokument hängt, liegen im Payload,
-- verschlüsselt unter einem eigenen DEK (§3.1). Der Server trägt die Datei aus
-- und kann sie nie ansehen.
--
-- Drei Dinge entstehen hier, und alle drei sind Zusagen der Datenbank:
--
--   1. Der Pfad ist an das Item gebunden: `{case_id}/{item_id}`, nichts sonst.
--   2. Wer im Fall ist, liest und schreibt seinen Ordner; wer nicht, sieht ihn
--      nicht (§7).
--   3. Ein gelöschtes Dokument nimmt seine Datei mit. Der Client löscht sie
--      beim Setzen des Tombstones; was trotzdem liegen bleibt, benennt
--      `dokumente_zum_aufraeumen` nach 7 Tagen, und die Edge Function
--      `dokumente-aufraeumen` entfernt es über die Storage-API.

/*
 * Der Pfad ist keine freie Angabe (§7).
 *
 * §7 nennt `{case_id}/{item_id}`, und der Aufräumjob unten findet die Datei zu
 * einem getombsteten Item ausschließlich über diese Gleichung. Stünde der Pfad
 * frei, zeigte ein Mitglied sein eigenes Item auf das Objekt eines fremden
 * Falls, löschte das Item, und der Job risse sieben Tage später eine fremde
 * Sterbeurkunde weg. Die Storage-Policy allein verhindert das nicht: Sie prüft,
 * wer schreiben darf, nicht, worauf ein Item zeigt.
 *
 * Die Äquivalenz in beide Richtungen: Ein `kind = 'file'` ohne Pfad wäre ein
 * Dokument ohne Datei, ein `kind = 'item'` mit Pfad eine Datei, die niemand je
 * öffnet und die kein Löschen je mitnimmt.
 */
alter table items
  add constraint items_storage_path_gehoert_zum_item
  check (
    (kind = 'file') = (storage_path is not null)
    and (storage_path is null or storage_path = case_id::text || '/' || id::text)
  );

/*
 * Der Weg vom Pfad zum Item.
 *
 * Der Aufräumjob fragt für jedes Objekt im Bucket, ob es ein Item dazu gibt und
 * ob dessen Tombstone alt genug ist. Ohne Index sind das zwei Durchläufe über
 * `items` je Objekt: Bei ein paar hundert Fällen ein täglicher Seq-Scan über
 * alles, was es gibt.
 *
 * Partiell, weil ausser den Dokumenten niemand eine `storage_path` trägt (der
 * CHECK oben lässt es gar nicht zu): Der Index bleibt so klein wie die Zahl der
 * Dokumente und nicht wie die der Aufgaben.
 */
create index items_storage_path_idx on items (storage_path)
  where storage_path is not null;

/*
 * Der Bucket ist privat. Öffentlich hieße: Wer den Pfad kennt, lädt die Datei
 * ohne Anmeldung. Der Pfad ist aus `case_id` und `item_id` gebaut, also
 * für jedes Mitglied ohnehin sichtbar. Verschlüsselt wäre sie trotzdem, aber
 * eine Zusage, die allein an der Kryptographie hängt, ist eine Zusage weniger.
 *
 * `file_size_limit` sind die 15 MB aus §7, hier als Zusage des Servers. Der
 * Client prüft dieselbe Grenze vorher und sagt dann etwas Verständliches; diese
 * Zeile trägt den Fall, in dem er es nicht tut.
 *
 * `on conflict do nothing`: Ein Projekt, in dem der Bucket schon steht (von
 * Hand angelegt, aus einer früheren Fassung), soll nicht an der Migration
 * scheitern.
 */
insert into storage.buckets (id, name, public, file_size_limit)
  values ('documents', 'documents', false, 15 * 1024 * 1024)
  on conflict (id) do nothing;

/*
 * Zugriff über den ersten Pfadabschnitt (§7).
 *
 * `storage.foldername(name)` zerlegt `{case_id}/{item_id}` in seine Ordner;
 * `[1]` ist die `case_id`. Mehr braucht die Regel nicht. Dass das Item
 * existiert, entscheidet `items`, und dass der Pfad zu ihm gehört, der CHECK
 * oben.
 *
 * Ein UPDATE gibt es bewusst nicht: Ein Dokument wird angelegt und gelöscht,
 * nie überschrieben. Der DEK gilt für genau diesen Ciphertext, und ein zweiter
 * Upload unter demselben Pfad machte die Datei für jedes Gerät unlesbar, das
 * den alten Payload schon hat.
 */
create policy dokumente_lesen on storage.objects for select
  using (
    bucket_id = 'documents'
    and is_member((storage.foldername(name))[1]::uuid)
  );

create policy dokumente_schreiben on storage.objects for insert
  with check (
    bucket_id = 'documents'
    and is_member((storage.foldername(name))[1]::uuid)
  );

create policy dokumente_loeschen on storage.objects for delete
  using (
    bucket_id = 'documents'
    and is_member((storage.foldername(name))[1]::uuid)
  );

/*
 * Der Aufräumjob, erster Teil: Was liegen geblieben ist (§7).
 *
 * "Löschen entfernt auch die Datei": Der Client löscht das Storage-Objekt beim
 * Setzen des Tombstones. Diese Funktion ist das Netz darunter, für den Client,
 * dem beim Löschen die Verbindung wegbricht, und für den Upload, dessen
 * Item-Zeile nie geschrieben wurde.
 *
 * Sie löscht nicht selbst, sie zeigt nur. Ein `delete from storage.objects`
 * weist die Plattform ausdrücklich ab ("Direct deletion from storage tables is
 * not allowed"), und zwar zu Recht: Die Zeile ist nur der Katalogeintrag, die
 * Bytes liegen im Objektspeicher. Wer die Zeile wegnähme, hinterliesse die
 * Datei, genau das Gegenteil dessen, was §7 verlangt. Entfernt wird deshalb
 * über die Storage-API, in der Edge Function `dokumente-aufraeumen`, die diese
 * Liste holt und abarbeitet.
 *
 * Die Karenz ist kein Papierkorb. Löschen gewinnt weiterhin endgültig (§5);
 * die sieben Tage existieren allein, damit der Job kein Objekt unter einem
 * Client wegzieht, der gerade mitten im Download ist.
 *
 * Zwei Sorten Rückstand, dieselbe Frist:
 *
 *   - Getombstetes Item, Datei liegt noch. Der Fall aus §7. Gemessen wird
 *     an `items.updated_at`, denn das ist der Zeitpunkt des Tombstones und nicht
 *     das Alter der Datei, die Wochen vorher hochgeladen wurde.
 *   - Datei ohne Item. Der Upload gelingt, das INSERT auf `items` nicht.
 *     Diese Datei gehört zu nichts, kann von niemandem geöffnet werden und
 *     stünde sonst für immer da. Gemessen wird hier am Alter des Objekts: Ein
 *     Upload, dessen INSERT gerade unterwegs ist, ist Sekunden alt.
 *
 * `security definer`, weil der Job unter keiner Anmeldung läuft und die
 * Storage-Policies oben gegen `auth.jwt() ->> 'sub'` prüfen.
 */
create function public.dokumente_zum_aufraeumen(p_karenz interval default '7 days')
  returns setof text
  language sql security definer set search_path = public, storage stable as $fn$
  select o.name
    from storage.objects o
   where o.bucket_id = 'documents'
     and (
       exists (
         select 1 from items i
          where i.storage_path = o.name
            and i.deleted
            and i.updated_at < now() - p_karenz
       )
       or (
         not exists (select 1 from items i where i.storage_path = o.name)
         and o.created_at < now() - p_karenz
       )
     )
   order by o.name;
$fn$;

/*
 * Niemandem offen ausser dem Job.
 *
 * Postgres erteilt neuen Funktionen `execute` an `public`, und `anon` erbt das.
 * Diese hier läuft an den Policies vorbei und listet die Pfade *aller* Fälle.
 * Für eine angemeldete Person wäre das eine Liste fremder Ordner, für `anon`
 * eine ohne jede Anmeldung.
 */
revoke execute on function public.dokumente_zum_aufraeumen(interval) from public;
grant execute on function public.dokumente_zum_aufraeumen(interval) to service_role;
