/**
 * Die Aufgaben eines Falls (DESIGN.md §3.3, §5, §7).
 *
 * Der Sync liegt darunter, in `useSync`: Cache, Delta, Türklingel und
 * Offline-Queue. Was hier passiert, ist der letzte Schritt aus §3.1: DEK
 * entpacken, Payload entschlüsseln. In die andere Richtung:
 * verschlüsseln und an die Queue hängen.
 *
 * Zwei Zusagen aus §5 stehen genau hier:
 *
 * "Gecachte Inhalte werden sofort gerendert." Sobald der Cache gelesen ist,
 * steht die Liste. Die Ladeanzeige gehört dem Netzwerk-Fetch, nicht dem
 * Entschlüsseln. Deshalb hat dieser Hook einen `laedt`-Zustand nur so lange,
 * bis der Cache da ist, und danach ein `laedtNetz` daneben.
 *
 * "Sichtbare Screens aktualisieren sich nur für tatsächlich geänderte Zeilen."
 * Der Reconciler ersetzt ausschliesslich die Zeilen, die sich geändert haben;
 * alle anderen behalten ihre Objektidentität. Daran erkennt dieser Hook, was er
 * nicht noch einmal entschlüsseln muss: Bei einem Fall mit hundert Aufgaben ist
 * das der Unterschied zwischen einer Türklingel und einer Denkpause.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from '../core/auth/authProvider.ts'
import type { InhaltZeile } from '../core/db/inhalte.ts'
import { supabaseGeraeteschluessel } from '../core/db/supabaseGeraeteschluessel.ts'
import { supabaseInhalte } from '../core/db/supabaseInhalte.ts'
import { supabasePersoenlicheSchluessel } from '../core/db/supabasePersoenlicheschluessel.ts'
import { useSupabase } from '../core/db/supabaseProvider.tsx'
import type { Mutation } from '../core/sync/queue.ts'
import {
  AufgabenFehler,
  aufgabenAusZeilen,
  beschreibeAbgelehnte,
  mutationAendern,
  mutationAnlegen,
  mutationLoeschen,
  type AbgelehnteAenderung,
  type Aufgabe,
  type Aufgabenaenderung,
} from '../services/aufgabenService.ts'
import {
  gibFuerAlleFrei as gibFuerAlleFreiDienst,
  ladePersoenlichenSchluessel,
  mutationPrivatAnlegen,
  pruefeAbhaengigkeiten,
  stellePersoenlichenSchluesselBereit,
  type PersoenlicherSchluessel,
} from '../services/privatService.ts'
import { baueBaum, type Aufgabenknoten } from '../services/aufgabenbaum.ts'
import { instanziiereKatalog, type Katalogfall } from '../services/katalogService.ts'
import {
  NIEMAND,
  istZugewiesen,
  mitPerson,
  uebernommenVon,
  type Zugewiesene,
  type Zuweisung,
} from '../services/zuweisung.ts'
import { useErinnerungen, type Erinnerungsdaten } from './useErinnerungen.ts'
import { useGeraeteanmeldung } from './useGeraete.ts'
import { useSync } from './useSync.ts'

/**
 * Was dieser Hook vom Fall braucht: die Schlüssel und das Sterbedatum, weil
 * ohne es keine Frist zu rechnen ist (§8).
 *
 * `LesbarerFall` aus `fallService` erfüllt das.
 */
export type Aufgabenfall = Katalogfall & { sterbedatum: string | null }

export type AufgabenZustand =
  | { status: 'laedt' }
  | {
      status: 'bereit'
      aufgaben: Aufgabe[]
      /**
       * Dieselben Aufgaben als Baum: Wurzeln mit ihren Unteraufgaben,
       * abgeleitetem Abschluss und offenen Abhängigkeiten (§7).
       */
      baum: Aufgabenknoten[]
      uebersprungen: number
      /** Läuft gerade ein Netzwerk-Fetch? Die Liste steht trotzdem (§5). */
      laedtNetz: boolean
      /** Was beim letzten Abruf schiefging. Die Liste bleibt stehen. */
      netzfehler: string | null
    }

/**
 * Eine Reservierung, die verloren ging (§7).
 *
 * "Greifen zwei gleichzeitig zu, gewinnt LWW, und die unterlegene Person
 * bekommt 'Bert hat diese Aufgabe übernommen' statt eines stillen Verlusts."
 */
