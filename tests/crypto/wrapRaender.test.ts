import { describe, expect, it } from 'vitest'
import { verschluessele } from '../../src/core/crypto/aead'
import { sha256, textBytes, verkette } from '../../src/core/crypto/bytes'
import { DOMAIN_SEPARATION } from '../../src/core/crypto/domain'
import { erzeugeKemSchluesselpaar, kapsele } from '../../src/core/crypto/kem'
import {
  erzeugeSignaturSchluesselpaar,
  pkSigBytes,
  signaturSchluesselAusBytes,
  signiere,
} from '../../src/core/crypto/sign'
import {
  WrapFehler,
  entpackeSchluessel,
  wrappeSchluessel,
} from '../../src/core/crypto/wrap'

/**
 * Die Ränder des Wrappens (DESIGN.md §3.2, §3.6).
 *
 * Der gewöhnliche Weg und der Signaturangriff stehen in `wrap.test.ts`. Hier
 * stehen die drei Stellen, an denen die Datei einen fremden Fehler in einen
 * `WrapFehler` übersetzt, statt ihn durchzureichen. Das ist keine Kosmetik:
 * Der Aufrufer in `fallService` fängt genau diese Sorte ab und macht daraus
 * einen gesperrten Fall. Käme dort eine andere Ausnahme an, entstünde statt
 * eines gesperrten Falls ein Absturz.
 */

const FALL = '11111111-2222-3333-4444-555555555555'
const KID = `case_${FALL}:1`
const GERAET = '99999999-8888-7777-6666-555555555555'

const K_C = Uint8Array.from({ length: 32 }, (_, i) => i)

function geraet() {
  const kem = erzeugeKemSchluesselpaar()
  const signatur = erzeugeSignaturSchluesselpaar()

  return { kem, signatur, pkSig: pkSigBytes(signatur.oeffentlich) }
}

describe('wrappeSchluessel', () => {
  it('nennt einen untauglichen Empfaengerschluessel beim Namen', async () => {
    /*
     * Eine abgeschnittene `public_key`-Spalte etwa. Ohne die Uebersetzung
     * landete hier die Ausnahme der KEM-Bibliothek, und die Meldung sagte
     * nichts darueber, welches Geraet gemeint ist.
     */
    const absender = geraet()

    await expect(
      wrappeSchluessel(
        K_C,
        { geraeteId: GERAET, pkKem: new Uint8Array(8).fill(0xff) },
        { fallId: FALL, kid: KID },
        absender.signatur.geheim,
      ),
    ).rejects.toThrow(WrapFehler)

    await expect(
      wrappeSchluessel(
        K_C,
        { geraeteId: GERAET, pkKem: new Uint8Array(8).fill(0xff) },
        { fallId: FALL, kid: KID },
        absender.signatur.geheim,
      ),
    ).rejects.toThrow(/taugt nicht zum Wrappen/)
  })
})

describe('entpackeSchluessel', () => {
  it('weist etwas ab, das kein Fallschluessel ist', async () => {
    /*
     * Ein Wrap, der sauber signiert ist und sich sauber entschluesseln laesst,
     * aber etwas anderes als einen 32-Byte-Schluessel enthaelt. Ohne die
     * Laengenpruefung ginge er als `K_c` durch, und der Fall waere danach
     * unlesbar, ohne dass irgendetwas kaputt aussaehe.
     *
     * Von Hand zusammengesetzt statt ueber `wrappeSchluessel`: Der prueft die
     * Laenge schon auf dem Hinweg. Genau das ist der Punkt — diese Zeile kann
     * nur von einer fremden, boesartigen oder kaputten Gegenstelle kommen, und
     * gegen die verteidigt die Pruefung beim Entpacken.
     */
    const empfaenger = geraet()
    const absender = geraet()

    const zuKurz = new Uint8Array(16).fill(0x07)

    const kapselung = kapsele(empfaenger.kem.oeffentlich)
    const wrappedKey = await verschluessele(kapselung.geteiltesGeheimnis, zuKurz)

    const nachricht = verkette(
      textBytes(FALL),
      textBytes(KID),
      textBytes(GERAET),
      await sha256(kapselung.kemCt, wrappedKey),
    )

    const wrap = {
      kemCt: kapselung.kemCt,
      wrappedKey,
      signatur: signiere(DOMAIN_SEPARATION.keyWrap, nachricht, absender.signatur.geheim),
    }

    await expect(
      entpackeSchluessel(
        wrap,
        { fallId: FALL, kid: KID, geraeteId: GERAET },
        empfaenger.kem.geheim,
        signaturSchluesselAusBytes(absender.pkSig),
      ),
    ).rejects.toThrow(/16 Byte statt 32/)
  })

  it('macht aus einer unlesbaren Signatur ein "verifiziert nicht"', async () => {
    /*
     * Ein Signatur-Envelope aus einer fremden Version oder eine abgeschnittene
     * Spalte: beides ist „verifiziert nicht" und darf nicht als fremde
     * Ausnahme an einer Stelle landen, die nur „gueltig oder nicht" wissen
     * will.
     */
    const empfaenger = geraet()
    const absender = geraet()

    const kapselung = kapsele(empfaenger.kem.oeffentlich)
    const wrappedKey = await verschluessele(kapselung.geteiltesGeheimnis, K_C)

    const wrap = {
      kemCt: kapselung.kemCt,
      wrappedKey,
      signatur: new Uint8Array(4).fill(0x00),
    }

    await expect(
      entpackeSchluessel(
        wrap,
        { fallId: FALL, kid: KID, geraeteId: GERAET },
        empfaenger.kem.geheim,
        signaturSchluesselAusBytes(absender.pkSig),
      ),
    ).rejects.toThrow(WrapFehler)
  })
})
