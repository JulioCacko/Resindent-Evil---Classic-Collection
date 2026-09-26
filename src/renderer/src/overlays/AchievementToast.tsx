/**
 * Achievement unlock toast.
 *
 * Timing is the deleted C++ overlay's, which is the behavioural reference and the
 * only place these numbers exist (`git show HEAD:src/achievements/achievement_overlay.cpp`):
 *
 *   FADE_IN_TIME  = 0.3f   -> 300ms
 *   HOLD_TIME     = 3.0f   -> 3200ms (the brief's value; the C++ used 3.0s)
 *   FADE_OUT_TIME = 0.3f   -> 300ms
 *   Draw()        alpha = timer / FADE_IN_TIME while fading in,
 *                 1.0 while holding, 1.0 - timer / FADE_OUT_TIME while fading
 *                 out — one continuous fade in / hold / fade out, which is what
 *                 the single keyframe animation below reproduces
 *   Draw()        the card is drawn at x = DESIGN_WIDTH - 420, y = 30, i.e. the
 *                 top-right corner (with a 20px inset for a 400px card), on a
 *                 0x1A1A1A plate with a gold 0xD4AF37 edge and a gold
 *                 "ACHIEVEMENT UNLOCKED" eyebrow
 *
 * The brief's 420px width is used, anchored to keep the same 20px inset from the
 * right edge that `x = DESIGN_WIDTH - 420` implies. The card surface itself is the
 * shared overlay surface (`#1a1a1a` plate, 1px `#4d4d4d` hairline, 4px corner,
 * inset glow) so the toast belongs to the same family as the dialog and the
 * install gate: the legacy gold *edge* is dropped for that hairline, while the
 * gold itself is kept for the eyebrow, the glyph and the underline, because it is
 * the one accent that means "achievement" in this product.
 *
 * The toast is `pointer-events-none` by design: it can appear while a launch is
 * in flight, and an overlay that eats the click meant for the card underneath
 * would be a bug, not a feature.
 */
import { useCallback, useEffect, useRef } from 'react'
import type { ReactNode } from 'react'

import { motion } from 'motion/react'

import type { Achievement } from '@shared/types'
import type { AchievementToastProps } from '@renderer/contracts'

const FADE_IN_MS = 300
const HOLD_MS = 3200
const FADE_OUT_MS = 300

/** The whole display duration, and the span the progress underline fills over. */
const TOTAL_MS = FADE_IN_MS + HOLD_MS + FADE_OUT_MS

/**
 * Normalised keyframe offsets for the one animation: fade in ends at 300ms, the
 * hold ends at 3500ms, the fade out ends at 3800ms. A single keyframe run cannot
 * be interrupted between phases, which is why the three legacy states are
 * expressed as four waypoints rather than as three chained animations.
 */
const TIMES = [0, FADE_IN_MS / TOTAL_MS, (FADE_IN_MS + HOLD_MS) / TOTAL_MS, 1]

/** Entering and leaving from the right, matching the card's top-right anchor. */
const SLIDE_PX = 32

/**
 * The legacy overlay's gold (`RGBA(0xD4, 0xAF, 0x37, 0xFF)` in
 * achievement_overlay.cpp). It is not in data/design.ts because the concept never
 * shows an achievement, so it is stated once here and shared by the glyph, the
 * eyebrow and the underline.
 */
const GOLD = '#D4AF37'

/** The trophy badge, inline so the toast needs no icon dependency. */
function TrophyGlyph(): ReactNode {
  return (
    <svg
      aria-hidden="true"
      className="block size-[32px]"
      fill="none"
      // A 24-unit box keeps every coordinate here a plain integer; the cup arc is
      // a true semicircle (radius = half the chord) so the bowl is a circle
      // segment rather than a lens.
      viewBox="0 0 24 24"
    >
      <path d="M6.6 3.5h10.8v4.9a5.4 5.4 0 0 1-10.8 0V3.5Z" fill={GOLD} />
      <path
        d="M6.6 4.9H4.3a2.3 2.3 0 0 0 0 4.6h2"
        stroke={GOLD}
        strokeLinecap="round"
        strokeWidth="1.6"
      />
      <path
        d="M17.4 4.9h2.3a2.3 2.3 0 0 1 0 4.6h-2"
        stroke={GOLD}
        strokeLinecap="round"
        strokeWidth="1.6"
      />
      <path d="M12 13.8v3" stroke={GOLD} strokeLinecap="round" strokeWidth="1.6" />
      <path d="M8.6 16.8h6.8v2.1a1 1 0 0 1-1 1H9.6a1 1 0 0 1-1-1v-2.1Z" fill={GOLD} />
      <path d="M6.6 21h10.8" stroke={GOLD} strokeLinecap="round" strokeWidth="1.6" />
    </svg>
  )
}

