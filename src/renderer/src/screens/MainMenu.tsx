/**
 * The main menu: the wordmark lockup, the three cover cards and the copyright
 * line, on a fixed 1920x1080 body, closed by the helper bar.
 *
 * Every class string below is transcribed from the Figma export rather than
 * re-derived, from the two files that draw the same frame:
 *
 *   `.ref/designref/src/imports/MainMenu.tsx`
 *      the static frame — `Body` (183-187), `Left` (169-179), `Menu` (124-167),
 *      `Helper` (311-319) — which is the ground truth for geometry.
 *   `.ref/designref/src/app/components/MainMenuPage.tsx`
 *      the interactive version of the same frame, whose card box and `games`
 *      array (9-13, 117-153) are what this screen substitutes catalog state for.
 *
 * Two things are deliberately *not* drawn here:
 *
 *  - the backdrop. `App` renders it for every screen, because it is the only
 *    layer whose opacity differs between the main menu (.20) and the screens
 *    below it (.10) — see components/Backdrop.tsx and data/design.ts BACKDROP.
 *  - input. `App` owns `useActions` and forwards the canonical action set to the
 *    store's `handleAction`, so this screen wires no key, pad or wheel handler;
 *    the design's own page does its own `keydown` listener (MainMenuPage.tsx:23-31)
 *    and that responsibility has moved up to the shell.
 *
 * `data-figma-node` names mark the elements `tests/e2e/geometry.spec.ts` measures
 * against the design. Three of them can only sit on a wrapper, because the
 * components they wrap take no data attributes by contract:
 *
 *   logo        components/LogoBlock takes only `className`; the wrapper is the
 *               export's own `Logo` box (MainMenu.tsx:127), so it measures the
 *               design's 625.021 x 250 either way.
 *   card-0..2   components/GameCard takes exactly the frozen `GameCardProps`.
 *               The wrapper repeats the exported card box (`h-[580px] w-[380px]
 *               shrink-0`, MainMenu.tsx:132) but *not* the selected card's
 *               `scale(1.02)` — that transition stays on the card, so the node
 *               the test measures is always the design's 380x580 box whether or
 *               not the card under the cursor is the enlarged one.
 *   helper-bar  components/HelperBar takes only `hints`. The wrapper is an
 *               `absolute bottom-0` 1920x68 box, which is also a containing block
 *               for the bar inside it: the bar keeps its exported
 *               `bottom-[-1px] left-0 w-[1920px]` (MainMenu.tsx:313) and therefore
 *               lands 1013..1081 — the exact position the export draws it in.
 */
import type { GameTitle } from '@shared/types'

import { GameCard, GameCardSkeleton } from '@renderer/components/GameCard'
import { HelperBar } from '@renderer/components/HelperBar'
import { LogoBlock } from '@renderer/components/LogoBlock'
import { HINTS_MENU, MAIN_MENU } from '@renderer/data/design'
import { useLauncher } from '@renderer/state/store'

/**
 * The three card slots the frame draws. Used only while there is no catalog to
 * map over: the design's row is three 380x580 covers, and a skeleton is the same
 * box (components/GameCard, `GameCardSkeleton`), so the 616px row and every gap
 * in it survive the load without reflowing.
 */
const SKELETON_SLOTS: readonly number[] = [0, 1, 2]

