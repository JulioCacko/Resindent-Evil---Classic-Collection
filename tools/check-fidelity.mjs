#!/usr/bin/env node
/**
 * check-fidelity.mjs — the mechanical half of the "1:1 with the Figma concept" claim.
 *
 * WHY THIS EXISTS
 * The live renderer is a transcription of the vendored Figma export in
 * `src/renderer/design-export/` (a byte-identical copy of
 * `.ref/designref/src/imports/*.tsx`, which stays the ground truth). A
 * transcription can be edited by accident: someone "tidies" `h-[580px]` into
 * `h-[36rem]`, rounds `tracking-[12.939px]` to `tracking-[13px]`, or re-derives a
 * measured value instead of copying it. TypeScript and the unit tests stay green
 * either way, because both spellings render. This script is the guard that
 * notices, so the design cannot drift after the rewrite without the build saying
 * so out loud.
 *
 * HOW IT CHECKS
 *  - `TRACKED` maps an export file to a live file and the class strings that live
 *    file must still carry. Class strings carry their measured values verbatim
 *    (`h-[580px]`, `rounded-[15.795px]`, `tracking-[12.939px]`) because Tailwind
 *    can only emit a candidate it can read as complete text — which is the same
 *    reason a component cannot interpolate those numbers from TypeScript.
 *  - `TRANSLATED` covers the design values that legitimately changed *spelling*
 *    on the way into the app: the export's `h-[70px]` logo box became
 *    `logoHeight: 70` in the catalog (the info panel sizes it from data, because
 *    a Tailwind class cannot be built from a variable), and Figma writes gradient
 *    offsets as fractions where CSS needs percentages. Both halves are checked, so
 *    a change on either side of the translation fails.
 *  - Every token is checked against its own export file first, so this map cannot
 *    drift away from the design: a token the export no longer writes is a bug in
 *    this file, reported as "map drift", not in a component.
 *  - The vendored copy is compared byte for byte with
 *    `.ref/designref/src/imports/<same name>` whenever that tree is present, so
 *    "the export moved under us" fails here instead of passing silently.
 *  - Comments are stripped from the live sources before any search. A design value
 *    that survives only in prose — a header comment quoting `h-[580px]` after the
 *    class itself was deleted — is drift, and this script has to see it as such.
 *  - A token that has left its mapped live file but is still somewhere else in the
 *    renderer is reported as a relocation. Moving markup between components is
 *    legitimate and must not fail the build; deleting the design value is what
 *    must. `--strict` turns relocations into failures, which is the right mode for
 *    CI once the component tree has settled.
 *
 * WHAT IT DOES NOT DO
 * It does not compare rendered pixels, it does not know whether a class is applied
 * to the right element, and it only covers the values expressed as classes or as
 * recorded constants. The rest of the claim is the Playwright geometry spec and
 * docs/DESIGN-FIDELITY.md, which is the human-auditable half of the same promise.
 *
 * EXIT CODES
 *   0  every tracked token is still present
 *   1  at least one token (or one vendored export file) is missing
 *
 * USAGE
 *   node tools/check-fidelity.mjs [--strict] [--quiet]
 *   pnpm check:fidelity
 */
import { existsSync } from 'node:fs'
import { readFile, readdir } from 'node:fs/promises'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

// ---------------------------------------------------------------------------
// layout
// ---------------------------------------------------------------------------

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * The authoritative design export, and where this check reads its tokens from.
 *
 * It is **not** part of the repository. The launch design was drawn in a separate design
 * tool, and the exported components are the author's own working material rather than part
 * of the product: shipping them made the repository carry a second copy of a design tool's
 * output, which is not something this project distributes. So the export lives beside the
 * working tree, gitignored, and this guard is a *development* check: it reads the export
 * when it is there and says so plainly when it is not.
 *
 * That ordering matters. The `.ref` copy is the ground truth, so it is preferred; the
 * previously vendored copy under `src/renderer/design-export/` is still accepted for a
 * working tree that has one, which is what makes the removal a no-op for anyone who
 * already had it checked out.
 */
const REF_EXPORT_DIR = join(repoRoot, '.ref', 'designref', 'src', 'imports')
const LEGACY_VENDORED_DIR = join(repoRoot, 'src', 'renderer', 'design-export')
const EXPORT_DIR = existsSync(REF_EXPORT_DIR) ? REF_EXPORT_DIR : LEGACY_VENDORED_DIR

/**
 * Whether the design export is available at all.
 *
 * Every token below is *read* from it, so without it there is nothing to check against:
 * the guard reports that plainly and exits successfully rather than failing a build for
 * the absence of a file the repository deliberately does not contain.
 */
const EXPORT_AVAILABLE = existsSync(EXPORT_DIR)

/** Where a token is looked for: the renderer, plus the shared catalog it draws from. */
const LIVE_SCAN_ROOTS = [join(repoRoot, 'src', 'renderer', 'src'), join(repoRoot, 'src', 'shared')]

