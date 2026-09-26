/**
 * The 68px helper bar that closes every screen, and the key caps it is built from.
 *
 * All geometry is transcribed from the Figma export instead of being re-derived:
 *
 *   `.ref/designref/src/imports/MainMenu.tsx`
 *      Helper, Row, Frame2 (left/right), Frame4 (enter), Frame3 (esc),
 *      TLeft, TRight, TEsc, TEnter
 *   `.ref/designref/src/imports/MainMenuRe1.tsx`
 *      Helper (the variant that states h-[68px]), Frame (up/down), TUp, TDown
 *   `.ref/designref/src/app/components/MainMenuPage.tsx`
 *      KeyCap (the "key caps may be plain text" behaviour)
 *
 * A design number therefore stays inside the Tailwind arbitrary class the export
 * writes it in — Tailwind cannot interpolate a TypeScript constant — while
 * HELPER_BAR/COLOR from data/design.ts supply the handful of values the export
 * leaves to SVG attributes, which no class can express.
 */
import type { HelperBarProps, HelperHintLike, KeyCapProps } from '@renderer/contracts'
import { COLOR, HELPER_BAR } from '@renderer/data/design'

// ---------------------------------------------------------------------------
// artwork
// ---------------------------------------------------------------------------

/*
 * Copied verbatim from `.ref/designref/src/imports/svg-2gfz0znw1n.ts`. They are
 * private to this file because the helper bar is the only place the design
 * draws them; a shared art module would be a file outside this task's scope.
 *
 * Both arrows are 12x12 and point right. The caps reach the four directions the
 * export's way: the arrow is rotated -90° for up, and the *whole cap* is rotated
 * a further -90° for left (`TLeft` inside `Frame2`) or +90° for down (`TDown`
 * inside `Frame`), which is why the rotations below are nested rather than one
 * -180°/90° on a single element.
 */

/** `p21114920` — the arrow the export rotates -90°. */
const ARROW_GLYPH_ROTATED =
  'M11.8643 6.32652L6.32615 11.8646C6.26161 11.9293 6.17934 11.9733 6.08977 11.9911C6.0002 12.0089 5.90735 11.9998 5.82297 11.9648C5.7386 11.9299 5.66649 11.8707 5.61579 11.7947C5.56508 11.7188 5.53805 11.6295 5.53813 11.5381V9.23057H0.923021C0.678221 9.23057 0.443447 9.13333 0.270347 8.96023C0.0972465 8.78713 0 8.55235 0 8.30755V3.69245C0 3.44765 0.0972465 3.21287 0.270347 3.03977C0.443447 2.86667 0.678221 2.76943 0.923021 2.76943H5.53813V0.461874C5.53805 0.370543 5.56508 0.281244 5.61579 0.205282C5.66649 0.129321 5.7386 0.0701115 5.82297 0.0351509C5.90735 0.000190371 6.0002 -0.00894967 6.08977 0.00888789C6.17934 0.0267255 6.26161 0.0707386 6.32615 0.135355L11.8643 5.67348C11.9072 5.71634 11.9412 5.76724 11.9645 5.82327C11.9877 5.8793 11.9996 5.93935 11.9996 6C11.9996 6.06065 11.9877 6.1207 11.9645 6.17673C11.9412 6.23276 11.9072 6.28366 11.8643 6.32652Z'

/** `p1273f8f0` — the arrow the export draws unrotated (`TRight`, `TDown`). */
const ARROW_GLYPH_PLAIN =
  'M11.8643 6.32652L6.32615 11.8646C6.26161 11.9293 6.17934 11.9733 6.08977 11.9911C6.0002 12.009 5.90735 11.9998 5.82297 11.9648C5.7386 11.9299 5.66649 11.8707 5.61579 11.7947C5.56508 11.7188 5.53805 11.6295 5.53813 11.5381V9.23057H0.923021C0.678221 9.23057 0.443447 9.13333 0.270347 8.96023C0.0972465 8.78713 0 8.55235 0 8.30755V3.69245C0 3.44765 0.0972465 3.21287 0.270347 3.03977C0.443447 2.86667 0.678221 2.76943 0.923021 2.76943H5.53813V0.461874C5.53805 0.370543 5.56508 0.281244 5.61579 0.205282C5.66649 0.129321 5.7386 0.0701115 5.82297 0.0351509C5.90735 0.00019037 6.0002 -0.00894967 6.08977 0.0088879C6.17934 0.0267255 6.26161 0.0707386 6.32615 0.135355L11.8643 5.67348C11.9072 5.71634 11.9412 5.76724 11.9645 5.82327C11.9877 5.8793 11.9996 5.93935 11.9996 6C11.9996 6.06065 11.9877 6.1207 11.9645 6.17673C11.9412 6.23276 11.9072 6.28366 11.8643 6.32652Z'

