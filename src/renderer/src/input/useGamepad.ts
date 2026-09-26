/**
 * Gamepad polling for the launcher's controller-first navigation.
 *
 * The Gamepad API has no button events worth using, so the standard mapping is
 * sampled once per animation frame and compared with the previous frame — the
 * same shape as `InputManager::Poll` and its `gamepadButtonsLast` array
 * (`git show HEAD:src/input/input_manager.cpp`), including its
 * `OpenFirstController` rule that only one pad is ever polled.
 *
 * The design's helper bar is the reason this exists at all: the D-pad drives the
 * four `◄ ► ▲ ▼` hints, A is Enter/Confirm and B is Esc/Back
 * (.ref/designref/src/imports/MainMenu.tsx lines 219-296).
 */
import { useEffect, useRef, useState } from 'react'
import type { InputAction } from '@shared/types'
import type { ActionHandler, ActionsOptions } from '@renderer/contracts'
import { GAMEPAD_BUTTON_ACTIONS, PAD_THROTTLE_MS, axisToAction, eventToAction } from './actions'
import type { ActiveAxes } from './actions'

/** `Gamepad.axes` indices of the standard mapping's left stick. */
const AXIS_X = 0
const AXIS_Y = 1

/**
 * Raw deadzone for stick navigation, in `Gamepad.axes` units.
 *
 * The legacy launcher deadzoned at 0.2 and then required a separate 0.5
 * crossing (`ApplyAxisDeadzone` followed by e.g. `y > 0.5f`), i.e. an effective
 * raw threshold near 0.6; the brief fixes a single 0.5 deadzone for the rewrite.
 */
const STICK_DEADZONE = 0.5

/**
 * The order buttons are polled in, so that a frame in which several go down at
 * once still dispatches exactly one action, deterministically.
 *
 * Spelled out rather than derived from `GAMEPAD_BUTTON_ACTIONS`, because
 * integer-like keys enumerate in ascending numeric order, which would make the
 * priority an accident of the literal. Confirm and Back lead: they are
 * deliberate presses, and dropping the simultaneous D-pad step is the
 * recoverable failure, since the same push can simply be repeated.
 */
const BUTTON_SCAN_ORDER: readonly number[] = [0, 1, 12, 13, 14, 15]

/**
 * How long pad input is ignored after a keyboard action when the caller does not
 * pass `ActionsOptions.deviceLockMs`.
 *
 * Just longer than the 140ms keyboard auto-repeat throttle (`THROTTLE_MS`), so a
 * key being held cannot interleave with a stick nudge and move twice per press,
 * and short enough that a player switching from keys to pad mid-menu never
 * notices. The C++ launcher had no equivalent — its `lastWasGamepad` only chose
 * which glyphs to highlight — so the lock is new here; the contract documents it
 * as "ignore pad input for this long after a keyboard action".
 */
const DEFAULT_DEVICE_LOCK_MS = 200

/** How often `useGamepadConnected` re-reads the pad list. See its comment. */
const CONNECTED_POLL_MS = 500

// ---------------------------------------------------------------------------
// reading the Gamepad API
// ---------------------------------------------------------------------------

/**
 * `navigator.getGamepads` is optional in practice even though lib.dom types it
 * as always present: it is missing in the Node unit-test environment
 * (vitest.config.ts sets `environment: 'node'`) and in some embedded webviews.
 * It is therefore described structurally and invoked through a receiver,
 * because the engines that do implement it require `this === navigator`.
 */
type GamepadProvider = { readonly getGamepads?: () => (Gamepad | null)[] | null }

function readGamepads(): (Gamepad | null)[] {
  // Node 21+ has a `navigator` global, older Node has none at all.
  if (typeof navigator === 'undefined') return []
  const provider: GamepadProvider = navigator
  const getGamepads = provider.getGamepads
  if (typeof getGamepads !== 'function') return []
  try {
    const pads = getGamepads.call(provider)
    // The array is sparse and its length can exceed the number of connected
    // devices, so callers must still test every slot.
    return pads ? Array.from(pads) : []
  } catch {
    // Chromium rejects (or throws) until a user gesture has woken the Gamepad
    // API up; treat that as "no pads" rather than letting it kill the loop.
    return []
  }
}

