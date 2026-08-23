import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Der Einstiegspunkt.
 *
 * Wenig Logik, aber die eine Zusage, die den Unterschied zwischen einer
 * Fehlermeldung und einer weissen Seite macht: Fehlt `#root`, wird das gesagt.
 */

const render = vi.fn()
const createRoot = vi.fn<(ziel: Element | DocumentFragment) => { render: typeof render }>(() => ({
  render,
}))

vi.mock('react-dom/client', () => ({
  createRoot: (ziel: Element | DocumentFragment) => createRoot(ziel),
}))
vi.mock('../../src/ui/tokens.css', () => ({}))
vi.mock('../../src/ui/base.css', () => ({}))
vi.mock('../../src/app/App.tsx', () => ({ App: () => null }))
vi.mock('../../src/app/AppProviders.tsx', () => ({
  AppProviders: ({ children }: { children: unknown }) => children,
}))

async function ladeEinstiegspunkt() {
  vi.resetModules()
  return import('../../src/main.tsx')
}

beforeEach(() => {
  vi.clearAllMocks()
  document.body.innerHTML = ''
})

afterEach(() => {
  document.body.innerHTML = ''
})

describe('main', () => {
  it('haengt die App an #root', async () => {
    const wurzel = document.createElement('div')
    wurzel.id = 'root'
    document.body.append(wurzel)

    await ladeEinstiegspunkt()

    expect(createRoot).toHaveBeenCalledWith(wurzel)
    expect(render).toHaveBeenCalledOnce()
  })

  it('sagt es, wenn #root fehlt', async () => {
    // Ohne den Wurf bliebe die Seite leer, und die Konsole schwiege dazu.
    await expect(ladeEinstiegspunkt()).rejects.toThrow(/#root fehlt in index.html/)
  })
})
