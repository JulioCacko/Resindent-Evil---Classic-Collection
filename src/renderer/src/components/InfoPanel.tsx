/**
 * The 860px right-hand column of the Game Version screen.
 *
 * Every layer is transcribed from the Figma export rather than re-derived. The
 * whole stack is in `.ref/designref/src/imports/MainMenuRe1.tsx`:
 *
 *   :176          the 1080x860 frame (`data-name="info"`)
 *   :82-111       base layer: the region-art lane and the blurred ellipse
 *   :70-78        the video lane (`Body2` -> `Main1` -> `Img`)
 *   :148-157      the info block: logo, date, then the description row
 *   :113-146      the Voices row, the meta box, the description paragraphs
 *   :160-167      `Main` draws `Body1` first and `Info` last, which is why the
 *                 text block is the last layer painted here
 *
 * The export repeats that stack once per version row and only the region-art
 * lane changes:
 *
 *   RE1 US   MainMenuRe1.tsx:85   `aspect-[1218.7529296875/1445.560546875]` box,
 *                                 art cropped by `h-[163.67%] left-[-20.62%] …`
 *   RE1 JP   MainMenuRe4.tsx:85   a 1254x940.5 box centred on the lane
 *   RE2 US   MainMenuRe2.tsx:85   `aspect-[1016/1132]`, art filling the box
 *   RE2 JP   MainMenuRe5.tsx:74   `aspect-[1664/2046]` hung off `bottom-[-116.59px]`
 *   RE3      MainMenuRe3.tsx:74   `aspect-[1920/1441]` hung off `top-[-22.19%]`
 *
 * Masks are `MASKS` in data/design.ts — the export's four inline SVG gradients
 * (`.ref/designref/src/imports/svg-xcltc.tsx:1-4`) written as plain CSS — and are
 * applied as inline styles because they are CSS gradients, not utilities.
 *
 * Class strings are kept literal. Tailwind only sees candidate classes that
 * appear as complete text in the source, so nothing here is interpolated; the
 * only data-driven values are the logo box size, which comes from
 * `GameVersion.logoWidth`/`logoHeight` in the catalog and is therefore a style
 * rather than a class.
 */
import { useState } from 'react'
import type { CSSProperties } from 'react'

import type { GameVersion, TitleId } from '@shared/types'
import type { InfoPanelProps } from '@renderer/contracts'
import { assetUrl } from '@renderer/data/assets'
import { MASKS, VERSION_SCREEN } from '@renderer/data/design'

/**
 * The export carries every mask on an SVG gradient that only ever uses its alpha
 * channel, so the CSS equivalent is a plain `linear-gradient`. Both spellings are
 * emitted: the export's own CSS is the `-webkit-mask-*` family, the standard
 * property is what the platform now implements, and setting both costs nothing
 * and keeps the layer masked under either.
 *
 * `size` is the export's own `mask-size-[…]`, and it is only passed for the two
 * masks whose design size differs from the box it is painted on:
 *
 *   regionArt  860x647          on the 860x647 lane          -> size is the box
 *   infoPanel  860x1080         on the 860x1080 base layer   -> size is the box
 *   videoLane  860.102x602.547  on the 1080-tall lane        -> needs the size
 *   videoFrame 859.898x418.749  on the 444-tall video box    -> needs the size
 *
 * Those two are the difference between a fade and a wash: the default
 * (`mask-size: auto`) stretches the gradient over the whole element, which would
 * push the video lane's fade ~150px down the column. `no-repeat` travels with the
 * size because outside a 602.547px-tall mask the Figma layer is transparent —
 * that is what `mask-no-repeat` means in the export's class list.
 *
 * The frame's size is the mask artwork's own box (data/design.ts:144 records it as
 * 859.898x418.749) and not the `mask-size-[640px_418.75px]` the export's class
 * list carries: with `no-repeat`, a 640px-wide mask would mask out the video's
 * right 220px, which is not what a purely vertical gradient can mean. Only the
 * vertical geometry is load-bearing, and the frame mask's sub-pixel offset
 * (`mask-position-[0px_-0.793px]`) is not reproduced.
 */
function mask(image: string, size?: string): CSSProperties {
  if (size === undefined) return { maskImage: image, WebkitMaskImage: image }
  return {
    maskImage: image,
    WebkitMaskImage: image,
    maskRepeat: 'no-repeat',
    WebkitMaskRepeat: 'no-repeat',
    maskSize: size,
    WebkitMaskSize: size
  }
}

