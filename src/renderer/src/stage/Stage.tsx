/**
 * The launcher's author-space stage.
 *
 * Every frame of the Figma export is a fixed 1920x1080 canvas —
 * `CANVAS` in src/renderer/src/data/design.ts, and the root of every
 * `.ref/designref/src/imports/*.tsx` is `size-full` inside it — so the UI is not
 * responsive at all. Rather than let the design reflow at other window sizes,
 * the whole interface is rendered once at design size and uniformly scaled to
 * fit, letterboxed on the canvas colour. That is what keeps every measured value
 * in the export (a 32px key cap, an 860px info column, a 12.939px badge
 * tracking) true at any window size, and it is the same "draw at design
 * resolution, then upscale" step the C++ launcher performed with its 1920x1080
 * offscreen target and `glBlitFramebuffer`.
 *
 * Nothing inside the layer may depend on the real viewport: 1 design pixel is
 * always 1 author-space pixel here, and the only thing that changes with the
 * window is the scale on the layer.
 */
import { useEffect, useState } from 'react'
import clsx from 'clsx'

import type { StageProps } from '@renderer/contracts'
import { CANVAS } from '@renderer/data/design'

/** The author space, in design pixels. */
const STAGE_WIDTH = CANVAS.width
const STAGE_HEIGHT = CANVAS.height

/**
 * The uniform fit factor: the smaller of the two axis ratios, so the whole
 * canvas is visible and the leftover axis becomes a letterbox bar.
 */
function fitScale(viewportWidth: number, viewportHeight: number): number {
  return Math.min(viewportWidth / STAGE_WIDTH, viewportHeight / STAGE_HEIGHT)
}

/**
 * The window's inner size, or null when it is not measurable.
 *
 * An Electron window reports 0x0 before it is shown (and a maximised window can
 * report it for a frame), and `fitScale(0, 0)` is 0 — which would scale the
 * entire UI away for as long as the window stayed unmeasured. Callers treat null
 * as "leave the current scale alone".
 */
function viewportSize(): { width: number; height: number } | null {
  const width = window.innerWidth
  const height = window.innerHeight
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null
  return { width, height }
}

export function Stage({ children, className }: StageProps) {
  /**
   * The initial scale is read during the first render instead of in an effect,
   * so the window never shows one frame of an unscaled 1920x1080 layer (which
   * would look like a violent zoom-out on every launch).
   */
  const [scale, setScale] = useState(() => {
    const size = viewportSize()
    return size === null ? 1 : fitScale(size.width, size.height)
  })

  useEffect(() => {
    let frame = 0

    const measure = (): void => {
      frame = 0
      const size = viewportSize()
      if (size === null) return
      const next = fitScale(size.width, size.height)
      // Bail out on an unchanged scale: `resize` and the ResizeObserver below
      // both fire for one window change, and React would otherwise re-render the
      // whole screen twice for it.
      setScale((previous) => (previous === next ? previous : next))
    }

    /**
     * Both signals are needed and neither is sufficient:
     *
     *   `resize`         fires when the window itself changes size, including
     *                    when it moves between monitors with different DPI.
     *   ResizeObserver   fires when the *document element's* box changes for a
     *                    reason that is not a window resize — browser zoom,
     *                    a hidden-then-visible window, a devtools pane.
     *
     * Requested through requestAnimationFrame so a change that trips both
     * signals in the same frame results in one measurement, taken when layout
     * is settled rather than in the middle of it.
     */
    const schedule = (): void => {
      if (frame !== 0) return
      frame = window.requestAnimationFrame(measure)
    }

    window.addEventListener('resize', schedule)

    // Guarded because the stage is the one component that touches the DOM
    // directly (`ResizeObserver` is not implemented by every DOM-ish test host).
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule)
    observer?.observe(document.documentElement)

    // The window may already differ from what the first render measured.
    measure()

    return () => {
      window.removeEventListener('resize', schedule)
      observer?.disconnect()
      if (frame !== 0) window.cancelAnimationFrame(frame)
    }
  }, [])

  return (
    // The letterbox: a full-viewport surface in the canvas colour, so the bars
    // around the stage match the frame instead of showing the window's own
    // background. `overflow-clip` rather than `overflow-hidden` because
    // `overflow: hidden` still makes the box a scroll container: the backdrop on
    // the version and gameplay screens is pinned 40.23px below the canvas
    // (BACKDROP.bottomOffset) and therefore overflows it, and once anything inside
    // takes focus the browser scrolls that hidden container to reveal it — which
    // silently shifted every measured layer by 40px. `overflow: clip` clips the
    // same way but can never scroll.
    <div className="bg-[#0F0F0F] fixed inset-0 overflow-clip">
      {/*
        The 1920x1080 author space. It is positioned by half-width/half-height
        negative margins rather than by a translate utility on purpose: the scale
        below is an inline `transform`, and Tailwind v4 implements translate and
        scale as their own CSS properties, so mixing the two would make the
        element's final position depend on the order in which the browser composes
        `translate`, `scale` and `transform`. Margins keep the transform channel
        to the scale alone.

        `isolate` bounds the blend group to the frame. The backdrop on every
        screen is `mix-blend-hard-light` (data/design.ts BACKDROP), and without an
        isolated group here it would blend against whatever stacking context
        happens to be above the stage instead of against the canvas colour the
        design blended it with.

        `overflow-hidden` is the Figma frame's own clip: the export's frames crop
        their content, and several layers are drawn deliberately larger than the
        canvas (the 1539.34px backdrop, the gameplay art lanes with negative
        offsets), so they must be cropped at 1920x1080 and not spill into the
        letterbox. `overflow-clip` (not `overflow-hidden`) does that without
        creating a scroll container, which is what keeps a focused element from
        scrolling the whole frame off by the backdrop's 40.23px overhang.

        The literal `h-[1080px] w-[1920px]` and the -960px/-540px offsets are the
        author space, because Tailwind only sees class candidates that appear as
        complete text in the source and can never interpolate CANVAS into them;
        they are half of CANVAS.width / CANVAS.height, exactly as in
        components/Backdrop.tsx.
      */}
      <div
        className={clsx(
          'absolute -ml-[960px] -mt-[540px] bg-[#0F0F0F] h-[1080px] isolate left-1/2 overflow-clip top-1/2 w-[1920px]',
          className
        )}
        // The hook the E2E geometry suite measures against, so a spec never has
        // to guess the stage's classes to find the author-space layer.
        data-figma-node="stage"
        data-name="stage"
        style={{ transform: `scale(${scale})`, transformOrigin: 'center center' }}
      >
        {children}
      </div>
    </div>
  )
}

export default Stage
