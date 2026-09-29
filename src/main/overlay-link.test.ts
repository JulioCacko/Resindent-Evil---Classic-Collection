/**
 * The launcher's end of the overlay pipe.
 *
 * Two kinds of test live here, and the split is deliberate:
 *
 *  - Everything above the "real pipe" block is hermetic: a fake socket drives the framing,
 *    the timeouts and the failure paths, so the protocol's edge cases are covered without any
 *    native artifact and without a game.
 *  - The block at the end runs the *real* thing — `native/testhost/overlay-testhost.exe` loads
 *    the real plugin, and the real `createOverlayLink` talks to its real named pipe. That is the
 *    only way to know the two sides agree, and it is cheap enough to run every time (about half
 *    a second). It skips when the native artifacts have not been built (`pnpm build:overlay`),
 *    so `pnpm test` still passes on a machine with no compiler.
 */
import { spawn } from 'node:child_process'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { describe, expect, it, vi } from 'vitest'

import {
  OVERLAY_FIELD_LIMITS,
  OVERLAY_PROTOCOL_VERSION,
  createOverlayLink,
  encodeShow,
  overlayPipePath,
  parseOverlayMessage,
  sanitizeField
} from './overlay-link'
import type { OverlaySocket } from './overlay-link'

// ---------------------------------------------------------------------------
// a socket that goes nowhere
// ---------------------------------------------------------------------------

/** A stand-in for `net.Socket`: it records what was written and replays what a test decides. */
class FakeSocket implements OverlaySocket {
  readonly written: string[] = []
  ended = false
  destroyed = false

  private dataListeners: ((chunk: Buffer) => void)[] = []
  private errorListeners: ((error: Error) => void)[] = []
  private closeListeners: (() => void)[] = []

  write(text: string): boolean {
    this.written.push(text)
    return true
  }

  end(): void {
    this.ended = true
  }

  destroy(): void {
    this.destroyed = true
  }

  on(event: 'data', listener: (chunk: Buffer) => void): void
  on(event: 'error', listener: (error: Error) => void): void
  on(event: 'close', listener: () => void): void
  on(event: 'connect', listener: () => void): void
  on(event: 'data' | 'error' | 'close' | 'connect', listener: unknown): void {
    if (event === 'data') this.dataListeners.push(listener as (chunk: Buffer) => void)
    if (event === 'error') this.errorListeners.push(listener as (error: Error) => void)
    if (event === 'close') this.closeListeners.push(listener as () => void)
  }

  /** Pushes a chunk at the link, exactly as the OS would deliver it. */
  receive(text: string): void {
    const chunk = Buffer.from(text, 'utf8')
    for (const listener of [...this.dataListeners]) listener(chunk)
  }

  emitError(error: Error): void {
    for (const listener of [...this.errorListeners]) listener(error)
  }

  emitClose(): void {
    for (const listener of [...this.closeListeners]) listener()
  }
}

/** A link wired to a fake socket, plus the socket itself for the assertions. */
function makeLink(options: { handshakeTimeoutMs?: number; replyTimeoutMs?: number } = {}): {
  link: ReturnType<typeof createOverlayLink>
  socket: FakeSocket
} {
  const socket = new FakeSocket()
  const link = createOverlayLink({
    connector: () => socket,
    handshakeTimeoutMs: options.handshakeTimeoutMs ?? 50,
    replyTimeoutMs: options.replyTimeoutMs ?? 50
  })
  return { link, socket }
}

const HELLO = `HELLO\t${String(OVERLAY_PROTOCOL_VERSION)}\t0.1.0\td3d9\t640x480\n`

// ---------------------------------------------------------------------------
// the wire format
// ---------------------------------------------------------------------------

