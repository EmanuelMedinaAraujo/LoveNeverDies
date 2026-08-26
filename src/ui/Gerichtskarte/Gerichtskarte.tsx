import type { Nachlassgericht } from '../../types/gericht.ts'
import stile from './Gerichtskarte.module.css'

/**
 * Zeigt die Kontaktdaten eines ermittelten Amts- und Nachlassgerichts strukturiert an.
 */
export function Gerichtskarte({ gericht }: { gericht: Nachlassgericht }) {
  return (
    <div className={stile.karte} data-testid="gerichtskarte">
      <h3 className={stile.titel}>{gericht.name}</h3>

      <div className={stile.liste}>
        {gericht.lieferanschrift ? (
          <div className={stile.zeile}>
            <span className={stile.label}>Lieferanschrift:</span>
            <span className={stile.wert}>{gericht.lieferanschrift}</span>
          </div>
        ) : null}

        {gericht.postanschrift && gericht.postanschrift !== gericht.lieferanschrift ? (
          <div className={stile.zeile}>
            <span className={stile.label}>Postanschrift:</span>
            <span className={stile.wert}>{gericht.postanschrift}</span>
          </div>
        ) : null}

        {gericht.telefon ? (
          <div className={stile.zeile}>
            <span className={stile.label}>Telefon:</span>
            <a className={stile.link} href={`tel:${gericht.telefon.replaceAll(/\s+/g, '')}`}>
              {gericht.telefon}
            </a>
          </div>
        ) : null}

        {gericht.fax ? (
          <div className={stile.zeile}>
            <span className={stile.label}>Fax:</span>
            <span className={stile.wert}>{gericht.fax}</span>
          </div>
        ) : null}

        {gericht.email ? (
          <div className={stile.zeile}>
            <span className={stile.label}>E-Mail:</span>
            <a className={stile.link} href={`mailto:${gericht.email}`}>
              {gericht.email}
            </a>
          </div>
        ) : null}

        {gericht.internet ? (
          <div className={stile.zeile}>
            <span className={stile.label}>Website:</span>
            <a
              className={stile.link}
              href={gericht.internet}
              target="_blank"
              rel="noreferrer"
            >
              {gericht.internet}
            </a>
          </div>
        ) : null}
      </div>
    </div>
  )
}
