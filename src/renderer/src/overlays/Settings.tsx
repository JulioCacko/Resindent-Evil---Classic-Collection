import { useModalFocus } from '@renderer/input/useModalFocus'
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
import { keyLabel } from '@shared/controls'

import {
  SETTINGS_LABEL,
  SETTINGS_ROWS,
  SETTINGS_STEP,
  clamp01
} from '@renderer/data/design'
import type { SettingsRow } from '@renderer/data/design'
import { useLauncher, launcherStore } from '@renderer/state/store'
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
    case 'ingameOverlay':
      // The readout can only report the setting, not whether it will do anything: the plugin is loaded
      // by the ASI loader that ships with RE-Enhance, so this toggle says ON in ORIGINAL mode where no
      // link can be made. What actually happened is reported rather than promised - main logs
      // `in-game overlay: available=… (reason)` and pushes the same state to the renderer as
      // `overlay:state`, which is what decides whether the launcher's own toast stays quiet.
      return config.inGameOverlay ? SETTINGS_LABEL.on : SETTINGS_LABEL.off
    case 'window':
      return SETTINGS_LABEL.launchWindowMode[config.launchWindowMode]
    case 'installRoot':
      // The override is a path; empty means detection's own search order, which is worth
      // naming rather than leaving blank.
      return config.gogPathOverride === '' ? SETTINGS_LABEL.auto : config.gogPathOverride
    case 'controls':
    case 'diagnostics':
    case 'redetect':
    case 'reset':
      return ''
    case 'achievements':
      return ''
    case 'steamLaunch':
      return config.launchThroughSteam ? SETTINGS_LABEL.on : SETTINGS_LABEL.off
    case 'retroAccount':
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


const GROUPS: { name: string; rows: string[] }[] = [
  { name: 'Presentation', rows: ['crt', 'scanlines', 'curvature', 'vignette', 'grain', 'window', 'ingameOverlay'] },
  { name: 'Audio', rows: ['master', 'sfx', 'music'] },
  { name: 'Controls', rows: ['controls'] },
  { name: 'Accounts', rows: ['retroAccount', 'steamLaunch', 'achievements'] },
  { name: 'Installation', rows: ['installRoot', 'redetect', 'diagnostics', 'reset'] }
]

export function Settings() {
  const config = useLauncher((state) => state.config)
  const index = useLauncher((state) => state.settingsIndex)
  const move = useLauncher((state) => state.moveSettingsRow)
  const activate = useLauncher((state) => state.activateSetting)
  const close = useLauncher((state) => state.closeSettings)
  const overlayReason = useLauncher((state) => state.overlayReason)
  const device = useLauncher((state) => state.inputDevice)
  const root = useRef<HTMLDivElement>(null)
  useModalFocus(root)
  const [confirmReset, setConfirmReset] = useState(false)
  const focused = SETTINGS_ROWS[index] ?? SETTINGS_ROWS[0]
  const group = GROUPS.find((entry) => entry.rows.includes(focused.id)) ?? GROUPS[0]
  useEffect(() => {
    root.current?.querySelector<HTMLButtonElement>(`[data-name="setting-${focused.id}"]`)?.focus()
  }, [focused.id])

  return <div ref={root} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Launcher settings" className="collection-dialog" data-figma-node="settings">
    <header><p className="eyebrow">CLASSIC COLLECTION / SETTINGS</p><h1>SETTINGS</h1><p data-figma-node="settings-hint">Changes are saved as you make them.</p></header>
    <div className="settings-layout">
      <nav aria-label="Settings categories">{GROUPS.map((entry) => <button key={entry.name} aria-current={group.name === entry.name ? 'page' : undefined} onClick={() => {
        const target = SETTINGS_ROWS.findIndex((row) => entry.rows.includes(row.id))
        move(target - index); setConfirmReset(false)
      }}>{entry.name}</button>)}</nav>
      <section><h2>{group.name.toUpperCase()}</h2><div data-figma-node="settings-rows">{SETTINGS_ROWS.map((row, rowIndex) => {
        if (!group.rows.includes(row.id)) return null
        const value = row.id === 'reset' && confirmReset ? 'CONFIRM RESET' : settingsValue(row, config)
        return <button key={row.id} className="setting-row" data-name={`setting-${row.id}`} aria-pressed={rowIndex === index}
          onFocus={() => move(rowIndex - launcherStore().settingsIndex)}
          onClick={() => {
            move(rowIndex - launcherStore().settingsIndex)
            if (row.id === 'reset' && !confirmReset) { setConfirmReset(true); return }
            setConfirmReset(false); activate()
          }}>
          <span>{row.label}</span><span data-figma-node={`setting-value-${row.id}`}>{value}</span>
        </button>
      })}</div>
      {group.name === 'Presentation' ? <p className="setting-note">In-game overlay: {overlayReason.replaceAll('-', ' ')}. Available only with Enhanced D3D9 games. In-game CRT remains hidden until visually verified.</p> : null}
      <p data-figma-node="settings-focused">FOCUSED: {focused.label.toUpperCase()}</p>
      </section>
    </div>
    <footer><button data-figma-node="settings-close" aria-label="Close settings" onClick={close}>BACK</button><span>{device === 'gamepad' ? 'D-pad select / change · A / × confirm · B / ○ back' : `${keyLabel(config?.keyBindings['nav-up'][0] ?? 'ArrowUp')} / ${keyLabel(config?.keyBindings['nav-down'][0] ?? 'ArrowDown')} select · ${keyLabel(config?.keyBindings.confirm[0] ?? 'Enter')} confirm · Escape back`}</span></footer>
  </div>
}
export default Settings
