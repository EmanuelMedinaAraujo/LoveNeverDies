/**
 * Wem eine Aufgabe gehört (DESIGN.md §7).
 *
 * Drei Zustände, mehr gibt es nicht:
 *
 * ```
 * niemand   frei — jede:r kann sich eintragen und sie so reservieren
 * personen  eine oder mehrere namentlich genannte Personen
 * alle      ein eigener Wert, keine Liste aller Namen
 * ```
 *
 * **Bearbeiten darf nur, wem die Aufgabe zugewiesen ist.** Eine freie Aufgabe
 * darf deshalb niemand ändern — wer sie anfassen will, trägt sich zuerst ein.
 * Das ist kein Umweg, sondern der Sinn der Sache: Die Reservierung ist genau
 * die Ansage „ich mache das", die zwei Menschen davor bewahrt, dieselbe
 * Behörde anzurufen.
 *
 * **Eine Reservierung ist von jedem wieder lösbar**, nicht nur von der
 * reservierenden Person. In einer Familie fällt jemand aus, und eine Aufgabe,
 * die niemand mehr freigeben kann, blockiert eine gesetzliche Frist.
 *
 * > **Das ist eine Bearbeitungssperre, kein Zugriffsschutz** (§7, §11). Die
 * > Zuweisung liegt verschlüsselt im Payload (§3.3); der Server kann eine Regel
 * > nicht durchsetzen, die er nicht lesen kann. Sie verhindert zuverlässig
 * > versehentliches Gleichzeitig-Bearbeiten, nicht einen manipulierten Client.
 *
 * **Der Name steht mit im Payload, nicht nur die Kennung.** Er kostet ein paar
 * Bytes hinter derselben Verschlüsselung und erspart der Oberfläche die Frage,
 * die sie sonst nicht beantworten könnte: „Bert hat diese Aufgabe übernommen"
 * braucht Berts Namen in dem Moment, in dem die eigene Reservierung verloren
 * ging — und die Namenstabelle `profiles` (§3.3) gibt es erst mit der Kopplung
 * (#10). Solange kein Name bekannt ist, bleibt das Feld leer und die Oberfläche
 * behilft sich; ein Eintrag ohne Kennung dagegen wäre wertlos und fliegt raus.
 */

/** Eine Person, der eine Aufgabe zugewiesen ist. */
export type Zugewiesene = {
  /** Clerk `sub` — dieselbe Kennung wie in `memberships.user_id` (§3.3). */
  userId: string
  /** Der Anzeigename zum Zeitpunkt der Zuweisung. Leer, wenn unbekannt. */
  name: string
}

export type Zuweisung =
  | { art: 'niemand' }
  | { art: 'alle' }
  | { art: 'personen'; personen: Zugewiesene[] }

/** Frei: niemand ist eingetragen, und deshalb darf niemand bearbeiten. */
export const NIEMAND: Zuweisung = { art: 'niemand' }

/** „Alle" ist ein eigener Zuweisungswert, keine Liste aller Namen (§7). */
export const ALLE: Zuweisung = { art: 'alle' }

/** Wie eine Person heißt, wenn ihr Name nicht bekannt ist. */
const OHNE_NAMEN = 'Weiteres Mitglied'

/**
 * Eine Zuweisung an namentlich genannte Personen.
 *
 * Jede Person genau einmal, und eine leere Liste ist {@link NIEMAND} — sonst
 * gäbe es zwei Schreibweisen für „frei", und die Prüfung „darf bearbeiten"
 * hinge davon ab, welche gerade im Payload steht.
 */
export function personen(liste: Zugewiesene[]): Zuweisung {
  const gesehen = new Set<string>()
  const eindeutig: Zugewiesene[] = []

  for (const person of liste) {
    if (!gesehen.has(person.userId)) {
      gesehen.add(person.userId)
      eindeutig.push(person)
    }
  }

  return eindeutig.length === 0 ? NIEMAND : { art: 'personen', personen: eindeutig }
}

function alsPerson(wert: unknown): Zugewiesene | null {
  if (typeof wert !== 'object' || wert === null) {
    return null
  }

  const felder = wert as Partial<Zugewiesene>

  if (typeof felder.userId !== 'string' || felder.userId === '') {
    return null
  }

  return { userId: felder.userId, name: typeof felder.name === 'string' ? felder.name : '' }
}

/**
 * Die Zuweisung aus einem entschlüsselten Payload.
 *
 * Dieselbe Vorsicht wie überall im `aufgabenService`: Der Payload ist zwar
 * entschlüsselt, aber irgendeine Fassung dieser App hat ihn geschrieben. Wo das
 * Feld fehlt — jede Aufgabe von vor diesem Slice, und jede aus dem Katalog —,
 * ist die Aufgabe frei, und das ist die richtige Antwort: Niemand hat sich
 * eingetragen.
 */
export function zuweisungAus(wert: unknown): Zuweisung {
  if (typeof wert !== 'object' || wert === null) {
    return NIEMAND
  }

  const felder = wert as { art?: unknown; personen?: unknown }

  if (felder.art === 'alle') {
    return ALLE
  }

  if (felder.art !== 'personen' || !Array.isArray(felder.personen)) {
    return NIEMAND
  }

  return personen(
    felder.personen
      .map(alsPerson)
      .filter((person): person is Zugewiesene => person !== null),
  )
}

/** Ob sich niemand eingetragen hat — dann kann jede:r sie übernehmen (§7). */
export function istFrei(zuweisung: Zuweisung): boolean {
  return zuweisung.art === 'niemand'
}

