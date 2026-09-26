/**
 * One full-width hero row of the Game Version screen's left panel.
 *
 * Geometry is transcribed from the Figma export, which draws the exact same row
 * three times in its two states — `.ref/designref/src/imports/MainMenuRe1.tsx`
 * (`Menu`, rows carrying `data-name="btn/menu"`) and
 * `.ref/designref/src/imports/MainMenuRe2.tsx` (`Menu`):
 *
 *  - Selected: the art sits inside an `overflow-clip relative rounded-[inherit]
 *    size-full` layer that also carries the `mix-blend-exclusion` glow. The
 *    hairline border and the 8.5px radius are drawn *outside* that clip, because
 *    a border hung off the clipped layer would lose its outer half to the clip.
 *  - Unselected: the wrapper itself clips, and a `#0F0F0F` layer at
 *    `opacity-60` veils the art, with the border hanging off that veil.
 *
 * The 0.6 veil is the same dim the legacy launcher used: `version_row.cpp`
 * painted unselected rows with `RGBA(0x0F, 0x0F, 0x0F, 0x99)`, and 0x99/255 is
 * exactly 0.6. `src/renderer/src/data/design.ts` stores it as
 * `VERSION_SCREEN.rowDimOpacity`.
 *
 * The row owns no height. The screen's flex column supplies the 18px gap and
 * `flex-[1_0_0]` to every row, so a row whose art is missing still occupies its
 * exact share of the panel and shows nothing but the `#0F0F0F` surface.
 */
import type { KeyboardEvent } from 'react'

import type { VersionRowProps } from '../contracts'
import { assetUrl } from '../data/assets'

export function VersionRow({ version, selected, onHover, onActivate }: VersionRowProps) {
  const launchable = version.launchable
  const heroSrc = assetUrl(version.heroAsset)

  /**
   * `unavailableReason` is typed `string | null`, so the label is driven by the
   * value rather than by the row's launchability: a concept row without a reason
   * would otherwise render an empty glow box. The only row in the catalog that
   * sets it is BIOHAZARD 1.5, which the concept keeps for documentation even
   * though nothing is behind it (see the note on `re2_proto` in
   * src/shared/catalog.ts).
   */
  const unavailableReason = launchable ? null : version.unavailableReason || null

  const handleMouseEnter = (): void => {
    onHover()
  }

  const handleClick = (): void => {
    onHover()
    // A row with no executable must not pretend to start one; the hover still
    // runs so the info panel follows the pointer onto the concept row.
    if (launchable) onActivate()
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== 'Enter') return
    // Enter is the helper bar's "Confirm". Mirroring the click path exactly
    // (hover, then activate) keeps the info panel showing the row that is about
    // to be acted on when the row was reached by keyboard rather than pointer.
    event.preventDefault()
    onHover()
    if (launchable) onActivate()
  }

  /**
   * The hero lane: full panel width, framed at 1600/740 (`VERSION_SCREEN
   * .heroAspect`), vertically centred on the row. Being wider than the row is
   * tall is the point of the design — the `overflow-clip` around it crops the
   * art rather than letterboxing it.
   */
  const hero =
    heroSrc === '' ? null : (
      <div
        className="-translate-y-1/2 absolute aspect-[1600/740] left-0 right-0 top-1/2"
        data-name="hero"
      >
        <img
          alt=""
          className="absolute inset-0 max-w-none object-cover pointer-events-none size-full"
          src={heroSrc}
        />
      </div>
    )

  return (
    <div
      aria-disabled={launchable ? undefined : true}
      aria-label={version.displayName}
      className={`bg-[#0f0f0f] flex-[1_0_0] min-h-px min-w-px relative rounded-[8px] w-full cursor-pointer select-none ${
        selected ? '' : 'overflow-clip'
      }`}
      data-name="btn/menu"
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      onMouseEnter={handleMouseEnter}
      role="button"
      tabIndex={0}
    >
      {selected ? (
        <>
          <div className="overflow-clip relative rounded-[inherit] size-full">
            {hero}
            <div
              className="absolute bg-[#0f0f0f] inset-0 mix-blend-exclusion pointer-events-none"
              data-name="glow"
            >
              <div
                aria-hidden="true"
                className="absolute border border-[#4d4d4d] border-solid inset-[-0.5px]"
              />
              <div className="absolute inset-[-0.5px] rounded-[inherit] shadow-[inset_0px_0px_36px_0px_rgba(255,255,255,0.25)]" />
            </div>
            {launchable ? null : (
              /**
               * Selection normally brightens a row; an inert concept row keeps
               * the unselected 0.6 veil over its own glow so it never reads as
               * something Enter is about to start. The outer border below is
               * still drawn, so keyboard selection stays visible.
               */
              <div
                className="absolute bg-[#0f0f0f] inset-0 opacity-60 pointer-events-none"
                data-name="dim"
              />
            )}
          </div>
          {/* The export draws both of these outside the clip layer on purpose. */}
          <div className="absolute inset-[-0.5px] pointer-events-none rounded-[inherit] shadow-[inset_0px_4px_36px_0px_rgba(255,255,255,0)]" />
          <div
            aria-hidden="true"
            className="absolute border border-[#4d4d4d] border-solid inset-[-0.5px] pointer-events-none rounded-[8.5px]"
          />
        </>
      ) : (
        <>
          {hero}
          <div className="absolute bg-[#0f0f0f] inset-0 opacity-60" data-name="glow">
            <div
              aria-hidden="true"
              className="absolute border border-[#4d4d4d] border-solid inset-[-0.5px] pointer-events-none"
            />
          </div>
        </>
      )}
      {unavailableReason === null ? null : (
        /**
         * The design's meta box, transcribed from
         * `.ref/designref/src/imports/Frame219.tsx` (`Frame6`): `#0F0F0F`,
         * 16px padding, a 16px uppercase Actor line inside an inset 8px white
         * glow. It is pinned to the row's bottom-left because the concept row
         * has no info-panel line of its own to carry the note.
         */
        <div
          className="absolute bg-[#0f0f0f] bottom-0 flex flex-col gap-[8px] items-start justify-center left-0 p-[16px]"
          data-name="unavailable"
        >
          <p className="font-['Actor:Regular',sans-serif] leading-[normal] not-italic relative shrink-0 text-[16px] text-white uppercase whitespace-nowrap">
            {unavailableReason}
          </p>
          <div className="absolute inset-0 pointer-events-none rounded-[inherit] shadow-[inset_0px_0px_8px_0px_rgba(255,255,255,0.15)]" />
        </div>
      )}
    </div>
  )
}