/**
 * The 420px card. Split from the exported component so it can be keyed by the
 * achievement id: a key on the element returned *by* a component does not remount
 * anything, but a key on the element it renders does, and the animation has to
 * restart for the next unlock even if the caller reuses the same element.
 */
function ToastCard({
  achievement,
  onDone
}: {
  achievement: Achievement
  onDone: () => void
}): ReactNode {
  /**
   * `onDone` pops the store's achievement queue, so it must run exactly once even
   * if the animation callback and the safety net below both land. The ref is also
   * what makes the guard work across a re-render — the card is remounted per
   * achievement, so it never needs resetting.
   */
  const finished = useRef(false)

  /**
   * The callback is read through a ref, the same way `useActions` reads its
   * handler (src/renderer/src/input/useActions.ts): a caller passing an inline
   * arrow re-creates `finish` on every render, and an effect that depended on it
   * would restart the safety net each time instead of counting down once.
   */
  const onDoneRef = useRef(onDone)
  useEffect(() => {
    onDoneRef.current = onDone
  }, [onDone])

  const finish = useCallback((): void => {
    if (finished.current) return
    finished.current = true
    onDoneRef.current()
  }, [])

  /**
   * Safety net, one second *after* the animation is due to end: `motion`'s
   * callback is the normal path, but a cancelled animation (an unmount race, a
   * window hidden mid-fade) would otherwise never fire it and the queue would
   * wedge with the next unlock stuck behind this one. Being deliberately late, it
   * can never cut a running fade short.
   */
  useEffect(() => {
    const timer = window.setTimeout(finish, TOTAL_MS + 1000)
    return () => window.clearTimeout(timer)
  }, [finish])

  return (
    /*
      The anchor is a plain element carrying the position and the `data-name` the
      design's own nodes use, and the animated card is the motion child inside it:
      the toast then moves without the test hook moving with it, and the hook stays
      a plain DOM attribute rather than a component prop.
    */
    <div
      className="absolute pointer-events-none right-[20px] top-[30px] w-[420px] z-[60]"
      data-name="achievement-toast"
    >
      <motion.div
        animate={{ opacity: [0, 1, 1, 0], x: [SLIDE_PX, 0, 0, SLIDE_PX] }}
        className="bg-[#1a1a1a] border border-[#4d4d4d] border-solid flex gap-[12px] items-start overflow-hidden p-[16px] relative rounded-[4px] shadow-[inset_0px_0px_36px_0px_rgba(255,255,255,0.15)] w-full"
        // The first frame equals the animation's first waypoint, so the card is
        // already off-screen and transparent on the render before motion starts.
        initial={{ opacity: 0, x: SLIDE_PX }}
        onAnimationComplete={finish}
        role="status"
        transition={{
          duration: TOTAL_MS / 1000,
          // One easing per segment: settle in, sit still through the hold, then
          // accelerate out (FADE_IN / HOLD / FADE_OUT of the legacy state machine).
          ease: ['easeOut', 'linear', 'easeIn'],
          times: TIMES
        }}
      >
        <span className="flex-none" data-name="achievement-glyph">
          <TrophyGlyph />
        </span>
        {/*
          `min-w-0` so the two-line clamp on the description is what limits the
          height, instead of the text widening the card past its 420px.
        */}
        <div className="flex flex-1 flex-col gap-[4px] min-w-0">
          <p
            className="font-['Actor:Regular',sans-serif] leading-none not-italic text-[14px] tracking-[0.08em] uppercase"
            style={{ color: GOLD }}
          >
            ACHIEVEMENT UNLOCKED
          </p>
          {/* Names come from assets/achievements/achievements.json in title case, so
              they are printed as written rather than uppercased. */}
          <p className="font-['Actor:Regular',sans-serif] not-italic text-[22px] text-white">
            {achievement.name}
          </p>
          {achievement.desc.length > 0 ? (
            <p className="font-['Actor:Regular',sans-serif] line-clamp-2 not-italic text-[#999] text-[16px]">
              {achievement.desc}
            </p>
          ) : null}
        </div>
        {/*
          The progress underline: it fills linearly across the whole display
          duration, so it reads as "how long this stays" and reaches the end
          exactly as the card finishes fading out. `origin-left` keeps the fill
          anchored to the card's left edge.
        */}
        <motion.div
          animate={{ scaleX: 1 }}
          className="absolute bottom-0 h-[2px] left-0 origin-left w-full"
          initial={{ scaleX: 0 }}
          style={{ background: GOLD }}
          transition={{ duration: TOTAL_MS / 1000, ease: 'linear' }}
        />
      </motion.div>
    </div>
  )
}

/**
 * Renders nothing at all when there is no achievement to show — no empty frame, no
 * reserved corner — so the launcher's own layout is untouched between unlocks.
 */
export function AchievementToast({ achievement, onDone }: AchievementToastProps): ReactNode {
  if (achievement === null) return null

  return <ToastCard achievement={achievement} key={achievement.id} onDone={onDone} />
}
