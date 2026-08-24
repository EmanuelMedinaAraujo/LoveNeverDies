/**
 * `items` als schmale Tabelle (DESIGN.md §3.3, §4).
 *
 * Der Port, den der `aufgabenService` benutzt. Was hier durchgeht, ist entweder
 * eine der Klartextspalten aus §3.3 (`seq`, `kind`, `deleted`, `in_vault`,
 * `kid`) oder ein Envelope. Titel, Beschreibung, Typ und Erledigt-Status
 * liegen im `payload`, verschlüsselt unter einem DEK, der seinerseits unter
 * `K_c` gewrappt in derselben Zeile steht.
 *
 * Eine Spalte fehlt absichtlich in den Schreibwegen: `seq` vergibt
 * ausschließlich der Trigger `items_assign_seq` (§4). Ein Port, der sie
 * annähme, führte in Versuchung, sie zu setzen.
 *
 * `storage_path` gehört dagegen dazu, seit es Dokumente gibt (§7), allerdings
 * nur beim Anlegen. Er ist `{case_id}/{item_id}` und ändert sich nie. Die
 * Datenbank hält die Gleichung als CHECK fest, damit ein Item nie auf eine
 * fremde Datei zeigt.
 *
 * Und eine Operation fehlt: Es gibt kein Löschen. Auf `items` ist DELETE per
 * RLS für alle ausgeschlossen. Was danach aussieht, ist ein Tombstone (§5).
 */

/**
 * Die Werte des CHECK aus §4, unübersetzt: `kind` unterscheidet ausschließlich
 * eine Aufgabe von einer Datei. Alles, was inhaltlich zwischen Items
 * unterscheidet, liegt verschlüsselt im Payload und geht den Server nichts an.
 */
export type Inhaltsart = 'item' | 'file'

export type InhaltZeile = {
  id: string
  fallId: string
  /** Vom Trigger vergeben, streng steigend je Fall (§4, §5). */
  seq: number
  art: Inhaltsart
  /** Tombstone. Eine gelöschte Zeile bleibt stehen und wird nie hart gelöscht. */
  geloescht: boolean
  /** DEK unter `K_v` statt `K_c` (§3.5). */
  imTresor: boolean
  /** Benennt den Schlüssel, unter dem `wrappedDek` liegt: `K_c`, `K_v` oder `K_p`. */
  kid: string
  wrappedDek: Uint8Array
  payload: Uint8Array
  geaendertAm: string
}

export type NeuerInhalt = {
  /**
   * Clientseitig erzeugte UUIDv7, damit Anlegen später offline funktioniert
   * (§5), bei einer Aufgabe aus dem Rechtskatalog stattdessen die
   * deterministische UUIDv5 aus `katalogItemId` (§8).
   */
  id: string
  fallId: string
  art: Inhaltsart
  kid: string
  wrappedDek: Uint8Array
  payload: Uint8Array
  /**
   * `{case_id}/{item_id}`: Pflicht bei `art: 'file'`, verboten sonst (§7).
   *
   * Auf dem Leseweg steht er nicht: Er ist aus `fallId` und `id` herzuleiten,
   * und die Datenbank erzwingt genau diese Gleichung. Eine Spalte, die in jedem
   * Delta und in jedem Cache-Eintrag mitreiste, ohne je etwas Neues zu sagen,
   * wäre nur Gewicht.
   */
  storagePfad?: string | undefined
  /** `in_vault = true` für Inhalte im Nachlass-Tresor (§3.5). */
  imTresor?: boolean | undefined
}

/**
 * Ein Fehlschlag, über den der Server geurteilt hat (§5).
 *
 * Die Unterscheidung, an der die Offline-Queue hängt: Eine abgelehnte
 * Mutation hat der Server gesehen und verworfen. Sie gehört aus der Queue
 * heraus und als Mitteilung auf den Bildschirm, denn ein zweiter Versuch
 * brächte dasselbe Ergebnis. Eine Mutation, die ihn nie erreicht hat, bleibt
 * stehen und geht beim nächsten Reconnect erneut hinaus.
 *
 * Wer den Unterschied kennt, ist die Umsetzung dieses Ports: Nur sie weiss, ob
 * überhaupt jemand geantwortet hat. Sie sagt es, indem sie einen `Error` mit
 * `abgelehnt: true` wirft.
 */
