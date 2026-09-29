/**
 * The achievement toast's queue, as a pure function of its inputs.
 *
 * This exists because the interesting part of showing a toast stopped being one line: while the
 * in-game overlay plugin owns the toast, the launcher has to stay quiet *and* keep the unlock, and
 * that rule was living inline in `state/store.ts` where nothing could test it. The store's own
 * comment on `handleAction` makes the point for the input side — "keeping the decision separate from
 * the effect is what makes the rules readable in one place" — and the same holds here.
 *
 * Both functions return the *same object* when nothing changed, so a caller can skip a state write
 * entirely rather than re-render for a duplicate.
 */
import type { Achievement } from './types'

/** What the window currently has on screen, and what is waiting behind it. */
export interface ToastQueueState {
  current: Achievement | null
  queue: Achievement[]
}

/**
 * Whether the in-game plugin owns the toast right now.
 *
 * Both halves are required. `overlayAvailable` alone would silence the launcher on a screen with no
 * game running (the plugin exists for the session, not for the whole app); `running` alone would
 * silence it during a launch the plugin never managed to link to.
 */
export function overlayOwnsToast(overlayAvailable: boolean, running: boolean): boolean {
  return overlayAvailable && running
}

/**
 * Adds an unlock: it becomes the current toast, or waits its turn.
 *
 * A duplicate is dropped rather than queued twice. The main process can push the same unlock twice -
 * `achievements:unlock` answers its caller *and* the store's own `onUnlock` broadcasts it
 * (src/main/ipc.ts) - and a toast that comes back forever is worse than one that is missing.
 *
 * `ownsToast` is the in-game case: the plugin is drawing this unlock inside the game's own frame, so
 * the window queues it without showing it. It is queued rather than dropped because the plugin can
 * die before the game does, and whatever it was holding has to be shown when the launcher takes over.
 */
export function enqueueToast(
  state: ToastQueueState,
  achievement: Achievement,
  ownsToast: boolean
): ToastQueueState {
  if (state.current !== null && state.current.id === achievement.id) return state
  if (state.queue.some((queued) => queued.id === achievement.id)) return state

  if (state.current === null && !ownsToast) {
    return { current: achievement, queue: state.queue }
  }

  return { current: state.current, queue: [...state.queue, achievement].slice(-32) }
}

/** Moves on to the next toast. The slot empties when the queue runs out. */
export function nextToast(state: ToastQueueState): ToastQueueState {
  const [next, ...rest] = state.queue
  return { current: next ?? null, queue: rest }
}
