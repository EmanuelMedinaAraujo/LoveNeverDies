import { describe, expect, it } from 'vitest'
import { erzeugeAesSchluessel } from '../../src/core/crypto/aead'
import { ShamirFehler, kombiniereShares, teileGeheimnis } from '../../src/core/crypto/shamir'

/**
 * Nahtstelle: Shamir-Split und -Kombination (DESIGN.md §3.5).
 *
 * `K_v` wird in `n` Teile zerlegt, `k` davon rekonstruieren ihn. Der Sonderfall
 * `n = 1` gehoert nicht hierher, sondern in den Tresorpfad: Die Bibliothek
 * verlangt `shares >= 2` und `threshold >= 2`, und ein Direktwrap ist etwas
 * anderes als ein Split mit Schwelle 1.
 */

const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString('hex')

describe('Teilen und Zusammensetzen', () => {
  it('setzt das Geheimnis aus k Teilen zusammen', async () => {
    const geheimnis = erzeugeAesSchluessel()

    const teile = await teileGeheimnis(geheimnis, 5, 3)

    expect(teile).toHaveLength(5)
    expect(hex(await kombiniereShares(teile.slice(0, 3)))).toBe(hex(geheimnis))
  })

  it('setzt es auch aus einer anderen Auswahl von k Teilen zusammen', async () => {
    const geheimnis = erzeugeAesSchluessel()

    const teile = await teileGeheimnis(geheimnis, 5, 3)

    expect(hex(await kombiniereShares([teile[4], teile[0], teile[2]]))).toBe(hex(geheimnis))
  })

  it('scheitert bei k-1 Teilen', async () => {
    // "Scheitern" heisst hier nicht "wirft": Die Bibliothek gibt aus zu wenigen
    // Teilen bereitwillig Bytes zurueck, nur eben die falschen. Genau deshalb
    // haengt die Entscheidung in §3.5 nicht am Zaehler, sondern am
    // `vault_commitment` ueber dem rekonstruierten K_v.
    const geheimnis = erzeugeAesSchluessel()

    const teile = await teileGeheimnis(geheimnis, 5, 3)

    expect(hex(await kombiniereShares(teile.slice(0, 2)))).not.toBe(hex(geheimnis))
  })

  it('kombiniert einen Teil aus einem frueheren Polynom nicht mehr', async () => {
    // Neuverteilt wird auf demselben K_v mit frischem Polynom (§3.5). Ein Teil
    // aus der vorigen Runde liegt nicht auf der neuen Kurve: Der Cache einer
    // ausgetretenen Person ist damit wertlos.
    const geheimnis = erzeugeAesSchluessel()
    const alt = await teileGeheimnis(geheimnis, 3, 2)
    const neu = await teileGeheimnis(geheimnis, 3, 2)

    const teilAlt = alt[0]!
    const teilNeu = neu.find((t) => t[t.length - 1] !== teilAlt[teilAlt.length - 1])!

    expect(hex(await kombiniereShares([teilAlt, teilNeu]))).not.toBe(hex(geheimnis))
    expect(hex(await kombiniereShares([neu[0], neu[1]]))).toBe(hex(geheimnis))
  })

  it('weist n = 1 ab und verweist auf den Direktwrap', async () => {
    await expect(teileGeheimnis(erzeugeAesSchluessel(), 1, 1)).rejects.toThrow(ShamirFehler)
    await expect(teileGeheimnis(erzeugeAesSchluessel(), 1, 1)).rejects.toThrow(/Direktwrap/)
  })

  it('weist eine Schwelle ab, die groesser ist als die Zahl der Teile', async () => {
    await expect(teileGeheimnis(erzeugeAesSchluessel(), 3, 4)).rejects.toThrow(ShamirFehler)
  })

  it('weist zwei gleiche Teile als solche ab', async () => {
    // Jedes Mitglied besitzt K_c und kann die Freigabe eines anderen mitlesen
    // und als eigene erneut hochladen (§3.5). Beim Zusammensetzen muss das ein
    // ShamirFehler sein und kein fremder Error, sonst greift der Tresorpfad
    // daneben.
    const teile = await teileGeheimnis(erzeugeAesSchluessel(), 3, 2)

    await expect(kombiniereShares([teile[0], teile[0]])).rejects.toThrow(ShamirFehler)
  })

  it('weist Teile verschiedener Länge ab', async () => {
    const teile = await teileGeheimnis(erzeugeAesSchluessel(), 3, 2)

    await expect(kombiniereShares([teile[0], teile[1].slice(0, 20)])).rejects.toThrow(ShamirFehler)
  })

  it('weist einen zu kurzen Teil ab', async () => {
    const teile = await teileGeheimnis(erzeugeAesSchluessel(), 3, 2)

    await expect(kombiniereShares([teile[0].slice(0, 1), teile[1].slice(0, 1)])).rejects.toThrow(
      ShamirFehler,
    )
  })

  it('weist eine Kombination aus weniger als zwei Teilen ab', async () => {
    const teile = await teileGeheimnis(erzeugeAesSchluessel(), 3, 2)

    await expect(kombiniereShares([teile[0]])).rejects.toThrow(ShamirFehler)
    await expect(kombiniereShares([])).rejects.toThrow(ShamirFehler)
  })
})