/** Extensions that can carry a class string or a measured value. */
const SCANNED_EXTENSIONS = ['.ts', '.tsx', '.css', '.html']

/**
 * Every live file the map below addresses, named once so a rename is a one-line
 * change here instead of a search-and-replace across the token lists. Paths are
 * repository-relative and POSIX-separated, which is also how they are reported.
 */
const LIVE = {
  menu: 'src/renderer/src/screens/MainMenu.tsx',
  versionSelect: 'src/renderer/src/screens/VersionSelect.tsx',
  gameplay: 'src/renderer/src/screens/Gameplay.tsx',
  stage: 'src/renderer/src/stage/Stage.tsx',
  backdrop: 'src/renderer/src/components/Backdrop.tsx',
  logoBlock: 'src/renderer/src/components/LogoBlock.tsx',
  gameCard: 'src/renderer/src/components/GameCard.tsx',
  helperBar: 'src/renderer/src/components/HelperBar.tsx',
  versionRow: 'src/renderer/src/components/VersionRow.tsx',
  infoPanel: 'src/renderer/src/components/InfoPanel.tsx',
  design: 'src/renderer/src/data/design.ts',
  catalog: 'src/shared/catalog.ts'
}

// ---------------------------------------------------------------------------
// the map
// ---------------------------------------------------------------------------

/**
 * Export file -> live file -> the class strings that must still be there.
 *
 * Each token is a literal substring, exactly as the export writes it, so it is
 * checked with a plain `includes`. A token fails in exactly two situations, and
 * both are real drift: the design value was rounded, re-derived or deleted, or the
 * export it came from changed shape.
 */
