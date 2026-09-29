/**
 * overlay-link.ts — the launcher's end of the in-game overlay's pipe.
 *
 * The plugin owns a named pipe (`\\.\pipe\re-classic-overlay-<pid>`, `native/overlay/pipe.cpp`)
 * and this module is its only client. A named pipe rather than shared memory for one reason
 * that decides the whole design: Electron's main process is Node, and Node cannot create a
 * Windows file mapping without a native module — and this project ships none. `net.connect`
 * reaches a pipe with nothing added to the dependency list, and the pid in the name means a
 * plugin can only ever be reached by the launcher that started it.
 *
 * What this module is for, in order of importance:
 *
 *   1. **Availability.** Nothing else can tell the launcher whether the in-game overlay actually
 *      loaded. The `HELLO` arriving *is* that answer, and it carries which API the plugin hooked
 *      and the size it found — the measurement, not a guess. Until it arrives, the launcher's own
 *      toast is the only toast, exactly as it is today.
 *   2. **Delivery.** One `SHOW` per unlock, answered by `ACK`. The ack is what lets a test assert
 *      the toast was *taken* rather than assert a line was written into a socket.
 *   3. **Evidence.** `STAT` returns the plugin's own counters, which distinguish "drawing" from
 *      "loaded and doing nothing". Those two look identical on screen.
 *
 * Every failure is `null` or `false`, never a throw: an overlay that is missing must leave a
 * working launcher, which is the same rule `host-window.ts` and `retroachievements.ts` follow.
 */
import { connect } from 'node:net'

/** The slice of `net.Socket` this module uses, so tests can drive it without a real pipe. */
export interface OverlaySocket {
  write(text: string): boolean
  end(): void
  destroy(): void
  on(event: 'data', listener: (chunk: Buffer) => void): void
  on(event: 'error', listener: (error: Error) => void): void
  on(event: 'close', listener: () => void): void
  on(event: 'connect', listener: () => void): void
}

export type OverlayConnector = (path: string) => OverlaySocket

/** What the plugin reports about itself on connect. */
export interface OverlayHandshake {
  protocol: number
  version: string
  /** `d3d9`, `d3d11`, or `none` before a hook exists. Logged, and asserted by the live spec. */
  api: string
  width: number
  height: number
}

export interface OverlayCounters {
  presents: number
  framesDrawn: number
  lastSeq: number
}

export type OverlayMessage =
  | { kind: 'hello'; handshake: OverlayHandshake }
  | { kind: 'ack'; seq: number }
  | { kind: 'ok'; what: string }
  | { kind: 'pong' }
  | { kind: 'stat'; counters: OverlayCounters }
  | { kind: 'error'; reason: string }
  /** A line this module does not recognise. Reported, never fatal: a newer plugin may say more. */
  | { kind: 'unknown'; line: string }

/** The protocol version this module speaks; a plugin reporting another is refused. */
export const OVERLAY_PROTOCOL_VERSION = 1

/** Text limits, matching `OVERLAY_*_MAX` in `native/overlay/overlay.h`. */
export const OVERLAY_FIELD_LIMITS = { id: 64, name: 128, desc: 256 } as const

/** `\\.\pipe\re-classic-overlay-<pid>` — the exact name `native/overlay/pipe.cpp` creates. */
export function overlayPipePath(processId: number): string {
  return `\\\\.\\pipe\\re-classic-overlay-${String(processId)}`
}

/**
 * Strips what would break the framing: tabs and newlines are the field and line separators, so
 * a name containing either would corrupt the protocol rather than merely look odd. Control
 * characters in general are flattened too, and the field is cut to the plugin's buffer size —
 * the same limit, on both sides, so neither can write a line the other refuses.
 */
export function sanitizeField(text: string, maxLength: number): string {
  // eslint-disable-next-line no-control-regex -- the control characters are the point here
  const flattened = text.replace(/[\u0000-\u001f\u007f]/g, ' ')
  return flattened.slice(0, maxLength)
}

/** The `SHOW` line for one achievement. */
export function encodeShow(
  seq: number,
  achievement: { id: string; name: string; desc: string }
): string {
  const id = sanitizeField(achievement.id, OVERLAY_FIELD_LIMITS.id)
  const name = sanitizeField(achievement.name, OVERLAY_FIELD_LIMITS.name)
  const desc = sanitizeField(achievement.desc, OVERLAY_FIELD_LIMITS.desc)
  return `SHOW\t${String(seq)}\t${id}\t${name}\t${desc}\n`
}

function toNumber(text: string | undefined): number {
  const value = Number(text ?? '')
  return Number.isFinite(value) ? value : 0
}

/**
 * One protocol line, typed.
 *
 * Deliberately tolerant: an unrecognised line becomes `unknown` rather than an error, because a
 * plugin from a later build may send something this one has never heard of and that must not be
 * mistaken for a broken link.
 */
