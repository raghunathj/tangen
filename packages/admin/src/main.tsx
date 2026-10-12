import '../app/globals.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { initTheme } from '../lib/theme'
import { initScrollbars } from '../lib/scrollbars'
import { installSharedRuntime } from '../lib/shared-runtime'

// The preference the pre-paint script already applied; from here the store
// owns it (follows the OS in `system`, yields to Studio's scope).
// K7.3: extension bundles loaded at runtime read React, the router and the kit from here.
installSharedRuntime()
initTheme()
initScrollbars()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
