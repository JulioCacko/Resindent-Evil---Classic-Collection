/**
 * The full-stage backdrop: one portrait photograph, vertically flipped, blended
 * back over the screen with `hard-light`.
 *
 * Transcribed from the Figma export rather than re-derived. The menu version is
 * `.ref/designref/src/imports/MainMenu.tsx:324-330`, and the version/gameplay
 * version is `.ref/designref/src/imports/MainMenuRe1.tsx:179-185`; the two differ
 * in exactly one way: every screen below the main menu drops the vertical
 * centring and pins the layer with `bottom-[-40.23px]` instead, which is
 * `BACKDROP.bottomOffset` in data/design.ts.
 *
 * The 1920x1539.34 layer deliberately overflows the 1080px stage: it is the crop
 * the design specifies (data/design.ts BACKDROP), so it must not be resized to
 * fit.
 */
import clsx from 'clsx'
import type { BackdropProps } from '@renderer/contracts'
import { assetUrl } from '@renderer/data/assets'

/** Resolved once at module load: the key is constant and `assetUrl` is a pure lookup. */
const BACKDROP_SRC = assetUrl('game/backdrop-unsplash')

export function Backdrop({ opacity, bottomOffset }: BackdropProps) {
  // `undefined` means "centre vertically" (main menu); any number, including the
  // design's -40.23, means "pin to that bottom offset" (other screens). Checking
  // the prop twice rather than through a boolean is what lets TypeScript narrow
  // it to a number inside the style object.
  return (
    <div
      aria-hidden="true"
      // Class strings kept verbatim from the export; `h-[1539.34px]`/`w-[1920px]`
      // are written literally because Tailwind only sees candidate classes that
      // appear as complete text in the source, never an interpolated value.
      className={clsx(
        '-translate-x-1/2 absolute flex h-[1539.34px] items-center justify-center left-1/2 mix-blend-hard-light w-[1920px]',
        bottomOffset === undefined && '-translate-y-1/2 top-1/2'
      )}
      style={bottomOffset === undefined ? undefined : { bottom: bottomOffset }}
    >
      <div className="-scale-y-100 flex-none">
        <div className="h-[1539.34px] relative w-[1920px]">
          {BACKDROP_SRC === '' ? null : (
            <img
              alt=""
              className="absolute inset-0 max-w-none object-cover pointer-events-none size-full"
              // The export hard-codes `opacity-20` on the menu and `opacity-10` on
              // every other screen; the value is a prop so the two screens cannot
              // drift from BACKDROP.opacityMenu / .opacityScreen.
              style={{ opacity }}
              src={BACKDROP_SRC}
            />
          )}
        </div>
      </div>
    </div>
  )
}
