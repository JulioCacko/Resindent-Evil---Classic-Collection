/**
 * Shared data contracts between the Electron main process and the renderer.
 *
 * These types are the single source of truth for the IPC boundary. Both sides
 * import from here, so a change to a payload shape fails typecheck on both ends
 * at once instead of failing at runtime.
 */

export type InstallState = 'installed' | 'partial' | 'missing'

/** Enhanced = RE-Enhance injected, Original = untouched retail install. */
export type LaunchMode = 'enhanced' | 'original'

/** Resident Evil 2 ships two player scenarios as separate executables. */
export type Re2Scenario = 'leon' | 'claire'

export type TitleId = 're1' | 're2' | 're3'

/** The three screens the Figma concept defines, plus the boot gate. */
export type ScreenId = 'boot' | 'install' | 'menu' | 'version' | 'gameplay'

/**
 * One selectable row on the Game Version screen. Mirrors the legacy
 * `GameVersion` struct from the C++ launcher, extended with the presentation
 * fields the Figma concept needs (per-version logo width, hero, region art).
 */
export interface GameVersion {
  id: string
  titleId: TitleId
  /** Zero-based row order on the Game Version screen, matching the design. */
  row: number
  displayName: string
  region: 'US' | 'JP'
  /** The large 32px date drawn from the design's info panel. */
  releaseLabel: string
  /** Content of the `originally released in ...` line; '' hides the line. */
  originalRelease: string
  /** Shown in place of `originalRelease` when that is empty (design box note). */
  boxNote: string
  voices: string
  subtitles: string
  description: string
  /** Info-panel logo box, in design px. Height is 70 unless the design says otherwise. */
  logoWidth: number
  logoHeight: number
  heroAsset: string
  logoAsset: string
  regionAsset: string
  videoAsset: string
  /** The Gameplay screen shows a still for RE1/RE3 and a video for RE2, per the design. */
  gameplayMedia: GameplayMedia
  /** Executable relative to the install root, retail. */
  execRelPath: string
  /** Executable used when the RE-Enhance overlay is active. */
  modExecRelPath: string
  /** Subfolder name under `reenhancemods/`. */
  modPath: string
  /** RE-Enhance files are present on disk for this version. */
  hasMod: boolean
  /**
   * RE-Enhance files are already sitting in this install (a `.mod_backup/`
   * manifest exists), so ORIGINAL would mean restoring them rather than leaving
   * them alone. `derive.resolveMode` uses this to default the launch mode, which
   * is what the legacy launcher did with `ModLoader::HasBackup`.
   */
  modInstalled: boolean
  /**
   * Which store this row's files came from, and where they are.
   *
   * Per *row*, not per title: Steam ships one app per game but a complete copy of it
   * per localization, so two rows of the same title resolve to different folders -
   * RE1 US is `4249100_Biohazard\english` and RE1 JP is `…\japanese`. `'none'` means
   * nothing was found for this row.
   */
  installSource: 'gog' | 'steam' | 'none'
  /** The game root: the folder holding this row's executable and its data. */
  installPath: string
  /** Version is only playable with the mod (legacy: RE1 JP). */
  requiresMod: boolean
  /** Sets `[DLL] JapaneseEnable=1` before launch. */
  japaneseMode: boolean
  /** False for concept rows that were never released (design: BIOHAZARD 1.5). */
  launchable: boolean
  /** Human-readable reason a row cannot be launched; null when launchable. */
  unavailableReason: string | null
  /** Player scenarios this row exposes in the launch panel; empty for non-RE2 rows. */
  scenarios: Re2Scenario[]
  defaultScenario: Re2Scenario | null
  state: InstallState
  stateReason: string | null
}

export interface GameplayMedia {
  kind: 'image' | 'video'
  asset: string
}

export interface GameTitle {
  id: TitleId
  name: string
  cardAsset: string
  gogGameId: string
  /** Folder name used inside a `GOG Games/` directory. */
  gogFolderName: string
  /** The Steam app id, or '' when the Steam release has no equivalent app. */
  steamAppId: string
  versions: GameVersion[]
  /** Detected install root, '' when not found. */
  installPath: string
  /** True when at least one version validated as installed. */
  hasAnyInstalled: boolean
}

export interface Achievement {
  id: string
  gameId: TitleId
  name: string
  desc: string
  icon: string
  unlocked: boolean
  unlockDate: string
}

export interface LauncherConfig {
  crtEnabled: boolean
  scanlineIntensity: number
  curvature: number
  crtVignette: number
  crtGrain: number
  masterVolume: number
  sfxVolume: number
  musicVolume: number
  lastSelectedTitle: TitleId
  /** Per-version launch mode; missing entries default to the detected state. */
  modes: Record<string, LaunchMode>
  /** Per-version RE2 scenario; missing entries use the version default. */
  scenarios: Record<string, Re2Scenario>
  /** Explicit GOG install root, overrides auto-detection when set. */
  gogPathOverride: string
  /** Keep the launcher window visible while the game runs. */
  keepLauncherVisible: boolean
}

export interface CatalogSnapshot {
  titles: GameTitle[]
  config: LauncherConfig
  /** True when at least one title has no installed version (boots to Install Status). */
  needsInstallScreen: boolean
  /** Directory the launcher treats as its own (GOG Games / reenhancemods live here). */
  appDir: string
  configPath: string
  progressPath: string
}

export interface LaunchRequest {
  titleId: TitleId
  versionId: string
  mode: LaunchMode
  scenario: Re2Scenario | null
}

export type LaunchResult =
  | { ok: true; pid: number; executable: string; injectedMod: boolean }
  | { ok: false; code: LaunchFailure; message: string }

export type LaunchFailure =
  | 'not-installed'
  | 'not-launchable'
  | 'executable-missing'
  | 'config-unwritable'
  | 'mod-inject-failed'
  | 'mod-restore-failed'
  | 'spawn-failed'
  | 'game-already-running'

export interface ModProgress {
  versionId: string
  phase: 'backup' | 'copy' | 'restore' | 'cleanup'
  filesDone: number
  filesTotal: number
}

export type LaunchPhase =
  | { phase: 'injecting-mod'; versionId: string }
  | { phase: 'restoring-mod'; versionId: string }
  | { phase: 'patching-config'; versionId: string }
  | { phase: 'spawning'; versionId: string }

export interface GameStatus {
  running: boolean
  titleId: TitleId | null
  versionId: string | null
  /** Exit code of the last finished game process; null if it never ran or was launched externally. */
  exitCode: number | null
}

export interface GameExitEvent {
  titleId: TitleId
  versionId: string
  exitCode: number | null
  signal: string | null
}

export interface AppPaths {
  appDir: string
  configPath: string
  progressPath: string
  modsDir: string
  legacyConfigPath: string
  legacyProgressPath: string
  isPackaged: boolean
}

/** Canonical navigation intent produced by every input source. */
export type InputAction =
  | 'nav-left'
  | 'nav-right'
  | 'nav-up'
  | 'nav-down'
  | 'confirm'
  | 'back'

export type InputDevice = 'keyboard' | 'gamepad' | 'mouse'

export interface LauncherError {
  title: string
  message: string
}
