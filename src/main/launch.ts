/**
 * launch — prepares a row for launch, spawns the game and tracks the process.
 *
 * Behavioural reference: the deleted `src/games/game_launcher.cpp` (the single
 * process rule, the executable pick, the install root as cwd) and the confirm
 * path of the deleted `src/ui/screens/screen_launch.cpp` (an unknown install path
 * is refused, the mod is injected, the game is started). Read them with
 * `git show HEAD:src/games/game_launcher.cpp` and
 * `git show HEAD:src/ui/screens/screen_launch.cpp`.
 *
 * Four behaviours are deliberately different from the C++:
 *
 *  - `GameLauncher::Launch` called `KillGame()` first, so confirming a second row
 *    silently killed the running game. This module refuses the second launch with
 *    `game-already-running` instead; killing is only ever explicit (`killGame`).
 *  - The executable is started through an argument array and never through a
 *    shell, so a path holding parentheses (`BIOHAZARD(R) 3 PC.exe`) needs no
 *    quoting; `CreateProcessA` was fed a hand-quoted command line, and
 *    `shell: true` would make `(` a syntax error.
 *  - `[DLL] BootConfig` and `[DLL] JapaneseEnable` are patched into the game's own
 *    `config.ini` before every launch (README "Language / Version Selection" and
 *    "Troubleshooting": `BootConfig=0` is what suppresses the RE-Enhance setup
 *    dialog). The C++ launcher left both to the user. The patch itself lives in
 *    `ini.ts`; this module only decides the two values.
 *  - The install root and the row's install state are not in the static catalog
 *    (`GameVersionSeed` omits `state`, `stateReason` and `hasMod` on purpose) and
 *    the frozen `prepareLaunch(request)` signature takes no dependencies, so the
 *    row is resolved here with the same detector and validator the `catalog-state`
 *    snapshot used — see `resolveLocalInstallContext`. Tests and the IPC layer can
 *    replace that resolution wholesale with `setInstallContextResolver`.
 *
 * No design values appear in this file: nothing here renders, so nothing in
 * `.ref/designref/` bears on it.
 */
import { spawn, spawnSync } from 'node:child_process'
import { stat } from 'node:fs/promises'
import { join } from 'node:path'

import { RE2_SCENARIO_EXEC, findTitle, findVersion } from '@shared/catalog'
import type { GameVersionSeed } from '@shared/catalog'
import type {
  GameExitEvent,
  GameStatus,
  GameVersion,
  InstallState,
  LaunchFailure,
  LaunchMode,
  LaunchRequest,
  LaunchResult,
  Re2Scenario,
  TitleId
} from '@shared/types'

import { createConfigStore } from './config-store'
import type { LaunchDeps, PreparedLaunch } from './contracts'
import { detectInstallPath } from './detect/gog'
import { patchIniFile } from './ini'
import { hasBackup } from './mods'
import { getMainPaths } from './paths'
import { modsAvailable, probeVersion, stateFromProbe } from './validate'

// ---------------------------------------------------------------------------
// constants
// ---------------------------------------------------------------------------

/** The game's own settings file, at the root of the install (every GOG build ships one). */
const CONFIG_INI_NAME = 'config.ini'

/** Section both RE-Enhance keys live in. `ini.ts` takes the bare name, not `[DLL]`. */
const DLL_SECTION = 'DLL'

/** Suppresses the RE-Enhance setup dialog, which would otherwise ask on every boot. */
const BOOT_CONFIG_KEY = 'BootConfig'
const BOOT_CONFIG_OFF = '0'

/** Selects the language file set for the version being launched (README). */
const JAPANESE_ENABLE_KEY = 'JapaneseEnable'
const JAPANESE_ENABLE_ON = '1'
const JAPANESE_ENABLE_OFF = '0'

/**
 * Wording of the legacy error overlay for an unusable install
 * (`screen_launch.cpp`: "Game is not installed or path is unknown.").
 */
const NOT_INSTALLED_MESSAGE = 'Game is not installed or path is unknown.'

/**
 * Reason reported when a title has no readable install root. Worded like the
 * Install Status reasons in `catalog-state.ts`, so the toast a failed launch
 * produces reads the same as the row the user was looking at.
 */
