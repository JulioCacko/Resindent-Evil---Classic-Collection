/**
 * The Gameplay screen: the frame that stays up while the title's game runs.
 *
 * Three exports draw it, one per title, and they differ only in their offsets:
 *
 *   `.ref/designref/src/imports/MainMenuRe1Gameplay.tsx`
 *      :83      the root — `bg-[#0f0f0f] content-stretch flex gap-[10px] items-start
 *               relative size-full`
 *      :66-79   `Body`, which in the export also paints the backdrop
 *      :26-64   `GameFrame` — the region-art lane (`game`, :29), the white card
 *               (`Gameplay 1`, :52) and the rotated logo lockup (:55)
 *      :8-24    `Img`/`Main` — the still inside the card and its oversized crop
 *   `.ref/designref/src/imports/MainMenuRe2Gameplay.tsx`
 *      the same frame for RE2: its card holds a `<video>` instead of a still
 *      (:7-15) and its lane hangs 418px off the right edge (:28)
 *   `.ref/designref/src/imports/MainMenuRe3Gameplay.tsx`
 *      RE3's frame: a 1285px lane (:19), a card at `top-[52.28px]` (:40) and a
 *      still that simply fills its box (:8-14)
 *
 * The values that vary per title are `GAMEPLAY_LAYOUTS` in data/design.ts (lane
 * width/right offset/top and the art's own insets, the card's top, the logo's
 * box) and the values shared by all three are `GAMEPLAY_COMMON` and `MASKS`.
 * Everything else — every class string — is transcribed from the export.
 *
 * Two surfaces are deliberately NOT drawn here, because the shell already draws
 * them: the backdrop (`Backdrop` is mounted once by App.tsx with the .10 opacity
 * and the -40.23px offset the export puts in `Body`, MainMenuRe1Gameplay.tsx:69)
 * and the CRT pass. A second copy of either would blend or scan twice. This
 * screen also plays nothing and handles no keys: App.tsx routes every canonical
 * action to `store.handleAction`, and `resolveIntent` is the single place that
 * decides that Escape on this screen means "back to the running game's version
 * list" (state/store.ts:466-473), which is the design's own behaviour
 * (`.ref/designref/src/app/components/GameplayPage.tsx:22-28`).
 */
import clsx from 'clsx'
import { useState } from 'react'
import type { CSSProperties } from 'react'

import type { CatalogSnapshot, GameStatus, GameTitle, GameVersion, TitleId } from '@shared/types'
import { HelperBar } from '@renderer/components/HelperBar'
import { assetUrl } from '@renderer/data/assets'
import { canLaunch } from '@renderer/data/derive'
import { GAMEPLAY_COMMON, GAMEPLAY_LAYOUTS, HINTS_GAMEPLAY, MASKS } from '@renderer/data/design'
import type { GameplayLayout } from '@renderer/data/design'
import { useLauncher } from '@renderer/state/store'

/**
 * The export names each frame after its title — "Main Menu / RE 1 / Gameplay" at
 * MainMenuRe1Gameplay.tsx:83, "… / RE 2 / Gameplay" at MainMenuRe2Gameplay.tsx:80
 * and "… / RE 3 / Gameplay" at MainMenuRe3Gameplay.tsx:71 — and this is one
 * component serving all three, so the name follows the title being drawn instead
 * of being pinned to one of them.
 */
const FRAME_NAME: Record<TitleId, string> = {
  re1: 'Main Menu / RE 1 / Gameplay',
  re2: 'Main Menu / RE 2 / Gameplay',
  re3: 'Main Menu / RE 3 / Gameplay'
}

/**
 * The blurred ellipse's outline, verbatim from `svgPaths.p3470b00`
 * (`.ref/designref/src/imports/svg-rzwuogcawc.ts:2` for the RE1 frame, and byte
 * for byte the same path in the RE2 and RE3 ones). It is the same overlay the
 * Game Version screen's info panel draws, which is why the three gameplay frames
 * and `MainMenuRe1.tsx:90` all carry an identical `overlay` node.
 */
const OVERLAY_PATH =
  'M1427.1 606.5C1849.13 606.5 2247.7 921.3 2247.7 1375.69C2247.7 1830.08 1849.13 2144.88 1427.1 2144.88C1005.07 2144.88 606.5 1830.08 606.5 1375.69C606.5 921.3 1005.07 606.5 1427.1 606.5Z'

