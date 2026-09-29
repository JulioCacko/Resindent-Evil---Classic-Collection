import { DEFAULT_BINDINGS } from '@shared/controls'
/**
 * store.ts — all launcher state, and the only module that talks to `window.reLauncher`.
 *
 * Two rules shape this file:
 *
 *  1. **This is the bridge's only client.** `src/renderer/src/contracts.ts` states it
 *     ("No component reaches into the Electron bridge directly; that is the store's
 *     job"), so every `invoke` and every event subscription lives here and screens
 *     only ever read state and call actions.
 *  2. **The design owns the navigation rules, not the legacy launcher.** The export
 *     deliberately disagrees with itself about what happens at the end of a list —
 *     the main menu clamps (`.ref/designref/src/app/components/MainMenuPage.tsx:25-26`)
 *     while the version list wraps (`.ref/designref/src/app/components/VersionSelectPage.tsx:42-45`)
 *     — and `moveMenu`/`moveVersion` reproduce that difference rather than picking one.
 *
 * `handleAction` is the single interpreter of the canonical action set: it turns
 * (screen, panel state, action) into one `Intent` through the pure `resolveIntent`,
 * then performs it. Keeping the decision separate from the effect is what makes the
 * input rules readable in one place instead of spread across a dozen branches.
 *
 * Implements the `LauncherState` + `LauncherActions` slice of
 * src/renderer/src/contracts.ts.
 */
import { create } from 'zustand'

import { DEFAULT_TITLE_ID } from '@shared/catalog'
import { EVENT_CHANNELS, INVOKE_CHANNELS } from '@shared/channels'
import { enqueueToast, nextToast, overlayOwnsToast } from '@shared/toast-queue'
import type {
  EventChannel,
  EventMap,
  InvokeChannel,
  InvokeMap,
  ReLauncherApi
} from '@shared/channels'
import type {
  Achievement,
  CatalogSnapshot,
  GameExitEvent,
  GameStatus,
  InputAction,
  InputDevice,
  LaunchFailure,
  LaunchMode,
  LaunchPhase,
  LaunchRequest,
  LaunchResult,
  LauncherConfig,
  LaunchWindowMode,
  LauncherError,
  ModProgress,
  Re2Scenario,
  TitleId
} from '@shared/types'

import { sfx } from '@renderer/audio/useSfx'
import type {
  BusyState,
  LauncherHook,
  LauncherState,
  LauncherStore,
  SfxName
} from '@renderer/contracts'
import { CRT_DEFAULTS, SETTINGS_ROWS, SETTINGS_STEP, clamp01 } from '@renderer/data/design'
import {
  canLaunch,
  currentTitle,
  currentVersion,
  panelOptions,
  titleAt
} from '@renderer/data/derive'

// ---------------------------------------------------------------------------
// bridge access
// ---------------------------------------------------------------------------

/** Set once, so a renderer with no preload logs one line instead of one per call. */
let warnedAboutMissingBridge = false

/**
 * The bridge the preload script installs, or `null` when the renderer is not
 * running inside Electron. The ambient typing in src/renderer/src/global.d.ts
 * declares `window.reLauncher` as optional on purpose: a plain browser (Vite
 * serving the renderer on its own) has no preload, and the store has to survive
 * that instead of throwing on the first read.
 */
function bridge(): ReLauncherApi | null {
  if (typeof window === 'undefined') return null
  return window.reLauncher ?? null
}

function warnMissingBridge(): void {
  if (warnedAboutMissingBridge) return
  warnedAboutMissingBridge = true
  console.warn(
    '[launcher] window.reLauncher is unavailable: running with an in-memory, empty catalog.'
  )
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** A bridge answer, with the failure arm spelled out instead of thrown or lost. */
type InvokeOutcome<T> = { ok: true; value: T } | { ok: false; reason: string }

/**
 * One `invoke`, with the "no bridge" and "the call rejected" cases folded into the
 * return type. `src/main/ipc.ts` answers every channel (it wraps each handler in a
 * `try`), so a rejection means the handler is missing — a stale preload or a
 * half-registered process — and it must not reach a caller that only reads the
 * resolved value.
 */
async function invoke<C extends InvokeChannel>(
  channel: C,
  payload: InvokeMap[C]['request']
): Promise<InvokeOutcome<InvokeMap[C]['response']>> {
  const api = bridge()
  if (api === null) {
    warnMissingBridge()
    return { ok: false, reason: 'bridge-unavailable' }
  }
  try {
    return { ok: true, value: await api.invoke(channel, payload) }
  } catch (error) {
    console.warn(`[launcher] ${channel} failed: ${describeError(error)}`)
    return { ok: false, reason: describeError(error) }
  }
}

/**
 * One main -> renderer subscription. Returns null when there is nothing to
 * subscribe to, so `init()` can collect a mixed list of unsubscribers without
 * special-casing the offline path.
 */
function subscribe<C extends EventChannel>(
  channel: C,
  listener: (payload: EventMap[C]) => void
): (() => void) | null {
  const api = bridge()
  if (api === null) {
    warnMissingBridge()
    return null
  }
  try {
    return api.on(channel, listener)
  } catch (error) {
    console.warn(`[launcher] could not subscribe to ${channel}: ${describeError(error)}`)
    return null
  }
}

/**
 * Every unsubscribe function `init()` has collected. Nothing in the frozen contract
 * tears the store down, so the only thing that reads this is the hot-reload
 * disposer at the bottom of the file: a re-evaluated module would otherwise leave
 * its predecessor's listeners attached to a store nobody renders.
 */
const eventSubscriptions: (() => void)[] = []

// ---------------------------------------------------------------------------
// offline fallbacks
// ---------------------------------------------------------------------------

/**
 * The launcher config used when no main process can be reached.
 *
 * The values mirror `defaultConfig()` in src/main/config-store.ts, which cannot be
 * imported here: that module reads and writes files (`node:fs`), and pulling it
 * into the renderer bundle would ship the filesystem with the UI. The five CRT
 * numbers come from the design module so the offline overlay and the panel agree.
 */
function offlineConfig(): LauncherConfig {
  return {
    crtEnabled: CRT_DEFAULTS.enabled,
    scanlineIntensity: CRT_DEFAULTS.scanlineIntensity,
    curvature: CRT_DEFAULTS.curvature,
    crtVignette: CRT_DEFAULTS.vignette,
    crtGrain: CRT_DEFAULTS.grain,
    masterVolume: 1,
    sfxVolume: 1,
    musicVolume: 1,
    lastSelectedTitle: DEFAULT_TITLE_ID,
    modes: {},
    scenarios: {},
    launchWindowMode: 'minimise',
    inGameCrt: false,
    // Matches `config-store.ts`'s default: the in-game toast is on unless a player turns it off. This
    // literal is the renderer's offline fallback, so it has to agree with the real default or the
    // fallback would silently describe a different launcher.
    inGameOverlay: true,
    raUser: '',
    raConfigured: false,
    keyBindings: structuredClone(DEFAULT_BINDINGS),
    onboardingComplete: false,
    launchThroughSteam: false,
    raTicked: [],
    gogPathOverride: '',
    keepLauncherVisible: true
  }
}

/**
 * The catalog to carry on with when none could be read: empty, and honest about it.
 *
 * `needsInstallScreen: true` is the same answer the main process gives when its own
 * build fails (`fallbackSnapshot` in src/main/ipc.ts): nothing is *known* to be
 * installed, and Install Status is the screen where the user can say where the
 * games are. An empty main menu would have no way forward at all.
 */
function offlineSnapshot(): CatalogSnapshot {
  return {
    titles: [],
    config: offlineConfig(),
    needsInstallScreen: true,
    appDir: '',
    configPath: '',
    progressPath: ''
  }
}

// ---------------------------------------------------------------------------
// small pure helpers
// ---------------------------------------------------------------------------

/**
 * The main-menu clamp, in words: `Math.max(0, s - 1)` / `Math.min(2, s + 1)` from
 * `.ref/designref/src/app/components/MainMenuPage.tsx:25-26`. The frame draws
 * exactly three cards and `@shared/catalog` always supplies exactly those three
 * titles, so the design's literal 2 is the last card's index.
 */
const MENU_LAST_INDEX = 2

/** `Math.max(0, Math.min(max, value))`, with a non-finite guard for a stale index. */
function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  if (value < min) return min
  if (value > max) return max
  return value
}