const FOLDER_MISSING_REASON = 'Game folder not found'

// ---------------------------------------------------------------------------
// dependency seams
// ---------------------------------------------------------------------------

/** The two injected functions, read off the frozen `LaunchDeps` type. */
type SpawnFn = NonNullable<LaunchDeps['spawn']>
type PatchConfigFn = NonNullable<LaunchDeps['patchConfig']>

/** What one `spawn` call receives; exactly the frozen option shape. */
type SpawnOptions = Parameters<SpawnFn>[2]

/** What one `spawn` call returns: a pid (when the OS gave one) and an event source. */
type SpawnedProcess = ReturnType<SpawnFn>

/**
 * Real spawn, adapted to the frozen shape.
 *
 * The adapter exists so nothing in this module depends on `ChildProcess`'s
 * generic `EventEmitter.on` overloads, which is what the injected double stands
 * in for: a test only ever needs `pid` and the `exit` / `error` events.
 */
const defaultSpawn: SpawnFn = (executable, args, options) => {
  const child = spawn(executable, args, options)
  return {
    pid: child.pid,
    on: (event, listener) => {
      child.on(event, listener)
    }
  }
}

/**
 * Module-level dependency defaults.
 *
 * `performLaunch` takes its `LaunchDeps` per call, but `prepareLaunch` has no
 * dependency parameter in the frozen contract and still has to patch
 * `config.ini`, so the same bag is kept as a module default. A caller that wants
 * to intercept the config write — or that drives prepare and perform with one
 * injected spawn — registers it once here; a per-call `deps` still wins.
 */
let moduleDeps: LaunchDeps = {}

/** Registers (or clears, with `null`) the module-level dependency defaults. */
export function setLaunchDeps(deps: LaunchDeps | null): void {
  moduleDeps = deps ?? {}
}

// ---------------------------------------------------------------------------
// install context
// ---------------------------------------------------------------------------

/**
 * Everything `prepareLaunch` needs that the static catalog cannot supply: where
 * the title is installed, how complete that install is, and whether the
 * RE-Enhance overlay is on disk for the row.
 */
export interface InstallContext {
  /** Detected install root, `''` when the title was not found. */
  installPath: string
  state: InstallState
  /** Human reason for a non-installed state; `null` when the row is complete. */
  stateReason: string | null
  /** RE-Enhance files are available for this row (the catalog's `hasMod`). */
  hasMod: boolean
  /** RE-Enhance files are already applied to this install (the catalog's `modInstalled`). */
  modInstalled: boolean
}

export type InstallContextResolver = (version: GameVersionSeed) => Promise<InstallContext>

/**
 * Real resolution: detect the title's install root, then probe the row.
 *
 * This repeats what `catalog-state.buildCatalogSnapshot` already did for the
 * snapshot the renderer drew, which is the price of the frozen
 * `prepareLaunch(request)` signature: it takes no dependencies and the snapshot
 * has no shared getter, so the join has to be reachable from here. Detection and
 * probing are the same two functions the snapshot used, so the two cannot
 * disagree about a row.
 *
 * Only the requested title is detected (the snapshot detects all three), which
 * keeps a launch to one `GOG Games/` check plus one registry query.
 */