export type AbgelehntFehler = Error & { abgelehnt: true }

/** Ob dieser Fehlschlag ein Urteil des Servers ist, und kein Netzproblem. */
export function istAbgelehnt(fehler: unknown): fehler is AbgelehntFehler {
  return fehler instanceof Error && (fehler as { abgelehnt?: unknown }).abgelehnt === true
}

export type InhalteTabelle = {
  /**
   * Das Delta aus §5: alle Zeilen eines Falls mit `seq > wasserzeichen`,
   * Tombstones eingeschlossen.
   *
   * Sortiert wird über `seq` und ausdrücklich nicht über die `id`. Das
   * Wasserzeichen wandert am Ende auf die höchste gesehene Nummer, und das
   * trägt nur, wenn die Zeilen in dieser Reihenfolge ankommen. Die
   * Anzeigereihenfolge über die `id` stellt der Reconciler her.
   *
   * @param wasserzeichen die höchste `seq`, die dieses Gerät gesehen hat. `0`
   * ist die vollständige Resynchronisation und kein Sonderweg (§5).
   */
  seit(fallId: string, wasserzeichen: number): Promise<InhaltZeile[]>

  lege(neu: NeuerInhalt): Promise<void>

  /**
   * Legt mehrere Items in einem Zug an und übergeht dabei, was es schon gibt:
   * `insert … on conflict do nothing` (§8).
   *
   * Der Weg, den der Rechtskatalog nimmt. Die IDs sind deterministisch
   * (`katalogItemId`), also rechnen zwei gleichzeitig instanziierende
   * Mitglieder dieselben aus, und die zweite Einfügung ist ein Nulleffekt statt
   * eines Duplikats oder eines Fehlers.
   *
   * Warum nicht {@link lege} in einer Schleife: Erstens die Zusage, dass ein
   * Duplikat hier kein Fehlschlag ist, sondern der Normalfall des Rennens.
   * Zweitens die Kosten: Vierzig Aufgaben wären vierzig Rundläufe.
   *
   * Ein Aufrufer, der nur die fehlenden Zeilen übergibt, drückt sich damit
   * nicht: Das `on conflict` fängt genau die Zeilen, die zwischen seinem Blick
   * auf den Bestand und diesem Aufruf entstanden sind.
   */
  legeAlleNeuen(neue: NeuerInhalt[]): Promise<void>

  /**
   * Schreibt einen neuen Payload. Der DEK bleibt, wo er ist: Er ändert sich
   * nie (§3.1), und deshalb kostet ein Edit genau eine Spalte.
   */
  schreibePayload(id: string, payload: Uint8Array): Promise<void>

  /**
   * Wrappt den DEK eines Tresor-Items von `K_v` auf `K_c` um und holt es damit
   * aus dem Tresor (§3.5).
   *
   * Der Payload bleibt, wo er ist: Der DEK ändert sich nie, es wechselt nur der
   * Schlüssel, unter dem er liegt (§3.1). `in_vault` fällt im selben Zug auf
   * `false` — ein Item, dessen DEK unter `K_c` liegt, aber weiter im Tresor
   * stünde, wäre für jeden lesbar und für niemanden auffindbar.
   */
  umwrappe(id: string, kid: string, wrappedDek: Uint8Array): Promise<void>

  /**
   * Setzt den Tombstone und leert dabei Payload und DEK.
   *
   * Das Leeren ist keine Zugabe: Tombstones werden nie garbage-collected (§5),
   * eine gelöschte Aufgabe läge sonst für immer als Ciphertext auf dem Server.
   * Verloren geht nichts: `deleted` ist endgültig, die Datenbank weist ein
   * `deleted → false` ab (§4), und niemand liest den Payload einer gelöschten
   * Zeile je wieder.
   */
  loesche(id: string): Promise<void>
}