export type Uebernahme = {
  itemId: string
  titel: string
  /** Wer sie jetzt hat. */
  name: string
}

export type Aufgabendaten = {
  zustand: AufgabenZustand
  /**
   * Der Bestand dieses Falls als Ciphertext: alle Zeilen, nicht nur die
   * Aufgaben (§5).
   *
   * Er steht hier, damit die Dokumente (§7) auf demselben Delta reiten können:
   * Ein zweiter `useSync` daneben hielte einen zweiten Cache, ein zweites
   * Wasserzeichen und eine zweite Queue für denselben Fall; zwei Runden, die
   * um dieselben Zeilen konkurrieren. Was ein Aufrufer davon liest, entscheidet
   * er über `art`.
   */
  zeilen: InhaltZeile[]
  /** Stellt eine Mutation in die Offline-Queue des Sync-Streams (§5). */
  mutiere: (mutation: Mutation) => void
  /**
   * Stösst eine Sync-Runde an.
   *
   * Für alles, was am Delta vorbei geschrieben hat und trotzdem sofort
   * sichtbar sein soll: Die Dokumente aus §7 gehen nicht durch die Queue.
   */
  aktualisiere: () => void
  /** Die lokalen Erinnerungen an die Fristen dieses Falls (§7). */
  erinnerungen: Erinnerungsdaten
  /**
   * Was der Server verworfen hat, mit entschlüsseltem Titel (§5). Verschwindet
   * erst, wenn jemand es zur Kenntnis nimmt.
   */
  abgelehnt: AbgelehnteAenderung[]
  bestaetige: () => void
  /**
   * @param parentId gesetzt, wenn eine Unteraufgabe entsteht (§7).
   * @param nurFuerMich legt die Aufgabe unter `K_p` ab (§3.7). Zusammen mit
   * einer `parentId` ein Wurf: Private Aufgaben sind immer Wurzelaufgaben.
   */
  legeAn: (titel: string, parentId?: string | null, nurFuerMich?: boolean) => Promise<void>
  schreibe: (aufgabe: Aufgabe, aenderung: Aufgabenaenderung) => Promise<void>
  hakeAb: (aufgabe: Aufgabe, erledigt: boolean) => Promise<void>
  loesche: (aufgabe: Aufgabe) => Promise<void>
  /**
   * Die angemeldete Person, so wie sie in eine Zuweisung geschrieben wird (§7).
   *
   * Ohne Anmeldung ist die Kennung leer. Dann ist niemand zugewiesen, und alles
   * bleibt schreibgeschützt. Die Screens hängen ohnehin hinter der Anmeldung,
   * aber die Sperre soll nicht davon abhängen, dass das so bleibt.
   */
  ich: Zugewiesene
  /** Trägt die angemeldete Person ein und reserviert die Aufgabe damit (§7). */
  uebernimm: (aufgabe: Aufgabe) => Promise<void>
  /** Löst eine Reservierung, auch eine fremde (§7). */
  gibFrei: (aufgabe: Aufgabe) => Promise<void>
  /** Setzt die Zuweisung ganz: Personen, "Alle" oder niemand (§7). */
  weiseZu: (aufgabe: Aufgabe, zuweisung: Zuweisung) => Promise<void>
  /** Reservierungen, die an eine andere Person gingen. */
  uebernahmen: Uebernahme[]
  /** Nimmt sie zur Kenntnis und räumt sie weg. */
  bestaetigeUebernahmen: () => void
  /**
   * Macht eine private Aufgabe für alle sichtbar (§3.7).
   *
   * Der DEK wandert von `K_p` auf `K_c`, mehr passiert nicht: dieselbe Zeile,
   * dieselbe ID, derselbe Payload. Danach ist es eine gewöhnliche Aufgabe.
   */
  gibFuerAlleFrei: (aufgabe: Aufgabe) => Promise<void>
}

const LEER = { aufgaben: [] as Aufgabe[], uebersprungen: 0 }

/** Eine Zeile, die sich nicht entschlüsseln liess (§3.7). */
const VERWORFEN = Symbol('verworfen')