async function resolveLocalInstallContext(version: GameVersionSeed): Promise<InstallContext> {
  const title = findTitle(version.titleId)
  if (title === undefined) {
    // Unreachable for the static catalog, where every version belongs to a title.
    return { installPath: '', state: 'missing', stateReason: FOLDER_MISSING_REASON, hasMod: false, modInstalled: false }
  }

  const paths = getMainPaths()
  const installPath = await detectInstallPath(
    { id: title.id, gogGameId: title.gogGameId, gogFolderName: title.gogFolderName },
    {
      appDir: paths.appDir,
      gogPathOverride: await readGogPathOverride(paths.configPath, paths.legacyConfigPath),
      platform: process.platform
    }
  )

  if (installPath === '') {
    return { installPath: '', state: 'missing', stateReason: FOLDER_MISSING_REASON, hasMod: false, modInstalled: false }
  }

  // `probeVersion` and `modsAvailable` answer different questions and both are
  // needed: the probe's `modOk` only reports whether a `requiresMod` row's
  // requirement is met, while `hasMod` is "RE-Enhance files exist for this row"
  // (the same pair `catalog-state` computes per version).
  const [probe, hasMod, modInstalled] = await Promise.all([
    probeVersion({
      titleId: version.titleId,
      installPath,
      execRelPath: version.execRelPath,
      requiresMod: version.requiresMod,
      modPath: version.modPath,
      modsDir: paths.modsDir
    }),
    modsAvailable(paths.modsDir, version.modPath),
    hasBackup(installPath)
  ])

  const state = stateFromProbe(probe)
  return {
    installPath,
    state,
    // Only `missing` is ever reported to the user: a launchable row (installed or
    // partial) needs no explanation, and `missing` is always the 0/3 case where
    // the install root itself failed to probe.
    stateReason: state === 'missing' ? FOLDER_MISSING_REASON : null,
    hasMod,
    modInstalled
  }
}

/**
 * The user's explicit GOG root, read through the config store so a launch agrees
 * with the snapshot the renderer drew (`CatalogBuildOptions.config` carries the
 * same value). The store never throws by contract; the guard is defensive so a
 * damaged settings file cannot block a launch, in which case detection falls
 * through to the local `GOG Games/` folder, the registry and the common roots.
 *
 * This reads the *persisted* config. Reusing the store instance the IPC layer
 * already holds would also see a value whose write failed, but that instance is
 * not reachable from the frozen `prepareLaunch(request)` signature, and a failed
 * write means the override was never recorded for the next run either.
 */
async function readGogPathOverride(configPath: string, legacyConfigPath: string): Promise<string> {
  try {
    const store = createConfigStore({ configPath, legacyConfigPath })
    const config = await store.load()
    return config.gogPathOverride
  } catch {
    return ''
  }
}

let resolveInstallContext: InstallContextResolver = resolveLocalInstallContext

/** Replaces (or, with `null`, restores) the install-context resolver. */
export function setInstallContextResolver(resolver: InstallContextResolver | null): void {
  resolveInstallContext = resolver ?? resolveLocalInstallContext
}

// ---------------------------------------------------------------------------
// process tracking
// ---------------------------------------------------------------------------

type ExitListener = (event: GameExitEvent) => void

interface TrackedGame {
  titleId: TitleId
  versionId: string
  /** `0` when the OS (or an injected double) reported no pid. */
  pid: number
  /**
   * `exit` and `error` can both fire for one child (a spawn that failed reports
   * `error`, and a killed process reports `exit`), so the first one wins and the
   * listeners are told exactly once.
   */
  settled: boolean
}

let tracked: TrackedGame | null = null

/**
 * Exit code of the last game that finished. `null` until one does, matching the
 * legacy `GetProcessExitCode`, which reported "invalid" (`g_exitValid = false`)
 * from the moment a launch started until its process was reaped.
 */
let lastExitCode: number | null = null

const exitListeners = new Set<ExitListener>()

// ---------------------------------------------------------------------------
// prepare
// ---------------------------------------------------------------------------

type PrepareOutcome =
  | { ok: true; prepared: PreparedLaunch }
  | { ok: false; code: LaunchFailure; message: string }

function failure(code: LaunchFailure, message: string): { ok: false; code: LaunchFailure; message: string } {
  return { ok: false, code, message }
}

/**
 * Resolves everything a launch needs and refuses every row that cannot run.
 *
 * Order matters, and follows `screen_launch.cpp`'s confirm handler: the running
 * game is checked first (so a click never disturbs the game already up), then the
 * catalog row, then the install, then the executable, and the config is patched
 * last — a rejected launch never touches a file.
 */
