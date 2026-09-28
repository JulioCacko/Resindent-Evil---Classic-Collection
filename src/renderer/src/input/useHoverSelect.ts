/**
 * Pointer hover that has to *earn* the cursor.
 *
 * The menu and the version list move their selection when the pointer is over them, which is what
 * the concept's pointer-driven design asks for. The trouble is that a browser also reports pointer
 * events the user did not cause: when a window is created, moved or relaid out under a stationary
 * cursor, whatever appears underneath receives a mouse event. A launcher that acts on it moves the
 * cursor the instant a screen appears, so a player navigating with the keyboard finds the
 * selection somewhere they did not put it - and this project's e2e suite fails with "still 2 after
 * waiting" for reasons no code change could be blamed for.
 *
 * The rule: hover acts only when the pointer's coordinates actually change. A real mouse movement
 * always changes them, even by one pixel; an event describing where the cursor already was does
 * not. The first event an app observes is treated as "where the pointer is" rather than as
 * movement, so it cannot steal anything either.
 *
 * Coordinates are tracked per app, not per component: a card and a row are different elements but
 * only one pointer exists, and a shared origin is what makes "the pointer did not move" mean the
 * same thing on both.
 *
 * What this is not: a way to ignore the pointer. Someone who moves the mouse gets the selection
 * they aimed at, on the same frame, with no lock or delay involved.
 */
import { useCallback, useRef } from 'react'
import type { MouseEvent as ReactMouseEvent } from 'react'

interface PointerPosition {
  x: number
  y: number
}

/** Where the pointer was when the app last saw it. `null` means nothing seen yet. */
let lastPointer: PointerPosition | null = null

/** Forgets the pointer, so a test or a reload starts from a known state. */
export function resetHoverTracking(): void {
  lastPointer = null
}

/**
 * Whether this pointer position is a movement worth acting on.
 *
 * Separate from the hook so the rule can be read - and unit-tested - without a DOM.
 */
export function isPointerMovement(position: PointerPosition): boolean {
  const previous = lastPointer
  lastPointer = position
  if (previous === null) return false
  return previous.x !== position.x || previous.y !== position.y
}

/**
 * A `mousemove` handler that calls `onHover` only for real movement.
 *
 * The handler is stable across renders (it reads `onHover` through a ref), so a re-render cannot
 * replace the listener mid-gesture.
 */
export function useHoverSelect(onHover: () => void): (event: ReactMouseEvent) => void {
  const handler = useRef(onHover)
  handler.current = onHover

  return useCallback((event: ReactMouseEvent) => {
    if (!isPointerMovement({ x: event.clientX, y: event.clientY })) return
    handler.current()
  }, [])
}