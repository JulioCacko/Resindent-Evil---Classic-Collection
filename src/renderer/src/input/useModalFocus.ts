import { useEffect } from 'react'
import type { RefObject } from 'react'

/** One mounted dialog owns focus; restore the invoking control on close. */
export function useModalFocus(ref: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const root = ref.current
    if (!root) return
    const controls = () => Array.from(root.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex="0"]')).filter((node) => node.getClientRects().length > 0)
    ;(root.querySelector<HTMLElement>('button[aria-pressed="true"]') ?? controls()[0] ?? root).focus()
    const trap = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return
      const nodes = controls()
      const first = nodes[0] ?? root
      const last = nodes.at(-1) ?? root
      if (event.shiftKey && (document.activeElement === first || document.activeElement === root)) {
        event.preventDefault(); last.focus()
      } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === root)) {
        event.preventDefault(); first.focus()
      }
    }
    root.addEventListener('keydown', trap)
    return () => { root.removeEventListener('keydown', trap); if (previous?.isConnected) previous.focus() }
  }, [ref])
}