export function MainMenu() {
  /**
   * `catalog` is null only before the first snapshot resolves, and `App` draws
   * nothing but the canvas until `ready` — which `init()` sets in the same store
   * update as the catalog. So the null branch below is the defensive one: a
   * refresh that clears the catalog must not empty the menu or collapse its row.
   */
  const catalog = useLauncher((state) => state.catalog)
  const menuIndex = useLauncher((state) => state.menuIndex)
  const setMenuIndex = useLauncher((state) => state.setMenuIndex)
  const goToVersion = useLauncher((state) => state.goToVersion)

  // `catalog.titles` always holds the three titles in frame order (re1, re2,
  // re3); `@shared/catalog` is the single source of that order.
  const titles: readonly GameTitle[] = catalog?.titles ?? []

  /**
   * Opening a cover. The design's `handleConfirm` navigates to
   * `/${games[selected].id}` (MainMenuPage.tsx:19-21), which is this launcher's
   * "enter that title's version list at its first row" — `goToVersion(id, 0)`.
   *
   * The index comes from the card and not from `menuIndex`: a pointer can enter
   * and click in one gesture, and `GameCard` runs `onHover` before `onActivate`
   * for exactly that reason (GameCard.tsx:52-57), so the two agree by
   * construction instead of by a render having landed in between.
   */
  const activate = (index: number): void => {
    const title = titles.at(index)
    // A click that outlives a catalog refresh names a cover that is no longer on
    // screen; doing nothing beats entering a title the frame is not showing.
    if (title === undefined) return
    goToVersion(title.id, 0)
  }

  return (
    <div
      className="bg-[#0f0f0f] relative size-full"
      data-name="Main Menu"
      data-figma-node="main-menu"
    >
      {/* `Body`: the whole screen is one 1920x1080 layer anchored at the canvas
          origin (MainMenu.tsx:183). It is fixed rather than responsive because
          the Stage already renders at design size and scales the result. */}
      <div
        className="absolute content-stretch flex h-[1080px] items-start left-0 top-0 w-[1920px]"
        data-name="body"
      >
        <div className="flex-[1_0_0] h-full min-h-px min-w-px relative" data-name="left">
          <div className="flex flex-col justify-center size-full">
            {/* The padded column: 56px above, 72px below, 32px at the sides, so the
                content box is 1856x952 — which is exactly what the three stacked
                blocks and their two 32px gaps need. */}
            <div className="content-stretch flex flex-col items-start justify-center pb-[72px] pt-[56px] px-[32px] relative size-full">
              <div
                className="content-stretch flex flex-[1_0_0] flex-col gap-[32px] items-center min-h-px min-w-px relative w-full"
                data-name="menu"
              >
                {/* The export's `Logo` node (MainMenu.tsx:127). `LogoBlock` draws the
                    wordmark and badge that fill it; keeping the box here as well is
                    what gives the geometry test a self-contained 625.021x250 node. */}
                <div
                  className="h-[250px] relative shrink-0 w-[625.021px]"
                  data-name="Logo"
                  data-figma-node="logo"
                >
                  <LogoBlock />
                </div>

                {/* `game select` (MainMenu.tsx:131): a 616px-tall row, centred, whose
                    380x580 covers are separated by 48px. The row's own height is fixed
                    so it cannot move when the cards' art loads. */}
                <div
                  className="content-stretch flex gap-[48px] h-[616px] items-center justify-center relative shrink-0 w-full"
                  data-name="game select"
                  // Not `card-row`: the E2E harness resolves the covers with
                  // `[data-figma-node^="card-"]`, and a row hook sharing that
                  // prefix would be counted as a fourth card and would also
                  // answer "which card is selected?" for its pressed descendant.
                  data-figma-node="game-select-row"
                >
                  {catalog === null
                    ? SKELETON_SLOTS.map((slot) => (
                        <div
                          className="h-[580px] shrink-0 w-[380px]"
                          data-name="btn/main-menu"
                          data-figma-node={`card-${slot}`}
                          key={`skeleton-${slot}`}
                        >
                          <GameCardSkeleton selected={slot === menuIndex} />
                        </div>
                      ))
                    : titles.map((title, index) => (
                        <div
                          className="h-[580px] shrink-0 w-[380px]"
                          data-name="btn/main-menu"
                          data-figma-node={`card-${index}`}
                          // The title id, not the index: a catalog refresh can
                          // reorder the row without remounting the covers.
                          key={title.id}
                        >
                          <GameCard
                            index={index}
                            title={title}
                            // Selection is the store's `menuIndex`, which the shell's
                            // arrow keys move through `handleAction` and a hover moves
                            // through `setMenuIndex` — one selection, two pointers.
                            selected={index === menuIndex}
                            onHover={setMenuIndex}
                            onActivate={activate}
                          />
                        </div>
                      ))}
                </div>

                {/* The design letter-cases the line in CSS (`uppercase`); the source
                    string in data/design.ts keeps the concept's own casing, which is
                    why the copyright text is read from the design module and not
                    re-typed here. */}
                <p
                  className="font-['Actor:Regular',sans-serif] leading-[normal] not-italic relative shrink-0 text-[#999] text-[18px] uppercase whitespace-nowrap"
                  data-figma-node="copyright"
                >
                  {MAIN_MENU.copyright.text}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* The helper bar. `HINTS_MENU` is the design's own set for this frame:
          left/right Navigate, Enter Confirm, Esc Back (data/design.ts). */}
      <div
        className="absolute bottom-0 left-0 h-[68px] w-[1920px]"
        data-figma-node="helper-bar"
      >
        <HelperBar hints={HINTS_MENU} />
      </div>
    </div>
  )
}

export default MainMenu
