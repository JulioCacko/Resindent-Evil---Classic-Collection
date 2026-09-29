# Design fidelity — the auditable record

The requirement this project was built against is *1:1 with the Figma concept*.
That is a claim, and a claim needs evidence. This document is the evidence: every
significant measured value, where it came from, where it lives now, and every
place where the shipped app deliberately does not match the concept.

Sources, in order of authority:

1. `.ref/designref/` — the authoritative design export (read-only, **not in this
   repository**: it is the author's own working material from the design tool, kept
   beside the working tree and gitignored). `.ref/designref/src/imports/*.tsx` is
   verbatim export output and is the ground truth for geometry.
2. `.ref/designref/src/app/components/*.tsx` — the interaction reference
   (`MainMenuPage`, `VersionSelectPage`, `GameplayPage`): selection behaviour,
   keyboard bindings, the 1.02 card scale, the row clamp. These are not a
   geometry source.
3. The removed C++ launcher, for the surfaces the design has no frame for
   (`git show HEAD:src/...`).

**The export used to be vendored into the repository** at
`src/renderer/design-export/*.tsx` — a byte-identical copy, so the guard had a stable
input that did not depend on `.ref/` being present. It is gone: publishing a second copy
of a design tool's output was not something this project needed to distribute, and the
copy was imported by nothing. `tools/check-fidelity.mjs` now reads the export directly
when it is there, accepts the old vendored path if a working tree still has one, and
otherwise reports that it verified **nothing** rather than passing quietly.

Nothing below is measured by eye: every number is either a class string in the
export or a constant recorded in `src/renderer/src/data/design.ts`, which is the
single place the components and the tests both read from.

---

## 1. The stage, and the scale-to-fit rule

The Figma frame is a fixed **1920x1080** canvas on `#0F0F0F`, and every screen in
the export is laid out absolutely inside it. Nothing about the design is
responsive, so nothing in the app reflows either.

`src/renderer/src/stage/Stage.tsx`:

- renders its children once at **1920x1080 author-space pixels**, then
- scales the whole layer by `min(viewportWidth / 1920, viewportHeight / 1080)`,
  with `transform-origin: center center`, so the entire canvas is always visible
  and the leftover axis becomes a letterbox in the canvas colour;
- positions the layer with `-ml-[960px] -mt-[540px] left-1/2 top-1/2` rather than
  with a translate utility, because the scale is an inline `transform` and
  Tailwind v4 composes `translate`/`scale`/`transform` as separate properties —
  mixing them would make the final position depend on composition order;
- is `isolate`, which bounds the `mix-blend-hard-light` backdrop to the frame
  instead of letting it blend against whatever stacking context is above the
  stage;
- is `overflow-clip`, which is the export's own clip: several layers are drawn
  deliberately larger than the canvas (the 1539.34px backdrop, the gameplay art
  lanes with negative offsets) and must be cropped at the frame edge. `clip`
  rather than `hidden` because `overflow: hidden` still makes the box a *scroll
  container*: the version and gameplay backdrops hang 40.23px below the canvas, so
  focusing anything scrolled the hidden container by exactly that overhang and
  silently shifted every measured layer. `overflow: clip` crops identically and
  can never scroll.

Consequences worth stating explicitly:

- **1 design pixel is always 1 author-space pixel.** A 32px key cap, an 860px
  info column and 12.939px of badge tracking are true at every window size, which
  is what makes the numbers in §2 meaningful.
- The only thing that changes with the window is the scale on that one layer.
- The window itself asks for the design size — 1920x1080, clamped down to the
  display's work area and never started below 1280x720 — with `#0F0F0F` as its
  background colour so the very first paint is already the right colour. No
  `minWidth`/`minHeight` is set: the stage letterboxes, so a deliberately small
  window stays usable.
- At a 1920x1080 viewport the scale is exactly 1, which is the condition the
  Playwright geometry spec runs under.

This is also the step that replaced the legacy renderer: the C++ launcher drew
into a 1920x1080 offscreen FBO and blitted it up with
`glBlitFramebuffer` — the same "draw at design resolution, then scale" idea, with
the scaling done by the compositor instead of by GL.

The legacy screen geometry *not* in the design is recorded in code, not here; see
§7.

---

## 2. Measured values

Provenance is the export file and line the value was read from. "Live owner" is the
file that must still carry it — the same mapping `tools/check-fidelity.mjs`
enforces.

### Main menu — the export's `MainMenu.tsx`

| Value | Design | Export | Live owner |
|---|---|---|---|
| Canvas | 1920x1080, `#0F0F0F` | `:183` (body), `:323` (frame) | `stage/Stage.tsx`, `screens/MainMenu.tsx` |
| Screen padding | 56 top / 32 sides / 72 bottom | `:173` | `screens/MainMenu.tsx` |
| Logo lockup box | 625.021 x 250 | `:127` | `components/LogoBlock.tsx` |
| Wordmark band | `inset-[5.52%_0_33.15%_0.05%]`, inner `inset-[0_0_-5.22%_0]`, viewBox 624.714 x 161.327 | `:23`, `:24`, `:25` | `components/LogoBlock.tsx` |
| Wordmark shadows | dy 8.00915 black 40%, then dy 3.43249 `#848484` (colour matrix row `0.519445 … 1`) | `:58`, `:63`, `:65` | `components/LogoBlock.tsx` |
| Wordmark fill | `#FE0000`, painted twice: flat, then a white→black vertical gradient at 40% `overlay` (12 glyphs) | `:28`-`:51`, `:69`-`:116` | `components/LogoBlock.tsx` |
| Badge inset | `inset-[73.96%_7.57%_0_7.52%]` | `:9` | `components/LogoBlock.tsx` |
| Badge box | `py-[7.776px]`, `rounded-[4.786px]`, `#7f828a` plate, 173.006deg shade at `overlay` | `:9`-`:12` | `components/LogoBlock.tsx` |
| Badge shadow | `0px 1.944px 0px 0px #434343, 0px 3.888px 0px 0px rgba(0,0,0,0.4)` | `:9` | `components/LogoBlock.tsx` |
| Badge type | **43.13px**, tracking **12.939px**, `#f7f8fa`, `text-shadow 0px 4.313px 0px rgba(0,0,0,0.4)` | `:14` | `components/LogoBlock.tsx` |
| Menu stack | `gap-[32px]` between logo, card row and copyright | `:126` | `screens/MainMenu.tsx` |
| Card row band | `h-[616px]`, `gap-[48px]`, three cards centred | `:131` | `screens/MainMenu.tsx` |
| Card | **380 x 580**, `rounded-[8px]`, `#0f0f0f`, `shrink-0` | `:132` | `components/GameCard.tsx` |
| Card, selected | 8.5px outer border radius, `mix-blend-exclusion` glow, `shadow-[inset_0px_0px_36px_0px_rgba(255,255,255,0.25)]`, `inset-[-0.5px]` hairlines | `:137`-`:143` | `components/GameCard.tsx` |
| Card, unselected | `#0f0f0f` veil at `opacity-60` + 0.5px `#4d4d4d` hairline | `:149`, `:150` | `components/GameCard.tsx` |
| Card, selection scale | `scale(1.02)`, `transition-transform duration-200` | `MainMenuPage.tsx:121`, `:122` | `components/GameCard.tsx` (via `MAIN_MENU.card.selectedScale`) |
| RE3 cover art | own `rounded-[15.795px]` (the export sets `rounded: true` on the third entry only) | `:155`, `:156`; `MainMenuPage.tsx:12` | `components/GameCard.tsx` |
| Copyright line | 18px, `#999`, uppercase, `© CAPCOM CO.,LTD. 1996, 2025 All Rights Reserved. FAn Concept Julio CACKO` | `:164` | `screens/MainMenu.tsx` |
| Backdrop layer | 1920 x **1539.34**, `-scale-y-100`, `mix-blend-hard-light`, `opacity-20` (menu) | `:324`-`:329` | `components/Backdrop.tsx` |

