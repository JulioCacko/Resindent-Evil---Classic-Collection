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
  panelRowNames,
  press,
  probe,
  rect,
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

  /**
   * The gameplay screen after a launch, hermetically.
   *
   * The spawn itself is stubbed by `launchApp`, so this asserts what the screen *says*
   * rather than that a game started - `live-launch.spec.ts` covers the real one. What
   * matters here is that the surface tells the truth: the card is a frame of gameplay
   * footage, and the bar over it is the only thing separating "your game is running" from
   * "here is a trailer", so it has to be present, running, timed and stoppable.
   */
  test('the gameplay screen reports the running game, and Back returns to its row', async ({}, testInfo) => {
    const { app, page } = await sharedApp()
    await setDesignWindow(app, page)
    await ensureMenu(page)

    const cards = await cardCount(page)
    test.skip(cards === 0, 'the catalog is empty: there is no row to launch')

    // Menu -> version -> panel, then onto the LAUNCH row.
    await press(page, 'Enter')
    await waitForScreen(page, 'version')
    await press(page, 'Enter')
    await waitForPanel(page)

    const names = await panelRowNames(page)
    const launchIndex = names.indexOf('row-launch')
    expect(launchIndex, `the panel has a LAUNCH row; it has ${names.join(', ')}`).toBeGreaterThanOrEqual(0)
    for (let step = 0; step < launchIndex; step += 1) await page.keyboard.press('ArrowDown')
    await press(page, 'Enter')

    await waitForScreen(page, 'gameplay')
    await captureScreenshot(page, testInfo, 'flow-5-gameplay-now-playing')

    const bar = page.locator('[data-figma-node="now-playing"]').first()
    await expect(bar, 'the now-playing bar is on the card').toHaveCount(1)
    await expect(bar, 'a launched row reports a running game').toHaveAttribute('data-running', 'true')
    await expect(bar).toContainText('NOW PLAYING')
    await expect(
      page.locator('[data-figma-node="now-playing-elapsed"]').first(),
      'the elapsed readout counts from the launch'
    ).toHaveText(/^\d{2}:\d{2}$/)
    await expect(
      page.locator('[data-figma-node="now-playing-stop"]').first(),
      'a running game has a stop action'
    ).toHaveCount(1)

    // Inside the card, which is what keeps the bar from drifting if the card moves.
    const card = await rect(page, 'gameplay-card')
    const barBox = await rect(page, 'now-playing')
    expect(barBox.y, 'the bar is inside the card').toBeGreaterThan(card.y)
    expect(barBox.y + barBox.height, 'the bar is inside the card').toBeLessThanOrEqual(
      card.y + card.height
    )

    // --- Escape: the only key this screen answers, and it goes back to the row ---
    await press(page, 'Escape')
    await waitForScreen(page, 'version')
  })

  /**
   * The settings surface, reached from the panel's SETTINGS row.
   *
   * The point of this test is not that a screen appears: it is that a change made on it
   * *persists*, because every row is live rather than staged. So it changes two different
   * kinds of row (a toggle and a stepped range), reads the value back through
   * `catalog:get` — the config the main process actually holds, not the renderer's copy — and
   * then puts both back, so the fixture is left as it was found.
   */
  test('settings: a row changes, persists, and Back leaves the surface', async ({}, testInfo) => {
    const { app, page } = await sharedApp()
    await setDesignWindow(app, page)
    await ensureMenu(page)

    const cards = await cardCount(page)
    test.skip(cards === 0, 'the catalog is empty: there is no panel to open')

    await press(page, 'Enter')
    await waitForScreen(page, 'version')
    await press(page, 'Enter')
    await waitForPanel(page)

    // Onto the SETTINGS row, which sits directly above LAUNCH.
    const names = await panelRowNames(page)
    const settingsIndex = names.indexOf('row-settings')
    expect(
      settingsIndex,
      `the panel has a SETTINGS row; it has ${names.join(', ')}`
    ).toBeGreaterThanOrEqual(0)
    for (let step = 0; step < settingsIndex; step += 1) await page.keyboard.press('ArrowDown')
    await press(page, 'Enter')

    await page.locator('[data-figma-node="settings"]').first().waitFor({ timeout: 10_000 })
    const surface = await probe(page)
    expect(surface.panelOpen, 'opening settings closes the launch panel').toBe(false)
    await captureScreenshot(page, testInfo, 'flow-6-settings')

    const rows = page.locator('[data-figma-node="settings-rows"] [data-name^="setting-"]')
    expect(await rows.count(), 'every settings row is drawn').toBe(16)

    /** Reads a setting's readout, and the same field from the main process's config. */
    const readBack = async (id: string): Promise<{ shown: string; persisted: unknown }> => {
      const shown = (await page.locator(`[data-figma-node="setting-value-${id}"]`).innerText()).trim()
      const persisted = await page.evaluate(async (rowId) => {
        const bridge = window.reLauncher
        if (bridge === undefined) throw new Error('window.reLauncher is missing')
        const snapshot = (await bridge.invoke('catalog:get', undefined)) as unknown as {
          config: { crtEnabled: boolean; scanlineIntensity: number }
        }
        return rowId === 'crt' ? snapshot.config.crtEnabled : snapshot.config.scanlineIntensity
      }, id)
      return { shown, persisted }
    }

    // --- a toggle: CRT filter -------------------------------------------------
    const crtBefore = await readBack('crt')
    /** What the surface looks like from the inside, for a failure message. */
    const surfaceState = async (): Promise<string> => {
      const state = await page.evaluate(() => {
        const focused = document.querySelector('[data-name^="setting-"][class*="0.063"]')
        return {
          up: document.querySelector('[data-figma-node="settings"]') !== null,
          rows: document.querySelectorAll('[data-figma-node="settings-rows"] [data-name^="setting-"]').length,
          focusedRow: focused === null ? null : focused.getAttribute('data-name')
        }
      })
      return JSON.stringify(state)
    }
    await press(page, 'ArrowRight')
    await waitUntil(() => readBack('crt'), (value) => value.shown !== crtBefore.shown, {
      label: `ArrowRight to flip the CRT row (surface=${await surfaceState()})`
    })
    const crtAfter = await readBack('crt')
    expect(
      crtAfter.persisted,
      `the toggle reached the config: ${JSON.stringify(crtBefore)} -> ${JSON.stringify(crtAfter)}`
    ).toBe(!crtBefore.persisted)

    // --- a stepped range: scanlines -------------------------------------------
    await press(page, 'ArrowDown')
    const scanBefore = await readBack('scanlines')
    await press(page, 'ArrowRight')
    await waitUntil(() => readBack('scanlines'), (value) => value.shown !== scanBefore.shown, {
      label: 'ArrowRight to step the scanline row'
    })
    const scanAfter = await readBack('scanlines')
    expect(
      scanAfter.persisted,
      `the step reached the config: ${String(scanBefore.persisted)} -> ${String(scanAfter.persisted)}`
    ).not.toBe(scanBefore.persisted)
    testInfo.annotations.push({
      type: 'settings-round-trip',
      description: `crt ${String(crtBefore.persisted)}->${String(crtAfter.persisted)} scanlines ${String(scanBefore.persisted)}->${String(scanAfter.persisted)}`
    })

    // --- put both back, so the fixture is not left changed ---------------------
    await press(page, 'ArrowLeft')
    await waitUntil(() => readBack('scanlines'), (value) => value.shown === scanBefore.shown, {
      label: 'ArrowLeft to put the scanline step back'
    })
    await press(page, 'ArrowUp')
    await press(page, 'ArrowRight')
    await waitUntil(() => readBack('crt'), (value) => value.shown === crtBefore.shown, {
      label: 'ArrowRight to put the CRT toggle back'
    })

    // --- Back leaves the surface ----------------------------------------------
    await press(page, 'Escape')
    await waitUntil(() => page.locator('[data-figma-node="settings"]').count(), (count) => count === 0, {
      label: 'Escape to close the settings surface'
    })
    expect((await probe(page)).screen, 'closing settings leaves the version screen up').toBe('version')
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

test('the menu key opens the settings surface from the menu, and closes it again', async ({}, testInfo) => {
  const { app, page } = await launchApp()
  await setDesignWindow(app, page)
  await ensureMenu(page)

  const rows = page.locator('[data-figma-node^="setting-"]')
  await expect(rows, 'nothing is open to begin with').toHaveCount(0)

  await press(page, 'F1')
  await expect(rows.first(), 'F1 opens the settings surface').toBeVisible()
  const opened = await rows.count()

  await press(page, 'F1')
  await expect(rows, 'F1 closes it again, so one key is the way in and out').toHaveCount(0)

  await captureScreenshot(page, testInfo, 'flow-f1-menu')
  expect(opened, 'the surface drew its rows').toBeGreaterThan(0)
})
test('the achievements surface opens from the settings row and lists the title', async ({}, testInfo) => {
  const { app, page } = await launchApp()
  await setDesignWindow(app, page)
  await ensureMenu(page)

  // F1 for the menu surface, then the achievements row: clicked once to select it, again to run it.
  // Clicking rather than counting arrow presses keeps the test independent of the row order, which
  // has changed three times as rows were added.
  await press(page, 'F1')
  const row = page.locator('[data-name="setting-achievements"]')
  await expect(row, 'the settings surface offers the row').toBeVisible()
  await row.click()
  await row.click()

  const surface = page.locator('[data-figma-node="achievements"]')
  await expect(surface, 'the row opens the surface').toBeVisible()

  const achievements = page.locator('[data-name="achievement-row"]')
  await expect(achievements.first(), 'the bundled list is drawn').toBeVisible()
  const count = await achievements.count()
  expect(count, 'a title with achievements lists them').toBeGreaterThan(0)

  await captureScreenshot(page, testInfo, 'achievements')

  // Back leaves it, which the surface's own helper bar promises.
  await press(page, 'Escape')
  await expect(surface, 'Escape closes the achievements surface').toHaveCount(0)
})