describe('overlay protocol', () => {
  it('names the pipe after the process, which is what makes a link unambiguous', () => {
    expect(overlayPipePath(4242)).toBe('\\\\.\\pipe\\re-classic-overlay-4242')
  })

  it('flattens what would break the framing, and cuts to the plugin buffer', () => {
    // A tab is the field separator and a newline ends the line: neither can survive, or a name
    // like "A\tB" would arrive as a different message rather than a different name.
    expect(sanitizeField('A\tB\nC\rD', 64)).toBe('A B C D')
    expect(sanitizeField('\u0000\u001f\u007f', 64)).toBe('   ')
    expect(sanitizeField('x'.repeat(300), OVERLAY_FIELD_LIMITS.name)).toHaveLength(128)
  })

  it('encodes SHOW as one tab-separated line ending in a newline', () => {
    expect(encodeShow(7, { id: 're1_001', name: 'A Member of S.T.A.R.S.', desc: 'Jill' })).toBe(
      'SHOW\t7\tre1_001\tA Member of S.T.A.R.S.\tJill\n'
    )
  })

  it('encodes a description that is empty, since most achievements have none', () => {
    expect(encodeShow(1, { id: 'x', name: 'y', desc: '' })).toBe('SHOW\t1\tx\ty\t\n')
  })

  it('reads the handshake the plugin sends first', () => {
    expect(parseOverlayMessage(HELLO.trimEnd())).toEqual({
      kind: 'hello',
      handshake: { protocol: 1, version: '0.1.0', api: 'd3d9', width: 640, height: 480 }
    })
  })

  it('reads every other reply', () => {
    expect(parseOverlayMessage('ACK\t12')).toEqual({ kind: 'ack', seq: 12 })
    expect(parseOverlayMessage('OK\tRESET')).toEqual({ kind: 'ok', what: 'RESET' })
    expect(parseOverlayMessage('PONG')).toEqual({ kind: 'pong' })
    expect(parseOverlayMessage('STAT\t9\t4\t3')).toEqual({
      kind: 'stat',
      counters: { presents: 9, framesDrawn: 4, lastSeq: 3 }
    })
    expect(parseOverlayMessage('ERR\tunknown-command')).toEqual({
      kind: 'error',
      reason: 'unknown-command'
    })
  })

  it('tolerates a CRLF ending and a line it has never heard of', () => {
    expect(parseOverlayMessage('PONG\r')).toEqual({ kind: 'pong' })
    // Not an error: a later plugin may say more than this launcher understands.
    expect(parseOverlayMessage('FUTURE\tthing')).toEqual({ kind: 'unknown', line: 'FUTURE\tthing' })
    expect(parseOverlayMessage('')).toEqual({ kind: 'unknown', line: '' })
  })

  it('reports numbers it cannot read as zero rather than as NaN', () => {
    expect(parseOverlayMessage('STAT\t\tabc\t2')).toEqual({
      kind: 'stat',
      counters: { presents: 0, framesDrawn: 0, lastSeq: 2 }
    })
    expect(parseOverlayMessage('HELLO\t\t\t\tgarbage')).toEqual({
      kind: 'hello',
      handshake: { protocol: 0, version: '', api: '', width: 0, height: 0 }
    })
  })
})

// ---------------------------------------------------------------------------
// the link's lifecycle
// ---------------------------------------------------------------------------

describe('overlay link', () => {
  it('is unavailable until a handshake arrives, and available after one', async () => {
    const { link, socket } = makeLink()
    expect(link.available).toBe(false)

    const pending = link.connect(100)
    socket.receive(HELLO)
    const handshake = await pending

    expect(handshake?.api).toBe('d3d9')
    expect(link.available).toBe(true)
  })

  it('reassembles a handshake split across two chunks', async () => {
    const { link, socket } = makeLink()
    const pending = link.connect(100)
    socket.receive('HELLO\t1\t0.1.0\td3d9')
    socket.receive('\t640x480\n')

    expect((await pending)?.height).toBe(480)
  })

  it('refuses a plugin speaking another protocol rather than guessing at its framing', async () => {
    const { link, socket } = makeLink()
    const pending = link.connect(100)
    socket.receive(`HELLO\t${String(OVERLAY_PROTOCOL_VERSION + 1)}\t9.9.9\td3d11\t1x1\n`)

    expect(await pending).toBeNull()
    expect(link.available).toBe(false)
  })

  it('gives up when nothing answers, which is what a plugin that never loaded looks like', async () => {
    const { link } = makeLink({ handshakeTimeoutMs: 20 })
    expect(await link.connect(100)).toBeNull()
    expect(link.available).toBe(false)
  })

  it('reports unavailable after the pipe breaks, without throwing', async () => {
    const { link, socket } = makeLink()
    const pending = link.connect(100)
    socket.receive(HELLO)
    await pending

    socket.emitError(new Error('EPIPE'))
    expect(link.available).toBe(false)
    // And every later call is a plain false/null rather than a rejection.
    expect(await link.show({ id: 'a', name: 'b', desc: '' })).toBe(false)
    expect(await link.stat()).toBeNull()
  })

  it('rejects a process id that cannot name a pipe', async () => {
    const { link } = makeLink()
    expect(await link.connect(0)).toBeNull()
    expect(await link.connect(1.5)).toBeNull()
  })
})

