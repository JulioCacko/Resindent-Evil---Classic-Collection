/**
 * FROZEN main-process module contracts.
 *
 * Every main-process module implements its slice of this file. Nothing here may
 * be changed without updating all implementers, because the IPC layer composes
 * these functions directly.
 *
 * All functions are dependency-injected where they touch the OS so they can be
 * unit tested in a plain Node environment with no Electron and no registry.
 */
import type {
  Achievement,
  AppPaths,
  CatalogSnapshot,
  GameVersion,
  GameExitEvent,
  GameStatus,
  InstallState,
  LaunchFailure,
  LaunchMode,
  LaunchRequest,
  LaunchResult,
  LauncherConfig,
  ModProgress,
  Re2Scenario,
  TitleId
} from '@shared/types'
import type { GameTitleSeed, GameVersionSeed } from '@shared/catalog'

// ---------------------------------------------------------------------------
// paths
// ---------------------------------------------------------------------------

/**
 * Two directories matter and they are different:
 *  - `appDir`    game-facing data the user can replace: `GOG Games/`,
 *                `reenhancemods/`, the legacy `config.ini` and `achievements.sav`.
 *  - `configDir` writable per-user state: Electron's `userData`.
 * Writing config next to the executable fails in Program Files, so it never happens.
 */
export interface MainPaths {
  appDir: string
  configDir: string
  configPath: string
  progressPath: string
  modsDir: string
  assetsDir: string
  legacyConfigPath: string
  legacyProgressPath: string
  isPackaged: boolean
}

export declare function getMainPaths(): MainPaths
export declare function toAppPaths(paths: MainPaths): AppPaths

// ---------------------------------------------------------------------------
// logger
// ---------------------------------------------------------------------------

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export interface Logger {
  debug(message: string, meta?: unknown): void
  info(message: string, meta?: unknown): void
  warn(message: string, meta?: unknown): void
  error(message: string, meta?: unknown): void
  /** Last N lines, used by the error dialog to show context. */
  tail(lines?: number): string[]
}

export declare const log: Logger
export declare function logFilePath(paths: MainPaths): string

// ---------------------------------------------------------------------------
// ini
// ---------------------------------------------------------------------------

/**
 * Line-based INI patcher, behaviourally identical to the legacy
 * `PatchIniValue` in the removed `src/games/game_launcher.cpp`:
 *  - case-insensitive section and key matching
 *  - the original spacing around `=` is preserved
 *  - comment lines inside a section are ignored, never rewritten
 *  - a missing section or key is appended rather than rewriting the file
 *  - every line is preserved, including blank ones and CRLF endings
 */
export declare function patchIniValue(
  contents: string,
  section: string,
  key: string,
  value: string
): string

/** Reads a file, applies patchIniValue, writes it back, creating it if absent. */
export declare function patchIniFile(
  filePath: string,
  section: string,
  key: string,
  value: string
): Promise<boolean>

// ---------------------------------------------------------------------------
// detect/gog
// ---------------------------------------------------------------------------

export interface GogDetectionOptions {
  appDir: string
  gogPathOverride: string
  platform: NodeJS.Platform
  /** Injected in tests; returns the raw `reg query` stdout or null. */
  runRegQuery?: (subkey: string) => Promise<string | null>
  pathExists?: (candidate: string) => Promise<boolean>
}

/** Extracts the value of the `path` REG_SZ/REG_EXPAND_SZ line from reg query output. */
export declare function parseRegQueryOutput(stdout: string): string | null

export interface GogTitleRef {
  id: TitleId
  gogGameId: string
  gogFolderName: string
}

/** Detection order: override -> local `GOG Games/` -> registry -> common roots. */
export declare function detectInstallPath(
  title: GogTitleRef,
  options: GogDetectionOptions
): Promise<string>

export declare function detectAllInstallPaths(
  titles: GogTitleRef[],
  options: GogDetectionOptions
): Promise<Record<string, string>>

// ---------------------------------------------------------------------------
// validate
// ---------------------------------------------------------------------------

export interface VersionProbeInput {
  titleId: TitleId
  installPath: string
  execRelPath: string
  requiresMod: boolean
  modPath: string
  modsDir: string
}

export interface VersionProbe {
  installOk: boolean
  exeOk: boolean
  dataOk: boolean
  modOk: boolean
}

/** 3/3 probes -> installed, 0/3 -> missing, otherwise partial (legacy rule). */
export declare function stateFromProbe(probe: VersionProbe): InstallState
export declare function probeVersion(input: VersionProbeInput): Promise<VersionProbe>

/** A mod is available only if its folder exists and holds at least one entry. */
export declare function modsAvailable(modsDir: string, modPath: string): Promise<boolean>

// ---------------------------------------------------------------------------
// mods
// ---------------------------------------------------------------------------

export interface ModContext {
  installPath: string
  modsDir: string
  modPath: string
  versionId: string
}

export interface ModResult {
  ok: boolean
  filesDone: number
  filesTotal: number
  message?: string
}

export declare function hasBackup(installPath: string): Promise<boolean>
export declare function readManifest(installPath: string): Promise<string[]>

/**
 * Backs up every file it is about to overwrite into `.mod_backup/` (preserving
 * relative paths), copies the mod tree over the install, then writes
 * `.mod_backup/manifest.txt`. Files whose names contain `readme` or `changelog`
 * are skipped. Removes a previous injection first when a manifest already exists.
 */