/**
 * The blurred ellipse's outline, verbatim from `svgPaths.p3470b00`
 * (`.ref/designref/src/imports/svg-92apoij4d6.ts:2`). It is the only path in the
 * component; every version uses the same one, which is why the overlay sits
 * *inside* the region-art lane rather than being part of the per-version art.
 */
const OVERLAY_PATH =
  'M1427.1 606.5C1849.13 606.5 2247.7 921.3 2247.7 1375.69C2247.7 1830.08 1849.13 2144.88 1427.1 2144.88C1005.07 2144.88 606.5 1830.08 606.5 1375.69C606.5 921.3 1005.07 606.5 1427.1 606.5Z'

/**
 * The export's blur filter id (`filter0_f_1_770` in the RE1 frame) is replaced by
 * a stable name: two panels never mount at once, and if they ever did the filter
 * is identical, so a shared id is harmless — but a readable one is testable.
 */
const OVERLAY_FILTER_ID = 'info-panel-ellipse-blur'

/**
 * Where the art sits inside the region-art lane: the lane's own box classes and
 * the classes for the image inside it, both spelled exactly as the export writes
 * them.
 */
interface RegionLane {
  /** The aspect-ratio box the art is cropped into. */
  box: string
  /** The image inside that box. */
  art: string
}

/** Every lane but RE1 US leaves the image at `inset-0` and lets `object-cover` crop. */
const ART_FILL = 'absolute inset-0 max-w-none object-cover pointer-events-none size-full'

/**
 * RE1 US: the art box is 860x1019.98 (the aspect of the design's `image 15`) hung
 * at `top-[-109.94px]`, and the image is the export's oversized crop
 * (`MainMenuRe1.tsx:87`). `object-cover` is added to that crop: the export leaves
 * the image unfitted because its own `image 16` already has the crop's aspect,
 * while this app feeds the same lane the 1068x1080 region art
 * (tools/sync-design-assets.mjs:70-78) — without the fit, the art would stretch.
 */
const LANE_RE1_US: RegionLane = {
  box: 'absolute aspect-[1218.7529296875/1445.560546875] left-0 right-0 top-[-109.94px]',
  art: 'absolute h-[163.67%] left-[-20.62%] max-w-none object-cover pointer-events-none top-[-27.26%] w-[120.62%]'
}

/** RE1 JP: a fixed 1254x940.5 box, centred on the lane (`MainMenuRe4.tsx:85`). */
const LANE_RE1_JP: RegionLane = {
  box: '-translate-x-1/2 -translate-y-1/2 absolute h-[940.5px] left-1/2 top-1/2 w-[1254px]',
  art: ART_FILL
}

/**
 * RE2 US: `left-[-0.05%] right-0` only, so the box is 860.43 wide and its height
 * falls out of the aspect (`MainMenuRe2.tsx:85`).
 */
const LANE_RE2_US: RegionLane = {
  box: 'absolute aspect-[1016/1132] left-[-0.05%] right-0 top-0',
  art: ART_FILL
}

/** RE2 JP: the box is hung off the lane's bottom edge (`MainMenuRe5.tsx:74`). */
const LANE_RE2_JP: RegionLane = {
  box: 'absolute aspect-[1664/2046] bottom-[-116.59px] left-0 right-0',
  art: ART_FILL
}

/**
 * RE3: `left-0` with `top-[-22.19%]` and `bottom-0` — no width is given, so the
 * 790.57-tall box takes its 1053.4 width from the aspect (`MainMenuRe3.tsx:74`).
 * MainMenuRe6 (the second RE3 screen) draws the identical lane, so both RE3 rows
 * carry it.
 */
const LANE_RE3: RegionLane = {
  box: 'absolute aspect-[1920/1441] bottom-0 left-0 top-[-22.19%]',
  art: ART_FILL
}

/**
 * The lane per version id.
 *
 * Two catalog rows have no frame of their own in the export. The vendored screen
 * switcher resolves them by clamping the row index onto its title's screens —
 * `.ref/designref/src/app/components/VersionSelectPage.tsx:18-22` lists two
 * screens for each title and `:86` is `Math.min(versionIndex, screens.length - 1)`
 * — so RE1's third row (DIRECTOR'S CUT) and RE2's second row (BIOHAZARD 1.5) are
 * drawn on the RE1 JP and RE2 JP lanes respectively. That clamp is the only
 * authoritative statement the design makes about those rows, so it is what they
 * get rather than an invented geometry.
 */
