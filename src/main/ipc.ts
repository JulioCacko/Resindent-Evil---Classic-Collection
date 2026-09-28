/**
 * ipc.ts — the one module that touches `ipcMain`.
 *
 * Every channel in `INVOKE_CHANNELS` is registered here and typed against
 * `InvokeMap`, so the request and the response of a handler cannot drift away
 * from what the preload script and the renderer expect.
 *
 * Two rules shape the whole file:
 *
 *  1. **No exception may cross the bridge.** A rejected `ipcMain.handle` reaches
 *     the renderer as a rejected promise, which is invisible to a renderer that
 *     only reads the resolved value (`invoke<C>()` returns
 *     `InvokeMap[C]['response']`, with no failure arm). So every handler is
 *     wrapped: it is awaited inside a `try`, the error is logged, and the caller
 *     receives a *typed* value of the declared response type instead — a
 *     `LaunchResult` with `ok: false` for a launch, an empty list for
 *     achievements, and so on.
 *  2. **Payloads are untrusted.** Anything arriving from the renderer is
 *     re-validated before it can reach the filesystem, the registry or a child
 *     process, because a compromised renderer is exactly the threat
 *     `contextIsolation` is there to contain.
 *
 * The singletons live here too, one instance each for the lifetime of the
 * process: the config store, the achievement store, and the catalog snapshot
 * (built once by `buildCatalogSnapshot` and cached until something makes it
 * stale). `launch.ts` remains the single owner of the *game process* — this
 * module only records which row a launch and the renderer's focus refer to, so
 * an exit event can be attributed to a catalog row.
 *
 * Implements the IPC slice of the frozen `src/main/contracts.ts` surface.
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { BrowserWindow, app, dialog, ipcMain, shell } from 'electron'

import { EVENT_CHANNELS, INVOKE_CHANNELS } from '@shared/channels'
import type { EventChannel, EventMap, InvokeChannel, InvokeMap } from '@shared/channels'
import { TITLES } from '@shared/catalog'
import { fetchGameAchievements } from './retroachievements'
import type {
  CatalogSnapshot,
  GameExitEvent,
  GameStatus,
  GameVersion,
  LaunchFailure,
  LaunchMode,
  LaunchRequest,
  LaunchResult,
  LaunchWindowMode,
  LauncherConfig,
  ModProgress,
  Re2Scenario,
  TitleId
} from '@shared/types'

import { createAchievementStore } from './achievements'
import { buildCatalogSnapshot } from './catalog-state'
import { createConfigStore } from './config-store'
import type { AchievementStore, ConfigStore, MainPaths, ModContext, ModResult } from './contracts'
import {
  getGameStatus,
  killGame,
  onGameExit,
  performLaunch,
  prepareLaunch,
  refreshExternalGame
} from './launch'
import { log } from './logger'
import { hasBackup, injectMod, removeMod } from './mods'
import { getMainPaths, toAppPaths } from './paths'

// ---------------------------------------------------------------------------
// options and state
// ---------------------------------------------------------------------------

export interface IpcOptions {
  /** Overrides `getMainPaths()`; injected by tests so the real profile is untouched. */
  paths?: MainPaths
  /** Receives pushed events; defaults to every open window. Injected by tests. */
  targetWindow?: () => BrowserWindow | null
  /** Overrides `app.getVersion()` for `app:ping`. */
  appVersion?: string
  /**
   * Called after a game process is spawned, with the configured window behaviour.
   *
   * Injected rather than done here because the window lives in `index.ts`: this module
   * owns IPC and has no business holding a `BrowserWindow`.
   */
  onGameLaunched?: (mode: LaunchWindowMode) => void
  /** Called when a game process ends, so a launcher that stepped aside can come back. */
  onGameStopped?: () => void
}

/**
 * Everything the handlers share. Kept in one object rather than a handful of
 * module-level `let`s so a (re-)registration always starts from a coherent set of
 * singletons instead of inheriting half of a previous one.
 */
interface IpcState {
  paths: MainPaths
  config: ConfigStore
  achievements: AchievementStore
  /** Cached `catalog:get` answer; `null` until the first successful build. */
  catalog: CatalogSnapshot | null
  /** Build in progress, so concurrent handlers join one build instead of racing. */
  catalogInFlight: Promise<CatalogSnapshot> | null
  /** Launch in progress; a second `launch` while one runs is refused. */
  launchInFlight: Promise<LaunchResult> | null
  /** Row the renderer is showing (`game:focus`), used to attribute an exit. */
  focused: { titleId: TitleId; versionId: string } | null
  /** Row this process last spawned, used to attribute an exit. */
  launched: { titleId: TitleId; versionId: string } | null
  options: IpcOptions
}

