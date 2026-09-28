/**
 * Settings: everything the launcher can be told, on one surface.
 *
 * The concept has no settings frame, so this is an addition, and it is reached from a
 * `SETTINGS` row in the launch panel rather than from a key or a new helper-bar group — that
 * choice keeps the three designed screens pixel-identical at rest, which is what
 * `tools/check-fidelity.mjs` guards.
 *
 * Every row is live rather than staged: a change is patched into the config immediately, the
 * same way the launch panel's own CRT row works, and the store is what talks to main. There is
 * deliberately no Apply/Cancel pair, because a settings screen that can be left in a state
 * that differs from what is saved is a second, worse source of truth.
 *
 * The row idiom is the launch panel's, copied as class strings: a 48px row, `#999` for the
 * rows that are not under the cursor and white for the one that is, the design's 8px corner
 * with the 8.5px selection hairline. Two surfaces that are the same kind of thing should look
 * like the same kind of thing, and the panel's row is the closest thing the concept has to a
 * setting.
 */
import { useEffect, useRef, useState } from 'react'

import {
  HINTS_SETTINGS,
  SETTINGS_LABEL,
  SETTINGS_ROWS,
  SETTINGS_STEP,
  clamp01
} from '@renderer/data/design'
import type { SettingsRow } from '@renderer/data/design'
import { HelperBar } from '@renderer/components/HelperBar'
import { isPointerMovement } from '@renderer/input/useHoverSelect'
import { useLauncher } from '@renderer/state/store'
import type { LauncherConfig } from '@shared/types'

function percent(value: number): string {
  return `${String(Math.round(clamp01(value) * 100))}%`
}

/**
 * What a row shows on the right.
 *
 * Exported so a test can assert the readout without re-deriving it: the surface's whole job is
 * to show the configuration, and a test that recomputes the text would agree with a bug.
 */
export function settingsValue(row: SettingsRow, config: LauncherConfig | null): string {
  if (config === null) return ''
  switch (row.id) {
    case 'crt':
      return config.crtEnabled ? SETTINGS_LABEL.on : SETTINGS_LABEL.off
    case 'scanlines':
      return percent(config.scanlineIntensity)
    case 'curvature':
      return percent(config.curvature)
    case 'vignette':
      return percent(config.crtVignette)
    case 'grain':
      return percent(config.crtGrain)
    case 'master':
      return percent(config.masterVolume)
    case 'sfx':
      return percent(config.sfxVolume)
    case 'music':
      return percent(config.musicVolume)
    case 'ingameCrt':
      // The honest readout: the setting is on, but with nothing injected there is no file to
      // write it into, so saying ON alone would promise an effect that cannot happen.
      return config.inGameCrt ? SETTINGS_LABEL.on : SETTINGS_LABEL.off
    case 'window':
      return config.launchWindowMode === 'stay' ? SETTINGS_LABEL.stay : SETTINGS_LABEL.minimise
    case 'installRoot':
      // The override is a path; empty means detection's own search order, which is worth
      // naming rather than leaving blank.
      return config.gogPathOverride === '' ? SETTINGS_LABEL.auto : config.gogPathOverride
    case 'redetect':
    case 'reset':
      return ''
    case 'achievements':
      return ''
  }
}

/**
 * How much a row moves for one arrow press, or null when it is not a numeric range.
 *
 * The one place the increments live, so the readout and the change cannot disagree.
 */
export function settingsStep(row: SettingsRow, config: LauncherConfig | null): number | null {
  if (config === null) return null
  switch (row.id) {
    case 'scanlines':
      return SETTINGS_STEP.scanlines
    case 'curvature':
      return SETTINGS_STEP.curvature
    case 'vignette':
      return SETTINGS_STEP.vignette
    case 'grain':
      return SETTINGS_STEP.grain
    case 'master':
    case 'sfx':
    case 'music':
      return SETTINGS_STEP.volume
    default:
      return null
  }
}

