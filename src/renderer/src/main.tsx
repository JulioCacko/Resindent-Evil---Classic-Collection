/**
 * Renderer entry point.
 *
 * Deliberately three statements long: everything the launcher does lives behind
 * `App`, and the stylesheet is imported here so the design tokens and the
 * typefaces are in the document before the first paint of the React tree.
 */
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { App } from './App'
import './styles/tailwind.css'

const container = document.getElementById('root')

// Checked rather than asserted: `#root` is owned by index.html, which is not
// type-checked, so a rename there would otherwise surface as a null-dereference
// inside React with nothing pointing at the real cause.
if (container === null) {
  throw new Error('Renderer bootstrap failed: index.html has no #root container.')
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>
)
