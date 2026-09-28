/**
 * Putting the game's window where the launcher wants it.
 *
 * The launcher cannot show the game *inside* itself: `tools/probe-embed3.ps1` measured that the window
 * accepts `SetParent` and then the wrapper stops presenting into it - two frames three seconds apart,
 * identical, with the host's own paint still behind them. So this is the other route, and the one that
 * survives that measurement: the game keeps its own top-level window, and this moves that window
 * exactly onto the rectangle the design's gameplay card occupies on screen, so the launcher's chrome
 * sits around it. Nothing is reparented, so no swapchain has to tolerate a new parent.
 *
 * The Win32 half lives in `resources/window-host.ps1`, shipped beside the executable, for the same
 * reason the GOG detector shells out to `reg query`: this project ships no native modules, so nothing
 * has to be rebuilt per Electron or Node ABI. This module owns the *launcher's* half of that contract -
 * finding the script, running it, and turning its single JSON line into something typed - and it is
 * deliberately the only place that knows the helper exists.
 *
 * Its failures are all the same failure, on purpose: if the script cannot be found, cannot be run, or
 * answers with something unrecognisable, the result is "nothing was found" and the launcher carries on
 * with the game as an ordinary window. A launcher that refused to run a game because it could not move
 * its window would be worse than one that shows it slightly in the wrong place.
 */
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { log } from './logger'

/** A screen rectangle in physical pixels, as the display's coordinate space describes it. */
export interface ScreenRect {
  x: number
  y: number
  width: number
  height: number
}

export interface PositionRequest {
  processId: number
  rect: ScreenRect
  /**
   * Keep the game in the taskbar and in alt-tab.
   *
   * Off by default: with it off the window is given `WS_EX_TOOLWINDOW`, so the game reads as part of
   * the launcher rather than as a second application competing with it. `release` puts the bit back
   * whether or not this was set, because a window nobody can alt-tab to is a worse failure than a
   * stray taskbar entry.
   */
  taskbar?: boolean
}

/** What the helper reported about one window. */
export interface HostedWindow {
  handle: string
  class: string
  title: string
  /** The client size after positioning, which is what the caller asked for. */
  clientWidth: number
  clientHeight: number
  windowX: number
  windowY: number
  windowWidth: number
  windowHeight: number
  taskbar: boolean
}

export interface PositionOutcome {
  /** True when a window was found and moved. */
  positioned: boolean
  /** Present when `positioned` is true. */
  window: HostedWindow | null
  /** Why not, when `positioned` is false - for a log line, never for a user-facing error. */
  reason: string
}

/** Runs the helper and returns its stdout, or null when it could not be run at all. */
export type HostScriptRunner = (args: string[]) => Promise<string | null>

export interface HostWindowOptions {
  /** Injected in tests. Defaults to `pwsh -NoProfile -File <script>`. */
  runner?: HostScriptRunner
  /** Injected in tests. Defaults to the shipped script, looked up on disk. */
  scriptPath?: string
}

/**
 * Where the helper lives, in a working tree and in a packaged build.
 *
 * Both are tried rather than chosen by an `isPackaged` flag: the flag says what kind of build this is,
 * while the file's presence says whether the helper is actually there - and `extraFiles` has been the
 * thing that was wrong before.
 */
export function resolveWindowHostScript(override?: string): string | null {
  if (override !== undefined) return override
  const candidates = [
    // Development: straight out of the repository.
    join(process.cwd(), 'resources', 'window-host.ps1'),
    // Packaged: `extraFiles` puts it beside the executable.
    join(dirname(process.execPath), 'window-host.ps1'),
    join(process.execPath, '..', 'window-host.ps1')
  ]
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate
  }
  return null
}

/** The single JSON object the helper prints, or null when the output is not that. */
export function parseHostResult(stdout: string | null): Record<string, unknown> | null {
  if (stdout === null) return null
  for (const line of stdout.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('{')) continue
    try {
      const parsed: unknown = JSON.parse(trimmed)
      if (typeof parsed === 'object' && parsed !== null) return parsed as Record<string, unknown>
    } catch {
      // A line that starts with `{` but is not JSON is not the result; keep looking rather than
      // failing, because PowerShell can print warnings before its own output.
      continue
    }
  }
  return null
}