/** `p2766000` — the stepped 25x25 Enter plate. */
const ENTER_PLATE =
  'M11.542 0C12.6464 0.000175821 13.542 0.895539 13.542 2V8.82324H23C24.1045 8.82324 24.9998 9.7188 25 10.8232V23C25 24.1046 24.1046 25 23 25H2C0.895431 25 4.74303e-07 24.1046 0 23V2C-4.82822e-08 0.895431 0.895431 4.73328e-07 2 0H11.542Z'

/** `p1ec4ca70` — the same plate grown by the 0.5px key border, drawn as a mask edge. */
const ENTER_PLATE_EDGE =
  'M11.542 0L11.5421 -0.5H11.542V0ZM13.542 2H14.042V2H13.542ZM13.542 8.82324H13.042V9.32324H13.542V8.82324ZM25 10.8232H25.5V10.8232L25 10.8232ZM0 23H-0.5V23H0ZM0 2H0.5V2H0ZM2 0V-0.5H2L2 0ZM11.542 0L11.5419 0.5C12.3703 0.500132 13.042 1.17176 13.042 2H13.542H14.042C14.042 0.619317 12.9225 -0.49978 11.5421 -0.5L11.542 0ZM13.542 2H13.042V8.82324H13.542H14.042V2H13.542ZM13.542 8.82324V9.32324H23V8.82324V8.32324H13.542V8.82324ZM23 8.82324V9.32324C23.8283 9.32324 24.4999 9.99489 24.5 10.8233L25 10.8232L25.5 10.8232C25.4998 9.44272 24.3807 8.32324 23 8.32324V8.82324ZM25 10.8232H24.5V23H25H25.5V10.8232H25ZM25 23H24.5C24.5 23.8284 23.8284 24.5 23 24.5V25V25.5C24.3807 25.5 25.5 24.3807 25.5 23H25ZM23 25V24.5H2V25V25.5H23V25ZM2 25V24.5C1.17157 24.5 0.5 23.8284 0.5 23H0H-0.5C-0.499999 24.3807 0.619288 25.5 2 25.5V25ZM0 23H0.5V2H0H-0.5V23H0ZM0 2H0.5C0.5 1.17157 1.17157 0.5 2 0.5L2 0L2 -0.5C0.619289 -0.499999 -0.5 0.619288 -0.5 2H0ZM2 0V0.5H11.542V0V-0.5H2V0Z'

/**
 * The Enter artwork needs a filter and a mask, which SVG can only reference by
 * id. The export reuses Figma's own ids (`filter0_d_1_251`, `path-1-inside-1_1_251`)
 * for every copy of the key; ids must be unique per document, so this file names
 * its own and defines them exactly once per cap.
 */
const ENTER_SHADOW_ID = 're-helper-enter-shadow'
const ENTER_MASK_ID = 're-helper-enter-mask'

/** The design's caption key: `{ keys: ['text'], text: 'ALT', label: 'Boost' }`. */
const TEXT_KEY = 'text'

// ---------------------------------------------------------------------------
// caps
// ---------------------------------------------------------------------------

/**
 * The square cap every key sits on: a 24x24 plate at left 4/top 4 inside the
 * 32px box (`HELPER_BAR.keycapInset` + `HELPER_BAR.keycapInner`), 0.5px
 * `COLOR.keyBorder` and a 1px drop shadow.
 */
function CapPlate() {
  return (
    <div className="absolute bg-[#2a2a2a] border-[#232323] border-[0.5px] border-solid left-[4px] rounded-[6px] shadow-[1px_1px_1px_0px_rgba(0,0,0,0.1)] size-[24px] top-[4px]" />
  )
}

