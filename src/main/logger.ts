/**
 * Launcher logger.
 *
 * Deliberately dependency-free (no `electron-log`): the whole job is one
 * timestamped line to a stream plus one append to a file. The line shape follows
 * the removed `src/core/log.cpp`, which wrote
 * `[YYYY-MM-DD HH:MM:SS] [WARN] message` to stdout and to a file and flushed
 * every line, so excerpts from old and new logs read the same way.
 *
 * Two deliberate changes from the legacy logger:
 *  - it writes into Electron's `userData` instead of beside the executable (see
 *    `paths.ts` for why), and
 *  - it never terminates the process on error: the legacy `Log::Error` showed a
 *    message box and called `std::exit(1)`, whereas here an error is recorded
 *    and reported by the renderer's error dialog using `tail()`.
 *
 * Implements the frozen `Logger` / `log` / `logFilePath` declarations from
 * `src/main/contracts.ts`.
 */
import { appendFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

import type { Logger, LogLevel, MainPaths } from './contracts'
import { getMainPaths } from './paths'

/** Lines retained in memory for the error dialog; `tail()` defaults to all of them. */
const RING_SIZE = 200

/** Log file inside `configDir`. The legacy file was `re-launcher.log`. */
const LOG_FILE_NAME = 're-log.txt'

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 }

/**
 * Legacy prefixes are kept verbatim (`[DBG] `, `[WARN] `) and `info` stays
 * unprefixed, matching `Log::Printf`. `error` gains a tag because, unlike the
 * legacy fatal error, it is no longer the last line in the file.
 */
const LEVEL_PREFIX: Record<LogLevel, string> = {
  debug: '[DBG] ',
  info: '',
  warn: '[WARN] ',
  error: '[ERROR] '
}

/** Oldest line first; `pushRing` keeps it at `RING_SIZE`. */
const ring: string[] = []

/** Resolved once; null while unresolved or when the paths could not be read. */
let cachedPaths: MainPaths | null = null
/** Null until the log file has been opened successfully. */
let filePath: string | null = null
/** Reason the last open/append attempt failed, for the one-time notice. */
let fileFailure: string | null = null
/** The notice itself is emitted once per run, not once per failed line. */
let failureReported = false
/** Level threshold from `RE_LOG_LEVEL`/packaging, resolved on first write. */
let cachedMinLevel: number | null = null

/** `MainPaths` for logging, or null when they cannot be resolved at all. */
function mainPaths(): MainPaths | null {
  if (cachedPaths === null) {
    try {
      cachedPaths = getMainPaths()
    } catch {
      return null
    }
  }
  return cachedPaths
}

/** `debug|info|warn|error`, or null for an unset/unrecognised value. */
function parseLevel(value: string | undefined): number | null {
  if (value === undefined) {
    return null
  }
  const normalized = value.trim().toLowerCase()
  return normalized === 'debug' || normalized === 'info' || normalized === 'warn' || normalized === 'error'
    ? LEVEL_ORDER[normalized]
    : null
}

/**
 * Minimum level to emit.
 *
 * The legacy `DPrintf` compiled debug lines out of release builds unless
 * `RE_FORCE_DEBUG_LOG` was defined; `RE_LOG_LEVEL` plays that role here, and the
 * packaged/unpackaged split is the same NDEBUG gate. Resolved lazily because the
 * first log call may happen before the app is ready.
 */
function minLevel(): number {
  if (cachedMinLevel !== null) {
    return cachedMinLevel
  }
  const override = parseLevel(process.env.RE_LOG_LEVEL)
  if (override !== null) {
    cachedMinLevel = override
    return cachedMinLevel
  }
  cachedMinLevel = mainPaths()?.isPackaged === true ? LEVEL_ORDER.info : LEVEL_ORDER.debug
  return cachedMinLevel
}

