/**
 * Interaction E2E: the whole flow, driven by synthetic input and asserted on
 * observable state.
 *
 * Two rules shape this file.
 *
 * **Assert state, not internals.** Nothing here reads the store, calls an action
 * or inspects React. Every expectation is something a user could see: which cover
 * reports itself as pressed (`aria-pressed`, set by `components/GameCard.tsx`),
 * the design's own selected chrome (the 1.02 card scale, the 8.5px selection
 * radius on the row under the cursor), whether the launch panel is mounted, and
 * which screen is up. That is also what makes the suite survive the refactor it is
 * meant to protect: the flow is driven through the same window-level action layer
 * the user drives (`input/useActions.ts` → `store.handleAction`).
 *
 * **Every flow is reachable and bounded.** The design's navigation rules are the
 * ones asserted — the main menu *clamps* at both ends
 * (`.ref/designref/src/app/components/MainMenuPage.tsx:25-26`) while the version
 * list *wraps* (`.ref/designref/src/app/components/VersionSelectPage.tsx:41-46`) —
 * so a wrap or a clamp that changed would show up here as a navigation that went
 * somewhere else. Each test first asks the harness where it is (`ensureMenu`) and
 * skips with a reason when the catalog is empty, because a renderer with no
 * `window.reLauncher` draws its empty-catalog screen rather than hanging.
 */
import { expect, test } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

import { MAIN_MENU } from '../../src/renderer/src/data/design'
import {
  NODES,
  PAD,
  captureScreenshot,
  cardCount,
  clampMenuToFirstCard,
  closeApp,
  ensureMenu,
  installFakeGamepad,
  launchApp,
  padPress,
  press,
  probe,
  scaleFactor,
  selectedCardIndex,
  selectedVersionRowIndex,
  setDesignWindow,
  styles,
  waitForPanel,
  waitForScreen,
  waitUntil,
  versionRowCount
} from './electron-app'
import type { AppHandle } from './electron-app'

/** The pad's own settle before the first press, past its keyboard device lock. */
const PAD_WARMUP_MS = 300

function expectWithin(measured: number, expected: number, tolerance: number, what: string): void {
  expect(
    Math.abs(measured - expected),
    `${what}: expected ${expected} ± ${tolerance}, measured ${measured}`
  ).toBeLessThanOrEqual(tolerance)
}

/** The cover element inside a card wrapper: the one that carries the selected state. */
function cardSurface(page: Page, index: number): Locator {
  return page.locator('[data-figma-node^="card-"]').nth(index).locator('[role="button"]').first()
}

/** The scale a card is painted at — 1, or the design's 1.02 while selected. */
async function cardScale(page: Page, index: number): Promise<number> {
  return scaleFactor(await styles(page, NODES.menuCardSurface, index))
}

/** One app for the file; the launcher holds a single-instance lock. */
let shared: AppHandle | undefined

async function sharedApp(): Promise<AppHandle> {
  if (shared === undefined) shared = await launchApp()
  return shared
}

test.afterAll(async () => {
  if (shared !== undefined) await closeApp(shared)
})

