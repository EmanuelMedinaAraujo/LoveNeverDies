/**
 * Wie diese App auf diesem Geraet aussieht (DESIGN.md §7).
 *
 * Drei Einstellungen, ein Speicher:
 *
 * ```
 * modus        einfach | erweitert     die Ansichtswahl aus dem Onboarding
 * textgroesse  system | gross | sehr-gross
 * darstellung  system | hell | dunkel
 * ```
 *
 * Sie liegen in `localStorage` und nicht im Fall. Das ist keine Bequemlichkeit,
 * sondern die richtige Ablage: Es sind Eigenschaften dieses Bildschirms und
 * dieser Augen, nicht des Nachlasses. Wer am Telefon der Tochter hilft, aendert
 * dort nichts, und der Server erfaehrt nichts, was er nicht ohnehin nicht
 * erfahren soll (§3.3).
 *
 * `system` ist bei beiden Overrides die Voreinstellung und heisst woertlich,
 * was §7 verlangt: "ein Override, der auf 'Systemeinstellung folgen' steht".
 * Solange er dort steht, entscheidet allein das Betriebssystem, und die App
 * schreibt gar nichts an die Wurzel.
 *
 * Der Modus dagegen hat keinen Vorgabewert: `null` heisst "noch nicht gefragt",
 * und genau daran erkennt das Onboarding, dass die Ansichtswahl noch aussteht.
 * Ein Vorgabewert waere hier eine stille Antwort auf eine Frage, die §7
 * ausdruecklich gestellt haben will.
 */

export type Ansichtsmodus = 'einfach' | 'erweitert'
export type Textgroesse = 'system' | 'gross' | 'sehr-gross'
export type Darstellung = 'system' | 'hell' | 'dunkel'

export type Ansichtseinstellungen = {
  /** `null`, solange die Ansichtswahl im Onboarding noch aussteht (§7). */
  modus: Ansichtsmodus | null
  textgroesse: Textgroesse
  darstellung: Darstellung
}

/** Was gilt, solange niemand etwas gewaehlt hat. */
export const VORGABE: Ansichtseinstellungen = {
  modus: null,
  textgroesse: 'system',
  darstellung: 'system',
}

const SCHLUESSEL = 'lnd.ansicht'

const MODI: Ansichtsmodus[] = ['einfach', 'erweitert']
const GROESSEN: Textgroesse[] = ['system', 'gross', 'sehr-gross']
const DARSTELLUNGEN: Darstellung[] = ['system', 'hell', 'dunkel']

function eineVon<T extends string>(erlaubt: T[], wert: unknown): T | null {
  return typeof wert === 'string' && (erlaubt as string[]).includes(wert) ? (wert as T) : null
}

/**
 * Was im Speicher steht, in die Form bringen, die die App erwartet.
 *
 * Nachsichtig gegen alles: Ein fremder Eintrag unter demselben Schluessel, ein
 * halb geschriebenes JSON, ein Wert aus einer aelteren Fassung — nichts davon
 * darf die App anhalten. Im Zweifel gilt die Vorgabe, und dann fragt das
 * Onboarding eben noch einmal.
 */
function lies(roh: string | null): Ansichtseinstellungen {
  if (roh === null) {
    return VORGABE
  }

  try {
    const wert: unknown = JSON.parse(roh)

    if (typeof wert !== 'object' || wert === null) {
      return VORGABE
    }

    const gelesen = wert as Record<string, unknown>

    return {
      modus: eineVon(MODI, gelesen.modus),
      textgroesse: eineVon(GROESSEN, gelesen.textgroesse) ?? VORGABE.textgroesse,
      darstellung: eineVon(DARSTELLUNGEN, gelesen.darstellung) ?? VORGABE.darstellung,
    }
  } catch {
    return VORGABE
  }
}

/*
 * Der Bestand liegt im Modul und nicht in einer Komponente.
 *
 * Zwei Screens lesen ihn gleichzeitig — die Wurzel, die `data-dichte` setzt,
 * und Profil, wo umgeschaltet wird — und beide muessen im selben Rendern
 * dasselbe sehen. Ueber `useSyncExternalStore` ist das ein Bestand mit
 * Abonnenten; ein zweiter `useState` in Profil waere ein zweiter Bestand, und
 * §7 verlangt, dass ein Umschalten "sofort" wirkt und nicht nach dem naechsten
 * Neuladen.
 */
let bestand: Ansichtseinstellungen | null = null
const abonnenten = new Set<() => void>()

function speicher(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    // Safari im privaten Modus wirft beim blossen Zugriff. Dann gilt die
    // Wahl fuer diese Sitzung und ist beim naechsten Start wieder offen.
    return null
  }
}

export function ansichtLesen(): Ansichtseinstellungen {
  if (bestand === null) {
    bestand = lies(speicher()?.getItem(SCHLUESSEL) ?? null)
  }

  return bestand
}

export function ansichtSchreiben(aenderung: Partial<Ansichtseinstellungen>): void {
  bestand = { ...ansichtLesen(), ...aenderung }

  try {
    speicher()?.setItem(SCHLUESSEL, JSON.stringify(bestand))
  } catch {
    // Kein Platz, kein Speicher, keine Erlaubnis: Die Wahl gilt trotzdem, sie
    // ueberlebt nur den naechsten Start nicht. Eine Fehlermeldung darueber
    // waere eine Warnung ohne Handlungsmoeglichkeit (vgl. `persist.ts`).
  }

  for (const melde of abonnenten) {
    melde()
  }
}

export function ansichtAbonnieren(melde: () => void): () => void {
  abonnenten.add(melde)
  return () => abonnenten.delete(melde)
}

/** Nur fuer Tests: den gelesenen Bestand vergessen. */
export function ansichtZuruecksetzen(): void {
  bestand = null
}