/** The 12x12 arrow, drawn at the cap's centre via the export's `inset-[31.25%]`. */
function ArrowGlyph({ d }: { d: string }) {
  return (
    <svg
      className="absolute block size-full"
      fill="none"
      preserveAspectRatio="none"
      viewBox="0 0 11.9996 12"
    >
      <path d={d} fill={HELPER_BAR.colorGlyph} />
    </svg>
  )
}

/** `TLeft`/`TUp`: the cap whose arrow the design rotates -90°. */
function RotatedArrowCap({ dataName, d }: { dataName: string; d: string }) {
  return (
    <div className="overflow-clip relative shrink-0 size-[32px]" data-name={dataName}>
      <CapPlate />
      <div className="absolute flex inset-[31.25%] items-center justify-center">
        <div className="-rotate-90 flex-none size-[12px]">
          <div className="relative size-full" data-name="Vector">
            <ArrowGlyph d={d} />
          </div>
        </div>
      </div>
    </div>
  )
}

/** `TRight`/`TDown`: the cap whose arrow is used as drawn. */
function PlainArrowCap({ dataName, d }: { dataName: string; d: string }) {
  return (
    <div className="overflow-clip relative shrink-0 size-[32px]" data-name={dataName}>
      <CapPlate />
      <div className="absolute inset-[31.25%]" data-name="Vector">
        <ArrowGlyph d={d} />
      </div>
    </div>
  )
}

/** `TEnter`: the stepped plate with `Enter` printed across its lower half. */
function EnterCap({ text }: { text: string }) {
  return (
    <div className="overflow-clip relative shrink-0 size-[32px]" data-name="T_Enter">
      <div className="absolute flex items-center justify-center left-[4px] size-[25px] top-[4px]">
        {/* The export mirrors the plate horizontally with both a 180° rotation and
            a -1 Y scale; keeping both classes keeps the artwork exactly as drawn. */}
        <div className="-scale-y-100 flex-none rotate-180">
          <div className="relative size-[25px]" data-name="Union">
            <div className="absolute inset-[0_-8%_-8%_0]">
              <svg
                className="block size-full"
                fill="none"
                preserveAspectRatio="none"
                viewBox="0 0 27 27"
              >
                <g filter={`url(#${ENTER_SHADOW_ID})`}>
                  <mask fill="white" id={ENTER_MASK_ID}>
                    <path d={ENTER_PLATE} />
                  </mask>
                  <path d={ENTER_PLATE} fill={COLOR.keyBg} />
                  <path d={ENTER_PLATE_EDGE} fill={COLOR.keyBorder} mask={`url(#${ENTER_MASK_ID})`} />
                </g>
                <defs>
                  <filter
                    colorInterpolationFilters="sRGB"
                    filterUnits="userSpaceOnUse"
                    height="27"
                    id={ENTER_SHADOW_ID}
                    width="27"
                    x="0"
                    y="0"
                  >
                    <feFlood floodOpacity="0" result="BackgroundImageFix" />
                    <feColorMatrix
                      in="SourceAlpha"
                      result="hardAlpha"
                      type="matrix"
                      values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0"
                    />
                    <feOffset dx="1" dy="1" />
                    <feGaussianBlur stdDeviation="0.5" />
                    <feComposite in2="hardAlpha" operator="out" />
                    <feColorMatrix
                      type="matrix"
                      values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.1 0"
                    />
                    <feBlend in2="BackgroundImageFix" mode="normal" result="effect1_dropShadow" />
                    <feBlend in="SourceGraphic" in2="effect1_dropShadow" mode="normal" result="shape" />
                  </filter>
                </defs>
              </svg>
            </div>
          </div>
        </div>
      </div>
      <div className="-translate-x-1/2 -translate-y-1/2 absolute flex flex-col font-['Inter:Semi_Bold_Italic',sans-serif] font-semibold italic justify-center leading-[0] left-[16.5px] text-[#fffffe] text-[10px] text-center top-[21px] tracking-[-0.9px] whitespace-nowrap">
        <p className="leading-[normal]">{text}</p>
      </div>
    </div>
  )
}

/**
 * `TEsc` plus the fallback for every other key: the same square cap with its
 * caption printed on it. Screens can therefore add keys the design never drew
 * (`{ keys: ['tab'], label: 'Cycle' }`) without new artwork.
 */
