/**
 * Geometry E2E: every screen is measured against the Figma export.
 *
 * The expectations are not re-typed here — they are read from
 * `src/renderer/src/data/design.ts`, the module the components themselves are
 * built from ("a value can only be wrong once, not in two places", data/design.ts
 * header). The spec therefore proves two separate things at once: that the frame
 * on screen has the export's numbers, and that the app still takes those numbers
 * from the single design source.
 *
 * NOTE on the import path: it is relative, not `@renderer/data/design`. `tests/**`
 * is owned by `tsconfig.node.json`, whose `paths` declares `@shared/*` only — the
 * renderer alias exists in `tsconfig.web.json` and in the Vite config, neither of
 * which the Playwright/Node side sees — so a relative import is the one form that
 * both resolves at runtime and type-checks in the project the tests belong to.
 *
 * `rect()` returns every box in **author space** (design pixels on the fixed
 * 1920x1080 canvas), so these assertions hold whether the window ends up at
 * exactly 1920x1080 or is clamped by the display. Each screen is also captured to
 * `test-results/` for review, but nothing here compares pixels: geometry is the
 * assertion.
 */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import type { Page, TestInfo } from '@playwright/test'

import {
  CANVAS,
  GAMEPLAY_COMMON,
  GAMEPLAY_LAYOUTS,
  HELPER_BAR,
  MAIN_MENU,
  VERSION_SCREEN
} from '../../src/renderer/src/data/design'
import {
  NODES,
  captureScreenshot,
  cardCount,
  clampMenuToFirstCard,
  closeApp,
  ensureMenu,
  launchApp,
  panelRowNames,
  parentStyles,
  press,
  readSelfTestCatalog,
  rect,
  rects,
  rotationDegrees,
  selectedCardIndex,
  selectedVersionRowIndex,
  setDesignWindow,
  stageMetrics,
  styles,
  waitForPanel,
  waitForScreen,
  waitUntil
} from './electron-app'
import type { AppHandle } from './electron-app'

/** The repository root: Playwright runs from it, which is where the manifest lives. */
const repoRoot = process.cwd()

/**
 * The one tolerance every measurement gets, in author-space pixels.
 *
 * One pixel, not zero: sub-pixel layout means a 625.021px box can measure
 * 625.0 or 625.1 depending on where the stage landed on the device pixel grid,
 * and the export's own values carry three decimals.
 */
const TOLERANCE = 1

function expectWithin(measured: number, expected: number, tolerance: number, what: string): void {
  expect(
    Math.abs(measured - expected),
    `${what}: expected ${expected} ± ${tolerance} in author space, measured ${measured}`
  ).toBeLessThanOrEqual(tolerance)
}

/** Records a note in the report — for what the environment decided, not for an assertion. */
function annotate(testInfo: TestInfo, type: string, description: string): void {
  testInfo.annotations.push({ type, description })
}

/**
 * The gameplay frame's own `data-name`, which names the title
 * (`src/renderer/src/screens/Gameplay.tsx`, `FRAME_NAME`). Reading the title off
 * the frame instead of assuming the one under the cursor means the per-title
 * layout is compared against the right entry of `GAMEPLAY_LAYOUTS`.
 */
const GAMEPLAY_FRAME_TITLE: Record<string, keyof typeof GAMEPLAY_LAYOUTS> = {
  'Main Menu / RE 1 / Gameplay': 're1',
  'Main Menu / RE 2 / Gameplay': 're2',
  'Main Menu / RE 3 / Gameplay': 're3'
}

/**
 * One app for the whole file.
 *
 * The launcher takes a single-instance lock and each launch costs a cold start,
 * so the three screens are measured in one process, one after another:
 * `fullyParallel: false` and `workers: 1` (playwright.config.ts) keep them on one
 * worker in file order, and every test re-establishes the state it needs with
 * `ensureMenu` rather than depending on where the previous test left off.
 */
let shared: AppHandle | undefined

async function sharedApp(): Promise<AppHandle> {
  if (shared === undefined) shared = await launchApp()
  return shared
}

test.afterAll(async () => {
  if (shared !== undefined) await closeApp(shared)
})

