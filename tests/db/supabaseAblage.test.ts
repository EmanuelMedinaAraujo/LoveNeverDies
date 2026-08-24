import type { SupabaseClient } from '@supabase/supabase-js'
import { describe, expect, it } from 'vitest'
import { AblageFehler, dokumentPfad } from '../../src/core/db/ablage'
import { supabaseAblage } from '../../src/core/db/supabaseAblage'

/**
 * Die Übersetzung zwischen Port und Supabase Storage (DESIGN.md §7).
 *
 * Absichtlich kein echter Stack: Ob die Policy greift, steht daneben in
 * `dokumente.test.ts` gegen PGlite. Hier geht es um das, was dieser Adapter
 * allein entscheidet — welcher Bucket, welcher Pfad, welcher Content-Type, und
 * was er aus einem `StorageError` macht.
 */

type Antwort = { data: unknown; error: { message: string } | null }

function stubStorage(antwort: Antwort) {
  const gesehen: {
    bucket?: string
    hochgeladen?: { pfad: string; koerper: Blob; optionen: unknown }
    geholt?: string
    entfernt?: string[]
  } = {}

  const client = {
    storage: {
      from(bucket: string) {
        gesehen.bucket = bucket

        return {
          upload(pfad: string, koerper: Blob, optionen: unknown) {
            gesehen.hochgeladen = { pfad, koerper, optionen }
            return Promise.resolve(antwort)
          },
          download(pfad: string) {
            gesehen.geholt = pfad
            return Promise.resolve(antwort)
          },
          remove(pfade: string[]) {
            gesehen.entfernt = pfade
            return Promise.resolve(antwort)
          },
        }
      },
    },
  } as unknown as SupabaseClient

  return { client, gesehen }
}

const PFAD = dokumentPfad('fall-1', 'item-1')

describe('dokumentPfad', () => {
  it('ist der Fall, dann das Item — die Form aus §7', () => {
    expect(dokumentPfad('fall-1', 'item-1')).toBe('fall-1/item-1')
  })
})

describe('supabaseAblage.lade', () => {
  it('legt im Bucket "documents" ab, ohne den MIME-Typ zu verraten', async () => {
    const { client, gesehen } = stubStorage({ data: { path: PFAD }, error: null })

    await supabaseAblage(client).lade(PFAD, new Uint8Array([1, 2, 3]))

    expect(gesehen.bucket).toBe('documents')
    expect(gesehen.hochgeladen?.pfad).toBe(PFAD)
    expect(gesehen.hochgeladen?.optionen).toMatchObject({
      contentType: 'application/octet-stream',
      upsert: false,
    })
    expect(await gesehen.hochgeladen?.koerper.arrayBuffer()).toEqual(
      new Uint8Array([1, 2, 3]).buffer,
    )
  })

  it('macht aus einem StorageError einen AblageFehler mit Grund', async () => {
    const { client } = stubStorage({ data: null, error: { message: 'The resource already exists' } })

    await expect(supabaseAblage(client).lade(PFAD, new Uint8Array([1]))).rejects.toThrow(
      /nicht hochzuladen: The resource already exists/,
    )
  })
})

describe('supabaseAblage.hole', () => {
  it('gibt die Bytes zurück, die unter dem Pfad liegen', async () => {
    const { client, gesehen } = stubStorage({ data: new Blob([new Uint8Array([7, 8])]), error: null })

    expect(await supabaseAblage(client).hole(PFAD)).toEqual(new Uint8Array([7, 8]))
    expect(gesehen.geholt).toBe(PFAD)
  })

  it('meldet auch eine leere Antwort ohne Fehler als Fehlschlag', async () => {
    // Die Policy gibt das Objekt nicht her: `supabase-js` liefert dann je nach
    // Fassung einen Fehler oder gar nichts. Beides ist derselbe Fehlschlag.
    const { client } = stubStorage({ data: null, error: null })

    await expect(supabaseAblage(client).hole(PFAD)).rejects.toBeInstanceOf(AblageFehler)
  })
})

describe('supabaseAblage.entferne', () => {
  it('entfernt genau diesen einen Pfad', async () => {
    const { client, gesehen } = stubStorage({ data: [{ name: PFAD }], error: null })

    await supabaseAblage(client).entferne(PFAD)

    expect(gesehen.entfernt).toEqual([PFAD])
  })

  it('meldet einen Fehlschlag, damit der Aufräumjob nicht die einzige Zusage bleibt', async () => {
    const { client } = stubStorage({ data: null, error: { message: 'Object not found' } })

    await expect(supabaseAblage(client).entferne(PFAD)).rejects.toThrow(
      /nicht zu entfernen: Object not found/,
    )
  })
})