/**
 * The version list's wrap: `(i - 1 + totalVersions) % totalVersions` and
 * `(i + 1) % totalVersions` in `.ref/designref/src/app/components/VersionSelectPage.tsx:42,45`.
 * Doubling the modulo keeps a negative index inside the list, and a zero count
 * (no catalog yet) collapses to 0 rather than `NaN`.
 */
function wrap(index: number, count: number): number {
  if (count <= 0) return 0
  return ((index % count) + count) % count
}

/**
 * Rows on a title's version list. `titleId` defaults to the selected one, so the
 * version list's own navigation reads as `versionCount(state)`.
 */
function versionCount(state: LauncherState, titleId: TitleId = state.titleId): number {
  const title = state.catalog?.titles.find((candidate) => candidate.id === titleId)
  return title?.versions.length ?? 0
}

/** A busy readout with no measurable progress, which is every phase but a copy. */
function busyOnly(label: string): BusyState {
  return { label, progress: null }
}

/**
 * 0..1 for the panel's progress bar, or null when there is nothing to measure.
 * `main/mods.ts` reports 0/0 for an empty tree, and a bar stuck at 0% claims a
 * measurement that does not exist — `progress: null` is the contract's way of
 * saying so.
 */
function progressFromMod(progress: ModProgress): number | null {
  if (progress.filesTotal <= 0) return null
  const ratio = progress.filesDone / progress.filesTotal
  if (!Number.isFinite(ratio)) return null
  return clamp(ratio, 0, 1)
}

/** A config with one version's mode replaced, for the offline path of `setMode`. */
function mergeMode(
  config: LauncherConfig | null,
  versionId: string,
  mode: LaunchMode
): LauncherConfig {
  const base = config ?? offlineConfig()
  return { ...base, modes: { ...base.modes, [versionId]: mode } }
}

/** A config with one version's scenario replaced; the offline twin of `setScenario`. */
function mergeScenario(
  config: LauncherConfig | null,
  versionId: string,
  scenario: Re2Scenario
): LauncherConfig {
  const base = config ?? offlineConfig()
  return { ...base, scenarios: { ...base.scenarios, [versionId]: scenario } }
}

/**
 * One word per launch phase for the panel's busy readout. The main process
 * announces each phase *before* performing it (the `launchPhase` broadcasts in
 * src/main/ipc.ts `launchSequence`), so the label always names the step that is
 * running rather than the one that just finished.
 */
const PHASE_LABEL: Record<LaunchPhase['phase'], string> = {
  'injecting-mod': 'PREPARING…',
  'restoring-mod': 'RESTORING…',
  'patching-config': 'PATCHING CONFIG…',
  spawning: 'STARTING…'
}

/** Shown from Confirm until the first phase event lands, one IPC round trip later. */
const LAUNCH_START_LABEL = 'PREPARING…'

/**
 * Failure codes -> what the user can act on.
 *
 * `LaunchResult.message` from the main process is deliberately not shown: it names
 * absolute executables and paths, which are the wrong register for a 1920x1080
 * dialog, and every code already has a sentence here. The technical message is
 * logged by src/main/ipc.ts (`fail`), where it belongs.
 */
const FAILURE_MESSAGE: Record<LaunchFailure, string> = {
  'not-installed':
    'The game is not installed, or the launcher could not find its folder. Check the install location on the Install Status screen.',
  'not-launchable': 'This version cannot be started.',
  'executable-missing': 'The game executable is missing from the install folder.',
  'config-unwritable':
    'The game settings file could not be written. Check that the install folder is not read-only.',
  'mod-inject-failed':
    'The RE-Enhance files could not be copied into the install. Check the reenhancemods folder.',
  'mod-restore-failed': 'The original game files could not be restored from the mod backup.',
  'spawn-failed': 'The game executable could not be started.',
  'game-already-running': 'The game is already starting or running.'
}

/**
 * The legacy screen titles: `ScreenError("LAUNCH FAILED", ...)` and
 * `ScreenError("MOD INSTALL FAILED", ...)` from the removed
 * `src/ui/screens/screen_launch.cpp`. A failed restore is part of a launch rather
 * than of an install, so it keeps the launch title.
 */
function errorForFailure(code: LaunchFailure): LauncherError {
  return {
    title: code === 'mod-inject-failed' ? 'MOD INSTALL FAILED' : 'LAUNCH FAILED',
    message: FAILURE_MESSAGE[code]
  }
}

/** The sound a canonical action makes. `SfxName` is the frozen vocabulary. */
/**
 * The launch-window behaviours in the order the settings row cycles them.
 *
 * Ordered as they read: get out of the way, put the game inside the launcher, or leave the launcher up
 * behind it. One cycle for either arrow, because there is no direction to a choice between three things.
 */
const LAUNCH_WINDOW_ORDER = ['minimise', 'positioned', 'stay'] as const

function nextLaunchWindowMode(current: LaunchWindowMode): LaunchWindowMode {
  const at = LAUNCH_WINDOW_ORDER.indexOf(current as (typeof LAUNCH_WINDOW_ORDER)[number])
  return LAUNCH_WINDOW_ORDER[(at + 1) % LAUNCH_WINDOW_ORDER.length] ?? 'minimise'
}
const SOUND_FOR: Record<InputAction, SfxName> = {
  'nav-left': 'cursor',
  'nav-right': 'cursor',
  'nav-up': 'cursor',
  'nav-down': 'cursor',
  confirm: 'confirm',
  back: 'back',
  // The menu key does something rather than leaving, so it sounds like the confirmations it leads to.
  menu: 'confirm'
}

// ---------------------------------------------------------------------------
// input interpretation
// ---------------------------------------------------------------------------

/**
 * What one canonical action means in the current screen and panel state. Every
 * branch of `resolveIntent` produces one of these, and `handleAction` is the only
 * thing that performs them — so the rules below are the complete answer to "what
 * does this key do here?", and the effects can never drift from them.
 */
type Intent =
  | { kind: 'open-preferences'; page: 'display' | 'controls' }
  | { kind: 'open-achievements' }
  | { kind: 'dismiss-error' }
  | { kind: 'move-menu'; delta: number }
  | { kind: 'open-version'; titleId: TitleId }
  | { kind: 'quit' }
  | { kind: 'move-version'; delta: number }
  | { kind: 'open-panel' }
  | { kind: 'close-panel' }
  | { kind: 'move-option'; delta: number }
  | { kind: 'toggle-option'; option: 'mode' | 'crt' | 'scenario' }
  | { kind: 'launch' }
  | { kind: 'go-menu' }
  | { kind: 'go-version'; titleId: TitleId }
  | { kind: 'open-settings' }
  | { kind: 'close-settings' }
  | { kind: 'move-setting'; delta: number }
  | { kind: 'change-setting'; delta: number }
  | { kind: 'activate-setting' }
  | { kind: 'close-achievements' }

/**
 * The single place that interprets the canonical action set.
 *
 * Pure, so the whole input contract can be read (and reasoned about) without a
 * mounted component, and so `handleAction` only has to perform what it returns.
 */
