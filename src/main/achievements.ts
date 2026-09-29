/**
 * Achievement definitions and progress persistence for the main process.
 *
 * Behavioural reference: the removed `src/achievements/achievement_db.cpp`.
 * The definition-file shape, the `id=1|<date>` save format (byte for byte) and
 * the "only ids we know about are applied" rule are all carried over, because
 * saves written by the old launcher must still be readable and vice versa.
 *
 * Two things deliberately differ from the C++ version:
 *  - the save lives in the per-user config directory (`options.progressPath`)
 *    instead of next to the executable, because `Program Files` is not
 *    writable; a legacy save found beside the exe is migrated once,
 *  - definitions can be replaced by loose files next to the executable, which
 *    is why the bundled JSON is only the baseline.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

import type { Achievement, TitleId } from '@shared/types'

import type { AchievementStore, AchievementStoreOptions } from './contracts'
import { readObservedCondition } from './observed-config'
// Static import on purpose: the default catalog is then part of the
// main-process bundle, so the launcher still has achievements when the loose
// `assets/achievements/` copy is missing or unpacked elsewhere.
import bundledDefinitions from '../../assets/achievements/achievements.json'

/**
 * Byte-exact copy of the line the legacy `SaveProgress` wrote before the rows
 * (`achievement_db.cpp`), including the leading `#` that makes it a comment.
 */
const PROGRESS_HEADER = '# Resident Evil Classic Collection - achievement progress'

/** One `id=<flag>|<date>` row of the legacy save. */
type ProgressEntry = { unlocked: boolean; date: string }

/**
 * The C++ code logged through its global logger. This module uses the plain
 * Node `console` instead so the store can be unit tested in a plain Node
 * process without dragging the Electron-adjacent logger into that import graph.
 */