let state: IpcState | null = null
const disposers: (() => void)[] = []

/** Status reported when the game-process module cannot answer (`game:status`). */
const NOT_RUNNING: GameStatus = {
  running: false,
  titleId: null,
  versionId: null,
  exitCode: null,
  startedAt: null
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * The catalog is the single source of truth for which titles exist, so the id
 * list is read from it instead of being repeated as a literal union here.
 */
function isTitleId(value: unknown): value is TitleId {
  return typeof value === 'string' && TITLES.some((title) => title.id === value)
}

/**
 * Reads a string field from an untrusted payload. `''` is a real value (it is how
 * `gogPathOverride` is cleared), so only a missing or non-string field yields
 * `null`.
 */
function readText(payload: unknown, key: string): string | null {
  if (!isRecord(payload)) return null
  const value = payload[key]
  return typeof value === 'string' ? value.trim() : null
}

/** Reads a string field that must be non-empty (an id, a url, a path). */
function readIdentifier(payload: unknown, key: string): string | null {
  const value = readText(payload, key)
  return value === null || value === '' ? null : value
}

/** Reads a raw, untyped field of an untrusted payload; `undefined` when absent. */
function readField(payload: unknown, key: string): unknown {
  return isRecord(payload) ? payload[key] : undefined
}

function parseMode(value: unknown): LaunchMode | null {
  return value === 'enhanced' || value === 'original' ? value : null
}

function parseScenarioValue(value: unknown): Re2Scenario | null {
  return value === 'leon' || value === 'claire' ? value : null
}

/**
 * The launcher's own settings file, plus the loose achievement definitions that
 * may replace the bundled ones. `createAchievementStore` already imports
 * `assets/achievements/achievements.json`, and the *last readable* file in this
 * list wins, so the entry next to the executable mirrors the legacy behaviour
 * (the old launcher read that loose file) while the copy in `userData` — the one
 * the user owns and can hand-edit — overrides both.
 */
function achievementDefinitionPaths(paths: MainPaths): string[] {
  return [
    join(paths.assetsDir, 'achievements', 'achievements.json'),
    join(paths.configDir, 'achievements.json')
  ]
}

function createState(options: IpcOptions): IpcState {
  const paths = options.paths ?? getMainPaths()
  return {
    paths,
    config: createConfigStore({
      configPath: paths.configPath,
      legacyConfigPath: paths.legacyConfigPath
    }),
    achievements: createAchievementStore({
      progressPath: paths.progressPath,
      legacyProgressPath: paths.legacyProgressPath,
      definitionsPaths: achievementDefinitionPaths(paths)
    }),
    catalog: null,
    catalogInFlight: null,
    launchInFlight: null,
    focused: null,
    launched: null,
    options
  }
}

function appVersion(current: IpcState): string {
  if (current.options.appVersion !== undefined) return current.options.appVersion
  try {
    return app.getVersion()
  } catch (error) {
    // `app` is unavailable outside Electron (unit tests). A version string is
    // cosmetic here, so an unusable value beats a failed `app:ping`.
    log.warn(`could not read the app version: ${describeError(error)}`)
    return '0.0.0'
  }
}

// ---------------------------------------------------------------------------
// handler registration and events
// ---------------------------------------------------------------------------

type Handler<C extends InvokeChannel> = (
  payload: InvokeMap[C]['request']
) => InvokeMap[C]['response'] | Promise<InvokeMap[C]['response']>

type FailureFactory<C extends InvokeChannel> = (
  payload: InvokeMap[C]['request'],
  error: unknown
) => InvokeMap[C]['response']

/**
 * Registers one handler behind the catch-all described at the top of the file.
 * The `payload` parameter is annotated with the channel's request type (the
 * bridge the preload script enforces) and re-validated inside the handlers that
 * act on it.
 */
function handle<C extends InvokeChannel>(
  channel: C,
  onFailure: FailureFactory<C>,
  handler: Handler<C>
): void {
  ipcMain.handle(channel, async (_event, payload: InvokeMap[C]['request']) => {
    try {
      return await handler(payload)
    } catch (error) {
      log.error(`ipc ${channel} failed`, error)
      return onFailure(payload, error)
    }
  })
  disposers.push(() => {
    ipcMain.removeHandler(channel)
  })
}

/** Windows that should receive pushed events. */
function eventTargets(current: IpcState): BrowserWindow[] {
  const preferred = current.options.targetWindow?.() ?? null
  if (preferred !== null) {
    return preferred.isDestroyed() ? [] : [preferred]
  }
  return BrowserWindow.getAllWindows().filter((window) => !window.isDestroyed())
}

/**
 * Main -> renderer push. Failures are swallowed on purpose: `mod:progress` fires
 * from inside `injectMod`'s callback, so a closed or destroyed window must not
 * turn a successful injection into a failed launch.
 */
function broadcast<C extends EventChannel>(current: IpcState, channel: C, payload: EventMap[C]): void {
  for (const window of eventTargets(current)) {
    try {
      window.webContents.send(channel, payload)
    } catch (error) {
      log.warn(`could not push ${channel} to the renderer: ${describeError(error)}`)
    }
  }
}

/**
 * Typed failure for the channels whose response type has no failure arm
 * (`void`). Those actions cannot report anything back through their response, and
 * silently doing nothing is the worst option for a user-initiated click.
 */
function toast(current: IpcState, kind: 'info' | 'error', title: string, message: string): void {
  broadcast(current, EVENT_CHANNELS.toast, { kind, title, message })
}

// ---------------------------------------------------------------------------
// catalog
// ---------------------------------------------------------------------------

/**
 * The answer given when the catalog cannot be built at all. An empty title list
 * with `needsInstallScreen: true` is the honest report: nothing is *known* to be
 * installed, and Install Status is the screen where the user can point the
 * launcher at their games.
 */
function fallbackSnapshot(current: IpcState): CatalogSnapshot {
  return {
    titles: [],
    config: current.config.get(),
    needsInstallScreen: true,
    appDir: current.paths.appDir,
    configPath: current.paths.configPath,
    progressPath: current.paths.progressPath
  }
}

/**
 * Builds (or returns) the catalog snapshot: detection plus validation, joined
 * with the static catalog. `force` is what `catalog:refresh` and
 * `catalog:set-install-root` use after they change what detection would find.
 *
 * A build already in flight is joined rather than duplicated. That is safe for
 * the force case too: the joined build started after the caller's config change
 * in the only way that matters here (both paths read the store's current config
 * inside the build).
 */
async function ensureCatalog(current: IpcState, force = false): Promise<CatalogSnapshot> {
  if (!force && current.catalog !== null) return current.catalog
  if (current.catalogInFlight !== null) return current.catalogInFlight

  const build = (async (): Promise<CatalogSnapshot> => {
    try {
      // `load()` is idempotent and never throws: it falls back to the defaults,
      // and migrates the legacy `config.ini` on the first run.
      const config = await current.config.load()
      const snapshot = await buildCatalogSnapshot({ paths: current.paths, config })
      current.catalog = snapshot
      return snapshot
    } catch (error) {
      // A broken detection (an unreadable drive, a locked registry) must not take
      // the launcher down; the last good snapshot still describes the world best.
      log.error(`could not build the catalog snapshot: ${describeError(error)}`)
      return current.catalog ?? fallbackSnapshot(current)
    } finally {
      current.catalogInFlight = null
    }
  })()
  current.catalogInFlight = build

  return build
}

/**
 * The cached snapshot embeds a copy of the config, so a settings change has to be
 * mirrored into it: otherwise a later `catalog:get` would hand the renderer the
 * settings it had before the change.
 */
function syncCatalogConfig(current: IpcState, config: LauncherConfig): void {
  if (current.catalog === null) return
  current.catalog = { ...current.catalog, config }
}

// ---------------------------------------------------------------------------
// launch
// ---------------------------------------------------------------------------

function fail(code: LaunchFailure, message: string): LaunchResult {
  log.warn(`launch failed: ${code} — ${message}`)
  return { ok: false, code, message }
}

/** Validates the request shape. Every field is re-checked, nothing is trusted. */
function parseLaunchRequest(payload: unknown): LaunchRequest | null {
  if (!isRecord(payload)) return null
  const titleId = payload.titleId
  const versionId = payload.versionId
  const mode = payload.mode
  const scenario = payload.scenario

  if (!isTitleId(titleId)) return null
  if (typeof versionId !== 'string' || versionId === '') return null
  if (mode !== 'enhanced' && mode !== 'original') return null
  if (scenario !== undefined && scenario !== null && parseScenarioValue(scenario) === null) return null

  return { titleId, versionId, mode, scenario: parseScenarioValue(scenario) }
}

/**
 * Resolves the scenario actually launched.
 *
 * Only RE2 rows expose scenarios (`GameVersion.scenarios`), and the legacy
 * ScreenLaunch only offered the choice on those rows, so a scenario sent for a
 * non-RE2 row is dropped instead of being passed on; for an RE2 row an
 * unrecognised choice falls back to the row's documented default.
 */
function normalizeScenario(version: GameVersion, requested: Re2Scenario | null): Re2Scenario | null {
  if (version.scenarios.length === 0) return null
  if (requested !== null && version.scenarios.includes(requested)) return requested
  return version.defaultScenario ?? version.scenarios[0] ?? null
}

function modContext(current: IpcState, version: GameVersion, installPath: string): ModContext {
  return {
    installPath,
    modsDir: current.paths.modsDir,
    modPath: version.modPath,
    versionId: version.id
  }
}

/** Progress callback shared by `injectMod` and `removeMod`. */
function reportModProgress(current: IpcState): (progress: ModProgress) => void {
  return (progress) => {
    broadcast(current, EVENT_CHANNELS.modProgress, progress)
  }
}

/**
 * `injectMod` with its exceptions turned into a typed result. A throw here is a
 * filesystem failure the mod loader did not classify itself, and it is still an
 * injection failure, so it reports through the same channel rather than escaping
 * as a rejected promise.
 */
async function injectOverlay(current: IpcState, context: ModContext): Promise<ModResult> {
  try {
    return await injectMod(context, reportModProgress(current))
  } catch (error) {
    return {
      ok: false,
      filesDone: 0,
      filesTotal: 0,
      message: `The RE-Enhance overlay could not be copied: ${describeError(error)}`
    }
  }
}

/** `removeMod` with its exceptions turned into a typed result. See `injectOverlay`. */
async function restoreOverlay(current: IpcState, context: ModContext): Promise<ModResult> {
  try {
    return await removeMod(context, reportModProgress(current))
  } catch (error) {
    return {
      ok: false,
      filesDone: 0,
      filesTotal: 0,
      message: `The original game files could not be restored: ${describeError(error)}`
    }
  }
}

/** True when the install carries the leftovers of an injection. Read failures count as "no". */
async function overlayBackupExists(installPath: string): Promise<boolean> {
  try {
    return await hasBackup(installPath)
  } catch (error) {
    log.warn(`could not check for a mod backup in ${installPath}: ${describeError(error)}`)
    return false
  }
}

/**
 * The full launch sequence, in the order the legacy launcher performed it
 * (`src/ui/screens/screen_launch.cpp` on Confirm, then
 * `GameLauncher::Launch`): validate the row, make sure the executable is there,
 * inject or restore the RE-Enhance overlay, then spawn.
 *
 * Every exit is a `LaunchResult`, so no failure has to be encoded in an
 * exception.
 */
async function launchSequence(current: IpcState, payload: LaunchRequest): Promise<LaunchResult> {
  const request = parseLaunchRequest(payload)
  if (request === null) {
    return fail('not-launchable', 'The launch request is malformed.')
  }

  const snapshot = await ensureCatalog(current)
  const title = snapshot.titles.find((candidate) => candidate.id === request.titleId)
  if (title === undefined) {
    return fail('not-installed', `The catalog has no title "${request.titleId}".`)
  }

  const version = title.versions.find((candidate) => candidate.id === request.versionId)
  if (version === undefined) {
    return fail('not-launchable', `The catalog has no version "${request.versionId}".`)
  }

  if (!version.launchable) {
    return fail('not-launchable', version.unavailableReason ?? `${version.displayName} cannot be launched.`)
  }

  // The legacy ScreenLaunch rejected an empty install path before anything else,
  // with exactly this message.
  if (title.installPath === '') {
    return fail('not-installed', 'Game is not installed or path is unknown.')
  }

  if (version.state === 'missing') {
    return fail('not-installed', version.stateReason ?? 'Install incomplete.')
  }

  // Re-check the executable before touching the install. The *retail* executable
  // is the one that must be there: the enhanced one is provided by the overlay
  // that has not been injected yet.
  if (version.execRelPath === '') {
    return fail('executable-missing', `${version.displayName} has no executable in the catalog.`)
  }
  const retailExecutable = join(title.installPath, version.execRelPath)
  if (!existsSync(retailExecutable)) {
    return fail('executable-missing', `Executable not found: ${retailExecutable}`)
  }

  // Legacy ScreenLaunch set `useEnhanced = v.hasMod` on entering the launch
  // screen, so a row with no overlay on disk always launches retail, whatever
  // mode the panel was left on.
  const mode: LaunchMode = request.mode === 'enhanced' && !version.hasMod ? 'original' : request.mode

  // `prepareLaunch` is what patches the game's own `config.ini` (`JapaneseEnable`
  // for a JP row and `BootConfig=0` to suppress the RE-Enhance setup dialog), so
  // the phase is announced before it runs, not around the spawn.
  broadcast(current, EVENT_CHANNELS.launchPhase, { phase: 'patching-config', versionId: version.id })

  const prepared = await prepareLaunch({
    titleId: request.titleId,
    versionId: version.id,
    mode,
    scenario: normalizeScenario(version, request.scenario)
  })
  if (!prepared.ok) {
    return fail(prepared.code, prepared.message)
  }

  const context = modContext(current, version, title.installPath)
  let injectedMod = false

  if (mode === 'enhanced' && version.hasMod && version.modPath !== '') {
    broadcast(current, EVENT_CHANNELS.launchPhase, { phase: 'injecting-mod', versionId: version.id })
    const injection = await injectOverlay(current, context)
    if (!injection.ok) {
      return fail(
        'mod-inject-failed',
        injection.message ?? 'Could not copy enhancement files. Check the reenhancemods folder.'
      )
    }
    injectedMod = true
    log.info(`injected the RE-Enhance overlay for ${version.id} (${injection.filesDone}/${injection.filesTotal} files)`)
  } else if (mode === 'original' && version.modPath !== '') {
    // Only restore when the install actually carries the overlay's backups. A
    // clean install has nothing to restore, and running `removeMod` anyway would
    // rewrite its manifest for no reason.
    if (await overlayBackupExists(title.installPath)) {
      broadcast(current, EVENT_CHANNELS.launchPhase, { phase: 'restoring-mod', versionId: version.id })
      const restore = await restoreOverlay(current, context)
      if (!restore.ok) {
        return fail('mod-restore-failed', restore.message ?? 'Could not restore the original game files.')
      }
      log.info(`restored the retail files of ${version.id} (${restore.filesDone}/${restore.filesTotal} files)`)
    }
  }

  // The overlay is what provides the enhanced executable, so the check for the
  // executable actually being spawned has to come after the injection.
  if (!existsSync(prepared.prepared.executable)) {
    return fail('executable-missing', `Executable not found: ${prepared.prepared.executable}`)
  }

  broadcast(current, EVENT_CHANNELS.launchPhase, { phase: 'spawning', versionId: version.id })

  const result = await performLaunch(prepared.prepared)
  if (!result.ok) {
    return fail(result.code, result.message)
  }

  // Remembered so `game:exit` can name the row even if the exit event arrives
  // without one.
  current.launched = { titleId: version.titleId, versionId: version.id }
  log.info(`launched ${version.id} (pid ${result.pid})${injectedMod ? ' with the RE-Enhance overlay' : ''}`)

  // The game is up, so the launcher steps aside (or stays, if that is what the user
  // configured). These games cannot be embedded in the launcher window - see
  // docs/ARCHITECTURE.md section 6 - so getting out of the way is how the real game
  // becomes the thing on screen. The config is read here rather than cached, so a
  // change made moments before launching is the one that applies.
  const config = await current.config.load()
  current.options.onGameLaunched?.(config.launchWindowMode)

  return { ok: true, pid: result.pid, executable: result.executable, injectedMod }
}

/**
 * Serialises launches. Two concurrent sequences would run `injectMod` on the same
 * install at once, and the second one's backup pass could capture the first
 * one's already-overwritten files — the exact corruption the backup exists to
 * prevent.
 */
async function runLaunch(current: IpcState, payload: LaunchRequest): Promise<LaunchResult> {
  if (current.launchInFlight !== null) {
    return fail('game-already-running', 'A launch is already in progress.')
  }

  // Assigned before the first `await` inside `launchSequence`, so a second
  // `launch` arriving in the same tick already sees it.
  const work = launchSequence(current, payload)
  current.launchInFlight = work
  try {
    return await work
  } finally {
    current.launchInFlight = null
  }
}

/**
 * Names the row a finished process belonged to.
 *
 * `launch.ts` owns the process and normally names the row itself. The renderer's
 * `game:focus` record is the fallback for a process the launcher did not spawn
 * (the legacy `GameLauncher` reported no exit code for those), so the event still
 * points at a row the renderer can act on. Returns null when nothing is known.
 */
function attributeExit(current: IpcState, event: GameExitEvent): GameExitEvent | null {
  const fallback = current.launched ?? current.focused
  const titleId = isTitleId(event.titleId) ? event.titleId : fallback?.titleId ?? null
  const versionId = event.versionId !== '' ? event.versionId : fallback?.versionId ?? null
  if (titleId === null || versionId === null) return null
  return { ...event, titleId, versionId }
}

// ---------------------------------------------------------------------------
// shell helpers
// ---------------------------------------------------------------------------

/**
 * `http`/`https` only, as the launcher's only external links are store and mod
 * pages. Anything else (`file:`, `javascript:`, a custom scheme) is refused
 * before it reaches the OS: `shell.openExternal` hands the URL to the shell, and
 * a `file:` URL there is an execution primitive.
 */
function httpUrl(value: string): string | null {
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    return null
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
  if (parsed.hostname === '') return null
  return parsed.toString()
}

// ---------------------------------------------------------------------------
// registration
// ---------------------------------------------------------------------------

/**
 * Registers every channel in `INVOKE_CHANNELS` and subscribes to the main-process
 * events that have to be forwarded to the renderer.
 *
 * Returns the disposer that unregisters everything. Calling this twice is safe:
 * a dev reload re-runs the entry module, and `ipcMain.handle` throws on a
 * duplicate channel, so the previous registration is torn down first.
 */
export function registerIpcHandlers(options: IpcOptions = {}): () => void {
  disposeIpcHandlers()

  const current = createState(options)
  state = current

  // -- catalog ------------------------------------------------------------

  handle(
    INVOKE_CHANNELS.catalogGet,
    () => current.catalog ?? fallbackSnapshot(current),
    async () => await ensureCatalog(current)
  )

  handle(
    INVOKE_CHANNELS.catalogRefresh,
    () => current.catalog ?? fallbackSnapshot(current),
    async () => {
      const snapshot = await ensureCatalog(current, true)
      // Pushed as well as returned: a refresh changes rows the user is not
      // currently looking at, and the renderer keeps one snapshot for all screens.
      broadcast(current, EVENT_CHANNELS.catalogChanged, snapshot)
      log.info(`catalog refreshed: needsInstallScreen=${String(snapshot.needsInstallScreen)}`)
      return snapshot
    }
  )

  handle(
    INVOKE_CHANNELS.catalogPickInstallRoot,
    () => null,
    async () => {
      // The picker exists so that a "change install folder" action can mean what it says.
      // A hand-typed path would be a worse answer to "where are my games" than the OS's own
      // directory chooser, and the override it writes is the same one
      // `catalog:set-install-root` has always taken: this only supplies the path.
      //
      // `eventTargets` rather than a bare `BrowserWindow.getFocusedWindow()`: the dialog
      // should parent to the launcher window even when the launcher is not focused, which is
      // exactly the state it is in after a game has been running.
      const parent = eventTargets(current)[0] ?? null
      const chosen =
        parent === null
          ? await dialog.showOpenDialog({
              title: 'Select the folder that contains your games',
              properties: ['openDirectory']
            })
          : await dialog.showOpenDialog(parent, {
              title: 'Select the folder that contains your games',
              properties: ['openDirectory']
            })

      const path = chosen.filePaths[0]
      if (chosen.canceled || path === undefined) {
        log.info('install-root picker cancelled')
        return null
      }

      const config = await current.config.patch({ gogPathOverride: path })
      syncCatalogConfig(current, config)
      log.info(`install root override set to ${path} by the folder picker`)
      return path
    }
  )

  handle(
    INVOKE_CHANNELS.catalogSetInstallRoot,
    () => current.catalog ?? fallbackSnapshot(current),
    async (payload) => {
      // `''` clears the override and hands detection back to its own search order.
      const path = readText(payload, 'path')
      if (path === null) {
        log.warn('catalog:set-install-root ignored a request without a path')
        return current.catalog ?? fallbackSnapshot(current)
      }

      const config = await current.config.patch({ gogPathOverride: path })
      syncCatalogConfig(current, config)
      log.info(`install root override set to ${path === '' ? '(auto-detect)' : path}`)
      // Returned rather than pushed: only `catalog:refresh` broadcasts
      // `catalog:changed`, so the renderer never applies one catalog twice.
      return await ensureCatalog(current, true)
    }
  )

  // -- settings -----------------------------------------------------------

  handle(
    INVOKE_CHANNELS.modesSet,
    () => current.config.get(),
    async (payload) => {
      const versionId = readIdentifier(payload, 'versionId')
      if (versionId === null) {
        log.warn('modes:set ignored a request without a version id')
        return await current.config.load()
      }

      const mode = parseMode(readField(payload, 'mode'))
      const scenario = parseScenarioValue(readField(payload, 'scenario'))

      // Each setter returns the whole config, and `setScenario` runs last so its
      // result is the one returned; a request that carries neither just reports
      // the current config.
      let config = await current.config.load()
      if (mode !== null) config = await current.config.setMode(versionId, mode)
      if (scenario !== null) config = await current.config.setScenario(versionId, scenario)

      syncCatalogConfig(current, config)
      return config
    }
  )

  handle(
    INVOKE_CHANNELS.configPatch,
    () => current.config.get(),
    async (payload) => {
      const previousRoot = current.config.get().gogPathOverride
      // Delegated as-is: the store rebuilds the config field by field and drops
      // anything malformed, so an unknown key cannot reach the file.
      const config = await current.config.patch(payload)
      syncCatalogConfig(current, config)

      // A patch that moves the install root invalidates what detection found, for
      // exactly the reason `catalog:set-install-root` rebuilds: the cached snapshot
      // (and the launch pre-check that reads it) must not describe the old root.
      // Every other patch leaves detection untouched, so it costs nothing.
      if (config.gogPathOverride !== previousRoot) {
        await ensureCatalog(current, true)
      }
      return config
    }
  )

  handle(
    INVOKE_CHANNELS.configReset,
    () => current.config.get(),
    async () => {
      const previousRoot = current.config.get().gogPathOverride
      const config = await current.config.reset()
      syncCatalogConfig(current, config)
      log.info('settings reset to their defaults')

      // A reset clears the install-root override too, which changes what detection
      // finds and therefore what every row's state is.
      if (config.gogPathOverride !== previousRoot) {
        await ensureCatalog(current, true)
      }
      return config
    }
  )

  // -- launch -------------------------------------------------------------

  handle(
    INVOKE_CHANNELS.launch,
    (_payload, error) =>
      fail('spawn-failed', `The launcher could not start the game: ${describeError(error)}`),
    async (payload) => await runLaunch(current, payload)
  )

  /**
   * The running game, refreshed first.
   *
   * `refreshExternalGame` settles a Steam-launched game whose image has disappeared - the same event a
   * child's exit produces - and it has to run *before* the synchronous read, or a game the launcher
   * handed to Steam would report as running forever. The read itself stays synchronous, so every
   * other caller of `getGameStatus` is unaffected.
   */
  handle(INVOKE_CHANNELS.gameStatus, () => NOT_RUNNING, async () => {
    await refreshExternalGame()
    return getGameStatus()
  })

  handle(
    INVOKE_CHANNELS.gameStop,
    () => undefined,
    () => {
      // The same kill path `before-quit` uses, so stopping a game from the launcher
      // and quitting the launcher leave the machine in the same state.`r
      const status = getGameStatus()
      if (!status.running) {
        log.warn('game:stop was asked to stop a game that is not running')
        return
      }
      log.info(`stopping  on request`)
      killGame()
    }
  )

  handle(
    INVOKE_CHANNELS.gameFocus,
    () => undefined,
    (payload) => {
      // Only the shape is checked here: the renderer reports the row it is
      // *showing*, which is legitimately a row that cannot be launched.
      const titleId = readField(payload, 'titleId')
      const versionId = readIdentifier(payload, 'versionId')
      if (!isTitleId(titleId) || versionId === null) {
        log.warn('game:focus ignored an invalid payload')
        return
      }
      current.focused = { titleId, versionId }
    }
  )

  // -- achievements -------------------------------------------------------

  handle(INVOKE_CHANNELS.achievementsList, () => [], async (payload) => {
    const gameId = readText(payload, 'gameId')
    if (!isTitleId(gameId)) {
      log.warn(`achievements:list ignored unknown game id "${String(gameId)}"`)
      return []
    }
    await current.achievements.init()
    return current.achievements.list(gameId)
  })

  handle(INVOKE_CHANNELS.achievementsUnlock, () => null, async (payload) => {
    const id = readIdentifier(payload, 'id')
    if (id === null) {
      log.warn('achievements:unlock ignored a request without an id')
      return null
    }
    // No push here on purpose: the store notifies `onUnlock` subscribers, and
    // this module is one of them, so pushing here too would toast twice.
    await current.achievements.init()
    return await current.achievements.unlock(id)
  })

  // The RetroAchievements lists for a title, on demand.
  //
  // Reference material only: RA works by reading an emulator's memory and these rows launch native
  // Windows builds, so nothing returned here can be unlocked by playing. Every failure answers an
  // empty array - no credentials, no network, no RA id for the title - because the alternative is a
  // launcher that breaks because a website was unreachable.
  handle(INVOKE_CHANNELS.achievementsRetro, () => [], async (payload) => {
    const retroGameId = readText(payload, 'gameId')
    if (retroGameId === null) return []
    const seed = TITLES.find((title) => title.id === retroGameId)
    if (seed === undefined || seed.raGameId === '') return []

    const config = await current.config.load()
    const game = await fetchGameAchievements(Number(seed.raGameId), {
      user: config.raUser,
      key: config.raKey
    })
    return game?.achievements ?? []
  })

  handle(INVOKE_CHANNELS.achievementsReset, () => current.achievements.all(), async (payload) => {
    const gameId = readText(payload, 'gameId')
    await current.achievements.init()

    if (gameId === null || gameId === '') {
      return await current.achievements.reset()
    }
    if (!isTitleId(gameId)) {
      // Refusing is the safe answer: an unrecognised id must not clear every
      // title's progress, so the current list comes back unchanged.
      log.warn(`achievements:reset ignored unknown game id "${gameId}"`)
      return current.achievements.all()
    }
    return await current.achievements.reset(gameId)
  })

  // -- app, shell ---------------------------------------------------------

  handle(INVOKE_CHANNELS.appPaths, () => toAppPaths(current.paths), () => toAppPaths(current.paths))

  handle(
    INVOKE_CHANNELS.openExternal,
    () => {
      toast(current, 'error', 'Cannot open link', 'Only http and https links can be opened in a browser.')
    },
    async (payload) => {
      const requested = readIdentifier(payload, 'url')
      const url = requested === null ? null : httpUrl(requested)
      if (url === null) {
        log.warn(`shell:open-external refused "${requested ?? '(missing)'}"`)
        toast(current, 'error', 'Cannot open link', 'Only http and https links can be opened in a browser.')
        return
      }
      await shell.openExternal(url)
    }
  )

  handle(
    INVOKE_CHANNELS.revealPath,
    (_payload, error) => {
      log.error('shell:reveal-path failed', error)
      toast(current, 'error', 'Cannot open folder', 'The launcher could not open that folder.')
    },
    (payload) => {
      const path = readIdentifier(payload, 'path')
      if (path === null || !existsSync(path)) {
        log.warn(`shell:reveal-path could not find "${path ?? '(missing)'}"`)
        toast(current, 'error', 'Folder not found', `The launcher could not find ${path ?? 'the requested path'}.`)
        return
      }
      shell.showItemInFolder(path)
    }
  )

  handle(INVOKE_CHANNELS.quit, () => undefined, () => {
    log.info('quit requested by the renderer')
    app.quit()
  })

  handle(INVOKE_CHANNELS.ping, () => ({ ok: true, version: appVersion(current) }), () => ({
    ok: true,
    version: appVersion(current)
  }))

  // -- main -> renderer events -------------------------------------------

  // One listener for the whole process: an unlock can originate in main (a game
  // hook) as well as from `achievements:unlock`, and both must toast.
  disposers.push(
    current.achievements.onUnlock((achievement) => {
      log.info(`achievement unlocked: ${achievement.id}`)
      broadcast(current, EVENT_CHANNELS.achievementUnlock, achievement)
    })
  )

  disposers.push(
    onGameExit((event) => {
      const attributed = attributeExit(current, event)
      // The process is gone, so the launch record is stale from here on; the
      // renderer's focus record stays valid and answers for the next event.
      current.launched = null
      // Whether or not the exit could be attributed to a row, a game has ended, so a
      // window that stepped aside has to come back: leaving the user on the desktop with
      // neither launcher nor game is the worst possible outcome here.
      current.options.onGameStopped?.()
      if (attributed === null) {
        log.warn('game:exit arrived with no known title or version to attribute it to')
        return
      }
      log.info(
        `game process ended: ${attributed.versionId}` +
          ` (exitCode ${String(attributed.exitCode)}, signal ${String(attributed.signal)})`
      )
      broadcast(current, EVENT_CHANNELS.gameExit, attributed)
    })
  )

  log.info(`ipc handlers registered (${String(Object.keys(INVOKE_CHANNELS).length)} channels)`)

  return disposeIpcHandlers
}

/** Unregisters every handler and event subscription made by the last registration. */
export function disposeIpcHandlers(): void {
  for (const dispose of disposers.splice(0)) {
    try {
      dispose()
    } catch (error) {
      log.warn(`could not unhook an ipc handler: ${describeError(error)}`)
    }
  }
}

/**
 * The catalog snapshot, built on first use and cached afterwards.
 *
 * Exported for the `--selftest` mode in `index.ts`, which needs the same snapshot
 * the renderer would receive without going through a window.
 */
export async function readCatalogSnapshot(options: IpcOptions = {}): Promise<CatalogSnapshot> {
  const current = state ?? createState(options)
  state = current
  return await ensureCatalog(current)
}
