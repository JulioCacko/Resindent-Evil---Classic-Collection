/**
 * One 380x580 cover card on the main menu.
 *
 * Every class string below is transcribed verbatim from the Figma export:
 * `.ref/designref/src/app/components/MainMenuPage.tsx` lines 118-152 (the
 * `games.map` block, which branches on the selected index) and the static
 * variant `.ref/designref/src/imports/MainMenu.tsx` `Menu()` lines 132-162.
 * The export literally writes the selected card (RE1) with the
 * exclusion-blend glow layers and the unselected cards (RE2/RE3) with the dim
 * layer and no glow, so that difference is exactly what `selected` drives.
 *
 * The card itself is `relative` and *not* `overflow-clip`: the selected state
 * draws an 8.5px-radius border half a pixel outside the card box
 * (MainMenuPage.tsx:148), which a clip on the card would cut away. Only the
 * inner art wrapper — `overflow-clip rounded-[inherit] size-full` — clips, which
 * is how the cover art keeps the card's 8px corners.
 *
 * Accessibility: the three covers are one mutually exclusive choice drawn as
 * buttons, so the exported markup gains `role="button"`, `tabIndex={0}` and
 * `aria-pressed` — the latter is what tells a screen reader which cover is
 * currently selected, since nothing in the design is visible text.
 */
import type { GameCardProps } from '@renderer/contracts'
import { assetUrl } from '@renderer/data/assets'
import { MAIN_MENU } from '@renderer/data/design'

export function GameCard({ index, title, selected, onHover, onActivate }: GameCardProps) {
  const artUrl = assetUrl(title.cardAsset)

  /**
   * RE3 is the only cover whose art carries its own corner radius: the export's
   * games array sets `rounded: true` on the third entry (MainMenuPage.tsx:12) and
   * applies `rounded-[15.795px]` to that image only (imports/MainMenu.tsx:155-156).
   * The prop set has no `rounded` flag, so the flag is resolved from the title id.
   */
  const artRounded = title.id === 're3'

  // The export scales the selected card around its centre (MainMenuPage.tsx:122);
  // the factor lives in data/design.ts so the geometry test and the component
  // cannot disagree about it.
  const scale = selected ? MAIN_MENU.card.selectedScale : 1

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={title.name}
      aria-pressed={selected}
      className="bg-[#0f0f0f] h-[580px] relative rounded-[8px] shrink-0 w-[380px] cursor-pointer transition-transform duration-200"
      style={{ transform: `scale(${scale})` }}
      onMouseEnter={() => onHover(index)}
      onClick={() => {
        // Hover first, then activate: the store's `menuIndex` must already point
        // at this card when `onActivate` runs, exactly as it does for the pointer.
        onHover(index)
        onActivate(index)
      }}
      // No `onKeyDown` here on purpose. `App` installs the one window-level action
      // layer (`input/useActions.ts` -> `store.handleAction`) and the contract calls
      // it the single interpreter of the canonical action set, so a component that
      // also acted on Enter would run the same intent twice: the second pass reads
      // the state the first pass just changed, which turns one Enter on the menu into
      // "open the version screen" *and* "open the launch panel". That is a race, not
      // a feature - it made the E2E keyboard spec fail intermittently.
    >
      <div className="overflow-clip relative rounded-[inherit] size-full">
        <div className="-translate-y-1/2 absolute h-[580px] left-0 right-0 top-1/2">
          {/*
            `assetUrl` returns '' for an unknown key; rendering no <img> at all
            keeps a bad key from drawing the title's alt text as a broken-image
            placeholder over the card, while the positioning layer stays in place
            so nothing about the layout changes.
          */}
          {artUrl === '' ? null : (
            <img
              alt={title.name}
              className={`absolute inset-0 max-w-none object-cover pointer-events-none size-full${
                artRounded ? ' rounded-[15.795px]' : ''
              }`}
              src={artUrl}
            />
          )}
        </div>
        {selected ? (
          <div className="absolute bg-[#0f0f0f] inset-0 mix-blend-exclusion pointer-events-none">
            <div
              aria-hidden="true"
              className="absolute border border-[#4d4d4d] border-solid inset-[-0.5px]"
            />
            <div className="absolute inset-[-0.5px] rounded-[inherit] shadow-[inset_0px_0px_36px_0px_rgba(255,255,255,0.25)]" />
          </div>
        ) : (
          <div className="absolute bg-[#0f0f0f] inset-0 opacity-60">
            <div
              aria-hidden="true"
              className="absolute border border-[#4d4d4d] border-solid inset-[-0.5px] pointer-events-none"
            />
          </div>
        )}
      </div>
      {selected ? (
        <>
          {/* Zero-alpha in the export, but drawn: it reserves the glow layer the
              design keeps behind the selection border. */}
          <div className="absolute inset-[-0.5px] pointer-events-none rounded-[inherit] shadow-[inset_0px_4px_36px_0px_rgba(255,255,255,0)]" />
          <div
            aria-hidden="true"
            className="absolute border border-[#4d4d4d] border-solid inset-[-0.5px] pointer-events-none rounded-[8.5px]"
          />
        </>
      ) : null}
    </div>
  )
}

export interface GameCardSkeletonProps {
  /** Mirrors the real card's selected chrome so the row does not jump on load. */
  selected?: boolean
}

/**
 * Placeholder for the menu while the catalog round-trips to the main process.
 *
 * It reproduces the real card's box, radius and border layers from
 * MainMenuPage.tsx so the three-card row occupies exactly the same space whether
 * or not the catalog has resolved — only the art and the interaction are gone.
 * `aria-hidden` keeps an empty box out of the accessibility tree, whose contents
 * are announced once the real cards mount.
 */
export function GameCardSkeleton({ selected = false }: GameCardSkeletonProps) {
  return (
    <div
      aria-hidden="true"
      className="bg-[#0f0f0f] h-[580px] relative rounded-[8px] shrink-0 w-[380px]"
    >
      <div className="overflow-clip relative rounded-[inherit] size-full">
        {selected ? (
          <div className="absolute bg-[#0f0f0f] inset-0 mix-blend-exclusion pointer-events-none">
            <div className="absolute border border-[#4d4d4d] border-solid inset-[-0.5px]" />
            <div className="absolute inset-[-0.5px] rounded-[inherit] shadow-[inset_0px_0px_36px_0px_rgba(255,255,255,0.25)]" />
          </div>
        ) : (
          <div className="absolute bg-[#0f0f0f] inset-0 opacity-60">
            <div className="absolute border border-[#4d4d4d] border-solid inset-[-0.5px] pointer-events-none" />
          </div>
        )}
      </div>
    </div>
  )
}