const REGION_LANES: Record<string, RegionLane> = {
  re1_us: LANE_RE1_US,
  re1_jp: LANE_RE1_JP,
  re1_dc: LANE_RE1_JP,
  re2_leon_us: LANE_RE2_US,
  re2_proto: LANE_RE2_JP,
  re2_jp: LANE_RE2_JP,
  re3_us: LANE_RE3,
  re3_jp: LANE_RE3
}

/**
 * Fallback for a version id the table above does not carry: the lane of that
 * title's first screen. The table is data-driven, so a renamed or added catalog
 * row must still render a lane instead of crashing on an undefined lookup.
 */
const TITLE_LANES: Record<TitleId, RegionLane> = {
  re1: LANE_RE1_US,
  re2: LANE_RE2_US,
  re3: LANE_RE3
}

function regionLane(version: GameVersion): RegionLane {
  return REGION_LANES[version.id] ?? TITLE_LANES[version.titleId]
}

/**
 * The export's paragraph separator: one blank line. `\r\n` is accepted because
 * the catalog's descriptions are hand-written strings and the text is rendered
 * with `whitespace-pre-wrap`, so what is here is what the design shows.
 */
const PARAGRAPH_BREAK = /\r?\n[ \t]*\r?\n/

/**
 * The description as the export draws it: one `<p>` per paragraph with an
 * explicit `&nbsp;` paragraph between them (`MainMenuRe1.tsx:139-141`). Splitting
 * on the blank lines alone would swallow the blank line — and with the design's
 * `leading-none` that line is exactly 20px of the block's 160px — so it is put
 * back as its own paragraph. A single newline *inside* a paragraph is left alone
 * and becomes a hard break, which is what `whitespace-pre-wrap` is there for.
 */
function descriptionParagraphs(description: string): string[] {
  const paragraphs = description.split(PARAGRAPH_BREAK)
  const blocks: string[] = []
  paragraphs.forEach((paragraph, index) => {
    if (index > 0) blocks.push('\u00A0')
    blocks.push(paragraph)
  })
  return blocks
}

/**
 * The video lane, and the only stateful layer in the panel.
 *
 * The design's frame is a fixed 860x444 window (`MainMenuRe1.tsx:52-68`): the
 * video is `object-cover` inside it, masked by `MASKS.videoFrame` so its bottom
 * edge dissolves into the info block below. The lane itself is a 1080-tall,
 * full-width column whose mask (`MASKS.videoLane`, 860.102x602.547) is anchored
 * to the column's top and fades the window in from y≈66 — which is why the video
 * box is the column's first child rather than a centred one, and why the mask's
 * own size has to be passed rather than left to stretch over 1080px.
 *
 * A version whose `videoAsset` is unknown to data/assets.ts resolves to '', and a
 * file that fails to decode fires `error` on the media element; both fall back to
 * the version's hero still, and to nothing at all if that is missing too. The
 * failed source is tracked by URL rather than by a boolean so that switching
 * versions in place recovers without an effect to reset the flag.
 */
function VideoLane({ version }: { version: GameVersion }) {
  const videoSrc = assetUrl(version.videoAsset)
  const heroSrc = assetUrl(version.heroAsset)
  const [failedSrc, setFailedSrc] = useState<string | null>(null)

  const showVideo = videoSrc !== '' && failedSrc !== videoSrc
  const showHero = !showVideo && heroSrc !== '' && failedSrc !== heroSrc

  return (
    <div
      className="-translate-y-1/2 absolute content-stretch flex flex-col h-[1080px] items-center left-0 right-0 top-1/2"
      data-name="video-lane"
      style={mask(MASKS.videoLane, '860.102px 602.547px')}
    >
      {/*
        `relative` and `shrink-0` are the export's own `Main1`
        (MainMenuRe1.tsx:64): the media inside is `absolute inset-0`, so this box
        — not the 1080-tall lane — has to be its containing block.
      */}
      <div
        className="h-[444px] relative rounded-[2px] shrink-0 w-full"
        data-name="video"
        style={mask(MASKS.videoFrame, '859.898px 418.749px')}
      >
        {showVideo ? (
          /**
           * `muted` is load-bearing rather than cosmetic: Chromium will not
           * autoplay an audible video without a user gesture, and a screen that
           * swaps the lane in has no gesture to offer. The `key` remounts the
           * element when a new version brings a new file, so the old trailer
           * cannot keep playing under the new row.
           */
          <video
            autoPlay
            className="absolute max-w-none object-cover rounded-[2px] size-full"
            controlsList="nodownload"
            key={videoSrc}
            loop
            muted
            onError={() => setFailedSrc(videoSrc)}
            playsInline
          >
            <source src={videoSrc} />
          </video>
        ) : null}
        {showHero ? (
          <img
            alt=""
            className="absolute inset-0 max-w-none object-cover pointer-events-none rounded-[2px] size-full"
            onError={() => setFailedSrc(heroSrc)}
            src={heroSrc}
          />
        ) : null}
      </div>
    </div>
  )
}