/**
 * SVG `filter` can only be referenced by id, and every gameplay frame reuses
 * Figma's own `filter0_f_1_788`. The info panel owns that name for its own copy
 * (`components/InfoPanel.tsx`, `info-panel-ellipse-blur`) and two screens never
 * mount at once, but ids are document-global: this one is named for the screen
 * that draws it so the two can never collide.
 */
const OVERLAY_FILTER_ID = 'gameplay-art-ellipse-blur'

/**
 * A CSS mask, in both spellings.
 *
 * The export expresses its masks as inline SVG gradients referenced through
 * `mask-image`; data/design.ts holds their CSS equivalents (`MASKS`), and
 * components/InfoPanel.tsx sets both `mask-image` and `-webkit-mask-image` for the
 * same reason: one is the export's own family, the other is what the platform now
 * implements, and setting both costs nothing.
 *
 * No `mask-size` is passed, unlike the two masks the info panel has to size: this
 * gradient is purely vertical and is painted on the lane it belongs to, so the
 * default (`auto`, i.e. the element's own box) is the design's own geometry —
 * `MASKS.regionArt` is recorded as an 860x647 lane in the info panel, while here
 * the lane is 1080 tall and the gradient stretches over it.
 */
function regionMask(image: string): CSSProperties {
  return { maskImage: image, WebkitMaskImage: image }
}

/**
 * Whether a recorded lane offset is the export's vertical *anchor* rather than a
 * resolved offset.
 *
 * Every gameplay frame centres its 1080px lane on the 1080px body with
 * `-translate-y-1/2` and then anchors it: `top-1/2` for RE1 and RE2
 * (MainMenuRe1Gameplay.tsx:29, MainMenuRe2Gameplay.tsx:28) and
 * `top-[calc(50%-0.22px)]` for RE3 (MainMenuRe3Gameplay.tsx:19), which resolves to
 * y=0, y=0 and y=-0.22px.
 *
 * `GAMEPLAY_LAYOUTS.art.top` carries that anchor for RE1 ('50%') and RE3
 * ('calc(50% - 0.22px)') but RE2's entry is '0' — the resolved y=0, not the
 * anchor the export writes. The translate therefore travels with the spelling: a
 * percentage expression is an anchor and needs it, a plain offset is already the
 * final position. Applying the translate unconditionally would lift RE2's lane
 * 540px and leave the right half of that screen without any art (and, because
 * `MASKS.regionArt` is transparent at the top of the lane, with nothing visible at
 * all); dropping it unconditionally would drop RE1's and RE3's lane 540px the
 * other way. Both spellings resolve to the export's y=0, so this rule keeps
 * rendering the right thing whether the RE2 entry stays as it is or is corrected to
 * the anchor the export writes.
 */
function laneNeedsCentreAnchor(top: string): boolean {
  return top.includes('%')
}

/** The title and version this screen is drawing. */
interface GameplayTarget {
  title: GameTitle
  version: GameVersion
}

/**
 * Which row the screen shows.
 *
 * `gameplay` is the launch record (`goToGameplay` writes it, state/store.ts:702)
 * and is the honest answer for "what did I start", but it is not guaranteed to be
 * there: the record lives in the store rather than in the running process, so a
 * flow that leaves the screen and comes back can arrive with nothing recorded
 * while the game is still running. `gameStatus` is the process's own fact and is
 * what fills that gap — but only for a game that is actually running, and only for
 * the title being drawn, because a version id means nothing outside its own title.
 *
 * With neither — nothing recorded and nothing running — the first *launchable*
 * version of the title is drawn, and failing that the title's first row, so the
 * screen always has art and a logo to draw instead of an empty frame. The legacy
 * launcher has no precedent for "which row is live", because it had no gameplay
 * surface at all (`git show HEAD:src/ui/screens` lists title, version, launch,
 * install and error only); what it does state is the condition this fallback leans
 * on, since its launch screen refuses to start anything for a title with no install
 * path and raises "Game is not installed or path is unknown" instead
 * (`git show HEAD:src/ui/screens/screen_launch.cpp`, `OnInput`). `canLaunch` is that
 * same "this row can actually start" test, for one row.
 *
 * The store's selected title is the last resort for *which* title: it is what the
 * store's own Back handler falls back to as well (state/store.ts:472).
 */
