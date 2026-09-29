/**
 * The overlay session's lifecycle and its one decision.
 *
 * Tested with a fake link rather than a real pipe: what is being checked here is *when* the launcher
 * opens a link, what it reports, and that a toast with no overlay is not sent into the void. The pipe
 * protocol itself is covered against the real plugin in `overlay-link.test.ts`, so neither test
 * duplicates the other.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createOverlaySession, overlayArtifacts, shouldLinkOverlay } from './overlay-session'
import type { OverlayHandshake, OverlayLink } from './overlay-link'

/** A link that answers whatever a test tells it to, and records what it was asked to do. */
function fakeLink(handshake: OverlayHandshake | null, showResult = true): OverlayLink & {
  readonly shows: { id: string; name: string; desc: string }[]
  readonly connects: number[]
  closes: number
} {
  const shows: { id: string; name: string; desc: string }[] = []
  const connects: number[] = []
  let closes = 0

  return {
    get available() {
      return handshake !== null
    },
    handshake,
    async connect(processId: number) {
      connects.push(processId)
      return handshake
    },
    async show(achievement: { id: string; name: string; desc: string }) {
      shows.push(achievement)
      return showResult
    },
    async stat() {
      return { presents: 1, framesDrawn: 0, lastSeq: 0 }
    },
    close() {
      closes += 1
    },
    get shows() {
      return shows
    },
    get connects() {
      return connects
    },
    get closes() {
      return closes
    }
  }
}

const D3D9: OverlayHandshake = { protocol: 1, version: '0.1.0', api: 'd3d9', width: 640, height: 480 }

describe('shouldLinkOverlay', () => {
  it('links only where an ASI loader can exist, and only when asked for', () => {
    // The loader arrives with RE-Enhance: enhanced mode with a mod payload is the only case in which
    // the plugin has anything to load it.
    expect(shouldLinkOverlay({ mode: 'enhanced', hasMod: true, enabled: true })).toBe(true)
    expect(shouldLinkOverlay({ mode: 'original', hasMod: true, enabled: true })).toBe(false)
    expect(shouldLinkOverlay({ mode: 'enhanced', hasMod: false, enabled: true })).toBe(false)
    // And the player's own setting overrides all of it: "our code inside your game" is a thing they
    // are entitled to refuse.
    expect(shouldLinkOverlay({ mode: 'enhanced', hasMod: true, enabled: false })).toBe(false)
  })
})

describe('overlayArtifacts', () => {
  const have = (name: string): string | null => `/shipped/${name}`

  it('ships the plugin and its typeface when the overlay is on', () => {
    expect(overlayArtifacts(true, have)).toEqual([
      { from: '/shipped/re_classic_overlay.asi', to: 're_classic_overlay.asi' },
      { from: '/shipped/Actor-Regular.ttf', to: 'Actor-Regular.ttf' }
    ])
  })

  it('ships NOTHING when the overlay is off', () => {
    // The consent half: with the setting off, a plugin left in the game folder would still be loaded by
    // RE-Enhance's ASI loader and would still install its hook, even though nothing would ever send it a
    // toast. Off has to mean our code is not in the game at all.
    expect(overlayArtifacts(false, have)).toEqual([])
  })

  it('skips an artifact this build does not have, rather than failing a launch', () => {
    const onlyPlugin = (name: string): string | null =>
      name === 're_classic_overlay.asi' ? '/shipped/re_classic_overlay.asi' : null

    expect(overlayArtifacts(true, onlyPlugin)).toEqual([
      { from: '/shipped/re_classic_overlay.asi', to: 're_classic_overlay.asi' }
    ])
    // And a clone that has built nothing at all is still a working launcher.
    expect(overlayArtifacts(true, () => null)).toEqual([])
  })
})

describe('overlay session', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())
  it('is unavailable until a handshake, then reports what the plugin hooked', async () => {
    const link = fakeLink(D3D9)
    const states: string[] = []
    const session = createOverlaySession({ link, onState: (state) => states.push(state.reason) })

    expect(session.available).toBe(false)
    expect(states).toEqual([])

    await session.start(4242)
    await vi.advanceTimersByTimeAsync(250)

    expect(link.connects).toEqual([4242])
    expect(session.available).toBe(true)
    expect(states).toEqual(['connecting', 'linked', 'rendering'])
  })

  it('reports a launch with no plugin as a state, not an error', async () => {
    const link = fakeLink(null)
    const session = createOverlaySession({ link })

    await session.start(4242)
    await vi.advanceTimersByTimeAsync(250)

    expect(session.available).toBe(false)
    // And a toast in that state is not sent: the launcher's own toast is the one the player sees, and
    // the renderer decides that from what this module reports.
    expect(await session.unlocked({ id: 'a', name: 'b', desc: '' })).toBe(false)
    expect(link.shows).toEqual([])
  })

  it('sends one toast per unlock while a game is linked', async () => {
    const link = fakeLink(D3D9)
    const session = createOverlaySession({ link })
    await session.start(100)
    await vi.advanceTimersByTimeAsync(250)

    expect(await session.unlocked({ id: 're1_001', name: 'A Member', desc: 'Jill' })).toBe(true)
    await vi.advanceTimersByTimeAsync(250)
    expect(link.shows).toEqual([{ id: 're1_001', name: 'A Member', desc: 'Jill' }])
  })

  it('stops claiming availability when the send is refused', async () => {
    // The plugin can die mid-session - a crash, a kill, a game that unloads it. Reporting a toast the
    // plugin never took as delivered would leave the player with neither toast.
    const link = fakeLink(D3D9, false)
    const session = createOverlaySession({ link })
    await session.start(100)
    await vi.advanceTimersByTimeAsync(250)

    expect(await session.unlocked({ id: 'a', name: 'b', desc: '' })).toBe(true)
    await vi.advanceTimersByTimeAsync(250)
    expect(session.available).toBe(false)
  })

  it('closes the link and reports the game ended, so the launcher owns the toast again', async () => {
    const link = fakeLink(D3D9)
    const states: string[] = []
    const session = createOverlaySession({ link, onState: (state) => states.push(state.reason) })
    await session.start(100)
    await vi.advanceTimersByTimeAsync(250)

    session.stop()

    expect(link.closes).toBe(1)
    expect(session.available).toBe(false)
    expect(states).toEqual(['connecting', 'linked', 'rendering', 'game-ended'])
  })
})

it('ignores a handshake that completes after the game exits', async () => {
  const link = fakeLink(D3D9)
  let complete!: (value: OverlayHandshake | null) => void
  link.connect = () => new Promise((resolve) => { complete = resolve })
  const states: string[] = []
  const session = createOverlaySession({ link, onState: (state) => states.push(state.reason) })
  const pending = session.start(42)
  session.stop()
  complete(D3D9)
  await pending
  expect(session.available).toBe(false)
  expect(states).toEqual(['connecting', 'game-ended'])
})
