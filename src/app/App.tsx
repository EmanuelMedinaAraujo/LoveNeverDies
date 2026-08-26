import { useEffect } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { useAuth } from '../core/auth/authProvider.ts'
import { speicherDauerhaftAnfordern } from '../core/storage/persist.ts'
import { useAnsicht } from '../hooks/useAnsichtsmodus.ts'
import { useGeraeteanmeldung } from '../hooks/useGeraete.ts'
import { useProfilAbgleich } from '../hooks/useProfil.ts'
import { Alle as AlleEinfach } from '../screens/einfach/Alle/Alle.tsx'
import { Aufgabe as AufgabeEinfach } from '../screens/einfach/Aufgabe/Aufgabe.tsx'
import { Start as StartEinfach } from '../screens/einfach/Start/Start.tsx'
import { Alle } from '../screens/erweitert/Alle/Alle.tsx'
import { Aufgabe } from '../screens/erweitert/Aufgabe/Aufgabe.tsx'
import { Start } from '../screens/erweitert/Start/Start.tsx'
import { Anmelden } from '../screens/shared/Anmelden/Anmelden.tsx'
import { Beitreten } from '../screens/shared/Beitreten/Beitreten.tsx'
import { Erbe } from '../screens/shared/Erbe/Erbe.tsx'
import { Fragebaum } from '../screens/shared/Fragebaum/Fragebaum.tsx'
import { Konto } from '../screens/shared/Konto/Konto.tsx'
import { Koppeln } from '../screens/shared/Koppeln/Koppeln.tsx'
import { Nachlass } from '../screens/shared/Nachlass/Nachlass.tsx'
import { Ansichtswahl } from '../screens/shared/Onboarding/Ansichtswahl.tsx'
import { Profil } from '../screens/shared/Profil/Profil.tsx'
import { Todesfall } from '../screens/shared/Todesfall/Todesfall.tsx'
import { Vorsorge } from '../screens/shared/Vorsorge/Vorsorge.tsx'
import { Rahmen } from './Rahmen.tsx'
import stile from './App.module.css'

function Ladeanzeige({ text }: { text: string }) {
  return (
    <div className={stile.ladeanzeige} role="status">
      {text}
    </div>
  )
}