function resolveTarget(
  catalog: CatalogSnapshot | null,
  gameplay: { titleId: TitleId; versionId: string } | null,
  gameStatus: GameStatus,
  selectedTitleId: TitleId
): GameplayTarget | null {
  const titleId = gameplay?.titleId ?? gameStatus.titleId ?? selectedTitleId
  // `catalog` is null only before the first snapshot resolves, which `App` gates
  // on, so this is the defensive branch rather than the normal one.
  const title = catalog?.titles.find((candidate) => candidate.id === titleId)
  if (title === undefined) return null

  const versions = title.versions
  const recorded =
    gameplay === null ? undefined : versions.find((candidate) => candidate.id === gameplay.versionId)
  /*
   * `gameStatus.running` gates this rather than just the ids: `gameStatus` keeps
   * the last run's title and version after an exit (`onGameExit`, state/store.ts:602),
   * so an ungated read would treat a finished game as the subject of the screen. A
   * *running* process, by contrast, is exactly what this frame is for. The version id
   * is also only meaningful inside its own title, hence the title check.
   */
  const running =
    gameStatus.running && gameStatus.titleId === titleId && gameStatus.versionId !== null
      ? versions.find((candidate) => candidate.id === gameStatus.versionId)
      : undefined

  const version =
    recorded ??
    running ??
    versions.find((candidate) => canLaunch(candidate)) ??
    // `.at(0)` rather than `versions[0]`: a title the main process reported with no
    // rows is a real possibility, and it has to read as "nothing to draw".
    versions.at(0)

  if (version === undefined) return null
  return { title, version }
}

/**
 * The region-art lane: the title's artwork behind and beside the card, then the
 * blurred ellipse over it.
 *
 * The lane is the export's `game` box — 1080px tall, hung off the right edge by a
 * negative `right` and clipped — and it carries the mask, not the art inside it.
 * The export puts its mask artwork on the art box and again on the overlay, both
 * with a `mask-size`/`mask-position` pair that resolves to one rectangle: the lane's
 * own box (the art box hangs 109.94px/22.19% above the lane and its mask-position
 * cancels exactly that, MainMenuRe1Gameplay.tsx:30, MainMenuRe3Gameplay.tsx:20).
 * Masking the lane therefore paints the same pixels with one property instead of
 * three, and it masks the ellipse with it — which is what the export asks for by
 * masking the overlay too.
 */
function ArtLane({ version, layout }: { version: GameVersion; layout: GameplayLayout }) {
  const regionSrc = assetUrl(version.regionAsset)
  const { art } = layout

  return (
    <div
      className={clsx(
        'absolute h-[1080px] overflow-clip',
        laneNeedsCentreAnchor(art.top) && '-translate-y-1/2'
      )}
      data-figma-node="gameplay-art"
      data-name="game"
      style={{ ...regionMask(MASKS.regionArt), right: art.right, top: art.top, width: art.width }}
    >
      {regionSrc === '' ? null : (
        /*
         * The aspect box the art is cropped into. Its insets and aspect are the
         * layout's own numbers (`art.laneInset`, `art.aspect`) and are therefore a
         * style rather than a class: Tailwind only emits candidates that appear as
         * complete text in the source, so it can never interpolate a data value
         * into `aspect-[…]` or `top-[…]`.
         *
         * RE1's art is the export's oversized crop (`h-[163.67%] left-[-20.62%] …`),
         * which the app feeds the 1068x1080 region art from media/ — the export
         * leaves it unfitted because its own `image 16` already has the crop's
         * aspect, so `object-cover` is added here for the same reason
         * components/InfoPanel.tsx adds it to the same lane on the version screen:
         * without the fit, the art stretches.
         */
        <div
          className="absolute"
          data-name="region-art"
          style={{ aspectRatio: art.aspect, inset: art.laneInset }}
        >
          {art.mediaInset === null ? (
            <img
              alt=""
              className="absolute inset-0 max-w-none object-cover pointer-events-none size-full"
              src={regionSrc}
            />
          ) : (
            <img
              alt=""
              className="absolute max-w-none object-cover pointer-events-none"
              src={regionSrc}
              style={art.mediaInset}
            />
          )}
        </div>
      )}

      {/*
        The blurred ellipse, exactly as the info panel draws it: a 1028.197x925.377
        box centred on the lane whose child is scaled out by `inset-[-98.66%_-88.8%]`
        so the 2854.2x2751.38 artwork covers it. Its path is stroked 613px of black
        and blurred by 150px at 0.91 opacity — the darkening the design lays behind
        the art. It is inline rather than a bundled SVG because it is a filter
        definition, not a file.
      */}
      <div
        className="-translate-x-1/2 -translate-y-1/2 absolute h-[925.377px] left-1/2 top-[calc(50%+0.31px)] w-[1028.197px]"
        data-name="overlay"
      >
        <div className="absolute inset-[-98.66%_-88.8%]">
          <svg
            className="block size-full"
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
  )
}