test.describe('the launcher flow', () => {
  test('keyboard: menu selection, the version list, the launch panel and Back', async ({}, testInfo) => {
    const { app, page } = await sharedApp()
    await setDesignWindow(app, page)
    await ensureMenu(page)

    const cards = await cardCount(page)
    test.skip(cards === 0, 'the catalog is empty: there is no card to navigate and no title to enter')

    // --- the main menu -------------------------------------------------------
    //
    // The menu clamps instead of wrapping: `Math.max(0, s - 1)` for Left and
    // `Math.min(2, s + 1)` for Right (MainMenuPage.tsx:25-26, mirrored by
    // `moveMenu` in state/store.ts). ArrowLeft on the first card therefore moves
    // nothing — the assertion is that the selection is *still* the first card.
    await clampMenuToFirstCard(page)
    expect(await selectedCardIndex(page), 'ArrowLeft at index 0 clamps instead of wrapping').toBe(0)
    await captureScreenshot(page, testInfo, 'flow-1-menu-first-card')

    // ArrowRight moves the cursor, and the card it lands on carries the design's
    // selected state: `aria-pressed` for the observable fact, and the 1.02 scale
    // the export draws (MainMenuPage.tsx:122, MAIN_MENU.card.selectedScale) for the
    // visual one. The card that lost the cursor must go back to 1.
    //
    // The scale is read through the same retry, because the card animates into it:
    // the export gives the cover `transition-transform` over `card.transitionMs`
    // (200ms), so an immediate read catches an intermediate matrix.
    await press(page, 'ArrowRight')
    await waitUntil(() => selectedCardIndex(page), (index) => index === 1, {
      label: 'ArrowRight to select the second card'
    })
    expect(await cardSurface(page, 1).getAttribute('aria-pressed'), 'the second card is pressed').toBe('true')
    expect(await cardSurface(page, 0).getAttribute('aria-pressed'), 'the first card is not pressed').toBe('false')
    const selectedScale = await waitUntil(
      () => cardScale(page, 1),
      (scale) => Math.abs(scale - MAIN_MENU.card.selectedScale) < 0.001,
      { label: `the selected card to reach the design's ${String(MAIN_MENU.card.selectedScale)} scale` }
    )
    expectWithin(selectedScale, MAIN_MENU.card.selectedScale, 0.001, 'the selected card is scaled 1.02')
    const releasedScale = await waitUntil(() => cardScale(page, 0), (scale) => Math.abs(scale - 1) < 0.001, {
      label: 'the previously selected card to settle back to 1'
    })
    expectWithin(releasedScale, 1, 0.001, 'the unselected card is not scaled')
    await captureScreenshot(page, testInfo, 'flow-2-menu-second-card')

    // --- Enter opens the version screen --------------------------------------
    await press(page, 'Enter')
    await waitForScreen(page, 'version')
    await captureScreenshot(page, testInfo, 'flow-3-version-screen')

    // --- the version list wraps at both ends ---------------------------------
    //
    // `(i + 1) % total` downwards, `(i - 1 + total) % total` upwards
    // (VersionSelectPage.tsx:42,45 → `moveVersion` in state/store.ts). Entering a
    // title mounts its first row (`goToVersion(titleId, 0)`), which is what the
    // first assertion establishes before walking down the list.
    const rowCount = await versionRowCount(page)
    expect(rowCount, 'the version list has more than one row').toBeGreaterThan(1)
    await waitUntil(() => selectedVersionRowIndex(page), (index) => index === 0, {
      label: 'the first row to be selected on entering the title'
    })
    for (let step = 1; step < rowCount; step += 1) {
      await press(page, 'ArrowDown')
    }
    await waitUntil(() => selectedVersionRowIndex(page), (index) => index === rowCount - 1, {
      label: `ArrowDown to walk to the last of ${String(rowCount)} rows`
    })
    await press(page, 'ArrowDown')
    await waitUntil(() => selectedVersionRowIndex(page), (index) => index === 0, {
      label: 'ArrowDown to wrap from the last row to the first'
    })
    await press(page, 'ArrowUp')
    await waitUntil(() => selectedVersionRowIndex(page), (index) => index === rowCount - 1, {
      label: 'ArrowUp to wrap backwards to the last row'
    })

    // --- Enter opens the launch panel ---------------------------------------
    await press(page, 'Enter')
    await waitForPanel(page)
    const opened = await probe(page)
    expect(opened.screen, 'opening the panel stays on the version screen').toBe('version')
    expect(opened.panelOpen, 'the launch panel is mounted').toBe(true)
    await captureScreenshot(page, testInfo, 'flow-4-launch-panel')

    // --- Escape closes the panel and stays on the version screen -------------
    await press(page, 'Escape')
    await waitUntil(() => probe(page), (state) => !state.panelOpen, {
      label: 'Escape to close the launch panel'
    })
    expect((await probe(page)).screen, 'closing the panel stays on the version screen').toBe('version')

    // --- re-open, close, and then Back out to the menu ------------------------
    //
    // One Escape belongs to the panel and the next one to the screen, which is the
    // legacy `ScreenLaunch` pop followed by the screen's own Back
    // (`git show HEAD:src/ui/screens/screen_launch.cpp`, `OnInput`).
    await press(page, 'Enter')
    await waitForPanel(page)
    await press(page, 'Escape')
    await waitUntil(() => probe(page), (state) => !state.panelOpen, {
      label: 'Escape to close the reopened panel'
    })
    await press(page, 'Escape')
    await waitForScreen(page, 'menu')
    await captureScreenshot(page, testInfo, 'flow-5-back-at-the-menu')

    // The cursor came back to the title the user entered (`goToMenu` restores it)
    // and the menu still clamps: the round trip changed nothing about its ends.
    await clampMenuToFirstCard(page)
    expect(await selectedCardIndex(page), 'ArrowLeft past the first card still does not wrap').toBe(0)
  })

  test('gamepad: the D-pad navigates and A/B confirm and go back', async ({}, testInfo) => {
    const { app, page } = await sharedApp()
    await setDesignWindow(app, page)

    // The pad is injected and the page reloaded onto it, because an init script
    // only reaches documents created after it was registered and the Electron
    // window loads before Playwright can talk to it.
    await installFakeGamepad(page)
    await ensureMenu(page)

    const cards = await cardCount(page)
    test.skip(cards === 0, 'the catalog is empty: there is no card to navigate and no title to enter')

    // `useGamepad.ts` ignores pad input for 200ms after a keyboard action, and
    // `ensureMenu` may have had to press Enter to leave the install screen. The
    // wait is that lock, plus a margin for the poll loop's own frame.
    await page.waitForTimeout(PAD_WARMUP_MS)

    // --- the D-pad drives the same navigation the arrow keys do ---------------
    //
    // The D-pad is buttons 12..15 of the standard mapping (input/actions.ts
    // `GAMEPAD_BUTTON_ACTIONS`), and left clamps on the menu exactly as ArrowLeft
    // does, so pressing it more often than there are cards still lands on the
    // first one.
    for (let step = 0; step < 3; step += 1) {
      await padPress(page, PAD.left)
    }
    await waitUntil(() => selectedCardIndex(page), (index) => index === 0, {
      label: 'the D-pad to clamp the cursor on the first card'
    })

    await padPress(page, PAD.right)
    await waitUntil(() => selectedCardIndex(page), (index) => index === 1, {
      label: 'the D-pad to select the second card'
    })
    expect(await cardSurface(page, 1).getAttribute('aria-pressed'), 'the pad-selected card is pressed').toBe('true')
    const padScale = await waitUntil(
      () => cardScale(page, 1),
      (scale) => Math.abs(scale - MAIN_MENU.card.selectedScale) < 0.001,
      { label: "the pad-selected card to reach the design's 1.02 scale" }
    )
    expectWithin(
      padScale,
      MAIN_MENU.card.selectedScale,
      0.001,
      'the pad-selected card is scaled 1.02 like the keyboard selection'
    )
    await captureScreenshot(page, testInfo, 'gamepad-1-menu-second-card')

    // --- A confirms, B goes back --------------------------------------------
    //
    // The same two actions the helper bar promises ("Enter Confirm" / "Esc Back"
    // in MainMenu.tsx:233-296), produced by the pad's A and B buttons instead.
    await padPress(page, PAD.confirm)
    await waitForScreen(page, 'version')

    await padPress(page, PAD.back)
    await waitForScreen(page, 'menu')
    await captureScreenshot(page, testInfo, 'gamepad-2-back-at-the-menu')
  })
})