/** Local `YYYY-MM-DD HH:MM:SS`, the format the legacy `strftime` call produced. */
function timestamp(date: Date): string {
  const pad = (value: number): string => String(value).padStart(2, '0')
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    ` ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  )
}

/** Renders `meta` without ever throwing on a circular or hostile value. */
function describeMeta(meta: unknown): string {
  if (meta instanceof Error) {
    return meta.stack ?? `${meta.name}: ${meta.message}`
  }
  if (typeof meta === 'string') {
    return meta
  }
  try {
    return JSON.stringify(meta) ?? String(meta)
  } catch {
    // Circular structures and objects with a throwing `toJSON`/`toString` must
    // not turn a log call into a crash.
    return '[unserialisable meta]'
  }
}

function format(level: LogLevel, message: string, meta?: unknown): string {
  const suffix = meta === undefined ? '' : ` ${describeMeta(meta)}`
  return `[${timestamp(new Date())}] ${LEVEL_PREFIX[level]}${message}${suffix}`
}

function pushRing(line: string): void {
  ring.push(line)
  if (ring.length > RING_SIZE) {
    ring.splice(0, ring.length - RING_SIZE)
  }
}

/** Message of a thrown value, without trusting it to be an `Error`. */
function describeThrown(error: unknown): string {
  try {
    return error instanceof Error ? error.message : String(error)
  } catch {
    return 'unknown error'
  }
}

/**
 * Opens (creating if needed) the log file.
 *
 * Returns null when the directory or file cannot be used; the caller then
 * carries on with stdout only. Failure is not latched, because a locked or
 * briefly unwritable `re-log.txt` (an antivirus scan, a roaming-profile hiccup)
 * should not cost the whole session its log file. The session banner mirrors
 * `Log::Init`, so a tail shown in the error dialog can be attributed to one run.
 */
function ensureFile(): string | null {
  if (filePath !== null) {
    return filePath
  }

  const paths = mainPaths()
  if (paths === null) {
    fileFailure = 'app paths unavailable'
    return null
  }

  try {
    // The legacy `Paths::EnsureDirTree` did the equivalent before opening.
    mkdirSync(paths.configDir, { recursive: true })
    const target = logFilePath(paths)
    appendFileSync(target, `${format('info', '--- Log session start ---')}\n`, 'utf8')
    fileFailure = null
    filePath = target
  } catch (error) {
    fileFailure = describeThrown(error)
  }
  return filePath
}

/**
 * Reports an unusable log file once per run, straight to stderr rather than
 * through the ring buffer that feeds the error dialog: a failing sink must not
 * be able to feed itself, and the user needs to know why the file is empty.
 */
function reportFileFailure(): void {
  if (failureReported) {
    return
  }
  failureReported = true
  try {
    process.stderr.write(
      `[logger] file logging unavailable (${fileFailure ?? 'unknown error'}); continuing on stdout\n`
    )
  } catch {
    // stderr is gone too; nothing left to report to.
  }
}

/** Appends one already-formatted line; swallows every filesystem failure. */
function appendToFile(line: string): void {
  const target = ensureFile()
  if (target === null) {
    reportFileFailure()
    return
  }
  try {
    appendFileSync(target, `${line}\n`, 'utf8')
  } catch (error) {
    // `filePath` is kept so the next line retries; only the notice is one-shot.
    fileFailure = describeThrown(error)
    reportFileFailure()
  }
}

function write(level: LogLevel, message: string, meta?: unknown): void {
  if (LEVEL_ORDER[level] < minLevel()) {
    return
  }

  const line = format(level, message, meta)
  pushRing(line)

  // Errors go to stderr (as in the legacy `Log::Error`), everything else to
  // stdout (as in `Log::WriteLineV`).
  const sink = level === 'error' ? process.stderr : process.stdout
  try {
    sink.write(`${line}\n`)
  } catch {
    // A closed stdout during shutdown must not break the caller; the ring buffer
    // and the log file still have the line.
  }

  appendToFile(line)
}

/** Path of the log file inside `paths.configDir`. */
export function logFilePath(paths: MainPaths): string {
  return join(paths.configDir, LOG_FILE_NAME)
}

export const log: Logger = {
  debug: (message, meta) => write('debug', message, meta),
  info: (message, meta) => write('info', message, meta),
  warn: (message, meta) => write('warn', message, meta),
  error: (message, meta) => write('error', message, meta),

  /**
   * Last `lines` buffered lines, oldest first. Defaults to the whole buffer
   * (`RING_SIZE`), because the only caller is the error dialog, which wants as
   * much context as was kept. Invalid counts yield an empty array rather than a
   * surprising slice, and the returned array is a copy so no caller can mutate
   * the buffer.
   */
  tail: (lines = RING_SIZE) => {
    if (!Number.isFinite(lines) || lines <= 0) {
      return []
    }
    const count = Math.min(Math.floor(lines), RING_SIZE)
    return ring.slice(Math.max(0, ring.length - count))
  }
}
