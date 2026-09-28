/**
 * FROZEN renderer contracts.
 *
 * Every component, overlay, hook and store action in the renderer is declared
 * here. Components import their props from this file so screens, overlays and
 * primitives can be written independently and still compose.
 *
 * Rules:
 *  - Screens read state from the store (`useLauncher`) and receive no props.
 *  - Overlays receive everything through props except `LaunchPanel`, which reads
 *    the store because it mutates launcher state.
 *  - No component reaches into the Electron bridge directly; that is the store's job.
 *
 * IMPORTANT — this file is types plus ambient `declare`s, so it emits no runtime
 * code. Only ever import *types* from it. Import runtime values from their real
 * modules:
 *
 *   Stage, StageProps          -> '@renderer/stage/Stage'
 *   useActions                 -> '@renderer/input/useActions'
 *   useSfx                     -> '@renderer/audio/useSfx'
 *   useLauncher, launcherStore -> '@renderer/state/store'
 *   currentTitle and friends   -> '@renderer/data/derive'
 *   Backdrop                   -> '@renderer/components/Backdrop'
 *   HelperBar, KeyCap          -> '@renderer/components/HelperBar'
 *   LogoBlock                  -> '@renderer/components/LogoBlock'
 *   GameCard                   -> '@renderer/components/GameCard'
 *   VersionRow                 -> '@renderer/components/VersionRow'
 *   InfoPanel                  -> '@renderer/components/InfoPanel'
 *   Media                      -> '@renderer/components/Media'
 *   StatusPill                 -> '@renderer/components/StatusPill'
 *   CrtOverlay                 -> '@renderer/overlays/CrtOverlay'
 *   ErrorDialog                -> '@renderer/overlays/ErrorDialog'
 *   InstallStatus              -> '@renderer/overlays/InstallStatus'
 *   AchievementToast           -> '@renderer/overlays/AchievementToast'
 *   LaunchPanel                -> '@renderer/overlays/LaunchPanel'
 *   MainMenu / VersionSelect / Gameplay -> '@renderer/screens/<Name>'
 */
import type { ReactNode } from 'react'
import type {
  Achievement,
  CatalogSnapshot,
  GameStatus,
  GameTitle,
  GameVersion,
  InputAction,
  InputDevice,
  InstallState,
  LaunchMode,
  LauncherConfig,
  LauncherError,
  ModProgress,
  Re2Scenario,
  ScreenId,
  TitleId
,
  RaAchievement} from '@shared/types'

// ---------------------------------------------------------------------------
// stage
// ---------------------------------------------------------------------------

/**
 * Renders its children in a fixed 1920x1080 author space and scales the whole
 * thing to fit the viewport, letterboxing on `#0F0F0F`. Nothing inside reflows.
 */
export interface StageProps {
  children: ReactNode
  /** Extra classes for the inner 1920x1080 layer. */
  className?: string
}

// ---------------------------------------------------------------------------
// shared visuals
// ---------------------------------------------------------------------------

/** The flipped, hard-light portrait photo every screen sits on. */
export interface BackdropProps {
  opacity: number
  /** Screens below the main menu shift the layer down by 40.23px. */
  bottomOffset?: number
}

export interface HelperBarProps {
  hints: HelperHintLike[]
}

/** Structural twin of `HelperHint` in data/design.ts, kept loose on purpose. */
export interface HelperHintLike {
  keys: readonly string[]
  label: string
}

export interface KeyCapProps {
  /** `left|right|up|down|enter|esc` render the design's artwork; anything else is drawn as text. */
  kind: string
  label?: string
}

export interface GameCardProps {
  index: number
  title: GameTitle
  selected: boolean
  onHover: (index: number) => void
  onActivate: (index: number) => void
}

export interface VersionRowProps {
  version: GameVersion
  selected: boolean
  onHover: () => void
  onActivate: () => void
}

/** The 860px right-hand column of the Game Version screen. */
export interface InfoPanelProps {
  version: GameVersion
  /** Rendered above the info block, used by the launch panel. */
  children?: ReactNode
}

/** The main-menu lockup: red wordmark plus the "Classic Collection" badge. */
export interface LogoBlockProps {
  className?: string
}

/** An image that degrades to nothing rather than a broken icon. */
export interface MediaProps {
  src: string
  alt?: string
  className?: string
  fallback?: ReactNode
}

// ---------------------------------------------------------------------------
// overlays
// ---------------------------------------------------------------------------

export interface CrtOverlayProps {
  config: LauncherConfig
}

export interface ErrorDialogProps {
  error: LauncherError
  onDismiss: () => void
}

export interface InstallStatusProps {
  titles: GameTitle[]
  configPath: string
  appDir: string
  onContinue: () => void
}

export interface AchievementToastProps {
  achievement: Achievement | null
  onDone: () => void
}

export interface LaunchPanelProps {
  version: GameVersion
  mode: LaunchMode
  scenario: Re2Scenario | null
  optionIndex: number
  busy: { label: string; progress: number | null } | null
  onSelectOption: (index: number) => void
  onSetMode: (mode: LaunchMode) => void
  onSetScenario: (scenario: Re2Scenario) => void
  onLaunch: () => void
  /** Opens the settings surface, from the panel's SETTINGS row. */
  onOpenSettings: () => void
  onClose: () => void
}

/** A small inline status strip used by the install and error surfaces. */
export interface StatusPillProps {
  state: InstallState
  label?: string
}

// ---------------------------------------------------------------------------
// input + audio
// ---------------------------------------------------------------------------

