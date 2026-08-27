/**
 * Der Erbe-Fragebaum: nachschlagen, auswerten, Aufgaben daraus anlegen
 * (ERBE_DESIGN.md).
 *
 * Die Inhaltsdatei `content/fragebaum.ts` ist eine Liste; hier wird sie einmal
 * in eine Map gelegt und beantwortet Fragen. Sonst liefe jede Seitenanzeige
 * über 141 Eintraege, und der Fragebaum ist die Stelle, an der jemand zehnmal
 * hintereinander weiterklickt.
 *
 * Was hier ausdrücklich nicht steht: Rechtstext. Die Texte stehen in der
 * Inhaltsdatei, die Fristen an den Aufgabenvorlagen, und beide kommen von den
 * Juristinnen (DESIGN.md §8).
 */

import { ERBSCHEIN, alsText } from "../content/erbstatus.ts";
import { FRAGEBAUM, WURZEL } from "../content/fragebaum.ts";
import type {
  Aufgabenvorlage,
  Erbstatus,
  Fragebaumknoten,
  Infothema,
} from "../types/fragebaum.ts";
import type { Nachlassgericht } from "../types/gericht.ts";
import type { Fragebaumergebnis, Katalogherkunft } from "./aufgabenService";
import { formatGerichtNotiz } from "./gerichtService.ts";
import type { Zugewiesene, Zuweisung } from "./zuweisung.ts";

const KNOTEN = new Map(FRAGEBAUM.map((knoten) => [knoten.id, knoten]));

/** Die Herkunftsangabe der Aufgaben aus dem Baum (§8, ERBE_DESIGN.md §7). */
export const FRAGEBAUM_STAND = "fragebaum-2026-08";

/**
 * Die Katalogaufgabe, die auf den Fragebaum führt (ADR-0001).
 *
 * Die einzige Aufgabe, die noch automatisch entsteht. Die Aufgabendetails
 * erkennen sie an dieser Kennung und zeigen den Knopf "Fragebaum starten".
 */
export const SEED_AUFGABE = "erbenstellung-klaeren";

export { WURZEL };

/** Der Knoten zu dieser Id, oder `null`, wenn es ihn nicht gibt. */
export function knoten(id: string): Fragebaumknoten | null {
  return KNOTEN.get(id) ?? null;
}

/** Alle Knoten, für Tests und für das Pruefen eines gespeicherten Pfads. */
export function alleKnoten(): Fragebaumknoten[] {
  return FRAGEBAUM;
}

/**
 * Der Erbstatus als Satz, so wie er in Profil und auf der Erbe-Seite steht.
 *
 * "Noch Erbe" ist die Ausschlagung: Wer ausschlagen will, ist es bis zur
 * wirksamen Ausschlagung noch (ERBE_DESIGN.md §6).
 */
export function statusText(status: Erbstatus): string {
  switch (status) {
    case "erbe":
      return "Erbe";
    case "wahrscheinlich-erbe":
      return "Wahrscheinlich Erbe";
    case "wahrscheinlich-kein-erbe":
      return "Wahrscheinlich kein Erbe";
    case "kein-erbe":
      return "Kein Erbe";
    case "noch-erbe":
      return "Noch Erbe";
  }
}

/**
 * Das Ergebnis eines abgeschlossenen Durchlaufs.
 *
 * @param pfad die Knoten von der Wurzel bis hierher, das Ergebnis
 * eingeschlossen.
 * @throws {Error} wenn der letzte Knoten gar kein Ergebnis ist. Ein Ergebnis
 * an einer Frage wäre ein Status, den niemand erreicht hat.
 */
export function ergebnisAus(
  pfad: string[],
  jetzt: Date = new Date(),
): Fragebaumergebnis {
  const letzter = pfad.at(-1);
  const ziel = letzter === undefined ? null : knoten(letzter);

  if (ziel === null || ziel.art !== "ergebnis") {
    throw new Error(
      "Ein Fragebaum-Ergebnis entsteht nur an einem Ergebnisknoten.",
    );
  }

  return {
    knotenId: ziel.id,
    pfad: [...pfad],
    status: ziel.status ?? null,
    am: jetzt.toISOString(),
  };
}