export function Settings() {
  const config = useLauncher((state) => state.config)
  const index = useLauncher((state) => state.settingsIndex)
  const moveSettingsRow = useLauncher((state) => state.moveSettingsRow)
  const activateSetting = useLauncher((state) => state.activateSetting)
  const closeSettings = useLauncher((state) => state.closeSettings)
  const resetConfig = useLauncher((state) => state.resetConfig)

  /**
   * Reset is the one row that destroys something, so it asks twice.
   *
   * The confirmation is local state, not a store field: it lives exactly as long as the
   * cursor stays on that row and nothing else needs to see it. Moving the cursor away, or
   * running anything else, clears it.
   */
  const [confirmReset, setConfirmReset] = useState(false)

  const rootRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    // Focused on open so the dialog's own Escape handler is reachable after a pointer click,
    // the same reason the launch panel focuses itself. Rows are not focusable.
    rootRef.current?.focus()
  }, [])

  const focused = SETTINGS_ROWS[index] ?? SETTINGS_ROWS[0]

  return (
    <div
      className="absolute bg-[#0f0f0f] flex flex-col inset-0"
      data-figma-node="settings"
      aria-label="Launcher settings"
      role="dialog"
      tabIndex={-1}
      ref={rootRef}
    >
      <div className="flex flex-col flex-[1_0_0] min-h-px min-w-px px-[180px] py-[80px] relative">
        <p className="font-['Actor:Regular',sans-serif] leading-none not-italic text-[#ccc] text-[32px]">
          SETTINGS
        </p>
        <p
          className="font-['Actor:Regular',sans-serif] leading-none not-italic mt-[10px] text-[#999] text-[20px]"
          data-figma-node="settings-hint"
        >
          {confirmReset ? SETTINGS_LABEL.resetDetail : 'Changes are saved as you make them.'}
        </p>

        <div className="flex flex-col gap-[8px] mt-[28px] w-full" data-figma-node="settings-rows">
          {SETTINGS_ROWS.map((row, rowIndex) => {
            const selected = rowIndex === index
            const textClass = selected ? 'text-white' : 'text-[#999]'
            const value =
              row.id === 'reset' && confirmReset ? SETTINGS_LABEL.resetConfirm : settingsValue(row, config)

            return (
              <div
                aria-label={value === '' ? row.label : `${row.label}: ${value}`}
                className={`flex h-[48px] items-center px-[20px] relative w-full cursor-pointer${
                  selected ? ' bg-[rgba(255,255,255,0.063)] rounded-[8px]' : ''
                }`}
                data-name={`setting-${row.id}`}
                key={row.id}
                onClick={() => {
                  // Hover first, then act, exactly as the menu cards do: the cursor must
                  // already be on the row that is about to change.
                  if (!selected) {
                    moveSettingsRow(rowIndex - index)
                    setConfirmReset(false)
                    return
                  }
                  if (row.id === 'reset') {
                    if (!confirmReset) {
                      setConfirmReset(true)
                      return
                    }
                    setConfirmReset(false)
                    void resetConfig()
                    return
                  }
                  setConfirmReset(false)
                  activateSetting()
                }}
                /**
                 * `onMouseMove`, not `onMouseEnter`.
                 *
                 * Enter fires when a row appears *under* a stationary pointer, so opening this
                 * surface while the mouse happens to rest over it moved the cursor before the
                 * first keypress — the keyboard's first arrow then acted on a row nobody chose.
                 * A browser only sends `mousemove` for actual movement, which is exactly the
                 * rule wanted here: the cursor follows a pointer that moves, and stays where
                 * the keyboard left it otherwise.
                 */
                onMouseMove={(event) => {
                  // The same rule the cards and the version rows use: hover acts only when the
                  // pointer's coordinates actually change, so an event describing where the cursor
                  // already was cannot move it. See useHoverSelect.
                  if (!isPointerMovement({ x: event.clientX, y: event.clientY })) return
                  if (selected) return
                  moveSettingsRow(rowIndex - index)
                  setConfirmReset(false)
                }}
                role="button"
              >
                <p
                  className={`font-['Actor:Regular',sans-serif] leading-none not-italic shrink-0 text-[22px] ${textClass}`}
                >
                  {row.label}
                </p>
                <p
                  className={`font-['Actor:Regular',sans-serif] leading-none ml-auto not-italic overflow-clip pl-[16px] text-right text-ellipsis whitespace-nowrap ${
                    row.id === 'installRoot' ? 'text-[16px]' : 'text-[22px]'
                  } ${textClass}`}
                  data-figma-node={`setting-value-${row.id}`}
                >
                  {value}
                </p>
                {selected ? (
                  <div
                    aria-hidden="true"
                    className="absolute border border-[#4d4d4d] border-solid inset-[-0.5px] pointer-events-none rounded-[8.5px]"
                  />
                ) : null}
              </div>
            )
          })}
        </div>

        <p
          className="font-['Actor:Regular',sans-serif] leading-none not-italic mt-auto text-[#999] text-[20px]"
          data-figma-node="settings-focused"
        >
          {focused === undefined ? '' : `FOCUSED: ${focused.label.toUpperCase()}`}
        </p>
      </div>

      {/*
        The same helper bar every screen mounts, with the settings set: the panel's own hints
        plus Back. It is the bar, not a new one, so the key-cap artwork cannot drift.
      */}
      <div className="absolute bottom-0 h-[68px] left-0 w-[1920px]" data-figma-node="helper-bar">
        <HelperBar hints={HINTS_SETTINGS} />
      </div>

      {/* The panel's own Escape handling is a keyboard concern; the surface also offers a
          pointer way out, because a settings screen on a controller-first app still gets
          clicked. */}
      <button
        aria-label="Close settings"
        className="absolute right-[120px] top-[80px] cursor-pointer font-['Actor:Regular',sans-serif] leading-none not-italic text-[#999] text-[20px] transition-[scale,color] duration-150 ease-out active:scale-[0.96]"
        data-figma-node="settings-close"
        onClick={() => closeSettings()}
        type="button"
      >
        CLOSE
      </button>
    </div>
  )
}

export default Settings
