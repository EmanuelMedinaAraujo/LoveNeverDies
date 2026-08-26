/**
 * Aus der flachen Liste einen Baum: eine Ebene, abgeleiteter Abschluss,
 * Abhängigkeiten (DESIGN.md §7).
 *
 * Auf dem Server ist eine Unteraufgabe eine Zeile wie jede andere. `parentId`
 * liegt verschlüsselt im Payload, über die Struktur erfährt er nichts (§3.3).
 * Der Baum entsteht deshalb hier, bei jedem Rendern, aus dem, was das Gerät
 * gerade entschlüsselt hat.
 *
 * `erledigt` ist nur bei Blättern ein gespeichertes Feld: Eine Aufgabe mit
 * Unteraufgaben gilt genau dann als erledigt, wenn alle Kinder es sind, und
 * dann zwingend. Damit gibt es nichts zu synchronisieren und nichts, was
 * divergieren kann. Fehlt inhaltlich noch etwas, fügt man eine Unteraufgabe
 * hinzu; das ist ehrlicher als eine Aufgabe, die trotz erledigter Kinder offen
 * aussieht.
 *
 * Eine Ebene, keine Verschachtelung: Was tiefer hinge, wird hier zur
 * Wurzelaufgabe statt zu verschwinden. Eine Aufgabe, die niemand mehr sieht,
 * wäre der schlimmere Fehler: Sie stünde weiter in der Datenbank, zählte
 * nirgends mit und blockierte womöglich eine Frist.
 */

import type { Aufgabe } from './aufgabenService'
import { fristlage, vergleicheNachFrist, type Fristbezug } from './fristen'

/** Eine Wurzelaufgabe mit allem, was sich über sie ableiten lässt. */
export type Aufgabenknoten = {
  aufgabe: Aufgabe
  /** Eine Ebene tief: Katalogschritte zuerst, danach in Anlagereihenfolge. */
  unteraufgaben: Aufgabe[]
  /** Ob diese Aufgabe ein eigenes Häkchen bekommt, nur Blätter tun das (§7). */
  istBlatt: boolean
  /** Abgeleitet: bei Blättern das gespeicherte Feld, sonst der Stand der Kinder. */
  erledigt: boolean
  /**
   * Die noch offenen Aufgaben, von denen diese abhängt (§7). Leer heißt: frei.
   *
   * Verweise, zu denen es keine Aufgabe gibt, stehen nicht darin. Sie zu
   * zählen hiesse, eine Aufgabe dauerhaft zu blockieren, weil eine andere
   * gelöscht wurde oder weil sie einer anderen Person privat gehört (§3.7).
   * Eine gesperrte Aufgabe mit gesetzlicher Frist ohne Ausweg ist der
   * schlechtere Fehler.
   */
  blockiertVon: Aufgabe[]
}

/**
 * Die Reihenfolge der Unteraufgaben: Katalog zuerst, danach die Anlagezeit.
 *
 * Eine neu hinzugefügte Unteraufgabe steht damit immer unter den vorhandenen
 * und nie zwischen ihnen. Das ist keine Kleinigkeit: Wer eine Aufgabe in
 * Schritte zerlegt, schreibt sie in der Reihenfolge auf, in der er sie tun
 * will, und eine Liste, die den vierten Schritt an die zweite Stelle setzt,
 * behauptet eine Reihenfolge, die niemand gemeint hat.
 *
 * Die Sortierung steht hier und nicht bloss weiter oben in `useAufgaben`:
 * Dort sortiert `nachReihenfolge` die flache Liste, und was für Wurzelaufgaben
 * richtig ist, muss innerhalb einer Elternaufgabe nicht dasselbe ergeben.
 * Ausdrücklich hier, damit die Zusage an der Stelle steht, an der die Kinder
 * entstehen.
 *
 * `id` ist eine UUIDv7 für getippte Aufgaben und eine abgeleitete UUIDv5 für
 * Katalogaufgaben (§8). Deshalb entscheidet erst die Katalogreihenfolge und
 * nur unter Gleichen die ID: Zwischen zwei Katalogschritten sagt die UUIDv5
 * nichts, sie ist ein HMAC.
 */
function nachUnterreihenfolge(links: Aufgabe, rechts: Aufgabe): number {
  const hier = links.katalog?.reihenfolge
  const dort = rechts.katalog?.reihenfolge

  if (hier !== undefined && dort !== undefined) {
    return hier === dort ? 0 : hier - dort
  }

  // Nur eine aus dem Katalog: Sie stand vor der ersten getippten da und bleibt
  // davor. Keine von beiden: die Anlagezeit im Präfix der UUIDv7 (§5).
  if (hier !== dort) {
    return hier === undefined ? 1 : -1
  }

  return links.id < rechts.id ? -1 : links.id > rechts.id ? 1 : 0
}

