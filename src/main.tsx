import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

/*
 * Die Tokens und der Reset stehen vor den Komponenten-Importen. Vite gibt CSS in
 * der Reihenfolge aus, in der die Module ausgewertet werden — stuenden sie
 * unten, landete der Reset hinter den CSS-Modulen und uebersteuerte sie bei
 * gleicher Spezifitaet.
 */
import './ui/tokens.css'
import './ui/base.css'

import { App } from './app/App.tsx'
import { AppProviders } from './app/AppProviders.tsx'

const wurzel = document.getElementById('root')

if (wurzel === null) {
  throw new Error('#root fehlt in index.html.')
}

createRoot(wurzel).render(
  <StrictMode>
    <AppProviders>
      <App />
    </AppProviders>
  </StrictMode>,
)
