/**
 * The composition root.
 *
 * This is the only place that knows which surfaces make up a screen and in what
 * order they stack. Every part of it is deliberately thin: the screens own their
 * layout, the overlays own their appearance, and the store owns what a key press
 * means — so the shell has exactly four jobs.
 *
 *  1. Bootstrap. `init()` loads the catalog and config from the main process
 *     (the equivalent of `App::Init` in the C++ launcher: detect installs,
 *     validate them, pick the first screen). Until it resolves there is literally
 *     no state to draw, so the shell shows a flat canvas and nothing else.
 *  2. Compose. The backdrop, the active screen, the modal surfaces and the CRT
 *     pass, in the order the legacy render pipeline drew them: UI first, then the
 *     achievement popup, then the CRT filter over everything
 *     (`git show HEAD:src/core/app.cpp`, `App::Run`).
 *  3. Route. `SCREENS` maps the store's ScreenId to a component. Screens take no
 *     props by contract, so this stays a lookup rather than a switch.
 *  4. Translate user gestures into the two things the shell owns: audio unlock
 *     (a browser will not start audio without a real gesture) and the canonical
 *     input actions, which are forwarded to the store untouched.
 */
import { useEffect, useRef } from 'react'
import type { ComponentType } from 'react'
import { useShallow } from 'zustand/shallow'

import type { ScreenId } from '@shared/types'
import { useSfx } from '@renderer/audio/useSfx'
import { Backdrop } from '@renderer/components/Backdrop'
import { currentVersion } from '@renderer/data/derive'
import { BACKDROP } from '@renderer/data/design'
import { useActions } from '@renderer/input/useActions'
import { AchievementToast } from '@renderer/overlays/AchievementToast'
import { CrtOverlay } from '@renderer/overlays/CrtOverlay'
import { ErrorDialog } from '@renderer/overlays/ErrorDialog'
import { Achievements } from '@renderer/overlays/Achievements'
import { Credentials } from '@renderer/overlays/Credentials'
import { Settings } from '@renderer/overlays/Settings'
import { InstallStatus } from '@renderer/overlays/InstallStatus'
import { LaunchPanel } from '@renderer/overlays/LaunchPanel'
import { Gameplay } from '@renderer/screens/Gameplay'
import { MainMenu } from '@renderer/screens/MainMenu'
import { VersionSelect } from '@renderer/screens/VersionSelect'
import { Stage } from '@renderer/stage/Stage'
import { useLauncher } from '@renderer/state/store'

/**
 * ScreenId -> surface, declared once.
 *
 * `Record<ScreenId, ...>` rather than a partial map on purpose: adding a screen
 * id to @shared/types must force a decision here instead of silently rendering
 * nothing. The two nulls are the two ids that are not their own component:
 *
 *   'boot'     the gate the store holds while `init()` is in flight; the shell's
 *              `!ready` surface below is what that state looks like.
 *   'install'  a full-screen surface drawn by the InstallStatus overlay, because
 *              the legacy launcher pushed it as its own screen
 *              (`git show HEAD:src/ui/screens/screen_install.cpp`) and the store
 *              needs to read the catalog to fill it in.
 */
const SCREENS: Record<ScreenId, ComponentType | null> = {
  boot: null,
  install: null,
  menu: MainMenu,
  version: VersionSelect,
  gameplay: Gameplay
}

