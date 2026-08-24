/**
 * Kopplungscodes über Supabase (DESIGN.md §6, §4).
 *
 * Die Umsetzung des Ports aus `kopplung.ts`. Drei RPCs, keine Tabellenabfrage:
 * `pairing_codes` hat weder Policy noch `grant`, und das ist keine Lücke,
 * sondern die Zusage aus §4.
 *
 * Alle drei sind `returns table (...)` bzw. `returns void`, PostgREST liefert
 * also ein Array. Diese Datei nimmt die erste Zeile und übersetzt sie in den
 * Port; die Regeln darüber, was ein Status bedeutet, stehen im
 * `kopplungService`.
 */

import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js'
import { alsBytea, ausBytea } from './bytea'
import type {
  Einloesung,
  Einloesungsstatus,
  Kopplungsabschluss,
  Kopplungscode,
  KopplungTabelle,
  Kopplungszweck,
} from './kopplung'

type RohCode = { code: string; expires_at: string }

type RohEinloesung = {
  status: Einloesungsstatus
  purpose: Kopplungszweck | null
  user_id: string | null
  display_name: string | null
  email: string | null
  device_id: string | null
  public_key: unknown
  sig_public_key: unknown
}

export class KopplungscodeFehler extends Error {
  constructor(was: string, ursache?: PostgrestError) {
    super(ursache === undefined ? was : `${was}: ${ursache.message}`)
    this.name = 'KopplungscodeFehler'
    this.cause = ursache
  }
}

/**
 * Die erste Zeile einer set-returning RPC.
 *
 * Der Umweg über `unknown` ist nötig, weil `supabase-js` den Rückgabetyp einer
 * RPC ohne generierte Datenbanktypen als einzelnes Objekt annimmt.
 * `erzeuge_kopplungscode` und `loese_kopplungscode_ein` sind aber
 * `returns table (...)`, PostgREST liefert also ein Array — die Kodierung ist
 * hier bekannt und die Typannahme daneben.
 *
 * Keine leere Antwort erwartet und trotzdem geprüft: Ein `null` aus einer
 * Funktion, die immer eine Zeile liefert, ist ein Zeichen dafür, dass die
 * Migration und dieser Client auseinanderlaufen — und das soll auffallen,
 * bevor es als fehlender Name durch die Oberfläche geht.
 */
function ersteZeile<T>(daten: unknown, was: string): T {
  const zeile = Array.isArray(daten) ? (daten[0] as T | undefined) : undefined

  if (zeile === undefined) {
    throw new KopplungscodeFehler(`${was} kam ohne Ergebnis zurück.`)
  }

  return zeile
}

export function supabaseKopplung(client: SupabaseClient): KopplungTabelle {
  return {
    async erzeugeCode(geraeteId, zweck): Promise<Kopplungscode> {
      const { data, error } = await client.rpc('erzeuge_kopplungscode', {
        p_geraet: geraeteId,
        p_zweck: zweck,
      })

      if (error !== null) {
        throw new KopplungscodeFehler('Der Kopplungscode war nicht auszugeben', error)
      }

      const zeile = ersteZeile<RohCode>(data, 'Der Kopplungscode')

      return { code: zeile.code, laeuftAbAm: zeile.expires_at }
    },

    async loeseEin(code): Promise<Einloesung> {
      const { data, error } = await client.rpc('loese_kopplungscode_ein', { p_code: code })

      if (error !== null) {
        throw new KopplungscodeFehler('Der Kopplungscode war nicht einzulösen', error)
      }

      const zeile = ersteZeile<RohEinloesung>(data, 'Die Einlösung')

      if (zeile.status !== 'ok') {
        return { status: zeile.status }
      }

      /*
       * Bei `ok` müssen alle Felder da sein — die Funktion füllt sie gemeinsam.
       * Fehlt eines, ist die Antwort nicht halb brauchbar, sondern unbrauchbar:
       * Ein Angebot ohne Namen unterläuft §6, und ein Angebot ohne beide
       * Schlüssel ergäbe einen Prüfcode, der nichts abdeckt (§3.6).
       */
      if (
        zeile.purpose === null ||
        zeile.user_id === null ||
        zeile.display_name === null ||
        zeile.device_id === null
      ) {
        throw new KopplungscodeFehler('Die Einlösung kam unvollständig zurück.')
      }

      return {
        status: 'ok',
        angebot: {
          zweck: zeile.purpose,
          userId: zeile.user_id,
          anzeigename: zeile.display_name,
          email: zeile.email,
          geraeteId: zeile.device_id,
          pkKem: ausBytea(zeile.public_key),
          pkSig: ausBytea(zeile.sig_public_key),
        },
      }
    },

    async schliesseAb(abschluss: Kopplungsabschluss) {
      const { error } = await client.rpc('schliesse_kopplung_ab', {
        p_code: abschluss.code,
        p_fall_id: abschluss.fallId,
        p_kid_fall: abschluss.kidFall,
        p_kid_katalog: abschluss.kidKatalog,
        p_absender: abschluss.absenderId,
        p_fall_kem_ct: alsBytea(abschluss.wrapFall.kemCt),
        p_fall_wrapped_key: alsBytea(abschluss.wrapFall.wrappedKey),
        p_fall_signatur: alsBytea(abschluss.wrapFall.signatur),
        p_kat_kem_ct: alsBytea(abschluss.wrapKatalog.kemCt),
        p_kat_wrapped_key: alsBytea(abschluss.wrapKatalog.wrappedKey),
        p_kat_signatur: alsBytea(abschluss.wrapKatalog.signatur),
      })

      if (error !== null) {
        throw new KopplungscodeFehler('Die Kopplung war nicht abzuschließen', error)
      }
    },
  }
}