/**
 * Der Text eines Infoknotens.
 *
 * Der Export der Juristinnen nennt an diesen Stellen nur das Thema ("Infos zu
 * Erbschein"), nicht die Erläuterung. Sie fehlt also, und das steht hier
 * genau so — §8: "Erfunden wird nichts." Ein plausibel klingender Absatz über
 * den Erbschein wäre hier das Schlimmste von allem, weil er aussaehe wie
 * geprüft.
 *
 * `pflichtteil` ist die Ausnahme: Der Text dazu liegt vor, wörtlich von den
 * Juristinnen, und steht deshalb fest da statt hinter dem Platzhalter.
 */
export function infoText(thema: Infothema): { frage: string; text: string } {
  if (thema === "pflichtteil") {
    return {
      frage: "Was ist der Pflichtteil?",
      text: "Der Pflichtteil ist ein Mindest-Betrag an Geld aus dem Erbe.",
    };
  }

  const frage =
    thema === "erbschein"
      ? "Was ist ein Erbschein?"
      : "Was ist das Nachlassgericht?";
  const gegenstand =
    thema === "erbschein"
      ? "den Erbschein"
      : "das Nachlassgericht und darüber, wie es Kontakt aufnimmt";

  return {
    frage,
    text: `Diese Erläuterung wird noch von den Juristinnen ergänzt. Bis dahin steht hier nichts über ${gegenstand} — geraten wird an dieser Stelle nicht.`,
  };
}

/** Titel, Beschreibung und Rechtsangaben einer Aufgabe aus dem Baum. */
export type Aufgabenbauplan = {
  titel: string;
  beschreibung: string;
  katalog: Katalogherkunft;
};

/**
 * Die Aufgaben, die aus dem Baum und aus dem Erbstatus entstehen (§7, §10).
 *
 * Ihre Rechtsangaben stehen hier und nicht mehr im Katalog (ADR-0001). Sie
 * müssen mit: Ohne `{fristTage, fristAb}` rechnet `fristen.ts` keine Frist,
 * und die Ausschlagungsfrist ist die eine, deren Versaeumnis den ganzen
 * Nachlass kostet.
 *
 * Die Anfechtung trägt eine eigene rechenbare Frist: ein Jahr ab der Kenntnis
 * des Anfechtungsgrundes. Dieser Tag ist ausdrücklich nicht das `kenntnisAm`
 * aus § 1944 BGB — beides auf dasselbe Feld zu legen ergäbe ein Fristende,
 * das plausibel aussieht und falsch ist —, sondern ein eigener Anker,
 * `anfechtungskenntnis`, mit einem eigenen Datum in `Fristbezug` (`fristen.ts`).
 */
