import { useEffect } from 'react'
import { Link, Navigate, Route, Routes } from 'react-router-dom'
import { useAuth } from '../core/auth/authProvider.ts'
import { speicherDauerhaftAnfordern } from '../core/storage/persist.ts'
import { useAnsichtsmodus } from '../hooks/useAnsichtsmodus.ts'
import { useCase } from '../hooks/useCase.ts'
import { useGeraeteanmeldung } from '../hooks/useGeraete.ts'
import { useProfilAbgleich } from '../hooks/useProfil.ts'
import { fallBeschriftung } from '../services/fallbeschriftung.ts'
import type { Fall } from '../services/fallService.ts'
import { Alle } from '../screens/shared/Alle/Alle.tsx'
import { Anmelden } from '../screens/shared/Anmelden/Anmelden.tsx'
import { Aufgabe } from '../screens/shared/Aufgabe/Aufgabe.tsx'
import { Beitreten } from '../screens/shared/Beitreten/Beitreten.tsx'
import { KeinFall } from '../screens/shared/KeinFall/KeinFall.tsx'
import { Koppeln } from '../screens/shared/Koppeln/Koppeln.tsx'
import { Profil } from '../screens/shared/Profil/Profil.tsx'
import { Todesfall } from '../screens/shared/Todesfall/Todesfall.tsx'
import { Badge } from '../ui/Badge/Badge.tsx'
import stile from './App.module.css'

function Ladeanzeige({ text }: { text: string }) {
  return (
    <div className={stile.ladeanzeige} role="status">
      {text}
    </div>
  )
}

/**
 * Der Weg zu Profil, mit dem Freigabe-Hinweis daran (§3.6).
 *
 * §3.6 verlangt den Badge „in der unteren Leiste". Die gibt es noch nicht — sie
 * kommt mit den Screens, die sie verbindet (§7). Bis dahin steht er am selben
 * Ort wie der Profil-Eintrag der künftigen Leiste, nämlich an dem einen Link,
 * der dorthin führt. Was er meldet, ändert sich damit nicht: Dieses Gerät sieht
 * einen Fall, den es nicht lesen kann, und die Freigabe geschieht in Profil.
 */
function ProfilWeg({ freigabeNoetig }: { freigabeNoetig: boolean }) {
  return (
    <p className={stile.hinweis}>
      <Link to="/profil">Profil und Geräte</Link>{' '}
      {freigabeNoetig ? <Badge lage="hinweis">Freigabe nötig</Badge> : null}
    </p>
  )
}

/**
 * Der Fall selbst, sobald es einen gibt (§2). Es gibt noch keinen eigenen
 * Start-Screen mit den *zugewiesenen* Aufgaben — der kommt mit der Zuweisung,
 * die ihn füllt (§7). Bis dahin steht hier, wofür §2 die Beschriftung
 * verlangt: der Name der Person, kein Sammelbegriff, und der Weg zu "Alle".
 */
function Fallanzeige({ fall, freigabeNoetig }: { fall: Fall; freigabeNoetig: boolean }) {
  if (fall.zustand === 'gesperrt') {
    return (
      <main className={stile.start}>
        <h1>Fall gesperrt</h1>
        <p className={stile.hinweis} role="alert">
          {fall.grund}
        </p>
        {/*
          §3.6: Ein neues Gerät sieht den Fall und liest nichts, bis ein anderes
          Mitglied `K_c` an seinen öffentlichen Schlüssel wrappt. Der Weg dorthin
          gehört an diese Stelle und nicht drei Klicks entfernt.
        */}
        <p className={stile.hinweis}>
          <Link to="/geraet-freischalten">Dieses Gerät freischalten lassen</Link>
        </p>
        <ProfilWeg freigabeNoetig={freigabeNoetig} />
      </main>
    )
  }

  return (
    <main className={stile.start}>
      <h1>
        {fall.sterbedatum === null ? fall.personName : fallBeschriftung(fall.personName, fall.sterbedatum)}
      </h1>

      {/*
        Die untere Leiste aus §7 — Start · Erbe · Alle · Profil — kommt mit den
        Screens, die sie verbindet. Zwei davon gibt es, und die beiden Wege
        stehen so lange hier.
      */}
      <p className={stile.hinweis}>
        <Link to="/alle">Alle Aufgaben</Link>
      </p>
      <ProfilWeg freigabeNoetig={freigabeNoetig} />
    </main>
  )
}

/**
 * Die Fallsperre aus DESIGN.md §7: Ohne Fall ist die App gesperrt, es gibt einen
 * Screen mit drei Schaltflächen.
 */
function FallSperre() {
  const { zustand: fall } = useCase()

  if (fall.status === 'laedt') {
    return <Ladeanzeige text="Ihre Daten werden geladen…" />
  }

  if (fall.status === 'fehler') {
    return <Ladeanzeige text={`Ihre Fälle sind gerade nicht abrufbar. ${fall.nachricht}`} />
  }

  if (fall.status === 'kein-fall') {
    return <KeinFall />
  }

  // Ein gesperrter Fall in der Liste heißt: Dieses Gerät wartet auf eine
  // Freigabe (§3.6). Das ist lokal ablesbar — die Wraps fremder Geräte sind es
  // nicht (§4), also kann nur das wartende Gerät selbst den Hinweis zeigen.
  const freigabeNoetig = fall.faelle.some((eintrag) => eintrag.zustand === 'gesperrt')

  return <Fallanzeige fall={fall.aktiver} freigabeNoetig={freigabeNoetig} />
}

export function App() {
  const ansichtsmodus = useAnsichtsmodus()
  const { zustand } = useAuth()

  /*
   * §7: Nach der Anmeldung entstehen beide Keypairs und das Gerät meldet sich
   * an — still, ohne sichtbaren Zwischenschritt. Der Rückgabewert wird hier
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

  useEffect(() => {
    document.documentElement.dataset.dichte = ansichtsmodus
  }, [ansichtsmodus])

  useEffect(() => {
    /*
     * §7: läuft still mit. Schlägt es fehl, sagt die App nichts — ein Hinweis
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

  return (
    <Routes>
      <Route path="/" element={<FallSperre />} />
      <Route path="/alle" element={<Alle />} />
      {/* Das ganzseitige Aufgabendetail (§7). */}
      <Route path="/aufgabe/:id" element={<Aufgabe />} />
      <Route path="/todesfall" element={<Todesfall />} />
      {/*
        Beide Zwecke aus §6 auf demselben Screen, mit verschiedenen Wegen
        hinein: „Ich wurde eingeladen" aus der Fallweiche, „Dieses Gerät
        freischalten" aus Profil. Der Ablauf ist identisch (§6).
      */}
      <Route path="/beitreten" element={<Beitreten zweck="join" />} />
      <Route path="/geraet-freischalten" element={<Beitreten zweck="device" />} />
      <Route path="/koppeln" element={<Koppeln />} />
      <Route path="/profil" element={<Profil />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