### Helper bar — `MainMenu.tsx` (`:189`-`:319`) and `MainMenuRe1.tsx` (`:190`-`:320`)

| Value | Design | Export | Live owner |
|---|---|---|---|
| Bar height | **68px** (stated on the version screens' variant), flush to `bottom-[-1px]`, 1920 wide | `MainMenuRe1.tsx:314` | `components/HelperBar.tsx` |
| Bar padding | `px-[32px] py-[18px]`, plus the inner `input` frame's own `px-[32px]` | `:313`, `:314` | `components/HelperBar.tsx` |
| Hint group gap | `gap-[24px]`; key-to-label `gap-[8px]` | `:303`, `:221` | `components/HelperBar.tsx` |
| Key cap box | **32 x 32**, `overflow-clip`, `shrink-0` | `:191` | `components/HelperBar.tsx` |
| Key cap plate | **24 x 24** at `left-[4px] top-[4px]`, `rounded-[6px]`, `bg-[#2a2a2a]`, `border-[#232323] border-[0.5px]`, `shadow-[1px_1px_1px_0px_rgba(0,0,0,0.1)]` | `:192` | `components/HelperBar.tsx` |
| Arrow glyph | 12 x 12 at `inset-[31.25%]`, `#FFFFFE`; left/up rotate the cap, right/down do not | `:193`-`:200` | `components/HelperBar.tsx` |
| Enter key | 25 x 25 artwork at `left-[4px] top-[4px]`, `-scale-y-100 rotate-180`, `inset-[0_-8%_-8%_0]`, `Enter` in 10px `Inter Semi Bold Italic` at `tracking-[-0.9px]` | `:236`-`:266` | `components/HelperBar.tsx` |
| Esc / text keys | the plate plus a 10px caption at `left-[16px] top-[16px]`, `w-[18px] h-[12px]` | `:285`, `:286` | `components/HelperBar.tsx` |
| Labels | `Actor` **24px**, `#999`, `leading-none` | `:228` | `components/HelperBar.tsx` |

### Game Version screen — `MainMenuRe1.tsx` (RE1), `MainMenuRe2.tsx` (RE2), `MainMenuRe3.tsx` (RE3)

| Value | Design | Export | Live owner |
|---|---|---|---|
| Version column | **1060px** wide, full height, `#0f0f0f`, 56/32/72 padding, `gap-[32px]` | `:172` | `screens/VersionSelect.tsx` |
| Heading | `Game Version`, 32px, `#ccc`, centred | `:173` | `screens/VersionSelect.tsx` |
| Row list | `gap-[18px]`, rows `flex-[1_0_0]` | `:12`, `:13` | `screens/VersionSelect.tsx` |
| Row | full width, `rounded-[8px]`, `#0f0f0f` | `:13` | `components/VersionRow.tsx` |
| Row hero | `aspect-[1600/740]`, centred vertically, cropped by the clip layer | `:15` | `components/VersionRow.tsx` |
| Row, selected | 8.5px radius, `mix-blend-exclusion` glow (`inset 0 0 36px rgba(255,255,255,.25)`) | `:20`-`:26` | `components/VersionRow.tsx` |
| Row, unselected | `#0f0f0f` veil at `opacity-60` | `:34` | `components/VersionRow.tsx` |
| Info column | **860px** wide, 1080 tall, `overflow-clip` | `:176` | `components/InfoPanel.tsx` |
| Region-art lane | **647px** tall at `top-[433px]`, 860 wide, `opacity-98` | `:84` | `components/InfoPanel.tsx` |
| Blurred ellipse | 1028.197 x 925.377 centred at `top-[calc(50%+0.31px)]`, child `inset-[-98.66%_-88.8%]`, viewBox 2854.2 x 2751.38, 613px black stroke, `feGaussianBlur 150`, `opacity 0.91` | `:90`-`:104` | `components/InfoPanel.tsx` |
| Video window | **860 x 444**, `rounded-[2px]` | `:64` | `components/InfoPanel.tsx` |
| Video lane | 1080 tall, mask 860.102 x 602.547 | `:72` | `components/InfoPanel.tsx` |
| Info block | **482px** tall, `bottom-0`, `gap-[16px]`, `pt-[16px] px-[32px] pb-[73px]` | `:150` | `components/InfoPanel.tsx` |
| Info block gradient | `linear-gradient(0deg, rgba(15,15,15,.9) 24.667%, rgba(0,0,0,.565) 72.167%, rgba(18,18,18,.267) 84.667%, rgba(117,117,117,0) 100%)` | `:150` | `components/InfoPanel.tsx` (`VERSION_SCREEN.info.blockGradient`) |
| Logo box | per row, `h-[70px]` (DIRECTOR'S CUT `h-[120px]`), width as §2 table below | `:151`, `Frame219.tsx:349` | `src/shared/catalog.ts` (`logoWidth`/`logoHeight`) |
| Date | 32px, `leading-[0.99]`, `text-shadow 0 0 2px rgba(0,0,0,.12), 0 4px 8px rgba(0,0,0,.14)` | `:154` | `components/InfoPanel.tsx` |
| Description | 20px, `leading-none`, `h-[160px]`, `text-justify`, `whitespace-pre-wrap`, `w-[min-content] min-w-full` | `:138` | `components/InfoPanel.tsx` |
| Description row | `gap-[18px]`, `h-[247px]` | `:137` | `components/InfoPanel.tsx` |
| Meta box | `bg-[#0f0f0f]`, `p-[16px]`, `gap-[8px]`, `shadow-[inset_0px_0px_8px_0px_rgba(255,255,255,0.15)]`, 16px uppercase lines | `:127`, `:128`, `:130` | `components/InfoPanel.tsx` |
| Voices row | 16px, `gap-[10px]`, values keep their leading space (`` ` English` ``) | `:115`-`:120` | `components/InfoPanel.tsx` |
| Backdrop, other screens | `bottom-[-40.23px]`, `opacity-10`, no vertical centring | `:179`, `:182` | `components/Backdrop.tsx` + `BACKDROP.bottomOffset` / `.opacityScreen` |

### Per-row logo boxes and region-art lanes (the eight frames)

| Row | Export frame | Logo box (w x h) | Region-art lane |
|---|---|---|---|
| `re1_us` | `MainMenuRe1.tsx:151` | 262.686 x 70 | `aspect-[1218.7529296875/1445.560546875]` at `top-[-109.94px]`, art cropped `h-[163.67%] left-[-20.62%] top-[-27.26%] w-[120.62%]` |
| `re1_jp` | `MainMenuRe4.tsx:149` | 253.043 x 70 | centred box `w-[1254px] h-[940.5px]` |
| `re1_dc` | `Frame219.tsx:349` | 296.819 x **120** | drawn on the RE1 JP lane (the vendored switcher clamps the third row onto the second screen, `VersionSelectPage.tsx:86`) |
| `re2_leon_us` | `MainMenuRe2.tsx:149` | 292.817 x 70 | `aspect-[1016/1132]` from `left-[-0.05%]` |
| `re2_proto` | `Frame219.tsx:700` | 415.598 x 70 | drawn on the RE2 JP lane (same clamp) |
| `re2_jp` | `MainMenuRe5.tsx:138` | 301.739 x 70 | `aspect-[1664/2046]` hung off `bottom-[-116.59px]` |
| `re3_us` | `MainMenuRe3.tsx:134` | 339.477 x 70 | `aspect-[1920/1441]` hung off `top-[-22.19%]` |
| `re3_jp` | `MainMenuRe6.tsx:134` | 309.668 x 70 | the same RE3 lane |

### Gameplay screen — `MainMenuRe{1,2,3}Gameplay.tsx`

| Value | Design | Export | Live owner |
|---|---|---|---|
| Card | **1300 x 975**, `bg-white`, `rounded-[4px]`, centred horizontally | `:52`, `:49`, `:40` | `screens/Gameplay.tsx` |
| Card top | 45px (RE1/RE2), **52.28px** (RE3) | `Re1Gameplay:52`, `Re3Gameplay:40` | `GAMEPLAY_LAYOUTS[*].cardTop` |
| Media box | `inset-[-0.1%_0_0_0]`, still cropped `h-[107.28%] left-[-0.05%] top-[-3.78%] w-[100.1%]` | `Re1Gameplay:20`, `:12` | `GAMEPLAY_COMMON.mediaInset` |
| Screen ground | `#010101` | `Re1Gameplay:68` | `screens/Gameplay.tsx` |
| Logo rotation | `-rotate-90` inside a centred wrapper | `Re1Gameplay:55`-`:57` | `screens/Gameplay.tsx` + `GAMEPLAY_COMMON.logoRotation` |
| Per-title offsets | see §4 | — | `GAMEPLAY_LAYOUTS` |

---

## 3. The mask gradients

The export expresses its masks as inline SVG data URIs (`mask-image: url('data:image/svg+xml,…')`)
whose gradients only ever use alpha. `src/renderer/src/data/design.ts` (`MASKS`)
holds the CSS equivalents; components set both `mask-image`/`-webkit-mask-image`
and pass `mask-size` where the design's mask is smaller than the box it is painted
on.

| Mask | Export data URI | Gradient in the export | CSS in `data/design.ts` | Exact? |
|---|---|---|---|---|
| `infoPanel` — 860x1080 column, fades in from the left | `svg-xcltc.tsx:1` (`imgBody`) | x 0 → 860 at y 540; stops `#D9D9D9` @0%, `#AFAFAF` α.415094 @0.529034%, `#737373` @21% | `linear-gradient(90deg, rgba(217,217,217,0) 0%, rgba(175,175,175,0.415094) 0.529034%, #737373 21%)` | yes |
| `regionArt` — 860x647 lane, fades in from its top | `svg-xcltc.tsx:2` (`imgImage15`) | y 0 → 647 at x 430; stops `#080808` @0%, α.8 @3.66663%, `#080808` @58.1666% | `linear-gradient(180deg, rgba(8,8,8,0) 0%, rgba(8,8,8,0.8) 3.66663%, #080808 58.1666%)` | yes |
| `videoLane` — 860.102x602.547 lane, brings the video window in | `svg-xcltc.tsx:3` (`imgBody1`) | y **460.972 → 141.576** at x 430 (an inset axis, pointing **up**); stops `#D9D9D9` @10.9104%, `#AFAFAF` α.415094 @23.8689%, `#737373` α.8 @32.2379% | `linear-gradient(180deg, rgba(217,217,217,0) 10.9104%, rgba(175,175,175,0.415094) 23.8689%, rgba(115,115,115,0.8) 32.2379%)` | **no — see below** |
| `videoFrame` — 859.898x418.749 window, dissolves its bottom edge | `svg-xcltc.tsx:4` (`imgImg`) | y 418.749 → 0 at x 429.949; stops α0 @0%, α.799296 @20.6666%, opaque black @99.6666% | `linear-gradient(0deg, rgba(0,0,0,0) 0%, rgba(0,0,0,0.799296) 20.6666%, #000000 99.6666%)` | yes |

Three of the four are exact restatements: the angle matches the export's own axis
direction and the stops keep the export's percentages and colours. The export omits
`stop-color` on `videoFrame`'s stops, where the SVG default (black) is what the CSS
spells as `rgba(0,0,0,…)` / `#000000`.

**The `videoLane` mask is the one approximation in this file.** The export's
gradient axis is inset — it runs from y=460.972 to y=141.576 inside a 602.548px
mask box, i.e. it points *upward* and spans 319.4px, not the whole box — with the
result that the mask is at α 0.8 from the top of the lane down to y≈358, fades to
α 0 at y≈426, and is transparent below that. The CSS in `data/design.ts` keeps the
export's percentages but reads them from the *top* (`180deg`), so the ramp runs the
other way: transparent above y≈66, α 0.415 at y≈144, α 0.8 from y≈194 down.

Both readings show a soft band across the video window, and the video's bottom edge
is dissolved either way (by `videoFrame`, which is exact), but they are not the
same pixels. Making it exact means writing `0deg` with the axis-inset percentages
recomputed for the full box — α 0 at ≈29.3%, α 0.415 at ≈36.1%, α 0.8 at ≈40.6% —
which is a one-line change in `src/renderer/src/data/design.ts`. `data/design.ts`
is frozen for this rewrite, so the discrepancy is **recorded here instead of
changed**, and `tools/check-fidelity.mjs` pins the current spelling so it cannot
drift further unnoticed.

---

## 4. Per-title gameplay offsets

One component draws all three gameplay frames; the per-title numbers are
`GAMEPLAY_LAYOUTS` in `src/renderer/src/data/design.ts`, read from the export
below. The parenthesised numbers are line references into that title's export file.
The logo is always turned `-90°`, and the two size pairs are deliberately
different: the wrapper is the *rotated* box and the artwork is the unrotated one.

| | RE1 (`MainMenuRe1Gameplay.tsx`) | RE2 (`MainMenuRe2Gameplay.tsx`) | RE3 (`MainMenuRe3Gameplay.tsx`) |
|---|---|---|---|
| Lane width / right / top | 999 / `-293px` (`.29`) / `50%` (`.29`) | 999 / `-418px` (`.28`) / `0` (`.28`) | 1285 / `-74px` (`.19`) / `calc(50% - 0.22px)` (`.19`) |
| Lane aspect | `1218.7529296875/1445.560546875` (`.30`) | `1016/1132` (`.29`) | `1920/1441` (`.20`) |
| Lane inset | `-109.94px 0 auto 0` (`.30`) | `0 auto 0 -0.05%` (`.29`) | `-22.19% 0 0 0` (`.20`) |
| Art inset (oversized crop) | `163.67% / -20.62% / -27.26% / 120.62%` (`.32`) | — (fills its box) | — (fills its box) |
| Card top | 45px (`.52`) | 45px (`.49`) | 52.28px (`.40`) |
| Logo wrapper (w x h) | 137.574 x 516.266 (`.55`) | 130 x 543.803 (`.52`) | 130.318 x 632 (`.43`) |
| Logo artwork (w x h) | 516.266 x 137.574 (`.57`) | 543.803 x 130 (`.54`) | 632 x 130.318 (`.45`) |
| Logo left / top | `73.11px` (`.55`) / `calc(50% - 1.13px)` (`.55`) | `73px` (`.52`) / `50%` (`.52`) | `96px` (`.43`) / `50%` (`.43`) |
| Media kind | still (`gameplay-re1`) | **video** (`video-re2`) | still (`gameplay-re3`) |

`GAMEPLAY_COMMON.mediaInset` (`107.28% / -0.05% / -3.78% / 100.1%`) is the export's
still crop and is applied to both kinds, so the still and the trailer cannot drift
apart; `GAMEPLAY_COMMON.card` is `1300x975`, radius 4, `#FFFFFF`.

The media kind per title is a design decision as well: `GAMEPLAY_MEDIA` in
`src/shared/catalog.ts` gives RE1 and RE3 a still and RE2 a video, which is what
the three frames draw.

---

## 5. The asset pipeline

`pnpm assets:sync` → `tools/sync-design-assets.mjs`. Two sources, in order of
preference:

1. **`media/`** — the art the *previous* launcher shipped, which is the verified
   1x twin of the Figma export's @2x/@4x originals. "Verified" means dimension by
   dimension, measured against the export with `sharp`:

   | `media/` file | Measured | Design box | Note |
   |---|---|---|---|
   | `RE1Logo.png` | 263 x 70 | 262.686 x 70 | the art is the box rounded up |
   | `game_1_type_jp.png` | 254 x 70 | 253.043 x 70 | same |
   | `game_2_type_default.png` | 293 x 70 | 292.817 x 70 | same |
   | `game_3_type_default.png` | 340 x 70 | 339.477 x 70 | same |
   | `game_re1_region_default.png` (and the other five region files) | 1068 x 1080 | mask size 1068 x 1080 | exact |
   | `game_re1_version_default.png` (and the other five hero files) | 1600 x 741 | hero box `aspect-[1600/740]` | one pixel of rounding, absorbed by `object-cover` in a clipped box |

   The design box is always the authority: the panel sizes the lane from the
   export and the art is cropped into it, which is why a 263px-wide logo lands in a
   262.686px box without the layout moving.

2. **`.ref/designref/src/assets/`** — for the handful of assets the export has and
   `media/` does not: the Unsplash backdrop (2787 x 4096), the three portrait covers
   (342 x 482 each), and the two gameplay stills (640 x 480 and 320 x 240).

Everything is re-encoded to WebP so the renderer stays small (the backdrop alone is
a 2787x4096 portrait photo, downscaled to 1920 wide because only a 1920-wide slice
is ever visible). Videos are copied verbatim — re-encoding would cost quality for
no real saving — and so are the WAV cues and the Actor font.

| Output | Source | Transform |
|---|---|---|
| `game/backdrop-unsplash.webp` | export | 1920 wide, q88 |
| `game/card-re{1,2,3}.webp` | export | native (342x482 portrait art), q90 |
| `game/gameplay-re1.webp`, `game/gameplay-re3.webp` | export | native, q90 |
| `game/hero-*.webp` (8) | export | 1600 wide, q86 |
| `game/lane-*.webp` (8) | export | native, or 1720 wide for the ones wider than that (§7.4) |
| `game/logo-*.webp` (8) | `assets/textures/` | native width (each already equals its design box), q92 |
| `video/*.mp4` (6) | `assets/videos/` | copied |
| `audio/{confirm,back,cursor}.wav` | `assets/audio/` | copied |
| `font/Actor-Regular.ttf` | `assets/fonts/` | copied |

**Nothing the Figma frames draw comes from `media/` any more.** That folder is the previous
launcher's own art, and two families were still being sourced from it while the generated
`design-map.json` went on claiming the export's hashes for them: the info-panel lanes (§7.4) and
the version-row heroes. `tools/sync-design-assets.mjs` now refuses to run if a `game/hero-`,
`game/lane-`, `game/logo-` or `game/card-` output is pointed at `media/`, because a comment
saying "this is the design's art" is exactly the kind of claim that quietly stops being true.

The heroes are worth a note of their own. Six of the eight turned out to be the *same image* as
the `media/` file they came from (a 16x16 greyscale fingerprint puts them ≤ 0.7/255 apart), so
switching them changed nothing on screen and only made the provenance honest. The other two
were a real correction: `re2_proto` and `re2_jp` were showing different artwork entirely, ~24/255
apart. A shape check could never have caught that - the frames' hero art and `media/`'s are both
1600x740 - which is why `tests/e2e/geometry.spec.ts` asserts the heroes' *provenance* from the
manifest rather than their dimensions.

Two generated files record what happened, and neither is hand-edited:

- `src/renderer/src/assets/MANIFEST.json` — every output with its source path and
  byte size.
- `src/renderer/src/assets/design-map.json` — `figma:asset/<hash>` → converted
  file, for the handful of export hashes a frame references twice.

`electron.vite.config.ts` resolves `figma:asset/<hash>.png` against
`src/renderer/src/assets/design/` (as a `.png`, or its `.webp` twin), which is what
makes an exported component importable if you drop one in beside the working tree. The
app itself never does: the export is a *reference*, not a dependency, and it is not part
of the repository (§1). On build, Vite emits the art into stable directories (`art/`,
`video/`, `font/`, `audio/`) so a packaged build can be inspected.

`node tools/sync-design-assets.mjs --check` reports what is missing without
writing, which is what a CI job should call.

---

## 6. Asset keys

`src/shared/catalog.ts` refers to art by **key**, never by file; `data/assets.ts`
is the only module that knows which file a key means. Unknown keys resolve to `''`
and every consumer treats that as "draw nothing" rather than as a broken image.

| Key | File | Used by |
|---|---|---|
| `game/backdrop-unsplash` | `game/backdrop-unsplash.webp` | every screen's `Backdrop` |
| `game/card-re1` / `-re2` / `-re3` | `game/card-re*.webp` | main-menu covers |
| `game/gameplay-re1` / `-re3` | `game/gameplay-re*.webp` | gameplay card still (RE1, RE3) |
| `game/hero-re1-us` / `-re1-jp` / `-re1-dc` / `-re2-leon` / `-re2-proto` / `-re2-jp` / `-re3-us` / `-re3-jp` | `game/hero-*.webp` | version-row hero art, from the export (§7.3) |
| `game/lane-re1-us` / `-re1-jp` / `-re1-dc` / `-re2-leon` / `-re2-proto` / `-re2-jp` / `-re3-us` / `-re3-jp` | `game/lane-*.webp` | info-panel lane art (one per row) |
| `game/logo-re1-us` … `game/logo-re3-jp` (8) | `game/logo-*.webp` | info-panel logo box, gameplay rotated logo |
| `video/video-re1` / `-re1-jp` / `-re2` / `-re2-jp` / `-re3` / `-re3-jp` | `video/video-*.mp4` | info-panel video window; `video/video-re2` also fills the RE2 gameplay card |
| — | `audio/{confirm,back,cursor}.wav` | `audio/useSfx.ts` (`SFX_URLS`, not catalog keys) |
| — | `font/Actor-Regular.ttf` | `styles/fonts.css` (`ACTOR_FONT_URL`) |

**Every lane has its own art, and it is the design's own file.** The lanes were the
last place the app used `media/` art instead of the export's: `media/game_re*_region_*.png`
are all near-square 1068×1080, while the export frames each lane at the *art's* aspect
(the RE2 US lane is `aspect-[1016/1132]` and its asset is 1016×1132; RE3 US is
`aspect-[1920/1441]` and its asset is 1920×1441). Seven of the eight match exactly;
RE1 US is the exception, and there the art is deliberately oversized inside the lane
(`h-[163.67%] w-[120.62%]`) so it keeps its own aspect while the lane crops it.

The eight lane arts, with the frame each comes from and the asset hash:

| Row | Frame | Asset | Native size |
|---|---|---|---|
| `re1_us` | `MainMenuRe1.tsx:85` | `6b9a2a4e…` | 1470×2366 |
| `re1_jp` | `MainMenuRe4.tsx:85` | `876ae37e…` | 640×480 |
| `re1_dc` | `Frame219.tsx:285` | `e736a17d…` | 4096×2340 |
| `re2_leon_us` | `MainMenuRe2.tsx:85` | `8c48435d…` | 1016×1132 |
| `re2_proto` | `Frame219.tsx:632` | `2a4dea96…` | 3537×2662 |
| `re2_jp` | `MainMenuRe5.tsx:74` | `b12c5012…` | 1664×2046 |
| `re3_us` | `MainMenuRe3.tsx:74` | `58d40011…` | 1920×1441 |
| `re3_jp` | `Frame219.tsx:862` | `cf21968f…` | 3840×2160 |

Two of those frames are not screens: `Frame219.tsx` is the export's consolidated
reference sheet of all eight info panels. It is what settles the rows the vendored
screen switcher cannot, because the switcher clamps each title's three rows onto two
screens (`.ref/designref/src/app/components/VersionSelectPage.tsx:18-22`, `:86`) — so
an earlier revision drew RE1 DIRECTOR'S CUT on the RE1 JP lane, RE2 BIOHAZARD 1.5 on
the RE2 JP lane, and both RE3 rows on the RE3 US lane. The reference sheet gives all
three their own lane, and `MainMenuRe6` (the frame the switcher clamps onto for RE3
JP) is the one that does not, so the sheet wins.

`tests/e2e/geometry.spec.ts` asserts the result with a derived invariant rather than
a restated number: for every row, the *rendered* box of the art element must have the
art file's own aspect. That holds for the seven 1:1 lanes and for RE1 US's oversized
crop alike, and it is exactly what the old near-square art broke — verified by
pointing a row at the wrong asset and watching it fail
(`rendered aspect 1.3333 vs the file's 0.6213`).

One asset is still shared on purpose: `re2_proto` (BIOHAZARD 1.5) reuses the RE2
Alt **hero and logo** art, because the concept draws its middle RE2 row with those
`Type=Alt` textures — but its *lane* is its own, as the table above shows.

---

## 7. Deliberate deviations

Everything here is a place where the app knowingly does not match the concept, with
the reason and the substitute it uses instead.

### 7.1 Surfaces the concept has no frame for

Seven surfaces exist in the running app and not in the Figma file. Each is composed
from the design's own tokens rather than from new ones, and its geometry comes from
the screen the rewrite replaces.
| Surface | Why it exists | Composed from | Geometry source |
|---|---|---|---|
| **Launch panel** (`overlays/LaunchPanel.tsx`) | The concept has no launch surface; the MODE / CRT / SCENARIO / LAUNCH rows are the launcher's whole point | The export's `Frame3` meta box (`bg-[#0f0f0f]`, `p-[16px]`, `gap-[8px]`, `shadow-[inset_0px_0px_8px_0px_rgba(255,255,255,0.15)]`) plus the 1px `#4d4d4d` hairline every selectable surface carries; 8px row gap is the recipe's own `gap-[8px]`; rows are `h-[48px]` for a comfortable pointer target | `git show HEAD:src/ui/screens/screen_launch.cpp` (mode row forced by `hasMod`, CRT row, centred LAUNCH; selected row was `RGBA(0xFF,0xFF,0xFF,0x10)`, reproduced as a 0.063 white wash) |
| **Install Status** (`overlays/InstallStatus.tsx`) | First-run gate when a title is missing — the legacy boot rule, not a design screen | `#0f0f0f` surface, `#ccc` 32px heading, `#999` sub-lines, 20px rows, the shared card surface (`#1a1a1a`, 1px `#4d4d4d`, 4px corner, inset glow), key-cap idiom for the Enter hint | `git show HEAD:src/ui/screens/screen_install.cpp` (heading at y=80, sub-line at y=140, 1680x100 rows at x=120 from y=260 stepping 120px) |
| **Error dialog** (`overlays/ErrorDialog.tsx`) | A failed launch or injection has to be reportable | `rgba(0,0,0,.75)` scrim (the legacy `0xC0`), the shared card surface, the design's 36px inset glow | `git show HEAD:src/ui/screens/screen_error.cpp` (920x480 card centred in 1920x1080, 24px title 48px below the card's top, 20px message wrapped at 840px, 30px line advance) |
| **Achievement toast** (`overlays/AchievementToast.tsx`) | Unlocks are announced without a modal | The shared card surface; the legacy gold `#D4AF37` kept for the eyebrow, glyph and underline only | `git show HEAD:src/achievements/achievement_overlay.cpp` (300ms fade in, hold, 300ms fade out; card at `x = 1920 - 420`, `y = 30`) |
| **CRT overlay** (`overlays/CrtOverlay.tsx`) | Optional retro post-processing, carried over from the old launcher | Gradients, `feTurbulence`, `feDisplacementMap`; see `docs/ARCHITECTURE.md` §10 for what each layer replaces and what is lost | `git show HEAD:assets/shaders/crt.frag`, `git show HEAD:src/renderer/crt_filter.cpp` |
| **Settings** (overlays/Settings.tsx) | The launcher's whole configuration had no surface: CRT, the three volumes, what the window does when a game starts, where the games are, re-scan and reset were editable only by hand in config.json. Reached from a SETTINGS row in the launch panel, which keeps the three designed screens pixel-identical at rest | The launch panel's own row idiom, copied as class strings: 48px rows, #999 for the rows not under the cursor and white for the one that is, the design's 8px corner with the 8.5px selection hairline. Reusing an existing idiom rather than inventing a second one is the point - a settings screen should look like the panel it opens from | Not from the legacy launcher, which had no settings screen either: the surface is a full-canvas #0f0f0f sheet with 180px gutters and 80px top margin, its rows a 12-row stack, and the same 68px helper bar every screen mounts |
| **Now-playing bar** (`screens/Gameplay.tsx`, `data/design.ts` `NOW_PLAYING_LABEL`) | The concept's Gameplay card is a *frame* filled with gameplay footage and says nothing about what is running. With the game running in its own window — it cannot be embedded, see `docs/ARCHITECTURE.md` §6 — the card alone would imply the footage is the game. The bar is the truth: which row, running or not, for how long, and the one action that matches a running game | `COLOR.reRed` for the dot, `COLOR.bg` at 85% with a 2px backdrop blur for the ground, `COLOR.textMuted` and `COLOR.textPrimary` for the two lines, the card's own 4px radius, and the design's Actor for the type; the button reuses the shared `#2a2a2a` ground and `#4d4d4d` hairline | Not from the legacy C++ launcher, which had no running-game surface at all: the bar is 16px inside the card's bottom edge, full width minus those insets, so it cannot drift from the card it sits in |

One thing that bar does *not* do, and should be named: it is pointer-driven. The concept's
Gameplay helper bar is `Esc Back` and nothing else, so adding a STOP key would put a hint on
screen that the design does not draw. The action is therefore a button, and the keyboard
path out of the screen is unchanged.

Two related calls inside those surfaces worth naming: the Install Status screen's
`CHANGE INSTALL FOLDER` label is **informational** in this pass (the frozen
`InstallStatusProps` does not carry `setInstallRoot`, and a focusable control that
did nothing would be a lie to the keyboard user), and the achievement toast's
legacy gold *edge* is replaced by the shared hairline so it belongs to the same
family as the dialog and the gate.

### 7.2 The badge: the concept's own texture, not re-typeset text

The concept draws `Classic Collection` in a face it calls
`'Resident Evil Classic Font'`. Research identified it as Peter Jonca's **"Resident
Evil Classic Game Font"** — his own re-creation of the title lettering from RE1,
RE2 and RE3, published free on
[DeviantArt](https://www.deviantart.com/snakeyboy/art/Resident-Evil-Classic-Game-Font-842017934)
under **CC BY-ND 3.0** ("It's the Classic Title Font from the Games Resident Evil,
Resident Evil 2 and Resident Evil 3 (not the remakes!)"). The name match is exact,
so the concept's badge is that font.

CC BY-ND *does* permit redistributing the font unmodified with credit, so shipping it
would be lawful — but the download is behind a DeviantArt login, which means the file
can be neither fetched nor verified from here, and committing an unverifiable copy of
someone else's work under a licence that forbids derivatives is not a call this
repository makes silently.

**The badge therefore renders the designer's own pixels instead of live text.**
`assets/textures/main-logo.png` is the concept's assembled lockup — the red wordmark
over a transparent gap over the badge, confirmed by `tools/inspect-image.mjs`, which
reports the three bands (red through y208, empty y216..226, grey/white y227..307) and
the badge band's opaque columns at x57..x711. Those columns are the design's own
`7.52% / 7.57%` inset of 770px (57.9 and 711.7) to the pixel, so the crop lands inside
the design's badge box exactly.

`tools/sync-design-assets.mjs` lifts that band out at its native 655x81 and the
component covers it into the box the export defines. Three consequences:

- **The glyphs are exact**, not an approximation by a similar face, and no font file
  is involved at all — so there is no unresolvable `@font-face`, no console 404, and
  no licence question for downstream users.
- **The box, inset, 4.786px radius and two-offset drop shadow are still the export's.**
  The texture supplies the badge's face and lettering only; everything positional is
  drawn in CSS from the design's own values, which is why the crop trims the five rows
  of drop shadow that Figma flattened into the texture — keeping both would darken it
  twice.
- **The wordmark stays inline SVG.** It is a vector trace in the export and stays sharp
  at any stage scale, which matters on a display larger than the 1920×1080 canvas; a
  raster lockup would have gone soft there.

The cost is that the export's badge *type* tokens (`py-[7.776px]`, `text-[43.13px]`,
`tracking-[12.939px]`, its text-shadow, the `#7f828a` fill, the overlay gradient and
`bg-clip-text`) no longer exist in the markup, because all of them are baked into the
pixels. That is a real reduction in what `tools/check-fidelity.mjs` can compare, so it
is compensated in three ways rather than waved through:

1. `check-fidelity.mjs` gained **`liveTokens`** — facts a live file must carry that the
   export has no equivalent for. `LogoBlock.tsx` is now held to `BADGE_ART.key`,
   `data-figma-node="logo-badge"` and `object-cover`, so the *replacement* cannot
   silently disappear either. Verified by unhooking the art and watching the check fail.
2. `tests/e2e/geometry.spec.ts` measures the badge's box and derives its expectation
   from `MAIN_MENU.logo.badgeInset` — the percentages above — so the geometry stays
   under test even though its class strings moved into pixels.
3. `tests/e2e/fonts.spec.ts` asserts the badge image is present and *decodes*, which an
   empty box would not.

An earlier revision of this app used a bundled OFL stand-in face
([Metamorphous](https://fonts.google.com/specimen/Metamorphous), Sorkin Type Co, SIL
OFL 1.1) behind a `local()` lookup. That machinery is gone: with the designer's own
texture available it was strictly worse — a similar face where an exact one is
possible.

### 7.2.1 A typography defect found along the way, and fixed

The export classes **every** label `font-['Actor:Regular',sans-serif]` — Figma's own
`Family:Style` notation (`MainMenuPage.tsx:54` and ~114 other places). Tailwind v4
compiles an arbitrary family verbatim, so that class emitted
`font-family: Actor\:Regular, sans-serif`: the `:Regular` suffix is not a family any
system has, so all 27 shipped occurrences fell through to the system sans — Segoe UI
on Windows. The interface measured exactly as designed while every label was drawn in
the wrong face.

Fixed by declaring a second `@font-face` whose family name *includes* the suffix,
`font-family: 'Actor:Regular'` (the `\:` in the used value is the CSS escape for a
colon, so the two match exactly). No class string changed, which keeps the markup byte
comparable against the export for `tools/check-fidelity.mjs`, and there is no
hand-edited markup to drift from the concept.

### 7.3 Text reproduced verbatim from the concept

The requirement is 1:1 with the concept, so the concept wins over any
reconciliation:

- **`originally released in 11 November 1999`** on the RE3 US row
  (`src/shared/catalog.ts`, `re3_us`) is reproduced exactly as the concept writes
  it, next to the JP row's `originally released in 22 September 1999`. The brief
  records this string as the one that "looks like the Japanese date"; either way,
  no release-history correction is applied, because changing it would break the
  1:1 requirement that the row is checked against.
- The descriptions keep the concept's **doubled spaces** inside sentences, because
  the info panel renders them with `whitespace-pre-wrap` and the export writes two
  spaces there.
- The Voices/Labels values keep their **leading space** (`` ` English` ``,
  `` ` Japanese` ``), which is how the export splits that row into five `<p>`s.
- The big `releaseLabel` date is the date the *concept* draws, which is the same on
  all three RE1 rows (`July 24, 1998`), both RE2 rows (`September 29, 1998`) and
  both RE3 rows (`September 27, 1998`); the per-region truth lives in
  `originalRelease`, which is the line the concept draws as
  `originally released in …`.
- The concept's **trailing spaces** on the date line (`` `July 24, 1998  ` `` in
  `Frame219.tsx`) are *not* reproduced: the catalog stores the date without them
  and the line is `whitespace-nowrap`, so the pixels are the same either way.

### 7.4 Other divergences

| Where | Divergence | Why |
|---|---|---|
| `components/Media.tsx` | A failed/missing asset renders **nothing** (or the caller's fallback) rather than the vendored `ImageWithFallback`'s grey placeholder | A grey box in a lane that should hold cover art reads as a rendering bug, and it would paint over the backdrop; the caller's own box holds the layout open |
| `components/InfoPanel.tsx` | The video frame is masked at the artefact's own 859.898x418.749 size, not the export's `mask-size-[640px_418.75px]` | With `no-repeat`, a 640px-wide mask would mask out the video's right 220px, which a purely vertical gradient cannot mean; only the vertical geometry is load-bearing |
| `components/InfoPanel.tsx` | The base layer's `bg-[#0f0f0f]` sibling is omitted | The screen underneath is already that exact colour |
| `components/VersionRow.tsx` | The row's meta box for an inert concept row is pinned bottom-left | The concept row has no info-panel line of its own to carry the note |
| `input/*` | Escape is not `preventDefault`ed, and the pad's arrow/D-pad handling uses one 0.5 deadzone instead of the legacy 0.2-then-0.5 gate | Escape is how the user leaves fullscreen; the two-threshold gate was a legacy accident |
| `audio/useSfx.ts` | Audio is unlocked by the first pointer/key gesture | Browsers refuse to start audio without a user gesture |
| Vendored `reference-*.tsx` | Not used as code: routing is a `ScreenId` in the store, not `react-router` | They are the *interaction* reference (selection, clamps, key bindings); no router dependency is shipped |

---

## 8. How fidelity is verified

Three layers, cheapest first. A change to any tracked value has to pass all three.

### 8.1 `pnpm check:fidelity` — the mechanical guard

`tools/check-fidelity.mjs` (no dependencies) reads the vendored export and checks
that the live renderer still carries what the design writes:

- **283 tokens from 11 export files**, across **22 export→component mappings** and
  **42 translated values**, as of this rewrite — a token being a class string such
  as `h-[580px]`, `rounded-[15.795px]`, `tracking-[12.939px]`,
  `shadow-[inset_0px_0px_36px_0px_rgba(255,255,255,0.25)]`,
  `inset-[73.96%_7.57%_0_7.52%]`, `aspect-[1600/740]`, `p-[16px]`, or a verbatim
  numeric token such as `624.714`, `8.00915`, `2854.2` or `262.686`.
- **`TRANSLATED`** carries the values whose spelling had to change: the export's
  `h-[70px]` logo box is `logoHeight: 70` in the catalog, the mask offsets are
  percentages in CSS, the gameplay offsets are `GAMEPLAY_LAYOUTS` data. Both halves
  are checked, so changing either side fails.
- With the export present, the components it is read from must be the export's
  own: `.ref/designref/src/imports/<name>`. Without it, the guard says so and
  verifies nothing (see the note in §1) — it never reports "ok" for a check it
  could not run.
- **Comments are stripped** before the search: a design value that survives only in
  a header comment is drift.
- A token that has moved to another live file is reported as a *relocation*
  (a warning, and a failure under `--strict`); a token that is gone is a failure
  and the command exits 1. A one-line summary is printed either way.

Run it after touching any component, any value in `data/design.ts`, and any part of
the catalog that carries measured text.

### 8.2 The Playwright geometry spec

`pnpm test:e2e` compiles the app and runs the browsers' specs from `tests/e2e/`
(see `playwright.config.ts`, `testDir: './tests/e2e'`). The geometry spec asserts
the same measured values at runtime, in the built app rather than in the source:

- the stage letterbox rule (scale = `min(vw/1920, vh/1080)`, and exactly 1 at a
  1920x1080 viewport);
- the main-menu lockup (625.021 x 250), the badge box derived from
  `inset-[73.96%_7.57%_0_7.52%]`, the three 380x580 cards and their 48px gap;
- the 68px helper bar and its 32px caps;
- the 1060/860 columns, the 18px row gap, the 482px info block and the 444px video
  window;
- the gameplay card (1300x975), its per-title top and the rotated logo box.

It reads the same numbers from `src/renderer/src/data/design.ts`, which is why that
file exists: a value can only be wrong in one place.

### 8.3 The human side-by-side

The last check is a person looking at both, because no test can say whether a
composite *reads* right:

```pwsh
# one terminal
pnpm --dir .ref/designref dev      # the Figma export, served as a page

# another terminal
pnpm dev                           # the launcher
```

Put both at 1920x1080 (a 1920x1080 window means the launcher's stage is at scale 1)
and compare screen by screen:

| Screen | Compare first |
|---|---|
| Main menu | wordmark lockup and badge inset, badge tracking, card sizes and the selected card's glow |
| Game Version (RE1/RE2/RE3) | column widths (1060/860), row heights and the 18px gap, the region-art lane's crop, the info block's 482px and the meta box |
| Gameplay | card size and top offset, the rotated logo, the lane's offset and its dissolve |

### 8.4 Changing a design value

A tracked value exists in at least three places, and they must move together:

1. the live component's class string (and its comment, which cites the export),
2. `src/renderer/src/data/design.ts` if the value is also read as data,
3. the token in `tools/check-fidelity.mjs` (`TRACKED` or `TRANSLATED`) and, if the
   number is asserted at runtime, the Playwright expectation.

Then re-run `pnpm check:fidelity` (with `--strict` once the tree is settled), the
geometry spec, and the side-by-side. Never round a design number, never re-derive it
from another one, and never let a component compute a value the export states
outright — those are exactly the three ways this claim would quietly become false.


## Fan release additions

Collection, Version and Now Playing retain their measured geometry and 283-token fidelity check. VersionSelect owns the single launch panel.

New settings pages extend the design using the existing dark palette, Actor face, red focus accent and authored 1920×1080 stage. Settings use a category rail; Controls uses action/primary/secondary columns. MGS references inform hierarchy and navigation only. Native game action slots are not fabricated.

New dialogs have focus containment, visible focus, Escape cancellation and focus restoration. Underlying screens are inert while full-screen dialogs are active. Reduced-motion CSS suppresses nonessential transitions. Geometry tests remain, supplemented by credential/key-capture checks and 1280×720/1920×1080 screenshots. Physical DPI and controller evidence remains a separate gate.