export const BAUPLAENE: Record<Aufgabenvorlage, Aufgabenbauplan> = {
  testament: {
    titel: 'Testament beim Nachlassgericht abliefern',
    beschreibung:
      'Wer ein Testament der verstorbenen Person besitzt, muss es beim Nachlassgericht abliefern. Eine Nicht-Abgabe kann strafrechtliche Folgen und Kosten nach sich ziehen.',
    katalog: {
      aufgabeId: 'fragebaum-testament',
      version: FRAGEBAUM_STAND,
      fristTage: null,
      fristAb: 'unverzueglich',
      zustaendigeStelle: 'Nachlassgericht (Amtsgericht)',
      benoetigteDokumente: ['Testament', 'Sterbeurkunde'],
      unteraufgaben: [
        'Zuständiges Nachlassgericht über die Postleitzahl des letzten Wohnorts ermitteln',
        'Testament im Original heraussuchen',
        'Sterbeurkunde bereitlegen',
        'Testament unverzüglich beim Nachlassgericht abgeben',
      ],
      haengtAbVon: [],
      hinweis:
        'Das Gesetz verlangt die Ablieferung unverzüglich, nennt aber keine Zahl von Tagen. Unverzüglich heißt: ohne schuldhaftes Zögern.',
      kategorie: 'Erbe',
      reihenfolge: 40,
    },
  },
  ausschlagung: {
    titel: "Erbe ablehnen",
    beschreibung: `Sie wollen das Erbe nicht (Ausschlagung)

[rot:Hinweis:] Wer Gegenstände aus dem Nachlass verkauft, verschenkt oder nutzt, nimmt das Erbe automatisch an. Danach kann das Erbe nicht mehr abgelehnt werden.

**Folgende Schritte sind jetzt für Sie relevant:**

**1. Frist**
Die Frist beträgt 6 Wochen.
Fristbeginn:
[gruen:Normalfall (gesetzliche Erbfolge):] Die Frist läuft ab dem Moment, in dem Sie erfahren, dass die Person gestorben ist und Sie gesetzlich erben.
[gruen:Testament oder Erbvertrag:] Gibt es ein Testament, läuft die Frist erst los, wenn das Nachlassgericht Ihnen dieses Testament offiziell eröffnet und mitgeteilt hat – selbst wenn Sie vorher schon von dem Dokument wissen.

**2. Wie können Sie das Erbe ablehnen?**
Sie haben dafür zwei Möglichkeiten:
[gruen:1. Über ein Notariat:]
• Termin bei einem Notar vereinbaren
• Antrag auf Ausschlagung stellen
• Notar beurkundet den Antrag und schickt ihn an das Nachlassgericht

[gruen:2. Persönlich beim Gericht:]
• telefonisch Termin beim Nachlassgericht vereinbaren
• persönlich beim Nachlassgericht erscheinen

**Notar oder Nachlassgericht:**
• Beim Notar erhalten Sie schneller und sicher innerhalb der Frist einen Termin
• Beim Nachlassgericht fallen Ihnen keine zusätzlichen Kosten an`,
    katalog: {
      aufgabeId: "fragebaum-ausschlagung",
      version: FRAGEBAUM_STAND,
      fristTage: 42,
      fristAb: "kenntnis",
      zustaendigeStelle: "Nachlassgericht (Amtsgericht) oder Notariat",
      benoetigteDokumente: [],
      unteraufgaben: [],
      haengtAbVon: [],
      hinweis: "",
      kategorie: "Erbe",
      reihenfolge: 50,
    },
  },
  /*
   * Der Erbschein hängt an keinem Ergebnisknoten, sondern am Status "Erbe"
   * auf der Erbe-Seite (§10). Seine Beschreibung ist der allgemeine Erklärtext,
   * der in der Aufgabe einklappbar dargestellt wird.
   *
   * Die Verfahrensschritte (Notar vs. Nachlassgericht) stehen genau einmal im
   * Aufgabenabschnitt.
   *
   * Ohne rechenbare Frist. Das Gesetz nennt für den Antrag keine, und §8
   * rechnet lieber gar nicht als falsch — eine erfundene Frist auf einer
   * Aufgabe, die keine hat, triebe jemanden zu einem Termin, den er nicht
   * braucht.
   */
  erbschein: {
    titel: "Erbschein beantragen",
    beschreibung: alsText(ERBSCHEIN),
    katalog: {
      aufgabeId: "fragebaum-erbschein",
      version: FRAGEBAUM_STAND,
      fristTage: null,
      fristAb: null,
      zustaendigeStelle: "Nachlassgericht (Amtsgericht) oder Notariat",
      benoetigteDokumente: [],
      unteraufgaben: [],
      haengtAbVon: [],
      hinweis: "",
      kategorie: "Erbe",
      reihenfolge: 55,
    },
  },
  anfechtung: {
    titel: "Testament anfechten",
    beschreibung: `Informationen zur Testamentsanfechtung

1. **Was ist das?**
Eine Testamentsanfechtung bedeutet, dass ein Testament nachträglich für ungültig erklärt wird, weil beim Verfassen etwas grundlegend schiefgelaufen ist.

2. **Wer darf anfechten?**
Pflichtteilsberechtigte: Kind, Ehegatte, Elternteil
• Elternteile dürfen nur anfechten, wenn die Abkömmlinge der verstorbenen Person bereits verstorben sind.
• Enkel dürfen nur anfechten, wenn das Elternteil, das Kind der verstorbenen Person ist, bereits verstorben ist.
Jeder, der bei gesetzlicher Erbfolge Erbe wäre.
Jeder, den ein vorheriges Testament zum Erben einsetzt.

3. **Welche Gründe rechtfertigen eine Anfechtung?**
• Verschreiben oder Versprechen: Die verstorbene Person wollte eigentlich etwas anderes schreiben, als am Ende im Testament steht.
• Bedeutungsfehler: Die verstorbene Person nutzt einen Begriff, versteht dessen rechtliche oder tatsächliche Bedeutung aber falsch.
• Falsche Beweggründe: Die verstorbene Person hat sich über die Zukunft oder über Tatsachen geirrt.
• Drohung: Das Testament wurde nur verfasst, weil jemand die verstorbene Person unrechtmäßig unter Druck gesetzt oder bedroht hat.
• Täuschung: Das Testament wurde nur verfasst, weil jemand die verstorbene Person getäuscht hat.
**Nur für Pflichtteilsberechtigte:**
• Die verstorbene Person hat beim Erstellen des Testaments nicht an Ehegatte, Elternteil oder Kind gedacht. Es kann aber davon ausgegangen werden, dass diese Person nach ihrem Willen Erbe werden sollte.
• Die verstorbene Person wusste beim Verfassen nicht, dass es noch ein Kind gibt (zum Beispiel ein erst später geborenes Kind).

4. **Folge der Anfechtung**
• Das Testament wird ganz oder teilweise ungültig.
• Es gilt dann entweder das ältere Testament oder das Erbrecht nach dem Gesetz.

5. **Frist**
Frist: 1 Jahr
Die Frist beginnt, sobald Sie von dem Grund für die Anfechtung erfahren haben (siehe Schritt 3).

6. **Kosten**
• Durch die Anfechtung entstehen Kosten.
  • Die Kosten werden gemildert oder entfallen bei wirksamer Anfechtung.`,
    katalog: {
      aufgabeId: "fragebaum-anfechtung",
      version: FRAGEBAUM_STAND,
      fristTage: 365,
      fristAb: "anfechtungskenntnis",
      zustaendigeStelle: "Nachlassgericht (Amtsgericht) oder Notariat",
      benoetigteDokumente: [],
      unteraufgaben: [],
      haengtAbVon: [],
      hinweis: "",
      kategorie: "Erbe",
      reihenfolge: 70,
    },
  },
};