export function InfoPanel({ version, children }: InfoPanelProps) {
  const lane = regionLane(version)
  const regionSrc = assetUrl(version.regionAsset)
  const logoSrc = assetUrl(version.logoAsset)

  /**
   * The meta box's first line is the release note, or the box note for the one
   * row that never shipped: BIOHAZARD 1.5 carries
   * `originalRelease: ''` and `boxNote: 'Planned Release IN March 1997 …'`
   * (src/shared/catalog.ts, `re2_proto`).
   */
  const metaLine = version.originalRelease === '' ? version.boxNote : version.originalRelease
  const blocks = descriptionParagraphs(version.description)

  return (
    <div className="h-[1080px] overflow-clip relative shrink-0 w-[860px]" data-name="info-panel">
      {/*
        The base layer, masked by `MASKS.infoPanel` so the left 180px of the
        column fades into the version list's panel. The export also paints a
        `bg-[#0f0f0f]` layer at this point (MainMenuRe1.tsx:83) to back the two
        media lanes; it is omitted because the screen underneath is already that
        exact colour, so the layer would paint nothing visible.
      */}
      <div
        aria-hidden="true"
        className="absolute inset-0"
        data-name="body"
        style={mask(MASKS.infoPanel)}
      >
        <div
          className="absolute h-[647px] left-0 opacity-[0.98] overflow-clip top-[433px] w-[860px]"
          data-name="game"
          style={mask(MASKS.regionArt)}
        >
          {regionSrc === '' ? null : (
            <div className={lane.box} data-name="region-art">
              <img alt="" className={lane.art} src={regionSrc} />
            </div>
          )}
          {/*
            The blurred ellipse: a 1028.197x925.377 box centred on the lane, whose
            child is scaled out by `inset-[-98.66%_-88.8%]` so the 2854x2751
            artwork covers it. The path's 613px black stroke, blurred by 150px at
            0.91 opacity, is the darkening the design puts behind the art; it is
            inline rather than a bundled SVG because it is a filter, not a file.
          */}
          <div
            className="-translate-x-1/2 -translate-y-1/2 absolute h-[925.377px] left-1/2 top-[calc(50%+0.31px)] w-[1028.197px]"
            data-name="overlay"
          >
            <div className="absolute inset-[-98.66%_-88.8%]">
              <svg
                className="block overflow-visible size-full"
                fill="none"
                preserveAspectRatio="none"
                viewBox="0 0 2854.2 2751.38"
              >
                <g filter={`url(#${OVERLAY_FILTER_ID})`} opacity={0.91}>
                  <path d={OVERLAY_PATH} stroke="black" strokeWidth={613} />
                </g>
                <defs>
                  <filter
                    colorInterpolationFilters="sRGB"
                    filterUnits="userSpaceOnUse"
                    height="2751.38"
                    id={OVERLAY_FILTER_ID}
                    width="2854.2"
                    x="0"
                    y="0"
                  >
                    <feFlood floodOpacity="0" result="BackgroundImageFix" />
                    <feBlend in="SourceGraphic" in2="BackgroundImageFix" mode="normal" result="shape" />
                    <feGaussianBlur result="effect1_foregroundBlur" stdDeviation={150} />
                  </filter>
                </defs>
              </svg>
            </div>
          </div>
        </div>

        <VideoLane version={version} />
      </div>

      {/*
        The launch panel's slot. It is a full-height column justified to the end,
        so a caller that hands over a flow-positioned panel — which is what
        overlays/LaunchPanel.tsx is — docks it against the bottom edge and grows
        it upward, while a caller that hands over an absolutely positioned one
        still anchors to the panel's own box. It renders nothing at all when the
        slot is empty, so the resting layout is untouched, and it sits above the
        info block by `z-20` rather than by DOM order: the block is painted last
        because the design says so (MainMenuRe1.tsx:160-167), but the panel has to
        cover it, not the other way round.
      */}
      <div className="absolute inset-0 flex flex-col justify-end z-20" data-name="panel-slot">
        {children}
      </div>

      <div
        className="absolute bottom-0 content-stretch flex flex-col gap-[16px] h-[482px] items-start left-0 pb-[73px] pt-[16px] px-[32px] right-0"
        data-name="info"
        style={{ ...mask(MASKS.infoPanel), backgroundImage: VERSION_SCREEN.info.blockGradient }}
      >
        {/*
          The logo box is the one measured value that changes per row, so it is a
          style rather than a class: `w-[262.686px]`-style classes cannot be built
          from data, since Tailwind only emits candidates it can read as literal
          text. `logoHeight` is 70 on every row but DIRECTOR'S CUT (`re1_dc`,
          120) — and because the export marks the logo, the date and the row
          `shrink-0`, a taller logo is allowed to push the block past its 482px
          rather than being squashed.
        */}
        <div
          className="relative shrink-0"
          data-name="logo"
          style={{ height: version.logoHeight, width: version.logoWidth }}
        >
          {logoSrc === '' ? null : (
            <img
              alt=""
              className="absolute inset-0 max-w-none object-cover pointer-events-none size-full"
              src={logoSrc}
            />
          )}
        </div>

        <p className="font-['Actor:Regular',sans-serif] leading-[0.99] not-italic relative shrink-0 text-[32px] text-shadow-[0px_0px_2px_rgba(0,0,0,0.12),0px_4px_8px_rgba(0,0,0,0.14)] text-white whitespace-nowrap">
          {version.releaseLabel}
        </p>

        <div
          className="content-stretch flex flex-col gap-[18px] h-[247px] items-start relative shrink-0 w-full"
          data-name="row"
        >
          {/*
            `text-justify` justifies every line but the last *of each paragraph*,
            which is why the description is a stack of `<p>`s instead of one text
            node: a single block would justify the last line of the first
            paragraph against the design. `w-[min-content] min-w-full` is the
            export's own hug-to-content pair, and resolves to the row's full width.
          */}
          <div className="font-['Actor:Regular',sans-serif] h-[160px] leading-none min-w-full not-italic relative shrink-0 text-[20px] text-justify text-shadow-[0px_0px_2px_rgba(0,0,0,0.12),0px_4px_8px_rgba(0,0,0,0.14)] text-white w-[min-content] whitespace-pre-wrap">
            {blocks.map((block, index) => (
              // The list is a fixed, order-stable projection of one string, so the
              // index is the only key available and is stable for this content.
              <p className="mb-0" key={index}>
                {block}
              </p>
            ))}
          </div>

          {/*
            The meta box (the export's `Frame3`). Its inset glow is written on the
            box itself rather than as the export's separate
            `absolute inset-0 rounded-[inherit]` sibling (MainMenuRe1.tsx:130):
            an inset shadow paints above the background and below the text, so the
            pixels are the same and the glow stays on the element it belongs to.
            The line is hidden entirely when both release note and box note are
            empty, because an empty paragraph would still pay the box's 8px gap.
          */}
          <div
            className="bg-[#0f0f0f] flex flex-col gap-[8px] items-start justify-center p-[16px] relative shrink-0 shadow-[inset_0px_0px_8px_0px_rgba(255,255,255,0.15)]"
            data-name="meta"
          >
            {metaLine === '' ? null : (
              <p className="font-['Actor:Regular',sans-serif] leading-[normal] not-italic relative shrink-0 text-[16px] text-white uppercase whitespace-pre">
                {metaLine}
              </p>
            )}
            {/*
              Five separate `<p>`s, as the export splits them, and the two values
              keep their leading space — the design's own spacing quirk, preserved
              because `whitespace-nowrap` (unlike the RE2 JP frame's
              `whitespace-pre`, MainMenuRe5.tsx:107) is what the RE1 frame asks
              for on the row.
            */}
            <div
              className="content-stretch flex font-['Actor:Regular',sans-serif] gap-[10px] items-center justify-center leading-[normal] not-italic relative shrink-0 text-[16px] text-white uppercase whitespace-nowrap"
              data-name="row"
            >
              <p className="relative shrink-0">Voices:</p>
              <p className="relative shrink-0">{` ${version.voices}`}</p>
              <p className="relative shrink-0">|</p>
              <p className="relative shrink-0">Subtitles:</p>
              <p className="relative shrink-0">{` ${version.subtitles}`}</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