const TRACKED = [
  // -------------------------------------------------------------------------
  // Main Menu — .ref/designref/src/imports/MainMenu.tsx
  // -------------------------------------------------------------------------
  {
    export: 'MainMenu.tsx',
    live: LIVE.menu,
    tokens: [
      // The 1920x1080 body and the centred column: 56/32/72 padding, a 32px
      // stack, the 616px row band with its 48px gap, and the 18px copyright.
      'h-[1080px]',
      'w-[1920px]',
      'gap-[32px]',
      'gap-[48px]',
      'h-[616px]',
      'pb-[72px]',
      'pt-[56px]',
      'px-[32px]',
      'text-[18px]',
      'text-[#999]'
    ]
  },
  {
    export: 'MainMenu.tsx',
    live: LIVE.stage,
    tokens: [
      // Stage is a composition rather than a transcription (it scales the fixed
      // canvas to fit), but the author space it renders *is* the export's frame.
      'h-[1080px]',
      'w-[1920px]'
    ]
  },
  {
    export: 'MainMenu.tsx',
    live: LIVE.backdrop,
    tokens: [
      // The backdrop layer: 1920x1539.34, flipped, blended hard-light. The
      // opacity itself is a prop, checked through TRANSLATED below.
      'h-[1539.34px]',
      'w-[1920px]',
      'mix-blend-hard-light',
      '-scale-y-100',
      'object-cover'
    ]
  },
  {
    export: 'MainMenu.tsx',
    live: LIVE.logoBlock,
    tokens: [
      // The 625.021x250 lockup and the wordmark's own geometry.
      'h-[250px]',
      'w-[625.021px]',
      'inset-[5.52%_0_33.15%_0.05%]',
      'inset-[0_0_-5.22%_0]',
      // The badge's box: its inset in the lockup, its radius and its two-offset
      // drop shadow. Its face and lettering come from the concept's own texture
      // (assets/textures/main-logo.png, cropped by pnpm assets:sync) rather than
      // from live text, so the export's badge *type* tokens - py-[7.776px],
      // text-[43.13px], tracking-[12.939px], its text-shadow, the #7f828a fill,
      // the overlay gradient and bg-clip-text - are deliberately no longer in this
      // file. What replaced them is the art, and the four tokens below are what
      // pin it: the design's badge inset, the key it resolves through, and the
      // cover behaviour that fits it to the box. The box itself is measured by
      // tests/e2e/geometry.spec.ts, which checks the badge against the percentages
      // in this same inset. See docs/DESIGN-FIDELITY.md 7.2.
      'inset-[73.96%_7.57%_0_7.52%]',
      'rounded-[4.786px]',
      'shadow-[0px_1.944px_0px_0px_#434343,0px_3.888px_0px_0px_rgba(0,0,0,0.4)]',
      // The wordmark SVG: its viewBox, its two shadow offsets and the colour
      // matrix that turns 0.519445 into #848484.
      '624.714',
      '161.327',
      '8.00915',
      '3.43249',
      '0.519445',
      '312.357',
      '153.318',
      '#FE0000'
    ],
    // What stands in for the badge's type tokens, which the export writes but this
    // component no longer does - see the comment above and docs/DESIGN-FIDELITY.md
    // 7.2. `data-figma-node="logo-badge"` is the hook tests/e2e/geometry.spec.ts
    // measures the badge box through.
    liveTokens: ['BADGE_ART.key', 'data-figma-node="logo-badge"', 'object-cover']
  },
  {
    export: 'MainMenu.tsx',
    live: LIVE.gameCard,
    tokens: [
      // One 380x580 cover, its 8/8.5px radii, the selection glow, and RE3's own
      // 15.795px corner radius on the artwork.
      'h-[580px]',
      'w-[380px]',
      'rounded-[8px]',
      'rounded-[8.5px]',
      'rounded-[15.795px]',
      'rounded-[inherit]',
      'shadow-[inset_0px_0px_36px_0px_rgba(255,255,255,0.25)]',
      'shadow-[inset_0px_4px_36px_0px_rgba(255,255,255,0)]',
      'inset-[-0.5px]',
      'border-[#4d4d4d]',
      'opacity-60',
      'mix-blend-exclusion',
      'bg-[#0f0f0f]',
      '-translate-y-1/2',
      'top-1/2',
      'object-cover',
      'max-w-none',
      'size-full'
    ]
  },
  {
    export: 'MainMenu.tsx',
    live: LIVE.helperBar,
    tokens: [
      // Key caps: 32px box, 24px plate inset 4px, radius 6, 0.5px hairline.
      'size-[32px]',
      'size-[24px]',
      'left-[4px]',
      'top-[4px]',
      'rounded-[6px]',
      'border-[0.5px]',
      'bg-[#2a2a2a]',
      'border-[#232323]',
      'shadow-[1px_1px_1px_0px_rgba(0,0,0,0.1)]',
      // The Enter artwork is 25x25 and mirrored; the arrows are 12x12 at 31.25%.
      'size-[25px]',
      'size-[12px]',
      'inset-[31.25%]',
      'inset-[0_-8%_-8%_0]',
      '-rotate-90',
      'rotate-180',
      '-scale-y-100',
      // Cap glyphs and the 24px Actor labels.
      'text-[10px]',
      'text-[#fffffe]',
      'w-[18px]',
      'h-[12px]',
      'left-[16px]',
      'top-[16px]',
      'tracking-[-0.9px]',
      'text-[24px]',
      'gap-[24px]',
      'gap-[8px]',
      'px-[32px]',
      'py-[18px]',
      'leading-[0]',
      'leading-[normal]',
      'w-[1920px]',
      'overflow-clip'
    ]
  },

  // -------------------------------------------------------------------------
  // Game Version — MainMenuRe1.tsx (RE1)
  // -------------------------------------------------------------------------
  {
    export: 'MainMenuRe1.tsx',
    live: LIVE.versionSelect,
    tokens: [
      // The 1060px version column, the 860px info column, and the panel's own
      // 56/32/72 padding and 32px stack with its 18px row gap.
      'w-[1060px]',
      'w-[860px]',
      'h-[1080px]',
      'gap-[32px]',
      'gap-[18px]',
      'pb-[72px]',
      'pt-[56px]',
      'px-[32px]',
      'text-[32px]',
      'text-[#ccc]',
      // The 68px helper bar band the export states only on this screen.
      'h-[68px]',
      'w-[1920px]'
    ]
  },
  {
    export: 'MainMenuRe1.tsx',
    live: LIVE.versionRow,
    tokens: [
      // One hero row: full width, framed at 1600/740, cropped by the clip layer.
      'aspect-[1600/740]',
      'rounded-[8px]',
      'rounded-[8.5px]',
      'rounded-[inherit]',
      'flex-[1_0_0]',
      'min-h-px',
      'min-w-px',
      'size-full',
      '-translate-y-1/2',
      'overflow-clip',
      'mix-blend-exclusion',
      'shadow-[inset_0px_0px_36px_0px_rgba(255,255,255,0.25)]',
      'border-[#4d4d4d]',
      'inset-[-0.5px]',
      'opacity-60',
      'bg-[#0f0f0f]'
    ]
  },
  {
    export: 'MainMenuRe1.tsx',
    live: LIVE.infoPanel,
    tokens: [
      // The 860px column with its 647px region-art lane at y=433.
      'h-[1080px]',
      'w-[860px]',
      'h-[647px]',
      'top-[433px]',
      'h-[444px]',
      'w-full',
      'rounded-[2px]',
      // The blurred ellipse: 1028.197x925.377, scaled out by 98.66%/88.8%.
      'h-[925.377px]',
      'w-[1028.197px]',
      'top-[calc(50%+0.31px)]',
      'inset-[-98.66%_-88.8%]',
      '2854.2',
      '2751.38',
      '613',
      // The 482px info block: 16/32/73/32 padding, a 16px stack, the 18px
      // description stack, its 160px height, the 16px meta box.
      'h-[482px]',
      'gap-[16px]',
      'pb-[73px]',
      'pt-[16px]',
      'px-[32px]',
      'gap-[18px]',
      'h-[247px]',
      'h-[160px]',
      'text-[20px]',
      'leading-none',
      'text-justify',
      'whitespace-pre-wrap',
      'w-[min-content]',
      'min-w-full',
      'p-[16px]',
      'gap-[8px]',
      'text-[16px]',
      'gap-[10px]',
      'uppercase',
      'whitespace-pre',
      'shadow-[inset_0px_0px_8px_0px_rgba(255,255,255,0.15)]',
      'text-[32px]',
      'leading-[0.99]',
      'text-shadow-[0px_0px_2px_rgba(0,0,0,0.12),0px_4px_8px_rgba(0,0,0,0.14)]',
      'text-white'
    ]
  },
  {
    // RE1 US is the one lane whose art is an oversized crop rather than a fill.
    export: 'MainMenuRe1.tsx',
    live: LIVE.infoPanel,
    tokens: [
      'aspect-[1218.7529296875/1445.560546875]',
      'top-[-109.94px]',
      'h-[163.67%]',
      'left-[-20.62%]',
      'top-[-27.26%]',
      'w-[120.62%]'
    ]
  },
  {
    // RE1 JP's lane. DIRECTOR'S CUT is no longer mapped onto it: the export's
    // consolidated reference sheet carries that row's own lane, checked below.
    export: 'MainMenuRe4.tsx',
    live: LIVE.infoPanel,
    tokens: ['h-[940.5px]', 'w-[1254px]']
  },
  {
    // The two rows with no screen of their own, plus RE3 JP, whose screen
    // (`MainMenuRe6`) draws the RE3 US lane instead of the row's own. All three
    // real lanes live in the export's reference sheet of eight info panels.
    export: 'Frame219.tsx',
    live: LIVE.infoPanel,
    tokens: [
      'aspect-[4096/2340]',
      'left-[calc(50%-87.87px)]',
      'aspect-[3537/2662]',
      'bottom-[-3%]',
      'aspect-[3840/2160]',
      'left-[-79.78%]'
    ]
  },

  // -------------------------------------------------------------------------
  // Game Version — MainMenuRe2.tsx (RE2)
  // -------------------------------------------------------------------------
  {
    export: 'MainMenuRe2.tsx',
    live: LIVE.versionSelect,
    tokens: ['w-[1060px]', 'h-[1080px]', 'gap-[32px]', 'gap-[18px]']
  },
  {
    export: 'MainMenuRe2.tsx',
    live: LIVE.infoPanel,
    tokens: [
      // RE2 US: the lane is framed at 1016/1132 and hung off -0.05%.
      'aspect-[1016/1132]',
      'left-[-0.05%]',
      'h-[647px]',
      'h-[482px]',
      'h-[444px]'
    ]
  },
  {
    export: 'MainMenuRe5.tsx',
    live: LIVE.infoPanel,
    tokens: [
      // RE2 JP: 1664/2046 hung off the lane's bottom edge.
      'aspect-[1664/2046]',
      'bottom-[-116.59px]'
    ]
  },

  // -------------------------------------------------------------------------
  // Game Version — MainMenuRe3.tsx (RE3)
  // -------------------------------------------------------------------------
  {
    export: 'MainMenuRe3.tsx',
    live: LIVE.versionSelect,
    tokens: ['w-[1060px]', 'h-[1080px]', 'gap-[32px]', 'gap-[18px]']
  },
  {
    export: 'MainMenuRe3.tsx',
    live: LIVE.infoPanel,
    tokens: [
      // RE3: 1920/1441 hung off the lane's top by -22.19%.
      'aspect-[1920/1441]',
      'top-[-22.19%]',
      'h-[647px]',
      'h-[482px]'
    ]
  },
  {
    // Frame219 is the aggregate frame: it draws all eight rows' info panels, so
    // the recipe every row shares is asserted once against it.
    export: 'Frame219.tsx',
    live: LIVE.infoPanel,
    tokens: [
      'h-[482px]',
      'gap-[16px]',
      'pb-[73px]',
      'pt-[16px]',
      'px-[32px]',
      'h-[647px]',
      'w-[860px]',
      'text-[32px]',
      'text-[20px]',
      'p-[16px]',
      'shadow-[inset_0px_0px_8px_0px_rgba(255,255,255,0.15)]'
    ]
  },
  {
    export: 'Frame219.tsx',
    live: LIVE.catalog,
    tokens: [
      // The eight measured logo boxes and the concept row's note, which the
      // catalog carries as data. Order matches the export's frames:
      // RE1 US/JP/DC, RE2 US/1.5/JP, RE3 US/JP.
      '262.686',
      '253.043',
      '296.819',
      '292.817',
      '415.598',
      '301.739',
      '339.477',
      '309.668',
      'Planned Release IN March 1997 (Scrapped and',
      'originally released in 11 November 1999'
    ]
  },

  // -------------------------------------------------------------------------
  // Gameplay — MainMenuRe{1,2,3}Gameplay.tsx
  //
  // The three frames share one component, and the values that differ per title
  // (lane width/offset, art insets, card top, logo box) are `GAMEPLAY_LAYOUTS` in
  // data/design.ts — a class cannot be interpolated from them, so they are checked
  // there through TRANSLATED rather than demanded as classes here.
  // -------------------------------------------------------------------------
  {
    export: 'MainMenuRe1Gameplay.tsx',
    live: LIVE.gameplay,
    tokens: [
      // The 1300x975 white card on the #010101 screen, 4px radius, clipped.
      'w-[1300px]',
      'h-[975px]',
      'rounded-[4px]',
      'bg-white',
      'bg-[#010101]',
      'overflow-clip',
      'inset-[-0.1%_0_0_0]',
      'rounded-[2px]',
      // The 1080px lane and the blurred ellipse every gameplay frame repeats.
      'h-[1080px]',
      'h-[925.377px]',
      'w-[1028.197px]',
      'top-[calc(50%+0.31px)]',
      'inset-[-98.66%_-88.8%]',
      '2854.2',
      '2751.38',
      '613',
      // The rotated logo lockup.
      '-rotate-90',
      'flex-none',
      'object-cover',
      'size-full'
    ]
  },
  {
    export: 'MainMenuRe2Gameplay.tsx',
    live: LIVE.gameplay,
    tokens: ['w-[1300px]', 'h-[975px]', 'rounded-[4px]', 'bg-white', 'overflow-clip', '-rotate-90']
  },
  {
    export: 'MainMenuRe3Gameplay.tsx',
    live: LIVE.gameplay,
    tokens: ['w-[1300px]', 'h-[975px]', 'rounded-[4px]', 'bg-white', 'overflow-clip', '-rotate-90']
  },
  {
    export: 'MainMenuRe3Gameplay.tsx',
    live: LIVE.design,
    tokens: [
      // RE3's own card top, lane box and region-art lane, all recorded as data.
      '52.28',
      '1285',
      '1920/1441'
    ]
  }
]