export function parseOverlayMessage(line: string): OverlayMessage {
  const trimmed = line.replace(/\r$/, '')
  if (trimmed === '') return { kind: 'unknown', line }

  const fields = trimmed.split('\t')
  const command = (fields[0] ?? '').toUpperCase()

  if (command === 'HELLO') {
    const size = (fields[4] ?? '').split('x')
    return {
      kind: 'hello',
      handshake: {
        protocol: toNumber(fields[1]),
        version: fields[2] ?? '',
        api: fields[3] ?? '',
        width: toNumber(size[0]),
        height: toNumber(size[1])
      }
    }
  }

  if (command === 'ACK') return { kind: 'ack', seq: toNumber(fields[1]) }
  if (command === 'OK') return { kind: 'ok', what: fields[1] ?? '' }
  if (command === 'PONG') return { kind: 'pong' }

  if (command === 'STAT') {
    return {
      kind: 'stat',
      counters: {
        presents: toNumber(fields[1]),
        framesDrawn: toNumber(fields[2]),
        lastSeq: toNumber(fields[3])
      }
    }
  }

  if (command === 'ERR') return { kind: 'error', reason: fields[1] ?? '' }

  return { kind: 'unknown', line: trimmed }
}

export interface OverlayLinkOptions {
  startupTimeoutMs?: number
  /** Injected in tests. Defaults to `net.connect({ path })`. */
  connector?: OverlayConnector
  /** How long to wait for `HELLO` after connecting. */
  handshakeTimeoutMs?: number
  /** How long to wait for `ACK`/`STAT` once a line is written. */
  replyTimeoutMs?: number
}

export interface OverlayLink {
  readonly available: boolean
  readonly handshake: OverlayHandshake | null
  /** Connects and waits for the handshake. Resolves null for every kind of failure. */
  connect(processId: number): Promise<OverlayHandshake | null>
  /** Sends one toast and waits for the plugin to take it. */
  show(achievement: { id: string; name: string; desc: string }): Promise<boolean>
  /** The plugin's own counters. */
  stat(): Promise<OverlayCounters | null>
  close(): void
}

/** One outstanding request: a matcher, and the resolver that answers it. */
interface Waiter {
  accept(message: OverlayMessage): boolean
  settle(message: OverlayMessage | null): void
  timer: NodeJS.Timeout
}

  const defaultConnector: OverlayConnector = (path) => connect({ path })

