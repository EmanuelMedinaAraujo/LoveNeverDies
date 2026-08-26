/**
 * Der Nachlass-Tresor eines Falls (DESIGN.md §3.5).
 *
 * Im Tab Erbe legt der Preparer Inhalte in den Tresor: `in_vault = true`, DEK
 * unter `K_v` statt `K_c`.
 *
 * Gelesen wird aus demselben Delta wie Aufgaben und Dokumente: `zeilen` und
 * `mutiere` kommen aus dem Sync-Stream des Falls. Ein zweiter `useSync`
 * daneben hielte einen zweiten Cache, ein zweites Wasserzeichen und eine
 * zweite Queue für denselben Fall (§5, `useDokumente.ts`).
 *
 * Der Re-Split hängt dagegen nicht am Delta: Mitglieder und Geräte liest
 * `verteileShares` unmittelbar aus der Datenbank, nicht aus `zeilen`. Ein
 * Warten auf die Sync-Runde brächte hier nichts als Verzögerung.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from '../core/auth/authProvider.ts'
import type { InhaltZeile } from '../core/db/inhalte.ts'
import { supabaseGeraeteschluessel } from '../core/db/supabaseGeraeteschluessel.ts'
import { supabaseMitglieder } from '../core/db/supabaseMitglieder.ts'
import { supabaseTresor } from '../core/db/supabaseTresor.ts'
import { useSupabase } from '../core/db/supabaseProvider.tsx'
import type { Mutation } from '../core/sync/queue.ts'
import { alsNachricht } from '../core/fehler.ts'
import type { LesbarerFall } from '../services/fallService.ts'
import {
  antwortZuFrage,
  berechneTresorSchwelle,
  neueEigeneFrageId,
  mutationTresorAendern,
  mutationTresorAnlegen,
  mutationTresorLoeschen,
  tresorItemsAusZeilen,
  TresorDienstFehler,
  verteileShares as verteileSharesDienst,
  type TresorItem,
  type TresorSchwelle,
} from '../services/tresorService.ts'

export type Tresordaten = {
  /** Die Tresor-Inhalte, entschlüsselt. Leer, solange `K_v` fehlt. */
  items: TresorItem[]
  schwelle: TresorSchwelle
  /** Ob dieses Gerät `K_v` hat und damit schreiben darf (§3.5). */
  istPreparer: boolean
  /** Ob der Server eine Neuverteilung offen hat. */
  resplitPending: boolean
  legeItemAn: (titel: string, inhalt: string) => Promise<void>
  aendereItem: (item: TresorItem, titel: string, inhalt: string) => Promise<void>
  /**
   * Legt die Antwort auf eine Vorsorgefrage ab oder ersetzt sie
   * (`content/vorsorgefragen.ts`).
   *
   * Eine Frage, eine Zeile: Steht schon eine Antwort da, wird sie geändert und
   * nicht ein zweites Mal angelegt. Sonst stünde dieselbe Frage nach dem
   * zweiten Speichern doppelt im Tresor, und die Angehörigen läsen zwei
   * Auskünfte ohne Hinweis darauf, welche die spätere ist.
   */
  speichereAntwort: (frageId: string, frage: string, antwort: string) => Promise<void>
  /**
   * Legt eine selbst gestellte Vorsorgefrage an, zunächst ohne Antwort.
   *
   * Die Frage ist eine Tresorzeile wie jede andere: Ihr Wortlaut steht im
   * Titel, die Antwort im Inhalt. Sie entsteht deshalb schon in dem Moment, in
   * dem jemand sie stellt, und nicht erst mit der ersten Antwort — sonst wäre
   * eine notierte, aber noch offene Frage beim nächsten Öffnen der App wieder
   * verschwunden.
   */
  legeEigeneFrageAn: (frage: string) => Promise<void>
  loescheItem: (item: TresorItem) => Promise<void>
  /**
   * Verteilt die Shares von Hand neu.
   *
   * Der Normalfall läuft von allein, sobald `vault_resplit_pending` steht.
   * Diese Funktion ist der zweite Versuch nach einem Fehlschlag: Der
   * automatische wiederholt sich nicht, damit ein dauerhafter Fehler nicht in
   * eine Schleife läuft.
   */
  verteileShares: () => Promise<TresorSchwelle>
  resplitLaeuft: boolean
  resplitFehler: string | null
}