export type ActionHandler = (action: InputAction, device: InputDevice) => void

/**
 * Wires keyboard, mouse-wheel-free arrow navigation and the Gamepad API into the
 * canonical action set. Key auto-repeat is throttled to 140ms and the pad to 220ms.
 */
export interface ActionsOptions {
  enabled?: boolean
  /** Ignore pad input for this long after a keyboard action, to avoid double moves. */
  deviceLockMs?: number
}

export declare function useActions(handler: ActionHandler, options?: ActionsOptions): void

export type SfxName = 'cursor' | 'confirm' | 'back'

export interface SfxApi {
  play(name: SfxName): void
  /** Must be called from a user gesture before the first sound will play. */
  unlock(): void
  setVolumes(master: number, sfx: number): void
}

export declare function useSfx(): SfxApi

// ---------------------------------------------------------------------------
// store
// ---------------------------------------------------------------------------

export interface BusyState {
  label: string
  /** 0..1, or null when the operation has no measurable progress. */
  progress: number | null
}

export interface LauncherState {
  screen: ScreenId
  menuIndex: number
  titleId: TitleId
  versionIndex: number
  panelOpen: boolean
  /** The settings surface is up (an addition; reached from the panel's SETTINGS row). */
  settingsOpen: boolean
  /** Row under the cursor on that surface, wrapped over SETTINGS_ROWS. */
  settingsIndex: number
  panelOptionIndex: number
  /**
   * The achievements surface is up (an addition; reached from the settings surface).
   *
   * The list the main process answered with, or null before the first answer,
   * which is what lets the surface tell an empty list apart from one that has not arrived.
   */
  achievementsOpen: boolean
  achievements: Achievement[] | null
  /** The title the list belongs to, for the surface's own heading. */
  achievementsTitle: string
  /** The RetroAchievements list for the same title, or null before its fetch answers. */
  raAchievements: RaAchievement[] | null
  /** The RetroAchievements login panel is up. */
  credentialsOpen: boolean
  gameplay: { titleId: TitleId; versionId: string } | null
  catalog: CatalogSnapshot | null
  config: LauncherConfig | null
  error: LauncherError | null
  achievement: Achievement | null
  achievementQueue: Achievement[]
  busy: BusyState | null
  modProgress: ModProgress | null
  gameStatus: GameStatus
  /** Set once the first catalog fetch resolves. */
  ready: boolean
}

export interface LauncherActions {
  init(): Promise<void>
  refreshCatalog(): Promise<void>
  setInstallRoot(path: string): Promise<void>
  goToInstall(): void
  goToMenu(): void
  goToVersion(titleId: TitleId, versionIndex?: number): void
  goToGameplay(titleId: TitleId, versionId: string): void
  setMenuIndex(index: number): void
  moveMenu(delta: number): void
  setVersionIndex(index: number): void
  moveVersion(delta: number): void
  openSettings(): void
  closeSettings(): void
  moveSettingsRow(delta: number): void
  changeSetting(delta: number): void
  activateSetting(): void
  /** Opens the achievements surface, fetching the current title's list first. */
  openAchievements(): Promise<void>
  closeAchievements(): void
  openCredentials(): void
  closeCredentials(): void
  saveCredentials(user: string, key: string): void
  /** Ticks or unticks one RetroAchievements entry, locally. */
  toggleRetroTick(id: number): void
  openPanel(): void
  closePanel(): void
  setPanelOption(index: number): void
  movePanelOption(delta: number): void
  setMode(mode: LaunchMode): Promise<void>
  setScenario(scenario: Re2Scenario): Promise<void>
  patchConfig(patch: Partial<LauncherConfig>): Promise<void>
  resetConfig(): Promise<void>
  launch(): Promise<void>
  /**
   * Ends the running game.
   *
   * The launcher stays up on the now-playing surface while a game runs, so it needs a
   * way to stop one: without this the only exit from a running game is the game's own
   * menu or quitting the launcher, and the surface that says "RUNNING" would have no
   * action that matches it.
   */
  stopGame(): Promise<void>
  dismissError(): void
  showError(error: LauncherError): void
  pushAchievement(achievement: Achievement): void
  popAchievement(): void
  handleAction(action: InputAction, device: InputDevice): void
}

export type LauncherStore = LauncherState & LauncherActions

/** Selector hook. `useLauncher(s => s.screen)`. */
export type LauncherHook = <T>(selector: (state: LauncherStore) => T) => T

export declare const useLauncher: LauncherHook
/** Non-reactive accessor for imperative handlers. */
export declare function launcherStore(): LauncherStore

// ---------------------------------------------------------------------------
// derived helpers implemented in data/derive.ts
// ---------------------------------------------------------------------------

export interface DerivedVersion {
  version: GameVersion
  mode: LaunchMode
  scenario: Re2Scenario | null
}

export declare function currentTitle(state: LauncherState): GameTitle | null
export declare function currentVersion(state: LauncherState): DerivedVersion | null
export declare function titleAt(state: LauncherState, index: number): GameTitle | null
export declare function versionAt(state: LauncherState, index: number): DerivedVersion | null
export declare function resolveMode(config: LauncherConfig | null, version: GameVersion): LaunchMode
export declare function resolveScenario(
  config: LauncherConfig | null,
  version: GameVersion
): Re2Scenario | null
/** True when the version has everything it needs to start. */
export declare function canLaunch(version: GameVersion): boolean
/** Options shown by the launch panel, in design order. */
export declare function panelOptions(version: GameVersion): ('mode' | 'crt' | 'scenario' | 'launch')[]