/**
/**
 * Der Bauplan für die private Seed-Aufgabe "Klären ob Sie Erbe sind",
 * die auf den Fragebaum führt.
 */
export const SEED_BAUPLAN: Aufgabenbauplan = {
  titel: "Klären ob Sie Erbe sind",
  beschreibung:
    "Ob Sie erben, entscheidet darüber, was als Nächstes zu tun ist und welche Fristen für Sie laufen. Der Fragebaum führt Sie in wenigen Schritten hindurch.",
  katalog: {
    aufgabeId: SEED_AUFGABE,
    version: FRAGEBAUM_STAND,
    fristTage: null,
    fristAb: null,
    zustaendigeStelle: "",
    benoetigteDokumente: [],
    unteraufgaben: [],
    haengtAbVon: [],
    hinweis:
      "Ihre Antworten und das Ergebnis sehen nur Sie. Angehörige im selben Fall gehen den Fragebaum jeweils für sich.",
    kategorie: "Erbe",
    reihenfolge: 50,
  },
};

/**
 * Der vollständige Beschreibungstext einer Aufgabe, die aus einem
 * Ergebnisknoten angelegt wird (§7, §10).
 *
 * Wenn die Juristinnen zu einem Knoten schon einen ausführlichen Text
 * mitgeliefert haben (wie bei der Ausschlagung), steht dieser Text vorne,
 * gefolgt von der Bauplan-Beschreibung. Das stellt sicher, dass der Nutzer in
 * der angelegten Aufgabe genau das wiederfindet, was er vor dem Klick auf
 * "Aufgabe erstellen" gelesen hat — dieselbe Überlegung, aus der auch die
 * Erbschein-Aufgabe ihren ganzen Erklärtext trägt (§10).
 *
 * Der Ergebnistext kommt als Parameter und nicht aus dem Bauplan: Zehn Knoten
 * zeigen heute denselben Ausschlagungstext und dürfen ihn morgen
 * unterschiedlich zeigen (ADR-0002). Was in der Aufgabe landet, ist deshalb der
 * Text des Knotens, an dem jemand tatsächlich stand.
 *
 * @param ergebnisText der Text des Ergebnisknotens, `{person}` bereits ersetzt.
 */
