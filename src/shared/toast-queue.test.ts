/**
 * The toast queue's rules, including the one that is invisible on screen.
 *
 * The case worth having here is the in-game one: with the overlay plugin linked and a game running,
 * an unlock must be kept but *not* shown by this window, because the plugin is drawing it inside the
 * game's own frame. That rule was untestable while it lived inline in the store, and the bug it hides
 * is a player seeing one achievement announced twice.
 */
import { describe, expect, it } from 'vitest'

import { enqueueToast, nextToast, overlayOwnsToast } from './toast-queue'
import type { Achievement } from './types'

function achievement(id: string): Achievement {
  return { id, gameId: 're1', name: `Name ${id}`, desc: `Desc ${id}`, icon: '', unlocked: true, unlockDate: '' }
}

const EMPTY = { current: null, queue: [] }

describe('overlayOwnsToast', () => {
  it('needs both a linked plugin and a running game', () => {
    expect(overlayOwnsToast(true, true)).toBe(true)
    // The plugin exists for the session, so available-without-a-game must not silence the launcher.
    expect(overlayOwnsToast(true, false)).toBe(false)
    // And a game the plugin never linked to must not silence it either.
    expect(overlayOwnsToast(false, true)).toBe(false)
    expect(overlayOwnsToast(false, false)).toBe(false)
  })
})

describe('enqueueToast', () => {
  it('shows the first unlock immediately when this window owns the toast', () => {
    const state = enqueueToast(EMPTY, achievement('a'), false)
    expect(state.current?.id).toBe('a')
    expect(state.queue).toEqual([])
  })

  it('keeps the unlock but stays quiet while the in-game plugin owns the toast', () => {
    const state = enqueueToast(EMPTY, achievement('a'), true)

    // Kept: the plugin may die before the game does, and then this is the copy that gets shown.
    expect(state.queue.map((entry) => entry.id)).toEqual(['a'])
    // Quiet: the plugin is drawing it, and two toasts for one achievement is the visible bug.
    expect(state.current).toBeNull()
  })

  it('queues behind a toast that is already showing, whoever owns it', () => {
    const showing = enqueueToast(EMPTY, achievement('a'), false)
    const second = enqueueToast(showing, achievement('b'), false)

    expect(second.current?.id).toBe('a')
    expect(second.queue.map((entry) => entry.id)).toEqual(['b'])
  })

  it('drops a duplicate of the toast on screen, and of one already queued', () => {
    // Main pushes the same unlock twice - the invoke answers its caller *and* the store's own
    // `onUnlock` broadcasts it - and a toast that comes back forever is worse than a missing one.
    const showing = enqueueToast(EMPTY, achievement('a'), false)
    expect(enqueueToast(showing, achievement('a'), false)).toBe(showing)

    const waiting = enqueueToast(showing, achievement('b'), false)
    expect(enqueueToast(waiting, achievement('b'), false)).toBe(waiting)
  })

  it('returns the same state for a duplicate so the caller can skip the write', () => {
    const state = enqueueToast(EMPTY, achievement('a'), false)
    const again = enqueueToast(state, achievement('a'), false)
    // Identity, not deep equality: the store uses it to decide whether to touch its state at all.
    expect(again).toBe(state)
  })
})

describe('nextToast', () => {
  it('advances through the queue in order and then empties', () => {
    let state = enqueueToast(EMPTY, achievement('a'), false)
    state = enqueueToast(state, achievement('b'), false)
    state = enqueueToast(state, achievement('c'), false)

    expect(state.current?.id).toBe('a')
    expect(state.queue.map((entry) => entry.id)).toEqual(['b', 'c'])

    state = nextToast(state)
    expect(state.current?.id).toBe('b')
    state = nextToast(state)
    expect(state.current?.id).toBe('c')
    state = nextToast(state)

    expect(state.current).toBeNull()
    expect(state.queue).toEqual([])
  })

  it('drains a queue the plugin was holding, in the order the unlocks happened', () => {
    // The hand-over the store performs when the plugin goes away or the game ends: the unlocks were
    // queued silently, and the launcher shows them oldest first once it is the visible surface again.
    let held = enqueueToast(EMPTY, achievement('a'), true)
    held = enqueueToast(held, achievement('b'), true)
    expect(held.current).toBeNull()

    held = nextToast(held)
    expect(held.current?.id).toBe('a')
    held = nextToast(held)
    expect(held.current?.id).toBe('b')
  })
})