export async function prepareLaunch(request: LaunchRequest): Promise<PrepareOutcome> {
  if (tracked !== null) {
    return failure(
      'game-already-running',
      `${tracked.titleId} (${tracked.versionId}) is still running. Stop it before starting another game.`
    )
  }

  // The row comes from the shared catalog, so the renderer and the main process
  // can never disagree about what a version id means.
  const row = findVersion(request.versionId)
  if (row === undefined) {
    return failure('not-launchable', `Unknown game version "${request.versionId}".`)
  }
  if (row.titleId !== request.titleId) {
    // A mismatched pair would run one title's row against another title's install
    // root, so it is refused rather than repaired.
    return failure(
      'not-launchable',
      `Version "${row.id}" belongs to "${row.titleId}", not to "${request.titleId}".`
    )
  }
  if (!row.launchable) {
    // The design's concept row (BIOHAZARD 1.5) has no executable at all and
    // carries the note the screen must show.
    return failure('not-launchable', row.unavailableReason ?? 'This version cannot be launched.')
  }

  let context: InstallContext
  try {
    context = await resolveInstallContext(row)
  } catch (error) {
    // An unreadable install (a vanished drive, a denied directory) is "not
    // installed" from the user's point of view, and there is no failure code for
    // "the check itself broke".
    return failure('not-installed', `${NOT_INSTALLED_MESSAGE} (${describeError(error)})`)
  }

  if (context.installPath === '') {
    return failure('not-installed', NOT_INSTALLED_MESSAGE)
  }
  if (context.state === 'missing') {
    return failure('not-installed', context.stateReason ?? NOT_INSTALLED_MESSAGE)
  }
  // `partial` passes on purpose: the renderer's `canLaunch`
  // (`src/renderer/src/data/derive.ts`) accepts exactly installed and partial, and
  // the two sides must not disagree about which rows are playable.

  const version: GameVersion = {
    ...row,
    state: context.state,
    stateReason: context.stateReason,
    hasMod: context.hasMod,
    modInstalled: context.modInstalled
  }

  const scenario = resolveScenario(row, request.scenario)
  const relativeExecutable = await chooseExecutable(version, request.mode, scenario, context.installPath)
  const executable = join(context.installPath, relativeExecutable)
  // `relativeExecutable === ''` is tested first on purpose: `join(root, '')` is a
  // real path (the install root itself), which would otherwise look like a file.
  if (relativeExecutable === '' || !(await isFile(executable))) {
    return failure('executable-missing', `The game executable is missing: ${executable}`)
  }

  if (!(await patchGameConfig(version, context.installPath))) {
    return failure('config-unwritable', `Could not update ${join(context.installPath, CONFIG_INI_NAME)}.`)
  }

  return {
    ok: true,
    prepared: {
      version,
      executable,
      mode: request.mode,
      scenario,
      cwd: context.installPath
    }
  }
}

/**
 * The RE2 scenario a launch uses. Mirrors `resolveScenario` in
 * `src/renderer/src/data/derive.ts`: a row without scenarios has none, the
 * requested player wins when the row exposes it, otherwise the row's default.
 */
function resolveScenario(row: GameVersionSeed, requested: Re2Scenario | null): Re2Scenario | null {
  if (row.scenarios.length === 0) return null
  if (requested !== null && row.scenarios.includes(requested)) return requested
  return row.defaultScenario
}

/**
 * Picks the executable for the launch, relative to the install root.
 *
 * Port of the legacy pick (`game_launcher.cpp`): RE-Enhance replaces the retail
 * executable with its own (`Biohazard.exe`, `Resident Evil 2.exe`,
 * `BIOHAZARD(R) 3 PC.exe` — README "RE-Enhance Mod Executables"), so enhanced mode
 * uses `modExecRelPath` when the overlay is available *and* the file is really
 * there. The `isFile` guard is the departure from the legacy code, which chose the
 * mod executable and then failed the launch outright when it was missing; falling
 * back to the retail executable lets an un-injected overlay still play.
 *
 * RE2 tradeoff: the row's scenario selects the player executable in original mode
 * (`LeonU.exe` / `ClaireU.exe`), but in enhanced mode RE-Enhance boots its own
 * loader (`Resident Evil 2.exe`), so the executable stays the mod's and the
 * scenario cannot be expressed through the file name. The chosen scenario is still
 * carried in `PreparedLaunch.scenario` — the launch panel shows the player, and
 * RE-Enhance reads the choice from its own configuration — the file name simply
 * stops being the thing that encodes it.
 */