/** Ob diese Person zugewiesen ist. Bei „Alle" ist es jedes Mitglied. */
export function istZugewiesen(zuweisung: Zuweisung, userId: string): boolean {
  if (zuweisung.art === 'alle') {
    return true
  }

  return (
    zuweisung.art === 'personen' &&
    zuweisung.personen.some((person) => person.userId === userId)
  )
}

/**
 * Ob diese Person die Aufgabe ändern darf (§7).
 *
 * Dieselbe Antwort wie {@link istZugewiesen} und trotzdem eine eigene Funktion:
 * An den Aufrufstellen steht damit die Regel und nicht ihre Herleitung, und
 * eine spätere Ausnahme — private Aufgaben (#11), der Tresor (#14) — bekommt
 * eine Stelle, an der sie sichtbar wird.
 */
export function darfBearbeiten(zuweisung: Zuweisung, userId: string): boolean {
  return istZugewiesen(zuweisung, userId)
}

/**
 * Dieselbe Zuweisung mit einer Person mehr.
 *
 * Bei „Alle" bleibt alles, wie es ist: Dort sind bereits alle gemeint, und eine
 * Person hinzuzufügen hieße, die Art zu wechseln — das entscheidet die
 * Oberfläche und nicht diese Funktion.
 */
export function mitPerson(zuweisung: Zuweisung, person: Zugewiesene): Zuweisung {
  if (zuweisung.art === 'alle') {
    return zuweisung
  }

  return personen([...(zuweisung.art === 'personen' ? zuweisung.personen : []), person])
}

/** Dieselbe Zuweisung ohne diese Person. Die letzte auszutragen gibt sie frei. */
export function ohnePerson(zuweisung: Zuweisung, userId: string): Zuweisung {
  if (zuweisung.art !== 'personen') {
    return zuweisung
  }

  return personen(zuweisung.personen.filter((person) => person.userId !== userId))
}

/** Die zugewiesenen Personen, oder eine leere Liste bei „Alle" und „niemand". */
export function zugewiesene(zuweisung: Zuweisung): Zugewiesene[] {
  return zuweisung.art === 'personen' ? zuweisung.personen : []
}

/**
 * Wie eine Person auf dem Bildschirm heißt.
 *
 * Die angemeldete Person heißt „Sie" und nicht beim Namen. Ein Bildschirm, der
 * einem den eigenen Namen vorhält, liest sich wie eine Akte.
 *
 * @param userId die angemeldete Person.
 */
export function nameVon(person: Zugewiesene, userId: string): string {
  if (person.userId === userId) {
    return 'Sie'
  }

  return person.name.trim() === '' ? OHNE_NAMEN : person.name
}

/**
 * Die Mitglieder eines Falls mit den Namen, die dieses Gerät kennt (§7).
 *
 * Drei Quellen, in dieser Reihenfolge: die angemeldete Person kennt sich selbst,
 * die übrigen Namen stehen in den Zuweisungen, die schon im Fall liegen — und
 * wer noch nie zugewiesen war, bleibt namenlos, bis die Kopplung `profiles`
 * mitbringt (#10, §3.3). Eine Kennung ohne Namen ist trotzdem auswählbar: Sie
 * einfach wegzulassen hieße, ein Familienmitglied unsichtbar zu machen.
 *
 * @param userIds die Mitglieder aus `memberships`, in ihrer Reihenfolge.
 * @param zuweisungen alles, was der Fall an Zuweisungen hergibt.
 */
export function benenne(
  userIds: string[],
  zuweisungen: Zuweisung[],
  ich: Zugewiesene,
): Zugewiesene[] {
  const bekannt = new Map<string, string>()

  for (const zuweisung of zuweisungen) {
    for (const person of zugewiesene(zuweisung)) {
      if (person.name.trim() !== '' && !bekannt.has(person.userId)) {
        bekannt.set(person.userId, person.name)
      }
    }
  }

  return userIds.map((userId) =>
    userId === ich.userId ? ich : { userId, name: bekannt.get(userId) ?? '' },
  )
}

/**
 * Die Zuweisung als Satzteil: „Sie", „Sie und Bert Müller", „Alle", „Niemand".
 *
 * Die angemeldete Person heißt „Sie" und nicht beim Namen. Ein Bildschirm, der
 * einem den eigenen Namen vorhält, liest sich wie eine Akte.
 */
export function zuweisungText(zuweisung: Zuweisung, userId: string): string {
  if (zuweisung.art === 'alle') {
    return 'Alle'
  }

  if (zuweisung.art === 'niemand') {
    return 'Niemand'
  }

  const namen = zuweisung.personen.map((person) => nameVon(person, userId))
  const letzter = namen[namen.length - 1] ?? OHNE_NAMEN

  return namen.length === 1 ? letzter : `${namen.slice(0, -1).join(', ')} und ${letzter}`
}

/**
 * Wer die Aufgabe weggeschnappt hat — oder `null`, wenn niemand.
 *
 * Der Fall aus §7: Zwei Menschen tippen im selben Moment auf „Übernehmen", die
 * höhere `seq` gewinnt, und die unterlegene Person soll nicht ins Leere greifen,
 * sondern lesen, wer schneller war. Zugewiesen zu sein — auch neben jemand
 * anderem, auch über „Alle" — heißt: nichts verloren.
 */
export function uebernommenVon(zuweisung: Zuweisung, userId: string): string | null {
  if (zuweisung.art !== 'personen' || istZugewiesen(zuweisung, userId)) {
    return null
  }

  const [erste] = zuweisung.personen

  return erste === undefined ? null : nameVon(erste, userId)
}
