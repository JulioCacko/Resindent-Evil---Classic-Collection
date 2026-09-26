/**
 * Keyboard half of the launcher's input, composed with the gamepad half.
 *
 * A screen wires exactly one hook — `useActions(handleAction)` — because the
 * store owns what each action *means* (see `LauncherActions.handleAction` in
 * renderer/src/contracts.ts); this module only turns events into canonical
 * actions and applies the timing rules. The design's helper bar promises the
 * user nothing more than that: `◄ ► Navigate`, `Enter Confirm`, `Esc Back`
 * (.ref/designref/src/imports/MainMenu.tsx lines 219-296).
 */
import { useEffect, useRef } from 'react'
import type { ActionHandler, ActionsOptions } from '@renderer/contracts'
import { THROTTLE_MS, eventToAction } from './actions'
import { useGamepad } from './useGamepad'

/**
 * Keys whose browser default the launcher owns: the arrows scroll the document
 * and Enter re-activates whatever the browser considers focused, neither of
 * which should be possible underneath a fixed 1920x1080 canvas.
 *
 * Escape is deliberately absent — it is how the user leaves fullscreen — and so
 * are the WASD/E keys, which have no default worth suppressing.
 */
const PREVENT_DEFAULT_KEYS: ReadonlySet<string> = new Set([
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'ArrowDown',
  'Enter',
  'NumpadEnter'
])

/**
 * True for a focused control that consumes typing, so the menu does not move
 * behind an install-path field.
 *
 * Written structurally instead of with `target instanceof HTMLElement` because
 * the Vitest project runs with `environment: 'node'` (vitest.config.ts), where
 * the DOM constructor globals do not exist and `instanceof` would throw.
 * `isContentEditable` already accounts for inherited editability, so a child of
 * a contenteditable host is covered by that one check.
 */
function isEditableTarget(target: EventTarget | null): boolean {
  if (target === null || typeof target !== 'object') return false
  if ('isContentEditable' in target && target.isContentEditable === true) return true
  if (!('tagName' in target)) return false
  const tagName = target.tagName
  if (typeof tagName !== 'string') return false
  const tag = tagName.toLowerCase()
  return tag === 'input' || tag === 'textarea' || tag === 'select'
}

/**
 * Turns window keydown events into canonical actions and hands them to
 * `handler` with the `keyboard` device, while delegating pad input to
 * `useGamepad` so a screen never wires two hooks.
 */
export function useActions(handler: ActionHandler, options?: ActionsOptions): void {
  // Neither the handler nor the options may sit in the effect's dependencies:
  // callers pass the store's `handleAction` and usually an inline options
  // object, so a dependency on either would detach and reattach the listener on
  // every render. Both are read through refs instead, and the listener is
  // attached once for the life of the screen.
  const handlerRef = useRef(handler)
  const optionsRef = useRef(options)
  const lastKeyboardAt = useRef(Number.NEGATIVE_INFINITY)

  useEffect(() => {
    handlerRef.current = handler
  }, [handler])

  useEffect(() => {
    optionsRef.current = options
  }, [options])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (optionsRef.current?.enabled === false) return
      // Leave app and browser shortcuts alone (Ctrl+R, Cmd+Q, devtools): in a
      // kiosk-shaped frame they are the only way back out.
      if (event.ctrlKey || event.metaKey) return
      // An IME owns the keyboard until it commits, so a keydown during
      // composition is not a navigation intent.
      if (event.isComposing === true) return
      if (isEditableTarget(event.target)) return

      const action = eventToAction(event)
      if (action === null) return

      // Suppressed before the throttle test: a rate-limited auto-repeat must
      // still not scroll the canvas or re-activate a focused control.
      if (PREVENT_DEFAULT_KEYS.has(event.code) || PREVENT_DEFAULT_KEYS.has(event.key)) {
        event.preventDefault()
      }

      // The first press always fires; only the browser's ~30/s auto-repeat is
      // rate-limited, so holding ◄ walks the menu at a readable pace instead of
      // thirty rows a second (contract: ActionsOptions, "Key auto-repeat is
      // throttled to 140ms and the pad to 220ms").
      const stamp = Date.now()
      if (event.repeat === true && stamp - lastKeyboardAt.current < THROTTLE_MS) return
      lastKeyboardAt.current = stamp

      handlerRef.current(action, 'keyboard')
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
    // Attached once; `enabled`, the handler and the options are read through
    // refs, so a re-render can never reorder a dispatch.
  }, [])

  // The pad half polls itself, throttles itself, and applies the
  // keyboard-after-pad device lock (`ActionsOptions.deviceLockMs`) from its own
  // keydown stamp — which is why the raw handler and options are forwarded
  // as-is rather than wrapped.
  useGamepad(handler, options)
}
