/**
 * Die Farbwerte aus DESIGN.md §12 als JavaScript.
 *
 * `src/ui/tokens.css` ist die Quelle fuer alles, was die App selbst zeichnet.
 * Dieses Modul existiert daneben fuer den einen Verbraucher, der keine
 * CSS-Variablen aufloesen kann: Clerks `appearance`-Objekt. Aendert sich hier
 * ein Wert, aendert er sich dort mit.
 */

export type Farbpalette = {
  hintergrund: string
  karte: string
  kartenrand: string
  akzent: string
  aufAkzent: string
  text: string
  textSekundaer: string
  iconInaktiv: string
}

export const HELL: Farbpalette = {
  hintergrund: '#F7F4EC',
  karte: '#FFFFFF',
  kartenrand: '#E4DFD5',
  akzent: '#35523C',
  aufAkzent: '#FAF8F5',
  text: '#141E16',
  textSekundaer: '#5E6A61',
  iconInaktiv: '#647267',
}

export const DUNKEL: Farbpalette = {
  hintergrund: '#0C130E',
  karte: '#18231C',
  kartenrand: '#25352B',
  akzent: '#97BA8E',
  aufAkzent: '#111A13',
  text: '#FAF8F5',
  textSekundaer: '#9AA89D',
  iconInaktiv: '#5E7064',
}