describe('overlay link delivery', () => {
  async function connected(): Promise<{ link: ReturnType<typeof createOverlayLink>; socket: FakeSocket }> {
    const made = makeLink({ replyTimeoutMs: 100 })
    const pending = made.link.connect(200)
    made.socket.receive(HELLO)
    await pending
    return made
  }

  it('sends one SHOW and believes the ACK that names its own sequence', async () => {
    const { link, socket } = await connected()

    const pending = link.show({ id: 're1_001', name: 'A Member', desc: 'Jill' })
    expect(socket.written.at(-1)).toBe('SHOW\t1\tre1_001\tA Member\tJill\n')
    socket.receive('ACK\t1\n')

    expect(await pending).toBe(true)
  })

  it('does not accept an ACK for somebody else\u2019s sequence', async () => {
    const { link, socket } = await connected()

    const pending = link.show({ id: 'a', name: 'b', desc: '' })
    socket.receive('ACK\t99\n')   // a stale or foreign ack

    // It has to time out rather than report a delivery that never happened.
    expect(await pending).toBe(false)
  })

  it('reports a refused toast as not shown', async () => {
    const { link, socket } = await connected()

    const pending = link.show({ id: 'a', name: 'b', desc: '' })
    socket.receive('ERR\tshow-needs-5-fields\n')

    expect(await pending).toBe(false)
  })

  it('numbers successive toasts so a dropped reply cannot be mistaken for the next one', async () => {
    const { link, socket } = await connected()

    const first = link.show({ id: 'a', name: 'b', desc: '' })
    socket.receive('ACK\t1\n')
    await first

    const second = link.show({ id: 'c', name: 'd', desc: '' })
    socket.receive('ACK\t2\n')
    await second

    expect(socket.written.filter((line) => line.startsWith('SHOW'))).toHaveLength(2)
    expect(await link.stat()).toBeNull()   // no STAT reply was sent, so this is a timeout
  })

  it('reads the counters, which are the difference between drawing and doing nothing', async () => {
    const { link, socket } = await connected()

    const pending = link.stat()
    expect(socket.written.at(-1)).toBe('STAT\n')
    socket.receive('STAT\t120\t3\t2\n')

    expect(await pending).toEqual({ presents: 120, framesDrawn: 3, lastSeq: 2 })
  })

  it('refuses to send before a handshake, rather than writing into nothing', async () => {
    const { link, socket } = makeLink()
    expect(await link.show({ id: 'a', name: 'b', desc: '' })).toBe(false)
    expect(socket.written).toEqual([])
  })

  it('drops a link that floods the buffer instead of growing without bound', async () => {
    const { link, socket } = makeLink()
    const pending = link.connect(100)
    socket.receive(HELLO)
    await pending

    // 9 KiB with no newline: not this protocol, so the link gives up rather than buffering it.
    socket.receive('x'.repeat(9000))
    expect(link.available).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// the real pipe, the real plugin
// ---------------------------------------------------------------------------

const hostPath = resolve(process.cwd(), 'native/testhost/overlay-testhost.exe')
const pluginPath = resolve(process.cwd(), 'resources/re_classic_overlay.asi')
const nativeBuilt = existsSync(hostPath) && existsSync(pluginPath)

it.skipIf(!nativeBuilt || process.platform !== 'win32')('captures the actual D3D9 frame only when explicitly enabled', async () => {
  const child = spawn(hostPath, ['--plugin', pluginPath, '--seconds', '5', '--d3d9', '--frames', '120'], {
    windowsHide: true, env: { ...process.env, RE_GAME_FRAME_CAPTURE: '1' }
  })
  try {
    const file = join(tmpdir(), 're-classic-overlay', `capture-${child.pid}-0.bgra`)
    await expect.poll(() => existsSync(file), { timeout: 10000 }).toBe(true)
    const frame = readFileSync(file)
    const width = frame.readInt32LE(0), height = frame.readInt32LE(4)
    expect(width).toBeGreaterThan(0)
    expect(height).toBeGreaterThan(0)
    expect(frame.length).toBe(8 + width * height * 4)
    expect(frame[11]).toBe(255)
  } finally { child.kill() }
}, 15000)

/**
 * Collects a host's stdout once and lets tests wait on it by polling.
 *
 * A listener-per-wait would race: a line printed between one wait resolving and the next being
 * registered is simply missed, and the test then fails on a timeout for something that did
 * happen. One accumulating buffer removes the ordering question entirely.
 */
interface HostOutput {
  readonly text: string
  waitFor(match: RegExp, timeoutMs: number): Promise<string>
}

function collect(child: ChildProcessWithoutNullStreams): HostOutput {
  let text = ''
  child.stdout.on('data', (chunk: Buffer) => {
    text += chunk.toString('utf8')
  })
  child.on('exit', (code) => {
    text += `\n[host exited with code ${String(code)}]\n`
  })

  return {
    get text() {
      return text
    },
    async waitFor(match: RegExp, timeoutMs: number): Promise<string> {
      const deadline = Date.now() + timeoutMs
      for (;;) {
        const line = text.split(/\r?\n/).find((candidate) => match.test(candidate))
        if (line !== undefined) return line
        if (Date.now() > deadline) {
          throw new Error(`the test host never printed ${String(match)}; it said:\n${text}`)
        }
        await new Promise((resolve) => setTimeout(resolve, 50))
      }
    }
  }
}

/** Connects to a host's plugin, retrying: the pipe is created on the plugin's own thread. */
async function attach(
  processId: number
): Promise<ReturnType<typeof createOverlayLink>> {
  const link = createOverlayLink({ handshakeTimeoutMs: 3000, replyTimeoutMs: 3000 })
  let handshake = null
  for (let attempt = 0; attempt < 30 && handshake === null; attempt += 1) {
    handshake = await link.connect(processId)
    if (handshake === null) await new Promise((resolve) => setTimeout(resolve, 100))
  }
  if (handshake === null) throw new Error(`the plugin for pid ${String(processId)} never answered`)
  return link
}

/** The design's gold, which the eyebrow, the glyph and the underline are all drawn in. */
const GOLD = { r: 0xd4, g: 0xaf, b: 0x37 }

interface CapturedCard {
  width: number
  height: number
  goldPixels: number
  opaquePlate: number
  brightest: number
}

/**
 * Reads a card the plugin captured as raw premultiplied BGRA (see `overlay_bitmap_capture`).
 *
 * Written and read this way on purpose: the plugin has no image encoder, and Node has no decoder for
 * one without a dependency. An 8-byte header plus the pixels means the *test* measures the colours
 * rather than asking the plugin to report a number about itself.
 */
function readCapture(processId: number, seq: number): CapturedCard {
  const path = join(tmpdir(), 're-classic-overlay', `capture-${String(processId)}-${String(seq)}.bgra`)
  const raw = readFileSync(path)
  const width = raw.readInt32LE(0)
  const height = raw.readInt32LE(4)

  let goldPixels = 0
  let opaquePlate = 0
  let brightest = 0
  for (let offset = 8; offset + 3 < raw.length; offset += 4) {
    const b = raw[offset] ?? 0
    const g = raw[offset + 1] ?? 0
    const r = raw[offset + 2] ?? 0
    const a = raw[offset + 3] ?? 0
    if (a > 200 && Math.abs(r - 0x1a) < 12 && Math.abs(g - 0x1a) < 12 && Math.abs(b - 0x1a) < 12) {
      opaquePlate += 1
    }
    // Premultiplied, so an opaque gold pixel arrives as gold; a translucent one is darker by design.
    if (Math.abs(r - GOLD.r) < 40 && Math.abs(g - GOLD.g) < 40 && Math.abs(b - GOLD.b) < 50 && a > 120) {
      goldPixels += 1
    }
    const luminance = 0.114 * b + 0.587 * g + 0.299 * r
    if (luminance > brightest) brightest = luminance
  }

  return { width, height, goldPixels, opaquePlate, brightest }
}

const suite = nativeBuilt ? describe : describe.skip

suite('over the real pipe (native plugin + test host)', () => {
  it('handshakes, takes a toast and reports its counters', async () => {
    const child = spawn(hostPath, ['--plugin', pluginPath, '--seconds', '10', '--window'], {
      windowsHide: true
    }) as ChildProcessWithoutNullStreams

    try {
      const output = collect(child)
      const pidLine = await output.waitFor(/^testhost pid=/, 10_000)
      const processId = Number(pidLine.replace('testhost pid=', ''))
      expect(Number.isInteger(processId)).toBe(true)

      const windowLine = await output.waitFor(/^testhost window=/, 10_000)
      const windowMatch = /window=(\d+)x(\d+) visible=(\d)/.exec(windowLine)
      expect(windowMatch, `the host reported its window: ${windowLine}`).not.toBeNull()
      const windowSize = [windowMatch?.[1] ?? '', windowMatch?.[2] ?? '']
      // A hidden host window would make the size assertions below meaningless rather than
      // failing, so visibility is asserted where it is reported.
      expect(windowMatch?.[3], 'the host window is visible').toBe('1')
      await output.waitFor(/^testhost plugin=loaded/, 10_000)

      const link = await attach(processId)
      const handshake = link.handshake

      expect(handshake?.protocol).toBe(OVERLAY_PROTOCOL_VERSION)
      // The plugin patches Direct3D 9 unconditionally, because every one of the three titles has
      // d3d9.dll in its measured chain (docs/ARCHITECTURE.md §12.2). This string is the evidence
      // that it got that far, and it is what the launcher logs.
      expect(handshake?.api).toBe('d3d9')
      // The size the plugin found is the host's real client area, so the two agree.
      expect(`${String(handshake?.width)}x${String(handshake?.height)}`).toBe(
        `${windowSize[0] ?? ''}x${windowSize[1] ?? ''}`
      )

      const shown = await link.show({
        id: 're1_001',
        name: 'A Member of S.T.A.R.S.',
        desc: 'Complete the game as Jill on Standard'
      })
      expect(shown, 'the plugin acknowledged the toast').toBe(true)

      const counters = await link.stat()
      expect(counters?.lastSeq, 'the slot holds the toast it was just sent').toBe(1)
      // This host created no device, so nothing has presented: the counter says so rather than
      // being absent, which is what makes it usable as evidence.
      expect(counters?.presents).toBe(0)
      expect(counters?.framesDrawn).toBe(0)

      link.close()
    } finally {
      child.kill()
    }
  }, 30_000)

  /**
   * The hook's own proof, and the reason the test host exists.
   *
   * A real `IDirect3DDevice9` presents real frames through the patched vtable, and the plugin's
   * counter - read over the pipe - is what says so. The plugin's log is not the evidence; a log
   * line saying "patched" would be written by a patch that never fired.
   */
  it('counts present calls that arrive through the patched vtable', async () => {
    const frames = 12
    const child = spawn(
      hostPath,
      ['--plugin', pluginPath, '--seconds', '8', '--d3d9', '--frames', String(frames)],
      { windowsHide: true }
    ) as ChildProcessWithoutNullStreams

    try {
      const output = collect(child)
      const pidLine = await output.waitFor(/^testhost pid=/, 10_000)
      const processId = Number(pidLine.replace('testhost pid=', ''))
      await output.waitFor(/^testhost plugin=loaded/, 10_000)

      const link = await attach(processId)
      expect(link.handshake?.api).toBe('d3d9')

      const presented = await output.waitFor(/^testhost d3d9\.presented=/, 30_000)
      // The host's own count: every frame it asked for was presented successfully, which is only
      // possible if the chain through the saved original works.
      expect(presented).toBe(`testhost d3d9.presented=${String(frames)} of ${String(frames)}`)

      const counters = await link.stat()
      expect(
        counters?.presents,
        'the hook saw every present the host made, plus the two throwaway devices it created'
      ).toBeGreaterThanOrEqual(frames)
      // Still nothing drawn: Phase 2 proves the call arrives, Phase 3 draws into it.
      expect(counters?.framesDrawn).toBe(0)

      link.close()
    } finally {
      child.kill()
    }
  }, 40_000)

  /**
   * The drawing itself, measured.
   *
   * The plugin is asked to capture the card it composed (`RE_OVERLAY_CAPTURE=1`), and this test reads
   * those pixels and looks for the design's gold. That is deliberately *not* the plugin reporting a
   * number about its own work: the card is a file, and the count comes from code that has no stake in
   * the answer. The counter in `STAT` is checked too, so "the card exists" and "a frame was drawn"
   * are both established rather than one standing in for the other.
   */
  it('draws a toast that arrives long before the game can present anything', async () => {
    /*
     * THE DEFECT THIS PINS, and the six-second delay is what makes it discriminating rather than decorative.
     *
     * The launcher's OBSERVED unlock is sent at SPAWN - what it celebrates is the player choosing to launch
     * that row - and RE3 then spends about 1.8 minutes initialising Classic REbirth and playing its intro
     * before it presents anything. The plugin used to start a toast's clock when the `SHOW` ARRIVED and drop it
     * after `TOAST_TOTAL_MS` (the design's 300 + 3200 + 300 = 3800 ms), so that toast was discarded unseen
     * every time: the observed producer was silent in the only path a player takes, while this suite said
     * everything was fine because the host presents immediately.
     *
     * `--delay` postpones the host's first Present past that total, so a clock stamped at arrival dies before a
     * frame exists and `framesDrawn` stays 0. It did: this assertion failed for its whole deadline when the
     * stamp was at arrival, and passes in about seven seconds now that `overlay_toast_snapshot` starts it on
     * the first frame that can draw it.
     */
    const child = spawn(
      hostPath,
      ['--plugin', pluginPath, '--seconds', '16', '--d3d9', '--frames', '400', '--delay', '6000'],
      { windowsHide: true }
    ) as ChildProcessWithoutNullStreams

    try {
      const output = collect(child)
      const pidLine = await output.waitFor(/^testhost pid=/, 10_000)
      const processId = Number(pidLine.replace('testhost pid=', ''))
      await output.waitFor(/^testhost plugin=loaded/, 10_000)

      const link = await attach(processId)
      // Sent at once, while the host is still six seconds away from presenting anything at all.
      const shown = await link.show({
        id: 'late_001',
        name: 'Sent before any frame',
        desc: 'The clock waits for one'
      })
      expect(shown).toBe(true)

      let counters = await link.stat()
      const deadline = Date.now() + 20_000
      while ((counters?.framesDrawn ?? 0) === 0 && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 200))
        counters = await link.stat()
      }
      expect(
        counters?.framesDrawn ?? 0,
        'a toast sent six seconds before the first frame was still drawn'
      ).toBeGreaterThan(0)
    } finally {
      child.kill()
    }
  })

  it('draws the toast, and the composed card holds the design\u2019s colours', async () => {
    const child = spawn(
      hostPath,
      ['--plugin', pluginPath, '--seconds', '12', '--d3d9', '--frames', '400'],
      {
        windowsHide: true,
        env: { ...process.env, RE_OVERLAY_CAPTURE: '1' }
      }
    ) as ChildProcessWithoutNullStreams

    try {
      const output = collect(child)
      const pidLine = await output.waitFor(/^testhost pid=/, 10_000)
      const processId = Number(pidLine.replace('testhost pid=', ''))
      await output.waitFor(/^testhost plugin=loaded/, 10_000)

      const link = await attach(processId)
      const shown = await link.show({
        id: 're1_001',
        name: 'A Member of S.T.A.R.S.',
        desc: 'Complete the game as Jill on Standard'
      })
      expect(shown).toBe(true)

      // Frames are drawn while the host presents, which it does for the whole `--seconds` window.
      let counters = await link.stat()
      const deadline = Date.now() + 15_000
      while ((counters?.framesDrawn ?? 0) === 0 && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 200))
        counters = await link.stat()
      }
      expect(counters?.framesDrawn ?? 0, 'frames were drawn with the toast in them').toBeGreaterThan(0)

      const card = readCapture(processId, 1)
      // 420 authored pixels wide, floored at half scale for a 640-wide back buffer (the floor is
      // documented in toast-render.cpp; RE2 and RE3 both present at 640x480).
      expect(card.width, 'the card is the design width at the floor scale').toBe(210)
      expect(card.height, 'the card is taller than a bare plate').toBeGreaterThan(40)

      // The plate, the eyebrow/glyph/underline in gold: the three things that make it *this* toast
      // rather than a rectangle.
      expect(card.opaquePlate, 'the plate is opaque #1a1a1a').toBeGreaterThan(1000)
      expect(card.goldPixels, 'the gold eyebrow, glyph and underline are present').toBeGreaterThan(100)
      expect(card.brightest, 'the name is drawn in white').toBeGreaterThan(200)

      link.close()
    } finally {
      child.kill()
    }
  }, 40_000)
})

it('cancels retry delay on stop and ignores an old socket after replacement', async () => {
  vi.useFakeTimers()
  try {
    const sockets: FakeSocket[] = []
    const link = createOverlayLink({ connector: () => { const socket = new FakeSocket(); sockets.push(socket); return socket } })
    const first = link.connect(1)
    sockets[0].emitError(new Error('ENOENT'))
    await vi.advanceTimersByTimeAsync(0)
    link.close()
    await expect(first).resolves.toBeNull()
    const next = link.connect(2)
    sockets[1].receive(HELLO)
    await next
    sockets[0].emitError(new Error('late close'))
    expect(link.available).toBe(true)
    link.close()
    await vi.advanceTimersByTimeAsync(10000)
    expect(sockets).toHaveLength(2)
  } finally { vi.useRealTimers() }
})
