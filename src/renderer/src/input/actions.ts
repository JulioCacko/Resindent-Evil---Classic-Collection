/**
 * Keyboard / gamepad -> `InputAction` mapping.
 *
 * Pure by design: no React, no DOM globals, no timers, and no dependency on
 * anything outside `@shared/types` — so every rule in this file is directly
 * unit-testable, which matters because the Vitest project runs with
 * `environment: 'node'` (see vitest.config.ts) and therefore cannot render the
 * hooks at all. `useActions.ts` and `useGamepad.ts` supply the events and the
 * timing; this file owns the decisions.
 *
 * Behavioural reference is the removed C++ launcher's input layer
 * (`git show HEAD:src/input/input_manager.cpp`), whose public surface was
 * exactly this vocabulary:
 *
 *   NavigateUp/Down/Left/Right   arrows, D-pad, left stick (0.5 crossing test)
 *   Confirm                      Return, KP_Enter, pad button A
 *   Back                         Escape, pad button B
 *
 * The design agrees and adds nothing to it: every screen's helper bar in the
 * Figma export is `◄ ► Navigate` / `Enter Confirm` / `Esc Back`
 * (.ref/designref/src/imports/MainMenu.tsx lines 219-296, mirrored by
 * HINTS_MENU / HINTS_VERSION in renderer/src/data/design.ts). That is why the
 * launcher can be controller-first with a single, six-action vocabulary.
 */
import type { InputAction } from '@shared/types'

// ---------------------------------------------------------------------------
// keyboard
// ---------------------------------------------------------------------------

/**
 * Key name -> action.
 *
 * The table deliberately mixes `KeyboardEvent.code` values with `key` values,
 * because each entry is spelled in whichever form is unambiguous for it and
 * `eventToAction` consults both fields:
 *
 *  - `KeyA/KeyD/KeyW/KeyS` are *codes*, i.e. physical key positions, so WASD
 *    keeps its cross shape on AZERTY and QWERTZ layouts exactly as it does in
 *    the games themselves.
 *  - `ArrowLeft…ArrowDown`, `Enter`, `Escape` are identical in both fields.
 *  - `NumpadEnter` is a code only; it exists because input_manager.cpp treated
 *    `SDL_SCANCODE_KP_ENTER` as Confirm alongside Return.
 *  - `KeyE` is a code only; the brief binds it to Confirm alongside Enter, the
 *    way a player who is not using the pad still confirms with one hand held
 *    over WASD.
 */
export const KEYS_TO_ACTIONS: Record<string, InputAction> = {
  ArrowLeft: 'nav-left',
  ArrowRight: 'nav-right',
  ArrowUp: 'nav-up',
  ArrowDown: 'nav-down',
  KeyA: 'nav-left',
  KeyD: 'nav-right',
  KeyW: 'nav-up',
  KeyS: 'nav-down',
  Enter: 'confirm',
  NumpadEnter: 'confirm',
  KeyE: 'confirm',
  Escape: 'back',
  // F1 rather than a letter: every letter that reads as "menu" (M) or "achievements" (A) collides with
  // the navigation the brief already binds to WASD, and a function key cannot be typed into the login
  // panel by accident. Nothing else answers it.
  F1: 'menu'
}

/**
 * Legacy spellings, normalised instead of duplicated into KEYS_TO_ACTIONS.
 *
 * `Esc` is what old WebKit builds and many synthetic/hand-built events report
 * for Escape (`Escape` is the standard value since DOM3); mapping it to the
 * canonical name means both spellings are honoured in `event.code` *and*
 * `event.key`, while the table above keeps exactly one binding per action.
 */
const LEGACY_KEY_ALIASES: Record<string, string> = {
  Esc: 'Escape'
}

/**
 * The action a keyboard event means, or `null` for a key the launcher ignores.
 *
 * `code` is checked before `key` so that a layout change cannot move WASD away
 * from its physical position; for every other entry the two fields are equal,
 * so the order is only observable there.
 */
export function eventToAction(event: KeyboardEvent): InputAction | null {
  const byCode = lookupKey(event.code)
  if (byCode !== null) return byCode
  // Escape also arrives as `key: 'Esc'` from older engines, and a synthetic
  // event may carry an empty `code`, so the fallback walks the alias table too.
  return lookupKey(event.key)
}

function lookupKey(name: string): InputAction | null {
  const canonical = LEGACY_KEY_ALIASES[name] ?? name
  const action: InputAction | undefined = KEYS_TO_ACTIONS[canonical]
  return action ?? null
}

// ---------------------------------------------------------------------------
// gamepad
// ---------------------------------------------------------------------------