/**
 * The media inside the card: a still for RE1 and RE3, the RE2 trailer for RE2.
 * `GameVersion.gameplayMedia` carries the kind, and @shared/catalog's
 * `GAMEPLAY_MEDIA` is where the design's per-title choice is written down (a still
 * for RE1, a video for RE2, a still for RE3).
 *
 * Both kinds are placed in the card's `main` box and cropped by
 * `GAMEPLAY_COMMON.mediaInset` — the export's oversized, offset media box
 * (`h-[107.28%] left-[-0.05%] top-[-3.78%] w-[100.1%]`, MainMenuRe1Gameplay.tsx:12)
 * — with `object-cover` doing the fitting, so the kind selects an element rather
 * than a geometry. The recipe is RE1's, where the box is the still's own crop box
 * (`left-[-20.62%]`-style oversizing is how the design frames it); because a crop
 * box's aspect is the aspect the art was authored at, `object-cover` into it crops
 * as the design does. RE2's frame writes `size-full` on its `<video>` and RE3's
 * writes `inset-0` on its `<img>` (MainMenuRe2Gameplay.tsx:10,
 * MainMenuRe3Gameplay.tsx:11) — the card's own window, a few percent wider — so the
 * shared box is within a few percent of all three, and one media layer is what keeps
 * the screens from drifting apart.
 *
 * `muted` is load-bearing rather than cosmetic: Chromium refuses to autoplay an
 * audible video without a user gesture, and this screen is reached by a keypress
 * that the video's own element never sees. The `key` remounts the element when a
 * different version brings a different file, so the previous trailer cannot keep
 * playing under the new card, and the failed-source guard is
 * components/Media.tsx's rule: a missing or undecodable file degrades to nothing
 * (here, the card's own white ground) rather than to a broken icon.
 */