const KEINE: TresorItem[] = []

export function useTresor(
  fall: LesbarerFall,
  zeilen: InhaltZeile[],
  mutiere: (mutation: Mutation) => void,
  aktualisiereFall: () => void,
): Tresordaten {
  const zugang = useSupabase()
  const { zustand: authZustand } = useAuth()

  const [items, setzeItems] = useState<TresorItem[]>(KEINE)
  const [resplitLaeuft, setzeResplitLaeuft] = useState(false)
  const [resplitFehler, setzeResplitFehler] = useState<string | null>(null)

  const kv = fall.kv
  const istPreparer = fall.status === 'vorsorge' && kv !== null

  /*
   * `preparer_id` steht erst auf dem nachgeladenen Fall; der frisch angelegte
   * kennt sie noch nicht. Die eigene Kennung ist dort die richtige Antwort,
   * denn anlegen kann einen Vorsorgefall nur die vorsorgende Person selbst.
   */
  const preparerId =
    fall.preparerId ?? (authZustand.status === 'angemeldet' ? authZustand.benutzer.id : '')

  useEffect(() => {
    let aktuell = true

    void (async () => {
      if (kv === null) {
        if (aktuell) {
          setzeItems(KEINE)
        }
        return
      }

      const entschluesselt = await tresorItemsAusZeilen(zeilen, kv)

      if (aktuell) {
        setzeItems(entschluesselt.length === 0 ? KEINE : entschluesselt)
      }
    })()

    return () => {
      aktuell = false
    }
  }, [kv, zeilen])

  /*
   * Drei Refs und kein Zustand für die Sperre.
   *
   * Ein `useState`-Wert in der Abhängigkeitsliste des Effekts reisst den
   * Effekt in dem Moment ab, in dem er ihn setzt: React räumt die alte
   * Fassung auf, bevor die RPC antwortet, und alles, was danach am
   * Aufräum-Flag hängt, die Fehlermeldung, das Zurücksetzen der Anzeige,
   * fällt weg. Die Anzeige "Schlüssel werden neu verteilt..." bliebe für immer
   * stehen und ein Fehlschlag verschwände wortlos.
   */
  const laeuftRef = useRef(false)
  const versuchtRef = useRef(false)
  const montiertRef = useRef(true)

  useEffect(() => {
    montiertRef.current = true

    return () => {
      montiertRef.current = false
    }
  }, [])

  /*
   * Jede frisch geladene Fassung des Falls ist neue Auskunft und darf einen
   * neuen Versuch auslösen; `fall` bekommt seine Identität ausschließlich vom
   * Nachladen in `useCase`. Ein Fehlschlag lädt nicht nach und kommt deshalb
   * nicht wieder, bis der Screen neu aufgeht oder jemand von Hand nachhilft.
   *
   * Steht vor dem Re-Split-Effekt, weil React die Effekte in dieser
   * Reihenfolge ausführt und die Sperre gelöst sein muss, bevor er sie liest.
   */
  useEffect(() => {
    versuchtRef.current = false
  }, [fall])

  const fuehreResplitAus = useCallback(async (): Promise<TresorSchwelle> => {
    if (kv === null) {
      throw new TresorDienstFehler('Ohne Tresorschlüssel können keine Shares verteilt werden.')
    }

    if (laeuftRef.current) {
      throw new TresorDienstFehler('Eine Schlüsselverteilung läuft bereits.')
    }

    laeuftRef.current = true
    versuchtRef.current = true
    setzeResplitLaeuft(true)
    setzeResplitFehler(null)

    try {
      const client = zugang()

      const ergebnis = await verteileSharesDienst(
        supabaseTresor(client),
        supabaseMitglieder(client),
        supabaseGeraeteschluessel(client),
        fall.id,
        kv,
        preparerId,
      )

      // Der Server hat `vault_resplit_pending`, `vault_n` und `vault_k` in
      // derselben Transaktion gesetzt. Ohne Nachladen zeigte der Screen
      // weiter den Stand von vorhin, samt offener Fahne.
      aktualisiereFall()

      return ergebnis
    } finally {
      laeuftRef.current = false

      if (montiertRef.current) {
        setzeResplitLaeuft(false)
      }
    }
  }, [aktualisiereFall, fall.id, kv, preparerId, zugang])

  // Automatischer Re-Split, sobald `vault_resplit_pending` steht (§3.5).
  useEffect(() => {
    if (!fall.vaultResplitPending || !istPreparer || versuchtRef.current || laeuftRef.current) {
      return
    }

    void fuehreResplitAus().catch((ursache: unknown) => {
      if (montiertRef.current) {
        setzeResplitFehler(alsNachricht(ursache))
      }
    })
  }, [fall, fall.vaultResplitPending, fuehreResplitAus, istPreparer])

  const verteileShares = useCallback(async () => {
    try {
      return await fuehreResplitAus()
    } catch (ursache) {
      if (montiertRef.current) {
        setzeResplitFehler(alsNachricht(ursache))
      }

      throw ursache
    }
  }, [fuehreResplitAus])

  const legeItemAn = useCallback(
    async (titel: string, inhalt: string) => {
      if (kv === null) {
        throw new TresorDienstFehler(
          'Ohne Tresorschlüssel kann kein Tresor-Item angelegt werden.',
        )
      }

      mutiere(await mutationTresorAnlegen(fall.id, kv, titel, inhalt))
    },
    [fall.id, kv, mutiere],
  )

  const aendereItem = useCallback(
    async (item: TresorItem, titel: string, inhalt: string) => {
      mutiere(await mutationTresorAendern(item, titel, inhalt))
    },
    [mutiere],
  )

  const speichereAntwort = useCallback(
    async (frageId: string, frage: string, antwort: string) => {
      if (kv === null) {
        throw new TresorDienstFehler('Ohne Tresorschlüssel kann keine Antwort gespeichert werden.')
      }

      const vorhanden = antwortZuFrage(items, frageId)

      /*
       * Der Titel wird bei jedem Speichern mitgeschrieben, auch bei einer
       * Änderung: Ändern die Juristinnen den Wortlaut einer Frage, trägt die
       * Zeile beim nächsten Speichern den neuen. Angezeigt wird ohnehin der
       * Wortlaut aus der Inhaltsdatei; der Titel im Payload ist die Auskunft
       * für alles, was den Tresor ohne diese App liest.
       */
      mutiere(
        vorhanden === null
          ? await mutationTresorAnlegen(fall.id, kv, frage, antwort, frageId)
          : await mutationTresorAendern(vorhanden, frage, antwort),
      )
    },
    [fall.id, items, kv, mutiere],
  )

  const legeEigeneFrageAn = useCallback(
    async (frage: string) => {
      if (kv === null) {
        throw new TresorDienstFehler('Ohne Tresorschlüssel kann keine Frage angelegt werden.')
      }

      mutiere(await mutationTresorAnlegen(fall.id, kv, frage, '', neueEigeneFrageId()))
    },
    [fall.id, kv, mutiere],
  )

  const loescheItem = useCallback(
    async (item: TresorItem) => {
      mutiere(mutationTresorLoeschen(item.id))
    },
    [mutiere],
  )

  /*
   * `vault_n` und `vault_k` stehen auf dem Fall, sobald einmal verteilt wurde;
   * bis dahin ist die Rechnung aus §3.5 die beste Auskunft.
   */
  const schwelle = useMemo<TresorSchwelle>(() => {
    const n = fall.vaultN ?? 0

    return fall.vaultK === null || fall.vaultK === undefined
      ? berechneTresorSchwelle(n)
      : { n, k: fall.vaultK }
  }, [fall.vaultK, fall.vaultN])

  return useMemo(
    () => ({
      items,
      schwelle,
      istPreparer,
      resplitPending: fall.vaultResplitPending,
      legeItemAn,
      aendereItem,
      speichereAntwort,
      legeEigeneFrageAn,
      loescheItem,
      verteileShares,
      resplitLaeuft,
      resplitFehler,
    }),
    [
      aendereItem,
      fall.vaultResplitPending,
      istPreparer,
      items,
      legeEigeneFrageAn,
      legeItemAn,
      loescheItem,
      speichereAntwort,
      resplitFehler,
      resplitLaeuft,
      schwelle,
      verteileShares,
    ],
  )
}