/** Nichts abgelehnt, als eine Liste, damit sie ihre Identität behält. */
const KEINE: AbgelehnteAenderung[] = []

/** Solange niemand angemeldet ist, gibt es auch niemanden einzutragen. */
const ABGEMELDET: Zugewiesene = { userId: '', name: '' }

/** Nichts weggeschnappt, als eine Liste, damit sie ihre Identität behält. */
const KEINE_UEBERNAHMEN: Uebernahme[] = []

/**
 * Die Aufgaben der Juristinnen zuerst, in ihrer Reihenfolge (§8); danach, was
 * jemand selbst angelegt hat, in der Anlagereihenfolge.
 *
 * Ohne diesen Schritt stünde die Rechtsliste in der Reihenfolge ihrer IDs, und
 * die sind ein UUIDv5 über einen HMAC (§8): zufällig. Die Ausschlagungsfrist
 * käme dann irgendwo zwischen Krankenkasse und Bestattung zu stehen.
 *
 * `sort` ist stabil, also bleibt innerhalb derselben `reihenfolge` und unter
 * allen selbst angelegten Aufgaben die Reihenfolge aus `sync.zeilen` stehen.
 */
function nachReihenfolge(links: Aufgabe, rechts: Aufgabe): number {
  const hier = links.katalog?.reihenfolge
  const dort = rechts.katalog?.reihenfolge

  if (hier === undefined || dort === undefined) {
    // Keine von beiden aus dem Katalog: Die Reihenfolge aus `sync.zeilen`
    // bleibt. Nur eine: Die aus dem Katalog steht davor.
    return hier === dort ? 0 : hier === undefined ? 1 : -1
  }

  return hier - dort
}