function CardMedia({ version }: { version: GameVersion }) {
  const media = version.gameplayMedia
  const src = assetUrl(media.asset)
  const [failedSrc, setFailedSrc] = useState<string | null>(null)

  if (src === '' || failedSrc === src) return null

  if (media.kind === 'video') {
    return (
      <div className="absolute inset-0 rounded-[2px]" data-name="IMG">
        <video
          autoPlay
          className="absolute max-w-none object-cover rounded-[2px]"
          controlsList="nodownload"
          key={src}
          loop
          muted
          onError={() => setFailedSrc(src)}
          playsInline
          style={GAMEPLAY_COMMON.mediaInset}
        >
          <source src={src} />
        </video>
      </div>
    )
  }

  return (
    <div className="absolute inset-0 rounded-[2px]" data-name="IMG">
      {/* The export clips the oversized still to the 2px-rounded media box
          (`MainMenuRe1Gameplay.tsx:11`); the card's own `overflow-clip` and 4px
          radius sit outside it. */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none rounded-[2px]">
        <img
          alt=""
          className="absolute max-w-none object-cover pointer-events-none"
          onError={() => setFailedSrc(src)}
          src={src}
          style={GAMEPLAY_COMMON.mediaInset}
        />
      </div>
    </div>
  )
}

/**
 * The gameplay card: a fixed 1300x975 white box, itself clipped, that holds the
 * media. Its only per-title value is its top edge (`GAMEPLAY_LAYOUTS.cardTop`:
 * 45px for RE1 and RE2, 52.28px for RE3), so that one number is a style while the
 * box's own class string stays the export's. `Gameplay 1` is the export's own
 * `data-name` for it.
 */
function GameplayCard({ version, top }: { version: GameVersion; top: number }) {
  return (
    <div
      className="-translate-x-1/2 absolute bg-white h-[975px] left-1/2 overflow-clip rounded-[4px] w-[1300px]"
      data-figma-node="gameplay-card"
      data-name="Gameplay 1"
      style={{ top }}
    >
      {/* `main` starts 0.1% above the card (`inset-[-0.1%_0_0_0]`,
          MainMenuRe1Gameplay.tsx:20), which is why the media box's own top offset
          is measured from there. */}
      <div className="absolute inset-[-0.1%_0_0_0]" data-name="main">
        <CardMedia version={version} />
      </div>
    </div>
  )
}

/**
 * The rotated logo lockup: the version's wordmark turned -90° and pinned to the
 * left of the card, in the band the lane leaves in the middle of the frame.
 *
 * The rotation has to happen *inside* the centred wrapper, which is why the
 * nesting is reproduced exactly as the export writes it: the artwork is drawn as
 * an unrotated 516.266x137.574 box (RE1) and `-rotate-90` turns it about its own
 * centre to become 137.574x516.266 — the wrapper's box, which the design sizes to
 * match (`GameplayLayout.logo` holds both, box vs. artwork). Rotating the wrapper
 * instead would rotate the artwork about the *wrapper's* centre with the artwork
 * still laid out horizontally, which moves it half its width off. `flex-none` keeps
 * the rotated box out of the flex sizing, so `items-center justify-center` has
 * nothing to distribute.
 */
function RotatedLogo({ version, layout }: { version: GameVersion; layout: GameplayLayout }) {
  const logoSrc = assetUrl(version.logoAsset)
  const { logo } = layout

  return (
    <div
      className="-translate-y-1/2 absolute flex items-center justify-center"
      data-figma-node="gameplay-logo"
      style={{ height: logo.boxHeight, left: logo.left, top: logo.top, width: logo.boxWidth }}
    >
      <div className="-rotate-90 flex-none">
        <div
          className="relative"
          data-name="logo"
          style={{ height: logo.height, width: logo.width }}
        >
          {logoSrc === '' ? null : (
            <img
              alt=""
              className="absolute inset-0 max-w-none object-cover pointer-events-none size-full"
              src={logoSrc}
            />
          )}
        </div>
      </div>
    </div>
  )
}

/**
 * The Gameplay screen.
 *
 * No props, per the renderer contract: which title and version are on screen, and
 * whether that game is actually running, are all store facts. The screen reads
 * them and draws; it owns no input handling, plays no sound and starts nothing.
 */
export function Gameplay() {
  const gameplay = useLauncher((state) => state.gameplay)
  const gameStatus = useLauncher((state) => state.gameStatus)
  const selectedTitleId = useLauncher((state) => state.titleId)
  const catalog = useLauncher((state) => state.catalog)

  const target = resolveTarget(catalog, gameplay, gameStatus, selectedTitleId)
  const layout = target === null ? null : GAMEPLAY_LAYOUTS[target.title.id]

  return (
    <div
      className="bg-[#0f0f0f] content-stretch flex gap-[10px] items-start relative size-full"
      data-figma-node="gameplay-screen"
      data-name={FRAME_NAME[target?.title.id ?? selectedTitleId]}
    >
      {/*
        `Body` (MainMenuRe1Gameplay.tsx:66-79). Its first child in the export is the
        flipped hard-light backdrop; it is omitted because App.tsx mounts the one
        `Backdrop` the stage has, already pinned with the -40.23px offset
        (BACKDROP.bottomOffset) this frame's copy carries — a second one would blend
        the photograph into itself.
      */}
      <div
        className="bg-[#010101] content-stretch flex flex-[1_0_0] h-full items-center justify-center min-h-px min-w-px relative"
        data-name="body"
      >
        {/* `game frame`: the positioning context every layer below is measured
            against — the lane hangs off its right edge, the card and the logo are
            placed from its centre. It is `flex-[1_0_0]` inside a centred body, so it
            is the whole 1920x1080 body. */}
        <div
          className="flex-[1_0_0] h-full min-h-px min-w-px relative"
          data-name="game frame"
        >
          {target === null || layout === null ? null : (
            <>
              <ArtLane layout={layout} version={target.version} />
              <GameplayCard top={layout.cardTop} version={target.version} />
              <RotatedLogo layout={layout} version={target.version} />
            </>
          )}
        </div>
      </div>

      {/*
        The helper bar. `HINTS_GAMEPLAY` is this screen's whole set — Esc Back
        (data/design.ts) — and it is the same bar the other screens mount, so the key
        cap artwork and its metrics cannot drift between screens.

        Placement follows the same two rules as the version screen's copy: the
        wrapper is the design's stated 68px box flush to the canvas bottom
        (`HELPER_BAR.height`, `CANVAS.height`), while `HelperBar` itself keeps the
        export's own `bottom-[-1px] left-0 w-[1920px]` and therefore lands
        1013..1081 — the exact band the export draws it in. It is `absolute` so it
        creates no flex item and no 10px gap in the root (`gap-[10px]`), which an
        in-flow bar would use to steal width from `Body`.
      */}
      <div
        className="absolute bottom-0 h-[68px] left-0 w-[1920px]"
        data-figma-node="helper-bar"
      >
        <HelperBar hints={HINTS_GAMEPLAY} />
      </div>
    </div>
  )
}

export default Gameplay