/**
 * Standard-mapping button index -> action.
 *
 * 12..15 are the D-pad's up/down/left/right, 0 is the bottom face button
 * (A on Xbox, ✕ on PlayStation) and 1 the right one (B / ○). This is the same
 * choice input_manager.cpp made (`SDL_CONTROLLER_BUTTON_DPAD_*`,
 * `SDL_CONTROLLER_BUTTON_A` for Confirm, `SDL_CONTROLLER_BUTTON_B` for Back),
 * and it is the only mapping that matches the helper bar's four arrows plus
 * Confirm/Back.
 */
export const GAMEPAD_BUTTON_ACTIONS: Record<number, InputAction> = {
  12: 'nav-up',
  13: 'nav-down',
  14: 'nav-left',
  15: 'nav-right',
  0: 'confirm',
  1: 'back'
}

/**
 * Per-axis memory for the stick's edge detection.
 *
 * `axisToAction` MUTATES this record: after every call it holds the direction
 * the stick is currently pushed in, or `null` while centred. That mutation is
 * the function's contract, not a side effect to be avoided — the previous
 * frame's direction has nowhere else to live, and keeping it here means the
 * polling loop never has to duplicate the direction decision. The caller owns
 * the record (in practice a ref), so two input pipelines cannot share it.
 */
export interface ActiveAxes {
  x: InputAction | null
  y: InputAction | null
}

/**
 * The left stick as one action per push.
 *
 * `x` and `y` are raw `Gamepad.axes` values: the platform already normalises
 * them to -1..1 and `y` grows downwards, which is the direction `nav-down`
 * expects. A value past ±`deadzone` counts as pushed; the deadzone edge itself
 * does not, matching the strict `<` / `>` crossings in input_manager.cpp.
 *
 * Only a rising edge is returned, so holding the stick in one direction fires
 * once instead of once per frame — the C++ equivalent was
 * `x < -0.5f && g_stickNavXLastFrame >= -0.5f`, and the rewrite fixes the
 * threshold at a single 0.5 deadzone rather than the old 0.2 deadzone followed
 * by a 0.5 gate.
 */
export function axisToAction(
  x: number,
  y: number,
  deadzone: number,
  active: ActiveAxes
): InputAction | null {
  const limit = Math.abs(deadzone)

  const xNow = directionAction(x, limit, 'nav-left', 'nav-right')
  const yNow = directionAction(y, limit, 'nav-up', 'nav-down')

  const xEdge = xNow === active.x ? null : xNow
  const yEdge = yNow === active.y ? null : yNow

  // Both axes are remembered, including the one that loses the diagonal
  // tie-break below: that way releasing the stick always clears both, and the
  // next push is always a fresh edge.
  active.x = xNow
  active.y = yNow

  if (xEdge !== null && yEdge !== null) {
    // A pushed corner must still produce one action, not two. The dominant axis
    // wins; an exact tie goes to the horizontal one because the main menu and
    // the launch panel are horizontal lists (HINTS_MENU and HINTS_PANEL are
    // both `◄ ►`), so horizontal is what a diagonal most likely means there.
    return Math.abs(x) >= Math.abs(y) ? xEdge : yEdge
  }

  // `null` here covers "nothing changed" and "the stick returned to centre";
  // a release is not an action.
  return xEdge ?? yEdge
}

/** One axis -> a direction action, or `null` while it sits inside the deadzone. */
function directionAction(
  value: number,
  deadzone: number,
  negative: InputAction,
  positive: InputAction
): InputAction | null {
  // A pad that is still initialising can report NaN (or Infinity) for an axis;
  // that means "no direction", not "pushed fully".
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  if (value < -deadzone) return negative
  if (value > deadzone) return positive
  return null
}

// ---------------------------------------------------------------------------
// timing
// ---------------------------------------------------------------------------

/**
 * Keyboard auto-repeat throttle, in milliseconds.
 *
 * A held arrow key makes the browser emit a keydown about thirty times a second;
 * without this, holding ◄ would run the menu at roughly 30 rows/second instead
 * of a readable ~7. The value is fixed by the contract
 * (renderer/src/contracts.ts, ActionsOptions: "Key auto-repeat is throttled to
 * 140ms and the pad to 220ms").
 *
 * Because Chromium waits about half a second before its first repeat, this only
 * shapes the steady state; it is not what keeps a single tap from counting twice.
 *
 * Only auto-repeat is throttled, never the first press: discrete presses are
 * always delivered, however fast the user taps.
 */
export const THROTTLE_MS = 140

/**
 * Gamepad throttle, in milliseconds.
 *
 * Slower than the keyboard's because a pad is polled rather than event-driven:
 * a stick flick that crosses the deadzone on consecutive frames, or a D-pad rock
 * that releases and re-presses between two frames, would otherwise arrive as a
 * burst of edges that reads as double input.
 */
export const PAD_THROTTLE_MS = 220