/**
 * Export file -> live file -> a design value whose *spelling* changed on the way
 * in.
 *
 * Two kinds of translation live here, and both are deliberate:
 *
 *  - Figma writes a mask gradient's offsets as fractions of its own gradient axis
 *    (`0.00529034`) while CSS needs a percentage of the box (`0.529034%`), so the
 *    two strings can never be equal.
 *  - A measured value that the app reads from data cannot be a class at all —
 *    the info panel sizes each row's logo from `GameVersion.logoWidth`, and the
 *    gameplay screen positions its lane from `GAMEPLAY_LAYOUTS` — so the design
 *    number is checked where it actually has to survive.
 *
 * Both halves are checked in both directions: `from` must still be in the export
 * and `to` must still be in the live file, so a change on either side fails.
 */
const TRANSLATED = [
  // --- the four mask gradients, all in .ref/designref/src/imports/svg-xcltc.tsx ---
  // infoPanel (860x1080): the left-edge fade of the info column.
  { export: 'svg-xcltc.tsx', from: '0.00529034', live: LIVE.design, to: '0.529034%' },
  { export: 'svg-xcltc.tsx', from: '0.21', live: LIVE.design, to: '21%' },
  // regionArt (860x647): the top-to-bottom fade of the region-art lane.
  { export: 'svg-xcltc.tsx', from: '0.0366663', live: LIVE.design, to: '3.66663%' },
  { export: 'svg-xcltc.tsx', from: '0.581666', live: LIVE.design, to: '58.1666%' },
  // videoLane (860.102x602.547): the fade that brings the video window in.
  { export: 'svg-xcltc.tsx', from: '0.109104', live: LIVE.design, to: '10.9104%' },
  { export: 'svg-xcltc.tsx', from: '0.238689', live: LIVE.design, to: '23.8689%' },
  { export: 'svg-xcltc.tsx', from: '0.322379', live: LIVE.design, to: '32.2379%' },
  // videoFrame (859.898x418.749): the bottom-edge fade of the video itself.
  { export: 'svg-xcltc.tsx', from: '0.206666', live: LIVE.design, to: '20.6666%' },
  { export: 'svg-xcltc.tsx', from: '0.996666', live: LIVE.design, to: '99.6666%' },

  // --- the backdrop, which App.tsx composes through props ---
  { export: 'MainMenu.tsx', from: 'opacity-20', live: LIVE.design, to: 'opacityMenu: 0.2' },
  { export: 'MainMenuRe1.tsx', from: 'opacity-10', live: LIVE.design, to: 'opacityScreen: 0.1' },
  { export: 'MainMenuRe1.tsx', from: 'bottom-[-40.23px]', live: LIVE.design, to: 'bottomOffset: -40.23' },
  { export: 'MainMenu.tsx', from: 'h-[1539.34px]', live: LIVE.design, to: 'boxHeight: 1539.34' },

  // --- the info panel's per-row logo box, which is catalog data ---
  { export: 'Frame219.tsx', from: 'h-[70px]', live: LIVE.catalog, to: 'logoHeight: 70' },
  { export: 'Frame219.tsx', from: 'h-[120px]', live: LIVE.catalog, to: 'logoHeight: 120' },
  // The one lane class the panel writes in a different but equal spelling.
  { export: 'MainMenuRe1.tsx', from: 'opacity-98', live: LIVE.infoPanel, to: 'opacity-[0.98]' },

  // --- the gameplay geometry, which the screen reads from data/design.ts ---
  { export: 'MainMenuRe1Gameplay.tsx', from: 'top-[45px]', live: LIVE.design, to: 'cardTop: 45' },
  { export: 'MainMenuRe1Gameplay.tsx', from: 'w-[999px]', live: LIVE.design, to: 'width: 999,' },
  { export: 'MainMenuRe1Gameplay.tsx', from: 'right-[-293px]', live: LIVE.design, to: 'right: -293,' },
  { export: 'MainMenuRe1Gameplay.tsx', from: 'aspect-[1218.7529296875/1445.560546875]', live: LIVE.design, to: "aspect: '1218.7529296875/1445.560546875'" },
  { export: 'MainMenuRe1Gameplay.tsx', from: 'top-[-109.94px]', live: LIVE.design, to: '-109.94px' },
  { export: 'MainMenuRe1Gameplay.tsx', from: 'left-[73.11px]', live: LIVE.design, to: 'left: 73.11' },
  { export: 'MainMenuRe1Gameplay.tsx', from: 'w-[137.574px]', live: LIVE.design, to: 'boxWidth: 137.574' },
  { export: 'MainMenuRe1Gameplay.tsx', from: 'h-[516.266px]', live: LIVE.design, to: 'boxHeight: 516.266' },
  { export: 'MainMenuRe1Gameplay.tsx', from: 'top-[calc(50%-1.13px)]', live: LIVE.design, to: 'calc(50% - 1.13px)' },
  // The crop the still inside the card uses, shared by all three frames but
  // written down once in GAMEPLAY_COMMON.
  { export: 'MainMenuRe1Gameplay.tsx', from: 'h-[107.28%]', live: LIVE.design, to: "height: '107.28%'" },
  { export: 'MainMenuRe1Gameplay.tsx', from: 'left-[-0.05%]', live: LIVE.design, to: "left: '-0.05%'" },
  { export: 'MainMenuRe1Gameplay.tsx', from: 'top-[-3.78%]', live: LIVE.design, to: "top: '-3.78%'" },
  { export: 'MainMenuRe1Gameplay.tsx', from: 'w-[100.1%]', live: LIVE.design, to: "width: '100.1%'" },

  { export: 'MainMenuRe2Gameplay.tsx', from: 'right-[-418px]', live: LIVE.design, to: 'right: -418,' },
  { export: 'MainMenuRe2Gameplay.tsx', from: 'aspect-[1016/1132]', live: LIVE.design, to: "aspect: '1016/1132'" },
  { export: 'MainMenuRe2Gameplay.tsx', from: 'left-[73px]', live: LIVE.design, to: 'left: 73,' },
  { export: 'MainMenuRe2Gameplay.tsx', from: 'w-[130px]', live: LIVE.design, to: 'boxWidth: 130,' },
  { export: 'MainMenuRe2Gameplay.tsx', from: 'h-[543.803px]', live: LIVE.design, to: 'boxHeight: 543.803' },

  { export: 'MainMenuRe3Gameplay.tsx', from: 'top-[52.28px]', live: LIVE.design, to: 'cardTop: 52.28' },
  { export: 'MainMenuRe3Gameplay.tsx', from: 'w-[1285px]', live: LIVE.design, to: 'width: 1285,' },
  { export: 'MainMenuRe3Gameplay.tsx', from: 'right-[-74px]', live: LIVE.design, to: 'right: -74,' },
  { export: 'MainMenuRe3Gameplay.tsx', from: 'top-[calc(50%-0.22px)]', live: LIVE.design, to: 'calc(50% - 0.22px)' },
  { export: 'MainMenuRe3Gameplay.tsx', from: 'top-[-22.19%]', live: LIVE.design, to: '-22.19%' },
  { export: 'MainMenuRe3Gameplay.tsx', from: 'left-[96px]', live: LIVE.design, to: 'left: 96,' },
  { export: 'MainMenuRe3Gameplay.tsx', from: 'w-[130.318px]', live: LIVE.design, to: 'boxWidth: 130.318' },
  { export: 'MainMenuRe3Gameplay.tsx', from: 'h-[632px]', live: LIVE.design, to: 'boxHeight: 632,' }
]