/** Ob diese Aufgabe als erledigt gilt: bei Blättern gespeichert, sonst abgeleitet. */
function giltAlsErledigt(aufgabe: Aufgabe, kinder: Aufgabe[]): boolean {
  return kinder.length === 0 ? aufgabe.erledigt : kinder.every((kind) => kind.erledigt)
}

/**
 * Die Wurzelaufgaben mit ihren Unteraufgaben, in der Reihenfolge der Eingabe.
 *
 * @param aufgaben alles, was dieses Gerät entschlüsselt hat: Wurzeln und
 * Unteraufgaben gemischt, so wie sie aus `useAufgaben` kommen.
 */
export function baueBaum(aufgaben: Aufgabe[]): Aufgabenknoten[] {
  const nachId = new Map(aufgaben.map((aufgabe) => [aufgabe.id, aufgabe]))

  /**
   * Wer ein Kind ist. Nur, wessen `parentId` eine Aufgabe trifft, die selbst
   * keine Elternaufgabe hat, daran hängt die eine Ebene aus §7.
   */
  const istKind = (aufgabe: Aufgabe): boolean => {
    if (aufgabe.parentId === null || aufgabe.parentId === aufgabe.id) {
      return false
    }

    const eltern = nachId.get(aufgabe.parentId)

    return eltern !== undefined && eltern.parentId === null
  }

  const kinderVon = new Map<string, Aufgabe[]>()

  for (const aufgabe of aufgaben) {
    if (istKind(aufgabe) && aufgabe.parentId !== null) {
      kinderVon.set(aufgabe.parentId, [...(kinderVon.get(aufgabe.parentId) ?? []), aufgabe])
    }
  }

  for (const kinder of kinderVon.values()) {
    kinder.sort(nachUnterreihenfolge)
  }

  const wurzeln = aufgaben.filter((aufgabe) => !istKind(aufgabe))

  /*
   * Erst der Abschluss aller Wurzeln, dann die Blockaden. Eine Abhängigkeit
   * kann eine Aufgabe mit Unteraufgaben sein, und dann entscheidet ihr
   * abgeleiteter Stand darüber, ob die wartende Aufgabe frei ist, nicht das
   * Feld in ihrem Payload (§7).
   */
  const erledigtNachId = new Map(
    wurzeln.map((aufgabe) => [
      aufgabe.id,
      giltAlsErledigt(aufgabe, kinderVon.get(aufgabe.id) ?? []),
    ]),
  )

  return wurzeln.map((aufgabe) => {
    const unteraufgaben = kinderVon.get(aufgabe.id) ?? []

    return {
      aufgabe,
      unteraufgaben,
      istBlatt: unteraufgaben.length === 0,
      erledigt: erledigtNachId.get(aufgabe.id) ?? aufgabe.erledigt,
      blockiertVon: aufgabe.dependsOn
        .map((id) => nachId.get(id))
        .filter(
          (offen): offen is Aufgabe =>
            offen !== undefined && !(erledigtNachId.get(offen.id) ?? offen.erledigt),
        ),
    }
  })
}

/**
 * Der Knoten zu einer Item-ID, für das ganzseitige Aufgabendetail (§7).
 *
 * Auch eine Unteraufgabe hat einen: Sie ist eine Zeile mit eigener UUID, ein
 * Link auf sie darf nicht ins Leere gehen. Ihr Knoten hat dann keine
 * Unteraufgaben, denn tiefer geht es nicht.
 */
export function knotenZu(aufgaben: Aufgabe[], id: string): Aufgabenknoten | null {
  const baum = baueBaum(aufgaben)
  const wurzel = baum.find((knoten) => knoten.aufgabe.id === id)

  if (wurzel !== undefined) {
    return wurzel
  }

  const unteraufgabe = baum
    .flatMap((knoten) => knoten.unteraufgaben)
    .find((kandidat) => kandidat.id === id)

  return unteraufgabe === undefined
    ? null
    : {
        aufgabe: unteraufgabe,
        unteraufgaben: [],
        istBlatt: true,
        erledigt: unteraufgabe.erledigt,
        blockiertVon: [],
      }
}

/**
 * Derselbe Baum, nach Frist sortiert (§7): das knappste Ende zuerst,
 * fristenlose Aufgaben zuletzt.
 *
 * Gibt eine neue Liste zurück und lässt die übergebene stehen: Die
 * Reihenfolge der Juristinnen (§8) ist die andere Sortierung, zwischen denen
 * die Oberfläche umschaltet.
 */
export function sortiereNachFrist(
  baum: Aufgabenknoten[],
  bezug: Fristbezug,
  heute: string,
): Aufgabenknoten[] {
  const lagen = new Map(
    baum.map((knoten) => [knoten.aufgabe.id, fristlage(knoten.aufgabe.katalog, bezug, heute, knoten.aufgabe.fristAm)]),
  )

  return [...baum].sort((links, rechts) =>
    vergleicheNachFrist(
      lagen.get(links.aufgabe.id) ?? { art: 'keine' },
      lagen.get(rechts.aufgabe.id) ?? { art: 'keine' },
    ),
  )
}