export function useAufgaben(fall: Aufgabenfall): Aufgabendaten {
  const { zustand: sync, mutiere, bestaetige, aktualisiere } = useSync(fall.id)
  const zugang = useSupabase()
  const { zustand: authZustand } = useAuth()
  const anmeldung = useGeraeteanmeldung()

  const identitaet = anmeldung.status === 'bereit' ? anmeldung.identitaet : null
  const geraeteId = anmeldung.status === 'bereit' ? anmeldung.geraet.id : null

  const ich = useMemo<Zugewiesene>(
    () =>
      authZustand.status === 'angemeldet'
        ? { userId: authZustand.benutzer.id, name: authZustand.benutzer.anzeigename }
        : ABGEMELDET,
    [authZustand],
  )

  const [liste, setzeListe] = useState(LEER)
  const [abgelehnt, setzeAbgelehnt] = useState<AbgelehnteAenderung[]>([])

  /**
   * Die zuletzt entschlüsselte Fassung je Zeile, oder die Feststellung, dass
   * sie sich nicht entschlüsseln liess (§3.7).
   *
   * Der Schlüssel ist die Zeile selbst, nicht ihre ID: Der Reconciler gibt
   * unveränderte Zeilen unverändert zurück, also ist die Objektidentität genau
   * die Frage "hat sich hier etwas getan?", und eine `WeakMap` lässt die
   * abgelösten Fassungen von selbst los.
   *
   * Auch das Verworfene steht drin, und nicht bloss als Zahl. Nur so gilt der
   * Zähler aus §3.7 für den ganzen Bestand: Entschlüsselt wird stapelweise, und
   * ein Stapel ohne neue Zeilen brächte sonst eine 0 mit und löschte damit,
   * was die Stapel davor gefunden haben.
   */
  const entschluesselt = useRef(new WeakMap<InhaltZeile, Aufgabe | typeof VERWORFEN>())

  /**
   * Der eigene `K_p`, sobald er da ist (§3.7).
   *
   * `null` heißt nicht "lädt noch", sondern "es gibt keinen": Wer nie eine
   * private Aufgabe angelegt hat, hat auch keinen Schlüssel, und das ist der
   * Normalfall. Der Effekt darunter legt keinen an; das tut erst
   * {@link legeAn}, wenn jemand "Nur für mich" wirklich anhakt.
   */
  const [privat, setzePrivat] = useState<PersoenlicherSchluessel | null>(null)

  useEffect(() => {
    if (identitaet === null || geraeteId === null) {
      return
    }

    let aktuell = true

    void (async () => {
      try {
        const schluessel = await ladePersoenlichenSchluessel(
          supabasePersoenlicheSchluessel(zugang()),
          fall.id,
          geraeteId,
          identitaet,
        )

        if (aktuell && schluessel !== null) {
          setzePrivat(schluessel)
        }
      } catch {
        /*
         * Kein Wurf und keine Meldung. Ohne `K_p` sieht dieses Gerät die
         * eigenen privaten Aufgaben nicht, und das ist genau der Zustand, den
         * §3.7 für jedes andere Mitglied ohnehin vorsieht: Die Zeilen werden
         * still verworfen. Die geteilten Aufgaben stehen davon unberührt da,
         * und eine Fehlermeldung über einen Schlüssel, den die meisten
         * Menschen nie brauchen, wäre über der Aufgabenliste eine Zumutung.
         */
      }
    })()

    return () => {
      aktuell = false
    }
  }, [fall.id, geraeteId, identitaet, zugang])

  /**
   * Das `kid`, mit dem der Bestand zuletzt gelesen wurde.
   *
   * Kommt `K_p` nach dem ersten Entschlüsseln herein (er kostet einen eigenen
   * Rundlauf), stehen die eigenen privaten Zeilen längst als `VERWORFEN` in der
   * WeakMap und blieben es für den Rest der Sitzung. Ein Wechsel wirft den
   * Zwischenstand deshalb weg: Ein Fall mit vierzig Aufgaben wird dann genau
   * einmal zusätzlich entschlüsselt, und danach greift der Reconciler wieder.
   */
  const gelesenMit = useRef<string | null>(null)

  useEffect(() => {
    let aktuell = true

    const privatKid = privat?.kid ?? null

    if (gelesenMit.current !== privatKid) {
      gelesenMit.current = privatKid
      entschluesselt.current = new WeakMap()
    }

    void (async () => {
      const bekannt = entschluesselt.current
      const neue = sync.zeilen.filter((zeile) => !bekannt.has(zeile))
      const { aufgaben, uebersprungeneIds } = await aufgabenAusZeilen(neue, fall, privat)

      const nachId = new Map(neue.map((zeile) => [zeile.id, zeile]))

      for (const aufgabe of aufgaben) {
        const zeile = nachId.get(aufgabe.id)

        if (zeile !== undefined) {
          bekannt.set(zeile, aufgabe)
        }
      }

      for (const id of uebersprungeneIds) {
        const zeile = nachId.get(id)

        if (zeile !== undefined) {
          bekannt.set(zeile, VERWORFEN)
        }
      }

      if (!aktuell) {
        return
      }

      // Die Reihenfolge kommt aus `sync.zeilen` und damit aus der `id`: die
      // Anlagereihenfolge (§4). Ein Häkchen verschiebt nichts.
      const eintraege = sync.zeilen.map((zeile) => bekannt.get(zeile))

      setzeListe({
        aufgaben: eintraege
          .filter((eintrag): eintrag is Aufgabe => eintrag !== undefined && eintrag !== VERWORFEN)
          .sort(nachReihenfolge),
        uebersprungen: eintraege.filter((eintrag) => eintrag === VERWORFEN).length,
      })
    })()

    return () => {
      aktuell = false
    }
  }, [fall, privat, sync.zeilen])

  useEffect(() => {
    let aktuell = true

    void (async () => {
      // `KEINE` und nicht `[]`: Die Liste wird bei jeder Runde neu berechnet,
      // und ein frisches leeres Array wäre jedes Mal ein neuer Zustand, also
      // ein zusätzliches Rendern für die Nachricht "es gibt nichts zu melden".
      const beschrieben =
        sync.abgelehnt.length === 0
          ? KEINE
          : await beschreibeAbgelehnte(sync.abgelehnt, sync.zeilen, fall, privat)

      if (aktuell) {
        setzeAbgelehnt(beschrieben)
      }
    })()

    return () => {
      aktuell = false
    }
  }, [fall, privat, sync.abgelehnt, sync.zeilen])

  /**
   * Der Rechtskatalog, sobald der Bestand einmal wirklich vollständig ist (§8).
   *
   * Angelegt wird er bei der Fallanlage. Diese Stelle ist der zweite Anlauf für
   * die Fälle, bei denen das nicht durchkam: eine Verbindung, die mitten in der
   * Anlage abbrach, oder (sobald es die Vorsorge gibt) ein Übergang
   * nach `trauerfall`, den ein anderes Gerät vollzogen hat.
   *
   * Erst nach dem Abgleich: Vor dem ersten Abruf ist `zeilen` der Cache,
   * und ein leerer Cache heisst nicht, dass der Fall leer ist. Wer daraus
   * schlösse, es fehle der Katalog, legte ihn bei jedem Start erneut an, zwar ohne
   * Duplikate dank der deterministischen IDs, aber mit vierzig
   * Schreibversuchen, die alle nichts tun.
   *
   * Und höchstens einmal je Fall: Der Bestand ändert sich mit jedem Delta;
   * ein zweiter Lauf brächte nur dieselbe Feststellung. Was danach fehlt, hat
   * jemand gelöscht, und gelöscht bleibt gelöscht (§5).
   */
  const instanziiert = useRef<string | null>(null)

  useEffect(() => {
    if (!sync.abgeglichen || fall.katalogVersion === null || instanziiert.current === fall.id) {
      return
    }

    instanziiert.current = fall.id

    void (async () => {
      try {
        await instanziiereKatalog(
          supabaseInhalte(zugang()),
          fall,
          sync.zeilen.map((zeile) => zeile.id),
        )
      } catch {
        /*
         * Kein Wurf und keine Mitteilung. Was hier scheitert, ist entweder das
         * Netz (dann kommt die nächste Runde ohnehin) oder ein Katalogstand,
         * den dieser Build nicht kennt. Im zweiten Fall wäre die Meldung eine
         * Zumutung: Angehörige können daran nichts ändern, und die Aufgaben
         * eines anderen Mitglieds kommen mit dem nächsten Delta von selbst.
         */
        instanziiert.current = null
      }
    })()
  }, [fall, sync.abgeglichen, sync.zeilen, zugang])

  /*
   * Wer eine Aufgabe aufschreibt, ist damit eingetragen (§7). Das Tippen *ist*
   * die Ansage "ich mache das"; eine Aufgabe, die man nach dem Anlegen erst
   * noch übernehmen müsste, um ihren Titel zu korrigieren, wäre eine Hürde ohne
   * Zweck. Unzugewiesen kommen die Aufgaben der Juristinnen in den Fall (§8),
   * bei ihnen hat noch niemand etwas gesagt.
   */
  const legeAn = useCallback(
    async (titel: string, parentId: string | null = null, nurFuerMich = false) => {
      if (!nurFuerMich) {
        mutiere(await mutationAnlegen(fall, titel, parentId, ich.userId === '' ? null : ich))
        return
      }

      /*
       * §3.7: Private Aufgaben sind immer Wurzelaufgaben. Sonst hätte dieselbe
       * Elternaufgabe für ihre Besitzerin drei Kinder und für alle anderen
       * zwei, und der abgeleitete Abschluss zeigte der einen "erledigt" und
       * der anderen "offen" (§7).
       */
      if (parentId !== null) {
        throw new AufgabenFehler(
          'Eine private Aufgabe steht immer für sich; als Unteraufgabe geht das nicht.',
        )
      }

      if (identitaet === null || geraeteId === null || ich.userId === '') {
        throw new AufgabenFehler(
          'Ohne angemeldetes Gerät lässt sich keine private Aufgabe anlegen.',
        )
      }

      const client = zugang()

      /*
       * Der Schlüssel entsteht hier und nicht beim Laden des Falls: Die meisten
       * Menschen legen nie etwas Privates an, und ein `K_p` auf Vorrat wäre für
       * sie eine Zeile in `personal_key_wraps`, die dem Server sagt, sie hätten
       * etwas zu verbergen, ohne dass es das gäbe (§3.3, §11.6).
       */
      const schluessel = await stellePersoenlichenSchluesselBereit(
        supabasePersoenlicheSchluessel(client),
        supabaseGeraeteschluessel(client),
        fall.id,
        ich.userId,
        geraeteId,
        identitaet,
      )

      setzePrivat(schluessel)
      mutiere(await mutationPrivatAnlegen(fall, schluessel, titel, ich))
    },
    [fall, geraeteId, ich, identitaet, mutiere, zugang],
  )

  const schreibe = useCallback(
    async (aufgabe: Aufgabe, aenderung: Aufgabenaenderung) => {
      // §3.7: Nichts darf von einer privaten Aufgabe abhängen. Geprüft wird,
      // bevor irgendetwas verschlüsselt in der Queue landet: Danach stünde die
      // Verknüpfung im Payload und wäre für die anderen eine UUID ohne Aufgabe.
      if (aenderung.dependsOn !== undefined) {
        pruefeAbhaengigkeiten(aufgabe, aenderung.dependsOn, liste.aufgaben)
      }

      mutiere(await mutationAendern(aufgabe, aenderung))
    },
    [liste.aufgaben, mutiere],
  )

  const hakeAb = useCallback(
    (aufgabe: Aufgabe, erledigt: boolean) => schreibe(aufgabe, { erledigt }),
    [schreibe],
  )

  const loesche = useCallback(
    (aufgabe: Aufgabe) => mutiere(mutationLoeschen(aufgabe)),
    [mutiere],
  )

  /**
   * "Für alle sichtbar machen" (§3.7).
   *
   * Nicht über die Queue: Umwrappen ist keine der drei Operationen, die sie
   * kennt (§5). Danach ein `aktualisiere()`, sonst stünde die Aufgabe bis zur
   * nächsten Türklingel weiter als privat da: Das Delta trägt die geänderte
   * Zeile zwar mit, aber angestoßen hat den Schreibvorgang nicht der Sync.
   */
  const gibFuerAlleFrei = useCallback(
    async (aufgabe: Aufgabe) => {
      if (privat === null) {
        throw new AufgabenFehler('Auf diesem Gerät liegt kein persönlicher Schlüssel.')
      }

      await gibFuerAlleFreiDienst(supabaseInhalte(zugang()), fall, privat, aufgabe)
      aktualisiere()
    },
    [aktualisiere, fall, privat, zugang],
  )

  /**
   * Die Aufgaben, auf die diese Sitzung "Übernehmen" getippt hat.
   *
   * Steht bei einer davon später jemand anderes, ging die Reservierung
   * verloren, und §7 verlangt genau dafür eine Mitteilung statt eines stillen
   * Verlusts.
   *
   * Beobachtet wird bis zum Ende der Sitzung, nicht nur die nächsten
   * Sekunden. Ein Gerät kann die Mutation stundenlang in der Queue halten (§5),
   * und auch ein später hereinkommendes "Bert hat sie jetzt" ist die Nachricht,
   * um die es geht: dass die Aufgabe, die man sich vorgenommen hat, nicht mehr
   * die eigene ist. Ein Neuladen vergisst die Liste: Sie ist eine Erinnerung
   * an das eigene Zutun, nichts, was zu speichern wäre.
   */
  const [versuchteUebernahmen, setzeVersuchte] = useState<string[]>([])

  /**
   * Was davon verloren ging: abgeleitet, nicht mitgeschrieben.
   *
   * Kein zweiter Zustand neben dem Bestand: Die Frage "gehört sie mir noch?"
   * hat zu jedem Zeitpunkt genau eine Antwort, und die steht in der Aufgabe.
   * Zugewiesen zu sein (auch neben jemand anderem, auch über "Alle") heisst,
   * dass nichts verloren ging; wieder frei heisst dasselbe, denn dann ist da
   * keine andere Person, von der zu erzählen wäre.
   */
  const uebernahmen = useMemo<Uebernahme[]>(() => {
    if (versuchteUebernahmen.length === 0) {
      return KEINE_UEBERNAHMEN
    }

    const verloren: Uebernahme[] = []

    for (const aufgabe of liste.aufgaben) {
      if (!versuchteUebernahmen.includes(aufgabe.id)) {
        continue
      }

      const name = uebernommenVon(aufgabe.assignee, ich.userId)

      if (name !== null) {
        verloren.push({ itemId: aufgabe.id, titel: aufgabe.titel, name })
      }
    }

    return verloren.length === 0 ? KEINE_UEBERNAHMEN : verloren
  }, [ich.userId, liste.aufgaben, versuchteUebernahmen])

  const bestaetigeUebernahmen = useCallback(() => setzeVersuchte([]), [])

  /**
   * Die Zuweisung setzen und dabei merken, ob man sich gerade selbst
   * eingetragen hat.
   *
   * Beobachtet wird jede Zuweisung, die einen selbst einschliesst, und nicht
   * nur die Schaltfläche "Übernehmen": Wer sich im Aufgabendetail ankreuzt,
   * hat dasselbe getan und soll dieselbe Mitteilung bekommen, wenn ein anderes
   * Gerät ihn gleich wieder verdrängt. Wer sich dagegen selbst austrägt oder
   * die Aufgabe weitergibt, hat nichts verloren, sonst meldete die eigene
   * Handlung sich gleich als fremde zurück.
   */
  const weiseZu = useCallback(
    (aufgabe: Aufgabe, zuweisung: Zuweisung) => {
      setzeVersuchte((vorher) => {
        if (!istZugewiesen(zuweisung, ich.userId)) {
          return vorher.filter((id) => id !== aufgabe.id)
        }

        return vorher.includes(aufgabe.id) ? vorher : [...vorher, aufgabe.id]
      })

      return schreibe(aufgabe, { assignee: zuweisung })
    },
    [ich.userId, schreibe],
  )

  /**
   * Sich selbst eintragen (§7).
   *
   * Aus `mitPerson` und nicht aus "setze auf mich": Eine Aufgabe, die schon
   * jemandem gehört, bekommt eine Person dazu, statt die andere hinauszuwerfen.
   * Frei war sie, wenn niemand darunter stand: Dann ist es die Reservierung,
   * von der §7 spricht.
   */
  const uebernimm = useCallback(
    (aufgabe: Aufgabe) => weiseZu(aufgabe, mitPerson(aufgabe.assignee, ich)),
    [ich, weiseZu],
  )

  /**
   * Die Reservierung lösen (§7), die eigene wie die fremde.
   *
   * "In einer Familie fällt jemand aus, und eine Aufgabe, die niemand mehr
   * freigeben kann, blockiert eine gesetzliche Frist." Deshalb prüft hier
   * nichts, wer eingetragen ist.
   */
  const gibFrei = useCallback(
    (aufgabe: Aufgabe) => weiseZu(aufgabe, NIEMAND),
    [weiseZu],
  )

  /*
   * Der Baum entsteht aus derselben Liste und wird mit ihr neu gerechnet. Ein
   * eigener Zustand daneben wäre eine zweite Wahrheit, die genau so lange
   * stimmt, bis jemand vergisst, sie mitzuziehen (§7).
   */
  const baum = useMemo(() => baueBaum(liste.aufgaben), [liste.aufgaben])

  /*
   * §7: "nach jeder Synchronisation neu geplant". Der Baum ist nach jedem
   * Delta ein neuer, also plant der Hook darunter von selbst neu. Es gibt
   * keinen zweiten Auslöser, den jemand vergessen könnte.
   */
  const erinnerungen = useErinnerungen(baum, fall.sterbedatum)

  const zustand = useMemo<AufgabenZustand>(
    () =>
      sync.gecacht
        ? {
            status: 'bereit',
            aufgaben: liste.aufgaben,
            baum,
            uebersprungen: liste.uebersprungen,
            laedtNetz: sync.laedtNetz,
            netzfehler: sync.netzfehler,
          }
        : { status: 'laedt' },
    [baum, liste, sync.gecacht, sync.laedtNetz, sync.netzfehler],
  )

  return useMemo(
    () => ({
      zustand,
      zeilen: sync.zeilen,
      mutiere,
      aktualisiere,
      erinnerungen,
      abgelehnt,
      bestaetige,
      legeAn,
      schreibe,
      hakeAb,
      loesche,
      ich,
      uebernimm,
      gibFrei,
      weiseZu,
      uebernahmen,
      bestaetigeUebernahmen,
      gibFuerAlleFrei,
    }),
    [
      zustand,
      sync.zeilen,
      mutiere,
      aktualisiere,
      erinnerungen,
      abgelehnt,
      bestaetige,
      legeAn,
      schreibe,
      hakeAb,
      loesche,
      ich,
      uebernimm,
      gibFrei,
      weiseZu,
      uebernahmen,
      bestaetigeUebernahmen,
      gibFuerAlleFrei,
    ],
  )
}