/** True when the given standard-mapping button is held, tolerating short arrays. */
function buttonPressed(pad: Gamepad, index: number): boolean {
  const button: GamepadButton | undefined = pad.buttons?.[index]
  return button !== undefined && button.pressed === true
}

/** Axis value, or 0 while the pad has not reported that axis yet. */
function axisValue(pad: Gamepad, index: number): number {
  const value: number | undefined = pad.axes?.[index]
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

/**
 * The first pad that reports itself as connected, or `null`.
 *
 * Only one controller is ever polled, matching `OpenFirstController`: a second
 * pad must not be able to fight the first for the cursor.
 */
function firstConnectedPad(): Gamepad | null {
  for (const pad of readGamepads()) {
    if (!pad) continue // sparse slot, or a device that just disappeared
    if (pad.connected === false) continue
    return pad
  }
  return null
}

function hasConnectedPad(): boolean {
  return firstConnectedPad() !== null
}

/**
 * Monotonic time for a `requestAnimationFrame` stub that calls its callback
 * without a timestamp; the real browser path always uses the callback argument,
 * so the throttle is driven by the same clock the frames are.
 */
function now(): number {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now()
  }
  return Date.now()
}

/**
 * One frame of pad input: updates the frame memory and returns the single action
 * this frame is allowed to dispatch.
 *
 * The memory is committed even when the caller then gates the action away
 * (throttle or device lock), so the tracked state always follows the hardware:
 * a button seen down can never fire a second time without an intervening
 * release. That is the deliberate trade-off — the alternative, holding an edge
 * back until the throttle expires, would fire a ghost action for a button the
 * user has already let go of.
 */
function nextPadAction(pressed: Set<number>, axes: ActiveAxes): InputAction | null {
  const pad = firstConnectedPad()
  if (!pad) {
    // Forget everything while nothing is connected: a pad unplugged with ◄ held
    // must not swallow the first ◄ press after it is plugged back in.
    pressed.clear()
    axes.x = null
    axes.y = null
    return null
  }

  let action: InputAction | null = null
  const down: Set<number> = new Set()
  for (const index of BUTTON_SCAN_ORDER) {
    if (!buttonPressed(pad, index)) continue
    down.add(index)
    if (action === null && !pressed.has(index)) {
      const mapped: InputAction | undefined = GAMEPAD_BUTTON_ACTIONS[index]
      if (mapped !== undefined) action = mapped
    }
  }
  pressed.clear()
  for (const index of down) pressed.add(index)

  // The stick is read every frame even when a button already owns this one,
  // because `axisToAction` is what remembers where the stick is pointing; a
  // skipped frame would turn a held stick into a fresh edge.
  const stick = axisToAction(axisValue(pad, AXIS_X), axisValue(pad, AXIS_Y), STICK_DEADZONE, axes)
  return action ?? stick
}

// ---------------------------------------------------------------------------
// hooks
// ---------------------------------------------------------------------------

/**
 * Polls the first connected pad and reports canonical actions to `handler`.
 *
 * `handler` and `options` are read through refs, so a screen may pass a fresh
 * closure or an inline options object on every render without restarting the
 * animation loop.
 */