export function aufgabenBeschreibung(
  vorlage: Aufgabenvorlage,
  ergebnisText = "",
): string {
  const bauplan = BAUPLAENE[vorlage];
  const gelesen = ergebnisText.trim();

  if (gelesen === "" || gelesen === bauplan.beschreibung.trim()) {
    return bauplan.beschreibung;
  }

  if (
    gelesen.includes("Folgende Schritte sind jetzt für Sie relevant") ||
    gelesen.includes(bauplan.beschreibung) ||
    bauplan.beschreibung.includes(gelesen)
  ) {
    return gelesen;
  }

  return `${gelesen}\n\n${bauplan.beschreibung}`;
}

/** Ob diese Herkunft von der genannten Vorlage aus dem Baum stammt. */
export function stammtAus(
  katalog: Katalogherkunft | null,
  vorlage: Aufgabenvorlage,
): boolean {
  if (katalog === null) {
    return false;
  }
  return (
    katalog.aufgabeId === BAUPLAENE[vorlage].katalog.aufgabeId ||
    katalog.aufgabeId === vorlage ||
    katalog.aufgabeId === `fragebaum-${vorlage}` ||
    katalog.aufgabeId.includes(vorlage)
  );
}

export function istErbscheinAufgabe(aufgabe: {
  titel?: string;
  katalog?: Katalogherkunft | null;
}): boolean {
  if (stammtAus(aufgabe.katalog ?? null, "erbschein")) return true;
  const id = aufgabe.katalog?.aufgabeId?.toLowerCase() ?? "";
  if (id.includes("erbschein")) return true;
  const titel = aufgabe.titel?.toLowerCase() ?? "";
  return titel.includes("erbschein");
}

export function istAnfechtungAufgabe(aufgabe: {
  titel?: string;
  katalog?: Katalogherkunft | null;
}): boolean {
  if (stammtAus(aufgabe.katalog ?? null, "anfechtung")) return true;
  const id = aufgabe.katalog?.aufgabeId?.toLowerCase() ?? "";
  if (id.includes("anfechtung") || id.includes("anfechten")) return true;
  const titel = aufgabe.titel?.toLowerCase() ?? "";
  return titel.includes("anfecht");
}

export function istAusschlagungAufgabe(aufgabe: {
  titel?: string;
  katalog?: Katalogherkunft | null;
}): boolean {
  if (stammtAus(aufgabe.katalog ?? null, "ausschlagung")) return true;
  const id = aufgabe.katalog?.aufgabeId?.toLowerCase() ?? "";
  if (id.includes("ausschlag")) return true;
  const titel = aufgabe.titel?.toLowerCase() ?? "";
  return titel.includes("ausschlag");
}

