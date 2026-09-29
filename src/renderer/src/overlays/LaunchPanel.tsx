/**
 * The launch-options panel of the Game Version screen.
 *
 * There is no Figma frame for this surface, so it is assembled from the design's
 * own tokens instead of invented ones. The surface is the export's `Frame3` meta
 * box — `.ref/designref/src/imports/MainMenuRe1.tsx:125-133`:
 *
 *   bg-[#0f0f0f] flex flex-col gap-[8px] items-start justify-center p-[16px]
 *   shadow-[inset_0px_0px_8px_0px_rgba(255,255,255,0.15)]
 *
 * plus the 1px `#4d4d4d` hairline every selectable surface in the design carries
 * (`MainMenuRe1.tsx:26` and `:109`; `COLOR.border` in
 * src/renderer/src/data/design.ts). The 8px stack gap of the recipe is what
 * separates the rows, so the panel needs no spacing value of its own.
 *
 * The panel is mounted only while it is open (`LauncherState.panelOpen`), which is
 * what keeps the version screen's resting appearance pixel-identical: no scrim,
 * no placeholder, no reserved height.
 *
 * WHICH ROWS EXIST, and whether LAUNCH can start anything, come from the frozen
 * helpers rather than from this file's own reading of the version, so the store's
 * `panelOptionIndex`, the screen's keyboard handler and this component can never
 * disagree about what "option 2" means:
 *
 *   panelOptions(version)  -> the rows, in the order `optionIndex` counts them
 *   canLaunch(version)     -> whether there is anything to start
 *
 * The legacy launcher this app replaces drew the same shape of surface
 * (`git show HEAD:src/ui/screens/screen_launch.cpp`, `Draw`): a Mode row whose
 * value is forced by `hasMod`, a CRT row, and a centred LAUNCH button; the
 * selected row got an `RGBA(0xFF,0xFF,0xFF,0x10)` wash over a 1px border, and
 * unselected text used the hint grey. Those two legacy facts are why the selected
 * row here is a 0.063 white wash over the design's hairline and why a row that is
 * not the cursor's row is muted rather than dimmed.
 */
import { useEffect, useRef } from 'react'
import type { KeyboardEvent } from 'react'

import type { GameVersion, LaunchMode, Re2Scenario } from '@shared/types'
import type { LaunchPanelProps } from '@renderer/contracts'
import { canLaunch, panelOptions } from '@renderer/data/derive'
import { CRT_DEFAULTS, MODE_LABEL, SCENARIO_LABEL } from '@renderer/data/design'
import { useLauncher, launcherStore } from '@renderer/state/store'

/**
 * The row kinds `panelOptions` can yield, in the order it yields them. Re-stated
 * here rather than imported because the frozen declaration in
 * src/renderer/src/contracts.ts is an ambient `declare`, and a contracts file
 * emits no runtime code — the *value* comes from data/derive.ts.
 */
type PanelOptionKind = 'mode' | 'crt' | 'scenario' | 'settings' | 'launch' | 'display' | 'controls' | 'achievements'

/** The CRT row's two words. The caller owns the toggle; the panel only states it. */
const CRT_ON = 'ON'
const CRT_OFF = 'OFF'

/**
 * Every row is 48px tall for a comfortable hit area — the panel is the one
 * surface in the design that is driven by a pointer as much as by the helper
 * bar's keys, and the design's own rows (VERSION_SCREEN.rowGap aside) are all
 * 56px or taller. Tailwind cannot interpolate a constant, so the rows carry the
 * same number as `h-[48px]`; this constant is what the busy readout uses to keep
 * its own height, and the two must agree.
 */
const ROW_HEIGHT = 48

/** `Frame3`'s own `gap-[8px]`, reused as the distance between rows. */
const ROW_GAP = 8

/** One rendered row, fully resolved: the component below only paints these. */
interface PanelRow {
  kind: PanelOptionKind
  /** Left-hand caption, or the whole centred caption on the LAUNCH row. */
  label: string
  /** Right-hand value, or the reason this row cannot be used. */
  value: string
  /** True when `value` is an explanation rather than a setting. */
  valueIsNote: boolean
  /** `optionIndex` currently points at this row. */
  selected: boolean
  /** The row must not change anything when it is clicked. */
  disabled: boolean
}