// ---------------------------------------------------------------------------
// arguments
// ---------------------------------------------------------------------------

const argv = process.argv.slice(2)
const strict = argv.includes('--strict')
const quiet = argv.includes('--quiet')

if (argv.includes('--help') || argv.includes('-h')) {
  process.stdout.write(
    [
      'check-fidelity — verify that the live renderer still carries the design values of the Figma export.',
      '',
      'usage: node tools/check-fidelity.mjs [--strict] [--quiet]',
      '',
      '  --strict  treat a token that moved to another live file as a failure',
      '  --quiet   print only the summary line',
      ''
    ].join('\n')
  )
  process.exit(0)
}

// ---------------------------------------------------------------------------
// small helpers
// ---------------------------------------------------------------------------

/** Repository-relative, POSIX-separated path, for output that is copy-pasteable. */
function displayPath(absolutePath) {
  return relative(repoRoot, absolutePath).split(sep).join('/')
}

/** File contents, or null when the file is absent/unreadable (a finding, not a crash). */
async function readIfPresent(absolutePath) {
  try {
    return await readFile(absolutePath, 'utf8')
  } catch {
    return null
  }
}

/**
 * Blanks out comments in a live source.
 *
 * A design value that survives only in a comment is drift, and the whole point of
 * this script is to see drift: several components quote the export's class strings
 * in their header comment, so searching the raw text would let a token pass after
 * the class itself was deleted.
 *
 * The `[^:]` guard keeps `https://` intact; a `//` inside a string literal that is
 * not part of a URL is the one case this mis-reads, and it can only shorten a line
 * that also holds a tracked token.
 */