async function chooseExecutable(
  version: GameVersion,
  mode: LaunchMode,
  scenario: Re2Scenario | null,
  installPath: string
): Promise<string> {
  const modExecutable = version.modExecRelPath
  const enhancedOverlay = mode === 'enhanced' && version.hasMod && modExecutable !== ''

  if (enhancedOverlay && (await isFile(join(installPath, modExecutable)))) {
    return modExecutable
  }
  if (version.titleId === 're2' && scenario !== null) {
    return RE2_SCENARIO_EXEC[scenario]
  }
  return version.execRelPath
}

/**
 * Writes the two `[DLL]` rows the game reads on boot.
 *
 * Sequential, never `Promise.all`: each patch reads and rewrites the whole file,
 * so two overlapping calls would each write a copy without the other's change.
 * Both are attempted even when the first fails — the values are independent, and
 * a half-patched file is repaired by the next launch.
 */
async function patchGameConfig(version: GameVersion, installPath: string): Promise<boolean> {
  const patch: PatchConfigFn = moduleDeps.patchConfig ?? patchIniFile
  const configPath = join(installPath, CONFIG_INI_NAME)

  const bootConfigPatched = await applyPatch(patch, configPath, BOOT_CONFIG_KEY, BOOT_CONFIG_OFF)
  const japanesePatched = await applyPatch(
    patch,
    configPath,
    JAPANESE_ENABLE_KEY,
    version.japaneseMode ? JAPANESE_ENABLE_ON : JAPANESE_ENABLE_OFF
  )

  return bootConfigPatched && japanesePatched
}