test.describe('the launcher frame matches the Figma export', () => {
  test('the --selftest preflight reports the catalog this run will see', async ({}, testInfo) => {
    // The diagnostic path the release build also exposes: it reads the catalog
    // without a window and without taking the single-instance lock. It is
    // informational — a geometry run must not fail over what its environment
    // contains — but it is the note that explains a skipped card assertion.
    const report = await readSelfTestCatalog()
    if (report === null) {
      annotate(
        testInfo,
        'selftest',
        'the --selftest launch reported nothing; the run continues with whatever the UI shows'
      )
      return
    }

    const summary = report.rows.map((row) => `${row.id}=${row.state}`).join(', ')
    annotate(
      testInfo,
      'selftest',
      `needsInstallScreen=${String(report.needsInstallScreen)} rows=[${summary}]`
    )

    // Only the shape of a *successful* report is asserted: an `ok: false` report
    // is the launcher saying its catalog could not be built, which the UI run
    // then has to survive anyway.
    if (report.ok) {
      expect(report.rows.length, '--selftest reports one row per catalog version').toBeGreaterThan(0)
    }
  })

  test('the main menu: logo, card row, cards, copyright and helper bar', async ({}, testInfo) => {
    const { app, page } = await sharedApp()
    await setDesignWindow(app, page)
    await ensureMenu(page)
    await captureScreenshot(page, testInfo, 'main-menu')

    // The stage is what turns screen pixels into author-space pixels. Its own
    // scale is never asserted to be 1 — the display may have clamped the window —
    // only that it was measurable at all.
    const stage = await stageMetrics(page)
    expect(stage.scale, 'the stage scale is positive').toBeGreaterThan(0)
    expectWithin(stage.width, CANVAS.width, 1, 'stage width in author space')
    expectWithin(stage.height, CANVAS.height, 1, 'stage height in author space')

    // The menu column: the design's padding, and the vertical centring the export
    // asks for with `justify-center` inside a `pt-[56px] pb-[72px]` body.
    const column = await rect(page, NODES.menuColumn)
    expectWithin(column.x, MAIN_MENU.padding.left, TOLERANCE, 'menu column x (left padding)')
    expectWithin(
      column.width,
      CANVAS.width - MAIN_MENU.padding.left - MAIN_MENU.padding.right,
      TOLERANCE,
      'menu column width (the padded body)'
    )
    const usableHeight = CANVAS.height - MAIN_MENU.padding.top - MAIN_MENU.padding.bottom
    expectWithin(
      column.y,
      MAIN_MENU.padding.top + (usableHeight - column.height) / 2,
      TOLERANCE,
      'menu column y (centred in the padded body)'
    )

    // The logo block: 625.021 x 250, the first child of that column. The column is
    // `items-center` (MainMenu.tsx `Menu`), so the lockup is centred on the canvas
    // rather than hung off the left padding.
    const logo = await rect(page, NODES.menuLogo)
    expectWithin(logo.width, MAIN_MENU.logo.width, TOLERANCE, 'logo block width')
    expectWithin(logo.height, MAIN_MENU.logo.height, TOLERANCE, 'logo block height')
    expectWithin(logo.x + logo.width / 2, CANVAS.width / 2, TOLERANCE, 'logo block centred on the canvas')
    expectWithin(logo.y, column.y, TOLERANCE, 'logo block y (first child of the menu column)')

    // The badge's own box, derived from the export's percentage inset of the
    // lockup rather than restated: `inset-[73.96%_7.57%_0_7.52%]` means the badge
    // starts 73.96% down a 250px box and spans what is left, and starts 7.52% in
    // from the left of a 625.021px box, leaving 7.57% on the right. This is the
    // assertion that keeps the badge's geometry under test now that its face and
    // lettering come from the concept's texture instead of live text - see
    // docs/DESIGN-FIDELITY.md 7.2 and the `liveTokens` note in
    // tools/check-fidelity.mjs.
    const badge = await rect(page, 'logo-badge')
    const badgeInset = MAIN_MENU.logo.badgeInset
    const insetOf = (value: string): number => Number.parseFloat(value) / 100
    expectWithin(
      badge.x - logo.x,
      insetOf(badgeInset.left) * MAIN_MENU.logo.width,
      TOLERANCE,
      'badge left inset'
    )
    expectWithin(
      badge.width,
      (1 - insetOf(badgeInset.left) - insetOf(badgeInset.right)) * MAIN_MENU.logo.width,
      TOLERANCE,
      'badge width'
    )
    expectWithin(badge.y - logo.y, insetOf(badgeInset.top) * MAIN_MENU.logo.height, TOLERANCE, 'badge top inset')
    expectWithin(
      badge.height,
      (1 - insetOf(badgeInset.top) - insetOf(badgeInset.bottom)) * MAIN_MENU.logo.height,
      TOLERANCE,
      'badge height'
    )

    // The card row: 616px tall, the full width of the column.
    const cardRow = await rect(page, NODES.menuCardRow)
    expectWithin(cardRow.height, MAIN_MENU.cardRowHeight, TOLERANCE, 'card row height')
    expectWithin(cardRow.width, column.width, TOLERANCE, 'card row width')
    expectWithin(cardRow.x, column.x, TOLERANCE, 'card row x')
    expectWithin(cardRow.y, logo.y + logo.height + MAIN_MENU.menuGap, TOLERANCE, 'card row y (one 32px gap below the logo)')

    // The cards. The wrappers carry the export's own box and *not* the selected
    // card's `scale(1.02)` (screens/MainMenu.tsx), so a card measures 380x580
    // whether or not it is the one under the cursor; the selection scale is
    // asserted in interaction.spec.ts, where it is the point.
    const cards = await rects(page, NODES.menuCard)
    if (cards.length === 0) {
      // The renderer drew its empty-catalog state (no `window.reLauncher`, or a
      // catalog with no titles): there are no covers to measure. The frame around
      // them is still asserted above and below, which is what the brief's
      // "geometry does not depend on installs" asks for.
      annotate(testInfo, 'not-asserted', 'no game cards: the catalog is empty, so card geometry was not asserted')
    } else {
      expect(cards.length, 'one cover per catalog title').toBe(3)
      cards.forEach((card, index) => {
        expectWithin(card.width, MAIN_MENU.card.width, TOLERANCE, `card ${index} width`)
        expectWithin(card.height, MAIN_MENU.card.height, TOLERANCE, `card ${index} height`)
        expectWithin(card.y, cardRow.y + (cardRow.height - card.height) / 2, TOLERANCE, `card ${index} y (centred in the row)`)
      })
      for (let index = 1; index < cards.length; index += 1) {
        const previous = cards[index - 1]
        const card = cards[index]
        if (previous === undefined || card === undefined) continue
        expectWithin(
          card.x - (previous.x + previous.width),
          MAIN_MENU.cardGap,
          TOLERANCE,
          `gap between cards ${index - 1} and ${index}`
        )
      }
      const first = cards[0]
      const last = cards[cards.length - 1]
      if (first !== undefined && last !== undefined) {
        expectWithin(
          (first.x + last.x + last.width) / 2,
          CANVAS.width / 2,
          TOLERANCE,
          'the card row is centred on the canvas'
        )
      }
    }

    // The copyright line: the design's 18px Actor size.
    const copyright = await styles(page, NODES.menuCopyright)
    expectWithin(
      Number.parseFloat(copyright.fontSize),
      MAIN_MENU.copyright.fontSize,
      0.5,
      'copyright font size'
    )

    // The helper bar: 1920 wide, 68 tall, flush to the canvas bottom.
    const helperBar = await rect(page, NODES.helperBar)
    expectWithin(helperBar.width, CANVAS.width, TOLERANCE, 'helper bar width')
    expectWithin(helperBar.height, HELPER_BAR.height, TOLERANCE, 'helper bar height')
    expectWithin(helperBar.x, 0, TOLERANCE, 'helper bar x')
    expectWithin(helperBar.y + helperBar.height, CANVAS.height, TOLERANCE, 'helper bar bottom edge')
  })

  test('the version screen: two columns, an 18px list gap and the info block', async ({}, testInfo) => {
    const { app, page } = await sharedApp()
    await setDesignWindow(app, page)
    await ensureMenu(page)

    const cards = await cardCount(page)
    test.skip(cards === 0, 'the catalog is empty, so no title can be entered from the menu')

    // Confirm on the main menu enters the title under the cursor
    // (`.ref/designref/src/app/components/MainMenuPage.tsx:19-21`, which is the
    // design's own Enter behaviour), so the version screen is reached exactly the
    // way the user reaches it.
    await press(page, 'Enter')
    await waitForScreen(page, 'version')
    await captureScreenshot(page, testInfo, 'version-screen')

    const leftPanel = await rect(page, NODES.versionLeftPanel)
    expectWithin(leftPanel.width, VERSION_SCREEN.leftPanelWidth, TOLERANCE, 'left panel width')
    expectWithin(leftPanel.height, CANVAS.height, TOLERANCE, 'left panel height')
    expectWithin(leftPanel.x, 0, TOLERANCE, 'left panel x')

    const rightPanel = await rect(page, NODES.versionRightPanel)
    expectWithin(rightPanel.width, VERSION_SCREEN.rightPanelWidth, TOLERANCE, 'right panel width')
    expectWithin(rightPanel.height, CANVAS.height, TOLERANCE, 'right panel height')
    expectWithin(rightPanel.x, VERSION_SCREEN.leftPanelWidth, TOLERANCE, 'right panel x (flush to the left panel)')

    // The list of rows: the design's 18px gap between them (version-list).
    const rows = await rects(page, NODES.versionRow)
    expect(rows.length, 'a title has at least two version rows').toBeGreaterThan(1)

    // The list states the count it divided its height by (`data-row-count` on
    // `version-list`, which is what makes a two-row and a three-row title
    // explainable from the DOM alone); the rows on screen have to match it.
    const declaredRows = await page
      .locator('[data-figma-node="version-list"]')
      .first()
      .getAttribute('data-row-count')
    if (declaredRows !== null) {
      expect(
        rows.length,
        `the list draws the rows it divided its height by (data-row-count=${declaredRows})`
      ).toBe(Number.parseInt(declaredRows, 10))
    }

    for (let index = 1; index < rows.length; index += 1) {
      const previous = rows[index - 1]
      const row = rows[index]
      if (previous === undefined || row === undefined) continue
      expectWithin(
        row.y - (previous.y + previous.height),
        VERSION_SCREEN.rowGap,
        TOLERANCE,
        `gap between version rows ${index - 1} and ${index}`
      )
    }

    // Each row frames its hero art at 1600/740. The export writes the ratio on the
    // lane *inside* the row (`.ref/designref/src/imports/MainMenuRe1.tsx:15`,
    // `data-name="hero"`), while the row box itself is a `flex-[1_0_0]` share of
    // the list — which is why the ratio is asserted on the lane, one per row.
    const heroes = await rects(page, NODES.versionHero)
    expect(heroes.length, 'every version row frames a hero lane').toBe(rows.length)
    heroes.forEach((hero, index) => {
      expectWithin(
        hero.width / hero.height,
        VERSION_SCREEN.heroAspect,
        0.01,
        `version row ${index} hero aspect ratio (1600/740)`
      )
      expectWithin(hero.width, leftPanel.width - 2 * VERSION_SCREEN.padding.left, TOLERANCE, `version row ${index} hero width`)
    })

    // And the art inside those lanes is the design's, not the previous launcher's.
    //
    // Asserted from the asset manifest rather than from the rendered pixels, because the
    // frames' hero art is the same *aspect* as `media/`'s (both 1600x740), so a shape check
    // cannot tell them apart - and for two rows they were different artwork entirely.
    // The manifest records where every converted file came from, which is the fact worth
    // checking: a hero must never trace back to `media/`.
    const manifest = JSON.parse(
      await readFile(join(repoRoot, 'src', 'renderer', 'src', 'assets', 'MANIFEST.json'), 'utf8')
    ) as { images: { key: string; file: string; source: string }[] }
    const heroCopies = manifest.images.filter((image) => image.key.startsWith('game/hero-'))
    expect(heroCopies.length, 'every hero asset is recorded in the manifest').toBe(8)
    for (const copy of heroCopies) {
      expect(
        copy.source.replace(/\\/g, '/'),
        `${copy.key} must come from the design's own files, not media/`
      ).not.toContain('/media/')
    }

    // The info block: 482px, pinned to the bottom of the 860px column.
    const infoBlock = await rect(page, NODES.infoBlock)
    expectWithin(infoBlock.height, VERSION_SCREEN.info.blockHeight, TOLERANCE, 'info block height')
    expectWithin(infoBlock.width, VERSION_SCREEN.rightPanelWidth, TOLERANCE, 'info block width')
    expectWithin(infoBlock.y + infoBlock.height, CANVAS.height, TOLERANCE, 'info block bottom edge')

    // The info panel's lane art, row by row.
    //
    // The invariant is derived rather than restated: in every row the export either
    // fills the lane with the art or sizes the art by percentages of it, and either
    // way the *rendered* box of the art element ends up with the art file's own
    // aspect. RE1 US is the one row where that is not obvious - its art is cropped
    // into a lane of a different aspect (`h-[163.67%] … w-[120.62%]` of it) - but the
    // percentages are chosen so the crop keeps the art's aspect, so the invariant
    // still holds.
    //
    // It is exactly the assertion that catches the bug this replaced: the panel used
    // to be fed `media/`'s near-square 1068x1080 region files, which would have made
    // the rendered box disagree with the file in every lane.
    const laneAspectOf = async (): Promise<{ rendered: number; natural: number }> => {
      const art = page.locator('[data-figma-node="info-lane-art"]').first()
      expect(await art.count(), 'the info panel renders a lane art element').toBe(1)
      const natural = await art.evaluate((element) => {
        const image = element as HTMLImageElement
        return { width: image.naturalWidth, height: image.naturalHeight }
      })
      expect(natural.width, 'the lane art decoded').toBeGreaterThan(0)
      const box = await rect(page, 'info-lane-art')
      return { rendered: box.width / box.height, natural: natural.width / natural.height }
    }

    for (let index = 0; index < rows.length; index += 1) {
      if (index > 0) await press(page, 'ArrowDown')
      await waitUntil(() => selectedVersionRowIndex(page), (selected) => selected === index, {
        label: `row ${index} to hold the selection`
      })
      const lane = await laneAspectOf()
      expect(
        Math.abs(lane.rendered - lane.natural),
        `the lane art is the design's own file for row ${index}: rendered aspect ` +
          `${lane.rendered.toFixed(4)} vs the file's ${lane.natural.toFixed(4)}`
      ).toBeLessThanOrEqual(0.01)
    }

    // Back to the menu, so the next test starts from a fresh screen whether or not
    // it runs after this one.
    await press(page, 'Escape')
    await waitForScreen(page, 'menu')
  })

  test('the gameplay screen: the 1300x975 card and the rotated logo box', async ({}, testInfo) => {
    const { app, page, launchStub } = await sharedApp()
    await setDesignWindow(app, page)
    await ensureMenu(page)

    const cards = await cardCount(page)
    test.skip(cards === 0, 'the catalog is empty, so no game can be reached')
    test.skip(!launchStub, 'the launch IPC handler could not be stubbed, and this test must not start a real game')

    // The gameplay screen is only reachable through a successful launch
    // (`state/store.ts`, `launch()`); the main process's `launch` handler is
    // replaced with an immediate success by the harness, so the whole flow is real
    // and nothing is spawned. The first card is selected first so the title on
    // screen is the catalog's first one, and the frame's own name then decides
    // which `GAMEPLAY_LAYOUTS` entry is compared.
    await clampMenuToFirstCard(page)
    await press(page, 'Enter')
    await waitForScreen(page, 'version')
    await press(page, 'Enter')
    await waitForPanel(page)

    const panelRows = await panelRowNames(page)
    const launchRow = panelRows.indexOf('row-launch')
    expect(launchRow, `the launch row is the panel's last row: ${panelRows.join(', ')}`).toBe(
      panelRows.length - 1
    )

    // The LAUNCH row states whether the row under the cursor can start at all
    // (overlays/LaunchPanel.tsx renders "NOT AVAILABLE" and `aria-disabled` from
    // `canLaunch`), so an install this machine does not have is a skip rather than
    // a timeout: the screen is unreachable without a launchable version, and that
    // is an environment fact, not a geometry regression.
    const launchLabel = await page
      .locator('[data-name="launch-panel"]')
      .first()
      .locator('[data-name="row-launch"]')
      .first()
    const launchDisabled = await launchLabel.getAttribute('aria-disabled')
    test.skip(
      launchDisabled === 'true',
      'no version of this title is launchable here, so the gameplay screen cannot be reached'
    )

    for (let step = 0; step < launchRow; step += 1) {
      await press(page, 'ArrowDown')
    }
    await press(page, 'Enter')

    await waitForScreen(page, 'gameplay')
    await captureScreenshot(page, testInfo, 'gameplay')

    const frameName = await frameNameOf(page)
    /** The design entry for the title actually on screen; RE1 is the fallback for
     *  a frame the launcher has renamed, since the clamped first card is RE1. */
    const titleId = (frameName === null ? undefined : GAMEPLAY_FRAME_TITLE[frameName]) ?? 're1'
    const layout = GAMEPLAY_LAYOUTS[titleId]
    annotate(testInfo, 'gameplay-title', `${titleId} (frame "${frameName ?? 'unknown'}")`)

    const card = await rect(page, NODES.gameplayCard)
    expectWithin(card.width, GAMEPLAY_COMMON.card.width, TOLERANCE, 'gameplay card width')
    expectWithin(card.height, GAMEPLAY_COMMON.card.height, TOLERANCE, 'gameplay card height')
    expectWithin(card.x, (CANVAS.width - GAMEPLAY_COMMON.card.width) / 2, TOLERANCE, 'gameplay card x (centred)')
    expectWithin(card.y, layout.cardTop, TOLERANCE, `gameplay card top (${titleId})`)

    const cardStyles = await styles(page, NODES.gameplayCard)
    expectWithin(
      Number.parseFloat(cardStyles.borderRadius),
      GAMEPLAY_COMMON.card.radius,
      0.5,
      'gameplay card corner radius'
    )

    // The rotated logo lockup. The wrapper is the layout entry's *box*
    // (137.574 x 516.266 for RE1), while the artwork the export names `logo` is
    // laid out at the same entry's *unrotated* size (516.266 x 137.574) inside a
    // `-rotate-90` wrapper — which is why the artwork's own painted box is the
    // portrait one: a quarter-turned element reports a swapped bounding box, and
    // that swap is the rotation.
    const logoBox = await rect(page, NODES.gameplayLogoBox)
    expectWithin(logoBox.width, layout.logo.boxWidth, TOLERANCE, `rotated logo box width (${titleId})`)
    expectWithin(logoBox.height, layout.logo.boxHeight, TOLERANCE, `rotated logo box height (${titleId})`)
    expectWithin(logoBox.x, layout.logo.left, TOLERANCE, `rotated logo box left (${titleId})`)
    expectWithin(
      logoBox.y + logoBox.height / 2,
      CANVAS.height / 2 + logoAnchorOffset(layout.logo.top),
      TOLERANCE,
      `rotated logo box sits at the design's vertical anchor (${titleId})`
    )

    const artwork = await rect(page, NODES.gameplayLogoArtwork)
    expectWithin(artwork.width, layout.logo.boxWidth, TOLERANCE, `rotated logo artwork painted width (${titleId})`)
    expectWithin(artwork.height, layout.logo.boxHeight, TOLERANCE, `rotated logo artwork painted height (${titleId})`)

    const artworkStyles = await styles(page, NODES.gameplayLogoArtwork)
    expectWithin(
      Number.parseFloat(artworkStyles.width),
      layout.logo.width,
      TOLERANCE,
      `logo artwork layout width (${titleId})`
    )
    expectWithin(
      Number.parseFloat(artworkStyles.height),
      layout.logo.height,
      TOLERANCE,
      `logo artwork layout height (${titleId})`
    )

    const rotation = await parentStyles(page, NODES.gameplayLogoArtwork)
    expectWithin(
      Math.abs(rotationDegrees(rotation)),
      90,
      TOLERANCE,
      'the logo artwork is turned a quarter turn by its wrapper'
    )

    // Escape goes back to the running title's version list — the design's only
    // key on this screen (`.ref/designref/src/app/components/GameplayPage.tsx:22-28`).
    await press(page, 'Escape')
    await waitForScreen(page, 'version')
    // ...and the next Escape is the version screen's own Back.
    await press(page, 'Escape')
    await waitForScreen(page, 'menu')

    // The cursor is back on the card that was launched: `goToMenu` returns the
    // selection to the title the user came from, and this test clamped the cursor
    // to the first card before launching it.
    await waitUntil(() => selectedCardIndex(page), (selected) => selected === 0, {
      label: 'the menu to settle on the launched title'
    })
  })
})

/** The gameplay frame's `data-name`, or null when the screen has no frame yet. */
async function frameNameOf(page: Page): Promise<string | null> {
  const screen = page.locator('[data-figma-node="gameplay-screen"]').first()
  if ((await screen.count()) === 0) return null
  return await screen.getAttribute('data-name')
}

/**
 * The vertical anchor a gameplay layout gives the rotated logo, in author-space
 * pixels relative to the canvas centre.
 *
 * The export does not centre the lockup on every title: RE1 writes
 * `top-[calc(50%-1.13px)]` (`MainMenuRe1Gameplay.tsx:55`) while RE2 and RE3 write
 * a plain `top-1/2`, so RE1's centre really is 538.87 and not 540. Reading the
 * offset out of the layout entry keeps the assertion about the design's own
 * number instead of a rounded one.
 */
function logoAnchorOffset(top: string): number {
  const match = /calc\(\s*50%\s*([+-])\s*([\d.]+)px\s*\)/.exec(top)
  if (match === null) return 0
  const sign = match[1] === '-' ? -1 : 1
  return sign * Number.parseFloat(match[2] ?? '0')
}
