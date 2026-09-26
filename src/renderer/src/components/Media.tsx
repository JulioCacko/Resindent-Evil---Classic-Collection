/**
 * Image and video primitives that degrade to nothing instead of to a broken
 * icon or a collapsed box.
 *
 * Every media lane in the design is a fixed-size box in a hard 1920x1080 layout
 * (card art `.ref/designref/src/imports/MainMenu.tsx:135`, region art
 * `MainMenuRe1.tsx:87`, logos `MainMenuRe1.tsx:152`, video frames
 * `MainMenuRe1.tsx:55`), and the renderer is the one place where a missing or
 * failed asset is a real possibility: the WebP files are produced by
 * `pnpm assets:sync` and a version row can point at art that was never exported.
 *
 * The vendored `figma/ImageWithFallback.tsx` swaps a failed image for a grey
 * placeholder graphic. That is right for a design preview and wrong here -- a
 * grey box in a lane that is supposed to hold cover art reads as a rendering
 * bug, and it would also paint over the backdrop. So: render the caller's
 * `fallback` if it supplied one, otherwise render nothing at all. Either way the
 * caller's own sizing (the box around the media) is what holds the layout open.
 */
import clsx from 'clsx'
import type { ClassValue } from 'clsx'
import { useState } from 'react'
import type { ReactNode } from 'react'
import { twMerge } from 'tailwind-merge'
import type { MediaProps } from '@renderer/contracts'

/** Local copy of the house class merger; components own no shared util module. */
function cn(...parts: ClassValue[]): string {
  return twMerge(clsx(parts))
}

/**
 * An `<img>` that covers its box, or the fallback when there is nothing to show.
 *
 * `MediaProps` is frozen in @renderer/contracts, so this is the whole surface:
 * `src`, `alt`, `className`, `fallback`.
 */
export function Media({ src, alt = '', className, fallback }: MediaProps): ReactNode {
  // Track *which* source failed rather than a bare boolean: a screen that swaps
  // art in place (version rows, the launch panel's hero) then recovers on the
  // next successful source without needing an effect to reset the flag.
  const [failedSrc, setFailedSrc] = useState<string | null>(null)

  if (src.length === 0 || failedSrc === src) return fallback ?? null

  return (
    <img
      src={src}
      alt={alt}
      className={cn('object-cover', className)}
      // Guard against a second event for the same source re-rendering forever.
      onError={() => setFailedSrc((current) => (current === src ? current : src))}
    />
  )
}

/**
 * The same thing, pre-positioned to fill a relative parent -- the shape the
 * export uses for essentially every piece of art.
 *
 * The defaults are `absolute inset-0 max-w-none object-cover pointer-events-none`
 * (`MainMenu.tsx:135`), and because they are merged rather than appended, a
 * caller that needs the design's oversized/offset crop can pass the export's own
 * offsets -- e.g. the gameplay card's
 * `h-[163.67%] left-[-20.62%] top-[-27.26%] w-[120.62%]`
 * (`MainMenuRe1Gameplay.tsx`, GAMEPLAY_LAYOUTS.re1.art.mediaInset) -- and
 * `inset-0` is dropped in favour of the explicit sides, exactly as the export
 * writes it.
 */
export function MediaFill({ src, alt = '', className, fallback }: MediaProps): ReactNode {
  return (
    <Media
      src={src}
      alt={alt}
      fallback={fallback}
      className={cn('absolute inset-0 max-w-none object-cover pointer-events-none', className)}
    />
  )
}

export interface VideoFillProps {
  src: string
  /** Merged over the design's defaults, so a lane can add its own radius or mask. */
  className?: string
  /** Shown instead of the video when the file is missing or cannot be decoded. */
  fallback?: ReactNode
}

/**
 * The design's video lane: `<video autoPlay loop muted playsInline
 * controlsList="nodownload">` with `object-cover` and `rounded-[2px]`
 * (`.ref/designref/src/imports/MainMenuRe1.tsx:55`). Rendered only when a source
 * exists, so an unset version `videoAsset` leaves the lane's own background in
 * place instead of a black hole.
 *
 * `muted` is load-bearing rather than cosmetic: Chromium refuses to autoplay an
 * audible video without a user gesture, and a screen that swaps the lane in has
 * no gesture to offer.
 */
export function VideoFill({ src, className, fallback }: VideoFillProps): ReactNode {
  const [failedSrc, setFailedSrc] = useState<string | null>(null)

  if (src.length === 0 || failedSrc === src) return fallback ?? null

  return (
    <video
      src={src}
      autoPlay
      loop
      muted
      playsInline
      controlsList="nodownload"
      className={cn(
        'absolute inset-0 max-w-none object-cover pointer-events-none rounded-[2px]',
        className
      )}
      onError={() => setFailedSrc((current) => (current === src ? current : src))}
    />
  )
}