function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
}

/** Every scanned-extension file under `root`, depth-first, sorted for stable output. */
async function collectFiles(root, collected) {
  let entries
  try {
    entries = await readdir(root, { withFileTypes: true })
  } catch {
    return collected
  }

  entries.sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0))

  for (const entry of entries) {
    const absolutePath = join(root, entry.name)
    if (entry.isDirectory()) {
      // Build output and dependency trees are never part of the renderer.
      if (entry.name === 'node_modules' || entry.name === 'out' || entry.name === 'release') continue
      await collectFiles(absolutePath, collected)
      continue
    }
    if (!entry.isFile()) continue
    if (!SCANNED_EXTENSIONS.some((extension) => entry.name.endsWith(extension))) continue
    collected.push(absolutePath)
  }

  return collected
}

// ---------------------------------------------------------------------------
// checks
// ---------------------------------------------------------------------------

/** Findings in the order they are printed; each is either 'error' or 'warn'. */
const findings = []

function report(severity, message) {
  findings.push({ severity, message })
}

/**
 * Guards the exported components against the tree they were taken from.
 *
 * Only meaningful when both copies exist: with the vendored copy gone from the repository
 * (see `EXPORT_DIR`), there is nothing to compare, and the check says so and moves on.
 * The guard is kept because a working tree that still has the older vendored copy should
 * still be told if it has drifted from the export.
 */