function resolveIntent(state: LauncherState, action: InputAction): Intent | null {
  // The error dialog is the topmost modal. While it is up the design offers one
  // action set and nothing else (`HINTS_ERROR` in src/renderer/src/data/design.ts:
  // esc/enter, "Dismiss"), so no key may reach the screen behind it — otherwise
  // Enter here would open the launch panel underneath the dialog.
  if (state.error !== null) {
    return action === 'confirm' || action === 'back' ? { kind: 'dismiss-error' } : null
  }

  // A launch in flight turns the panel into a readout with no selectable rows
  // (LaunchPanel.tsx, the `busy` branch), so Confirm would either start a second
  // launch or silently change a setting the running sequence has already read.
  // Back stays live on purpose: the user must never be trapped behind a launch, and
  // both this store's `launch()` and the main process (`runLaunch` ->
  // `game-already-running`) refuse a second one.
  if (state.credentialsOpen || state.preferences !== null) return null
  if (state.achievementsOpen && action !== 'back' && action !== 'menu') return null
  if (state.busy !== null && action !== 'back') return null

  /**
   * The dedicated menu key, before anything else can claim it.
   *
   * It opens the settings surface and closes it again, from any screen - and on the achievements
   * surface it closes that first, so one key is the way out of whatever addition is on top. Nothing
   * else answers `menu`, which is why it can sit here without fighting a screen's own bindings;
   * `Back` remains the screen-level "leave this", and both reach the same intent.
   */
  if (action === 'menu') {
    if (state.achievementsOpen) return { kind: 'close-achievements' }
    return state.settingsOpen ? { kind: 'close-settings' } : { kind: 'open-settings' }
  }

  /**
   * Back leaves an addition before it leaves the screen beneath it.
   *
   * The achievements surface had no way out by keyboard at all until this: the row that opens it is
   * reached with the keyboard, so the surface it opens has to be leavable the same way. Its own
   * helper bar promised `esc Back` and nothing answered it.
   */
  if (action === 'back' && state.achievementsOpen) return { kind: 'close-achievements' }

  // Settings is a full surface, so it owns the whole action set while it is up: the rows are
  // navigated with up/down, changed with left/right, and left with Back. It is checked before
  // the screens because it can be reached from the panel on the version screen, and Back there
  // must close the settings rather than the panel behind them.
  if (state.settingsOpen) {
    switch (action) {
      case 'nav-up':
        return { kind: 'move-setting', delta: -1 }
      case 'nav-down':
        return { kind: 'move-setting', delta: 1 }
      case 'nav-left':
        return { kind: 'change-setting', delta: -1 }
      case 'nav-right':
        return { kind: 'change-setting', delta: 1 }
      case 'confirm':
        return { kind: 'activate-setting' }
      case 'back':
        return { kind: 'close-settings' }
      default:
        return null
    }
  }

  if (state.screen === 'menu') {
    switch (action) {
      case 'nav-left':
        return { kind: 'move-menu', delta: -1 }
      case 'nav-right':
        return { kind: 'move-menu', delta: 1 }
      case 'confirm': {
        // Confirm opens the title under the cursor. `currentTitle` reads `titleId`,
        // which `moveMenu` keeps in step with `menuIndex`.
        const title = currentTitle(state)
        return title === null ? null : { kind: 'open-version', titleId: title.id }
      }
      case 'back':
        // HINTS_MENU's "Back" leaves the launcher: there is nothing behind the main
        // menu in a single-window launcher.
        return { kind: 'quit' }
      default:
        return null
    }
  }

  if (state.screen === 'version') {
    if (!state.panelOpen) {
      // The export drives the version list from all four arrows — ArrowUp and
      // ArrowLeft step back, ArrowDown and ArrowRight step on
      // (VersionSelectPage.tsx:41-46) — and wraps at both ends.
      switch (action) {
        case 'nav-up':
        case 'nav-left':
          return { kind: 'move-version', delta: -1 }
        case 'nav-down':
        case 'nav-right':
          return { kind: 'move-version', delta: 1 }
        case 'confirm':
          return { kind: 'open-panel' }
        case 'back':
          return { kind: 'go-menu' }
        default:
          return null
      }
    }

    const derived = currentVersion(state)
    if (derived === null) return null
    // `panelOptions` always yields at least the CRT row and LAUNCH, so the folded
    // index is always in range — the same fold LaunchPanel applies to the index it
    // is handed, which is what keeps the highlighted row and this switch agreeing.
    const options = panelOptions(derived.version)
    const option = options[wrap(state.panelOptionIndex, options.length)]

    switch (action) {
      case 'nav-up':
        return { kind: 'move-option', delta: -1 }
      case 'nav-down':
        return { kind: 'move-option', delta: 1 }
      case 'nav-left':
      case 'nav-right':
        // The Change keys are inert on the rows that carry no value to move — LAUNCH and
        // SETTINGS are actions — but they are the only way to change any other row.
        return option === 'launch' || option === 'settings' || option === 'display' || option === 'controls' || option === 'achievements'
          ? null
          : { kind: 'toggle-option', option }
      case 'confirm':
        // Enter on LAUNCH starts the game; on SETTINGS it opens the settings surface; on
        // every other row it is the same gesture as the Change keys, which is what the legacy
        // screen did (`screen_launch.cpp`: Enter on the launch row, Left/Right elsewhere).
        if (option === 'display' || option === 'controls') return { kind: 'open-preferences', page: option }
        if (option === 'achievements') return { kind: 'open-achievements' }
        if (option === 'launch') return { kind: 'launch' }
        if (option === 'settings') return { kind: 'open-settings' }
        return { kind: 'toggle-option', option }
      case 'back':
        return { kind: 'close-panel' }
      default:
        return null
    }
  }

  if (state.screen === 'gameplay') {
    // GameplayPage.tsx:24 — Escape is the only key the screen answers, and it goes
    // back to the running game's own version list. The launch record names that
    // title; a screen restored straight from a running process falls back to the
    // title the store is already showing.
    if (action !== 'back') return null
    return { kind: 'go-version', titleId: state.gameplay?.titleId ?? state.titleId }
  }

  if (state.screen === 'install') {
    // HINTS_INSTALL: Enter is "Continue", and continuing means the main menu. The
    // install rows themselves are pointer-driven overlays, not a cursor.
    return action === 'confirm' ? { kind: 'go-menu' } : null
  }

  // 'boot': nothing owns input before the first catalog answer has switched the
  // screen (`init`), so a key pressed during the splash does nothing.
  return null
}

// ---------------------------------------------------------------------------
// initial state
// ---------------------------------------------------------------------------

/** Nothing has run yet, and nothing is known to have exited. */
const INITIAL_GAME_STATUS: GameStatus = {
  running: false,
  titleId: null,
  versionId: null,
  exitCode: null,
  startedAt: null
}

/**
 * The state the store opens with: the boot gate, no catalog, no config. `catalog`
 * and `config` stay null until `init()` has a real answer, which is what lets a
 * screen tell "not loaded yet" apart from "loaded and empty".
 */