export function useGamepad(handler: ActionHandler, options?: ActionsOptions): void {
  const handlerRef = useRef(handler)
  useEffect(() => {
    handlerRef.current = handler
  }, [handler])

  const enabled = options?.enabled ?? true
  const deviceLockMs = options?.deviceLockMs ?? DEFAULT_DEVICE_LOCK_MS

  /**
   * Timestamp of the last keyboard action, for `deviceLockMs`.
   *
   * Stamped from this hook's own keydown listener rather than handed in, so the
   * hook stays usable on its own and `useActions` can pass its handler through
   * untouched. The listener only records a timestamp — `useActions` is what
   * dispatches keyboard actions, so there is no double handling.
   */
  const lastKeyboardAt = useRef(Number.NEGATIVE_INFINITY)

  useEffect(() => {
    if (!enabled) return
    // No animation clock means no polling rather than a crash: a bare Node test
    // environment has no rAF, while a test that wants to drive this loop
    // installs a stub that the global lookup below will find.
    if (typeof requestAnimationFrame !== 'function') return

    let frame = 0
    let stopped = false
    let lastEmit = Number.NEGATIVE_INFINITY
    /** Buttons held on the previous frame. */
    const pressed: Set<number> = new Set()
    /** Direction the stick pointed in on the previous frame. */
    const axes: ActiveAxes = { x: null, y: null }

    const onKeyDown = (event: KeyboardEvent): void => {
      // Only a key that means something counts as keyboard activity: modifiers
      // and unmapped keys must not lock the pad.
      if (event.ctrlKey || event.metaKey) return
      if (eventToAction(event) === null) return
      lastKeyboardAt.current = Date.now()
    }

    const tick = (time: number): void => {
      if (stopped) return

      // The next frame is scheduled before any work, so one throwing handler
      // cannot silently end polling.
      frame = requestAnimationFrame(tick)

      const stamp = typeof time === 'number' && Number.isFinite(time) ? time : now()

      // The pad is read every frame, before either gate below, so that the
      // frame memory stays in step with the hardware even while an action is
      // being suppressed. Gating first would keep a stale edge alive and fire it
      // late — a ghost press for a button the player had already released.
      const action = nextPadAction(pressed, axes)
      if (action === null) return
      if (stamp - lastEmit < PAD_THROTTLE_MS) return
      if (Date.now() - lastKeyboardAt.current < deviceLockMs) return

      lastEmit = stamp
      handlerRef.current(action, 'gamepad')
    }

    window.addEventListener('keydown', onKeyDown)
    frame = requestAnimationFrame(tick)

    return () => {
      stopped = true
      window.removeEventListener('keydown', onKeyDown)
      // `stopped` also covers the case where no cancel is available, so the loop
      // still ends on unmount.
      if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(frame)
    }
  }, [enabled, deviceLockMs])
}

/**
 * True while a gamepad is connected, for surfaces that want to advertise pad
 * controls.
 *
 * Connection changes are taken from the two Gamepad events *and* from a slow
 * re-read, because Chromium only starts enumerating pads from the first user
 * gesture onwards and a device that becomes visible that way does not reliably
 * raise `gamepadconnected`. The re-read runs inside the animation frame loop
 * (never a `setInterval`) but only every CONNECTED_POLL_MS, and it writes state
 * only when the value actually changed, so it cannot cause an idle re-render
 * every frame.
 */
export function useGamepadConnected(): boolean {
  const [connected, setConnected] = useState(hasConnectedPad)

  useEffect(() => {
    let frame = 0
    let stopped = false
    let lastCheck = Number.NEGATIVE_INFINITY

    const sync = (): void => {
      const next = hasConnectedPad()
      setConnected((prev) => (prev === next ? prev : next))
    }

    const onDeviceChange = (): void => {
      sync()
    }

    const tick = (time: number): void => {
      if (stopped) return
      frame = requestAnimationFrame(tick)
      const stamp = typeof time === 'number' && Number.isFinite(time) ? time : now()
      if (stamp - lastCheck < CONNECTED_POLL_MS) return
      lastCheck = stamp
      sync()
    }

    window.addEventListener('gamepadconnected', onDeviceChange)
    window.addEventListener('gamepaddisconnected', onDeviceChange)
    // Unlike the action loop this one tolerates a missing rAF: the event
    // listeners above are then the only notification path.
    if (typeof requestAnimationFrame === 'function') frame = requestAnimationFrame(tick)

    return () => {
      stopped = true
      window.removeEventListener('gamepadconnected', onDeviceChange)
      window.removeEventListener('gamepaddisconnected', onDeviceChange)
      if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(frame)
    }
  }, [])

  return connected
}
