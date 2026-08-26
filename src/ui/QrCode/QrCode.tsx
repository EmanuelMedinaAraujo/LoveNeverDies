import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import stile from './QrCode.module.css'

/**
 * Ein QR-Code aus einem beliebigen Text, zum Beispiel dem Kopplungscode
 * (DESIGN.md §6, Punkt 5 der Kopplungs-Anforderungen).
 *
 * Kein tiefes Linking, kein eigenes Payload-Format: Kodiert wird genau der
 * String, der als `wert` hereinkommt. Auf der lesenden Seite trifft er auf
 * dieselbe Normalisierung wie ein getippter Code (`formatiereKopplungscodeEingabe`
 * / `normalisiereKopplungscode`), deshalb reicht das.
 *
 * Gerendert wird als SVG-Zeichenkette, nicht auf ein `<canvas>`: `qrcode`
 * baut ein PNG nur ueber einen echten Canvas-Kontext, den jsdom in den Tests
 * nicht kennt (`getContext('2d')` liefert dort `null`). Der SVG-Pfad ist reine
 * Zeichenkettenverarbeitung -- er laeuft im Browser und im Test identisch,
 * ohne dass ein Test etwas anderes vortaeuschen muesste, als am Ende wirklich
 * lief.
 *
 * Die SVG-Zeichenkette landet als Daten-URL in einem `<img>`, nicht ueber
 * `dangerouslySetInnerHTML`: So bleibt die Komponente ein gewoehnliches Bild,
 * ohne fremdes Markup ins DOM zu haengen -- obwohl der Text hier ausschliesslich
 * aus dieser Bibliothek stammt und nicht von aussen hereinkommt.
 */
export function QrCode({
  wert,
  beschriftung = '',
}: {
  wert: string
  /** Alternativtext. Leer lassen, wenn derselbe Code bereits sichtbar danebensteht (§6). */
  beschriftung?: string
}) {
  const [ergebnis, setzeErgebnis] = useState<{ status: 'ok'; url: string } | { status: 'fehler' } | null>(
    null,
  )

  useEffect(() => {
    let aktuell = true

    QRCode.toString(wert, { type: 'svg', margin: 1 })
      .then((svg) => {
        if (aktuell) {
          setzeErgebnis({ status: 'ok', url: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}` })
        }
      })
      .catch(() => {
        if (aktuell) {
          setzeErgebnis({ status: 'fehler' })
        }
      })

    return () => {
      aktuell = false
    }
  }, [wert])

  if (ergebnis === null) {
    return null
  }

  if (ergebnis.status === 'fehler') {
    return (
      <p className={stile.hinweis} role="alert">
        Der QR-Code war nicht zu erzeugen. Bitte nennen Sie den Code stattdessen am Telefon.
      </p>
    )
  }

  return <img className={stile.bild} src={ergebnis.url} alt={beschriftung} width={220} height={220} />
}