const INITIAL_STATE: LauncherState = {
  preferences: null,
  inputDevice: 'keyboard',
  overlayReason: 'not-started',
  screen: 'boot',
  menuIndex: 0,
  titleId: DEFAULT_TITLE_ID,
  versionIndex: 0,
  panelOpen: false,
  settingsOpen: false,
  settingsIndex: 0,
  achievementsOpen: false,
  achievements: null,
  achievementsTitle: '',
  raAchievements: null,
  credentialsOpen: false,
  panelOptionIndex: 0,
  gameplay: null,
  catalog: null,
  config: null,
  error: null,
  achievement: null,
  achievementQueue: [],
  busy: null,
  modProgress: null,
  gameStatus: INITIAL_GAME_STATUS,
  /**
   * True only while main reports a live link to the in-game plugin (`overlay:state`).
   *
   * Starts false, which is the honest default: with no game running there is no plugin, and the
   * launcher's own toast is the only one.
   */
  overlayAvailable: false,
  /**
   * Badge art fetched so far, keyed by RA's badge name (`Achievements.tsx` asks for what it is about to
   * draw). Empty at boot: nothing is fetched until a list is on screen.
   */
  badges: {},
  ready: false
}

// ---------------------------------------------------------------------------
// the store
// ---------------------------------------------------------------------------