/** The numbers a `position` call needs, refused when they are not numbers a window can have. */
export function positionArguments(request: PositionRequest, scriptPath: string): string[] | null {
  const { rect } = request
  const values = [rect.x, rect.y, rect.width, rect.height]
  if (!values.every((value) => Number.isFinite(value))) return null
  if (!Number.isInteger(request.processId) || request.processId <= 0) return null
  // A zero-sized target is not a thing to move a window onto, and a negative one is a bug upstream.
  if (rect.width < 32 || rect.height < 32) return null
  return [
    '-NoProfile',
    '-NonInteractive',
    '-File',
    scriptPath,
    '-Action',
    'position',
    '-ProcessId',
    String(request.processId),
    '-X',
    String(Math.round(rect.x)),
    '-Y',
    String(Math.round(rect.y)),
    '-Width',
    String(Math.round(rect.width)),
    '-Height',
    String(Math.round(rect.height)),
    ...(request.taskbar === true ? ['-Taskbar'] : [])
  ]
}

/** The `release` call's arguments: the pid, and nothing else that can be wrong. */
export function releaseArguments(processId: number, scriptPath: string): string[] | null {
  if (!Number.isInteger(processId) || processId <= 0) return null
  return [
    '-NoProfile',
    '-NonInteractive',
    '-File',
    scriptPath,
    '-Action',
    'release',
    '-ProcessId',
    String(processId)
  ]
}

async function defaultRunner(args: string[]): Promise<string | null> {
  return await new Promise<string | null>((resolveResult) => {
    execFile('pwsh', args, { windowsHide: true, timeout: 15_000 }, (error, stdout) => {
      resolveResult(error === null ? stdout : null)
    })
  })
}

/**
 * Moves the game's window so its client area covers `rect`.
 *
 * One attempt, no retry and no throwing: the caller is a launch or a window move, and both happen
 * again soon enough - the watcher asks every couple of seconds, and RE1's loader replaces its window
 * partway through starting, so "not found yet" is an ordinary answer rather than an error.
 */
export async function positionGameWindow(
  request: PositionRequest,
  options: HostWindowOptions = {}
): Promise<PositionOutcome> {
  const scriptPath = resolveWindowHostScript(options.scriptPath)
  if (scriptPath === null) {
    log.warn('window-host.ps1 was not found: the game will run as an ordinary window')
    return { positioned: false, window: null, reason: 'helper-not-found' }
  }

  const args = positionArguments(request, scriptPath)
  if (args === null) return { positioned: false, window: null, reason: 'bad-rectangle' }

  const run = options.runner ?? defaultRunner
  const result = parseHostResult(await run(args))
  if (result === null || result['ok'] !== true) {
    return { positioned: false, window: null, reason: 'helper-failed' }
  }
  if (result['found'] !== true) {
    return { positioned: false, window: null, reason: String(result['reason'] ?? 'no-window') }
  }

  const client = asRecord(result['client'])
  const window = asRecord(result['window'])
  return {
    positioned: true,
    window: {
      handle: String(result['handle'] ?? ''),
      class: String(result['class'] ?? ''),
      title: String(result['title'] ?? ''),
      clientWidth: asNumber(client?.['width']),
      clientHeight: asNumber(client?.['height']),
      windowX: asNumber(window?.['x']),
      windowY: asNumber(window?.['y']),
      windowWidth: asNumber(window?.['width']),
      windowHeight: asNumber(window?.['height']),
      taskbar: result['taskbar'] === true
    },
    reason: ''
  }
}

/**
 * Puts the game's window back the way it was found.
 *
 * Always called on the way out of a positioned launch - a stop, a quit, or the launcher closing - so a
 * player is never left with a frameless window that alt-tab cannot reach.
 */
export async function releaseGameWindow(
  processId: number,
  options: HostWindowOptions = {}
): Promise<boolean> {
  const scriptPath = resolveWindowHostScript(options.scriptPath)
  if (scriptPath === null) return false
  const args = releaseArguments(processId, scriptPath)
  if (args === null) return false
  const run = options.runner ?? defaultRunner
  const result = parseHostResult(await run(args))
  return result !== null && result['ok'] === true
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null
}

function asNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}
