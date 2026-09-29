/**
 * overlay-session.ts — the launcher's side of the in-game overlay, in one place.
 *
 * `overlay-link.ts` speaks the protocol; this module owns the *lifecycle* around it: when a link is
 * worth opening at all, opening it against the right process, sending a toast when one is unlocked,
 * and closing it when the game ends. Keeping that here rather than spread through `index.ts` and
 * `ipc.ts` is what makes it testable without a game, a window or a pipe — and the decision it encodes
 * ("is the overlay even possible for this launch?") is the one that turns a measured limitation into
 * behaviour instead of a hope.
 *
 * The limitation, measured: the ASI loader that loads the plugin arrives with RE-Enhance and is
 * removed again by an ORIGINAL restore (docs/ARCHITECTURE.md §12.1 and §12.4). So an original-mode
 * launch has nothing that would load an `.asi`, and asking for one would be asking for a toast that
 * can never appear. That is `shouldLinkOverlay`.
 */
import { createOverlayLink } from './overlay-link'
import type { OverlayLink } from './overlay-link'
import type { LaunchMode } from '@shared/types'

/** What the launcher currently believes about the in-game overlay. */
export interface OverlayState {
  /** True only while a link is open *and* the plugin answered its handshake. */
  available: boolean
  /** Which API the plugin hooked (`d3d9`), or `''` when there is no link. */
  api: string
  /** Why, for the log and for the live spec. Never shown to a player. */
  reason: 'not-started' | 'connecting' | 'no-plugin' | 'linked' | 'rendering' | 'not-rendering' | 'game-ended'
}

export interface OverlaySessionOptions {
  onDelivered?: (id: string) => void
  /** Injected in tests. Defaults to a real pipe link. */
  link?: OverlayLink
  /** Called whenever the state changes, so the renderer can be told who owns the toast. */
  onState?: (state: OverlayState) => void
}

export interface OverlaySession {
  readonly available: boolean
  /** Opens the link against a running game. Never throws; a missing plugin is a state, not an error. */
  start(processId: number): Promise<void>
  /** Closes the link. Called when the game ends, and when the launcher quits. */
  stop(): void
  /** Sends one toast. Returns false when there is no overlay to send it to. */
  unlocked(achievement: { id: string; name: string; desc: string }): Promise<boolean>
}

/**
 * Whether the overlay can be present for a launch.
 *
 * All three are load-bearing. `enabled` is the player's own setting. `mode` is because the ASI loader
 * ships with RE-Enhance and an ORIGINAL restore removes it, so an original-mode launch has nothing that
 * would load a plugin. `hasMod` is because a row with no mod folder has no payload to carry the loader
 * either - the plugin would sit in the install with nothing to load it.
 */
export function shouldLinkOverlay(input: {
  mode: LaunchMode
  hasMod: boolean
  enabled: boolean
}): boolean {
  return input.enabled && input.mode === 'enhanced' && input.hasMod
}

/**
 * Which of the launcher's own artifacts belong in a game folder, for a given setting.
 *
 * This module owns both halves of "the overlay is on": what goes *into* the install, and what the
 * launcher does once a game is running. They are one decision, and the delivery half is the stronger of
 * the two — a plugin left in a game folder is loaded by RE-Enhance's ASI loader whether or not this
 * launcher ever links to it, so shipping it with the setting off would be our code running inside a game
 * the player asked us not to touch. Its hook is real even when nothing ever sends it a toast.
 *
 * `resolve` is injected so the rule is testable without a filesystem: it answers where a shipped file
 * lives, or null when this build does not have it (a clone that has not run `pnpm build:overlay`). A file
 * that is not there is skipped rather than fatal — a launch must not fail over an optional artifact.
 */
export function overlayArtifacts(
  enabled: boolean,
  resolve: (name: string) => string | null
): { from: string; to: string }[] {
  if (!enabled) return []

  const names = ['re_classic_overlay.asi', 'Actor-Regular.ttf']
  const files: { from: string; to: string }[] = []
  for (const name of names) {
    const from = resolve(name)
    if (from !== null) files.push({ from, to: name })
  }
  return files
}

