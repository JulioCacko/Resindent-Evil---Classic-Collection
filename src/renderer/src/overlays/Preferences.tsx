import { useEffect, useRef, useState } from 'react'
import { ACTION_LABELS, DEFAULT_BINDINGS, keyLabel, validBindings } from '@shared/controls'
import type { InputAction } from '@shared/types'
import { INVOKE_CHANNELS } from '@shared/channels'
import type { InvokeMap } from '@shared/channels'
import { useLauncher } from '@renderer/state/store'
import { currentVersion } from '@renderer/data/derive'
import { useActions } from '@renderer/input/useActions'
import { useModalFocus } from '@renderer/input/useModalFocus'

export function Preferences() {
  const state = useLauncher((value) => value)
  const root = useRef<HTMLDivElement>(null)
  useModalFocus(root)
  const [capture, setCapture] = useState<{ action: InputAction; slot: number } | null>(null)
  const [message, setMessage] = useState('')
  const [capabilities, setCapabilities] = useState<InvokeMap['game:settings']['response'] | null>(null)
  const selected = currentVersion(state)
  const launcher = state.preferences === 'launcher-controls'
  const bindings = state.config?.keyBindings ?? DEFAULT_BINDINGS

  useEffect(() => {
    if (launcher || !selected) return
    let active = true
    void window.reLauncher?.invoke(INVOKE_CHANNELS.gameSettings, { versionId: selected.version.id, mode: selected.mode })
      .then((value) => { if (active) setCapabilities(value) })
      .catch(() => { if (active) setMessage('Could not read game settings.') })
    return () => { active = false }
  }, [launcher, selected?.version.id, selected?.mode])

  useEffect(() => {
    if (!capture) return
    const listen = (event: KeyboardEvent) => {
      event.preventDefault(); event.stopImmediatePropagation()
      if (event.code === 'Escape') { setCapture(null); return }
      if (event.ctrlKey || event.altKey || event.metaKey || event.repeat) return
      const next = structuredClone(bindings)
      next[capture.action][capture.slot] = event.code
      if (!validBindings(next)) { setMessage('That key is reserved, unsupported, or already assigned. Choose another key.'); return }
      void state.patchConfig({ keyBindings: next })
      setCapture(null); setMessage('Binding saved.')
    }
    window.addEventListener('keydown', listen, true)
    return () => window.removeEventListener('keydown', listen, true)
  }, [capture, bindings, state.patchConfig])

  useActions((action) => {
    if (capture) { if (action === 'back') setCapture(null); return }
    if (action === 'back' || action === 'menu') { state.closePreferences(); return }
    const buttons = Array.from(root.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled),select:not(:disabled)') ?? [])
    const index = buttons.findIndex((item) => item === document.activeElement)
    if (action === 'confirm') { buttons[index]?.click(); return }
    const delta = action === 'nav-up' || action === 'nav-left' ? -1 : 1
    buttons[(index + delta + buttons.length) % buttons.length]?.focus()
  }, { enabled: !capture })

  const setDisplay = async (display: number | null) => {
    if (!selected) return
    const result = await window.reLauncher?.invoke(INVOKE_CHANNELS.gameDisplaySet, { versionId: selected.version.id, mode: 'enhanced', display })
    setMessage(result?.message ?? 'Could not save display setting.')
    if (result?.ok) setCapabilities((current) => current ? { ...current, display } : current)
  }
  const configure = async () => {
    if (!selected) return
    setMessage('Opening the game configuration screen…')
    await state.launch(true)
  }

  return <div ref={root} tabIndex={-1} role="dialog" aria-modal="true" aria-label={launcher ? 'Launcher controls' : `${state.preferences} settings`} className="collection-dialog" data-figma-node="preferences">
    <header><p className="eyebrow">{launcher ? 'SETTINGS / CONTROLS' : `COLLECTION / ${selected?.version.displayName ?? ''} / ${selected?.mode.toUpperCase() ?? ''}`}</p><h1>{launcher ? 'KEYBOARD & CONTROLLER' : state.preferences?.toUpperCase()}</h1></header>
    <section className="preferences-body">
      {launcher ? <>
        <p>Choose a binding, then press a key. Escape cancels. Back always retains Escape.</p>
        <div className="binding-grid"><span>Action</span><span>Primary</span><span>Secondary</span>
          {(Object.keys(ACTION_LABELS) as InputAction[]).map((action) => <div className="binding-row" key={action}>
            <span>{ACTION_LABELS[action]}</span>{[0, 1].map((slot) => <button key={slot} disabled={action === 'back'} onClick={() => { setCapture({ action, slot }); setMessage('Press a key. Escape cancels.'); }}>
              {capture?.action === action && capture.slot === slot ? 'PRESS KEY…' : keyLabel(bindings[action][slot] ?? '—')}
            </button>)}
          </div>)}
        </div>
        <p>Controller: D-pad or left stick to move, bottom face button to confirm, right face button to go back. Connect or disconnect at any time.</p>
        <button onClick={() => { void state.patchConfig({ keyBindings: structuredClone(DEFAULT_BINDINGS) }); setMessage('Default launcher bindings restored.'); }}>RESTORE DEFAULTS</button>
      </> : <>
        <p>{capabilities?.note ?? 'Reading this installation…'}</p>
        {state.preferences === 'display' && capabilities?.displaySupported ? <>
          <h2>WINDOW SIZE</h2>
          <div className="option-list">{['Game setting', '640 × 480', '960 × 720', '1280 × 960', '1600 × 1200'].map((label, index) => <button aria-pressed={capabilities.display === (index === 0 ? null : index - 1)} disabled={state.gameStatus.running} key={label} onClick={() => void setDisplay(index === 0 ? null : index - 1)}>{label}</button>)}</div>
          <p>Applied on the next Enhanced launch. “Game setting” restores the captured value. Fullscreen is not exposed until verified.</p>
        </> : null}
        {capabilities?.nativeSetup ? <button disabled={state.gameStatus.running} onClick={() => void configure()}>OPEN GAME CONFIGURATION</button> : <p>Use the original game's own Options menu. External remapping is unavailable for this configuration.</p>}
        <p>Native controls are configured in the game's own screen. No unverified action slots are written by the launcher.</p>
      </>}
      <p role="status">{message}</p>
    </section>
    <footer><button onClick={() => { setCapture(null); state.closePreferences() }}>BACK</button><span>Changes apply only to the selected configuration.</span></footer>
  </div>
}