function TextCap({ dataName, text }: { dataName: string; text: string }) {
  return (
    <div className="overflow-clip relative shrink-0 size-[32px]" data-name={dataName}>
      <CapPlate />
      <div className="-translate-x-1/2 -translate-y-1/2 absolute flex flex-col font-['Inter:Semi_Bold',sans-serif] font-semibold h-[12px] justify-center leading-[0] left-[16px] not-italic text-[#fffffe] text-[10px] text-center top-[16px] w-[18px]">
        <p className="leading-[normal]">{text}</p>
      </div>
    </div>
  )
}

/**
 * One key of a hint group. `left|right|up|down|enter|esc` are the keys the design
 * drew; any other kind (including the design's `text` key) is printed on the
 * standard square cap, so a screen can introduce keys without new artwork.
 */
export function KeyCap({ kind, label }: KeyCapProps) {
  switch (kind) {
    case 'left':
      // TLeft already carries its own -90° arrow; the extra -90° around the cap
      // turns that up-arrow into the left-arrow the design shows.
      return (
        <div className="flex items-center justify-center relative shrink-0 size-[32px]">
          <div className="-rotate-90 flex-none">
            <RotatedArrowCap dataName="T_Left" d={ARROW_GLYPH_ROTATED} />
          </div>
        </div>
      )
    case 'right':
      return <PlainArrowCap dataName="T_Right" d={ARROW_GLYPH_PLAIN} />
    case 'up':
      return <RotatedArrowCap dataName="T_Up" d={ARROW_GLYPH_ROTATED} />
    case 'down':
      return (
        <div className="flex items-center justify-center relative shrink-0 size-[32px]">
          <div className="flex-none rotate-90">
            <PlainArrowCap dataName="T_Down" d={ARROW_GLYPH_PLAIN} />
          </div>
        </div>
      )
    case 'enter':
      return <EnterCap text={label ?? 'Enter'} />
    case 'esc':
      return <TextCap dataName="T_Esc" text={label ?? 'Esc'} />
    default:
      // No artwork for this key: print whatever the caller named it, so a missing
      // label is visible rather than silently blank.
      return <TextCap dataName={kind} text={label ?? kind} />
  }
}

// ---------------------------------------------------------------------------
// bar
// ---------------------------------------------------------------------------

/**
 * `HelperHintLike` in the frozen contract is deliberately loose and drops the
 * design's optional caption, so re-attach it here: `HelperHint` in
 * data/design.ts lets a `text` key carry its own caption
 * (`{ keys: ['text'], text: 'ALT', label: 'Boost' }`). Re-typing the value keeps
 * the field optional — nothing is asserted about hints that omit it.
 */
type HintWithCaption = HelperHintLike & { text?: string }

/**
 * The bottom bar: 1920px wide, `px-[32px] py-[18px]`, content centred, 68px tall
 * (`HELPER_BAR.height`; the inner `input` frame and the extra `px-[32px]` come
 * straight from the export's `Helper`).
 */
export function HelperBar({ hints }: HelperBarProps) {
  return (
    <div
      className="absolute bottom-[-1px] content-stretch flex flex-col h-[68px] items-center justify-center left-0 overflow-clip px-[32px] py-[18px] w-[1920px]"
      data-name="Helper"
    >
      <div
        className="content-stretch flex flex-col items-center justify-center px-[32px] relative shrink-0"
        data-name="input"
      >
        <div className="content-stretch flex gap-[24px] items-start relative shrink-0" data-name="row">
          {hints.map((rawHint, hintIndex) => {
            const hint: HintWithCaption = rawHint
            return (
              <div
                className="content-stretch flex gap-[8px] items-center relative shrink-0"
                key={`${hint.label}-${hintIndex}`}
              >
                {hint.keys.map((kind, keyIndex) => (
                  <KeyCap
                    key={`${kind}-${keyIndex}`}
                    kind={kind}
                    label={kind === TEXT_KEY ? hint.text : undefined}
                  />
                ))}
                <p className="font-['Actor:Regular',sans-serif] leading-none not-italic relative shrink-0 text-[#999] text-[24px] whitespace-nowrap">
                  {hint.label}
                </p>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