export function App() {
  const { modus, textgroesse, darstellung } = useAnsicht()
  const { zustand } = useAuth()

  /*
   * §7: Nach der Anmeldung entstehen beide Keypairs und das Gerät meldet sich
   * an: still, ohne sichtbaren Zwischenschritt. Der Rückgabewert wird hier
   * nicht gebraucht; Profil holt sich denselben Zustand noch einmal.
   */
  useGeraeteanmeldung()

  /*
   * §3.3, §6: Name und E-Mail landen in `profiles`, damit die einladende Person
   * sie sieht, bevor ein gemeinsamer Schlüssel existiert. Läuft ebenfalls still
   * mit; ein Fehlschlag hält nichts an und meldet sich erst, wenn wirklich ein
   * Kopplungscode gebraucht wird.
   */
  useProfilAbgleich()

  /*
   * §7: Die Ansicht steht an der Wurzel, nicht in den Screens. `data-dichte`
   * schaltet die Dichtetokens um (`ui/tokens.css`), und solange die Wahl noch
   * aussteht, gilt "einfach": Der Screen, auf dem gewählt wird, soll so
   * aussehen, wie die App danach aussieht, wenn man nichts ändert.
   */
  useEffect(() => {
    document.documentElement.dataset.dichte = modus ?? 'einfach'
  }, [modus])

  /*
   * §7: Die beiden Overrides aus Profil. Steht einer auf "Systemeinstellung
   * folgen", steht an der Wurzel *nichts* — nicht etwa `system`. Das ist der
   * Unterschied zwischen "der Browser entscheidet" und "die App hat sich fuer
   * das entschieden, was der Browser gerade sagt": Nur im ersten Fall zieht ein
   * Wechsel der Systemeinstellung mit, ohne dass jemand die App neu lädt.
   */
  useEffect(() => {
    const wurzel = document.documentElement

    if (darstellung === 'system') {
      delete wurzel.dataset.farbschema
    } else {
      wurzel.dataset.farbschema = darstellung
    }
  }, [darstellung])

  useEffect(() => {
    const wurzel = document.documentElement

    if (textgroesse === 'system') {
      delete wurzel.dataset.textgroesse
    } else {
      wurzel.dataset.textgroesse = textgroesse
    }
  }, [textgroesse])

  useEffect(() => {
    /*
     * §7: läuft still mit. Schlägt es fehl, sagt die App nichts: Ein Hinweis
     * wäre eine Warnung ohne Handlungsmöglichkeit. Die Bitte steht hinter der
     * Anmeldung, weil Browser sie eher gewähren, wenn jemand die Seite
     * tatsächlich benutzt.
     */
    if (zustand.status === 'angemeldet') {
      void speicherDauerhaftAnfordern()
    }
  }, [zustand.status])

  if (zustand.status === 'laedt') {
    return <Ladeanzeige text="Einen Moment bitte…" />
  }

  if (zustand.status === 'abgemeldet') {
    return <Anmelden />
  }

  /*
   * §7: "Die Ansichtswahl kommt vor der Fallweiche, damit alle folgenden
   * Screens bereits im gewählten Modus erscheinen." Sie steht deshalb vor den
   * Routen und nicht als eine unter ihnen: Wer die App zum ersten Mal auf
   * diesem Gerät öffnet, kommt an ihr nicht vorbei, gleich über welchen Link.
   *
   * Gefragt wird je Gerät, nicht je Person: Es ist eine Auskunft über diesen
   * Bildschirm und diese Augen, und wer am Telefon der Tochter hilft, ändert
   * dort nichts (§3.3).
   */
  if (modus === null) {
    return <Ansichtswahl />
  }

  /*
   * §7: Getrennte Screen-Bäume für Start, Aufgabe und Alle. `Erbe` und
   * `Profil` gibt es genau einmal — dort liegen die unumkehrbaren Abläufe, und
   * ein zweiter Bestätigungsdialog, der leicht anders formuliert ist, wäre ein
   * Risiko ohne Gegenwert.
   */
  const einfach = modus === 'einfach'

  return (
    <Routes>
      {/*
        Die vier Hauptscreens aus §7. Sie und nur sie stehen im `Rahmen`, der
        die untere Leiste darunter setzt: Start, Erbe, Alle, Profil.

        Was hier nicht im Rahmen steht, ist Absicht. Das Aufgabendetail ist
        ganzseitig (§7), und Todesfall, Vorsorge, Koppeln und Beitreten sind
        lineare Abläufe mit genau einem nächsten Schritt. Eine Leiste, die
        mitten in einer Kopplung vier andere Wege anbietet, ist dort keine
        Orientierung, sondern eine Abbruchkante.

        Start trägt die Fallsperre selbst: Ohne Fall ist die App gesperrt, und
        dann steht dort der Screen mit den drei Schaltflächen.
      */}
      <Route
        path="/"
        element={
          <Rahmen>{einfach ? <StartEinfach /> : <Start />}</Rahmen>
        }
      />
      <Route
        path="/erbe"
        element={
          <Rahmen>
            <Erbe />
          </Rahmen>
        }
      />
      <Route
        path="/alle"
        element={
          <Rahmen>{einfach ? <AlleEinfach /> : <Alle />}</Rahmen>
        }
      />
      {/* Das Aufgabendetail (§7). */}
      <Route
        path="/aufgabe/:id"
        element={
          <Rahmen>{einfach ? <AufgabeEinfach /> : <Aufgabe />}</Rahmen>
        }
      />
      {/*
        Der Fragebaum steht ausserhalb des Rahmens (ERBE_DESIGN.md §3): Er ist
        ein linearer Ablauf mit genau einem nächsten Schritt, wie Todesfall,
        Vorsorge und Koppeln. Eine Leiste, die mitten im Baum vier andere Wege
        anbietet, wäre dort keine Orientierung, sondern eine Abbruchkante —
        und der Zurück-Knopf des Browsers, an dem hier alles hängt, bekaeme
        eine zweite Bedeutung.

        Zwei Pfade auf denselben Screen: `/erbe/fragebaum` ist der Einstieg und
        leitet auf die erste Frage weiter.
      */}
      {/*
        §3.5: Der geöffnete Nachlass-Tresor, ganzseitig und ohne Leiste wie
        das Aufgabendetail. Er hängt unter `/erbe`, weil er dorthin gehört und
        von dort kommt; der Screen selbst schickt zurück, solange der Fall noch
        in der Vorsorge steht.
      */}
      <Route path="/erbe/tresor" element={<Nachlass />} />
      <Route path="/erbe/fragebaum" element={<Fragebaum />} />
      <Route path="/erbe/fragebaum/:knotenId" element={<Fragebaum />} />
      <Route path="/todesfall" element={<Todesfall />} />
      <Route path="/vorsorge" element={<Vorsorge />} />
      {/*
        Beide Zwecke aus §6 auf demselben Screen, mit verschiedenen Wegen
        hinein: "Ich wurde eingeladen" aus der Fallweiche, "Dieses Gerät
        freischalten" aus Start und Profil. Der Ablauf ist identisch (§6).
      */}
      <Route path="/beitreten" element={<Beitreten zweck="join" />} />
      <Route path="/geraet-freischalten" element={<Beitreten zweck="device" />} />
      <Route path="/koppeln" element={<Koppeln />} />
      {/*
        Die Kontoeinstellungen, ganzseitig und ohne Leiste: Clerks Oberfläche
        bringt eine eigene Navigation mit, und zwei Navigationen auf einem
        Bildschirm geben auf dieselbe Frage zwei Antworten (§7).
      */}
      <Route path="/konto" element={<Konto />} />
      <Route
        path="/profil"
        element={
          <Rahmen>
            <Profil />
          </Rahmen>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
