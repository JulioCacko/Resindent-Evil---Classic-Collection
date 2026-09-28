/**
 * The Game Version screen: the design's middle step, one row per version of the
 * selected title plus the 860px info column that follows the selection.
 *
 * Geometry is transcribed from `.ref/designref/src/imports/MainMenuRe1.tsx`
 * rather than re-derived:
 *
 *   :324      the root — `bg-[#0f0f0f] flex gap-[10px] items-start relative size-full`
 *   :169-188  `Body` — `flex-[1_0_0] h-full items-start`, its two `shrink-0` columns
 *   :172-175  the left panel and its `Game Version` heading
 *   :10-50    `Menu` — the `flex flex-col gap-[18px]` list of `btn/menu` rows
 *   :176-178  the 860px info column
 *   :312-320  `Helper` — the 68px bottom bar
 *
 * `MainMenuRe2.tsx` and `MainMenuRe3.tsx` draw the same frame for RE2 and RE3 and
 * differ in exactly one dimension: RE1 and RE2 carry three `btn/menu` rows
 * (MainMenuRe1.tsx:13-47, MainMenuRe2.tsx:13-47) while RE3 carries two
 * (MainMenuRe3.tsx:12-36). That row count is the `ROW_COUNTS` table in
 * @shared/catalog, and it is what the panel is built from below.
 *
 * Two things this screen deliberately does NOT draw, because the shell already
 * does: the backdrop (`Backdrop` is mounted once by App.tsx with the .10 / -40.23
 * the export puts in `Body`, MainMenuRe1.tsx:179-185) and the CRT pass. A second
 * copy of either would blend or scan twice.
 */
import type { ReactNode } from 'react'
import { useShallow } from 'zustand/shallow'

import { ROW_COUNTS } from '@shared/catalog'
import type { TitleId } from '@shared/types'
import { HelperBar } from '@renderer/components/HelperBar'
import { InfoPanel } from '@renderer/components/InfoPanel'
import { VersionRow } from '@renderer/components/VersionRow'
import { currentTitle, currentVersion } from '@renderer/data/derive'
import { HINTS_PANEL, HINTS_VERSION, VERSION_SCREEN } from '@renderer/data/design'
import { LaunchPanel } from '@renderer/overlays/LaunchPanel'
import { useLauncher } from '@renderer/state/store'

/**
 * The export names this frame after the title it was drawn for — "Main Menu / RE
 * 1" at MainMenuRe1.tsx:324, "… / RE 2" at MainMenuRe2.tsx:322, "… / RE 3" at
 * MainMenuRe3.tsx:307 — and this screen is one component serving all three, so
 * the name has to follow the selected title instead of being hard-coded to one of
 * them. The values are the export's own strings, not inventions.
 */
const FRAME_NAME: Record<TitleId, string> = {
  re1: 'Main Menu / RE 1',
  re2: 'Main Menu / RE 2',
  re3: 'Main Menu / RE 3'
}

/**
 * One row's slot in the list column.
 *
 * The frozen `VersionRowProps` carries no `className` and no data attributes, so
 * the per-row `data-figma-node` handle the geometry test looks for has to live on
 * a wrapper. The wrapper therefore reproduces the row's own flex sizing — a
 * `flex-[1_0_0]` item in the list that is itself a column, so the row inside keeps
 * its exact share of the panel — and carries nothing else: it paints no
 * background, adds no radius and no `overflow`, so the pixels inside it are the
 * ones the export draws. It is also left as plain `position: relative` with no
 * `z-index`, because a row's selected state is `mix-blend-exclusion` (see
 * components/VersionRow.tsx) and an isolating layer here would change what that
 * blends against.
 */
function RowSlot({ index, children }: { index: number; children: ReactNode }) {
  return (
    <div
      className="flex flex-[1_0_0] flex-col min-h-px min-w-px relative w-full"
      data-figma-node={`version-row-${index}`}
    >
      {children}
    </div>
  )
}