const store = create<LauncherStore>()((set, get) => {
  /** Memoised first load; also what makes `init()` idempotent. */
  let initPromise: Promise<void> | null = null
  const toastExpiry = new Map<string, ReturnType<typeof setTimeout>>()

  /**
   * Publishes a config that came back from main (or was merged locally). The
   * snapshot embeds its own copy — `CatalogSnapshot.config` — so both fields move
   * together; the main process does the same to its cached snapshot
   * (`syncCatalogConfig` in src/main/ipc.ts). Only the snapshot object is replaced:
   * `titles` and every row keep their identity, so a selector on a title does not
   * re-render for a settings change.
   */
  const applyConfig = (config: LauncherConfig): void => {
    const catalog = get().catalog
    set({ config, catalog: catalog === null ? null : { ...catalog, config } })
  }

  /** Publishes a whole catalog answer, config included. */
  const applySnapshot = (snapshot: CatalogSnapshot): void => {
    set({ catalog: snapshot, config: snapshot.config })
  }

  /**
   * `app:quit` has no response worth waiting for and the window is about to go
   * away, so this is fire-and-forget.
   */
  const quitApp = (): void => {
    void invoke(INVOKE_CHANNELS.quit, undefined)
  }

  /**
   * The status a successful launch may publish.
   *
   * A game that dies immediately can push `game:exit` before the launch's own reply
   * is processed, and an exit already recorded for this exact row is the later,
   * truer fact — so it wins over "it is running".
   */
  const statusAfterLaunch = (titleId: TitleId, versionId: string): GameStatus => {
    const current = get().gameStatus
    const exitedThisRow =
      !current.running &&
      current.titleId === titleId &&
      current.versionId === versionId
    if (exitedThisRow) return current
    // startedAt is the renderer's own clock reading, which is right here: this is the
    // optimistic status this process shows the moment its own spawn succeeded.
    return { running: true, titleId, versionId, exitCode: null, startedAt: Date.now() }
  }

  /** The display name of a row, for messages that would otherwise print an id. */
  const displayNameFor = (titleId: TitleId, versionId: string): string => {
    const title = get().catalog?.titles.find((candidate) => candidate.id === titleId)
    const version = title?.versions.find((candidate) => candidate.id === versionId)
    return version?.displayName ?? versionId
  }

  // -- main -> renderer events ---------------------------------------------

  const onModProgress = (progress: ModProgress): void => {
    const busy = get().busy
    set({
      modProgress: progress,
      // The phase event that precedes this one already named the step, so only the
      // measured part changes here. A progress event that arrives with no launch in
      // flight leaves `busy` alone: inventing a readout for it would leave the panel
      // stuck on a bar nothing will ever finish.
      busy: busy === null ? null : { label: busy.label, progress: progressFromMod(progress) }
    })
  }

  const onLaunchPhase = (phase: LaunchPhase): void => {
    if (get().busy === null) return
    // A figure measured for the previous phase would be a lie about the new one, so
    // the progress resets to "not measurable" on every phase change.
    set({ busy: busyOnly(PHASE_LABEL[phase.phase]) })
  }

  const onGameExit = (event: GameExitEvent): void => {
    set({
      busy: null,
      modProgress: null,
      gameStatus: {
        running: false,
        titleId: event.titleId,
        versionId: event.versionId,
        exitCode: event.exitCode,
        // The game is gone, so there is no longer a start to count from.
        startedAt: null
      }
    })

    /*
     * Whatever the in-game overlay was holding now belongs to this window.
     *
     * While a game runs with the plugin linked, `pushAchievement` queues instead of showing, because
     * the plugin is drawing the toast inside the game's own frame. The game is over, so the launcher
     * is the surface the player is looking at - and anything that arrived in the last moments of the
     * session (an unlock raised by the exit itself, for instance) has to be shown rather than left in
     * a queue nothing will drain.
     */
    if (get().achievement === null) get().popAchievement()

    // A null code is the "never ran, or launched outside the launcher" case the type
    // documents, so only a real non-zero code is a failure worth interrupting for. A stop
    // the launcher asked for is not a failure at all: `taskkill /F` makes the game exit 1,
    // and reporting that as "stopped unexpectedly" would be the launcher blaming the game
    // for something the user just asked it to do.
    if (event.requested) return
    if (event.exitCode === null || event.exitCode === 0) return
    get().showError({
      title: 'GAME EXITED WITH AN ERROR',
      message: `${displayNameFor(event.titleId, event.versionId)} stopped unexpectedly (exit code ${event.exitCode}).`
    })
  }

  const onCatalogChanged = (snapshot: CatalogSnapshot): void => {
    // `catalog:refresh` both answers its caller and pushes this event, so the same
    // snapshot can arrive twice. Replacing it is idempotent: the second set stores
    // the identical object, so a selector on it does not re-render.
    applySnapshot(snapshot)
  }

  const onAchievementUnlock = (achievement: Achievement): void => {
    get().pushAchievement(achievement)
  }

  /**
   * The in-game overlay's state, pushed by main whenever it changes.
   *
   * The important half is the *unavailable* one: if the plugin dies mid-session, or its pipe breaks,
   * this window takes the toast back at once and drains whatever the plugin was holding, so an unlock
   * is never lost in the gap between the two surfaces. `api` is carried for the log and for tests; the
   * launcher's behaviour does not depend on which present call the plugin hooked.
   */
  const onOverlayState = (state: { available: boolean; api: string; reason: string }): void => {
    set({ overlayAvailable: state.available, overlayReason: state.reason })
    if (!state.available && state.reason !== 'connecting' && state.reason !== 'linked' && get().achievement === null) get().popAchievement()
  }

  // -- navigation ----------------------------------------------------------

  const setMenuIndex = (index: number): void => {
    // The cursor and the selected title are one selection in two fields:
    // `currentTitle` reads `titleId`, so a cursor that moved without it would open
    // the wrong game on Confirm. Clamped, because the menu is the one list that
    // does not wrap.
    const state = get()
    const next = clamp(index, 0, MENU_LAST_INDEX)
    const title = titleAt(state, next)
    set({ menuIndex: next, titleId: title === null ? state.titleId : title.id })
  }

  const moveMenu = (delta: number): void => {
    setMenuIndex(get().menuIndex + delta)
  }

  const setVersionIndex = (index: number): void => {
    // Wrapped defensively rather than clamped: the version list wraps at both ends
    // in the design, and a pointer can only name a row that exists, so this only
    // normalises an index left over from a catalog refresh.
    set({ versionIndex: wrap(index, versionCount(get())) })
  }

  const moveVersion = (delta: number): void => {
    const state = get()
    const count = versionCount(state)
    // Nothing to step through before the catalog arrives; wrapping a count of zero
    // would move the index off the list.
    if (count === 0) return
    set({ versionIndex: wrap(state.versionIndex + delta, count) })
  }

  const goToInstall = (): void => {
    set({ screen: 'install', panelOpen: false })
  }

  const goToMenu = (): void => {
    const state = get()
    if (!state.config?.onboardingComplete) void get().patchConfig({ onboardingComplete: true })
    // The cursor returns to the title the user came from, so backing out of a
    // version list does not lose their place. Keeping `menuIndex` and `titleId` in
    // step is the same invariant `setMenuIndex` maintains.
    const index = state.catalog?.titles.findIndex((title) => title.id === state.titleId) ?? -1
    set({
      screen: 'menu',
      panelOpen: false,
  settingsOpen: false,
  settingsIndex: 0,
      menuIndex: index < 0 ? state.menuIndex : index
    })
  }

  const goToVersion = (titleId: TitleId, versionIndex?: number): void => {
    const state = get()
    set({
      screen: 'version',
      titleId,
      // The export's version screen mounts on its first row
      // (VersionSelectPage.tsx:37, `useState(0)`), so entering a title — including
      // coming back from a game — starts at row 0 unless a caller names a row.
      versionIndex: wrap(versionIndex ?? 0, versionCount(state, titleId)),
      // A fresh entry never has the options panel up: the legacy `ScreenLaunch`
      // reset its option index on every `OnEnter`, and this screen is that surface.
      panelOpen: false,
  settingsOpen: false,
  settingsIndex: 0,
      panelOptionIndex: 0
    })
  }

  const goToGameplay = (titleId: TitleId, versionId: string): void => {
    // Navigation only. Whether a process is actually running is the process's fact
    // (`gameStatus`, written by `launch` and by `game:exit`), not this call's.
    set({ screen: 'gameplay', panelOpen: false, gameplay: { titleId, versionId } })
  }

  // -- launch panel --------------------------------------------------------

  const openPanel = (): void => {
    // A fresh panel starts on its first row, exactly as the legacy
    // `ScreenLaunch::OnEnter` reset `optionIndex = 0`.
    set({ panelOpen: true, panelOptionIndex: 0 })
  }

  const closePanel = (): void => {
    set({ panelOpen: false })
  }

  const setPanelOption = (index: number): void => {
    const derived = currentVersion(get())
    if (derived === null) return
    // Wrapped, like the legacy `(optionIndex + 1) % 3` cursor and like the fold
    // LaunchPanel applies to the index it is handed. A stale index from a different
    // version lands on a real row instead of on none.
    set({ panelOptionIndex: wrap(index, panelOptions(derived.version).length) })
  }

  const movePanelOption = (delta: number): void => {
    setPanelOption(get().panelOptionIndex + delta)
  }

  /**
   * Moves the value of the row under the cursor. Left, Right and Confirm all land
   * here, because on a two-value row they are the same gesture — which is why the
   * legacy screen toggled on `NavigateLeft() || NavigateRight()` and on Enter.
   */
  const toggleOption = (option: 'mode' | 'crt' | 'scenario'): void => {
    const derived = currentVersion(get())
    if (derived === null) return
    const version = derived.version

    switch (option) {
      case 'mode': {
        // `panelOptions` only yields this row for a launchable version that has mod
        // files and does not require them, so the toggle is always legal here; the
        // guard states the rule for the case where the row changes under the cursor
        // (a catalog refresh arriving between the keypress and this call).
        if (!version.hasMod || version.requiresMod) return
        void get().setMode(derived.mode === 'enhanced' ? 'original' : 'enhanced')
        return
      }

      case 'crt': {
        // The CRT filter is a whole-launcher display setting rather than a property
        // of this version, so it goes through the config. `CRT_DEFAULTS` is what the
        // overlay uses when no config has arrived yet; LaunchPanel applies the same
        // fallback to the value it draws.
        const enabled = get().config?.crtEnabled ?? CRT_DEFAULTS.enabled
        void get().patchConfig({ crtEnabled: !enabled })
        return
      }

      case 'scenario': {
        if (derived.mode === 'enhanced') return
        const available = version.scenarios
        // Two scenarios are what makes this a choice; one is a fact.
        if (available.length < 2) return
        const from = derived.scenario === null ? -1 : available.indexOf(derived.scenario)
        // `.at()` rather than an indexed read, so "there is nothing to move to" is
        // stated in the type instead of asserted away.
        const next = available.at((from + 1) % available.length) ?? null
        if (next === null) return
        void get().setScenario(next)
        return
      }
    }
  }

  // -- settings surface ----------------------------------------------------

  /**
   * Opens the settings surface from the launch panel's SETTINGS row.
   *
   * The panel closes on the way in: settings is a full surface rather than a second overlay
   * stacked on the first, so one Escape always leaves it and there is never a question of
   * which layer a key belongs to.
   */
  /**
   * The achievements surface, and the list it shows.
   *
   * Opened from the settings surface rather than by a key of its own: the three designed screens
   * share one canonical action set (input/actions.ts), and a key of its own would change that set
   * for every screen. The list is fetched on open rather than at boot, so the main process's work
   * stays proportional to what the player asked for - and a rejected call leaves the surface
   * showing its empty state, because reference material must not be able to break the launcher.
   */
  /**
   * The RetroAchievements login panel.
   *
   * Opening and closing are all this needs: the fields keep their own draft state and the browser
   * owns Tab between them, so the launcher has no field navigation to get wrong. Saving writes
   * through the same patchConfig every other setting uses.
   */
/**
 * Ticks or unticks one RetroAchievements entry.
 *
 * Written through `patchConfig` like every other setting, so a tick survives a restart.
 */
  const toggleRetroTick = (id: number): void => {
    const ticked = get().config?.raTicked ?? []
    const next = ticked.includes(id) ? ticked.filter((entry) => entry !== id) : [...ticked, id]
    void get().patchConfig({ raTicked: next })
  }

  const openCredentials = (): void => {
    set({ credentialsOpen: true, settingsOpen: false, achievementsOpen: false, panelOpen: false })
  }

  const closeCredentials = (): void => {
    set({ credentialsOpen: false, settingsOpen: true })
  }

  const saveCredentials = (user: string, key: string): void => {
    void (async () => {
      const outcome = key === ''
        ? await invoke(INVOKE_CHANNELS.credentialsRemove, undefined)
        : await invoke(INVOKE_CHANNELS.credentialsSet, { user, key })
      if (outcome.ok && outcome.value.ok) {
        set({ config: outcome.value.config, credentialsOpen: false, settingsOpen: true })
      } else {
        get().showError({ title: 'CREDENTIAL NOT SAVED', message: outcome.ok && !outcome.value.ok ? outcome.value.message : 'Secure storage is unavailable.' })
      }
    })()
  }

  /**
   * Fetches one RetroAchievements badge, once, and keeps the answer either way.
   *
   * `null` is recorded as deliberately as a `data:` URL is: "asked, and there is no art" is what stops a
   * row from re-asking on every render, which on a 130-row list would be a fetch per frame. The row then
   * draws its letter slot — the fallback the whole cache is built around, since RA's art cannot be shipped
   * with the launcher and a badge that cannot be fetched must cost nothing.
   *
   * No in-flight guard here: `readBadge` in the main process already single-flights per name, so three rows
   * sharing a badge reach one fetch rather than three.
   */
  const loadBadge = async (name: string): Promise<void> => {
    if (name === '') return

    const state = get()
    if (Object.prototype.hasOwnProperty.call(state.badges, name)) return

    const outcome = await invoke(INVOKE_CHANNELS.achievementsBadge, { name })
    set((current) => ({ badges: { ...current.badges, [name]: outcome.ok ? outcome.value : null } }))
  }

  const openAchievements = async (): Promise<void> => {
    const gameId = get().titleId
    const title = get().catalog?.titles.find((candidate) => candidate.id === gameId)?.name ?? ''
    set({ achievementsOpen: true, achievements: null, raAchievements: null, achievementsTitle: title, settingsOpen: false, panelOpen: false, credentialsOpen: false })
    const outcome = await invoke(INVOKE_CHANNELS.achievementsList, { gameId })
    if (get().achievementsOpen) set({ achievements: outcome.ok ? outcome.value : [] })

    // The RetroAchievements half, fetched on the same open. It leaves the machine, so its failure
    // is its own: an empty list either way, and the surface tells the two apart by asking whether a
    // key is configured rather than by guessing from the length.
    const retro = await invoke(INVOKE_CHANNELS.achievementsRetro, { gameId })
    if (get().achievementsOpen) set({ raAchievements: retro.ok ? retro.value : [] })
  }

  const closeAchievements = (): void => {
    set({ achievementsOpen: false })
  }

  /**
   * Marks one of the launcher's own achievements unlocked, because the player said so.
   *
   * This is the *only* producer of an unlock the launcher has, and that is a measured limitation rather
   * than a shortcut: these are native Windows builds, so RetroAchievements cannot report anything for
   * them (it reads an emulator's memory) and the launcher does not read game memory. A click is
   * therefore a statement by the player — the same kind of statement a tick on the RA list already is —
   * and `src/main/ipc.ts` broadcasts the result, which is what raises the toast. On a launch with the
   * in-game overlay linked, that toast is drawn inside the game's own frame.
   *
   * The list is updated from what *main* answers rather than from the request, so the date shown is the
   * one that was persisted.
   */
  const unlockAchievement = async (id: string): Promise<void> => {
    const outcome = await invoke(INVOKE_CHANNELS.achievementsUnlock, { id })
    if (!outcome.ok || outcome.value === null) return

    const unlocked = outcome.value
    set((state) => ({
      achievements:
        state.achievements === null
          ? null
          : state.achievements.map((row) => (row.id === unlocked.id ? unlocked : row))
    }))
  }

  const openPreferences = (page: 'display' | 'controls' | 'launcher-controls'): void => {
    set({ preferences: page, panelOpen: false, settingsOpen: false, achievementsOpen: false, credentialsOpen: false })
  }
  const closePreferences = (): void => {
    const fromLauncher = get().preferences === 'launcher-controls'
    set({ preferences: null, settingsOpen: fromLauncher, panelOpen: !fromLauncher && get().screen === 'version' })
  }

  const openSettings = (): void => {
    set({ settingsOpen: true, panelOpen: false, achievementsOpen: false, credentialsOpen: false })
  }

  const closeSettings = (): void => {
    set({ settingsOpen: false })
  }

  const moveSettingsRow = (delta: number): void => {
    set({ settingsIndex: wrap(get().settingsIndex + delta, SETTINGS_ROWS.length) })
  }

  /**
   * Moves the value of the row under the cursor.
   *
   * One action for both arrow keys and Enter, exactly like the panel's own rows: on a
   * two-value row and on a stepped range they are the same gesture. The numeric rows go
   * through `patchConfig`, so a change is persisted as it is made and the sanitised answer
   * from main is what the surface then draws.
   */
  const changeSetting = (delta: number): void => {
    const row = SETTINGS_ROWS[wrap(get().settingsIndex, SETTINGS_ROWS.length)]
    if (row === undefined) return
    const config = get().config

    switch (row.id) {
      case 'crt':
        void get().patchConfig({ crtEnabled: !(config?.crtEnabled ?? CRT_DEFAULTS.enabled) })
        return
      case 'ingameCrt':
        void get().patchConfig({ inGameCrt: !(config?.inGameCrt ?? false) })
        return
      case 'ingameOverlay':
        // The `?? true` matters: this default is on, unlike every other toggle on this surface, so
        // falling back to false here would flip the setting the first time the row was touched.
        void get().patchConfig({ inGameOverlay: !(config?.inGameOverlay ?? true) })
        return
      case 'steamLaunch':
        // Handing a launch to Steam trades this launcher's process tracking for Steam's playtime and
        // overlay, so it is a choice the player makes rather than a default.
        void get().patchConfig({ launchThroughSteam: !(config?.launchThroughSteam ?? false) })
        return
      case 'window':
        // One cycle, either arrow, in the order the values read: get out of the way, put the game
        // inside the launcher, or leave the launcher up behind it. Two arrows that did different
        // things would be the worse surprise.
        void get().patchConfig({ launchWindowMode: nextLaunchWindowMode(config?.launchWindowMode ?? 'minimise') })
        return
      case 'scanlines':
        void get().patchConfig({
          scanlineIntensity: clamp01((config?.scanlineIntensity ?? 0) + delta * SETTINGS_STEP.scanlines)
        })
        return
      case 'curvature':
        void get().patchConfig({ curvature: clamp01((config?.curvature ?? 0) + delta * SETTINGS_STEP.curvature) })
        return
      case 'vignette':
        void get().patchConfig({
          crtVignette: clamp01((config?.crtVignette ?? 0) + delta * SETTINGS_STEP.vignette)
        })
        return
      case 'grain':
        void get().patchConfig({ crtGrain: clamp01((config?.crtGrain ?? 0) + delta * SETTINGS_STEP.grain) })
        return
      case 'master':
        void get().patchConfig({ masterVolume: clamp01((config?.masterVolume ?? 1) + delta * SETTINGS_STEP.volume) })
        return
      case 'sfx':
        void get().patchConfig({ sfxVolume: clamp01((config?.sfxVolume ?? 1) + delta * SETTINGS_STEP.volume) })
        return
      case 'music':
        void get().patchConfig({ musicVolume: clamp01((config?.musicVolume ?? 1) + delta * SETTINGS_STEP.volume) })
        return
      default:
        // `installRoot`, `redetect` and `reset` are actions, not values: there is
        // nothing for an arrow key to change.
        return
    }
  }

  /** Runs the row under the cursor: a value row steps, an action row does its thing. */
  const activateSetting = (): void => {
    const row = SETTINGS_ROWS[wrap(get().settingsIndex, SETTINGS_ROWS.length)]
    if (row === undefined) return

    switch (row.id) {
      case 'installRoot':
        void pickInstallRoot()
        return
      case 'redetect':
        void get().refreshCatalog()
        return
      case 'diagnostics':
        void invoke(INVOKE_CHANNELS.diagnosticsExport, undefined).then((outcome) => {
          get().showError({ title: 'DIAGNOSTICS', message: outcome.ok ? outcome.value.message : 'Export failed.' })
        })
        return
      case 'controls':
        get().openPreferences('launcher-controls')
        return
      case 'retroAccount':
        get().openCredentials()
        return
      case 'achievements':
        void get().openAchievements()
        return
      case 'reset':
        void get().resetConfig()
        return
      default:
        changeSetting(1)
    }
  }

  /**
   * The OS folder chooser, then the override.
   *
   * Main owns both halves — the dialog and the `gogPathOverride` write — so a cancelled
   * dialog cannot leave a half-applied setting behind. `null` is the cancel case, and the
   * only thing left to do here is to pick up the new catalog when a folder *was* chosen.
   */
  const pickInstallRoot = async (): Promise<void> => {
    if (get().busy !== null) return
    set({ busy: busyOnly('CHOOSING A FOLDER') })
    const outcome = await invoke(INVOKE_CHANNELS.catalogPickInstallRoot, undefined)
    set({ busy: null })

    if (!outcome.ok || outcome.value === null) return
    await get().refreshCatalog()
  }

  // -- settings ------------------------------------------------------------

  const setMode = async (mode: LaunchMode): Promise<void> => {
    const derived = currentVersion(get())
    if (derived === null) return

    const outcome = await invoke(INVOKE_CHANNELS.modesSet, { versionId: derived.version.id, mode })
    if (outcome.ok) {
      applyConfig(outcome.value)
      return
    }
    // No bridge: the choice still has to show up in the panel, so it is merged into
    // the in-memory config exactly as the main-process store would have.
    applyConfig(mergeMode(get().config, derived.version.id, mode))
  }

  const setScenario = async (scenario: Re2Scenario): Promise<void> => {
    const derived = currentVersion(get())
    if (derived === null) return

    const outcome = await invoke(INVOKE_CHANNELS.modesSet, {
      versionId: derived.version.id,
      scenario
    })
    if (outcome.ok) {
      applyConfig(outcome.value)
      return
    }
    applyConfig(mergeScenario(get().config, derived.version.id, scenario))
  }

  const patchConfig = async (patch: Partial<LauncherConfig>): Promise<void> => {
    const outcome = await invoke(INVOKE_CHANNELS.configPatch, patch)
    if (outcome.ok) {
      // The answer is the whole config, already sanitised on the main side, so it
      // replaces rather than merges: a field the patch dropped must not linger.
      applyConfig(outcome.value)
      return
    }
    // Shallow merge, the same rule the main-process store applies to the same patch
    // (`config-store.ts` `patch`: `{ ...current, ...partial }`), so an offline toggle
    // behaves like a persisted one. `Object.assign` is used rather than an object
    // spread so the merge is typed as a complete `LauncherConfig`: a spread of a
    // `Partial` leaves every field it touches optional.
    const base = get().config ?? offlineConfig()
    applyConfig(Object.assign({}, base, patch))
  }

  const resetConfig = async (): Promise<void> => {
    const outcome = await invoke(INVOKE_CHANNELS.configReset, undefined)
    // Offline, "reset" still means the defaults.
    applyConfig(outcome.ok ? outcome.value : offlineConfig())
  }

  // -- catalog -------------------------------------------------------------

  const refreshCatalog = async (): Promise<void> => {
    // No `busy` here on purpose: `BusyState` is the launch panel's readout
    // (LaunchPanelProps.busy), and a catalog read is not a launch. The boot screen
    // is `ready`, which is what a screen uses to tell "still loading" from "loaded".
    const outcome = await invoke(INVOKE_CHANNELS.catalogRefresh, undefined)
    if (!outcome.ok) {
      // Keep the catalog that is already on screen: a failed refresh is no reason to
      // empty the launcher.
      console.warn('[launcher] the catalog could not be refreshed; keeping the current one.')
      return
    }
    applySnapshot(outcome.value)
  }

  const setInstallRoot = async (path: string): Promise<void> => {
    const outcome = await invoke(INVOKE_CHANNELS.catalogSetInstallRoot, { path })
    if (!outcome.ok) {
      // Offline there is nothing to remember: the override only changes what
      // detection would find, and detection is the main process's job.
      console.warn(`[launcher] the install root could not be set to "${path}".`)
      return
    }
    // One answer carries both facts: the new rows and the config whose
    // `gogPathOverride` produced them (src/main/ipc.ts `catalog:set-install-root`).
    applySnapshot(outcome.value)
  }

  // -- launch --------------------------------------------------------------

  const launch = async (configure = false): Promise<void> => {
    const state = get()

    // One launch at a time. The main process refuses a concurrent sequence
    // (`runLaunch` -> `game-already-running`) and the panel is already a readout, but
    // this is what stops a double Confirm from clearing the first readout.
    if (state.busy !== null) return

    const title = currentTitle(state)
    const derived = currentVersion(state)
    if (title === null || derived === null) {
      get().showError({ title: 'LAUNCH FAILED', message: 'No game is selected.' })
      return
    }

    const version = derived.version
    if (!canLaunch(version)) {
      // The row already knows why it cannot start — a missing install, a concept row
      // that was never released — and that sentence beats anything invented here.
      get().showError({
        title: 'LAUNCH FAILED',
        message: version.unavailableReason ?? version.stateReason ?? 'This version cannot be started.'
      })
      return
    }

    // Set before the call, never after: the phase events are pushed while the
    // request is in flight, and they need a readout to write their label into.
    set({ busy: busyOnly(LAUNCH_START_LABEL), error: null, modProgress: null, gameStatus: INITIAL_GAME_STATUS })

    const request: LaunchRequest = {
      configure,
      titleId: title.id,
      versionId: version.id,
      // The resolved mode/scenario, not the raw config: `resolveMode` is what pins a
      // version that requires the overlay, and main re-resolves the same way.
      mode: derived.mode,
      scenario: derived.scenario
    }

    const outcome = await invoke(INVOKE_CHANNELS.launch, request)
    if (!outcome.ok) {
      set({ busy: null })
      get().showError({
        title: 'LAUNCH FAILED',
        message: 'The launcher could not reach the game process. Restart the launcher and try again.'
      })
      return
    }

    const result: LaunchResult = outcome.value
    if (!result.ok) {
      set({ busy: null })
      get().showError({ ...errorForFailure(result.code), message: result.message })
      return
    }

    set({
      busy: null,
      modProgress: null,
      error: null,
      // The legacy screen popped itself on a successful launch, and the panel is
      // that surface: it closes here rather than reappearing behind the game view.
      panelOpen: false,
  settingsOpen: false,
  settingsIndex: 0,
      // The record Back uses to find its way to the row that is running.
      preferences: null,
      gameplay: { titleId: title.id, versionId: version.id },
      screen: 'gameplay',
      gameStatus: statusAfterLaunch(title.id, version.id)
    })
  }

  /**
   * Ends the running game, and says so if it cannot.
   *
   * The status is *not* set to stopped here. Main is the only thing that knows when the
   * process is gone, and it answers with `game:exit`; guessing first would show a
   * stopped game that is still running if the kill failed. `busy` is what makes the
   * wait visible instead.
   */
  const stopGame = async (): Promise<void> => {
    if (!get().gameStatus.running || get().busy !== null) return

    set({ busy: busyOnly('STOPPING THE GAME') })
    const outcome = await invoke(INVOKE_CHANNELS.gameStop, undefined)
    set({ busy: null })

    if (!outcome.ok) {
      get().showError({
        title: 'COULD NOT STOP',
        message: 'The launcher could not stop the game process. Close the game window itself.'
      })
    }
  }

  // -- overlays ------------------------------------------------------------

  const showError = (error: LauncherError): void => {
    set({ error })
  }

  const dismissError = (): void => {
    set({ error: null })
  }

  const pushAchievement = (achievement: Achievement): void => {
    const state = get()

    /*
     * The rules live in `@shared/toast-queue`, and they are tested there.
     *
     * What they say, in short: a duplicate of what is on screen or already queued is dropped; the
     * first unlock shows immediately; and while the in-game plugin owns the toast - linked, with a game
     * running - this window keeps the unlock but stays quiet, because the plugin is drawing it inside
     * the game's own frame. It is kept rather than dropped so that `onGameExit` and `onOverlayState`
     * can show it the moment the launcher is the surface the player is looking at.
     */
    const next = enqueueToast(
      { current: state.achievement, queue: state.achievementQueue },
      achievement,
      (state.overlayReason === 'connecting' || state.overlayReason === 'linked' || overlayOwnsToast(state.overlayAvailable, state.gameStatus.running))
    )

    // Identity means nothing changed, which is how a duplicate avoids a state write entirely.
    if (next.current === state.achievement && next.queue === state.achievementQueue) return
    set({ achievement: next.current, achievementQueue: next.queue })
    for (const [id, timer] of toastExpiry) {
      if (!next.queue.some((row) => row.id === id)) { clearTimeout(timer); toastExpiry.delete(id) }
    }
    for (const queued of next.queue) {
      if (toastExpiry.has(queued.id)) continue
      toastExpiry.set(queued.id, setTimeout(() => {
        set((current) => ({ achievementQueue: current.achievementQueue.filter((row) => row.id !== queued.id) }))
        toastExpiry.delete(queued.id)
      }, 30_000))
    }
  }

  const popAchievement = (): void => {
    const state = get()
    const next = nextToast({ current: state.achievement, queue: state.achievementQueue })
    set({ achievement: next.current, achievementQueue: next.queue })
    if (next.current) { clearTimeout(toastExpiry.get(next.current.id)); toastExpiry.delete(next.current.id) }
  }

  // -- input ---------------------------------------------------------------

  const handleAction = (action: InputAction, _device: InputDevice): void => {
    // Nothing here branches on the device: `InputAction` is the canonical intent
    // every source produces (contracts.ts), and `useActions` is what maps a key, a
    // pad or a pointer onto those six actions.
    set({ inputDevice: _device })
    const intent = resolveIntent(get(), action)
    // An action this screen does not answer makes no sound: feedback for a keypress
    // that did nothing would be a lie.
    if (intent === null) return

    // A handled action always makes its sound, including at the ends of the main
    // menu, where the cursor is clamped and therefore does not move: the design's
    // helper bar promises the key was read, and silence there reads as a dropped
    // input rather than as "there is nothing further right".
    sfx.play(SOUND_FOR[action])

    switch (intent.kind) {
      case 'open-preferences': get().openPreferences(intent.page); return
      case 'open-achievements': void get().openAchievements(); return
      case 'dismiss-error':
        get().dismissError()
        return
      case 'move-menu':
        get().moveMenu(intent.delta)
        return
      case 'open-version':
        get().goToVersion(intent.titleId)
        return
      case 'quit':
        quitApp()
        return
      case 'move-version':
        get().moveVersion(intent.delta)
        return
      case 'open-panel':
        get().openPanel()
        return
      case 'close-panel':
        get().closePanel()
        return
      case 'open-settings':
        get().openSettings()
        return
      case 'close-achievements':
        get().closeAchievements()
        return
      case 'close-settings':
        get().closeSettings()
        return
      case 'move-setting':
        get().moveSettingsRow(intent.delta)
        return
      case 'change-setting':
        get().changeSetting(intent.delta)
        return
      case 'activate-setting':
        get().activateSetting()
        return
      case 'move-option':
        get().movePanelOption(intent.delta)
        return
      case 'toggle-option':
        toggleOption(intent.option)
        return
      case 'launch':
        void get().launch()
        return
      case 'go-menu':
        get().goToMenu()
        return
      case 'go-version':
        get().goToVersion(intent.titleId)
        return
    }
  }

  // -- the initial load ----------------------------------------------------

  const init = async (): Promise<void> => {
    // Idempotent: the first call does the work and every later call joins it. A
    // second subscription would double every toast and every progress tick, and a
    // second fetch would race the first into the same fields.
    if (initPromise !== null) return initPromise

    initPromise = (async (): Promise<void> => {
      const subscriptions: ((() => void) | null)[] = [
        subscribe(EVENT_CHANNELS.modProgress, onModProgress),
        subscribe(EVENT_CHANNELS.launchPhase, onLaunchPhase),
        subscribe(EVENT_CHANNELS.gameExit, onGameExit),
        subscribe(EVENT_CHANNELS.catalogChanged, onCatalogChanged),
        subscribe(EVENT_CHANNELS.achievementUnlock, onAchievementUnlock),
        subscribe(EVENT_CHANNELS.overlayState, onOverlayState),
        subscribe(EVENT_CHANNELS.overlayDelivered, ({ id }) => {
          clearTimeout(toastExpiry.get(id)); toastExpiry.delete(id)
          set((state) => ({ achievementQueue: state.achievementQueue.filter((row) => row.id !== id), achievement: state.achievement?.id === id ? null : state.achievement }))
        }),
        subscribe(EVENT_CHANNELS.toast, (message) => get().showError({ title: message.title, message: message.message }))
      ]
      for (const unsubscribe of subscriptions) {
        if (unsubscribe !== null) eventSubscriptions.push(unsubscribe)
      }
      eventSubscriptions.push(() => { for (const timer of toastExpiry.values()) clearTimeout(timer); toastExpiry.clear() })

      // The catalog first, so nothing downstream has to guess whether the world has
      // arrived yet; `ready` is set with it, in one update, so a screen never sees
      // "ready but empty" as a transient state.
      const outcome = await invoke(INVOKE_CHANNELS.catalogGet, undefined)
      if (!outcome.ok) {
        // No bridge, or a bridge with no handler: the store still has to work, so it
        // continues with an empty catalog and the Install Status screen.
        console.warn('[launcher] no catalog could be read; starting with an empty catalog.')
      }
      const snapshot = outcome.ok ? outcome.value : offlineSnapshot()

      // The cursor opens on the title the config remembers (`game.last_selected` in
      // the legacy ini), which is the only reader of that field: without it the
      // launcher would forget the last game on every start.
      const remembered = snapshot.titles.findIndex(
        (title) => title.id === snapshot.config.lastSelectedTitle
      )
      const menuIndex = remembered >= 0 ? remembered : 0
      const openingTitle = snapshot.titles.at(menuIndex) ?? null

      set((state) => ({
        catalog: snapshot,
        config: snapshot.config,
        ready: true,
        menuIndex,
        titleId: openingTitle === null ? snapshot.config.lastSelectedTitle : openingTitle.id,
        versionIndex: 0,
        // Only the boot gate may move the screen: a slow first answer must not yank
        // the user out of a screen they are already using.
        screen:
          state.screen === 'boot'
            ? snapshot.needsInstallScreen || !snapshot.config.onboardingComplete
              ? 'install'
              : 'menu'
            : state.screen
      }))
    })()

    return initPromise
  }

  return {
    ...INITIAL_STATE,
    init,
    refreshCatalog,
    setInstallRoot,
    goToInstall,
    goToMenu,
    goToVersion,
    goToGameplay,
    setMenuIndex,
    moveMenu,
    setVersionIndex,
    moveVersion,
    openSettings,
    openPanel,
    closePanel,
    setPanelOption,
    moveSettingsRow,
    changeSetting,
    activateSetting,
    closeSettings,
    openAchievements,
    openPreferences,
    closePreferences,
    openCredentials,
    toggleRetroTick,
    closeCredentials,
    saveCredentials,
    closeAchievements,
    unlockAchievement,
    loadBadge,
    movePanelOption,
    setMode,
    setScenario,
    patchConfig,
    resetConfig,
    launch,
    stopGame,
    dismissError,
    showError,
    pushAchievement,
    popAchievement,
    handleAction
  }
})

/**
 * Non-reactive accessor for imperative handlers (contracts.ts: "Raw accessor for
 * imperative handlers"). `getState()` returns the live store object, so a caller
 * that only needs one action does not have to subscribe to anything.
 */
export function launcherStore(): LauncherStore {
  return store.getState()
}

/**
 * Selector hook: `useLauncher((state) => state.screen)`. Typed as the frozen
 * `LauncherHook` so a component's selector is checked against `LauncherStore`
 * rather than against whichever store instance this module happens to hold.
 */
export const useLauncher: LauncherHook = store

/**
 * A hot reload re-evaluates this module, which would leave the previous instance's
 * bridge listeners attached — each one pushing into a store nobody renders, so
 * every toast and every progress tick would arrive twice. Dropping them is what
 * keeps `init()`'s "subscribe once" promise true across a reload.
 */
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    for (const unsubscribe of eventSubscriptions.splice(0)) unsubscribe()
  })
}