export function createOverlaySession(options: OverlaySessionOptions = {}): OverlaySession {
  const link = options.link ?? createOverlayLink()

  let state: OverlayState = { available: false, api: '', reason: 'not-started' }
  let generation = 0
  let monitor: ReturnType<typeof setInterval> | null = null
  let checking = false
  let sending = false
  let nextSendAt = 0
  let awaitingDraw: { id: string; frames: number; sequence: number } | null = null
  const queue: { achievement: { id: string; name: string; desc: string }; expiresAt: number }[] = []

  function cancelMonitor(): void {
    if (monitor !== null) clearInterval(monitor)
    monitor = null
  }

  function report(next: OverlayState): void {
    state = next
    if (next.reason === 'no-plugin' || next.reason === 'not-rendering' || next.reason === 'game-ended') {
      queue.length = 0
      awaitingDraw = null
    }
    options.onState?.(next)
  }

  return {
    get available() {
      return state.available
    },

    async start(processId: number): Promise<void> {
      const session = ++generation
      queue.length = 0
      awaitingDraw = null
      checking = false
      sending = false
      nextSendAt = 0
      cancelMonitor()
      report({ available: false, api: '', reason: 'connecting' })
      /*
       * A plugin whose thread has not reached `CreateNamedPipe` yet, or a launch that never loaded it,
       * both answer null here. The retry lives in the link, so this waits once and reports once.
       */
      const handshake = await link.connect(processId)
      if (session !== generation) return
      report(
        handshake === null
          ? { available: false, api: '', reason: 'no-plugin' }
          : { available: false, api: handshake.api, reason: 'linked' }
      )
      if (handshake === null) return
      const started = performance.now()
      let lastPresents = 0
      let lastFrameAt = performance.now()
      monitor = setInterval(() => {
        if (checking) return
        checking = true
        void link.stat().then((counters) => {
          if (session !== generation) return
          if (counters === null) {
            cancelMonitor()
            report({ available: false, api: handshake.api, reason: 'no-plugin' })
          } else if (counters.presents > lastPresents) {
            lastPresents = counters.presents
            lastFrameAt = performance.now()
            if (!state.available) report({ available: true, api: 'd3d9', reason: 'rendering' })
          } else if ((state.available && performance.now() - lastFrameAt > 2000) || (performance.now() - started > 10_000 && state.reason === 'linked')) {
            report({ available: false, api: handshake.api, reason: 'not-rendering' })
          }
          if (counters && awaitingDraw && counters.lastSeq > awaitingDraw.sequence && counters.framesDrawn > awaitingDraw.frames) {
            options.onDelivered?.(awaitingDraw.id)
            awaitingDraw = null
          }
          while (queue[0] && queue[0].expiresAt <= Date.now()) queue.shift()
          if (counters && state.available && !sending && performance.now() >= nextSendAt && queue[0]) {
            const item = queue.shift()!
            sending = true
            const baseline = counters
            void link.show(item.achievement).then((ok) => {
              if (session !== generation) return
              if (ok) {
                awaitingDraw = { id: item.achievement.id, frames: baseline.framesDrawn, sequence: baseline.lastSeq }
                nextSendAt = performance.now() + 4000
              } else report({ available: false, api: handshake.api, reason: 'no-plugin' })
            }).finally(() => { if (session === generation) sending = false })
          }
        }).finally(() => { if (session === generation) checking = false })
      }, 250)
      monitor.unref?.()
    },

    stop(): void {
      generation += 1
      queue.length = 0
      awaitingDraw = null
      cancelMonitor()
      link.close()
      report({ available: false, api: '', reason: 'game-ended' })
    },

    async unlocked(achievement: { id: string; name: string; desc: string }): Promise<boolean> {
      /*
       * Deliberately not "queue it and hope": with no overlay, the launcher's own toast is the one the
       * player sees, and the renderer decides that from the state this module reports. Sending into a
       * closed link would only lose the toast twice.
       */
      if (!state.available && state.reason !== 'connecting' && state.reason !== 'linked') return false
      if (!queue.some((item) => item.achievement.id === achievement.id) && awaitingDraw?.id !== achievement.id) {
        if (queue.length >= 32) queue.shift()
        queue.push({ achievement, expiresAt: Date.now() + 30_000 })
      }
      return true
    }
  }
}