/**
 * A placeholder row, for when the catalog cannot name any version of the selected
 * title yet — the catalog is still empty (offline), or it reports the title with
 * no validated rows.
 *
 * It is the design's own empty row surface: the export's `bg-[#0f0f0f] …
 * rounded-[8px] w-full` box from `btn/menu` without its art (MainMenuRe1.tsx:13),
 * which is exactly what VersionRow renders when a hero asset is missing. The
 * layout therefore keeps the design's proportions instead of collapsing the
 * column to nothing, and switching titles cannot make the panel jump.
 */
function SkeletonRow() {
  return (
    <div
      className="bg-[#0f0f0f] flex-[1_0_0] min-h-px min-w-px relative rounded-[8px] w-full"
      data-name="skeleton"
    />
  )
}

/**
 * The Game Version screen.
 *
 * No props, per the renderer contract: the selection lives in the store, so this
 * component only reads it and reports gestures back. Keyboard and gamepad input
 * are not handled here either — App.tsx forwards every canonical action to
 * `store.handleAction`, and `resolveIntent` is the single place that decides what
 * an arrow or Enter means on this screen (wrapping up/down through the version
 * list, Confirm opening the launch panel, Back returning to the main menu).
 */
export function VersionSelect() {
  /**
   * `currentVersion` builds a fresh object per call, and a selector that returns a
   * new object on every read makes zustand's `useSyncExternalStore` re-render
   * forever, so it is read through `useShallow`: the previous object is kept while
   * the version, mode and scenario are unchanged. `currentTitle` and every field
   * below are stable references the catalog and the store already own.
   */
  const title = useLauncher(currentTitle)
  const current = useLauncher(useShallow(currentVersion))
  const titleId = useLauncher((state) => state.titleId)
  const panelOpen = useLauncher((state) => state.panelOpen)
  const panelOptionIndex = useLauncher((state) => state.panelOptionIndex)
  const busy = useLauncher((state) => state.busy)

  const setVersionIndex = useLauncher((state) => state.setVersionIndex)
  const openPanel = useLauncher((state) => state.openPanel)
  const setPanelOption = useLauncher((state) => state.setPanelOption)
  const setMode = useLauncher((state) => state.setMode)
  const setScenario = useLauncher((state) => state.setScenario)
  const launch = useLauncher((state) => state.launch)
  const closePanel = useLauncher((state) => state.closePanel)
  const openSettings = useLauncher((state) => state.openSettings)

  const versions = title?.versions ?? []

  /**
   * How many rows the panel draws, and therefore how the list's height is divided.
   *
   * A title with catalog rows uses their count — that is the design's own rule:
   * `flex-[1_0_0]` shares the list's 952px of content area (1080 - 56 top - 72
   * bottom) between however many rows the title has, which is why RE3's two rows
   * are far taller than RE1's three. The legacy launcher divided the same area the
   * same way (`git show HEAD:src/ui/screens/screen_version.cpp`, `Draw`:
   * `rowH = (listH - totalGaps) / nv`), so the row count really is what the layout
   * follows.
   *
   * With no rows to count, the design's `ROW_COUNTS` table is the only honest
   * answer left: the skeleton list then fills exactly the space the validated
   * title will fill, instead of collapsing the column and letting the info panel
   * jump when the catalog lands.
   */
  const rowCount = versions.length > 0 ? versions.length : ROW_COUNTS[titleId]

  /**
   * Which row reads as selected. This is `versionIndex` folded exactly as
   * `versionAt` folds it (data/derive.ts) — comparing the *resolved* row rather
   * than the raw index means the highlight can never point at a different row than
   * the info panel and the launch panel are showing, not even for the one render
   * after a catalog refresh shrinks a title's list.
   */
  const selectedVersionId = current?.version.id ?? null

  const rows =
    versions.length > 0 ? (
      versions.map((version, index) => (
        <RowSlot index={index} key={version.id}>
          <VersionRow
            version={version}
            selected={version.id === selectedVersionId}
            // Hover selects: the design's info column follows the pointer
            // (VersionSelectPage.tsx:62-84 sets the index from the row under the
            // click, and the row's own hover path is what makes the panel track the
            // cursor rather than the last click).
            onHover={() => {
              setVersionIndex(index)
            }}
            // Confirm steps forward to the launch panel, which is the design's
            // Enter -> next step (VersionSelectPage.tsx:47-49). The index is set
            // before opening so that a row activated without a preceding hover
            // still opens the panel for *this* row: the panel reads
            // `currentVersion`, i.e. the store's selection, so a stale index would
            // show one row's options over another row's art.
            onActivate={() => {
              setVersionIndex(index)
              openPanel()
            }}
          />
        </RowSlot>
      ))
    ) : (
      // The position is the only identity a placeholder has — there is no version
      // to key it by — and the count is fixed for the title being drawn, so an
      // index-derived key is stable for as long as the skeleton list is on screen.
      Array.from({ length: rowCount }, (_, index) => (
        <RowSlot index={index} key={`skeleton-${index}`}>
          <SkeletonRow />
        </RowSlot>
      ))
    )

  return (
    <div
      className="bg-[#0f0f0f] content-stretch flex gap-[10px] items-start relative size-full"
      data-figma-node="version-screen"
      data-name={FRAME_NAME[titleId]}
    >
      {/*
        `Body` (MainMenuRe1.tsx:169-188). The export's third child of this row is
        the flipped hard-light backdrop; it is omitted because App.tsx mounts the
        one `Backdrop` the stage has, and the export's own copy is pinned with
        `bottom-[-40.23px]` there (BACKDROP.bottomOffset) — drawing a second would
        blend the photograph into itself.
      */}
      <div
        className="content-stretch flex flex-[1_0_0] h-full items-start min-h-px min-w-px relative"
        data-name="body"
      >
        <div
          className="bg-[#0f0f0f] content-stretch flex flex-col gap-[32px] h-[1080px] items-start pb-[72px] pt-[56px] px-[32px] relative shrink-0 w-[1060px]"
          data-figma-node="game-version-panel"
          data-name="game-version"
        >
          {/*
            The heading keeps the export's `<p>` (`MainMenuRe1.tsx:173`): its
            classes are the design's, and only the text comes from
            `VERSION_SCREEN.headingLabel` so the screen and the geometry test
            cannot disagree about the wording.
          */}
          <p
            className="font-['Actor:Regular',sans-serif] leading-[normal] not-italic relative shrink-0 text-[#ccc] text-[32px] text-center whitespace-nowrap"
            data-figma-node="game-version-heading"
          >
            {VERSION_SCREEN.headingLabel}
          </p>

          {/*
            `Menu` (MainMenuRe1.tsx:12): `flex-[1_0_0]` so the list takes the whole
            952px the panel's padding leaves (1080 - 56 top - 72 bottom) and
            `gap-[18px]` between rows (VERSION_SCREEN.rowGap). `data-row-count`
            states the count the layout was divided by, which is what makes a
            switch between a two-row and a three-row title explainable from the DOM
            alone.
          */}
          <div
            className="content-stretch flex flex-[1_0_0] flex-col gap-[18px] items-start min-h-px min-w-px relative w-full"
            data-figma-node="version-list"
            data-name="menu"
            data-row-count={rowCount}
          >
            {rows}
          </div>
        </div>

        {/*
          The info column. The export has two elements here — the 860x1080 clipping
          box named `info` (MainMenuRe1.tsx:176) and the panel inside it — and
          components/InfoPanel.tsx is the inner one, so this wrapper restores the
          export's own outer box: it is the only place the geometry test's
          `info-panel` handle can go, since `InfoPanelProps` carries no className.
          It is the same box (`h-[1080px] overflow-clip relative shrink-0
          w-[860px]`), so the nesting costs no pixel.

          With no resolved version — an empty catalog, or a title the main process
          reported with no validated rows — the box stays and stays empty: the
          screen keeps the design's two-column geometry rather than letting the list
          grow into art that does not exist.
        */}
        <div
          className="h-[1080px] overflow-clip relative shrink-0 w-[860px]"
          data-figma-node="info-panel"
          data-name="info"
        >
          {current === null ? null : (
            /**
             * The launch panel is handed over as `children`, which is the slot
             * `InfoPanelProps.children` documents ("Rendered above the info block,
             * used by the launch panel") and the reason `overlays/LaunchPanel.tsx`
             * is a flow-positioned, full-width box: the panel slot is a
             * `justify-end` column, so the panel docks against the bottom edge of
             * the column and grows upward. It is mounted only while it is open,
             * which is what keeps this screen pixel-identical at rest.
             *
             * NOTE for whoever owns App.tsx: that shell also renders a `LaunchPanel`
             * directly under `<Stage>` while `panelOpen` is true. A panel mounted
             * there is out of flow at the stage's top-left, 1920px wide, i.e. it
             * covers the whole version list rather than docking here, and with this
             * one in place the open panel would be drawn twice. The docking copy is
             * the one the frozen contract and this screen's layout ask for; the
             * stage-level one is the duplicate.
             */
            <InfoPanel version={current.version}>
              {panelOpen ? (
                <LaunchPanel
                  version={current.version}
                  mode={current.mode}
                  scenario={current.scenario}
                  optionIndex={panelOptionIndex}
                  busy={busy}
                  onSelectOption={setPanelOption}
                  // The store's setters persist through IPC and are therefore async;
                  // the props are `void`-returning gestures, so the promise is
                  // discarded explicitly rather than left floating.
                  onSetMode={(mode) => {
                    void setMode(mode)
                  }}
                  onSetScenario={(scenario) => {
                    void setScenario(scenario)
                  }}
                  onLaunch={() => {
                    void launch()
                  }}
                  onOpenSettings={openSettings}
                  onClose={closePanel}
                />
              ) : null}
            </InfoPanel>
          )}
        </div>
      </div>

      {/*
        The helper bar, and the two things its wrapper has to get right.

        1. Position. `HelperBar` positions itself with `bottom-[-1px]` — the
           export's own `Helper` (MainMenuRe1.tsx:314) hangs the bar one pixel below
           the frame's bottom edge, so the bar's content box is 1013..1081 on the
           1080px canvas. This wrapper's bottom edge is the canvas bottom (1012..1080
           for its own 68px), so the bar inside lands at exactly the export's
           1013..1081 while the wrapper measures the design's stated bar box
           (`HELPER_BAR.height`, flush to `CANVAS.height`) for the geometry test.
        2. Flow. It is `absolute`, so it is out of flow and creates no flex item and
           no 10px gap in the root (`gap-[10px]`, MainMenuRe1.tsx:324) — the export's
           `Helper` is absolute for the same reason, and in-flow it would steal width
           from `Body` and shift the info column off x=1060.

        `pointer-events-none` because the launch panel docks to the bottom of the
        info column and therefore reaches into this band; a wrapper that swallowed
        pointer events would make the panel's lower rows unclickable.
      */}
      <div
        className="absolute bottom-0 h-[68px] left-0 pointer-events-none w-[1920px]"
        data-figma-node="helper-bar"
      >
        {/*
          Change keys while the panel is up, Navigate while it is not — the two
          hint sets the export's version screens use (`HINTS_VERSION`) and that this
          screen's panel needs (`HINTS_PANEL`), both from data/design.ts so the bar
          and the input layer cannot describe different things.
        */}
        <HelperBar hints={panelOpen ? HINTS_PANEL : HINTS_VERSION} />
      </div>
    </div>
  )
}

export default VersionSelect