function warn(message: string): void {
  console.warn(`[achievements] ${message}`)
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function snapshot(achievement: Achievement): Achievement {
  return { ...achievement }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** The catalog only ever holds these three titles. */
function isTitleId(value: unknown): value is TitleId {
  return value === 're1' || value === 're2' || value === 're3'
}

/** Absent or non-string cosmetic fields degrade to `''`, as in the legacy parser. */
function readOptionalString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/**
 * Validates a parsed definitions document (`{ "re1": [...], "re2": [...],
 * "re3": [...] }`) and turns it into store rows.
 *
 * Returns null for a document the legacy parser would also have rejected: a
 * non-object root, an unknown game key, a non-array game value, an object
 * without a usable `id`, or a document that yields no achievements at all
 * (legacy `TryLoadJsonFile` bailed on `parsed.empty()` so a truncated override
 * could never wipe the catalog).
 */
function toDefinitions(value: unknown): Achievement[] | null {
  if (!isRecord(value)) return null

  const definitions: Achievement[] = []
  for (const [gameId, rows] of Object.entries(value)) {
    if (!isTitleId(gameId)) return null
    if (!Array.isArray(rows)) return null
    for (const row of rows) {
      if (!isRecord(row)) return null
      const rawId = row['id']
      if (typeof rawId !== 'string' || rawId.trim() === '') return null
      /*
       * `observed` is read here rather than left out, and that matters more than it looks: this mapping names
       * every field it keeps, so a field it does not name is a field the launcher never sees. The definitions
       * would read as observed in the JSON and match nothing at runtime - a feature that looks wired.
       *
       * Spread rather than assigned, so a row with no condition does not carry an explicit `undefined`:
       * `exactOptionalPropertyTypes` treats that as different from absence, and absence is precisely what
       * "not observable" means.
       */
      const observed = readObservedCondition(row['observed'])
      definitions.push({
        id: rawId.trim(),
        gameId,
        name: readOptionalString(row['name']),
        desc: readOptionalString(row['desc']),
        icon: readOptionalString(row['icon']),
        ...(observed === undefined ? {} : { observed }),
        unlocked: false,
        unlockDate: ''
      })
    }
  }

  return definitions.length === 0 ? null : definitions
}

/** Read a definitions override, or null when it is missing or unusable. */
async function readDefinitionsFile(path: string): Promise<Achievement[] | null> {
  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch {
    // Missing is the normal case and an unreadable file must not stop boot:
    // legacy `ReadWholeFile` returned false for every failure alike.
    return null
  }

  // Legacy stripped a UTF-8 BOM before parsing; `JSON.parse` would throw on one.
  const json = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text

  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch (error) {
    warn(`ignoring definitions override ${path}: ${describeError(error)}`)
    return null
  }

  const definitions = toDefinitions(parsed)
  if (definitions === null) {
    warn(`ignoring definitions override ${path}: not a { "re1|re2|re3": [ ... ] } document`)
    return null
  }

  return definitions
}

/**
 * Parses the legacy save format: text, one row per achievement, an optional
 * `#`-prefixed header, `id=1|<iso>` for unlocked and `id=0|` for locked.
 *
 * Rows that are blank, `#`/`;` comments, missing an `=`, missing an id or
 * carrying an unrecognised flag are skipped, which matches `ApplySaveLine`:
 * it returned without touching the row, and `LoadProgress` had already reset
 * every row to locked. Duplicate ids keep the last row, again because the
 * legacy loader applied lines in file order.
 *
 * Unknown-to-the-catalog ids are deliberately NOT filtered here: this function
 * has no definitions to compare against (a user-supplied override may define
 * ids the bundled catalog never had), so the store drops them where the
 * catalog is known.
 */
export function parseProgressFile(contents: string): Map<string, ProgressEntry> {
  const progress = new Map<string, ProgressEntry>()

  for (const rawLine of contents.split('\n')) {
    const line = rawLine.trim()
    if (line === '' || line.startsWith('#') || line.startsWith(';')) continue

    const separator = line.indexOf('=')
    if (separator < 0) continue

    const id = line.slice(0, separator).trim()
    const value = line.slice(separator + 1).trim()
    if (id === '') continue

    const bar = value.indexOf('|')
    const flag = (bar < 0 ? value : value.slice(0, bar)).trim()
    const date = bar < 0 ? '' : value.slice(bar + 1).trim()

    const unlocked = flag === '1' || flag === 'true' || flag === 'yes'
    const locked = flag === '0' || flag === 'false' || flag === 'no'
    // Anything else is malformed and leaves the row locked.
    if (!unlocked && !locked) continue

    if (!unlocked) {
      // A locked row carries no date, exactly like the legacy loader.
      progress.set(id, { unlocked: false, date: '' })
      continue
    }

    // Legacy stamped `CurrentIsoTimestamp()` when an unlocked row had no date,
    // which keeps the "unlocked implies a date" invariant the UI relies on.
    progress.set(id, { unlocked: true, date: date === '' ? new Date().toISOString() : date })
  }

  return progress
}

/**
 * Serialises achievements in the legacy byte format: the header comment, then
 * one row per achievement in list order, each terminated by `\n` (the legacy
 * writer used `fopen(..., "wb")` plus `fprintf`, so never CRLF), with a
 * trailing `|` and empty date for locked rows.
 *
 * Timestamps are `new Date().toISOString()` (UTC, milliseconds, `Z`) rather
 * than the legacy local-time string. That stays compatible in both directions:
 * the old loader stores the date column verbatim, and this parser treats it as
 * opaque text too.
 */
export function serializeProgressFile(achievements: Achievement[]): string {
  const lines: string[] = [PROGRESS_HEADER]
  for (const achievement of achievements) {
    lines.push(
      achievement.unlocked ? `${achievement.id}=1|${achievement.unlockDate}` : `${achievement.id}=0|`
    )
  }
  return `${lines.join('\n')}\n`
}

export function createAchievementStore(options: AchievementStoreOptions): AchievementStore {
  const { progressPath, legacyProgressPath, definitionsPaths } = options

  /** Ordered rows, mirroring the legacy `achievements_` vector. */
  let records: Achievement[] = []
  /** Live views of `records`; a duplicate id keeps the last definition (legacy `RebuildIdIndex`). */
  const byId = new Map<string, Achievement>()
  const listeners = new Set<(achievement: Achievement) => void>()
  let initPromise: Promise<void> | null = null

  async function readTextFile(path: string): Promise<string | null> {
    try {
      return await readFile(path, 'utf8')
    } catch {
      return null
    }
  }

  async function loadDefinitions(): Promise<void> {
    // The bundled catalog is the baseline and every readable override replaces
    // it wholesale: legacy `TryLoadJsonFile` cleared the DB on a successful
    // parse and left the previous contents untouched on a failure, so the last
    // usable file in `definitionsPaths` wins.
    let loaded = toDefinitions(bundledDefinitions) ?? []
    for (const candidate of definitionsPaths) {
      const parsed = await readDefinitionsFile(candidate)
      if (parsed !== null) loaded = parsed
    }

    records = loaded
    byId.clear()
    for (const achievement of records) byId.set(achievement.id, achievement)
  }

  function clearProgress(): void {
    for (const achievement of records) {
      achievement.unlocked = false
      achievement.unlockDate = ''
    }
  }

  function applyProgress(progress: Map<string, ProgressEntry>): void {
    for (const [id, entry] of progress) {
      const achievement = byId.get(id)
      // A save can predate the current catalog, or belong to a different one.
      if (achievement === undefined) continue
      achievement.unlocked = entry.unlocked
      achievement.unlockDate = entry.unlocked ? entry.date : ''
    }
  }

  async function persist(): Promise<void> {
    const contents = serializeProgressFile(records)
    try {
      await mkdir(dirname(progressPath), { recursive: true })
      await writeFile(progressPath, contents, 'utf8')
    } catch (error) {
      // Legacy `SaveProgress` warned and carried on. A read-only profile must
      // not turn an unlock into a rejected IPC call, and the in-memory state
      // stays authoritative for the rest of the session.
      warn(`could not write progress to ${progressPath}: ${describeError(error)}`)
    }
  }

  async function loadProgress(): Promise<void> {
    // Legacy `LoadProgress` reset every row before applying the file, so a save
    // that lost a row can never keep a stale unlock alive.
    clearProgress()

    const current = await readTextFile(progressPath)
    if (current !== null) {
      applyProgress(parseProgressFile(current))
      return
    }

    // First run on this profile: adopt the save the old launcher wrote next to
    // the executable, then write it back in the new location so the migration
    // happens exactly once and existing players keep their unlocks.
    const legacy = await readTextFile(legacyProgressPath)
    if (legacy === null) return
    applyProgress(parseProgressFile(legacy))
    await persist()
  }

  function init(): Promise<void> {
    // Idempotent on purpose: IPC handlers may await init() defensively, and
    // re-reading the file would discard an unlock made in this session whenever
    // the write failed (read-only profile) and there is nothing to reload.
    if (initPromise === null) {
      initPromise = (async () => {
        await loadDefinitions()
        await loadProgress()
      })()
    }
    return initPromise
  }

  function list(gameId: TitleId): Achievement[] {
    return records.filter((achievement) => achievement.gameId === gameId).map(snapshot)
  }

  function all(): Achievement[] {
    return records.map(snapshot)
  }

  function get(id: string): Achievement | null {
    const achievement = byId.get(id)
    return achievement === undefined ? null : snapshot(achievement)
  }

  async function unlock(id: string): Promise<Achievement | null> {
    const achievement = byId.get(id)
    // Legacy `UnlockAchievement`: an unknown id and a repeat unlock are both
    // silent no-ops, and only a real transition may touch disk or listeners.
    if (achievement === undefined || achievement.unlocked) return null

    achievement.unlocked = true
    achievement.unlockDate = new Date().toISOString()
    // Persist before notifying: the toast a listener raises is then always
    // backed by a save on disk, so quitting right after it cannot lose the
    // unlock.
    await persist()

    // Every consumer gets its own copy, so a listener (or the caller) can never
    // reach back into the store through an alias. The listener set is copied
    // too: a listener is allowed to unsubscribe from inside its own callback.
    for (const listener of Array.from(listeners)) listener(snapshot(achievement))
    return snapshot(achievement)
  }

  async function reset(gameId?: TitleId): Promise<Achievement[]> {
    // "Affected" means the whole cleared scope, not just the rows that changed:
    // the reset IPC response is the new list for that scope, so the UI can
    // redraw without a second round trip.
    const scope = gameId === undefined ? records : records.filter((row) => row.gameId === gameId)
    for (const achievement of scope) {
      achievement.unlocked = false
      achievement.unlockDate = ''
    }
    // Persist even when nothing changed: an explicit reset should leave a save
    // on disk that already reflects the cleared state.
    await persist()
    return scope.map(snapshot)
  }

  function onUnlock(listener: (achievement: Achievement) => void): () => void {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  }

  return { init, list, all, get, unlock, reset, onUnlock }
}