export declare function injectMod(
  context: ModContext,
  onProgress?: (progress: ModProgress) => void,
  signal?: AbortSignal
): Promise<ModResult>

/** Restores backups and deletes mod-only files, then removes `.mod_backup/`. */
export declare function removeMod(
  context: ModContext,
  onProgress?: (progress: ModProgress) => void
): Promise<ModResult>

// ---------------------------------------------------------------------------
// launch
// ---------------------------------------------------------------------------

export interface LaunchDeps {
  /** Injected in tests. Defaults to child_process.spawn. */
  spawn?: (
    executable: string,
    args: string[],
    options: { cwd: string; detached: boolean; windowsHide: boolean; stdio: 'ignore' }
  ) => { pid?: number; on: (event: string, listener: (...args: unknown[]) => void) => void }
  patchConfig?: typeof patchIniFile
  /**
   * Injected in tests. Defaults to `taskkill /T /F`, with `process.kill` as the fallback.
   *
   * `killGame` needs a seam for the same reason `spawn` has one: the branch that matters -
   * a stop the launcher asked for, which is what keeps its own kill from being reported to
   * the user as a crash - is only reachable when there is a real pid, and a test must not
   * signal one.
   */
  kill?: (pid: number) => void
  /**
   * Injected in tests. Overrides the persisted `inGameCrt` setting.
   *
   * The real value is read from the config file, and a test must not read the developer's own
   * profile to decide what a launch writes into a game - so this is the same kind of seam as
   * `spawn` and `patchConfig`, for the same reason.
   */
  inGameCrt?: boolean
}

export interface PreparedLaunch {
  version: GameVersion
  executable: string
  mode: LaunchMode
  scenario: Re2Scenario | null
  cwd: string
}

export declare function prepareLaunch(request: LaunchRequest): Promise<
  { ok: true; prepared: PreparedLaunch } | { ok: false; code: LaunchFailure; message: string }
>

export declare function performLaunch(
  prepared: PreparedLaunch,
  deps?: LaunchDeps
): Promise<LaunchResult>

export declare function killGame(): void
export declare function getGameStatus(): GameStatus

/** Subscribes to game exit; returns an unsubscribe function. */
export declare function onGameExit(listener: (event: GameExitEvent) => void): () => void

// ---------------------------------------------------------------------------
// config-store
// ---------------------------------------------------------------------------

export interface ConfigStoreOptions {
  configPath: string
  legacyConfigPath: string
  /** Parses the legacy `key = value` ini; injected in tests. */
  readLegacy?: (path: string) => Promise<Record<string, string> | null>
}

export interface ConfigStore {
  load(): Promise<LauncherConfig>
  get(): LauncherConfig
  patch(patch: Partial<LauncherConfig>): Promise<LauncherConfig>
  setMode(versionId: string, mode: LaunchMode): Promise<LauncherConfig>
  setScenario(versionId: string, scenario: Re2Scenario): Promise<LauncherConfig>
  reset(): Promise<LauncherConfig>
}

export declare function createConfigStore(options: ConfigStoreOptions): ConfigStore
export declare function defaultConfig(): LauncherConfig

/** Maps a legacy `config.ini` value map onto a LauncherConfig. */
export declare function migrateLegacyConfig(
  legacy: Record<string, string>,
  base: LauncherConfig
): LauncherConfig

// ---------------------------------------------------------------------------
// achievements
// ---------------------------------------------------------------------------

export interface AchievementStoreOptions {
  progressPath: string
  legacyProgressPath: string
  /** Bundled default definitions; loose files on disk override it. */
  definitionsPaths: string[]
}

export interface AchievementStore {
  init(): Promise<void>
  list(gameId: TitleId): Achievement[]
  all(): Achievement[]
  get(id: string): Achievement | null
  unlock(id: string): Promise<Achievement | null>
  reset(gameId?: TitleId): Promise<Achievement[]>
  onUnlock(listener: (achievement: Achievement) => void): () => void
}

export declare function createAchievementStore(options: AchievementStoreOptions): AchievementStore

/** Parses the legacy `id=1|<iso>` save format. */
export declare function parseProgressFile(contents: string): Map<string, { unlocked: boolean; date: string }>
export declare function serializeProgressFile(achievements: Achievement[]): string

// ---------------------------------------------------------------------------
// catalog-state
// ---------------------------------------------------------------------------

export interface CatalogBuildOptions {
  paths: MainPaths
  config: LauncherConfig
  detect?: typeof detectAllInstallPaths
  /**
   * Resolves one row's install: GOG preferred, then Steam.
   *
   * The seam a test uses when it needs per-row control, which `detect` cannot give -
   * that one answers per *title*, which is what a GOG install is and is not what
   * Steam is, where two rows of the same title live in different locale folders.
   */
  resolveInstall?: (
    title: GameTitleSeed,
    version: GameVersionSeed
  ) => Promise<{ path: string; source: 'gog' | 'steam'; execRelPath: string } | null>
  probe?: typeof probeVersion
  modsAvailableFn?: typeof modsAvailable
}

/** Merges the static catalog with detection + validation into the IPC snapshot. */
export declare function buildCatalogSnapshot(options: CatalogBuildOptions): Promise<CatalogSnapshot>

/** True when any title has no installed version, matching the legacy boot rule. */
export declare function needsInstallScreen(titles: CatalogSnapshot['titles']): boolean
