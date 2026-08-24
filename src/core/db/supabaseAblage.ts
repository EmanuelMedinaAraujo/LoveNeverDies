/**
 * Die Dateiablage über Supabase Storage (DESIGN.md §7, §4).
 *
 * Die Umsetzung des Ports aus `ablage.ts`. Sie übersetzt zwischen Bytes und
 * dem `Blob`, den `supabase-js` erwartet, und macht aus einem `StorageError`
 * eine Meldung. Wer auf einen Pfad zugreifen darf, entscheidet die Policy auf
 * `storage.objects`; was in der Datei steht, weiß nur, wer den DEK hat.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { AblageFehler, DOKUMENTE_BUCKET, type Dokumentablage } from './ablage'

/**
 * Der Server erfährt den MIME-Typ nicht.
 *
 * Er steht im verschlüsselten Payload (§3.3) und hat im Header nichts zu
 * suchen: `image/jpeg` neben einem Ordner, der eine `case_id` heißt, sagt
 * bereits, dass hier jemand ein Dokument fotografiert hat. Beim Öffnen kommt
 * der Typ ohnehin aus dem Payload. Ausgeliefert wird eine undurchsichtige
 * Bytefolge, und genau das ist sie.
 */
const OHNE_TYP = 'application/octet-stream'

export function supabaseAblage(client: SupabaseClient): Dokumentablage {
  const bucket = () => client.storage.from(DOKUMENTE_BUCKET)

  return {
    async lade(pfad, ciphertext) {
      const { error } = await bucket().upload(pfad, new Blob([ciphertext as BlobPart]), {
        contentType: OHNE_TYP,
        // Kein Überschreiben: siehe `ablage.ts`. Der Bucket lässt UPDATE
        // ohnehin nicht zu. Hier scheitert es mit einer Meldung statt mit
        // "row-level security".
        upsert: false,
      })

      if (error !== null) {
        throw new AblageFehler(`Das Dokument war nicht hochzuladen: ${error.message}`, {
          cause: error,
        })
      }
    },

    async hole(pfad) {
      const { data, error } = await bucket().download(pfad)

      if (error !== null || data === null) {
        throw new AblageFehler(
          `Das Dokument war nicht abzurufen: ${error?.message ?? 'Es liegt nichts unter diesem Pfad.'}`,
          { cause: error ?? undefined },
        )
      }

      return new Uint8Array(await data.arrayBuffer())
    },

    async entferne(pfad) {
      const { error } = await bucket().remove([pfad])

      if (error !== null) {
        throw new AblageFehler(`Das Dokument war nicht zu entfernen: ${error.message}`, {
          cause: error,
        })
      }
    },
  }
}