export function App() {
  const ready = useLauncher((state) => state.ready)
  const screen = useLauncher((state) => state.screen)
  const catalog = useLauncher((state) => state.catalog)
  const config = useLauncher((state) => state.config)
  const panelOpen = useLauncher((state) => state.panelOpen)
  const panelOptionIndex = useLauncher((state) => state.panelOptionIndex)
const openSettings = useLauncher((state) => state.openSettings)
const settingsOpen = useLauncher((state) => state.settingsOpen)
  const achievementsOpen = useLauncher((state) => state.achievementsOpen)
  const achievements = useLauncher((state) => state.achievements)
  const achievementsTitle = useLauncher((state) => state.achievementsTitle)
  const closeAchievements = useLauncher((state) => state.closeAchievements)
  const raAchievements = useLauncher((state) => state.raAchievements)
  // Whether RA can be asked at all. Read from the config rather than inferred from the list being
  // empty, because "no key yet" and "RA has nothing for this game" are different messages.
  const raConnected = useLauncher((state) => (state.config?.raKey ?? '') !== '')
  const credentialsOpen = useLauncher((state) => state.credentialsOpen)
  const raUser = useLauncher((state) => state.config?.raUser ?? '')
  const raKey = useLauncher((state) => state.config?.raKey ?? '')
  const saveCredentials = useLauncher((state) => state.saveCredentials)
  const closeCredentials = useLauncher((state) => state.closeCredentials)
  /**
   * The ticked list, selected the way the achievement queue above is and for the same reason.
   *
   * The selector returns `state.config` - an object the store owns, with a stable identity - and the
   * fallback is applied *outside* it. Writing `(state) => state.config?.raTicked ?? []` puts a freshly
   * built array inside the subscription, whose identity changes on every render, and
   * `useSyncExternalStore` then re-renders forever: the launcher never leaves its boot screen. That
   * was a real failure in this file, not a hypothetical one.
   */
  const raTicked = useLauncher((state) => state.config)?.raTicked ?? []
  const toggleRetroTick = useLauncher((state) => state.toggleRetroTick)
  const busy = useLauncher((state) => state.busy)
  const error = useLauncher((state) => state.error)

  /**
   * The toast shows the head of the achievement queue. The selector returns an
   * element of an array the store owns rather than a freshly built object, so its
   * identity is stable between renders and React's useSyncExternalStore is happy
   * with it. If the store ever promotes that head into `LauncherState.achievement`
   * instead of leaving it in the queue, this single line is the only thing that
   * has to change.
   */
  const toastAchievement = useLauncher((state) => state.achievementQueue[0] ?? null)

  const init = useLauncher((state) => state.init)
  const goToMenu = useLauncher((state) => state.goToMenu)
  const closePanel = useLauncher((state) => state.closePanel)
  const setPanelOption = useLauncher((state) => state.setPanelOption)
  const setMode = useLauncher((state) => state.setMode)
  const setScenario = useLauncher((state) => state.setScenario)
  const launch = useLauncher((state) => state.launch)
  const dismissError = useLauncher((state) => state.dismissError)
  const popAchievement = useLauncher((state) => state.popAchievement)

  // Keyboard, gamepad and pointer gestures become the canonical action set here
  // and are forwarded without interpretation: what "back" means on the version
  // screen is the store's decision, not the shell's.
  useActions(useLauncher((state) => state.handleAction))

  /**
   * The selected version and its resolved mode/scenario, needed by the launch
   * panel. `currentVersion` builds a new object on every call, and a selector
   * that returns a fresh object on each read makes useSyncExternalStore re-render
   * forever ("The result of getSnapshot should be cached"), so the selector is
   * wrapped in zustand's shallow comparator: it keeps the previous object while
   * the version, mode and scenario are unchanged.
   */
  const current = useLauncher(useShallow(currentVersion))

  const sfx = useSfx()

  /**
   * The gesture listeners below are installed once for the app's lifetime, so
   * they must not capture a stale `sfx` object: the latest one is kept in a ref
   * and read at event time. That also means `useSfx`'s own memoisation — or lack
   * of it — cannot turn the listeners into a re-registering pair.
   */
  const sfxRef = useRef(sfx)
  useEffect(() => {
    sfxRef.current = sfx
  }, [sfx])

  useEffect(() => {
    /**
     * An AudioContext starts suspended and may only be resumed from a user
     * gesture, and the launcher's first sound is the cursor/confirm blip caused
     * by that very gesture. Listening at the window level catches it on the way
     * up (`pointerdown` and `keydown` both bubble), which is after the store's
     * action layer has already reacted — so the first sound is audible instead of
     * being dropped. `once` on both listeners makes this a one-shot: after the
     * first gesture the context stays unlocked for the session.
     */
    const unlock = (): void => {
      sfxRef.current.unlock()
    }

    window.addEventListener('pointerdown', unlock, { once: true })
    window.addEventListener('keydown', unlock, { once: true })

    return () => {
      window.removeEventListener('pointerdown', unlock)
      window.removeEventListener('keydown', unlock)
    }
  }, [])

  /**
   * Mount latch. A ref rather than a plain call in the effect: `<StrictMode>`
   * intentionally runs mount effects twice in development, and `init()` is a
   * round trip that makes the main process scan the disk for three GOG installs.
   * Issuing that twice would race two catalog snapshots against each other for
   * no benefit. A ref survives StrictMode's double-invocation (it is the same
   * component instance) but not a real remount, which is exactly the lifetime
   * wanted: one bootstrap per mounted app.
   */
  const started = useRef(false)

  useEffect(() => {
    if (started.current) return
    started.current = true
    void init()
  }, [init])

  if (!ready) {
    /**
     * Before the first catalog snapshot resolves, `catalog` and `config` are both
     * null, so no screen could draw itself. A flat canvas surface keeps the
     * window in the design's own colour instead of showing an empty document.
     */
    return <div className="bg-[#0F0F0F] fixed inset-0" />
  }

  // The main menu is the only screen blended at .20; every screen below it drops
  // to .10 and pins the layer 40.23px lower (data/design.ts BACKDROP, and the
  // two class recipes in `.ref/designref/src/imports/MainMenu.tsx:35` versus
  // `MainMenuRe1.tsx:179`).
  const isMenu = screen === 'menu'
  const Screen = SCREENS[screen]

  return (
    <Stage>
      <Backdrop
        opacity={isMenu ? BACKDROP.opacityMenu : BACKDROP.opacityScreen}
        // `undefined` is the design's "centre vertically", i.e. the menu case;
        // the prop is only passed for the screens that are shifted.
        bottomOffset={isMenu ? undefined : BACKDROP.bottomOffset}
      />

      {Screen === null ? null : <Screen />}

      {screen === 'install' && catalog !== null ? (
        <InstallStatus
          titles={catalog.titles}
          configPath={catalog.configPath}
          appDir={catalog.appDir}
          // "Continue" walks into the main menu whether or not every title is
          // installed, which is what the legacy install screen did
          // (`screen_install.cpp`, `OnInput`: PopScreen then PushScreen(ScreenTitle)).
          onContinue={goToMenu}
        />
      ) : null}
      {/* Above everything: the login panel is modal, and Escape or Save is the way out. */}
      {credentialsOpen ? (
        <Credentials
          key={raKey}
          onCancel={closeCredentials}
          onSave={saveCredentials}
          user={raUser}
        />
      ) : null}

      {panelOpen && current !== null ? (
        <LaunchPanel
          version={current.version}
          mode={current.mode}
          scenario={current.scenario}
          optionIndex={panelOptionIndex}
          busy={busy}
          onSelectOption={setPanelOption}
          // The store's setters are async (they persist through IPC), so the
          // promise is discarded explicitly rather than left floating.
          onSetMode={(mode) => {
            void setMode(mode)
          }}
          onSetScenario={(scenario) => {
            void setScenario(scenario)
          }}
          onLaunch={() => {
            void launch()
          }}
          onOpenSettings={openSettings}
          onClose={closePanel}
        />
      ) : null}
      {/* Above everything: the login panel is modal, and Escape or Save is the way out. */}
      {credentialsOpen ? (
        <Credentials
          key={raKey}
          onCancel={closeCredentials}
          onSave={saveCredentials}
          user={raUser}
        />
      ) : null}

      {/*
        The settings surface, over the screens and under the error dialog: it is reached from
        the launch panel, and a failure that happens while it is up (a folder that cannot be
        read, say) has to be reportable above it.
      */}
      {settingsOpen ? <Settings /> : null}
      {/* The achievements surface, over everything the settings surface sits over. */}
      {achievementsOpen ? (
        <Achievements
          achievements={achievements}
          onClose={closeAchievements}
          title={achievementsTitle}
          onToggleRa={toggleRetroTick}
          raTicked={raTicked}
          raAchievements={raAchievements}
          raConnected={raConnected}
        />
      ) : null}
      {/* Above everything: the login panel is modal, and Escape or Save is the way out. */}
      {credentialsOpen ? (
        <Credentials
          key={raKey}
          onCancel={closeCredentials}
          onSave={saveCredentials}
          user={raUser}
        />
      ) : null}

      {error === null ? null : <ErrorDialog error={error} onDismiss={dismissError} />}

      {/*
        Always mounted, with a nullable achievement: that is what the prop type
        declares, and it keeps the overlay's own entrance/exit state (and any
        sound cue) inside the component instead of being thrown away and rebuilt
        on every unlock. The overlay owns the consequence — while the queue is
        empty it must paint nothing and must not intercept pointer events, or a
        quiet session would leave an invisible layer over the menu.
      */}
      <AchievementToast achievement={toastAchievement} onDone={popAchievement} />

      {/*
        Last, over everything. The legacy pipeline drew the CRT filter after
        `UISystem::Draw()` *and* `AchievementOverlay::Draw()`
        (`git show HEAD:src/core/app.cpp`), so scanlines and vignette sit on top
        of the dialogs too. It needs a resolved config, which `ready` guarantees.
      */}
      {config === null ? null : <CrtOverlay config={config} />}
    </Stage>
  )
}

export default App
