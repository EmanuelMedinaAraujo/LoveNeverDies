/**
 * Bytes: die kleinen Handgriffe, die jeder Baustein des Kryptokerns braucht.
 *
 * Bewusst ohne eigene Kryptographie — nur Verkettung, Vergleich, Zufall und die
 * beiden Hashes aus WebCrypto. §9 verlangt, dass dieser Ordner ohne
 * Browser-only-Abhängigkeiten jenseits von WebCrypto auskommt, damit die Edge
 * Function `vault-release` denselben Code benutzen kann.
 */

/** Der WebCrypto-Zugang. In Deno, im Browser und in Node ab 20 dasselbe Objekt. */
export function webcrypto(): Crypto {
  if (typeof globalThis.crypto?.subtle === 'undefined') {
    throw new Error('WebCrypto ist nicht verfügbar. Der Kryptokern läuft nicht ohne SubtleCrypto.')
  }

  return globalThis.crypto
}

export function zufallsBytes(laenge: number): Uint8Array {
  return webcrypto().getRandomValues(new Uint8Array(laenge))
}

export function verkette(...teile: Uint8Array[]): Uint8Array {
  const gesamt = new Uint8Array(teile.reduce((summe, teil) => summe + teil.length, 0))

  let versatz = 0
  for (const teil of teile) {
    gesamt.set(teil, versatz)
    versatz += teil.length
  }

  return gesamt
}

/**
 * WebCrypto nimmt `BufferSource`, und ein `Uint8Array` ist eines — TypeScript
 * seit 5.7 aber nur dann, wenn feststeht, dass sein Puffer kein
 * `SharedArrayBuffer` ist. Feststellen lässt sich das hier nicht, weil die
 * Bytes von außen kommen. Also steht die Umdeutung an genau einer Stelle statt
 * an jedem Aufruf.
 */
export function alsBufferSource(bytes: Uint8Array): BufferSource {
  return bytes as BufferSource
}

const ENCODER = new TextEncoder()

export function textBytes(text: string): Uint8Array {
  return ENCODER.encode(text)
}

/**
 * Vergleicht zwei Byte-Folgen ohne frühen Ausstieg.
 *
 * Gebraucht wird das dort, wo ein Vergleich über einen Geheimwert entscheidet —
 * `vault_commitment` (§3.5) und `share_hash` (§3.5). Die Laufzeit hängt hier nur
 * an den Längen, die ohnehin öffentlich sind.
 */
export function gleichZeitkonstant(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) {
    return false
  }

  let unterschied = 0
  for (const [i, byte] of a.entries()) {
    // `?? 0` tritt nie ein, die Längen sind gleich. Es steht hier, weil
    // `noUncheckedIndexedAccess` es verlangt, und kostet keinen Zweig, der von
    // einem Geheimnis abhinge.
    unterschied |= byte ^ (b[i] ?? 0)
  }

  return unterschied === 0
}

export async function sha256(...teile: Uint8Array[]): Promise<Uint8Array> {
  const digest = await webcrypto().subtle.digest('SHA-256', alsBufferSource(verkette(...teile)))

  return new Uint8Array(digest)
}

export async function hmacSha256(
  schluessel: Uint8Array,
  ...teile: Uint8Array[]
): Promise<Uint8Array> {
  const key = await webcrypto().subtle.importKey(
    'raw',
    alsBufferSource(schluessel),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )

  const mac = await webcrypto().subtle.sign('HMAC', key, alsBufferSource(verkette(...teile)))

  return new Uint8Array(mac)
}

/**
 * `fatal: true`, weil die Voreinstellung das Gegenteil tut: Sie ersetzt
 * ungültige Folgen still durch U+FFFD. Was hier ankommt, ist frisch
 * entschlüsselt — ist es kein gültiges UTF-8, dann ist es kaputt, und der
 * Fehler gehört an diese Stelle und nicht in die Oberfläche.
 */
const DECODER = new TextDecoder('utf-8', { fatal: true })

/** Die Gegenrichtung zu {@link textBytes}. */
export function bytesText(bytes: Uint8Array): string {
  return DECODER.decode(bytes)
}