export function createOverlayLink(options: OverlayLinkOptions = {}): OverlayLink {
  const connector = options.connector ?? defaultConnector
  const handshakeTimeoutMs = options.handshakeTimeoutMs ?? 250
  const replyTimeoutMs = options.replyTimeoutMs ?? 500
  const startupTimeoutMs = options.startupTimeoutMs ?? 10_000
  let generation = 0
  let cancelDelay: (() => void) | null = null

  let socket: OverlaySocket | null = null
  let handshake: OverlayHandshake | null = null
  let buffer = ''
  let sequence = 0
  const waiters: Waiter[] = []

  /** Answers the first waiter whose matcher accepts the message and drops the rest' timers. */
  function dispatch(message: OverlayMessage): void {
    for (let index = 0; index < waiters.length; index += 1) {
      const waiter = waiters[index]
      if (waiter === undefined || !waiter.accept(message)) continue
      waiters.splice(index, 1)
      clearTimeout(waiter.timer)
      waiter.settle(message)
      return
    }
  }

  function waitFor(
    accept: (message: OverlayMessage) => boolean,
    timeoutMs: number
  ): Promise<OverlayMessage | null> {
    return new Promise((resolve) => {
      const waiter: Waiter = {
        accept,
        settle: (message) => {
          resolve(message)
        },
        timer: setTimeout(() => {
          const index = waiters.indexOf(waiter)
          if (index >= 0) waiters.splice(index, 1)
          resolve(null)
        }, timeoutMs)
      }
      waiters.push(waiter)
    })
  }

  function fail(): void {
    for (const waiter of waiters.splice(0)) {
      clearTimeout(waiter.timer)
      waiter.settle(null)
    }
    handshake = null
  }

  /** Feeds a chunk through the line buffer; a partial line waits for the rest of itself. */
  function ingest(chunk: Buffer): void {
    buffer += chunk.toString('utf8')
    for (;;) {
      const newline = buffer.indexOf('\n')
      if (newline < 0) break
      const line = buffer.slice(0, newline)
      buffer = buffer.slice(newline + 1)
      if (line.trim() !== '') dispatch(parseOverlayMessage(line))
    }
    /*
     * A plugin that never sends a newline would otherwise grow this buffer without bound. The
     * protocol's longest legal line is well under 1 KiB, so anything larger is a link that is not
     * speaking the protocol and is dropped rather than buffered forever.
     */
    if (buffer.length > 8192) {
      buffer = ''
      fail()
    }
  }

  function write(text: string): boolean {
    if (socket === null) return false
    try {
      return socket.write(text)
    } catch {
      return false
    }
  }

  /**
   * How long to wait for the plugin's pipe to appear before giving up on the link.
   *
   * Retry spacing within the cancellable startup deadline (ten seconds by default).
   */
  const PIPE_WAIT_MS = 100

  const delay = (ms: number): Promise<void> =>
    new Promise((resolve) => {
      const timer = setTimeout(() => { cancelDelay = null; resolve() }, ms)
      cancelDelay = () => { clearTimeout(timer); cancelDelay = null; resolve() }
    })

  async function connectTo(processId: number): Promise<OverlayHandshake | null> {
    close()
    const attemptGeneration = generation
    if (!Number.isInteger(processId) || processId <= 0) return null

    /*
     * RETRY THE ONE FAILURE THAT RETRYING FIXES: nothing listening yet.
     *
     * MEASURED on a real RE1 launch, from the plugin's own log: it attaches at +144 ms and its pipe comes up
     * at +281 ms from process start. The launcher connects the moment the process is spawned, and connecting
     * to a Windows named pipe that is not there yet fails *instantly* with ENOENT rather than waiting - so
     * before this loop every launcher-driven link reported "no handshake" while the plugin was perfectly
     * healthy 280 ms later. The in-game toast therefore never appeared in a real launch; it only ever worked
     * under `tools/probe-overlay.ps1`, which waits for the game's window before connecting and so never met
     * the race.
     *
     * ELAPSED TIME IS THE SIGNAL, and it is the only one that works here: a failed connect returns in about a
     * millisecond, while a plugin that connected and stayed mute burns the whole handshake window. So a fast
     * failure is retried and a slow one is not - a mute plugin is broken, not slow, and retrying it would only
     * delay the launcher's own toast by the retry budget to reach the same answer. (A filesystem check cannot
     * be used for this: `fs.existsSync` reports false for a named pipe that exists. That was this fix's first
     * attempt, and the real-pipe tests caught it.)
     */
    const path = overlayPipePath(processId)
    const deadline = performance.now() + startupTimeoutMs
    while (generation === attemptGeneration && performance.now() < deadline) {
      const startedAt = Date.now()
      const pending = waitFor((message) => message.kind === 'hello', Math.min(handshakeTimeoutMs, deadline - performance.now()))

      try {
        socket = connector(path)
      } catch {
        socket = null
        fail()
        return null
      }

      const attemptSocket = socket
      socket.on('data', (chunk) => { if (socket === attemptSocket) ingest(chunk) })
      // Every failure mode lands in the same place: no overlay, and the launcher's own toast.
      socket.on('error', () => { if (socket === attemptSocket) fail() })
      socket.on('close', () => { if (socket === attemptSocket) fail() })

      const message = await pending
      if (generation !== attemptGeneration) return null
      if (message !== null && message.kind === 'hello') {
        if (message.handshake.protocol !== OVERLAY_PROTOCOL_VERSION) {
          // A protocol mismatch is refused loudly rather than half-understood: a launcher that guessed at a
          // newer plugin's framing would send it nonsense. It is also not a race, so it does not retry.
          close()
          return null
        }
        handshake = message.handshake
        return handshake
      }

      disconnect()
      if (Date.now() - startedAt >= handshakeTimeoutMs) return null
      await delay(Math.max(0, Math.min(PIPE_WAIT_MS, deadline - performance.now())))
    }

    return null
  }

  function close(): void {
    generation += 1
    cancelDelay?.()
    disconnect()
  }

  function disconnect(): void {
    fail()
    const current = socket
    socket = null
    if (current === null) return
    try {
      current.destroy()
    } catch {
      // Already gone; nothing to close.
    }
  }

  async function show(achievement: { id: string; name: string; desc: string }): Promise<boolean> {
    if (socket === null || handshake === null) return false

    sequence += 1
    const seq = sequence
    const pending = waitFor(
      (message) => (message.kind === 'ack' && message.seq === seq) || message.kind === 'error',
      replyTimeoutMs
    )

    if (!write(encodeShow(seq, achievement))) {
      fail()
      return false
    }

    const message = await pending
    return message !== null && message.kind === 'ack'
  }

  async function stat(): Promise<OverlayCounters | null> {
    if (socket === null || handshake === null) return null

    const pending = waitFor((message) => message.kind === 'stat', replyTimeoutMs)
    if (!write('STAT\n')) {
      fail()
      return null
    }

    const message = await pending
    return message !== null && message.kind === 'stat' ? message.counters : null
  }

  return {
    get available() {
      return socket !== null && handshake !== null
    },
    get handshake() {
      return handshake
    },
    connect: connectTo,
    show,
    stat,
    close
  }
}