/** Applies one patch, turning a thrown failure into the `false` `patchIniFile` promises. */
async function applyPatch(
  patch: PatchConfigFn,
  configPath: string,
  key: string,
  value: string
): Promise<boolean> {
  try {
    return await patch(configPath, DLL_SECTION, key, value)
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------------
// perform
// ---------------------------------------------------------------------------

/**
 * Starts the prepared executable and begins tracking it.
 *
 * `spawn(executable, [], options)` is an argument array with no `shell`, which is
 * what makes a path holding parentheses safe; the working directory is the install
 * root because the games load their data (`Rofs*.dat`, `USA/`, `savedata/`)
 * relative to it (legacy `CreateProcessA(..., installPath, ...)`).
 *
 * A spawn that fails asynchronously (`ENOENT`, `EACCES`) reports `error` rather
 * than throwing, and is handled exactly like an exit with no code: the listeners
 * are told and the tracked process is cleared, so the launcher can never be stuck
 * showing a game that never started.
 */
export async function performLaunch(prepared: PreparedLaunch, deps?: LaunchDeps): Promise<LaunchResult> {
  if (tracked !== null) {
    return failure(
      'game-already-running',
      `${tracked.titleId} (${tracked.versionId}) is still running. Stop it before starting another game.`
    )
  }

  const spawnFn = deps?.spawn ?? moduleDeps.spawn ?? defaultSpawn
  const options: SpawnOptions = {
    cwd: prepared.cwd,
    detached: false,
    windowsHide: false,
    stdio: 'ignore'
  }

  let child: SpawnedProcess
  try {
    child = spawnFn(prepared.executable, [], options)
  } catch (error) {
    return failure('spawn-failed', `Could not start ${prepared.executable}: ${describeError(error)}`)
  }

  const game: TrackedGame = {
    titleId: prepared.version.titleId,
    versionId: prepared.version.id,
    // The frozen contract makes `pid` optional, so an injected double may report
    // none; `0` then means "nothing to signal" rather than a real process id.
    pid: typeof child.pid === 'number' ? child.pid : 0,
    settled: false
  }
  tracked = game

  const settle = (exitCode: number | null, signal: string | null): void => {
    if (game.settled) return
    game.settled = true
    // Only clear the slot when it still holds this game: `killGame` clears it
    // immediately, and a later launch must not be untracked by this child's exit.
    if (tracked === game) tracked = null
    lastExitCode = exitCode
    notifyExit({ titleId: game.titleId, versionId: game.versionId, exitCode, signal })
  }

  child.on('exit', (...args: unknown[]) => {
    settle(toExitCode(args[0]), toSignal(args[1]))
  })
  child.on('error', () => {
    // No message channel exists on `GameExitEvent`; the reason is already on the
    // child's stderr, which `stdio: 'ignore'` sends to the OS default sink.
    settle(null, null)
  })

  return {
    ok: true,
    pid: game.pid,
    executable: prepared.executable,
    // "The RE-Enhance overlay is what this launch runs": the injection itself
    // happens before `performLaunch` (the mods module owns it), so the only thing
    // observable from here is which executable is being started.
    injectedMod: usesModExecutable(prepared)
  }
}

/** True when the prepared command is the executable RE-Enhance installs for the row. */
function usesModExecutable(prepared: PreparedLaunch): boolean {
  const modExecutable = prepared.version.modExecRelPath
  if (modExecutable === '') return false
  return samePath(prepared.executable, join(prepared.cwd, modExecutable))
}

/**
 * Terminates the tracked game and clears the tracking.
 *
 * The slot is cleared before the signal is sent: termination is best-effort (the
 * process may have exited on its own a moment ago) and a launcher stuck on
 * "running" with a dead pid behind it could never launch again. The child's own
 * `exit` event still reaches the listeners, because `settle` keeps its own
 * reference to the game it belongs to.
 *
 * Windows uses `taskkill /T`, which takes the whole process tree: the games ship
 * wrappers that start helpers (`bio1hd.asi`, `dxcfg.exe`), and the legacy
 * `TerminateProcess` only killed the one handle it held. `kill` stays the fallback
 * when taskkill is missing or refuses, which is also the only POSIX path.
 */
export function killGame(): void {
  const game = tracked
  if (game === null) return
  tracked = null

  if (game.pid <= 0) return

  if (process.platform === 'win32') {
    const result = spawnSync('taskkill', ['/pid', String(game.pid), '/T', '/F'], {
      windowsHide: true,
      stdio: 'ignore'
    })
    if (result.status === 0) return
  }

  try {
    // SIGTERM on POSIX; on Windows `process.kill` defaults to terminate-process.
    process.kill(game.pid, 'SIGTERM')
  } catch {
    // Already gone, or not ours to signal: nothing left to do.
  }
}

/**
 * The running game, or the exit code of the last one.
 *
 * `exitCode` is `null` while a game runs, faithful to the legacy
 * `GetProcessExitCode`, which stayed "invalid" for the whole life of a process.
 */
export function getGameStatus(): GameStatus {
  if (tracked !== null) {
    return { running: true, titleId: tracked.titleId, versionId: tracked.versionId, exitCode: null }
  }
  return { running: false, titleId: null, versionId: null, exitCode: lastExitCode }
}

/** Subscribes to game exit; returns an unsubscribe function. */
export function onGameExit(listener: ExitListener): () => void {
  exitListeners.add(listener)
  return () => {
    exitListeners.delete(listener)
  }
}

/**
 * Fans an exit out to every listener.
 *
 * Iterating a copy keeps a listener that unsubscribes (or subscribes) while
 * handling the event from disturbing the iteration, and a throwing listener is
 * contained: the bookkeeping is already done by the time this runs, and a renderer
 * bug must not leave the launcher believing a dead game is still running.
 */
function notifyExit(event: GameExitEvent): void {
  for (const listener of [...exitListeners]) {
    try {
      listener(event)
    } catch {
      // Swallowed on purpose; see above.
    }
  }
}

// ---------------------------------------------------------------------------
// small helpers
// ---------------------------------------------------------------------------

/** A file, and not a directory that happens to share the executable's name. */
async function isFile(candidate: string): Promise<boolean> {
  try {
    return (await stat(candidate)).isFile()
  } catch {
    return false
  }
}

/** Two paths for the same file, tolerating separator and case differences. */
function samePath(left: string, right: string): boolean {
  const normalise = (value: string): string => value.replace(/[\\/]+/g, '/')
  const a = normalise(left)
  const b = normalise(right)
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b
}

/** Event payloads arrive as `unknown`; anything but a number is "no exit code". */
function toExitCode(value: unknown): number | null {
  return typeof value === 'number' ? value : null
}

/** `exit` reports a signal name when the process was killed instead of exiting. */
function toSignal(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