async function checkVendoredCopyIsFaithful(exportNames) {
  if (!existsSync(REF_EXPORT_DIR)) {
    process.stderr.write(
      'check-fidelity: note — the design export is absent (.ref/designref/src/imports), so tokens could not be read and nothing was verified\n'
    )
    return
  }
  if (EXPORT_DIR === REF_EXPORT_DIR) {
    // Reading the export directly: it *is* the ground truth, so there is no second copy to
    // compare it against.
    return
  }

  for (const name of exportNames) {
    const vendored = await readIfPresent(join(EXPORT_DIR, name))
    if (vendored === null) {
      report('error', `vendored export file is missing: src/renderer/design-export/${name}`)
      continue
    }
    const original = await readIfPresent(join(REF_EXPORT_DIR, name))
    // Not every vendored file has an export twin (the reference pages do not), so
    // an absent original is not a failure.
    if (original === null) continue
    if (vendored !== original) {
      report(
        'error',
        `src/renderer/design-export/${name} is no longer byte-identical to .ref/designref/src/imports/${name}`
      )
    }
  }
}

async function main() {
  /**
   * No export, nothing to check.
   *
   * The repository does not ship the design export (see `EXPORT_DIR`), so in a clone this
   * guard has no reference to compare the UI against. Saying so and exiting successfully is
   * the honest outcome: a build must not fail because a file the project deliberately does
   * not contain is missing, and silence would be worse - it would read as "verified".
   */
  if (!EXPORT_AVAILABLE) {
    process.stderr.write(
      'check-fidelity: not verified — the design export is not present.\n' +
        `  looked in: ${EXPORT_DIR}\n` +
        '  every token this guard checks is read from it, so with it absent there is nothing\n' +
        '  to verify. Put the export back at one of those paths to run the full check.\n'
    )
    return
  }

  const exportNames = [
    ...new Set([...TRACKED.map((entry) => entry.export), ...TRANSLATED.map((entry) => entry.export)])
  ].sort()

  const exports = new Map()
  for (const name of exportNames) {
    exports.set(name, await readIfPresent(join(EXPORT_DIR, name)))
  }

  await checkVendoredCopyIsFaithful(exportNames)

  // The live corpus: every renderer and shared source file, comment-stripped and
  // read once. It answers both "is the token in the file the map names" and "did
  // the token merely move".
  const liveFiles = []
  for (const root of LIVE_SCAN_ROOTS) {
    await collectFiles(root, liveFiles)
  }
  const corpus = new Map()
  for (const absolutePath of liveFiles) {
    const text = await readIfPresent(absolutePath)
    if (text !== null) corpus.set(displayPath(absolutePath), stripComments(text))
  }

  /** Live files the map addresses, so an absent one can be reported once. */
  const addressedLiveFiles = new Set(TRACKED.map((entry) => entry.live))
  for (const liveFile of addressedLiveFiles) {
    if (!corpus.has(liveFile)) {
      report('warn', `live file named by the map does not exist (yet): ${liveFile}`)
    }
  }

  let tokensChecked = 0

  for (const entry of TRACKED) {
    const exportText = exports.get(entry.export)

    if (exportText === null || exportText === undefined) {
      // Already reported by the faithfulness check; there is nothing to compare.
      continue
    }

    const liveText = corpus.get(entry.live)

    for (const token of entry.tokens) {
      tokensChecked += 1

      // 1. The map must still describe the export: a token the design no longer
      //    writes means this file is out of date, not the component.
      if (!exportText.includes(token)) {
        report('error', `map drift: "${token}" is no longer in ${entry.export} (mapped to ${entry.live})`)
        continue
      }

      // 2. The live file the map names has to still carry it.
      if (liveText !== undefined && liveText.includes(token)) {
        continue
      }

      // 3. Or it must still exist somewhere in the app, which is a move rather
      //    than a loss.
      const owners = []
      for (const [livePath, text] of corpus) {
        if (text.includes(token)) owners.push(livePath)
      }

      if (owners.length === 0) {
        report('error', `missing: "${token}" (from ${entry.export}, expected in ${entry.live})`)
        continue
      }

      report(
        strict ? 'error' : 'warn',
        `relocated: "${token}" (from ${entry.export}) is in ${owners.join(', ')}, not in ${entry.live}`
      )
    }

    // `liveTokens` are the other direction: facts the live file must carry that the
    // export has no equivalent for. They exist because a component can legitimately
    // replace a transcribed design detail with something better - the badge draws
    // the concept's own texture instead of re-typesetting its lettering in a font
    // this repository does not have - and a guard that could only check
    // transcriptions would have to stop checking that component at all. Each one
    // still has to be present, so the replacement cannot silently disappear either.
    for (const token of entry.liveTokens ?? []) {
      tokensChecked += 1
      if (liveText === undefined) {
        report('error', `live token "${token}" cannot be checked: ${entry.live} is not readable`)
        continue
      }
      if (!liveText.includes(token)) {
        report('error', `missing: "${token}" (expected in ${entry.live})`)
      }
    }
  }

  for (const entry of TRANSLATED) {
    tokensChecked += 1

    const exportText = exports.get(entry.export)
    if (exportText === null || exportText === undefined) {
      report('error', `vendored export file is missing: src/renderer/design-export/${entry.export}`)
      continue
    }
    if (!exportText.includes(entry.from)) {
      report(
        'error',
        `map drift: "${entry.from}" is no longer in ${entry.export} (translated to "${entry.to}")`
      )
      continue
    }

    const liveText = corpus.get(entry.live)
    if (liveText !== undefined && liveText.includes(entry.to)) {
      continue
    }

    const owners = []
    for (const [livePath, text] of corpus) {
      if (text.includes(entry.to)) owners.push(livePath)
    }
    if (owners.length > 0) {
      report(
        strict ? 'error' : 'warn',
        `relocated: "${entry.to}" (from ${entry.export} "${entry.from}") is in ${owners.join(', ')}, not in ${entry.live}`
      )
      continue
    }

    report('error', `missing: "${entry.to}" (from ${entry.export} "${entry.from}", expected in ${entry.live})`)
  }

  const errors = findings.filter((finding) => finding.severity === 'error')
  const warnings = findings.filter((finding) => finding.severity === 'warn')

  if (!quiet) {
    for (const finding of findings) {
      process.stdout.write(`  ${finding.severity === 'error' ? 'x' : '!'} ${finding.message}\n`)
    }
    if (findings.length > 0) process.stdout.write('\n')
  }

  const componentMappings = TRACKED.length
  const translatedValues = TRANSLATED.length
  const suffix = strict ? ' [--strict]' : ''

  if (errors.length === 0) {
    process.stdout.write(
      `check-fidelity: ok — ${tokensChecked} design tokens from ${exportNames.length} export file(s) across ` +
        `${componentMappings} component mappings and ${translatedValues} translated values are still present` +
        `${suffix}${warnings.length === 0 ? '' : ` (${warnings.length} relocated)`}\n`
    )
    return
  }

  process.stdout.write(
    `check-fidelity: FAILED — ${errors.length} missing or diverged token(s), ${warnings.length} warning(s), ` +
      `${tokensChecked} tokens checked from ${exportNames.length} export file(s) across ` +
      `${componentMappings} component mappings and ${translatedValues} translated values${suffix}\n`
  )
  process.exitCode = 1
}

await main()
