/**
 * Ambient declaration of the bridge installed by `src/preload/index.ts`.
 *
 * It lives here as well as in the renderer so every consumer — the renderer, the
 * preload bundle itself and any main-process code that reasons about the page —
 * sees one definition of `window.reLauncher`.
 *
 * `reLauncher` is *optional* to match `src/renderer/src/global.d.ts` exactly.
 * `tsconfig.web.json` includes both files in a single program, so TypeScript
 * merges the two `Window` interfaces, and a duplicated member is an error
 * (TS2717) unless its type is identical to the first declaration. Optional is
 * also the truthful shape: the renderer is loaded without a preload when it is
 * served by the plain Vite dev server or opened as a Playwright page, so every
 * call site must guard for its absence rather than assume Electron is there.
 *
 * Types only — this file must emit no runtime code, so it has no value imports
 * and no exports beyond the empty statement that keeps it a module.
 */
import type { ReLauncherApi } from '@shared/channels'

declare global {
  interface Window {
    reLauncher?: ReLauncherApi
  }
}

export {}
