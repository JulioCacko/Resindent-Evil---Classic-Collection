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

/**
 * One RetroAchievements entry, as the launcher reads and shows it.
 *
 * Shared rather than owned by the main-process client because it crosses the IPC boundary: the
 * main process fetches it and the achievements surface displays it, and the channel map has to
 * name the same shape on both sides.
 *
 * These are **reference material**. RA works by reading an emulator's memory and the games this
 * launcher starts are native Windows builds, so nothing here can be unlocked by playing - the
 * measurement behind that is in `docs/ARCHITECTURE.md`.
 */
export interface RaAchievement {
  /** RA's own numeric id, which is what a locally-tracked tick would be stored against. */
  id: number
  title: string
  description: string
  points: number
  /** The badge image name, or an empty string when RA has none for it. */
  badge: string
}

/**
 * What the launcher window does when a game starts.
 *
 * minimise is the default because these games cannot be embedded - see
 * docs/ARCHITECTURE.md section 6, where reparenting the game window was measured and
 * refused - so getting out of the way is the honest way to show the game. stay keeps
 * the launcher up on the now-playing surface, which is right for a single-monitor
 * setup where the game is expected to take the foreground itself.
 */
export type LaunchWindowMode = 'minimise' | 'positioned' | 'stay'

export interface LauncherConfig {
  crtEnabled: boolean
  /**
   * Ask the *game* for a CRT look, on top of the launcher's own filter.
   *
   * The launcher's CSS filter draws in the launcher's window and can never cover the game,
   * which renders in its own DirectDraw window that these builds refuse to let anyone
   * reparent (docs/ARCHITECTURE.md §6). The game's own tools can do it, though, and the
   * launcher already writes into the file that configures them before every launch:
   * RE-Enhance's `[DLL] RetroMode` for all three titles, and dgVoodoo's
   * `[General] ScalingMode` - whose enum includes `stretched_4_3_crt` - for the titles that
   * ship a `dgVoodoo.conf`. Both are written from this flag and both are put back to the
   * payload's own defaults when it is off, so turning it off really turns it off.
   *
   * It needs RE-Enhance injected: a retail install has no `config.ini` `[DLL]` section and no
   * `dgVoodoo.conf`, so there is nothing to write and the launch proceeds untouched.
   */
  inGameCrt: boolean
  /**
   * RetroAchievements account name. Optional - the API answers with the key alone - and used
   * only to build the request URL when it is set.
   */
  raUser: string
  /**
   * The user's personal RetroAchievements web API key.
   *
   * A credential, and treated as one: it is never compiled in, never logged, and is sent to
   * retroachievements.org and nowhere else. It lives here because this is where the launcher
   * keeps everything the user configured.
   */
  raKey: string
  /**
   * RetroAchievements entries ticked locally, by RA's own numeric ids.
   *
   * 'Tracked locally' is the only honest kind of tracking available here: RA reads an emulator's
   * memory, so it can never report an unlock for a native Windows build. A tick therefore means
   * 'the player says they did this', stored beside the rest of their configuration.
   */
  raTicked: number[]
  /**
   * Ask Steam to start Steam-installed games, instead of spawning the executable here.
   *
   * Steam records playtime, shows its overlay and tracks achievements only for games it starts
   * itself, so a player with the Steam release gets all three by letting the client do the
   * launching - \steam://rungameid/<appid>\, which is what \steam-launch.ts\ builds.
   *
   * Only Steam installs are affected: a GOG copy is invisible to Steam unless the user has added
   * it as a non-Steam shortcut, and launching an app id Steam does not have opens a store page at
   * best. Off by default, because it trades the launcher's own child-process tracking for Steam's
   * and that trade is the player's to make.
   */
  launchThroughSteam: boolean
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
  /** What the launcher window does when a game starts. */
  launchWindowMode: LaunchWindowMode
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
  /**
   * When the running game was spawned, as epoch milliseconds; null when nothing runs.
   *
   * The renderer counts from this rather than from its own clock, so the elapsed time
   * on the now-playing surface survives a window reload and cannot drift from the
   * process it describes.
   */
  startedAt: number | null
}

export interface GameExitEvent {
  titleId: TitleId
  versionId: string
  exitCode: number | null
  signal: string | null
  /**
   * True when the launcher ended the process rather than the game exiting on its own.
   *
   * This matters because the launcher's own kill produces a non-zero exit code: STOP GAME
   * runs `taskkill /F`, so the game dies with 1. Without this flag that is indistinguishable
   * from a crash, and the launcher told the user that its own deliberate stop was
   * "RESIDENT EVIL stopped unexpectedly (exit code 1)" - a lie it would tell every single
   * time the button was pressed.
   */
  requested: boolean
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
  /**
   * The dedicated menu key. Opens the settings surface and closes it again, on any screen.
   *
   * Separate from plain Back on purpose: Back means 'leave this screen' and is interpreted per screen,
   * while this means 'show me the launcher's own additions' wherever the player happens to be.
   */
  | 'menu'

export type InputDevice = 'keyboard' | 'gamepad' | 'mouse'

export interface LauncherError {
  title: string
  message: string
}