/**
 * Ob das die Katalogaufgabe „Totenschein erstellen" ist (§8).
 *
 * Sie ist der eine Fall, in dem der Kasten „Das gilt dafür" nichts zu sagen
 * hat als den einen Schritt: Frist hat sie keine, Dokumente braucht sie keine,
 * und „Dorthin geht es: Ärztin oder Arzt" wiederholt nur, was in „Arzt
 * kontaktieren" schon steht. Drei Zeilen, von denen zwei leer und eine doppelt
 * ist, machen aus dem ersten Schritt nach einem Todesfall eine Formularseite.
 *
 * Erkannt wird sie an der Katalogkennung und ersatzweise am Titel — wie bei
 * den Aufgaben aus dem Fragebaum daneben: Eine Aufgabe, die jemand von Hand
 * „Totenschein erstellen" genannt hat, meint dieselbe Sache.
 */
export function istTotenscheinAufgabe(aufgabe: {
  titel?: string
  katalog?: Katalogherkunft | null
}): boolean {
  const id = aufgabe.katalog?.aufgabeId?.toLowerCase() ?? ''
  if (id.includes('totenschein')) return true
  const titel = aufgabe.titel?.toLowerCase() ?? ''
  return titel.includes('totenschein')
}

/** Ob diese Aufgabe die Katalogaufgabe ist, die auf den Fragebaum führt. */
export function istSeedAufgabe(katalog: Katalogherkunft | null): boolean {
  return katalog !== null && katalog.aufgabeId === SEED_AUFGABE;
}

/**
 * Die Notiz, die eine ermittelte Stelle oder ein Anfechtungsdatum festhaelt.
 *
 * Sie wandert in `notizen` der erzeugten Aufgabe, damit die ermittelten
 * Kontaktdaten des Nachlassgerichts und das Anfechtungsdatum direkt an der
 * Aufgabe stehen (ERBE_DESIGN.md §8).
 */
export function notizAus(teile: {
  plz?: string;
  stelle?: string;
  gericht?: Nachlassgericht | null;
  anfechtungAm?: string;
}): string {
  const zeilen: string[] = [];

  if (teile.gericht && teile.plz) {
    zeilen.push(formatGerichtNotiz(teile.gericht, teile.plz));
  } else if (teile.plz !== undefined && teile.plz !== "") {
    zeilen.push(
      teile.stelle === undefined || teile.stelle === ""
        ? `Letzter Wohnort (PLZ): ${teile.plz}`
        : `Letzter Wohnort (PLZ) ${teile.plz} → ${teile.stelle}`,
    );
  }

  if (teile.anfechtungAm !== undefined && teile.anfechtungAm !== "") {
    if (zeilen.length > 0) {
      zeilen.push("");
    }
    zeilen.push(`Vom Anfechtungsgrund erfahren am: ${teile.anfechtungAm}`);
    zeilen.push("Die Frist beträgt ein Jahr ab diesem Tag.");
  }

  return zeilen.join("\n");
}

/**
 * Setzt das abgeleitete "erledigt", den Status "privat" und die Zuweisung an die angemeldete Person
 * für die Seed-Aufgabe "Klären ob Sie Erbe sind" (ERBE_DESIGN.md §9).
 *
 * Die Aufgabe wird für jedes Mitglied privat ausgewertet und dem angemeldeten Benutzer zugewiesen,
 * während das Ergebnis des Fragebaums privat bleibt.
 *
 * @param ergebnis das eigene Fragebaum-Ergebnis, oder `null`.
 * @param ich die angemeldete Person, oder `null`.
 */
export function mitAbgeleitetemHaken<
  T extends {
    erledigt: boolean;
    katalog: Katalogherkunft | null;
    privat?: boolean;
    assignee?: Zuweisung;
  },
>(
  aufgaben: T[],
  ergebnis: Fragebaumergebnis | null,
  ich?: Zugewiesene | null,
): (T & { privat?: boolean; assignee?: Zuweisung })[] {
  return aufgaben.map((aufgabe) => {
    if (!istSeedAufgabe(aufgabe.katalog)) {
      return aufgabe;
    }
    return {
      ...aufgabe,
      erledigt: ergebnis !== null,
      ...(ich && ich.userId !== ""
        ? {
            privat: true,
            assignee: { typ: "personen" as const, personen: [ich] },
          }
        : {}),
    };
  });
}
