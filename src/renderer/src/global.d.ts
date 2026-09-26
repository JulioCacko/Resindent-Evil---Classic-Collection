/**
 * The bridge the preload script installs. Declared here so the store can use it
 * with full typing and no `any`.
 */
import type { ReLauncherApi } from '@shared/channels'

declare global {
  interface Window {
    reLauncher?: ReLauncherApi
  }
}

export {}