/**
 * The Mode row's value, including the two locked states the legacy launcher
 * forced (`screen_launch.cpp`: `modeVal = (!v.hasMod) ? "ORIGINAL" : ...`).
 *
 * `panelOptions` only yields a mode row for a launchable version that has mod
 * files and does not require them, so neither locked branch is reachable through
 * the frozen row set. They are kept because the locked mode is a property of the
 * version, not of the row: if a mode row is ever present for a locked version it
 * must state the lock rather than offer a choice that cannot be honoured.
 */
function modeValue(version: GameVersion, mode: LaunchMode): string {
  if (version.requiresMod) return `${MODE_LABEL.enhanced} (REQUIRED)`
  if (!version.hasMod) return MODE_LABEL.original
  return MODE_LABEL[mode]
}

/**
 * `resolveScenario` (data/derive.ts) always resolves a scenario for a version that
 * exposes any, so the placeholder only appears if a caller hands the panel a row
 * whose scenario list and default disagree — better a visible dash than a blank
 * right-hand side that reads as a missing value.
 */
function scenarioValue(scenario: Re2Scenario | null): string {
  return scenario === null ? '—' : SCENARIO_LABEL[scenario]
}

/**
 * The scenario a toggle click moves to, or null when there is nothing to toggle
 * to. `panelOptions` only yields the row for a version with more than one
 * scenario, but the guard keeps a single-scenario row a statement of fact.
 */
function nextScenario(version: GameVersion, current: Re2Scenario | null): Re2Scenario | null {
  const available = version.scenarios
  if (available.length < 2) return null
  // Unknown current value (a config entry the version no longer offers) starts the
  // cycle again rather than skipping a scenario.
  const index = current === null ? -1 : available.indexOf(current)
  // `.at()` rather than `available[i]`: the element type of an indexed read is
  // `Re2Scenario` while the read itself can miss, so this states the miss in the
  // type instead of asserting it away.
  return available.at((index + 1) % available.length) ?? null
}

/** The legacy `Clamp01` from `screen_launch.cpp`, plus a guard for NaN. */
function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0
  if (value < 0) return 0
  if (value > 1) return 1
  return value
}

/**
 * Turns the version, the current settings and the caller's cursor position into
 * the list of rows to paint. Pure, so the same inputs always produce the same
 * panel.
 */
function buildRows(
  version: GameVersion,
  mode: LaunchMode,
  scenario: Re2Scenario | null,
  crtEnabled: boolean,
  optionIndex: number
): PanelRow[] {
  const options: PanelOptionKind[] = panelOptions(version)
  const canStart = canLaunch(version)

  /**
   * Why this row cannot run, where the design would put the value. `stateReason`
   * is the fallback because `unavailableReason` is only set for rows the concept
   * never released.
   */
  const reason = version.unavailableReason ?? version.stateReason
  const note = version.launchable ? null : reason

  /**
   * The caller owns `optionIndex`, but it is index state that survives a change of
   * selected version, so it is folded into this row list the same way `titleAt`
   * and `versionAt` fold theirs (data/derive.ts) — a stale index highlights a row
   * instead of highlighting nothing.
   */
  const active = options.length === 0 ? -1 : ((optionIndex % options.length) + options.length) % options.length

  return options.map((kind, index) => {
    const selected = index === active

    switch (kind) {
      case 'display':
      case 'controls':
      case 'achievements':
        return { kind, label: kind.toUpperCase(), value: '', valueIsNote: false, selected, disabled: false }
      case 'mode': {
        /**
         * A locked mode is not toggleable, and a row that cannot run is not either
         * — a click there would promise a launch that cannot happen.
         */
        const toggleable = version.hasMod && !version.requiresMod
        return {
          kind,
          label: 'Mode',
          value: note ?? modeValue(version, mode),
          valueIsNote: note !== null,
          selected,
          disabled: !version.launchable || !toggleable
        }
      }

      case 'crt':
        /**
         * The CRT filter is a whole-launcher display setting rather than a
         * property of this version, so the row stays usable even on a row that
         * cannot start.
         */
        return {
          kind,
          label: 'CRT Filter',
          value: crtEnabled ? CRT_ON : CRT_OFF,
          valueIsNote: false,
          selected,
          disabled: false
        }

      case 'scenario':
        return {
          kind,
          label: 'Scenario',
          value: note ?? (mode === 'enhanced' ? 'SELECT IN GAME' : scenarioValue(scenario ?? version.defaultScenario)),
          valueIsNote: note !== null,
          selected,
          // Two scenarios are what makes this a choice; one is a fact.
          disabled: !version.launchable || version.scenarios.length < 2 || mode === 'enhanced'
        }

      case 'settings':
        return {
          kind,
          label: 'SETTINGS',
          value: '',
          valueIsNote: false,
          selected,
          disabled: false
        }

      case 'launch':
        return {
          kind,
          label: canStart ? 'LAUNCH' : 'NOT AVAILABLE',
          value: '',
          valueIsNote: false,
          selected,
          disabled: !canStart
        }
    }
  })
}

export function LaunchPanel({
  version,
  mode,
  scenario,
  optionIndex,
  busy,
  onSelectOption,
  onSetMode,
  onSetScenario,
  onLaunch,
  onOpenSettings,
  onClose
}: LaunchPanelProps) {
  /**
   * `crt` is the one row whose value is not a prop: the caller owns the toggle,
   * so the state lives in the config store, which this overlay is allowed to read
   * (see the store note in src/renderer/src/contracts.ts). The selector returns a
   * boolean, so a config reload re-renders only when the value really changed.
   */
  const crtEnabled = useLauncher((state) => state.config?.crtEnabled ?? CRT_DEFAULTS.enabled)

  const rootRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    /**
     * The dialog takes focus on open so that its own Escape handler is reachable
     * after a pointer click on a row. Rows are deliberately not focusable: Enter
     * and the arrows belong to the screen's action layer, and a focused row that
     * also activated itself would fire twice for one keypress.
     */
    rootRef.current?.focus()
  }, [])

  const rows = buildRows(version, mode, scenario, crtEnabled, optionIndex)

  /** 0..100, or null when the operation reports no measurable progress. */
  const busyPercent =
    busy === null || busy.progress === null ? null : Math.round(clamp01(busy.progress) * 100)

  /**
   * The busy readout keeps the row stack's height so that starting a game does not
   * yank the info block underneath it upwards and then drop it back.
   */
  const stackHeight = rows.length * ROW_HEIGHT + Math.max(rows.length - 1, 0) * ROW_GAP

  const activate = (row: PanelRow, index: number): void => {
    // Unreachable while busy — the rows are not painted — but the invariant "while
    // busy, onLaunch must not fire" is cheaper to state than to infer.
    if (busy !== null) return

    // The cursor follows the click, mirroring VersionRow's pointer path, so the row
    // that just acted is the one the keyboard would act on next.
    onSelectOption(index)
    if (row.kind === 'display' || row.kind === 'controls') {
      launcherStore().openPreferences(row.kind)
      return
    }
    if (row.kind === 'achievements') { void launcherStore().openAchievements(); return }

    if (row.kind === 'settings') {
      // Like LAUNCH, one click opens it whether or not the row already held the cursor.
      onOpenSettings()
      return
    }

    if (row.kind === 'launch') {
      // One click starts the game whether or not the row already held the cursor:
      // a launch action that needed two clicks would be a trap.
      if (!row.disabled) onLaunch()
      return
    }

    // Everything below is the "clicking the selected row toggles it" rule.
    if (!row.selected || row.disabled) return

    switch (row.kind) {
      case 'mode':
        onSetMode(mode === 'enhanced' ? 'original' : 'enhanced')
        break

      case 'scenario': {
        const next = nextScenario(version, scenario)
        if (next !== null) onSetScenario(next)
        break
      }

      case 'crt':
        // The caller owns the CRT toggle — the screen flips it through the config
        // store from the helper bar's Change keys — so a click only moves the
        // cursor and the row re-states itself from the store.
        break
    }
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== 'Escape') return
    /**
     * The panel owns Escape while it is up: stopping the event here keeps the
     * screen's window-level action layer from reading the same keypress, so the
     * first Escape backs out of the panel (the legacy `screen_launch.cpp`
     * `in.Back()` pop) and only the next one leaves the version screen.
     */
    event.stopPropagation()
    onClose()
  }

  return (
    <div
      aria-label={`Launch options for ${version.displayName}`}
      /**
       * `Frame3`'s recipe, transcribed, plus the design's hairline border and
       * `w-full` — the export's box is content-sized, but the panel has to give
       * its rows a predictable hit area across the whole column it is docked in.
       * `outline-none` keeps the programmatic focus from drawing a ring over the
       * version screen, which the design has no state for.
       */
      className="bg-[#0f0f0f] border border-[#4d4d4d] border-solid flex flex-col gap-[8px] items-start justify-center outline-none p-[16px] relative select-none w-full"
      data-name="launch-panel"
      onKeyDown={handleKeyDown}
      ref={rootRef}
      role="dialog"
      tabIndex={-1}
    >
      {busy === null ? (
        rows.map((row, index) => {
          // Selected, usable rows brighten to the design's primary text; every
          // other row keeps the muted hint grey, which is the state the legacy
          // screen used for the options that were not under the cursor.
          const textClass = row.selected && !row.disabled ? 'text-white' : 'text-[#999]'

          return (
            <div
              aria-disabled={row.disabled ? true : undefined}
              aria-label={row.value === '' ? row.label : `${row.label}: ${row.value}`}
              className={`flex h-[48px] items-center px-[20px] relative w-full ${
                row.disabled ? 'cursor-default' : 'cursor-pointer'
              }${row.selected ? ' bg-[rgba(255,255,255,0.063)] rounded-[8px]' : ''}`}
              data-name={`row-${row.kind}`}
              key={row.kind}
              onClick={() => activate(row, index)}
              // No `tabIndex` and no key handler on purpose: rows are activated by
              // the pointer here and by the screen's action layer for the keyboard,
              // so one keypress can never be handled twice.
              role="button"
            >
              {row.kind === 'launch' ? (
                <p
                  className={`font-['Actor:Regular',sans-serif] leading-none not-italic text-[22px] text-center w-full ${textClass}`}
                >
                  {row.label}
                </p>
              ) : (
                <>
                  <p
                    className={`font-['Actor:Regular',sans-serif] leading-none not-italic shrink-0 text-[22px] ${textClass}`}
                  >
                    {row.label}
                  </p>
                  <p
                    className={`font-['Actor:Regular',sans-serif] leading-none ml-auto not-italic pl-[16px] text-right ${
                      // A reason is a note, so it drops to the design's 16px meta
                      // size (`VERSION_SCREEN.info.metaFontSize`) and stays muted
                      // even when its row is the cursor's row.
                      row.valueIsNote ? 'text-[16px] text-[#999]' : `text-[22px] ${textClass}`
                    }`}
                  >
                    {row.value}
                  </p>
                </>
              )}
              {row.selected ? (
                /**
                 * Drawn outside the row box at `inset-[-0.5px]`, exactly as the
                 * export hangs its selection hairline off `btn/menu`
                 * (MainMenuRe1.tsx:26), so selecting a row cannot shift the layout
                 * by a pixel. 8.5px is the design's selected radius
                 * (`VERSION_SCREEN.rowSelectedRadius`) against the row's 8px.
                 */
                <div
                  aria-hidden="true"
                  className="absolute border border-[#4d4d4d] border-solid inset-[-0.5px] pointer-events-none rounded-[8.5px]"
                />
              ) : null}
            </div>
          )
        })
      ) : (
        /**
         * While a launch is in flight the rows are gone, so nothing can be selected
         * and nothing can start a second time; the panel becomes a readout of what
         * the main process is doing.
         */
        <div
          className="flex flex-col gap-[8px] items-start justify-center relative w-full"
          data-name="busy"
          role="status"
          style={{ minHeight: stackHeight }}
        >
          <p className="font-['Actor:Regular',sans-serif] leading-none not-italic text-[22px] text-white">
            {busy.label}
          </p>
          {busyPercent === null ? null : (
            <div className="flex items-center gap-[8px] w-full">
              <div
                aria-label={busy.label}
                aria-valuemax={100}
                aria-valuemin={0}
                aria-valuenow={busyPercent}
                className="bg-[#4d4d4d] h-[1px] relative w-full"
                role="progressbar"
              >
                {/* White fill on the design's hairline grey; a 1px track needs no
                    radius and no cap. */}
                <div
                  className="absolute bg-white h-[1px] left-0 top-0"
                  style={{ width: `${busyPercent}%` }}
                />
              </div>
              <p className="font-['Actor:Regular',sans-serif] leading-none not-italic shrink-0 text-[16px] text-white">
                {busyPercent}%
              </p>
            </div>
          )}
        </div>
      )}
      {/* The recipe's inset glow, drawn last so it sits over the rows' edges. */}
      <div
        aria-hidden="true"
        className="absolute inset-0 pointer-events-none rounded-[inherit] shadow-[inset_0px_0px_8px_0px_rgba(255,255,255,0.15)]"
      />
    </div>
  )
}
