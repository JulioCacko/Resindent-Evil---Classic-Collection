/**
 * Shared Playwright harness for the launcher's Electron E2E suite.
 *
 * Three things make an Electron launcher harder to drive than a web page, and
 * this file exists to answer all three once:
 *
 *  1. **A window is not a screenshot.** Every screen is drawn in a fixed
 *     1920x1080 author space that the Stage (`src/renderer/src/stage/Stage.tsx`)
 *     uniformly scales to the window. A box measured with
 *     `getBoundingClientRect` is therefore in *screen* pixels, not in the design
 *     pixels every assertion is written in. `rect()` divides the measurement by
 *     the stage's own scale and rebases it on the stage's origin, so an assertion
 *     about "380px" means the design's 380px at any window size — which is what
 *     keeps the geometry spec from depending on the size the OS gave us.
 *
 *  2. **The launcher reads the real machine.** `src/main/index.ts` takes a
 *     single-instance lock, and the catalog builder detects `GOG Games/`
 *     folders, the Windows registry and `C:\GOG Games`. The suite is meant to be
 *     hermetic, so `launchApp()` builds a throwaway fixture directory and points
 *     `RE_TEST_APP_DIR` / `RE_TEST_CONFIG_DIR` at it (plus a `--user-data-dir`
 *     switch, best effort). NOTE: as of this writing `src/main/paths.ts` reads
 *     neither variable — it resolves `appDir` from `app.getAppPath()` and
 *     `userData` from Electron, and ignores the Chromium switch too — so today
 *     the fixture is inert and the launcher inspects the real repository root
 *     (whose `GOG Games/` folder is what the geometry run actually sees). The
 *     helper must keep working either way, so *nothing* here depends on what was
 *     detected: the geometry specs measure the frame, and the two catalog-driven
 *     assertions are skipped with an annotation when no title is on screen.
 *
 *  3. **Launching a game is a side effect, not a step.** The only route to the
 *     gameplay screen is a successful launch (`state/store.ts`, `launch()`), and
 *     the main process's `launch` handler spawns the real executable. `launchApp`
 *     therefore replaces *that one IPC handler* in the main process
 *     (`ipcMain.removeHandler` + `handle`) with an immediate success, so the
 *     whole renderer flow — panel, LAUNCH row, screen transition — is exercised
 *     while no process can ever be started.
 *
 * `--selftest` is deliberately NOT used for the UI runs. `src/main/index.ts`
 * arms a self-test on that flag which prints the catalog and calls `app.exit(0)`
 * as soon as the renderer finishes loading (`reportSelfTest`, index.ts:209-251),
 * so a window launched with it is gone before the first assertion; the flag is
 * instead used by `readSelfTestCatalog()` for its intended purpose — a read-only
 * catalog report with the single-instance lock skipped (index.ts:361).
 */
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

import { _electron } from '@playwright/test'
import type { ElectronApplication, Locator, Page, TestInfo } from '@playwright/test'

import type { ScreenId } from '@shared/types'

import { CANVAS } from '../../src/renderer/src/data/design'

// ---------------------------------------------------------------------------
// the DOM surface this file uses
// ---------------------------------------------------------------------------

/**
 * `tests/**` belongs to `tsconfig.node.json`, whose `lib` is ES2023 with no
 * `"DOM"`: the renderer project has the DOM library, but a test file cannot see
 * it. The callbacks below run *inside* the page, where the real objects exist —
 * only the compile-time view is missing — so the minimum shape actually used is
 * declared here. Pulling in the whole DOM lib would be worse: it would make
 * `document` look defined in this module too, where reading it outside an
 * `evaluate` callback is a runtime `ReferenceError` in Node.
 */
interface DomRectLike {
  readonly x: number
  readonly y: number
  readonly left: number
  readonly top: number
  readonly width: number
  readonly height: number
}

interface DomStyleLike {
  readonly transform: string
  readonly rotate: string
  readonly scale: string
  readonly fontSize: string
  readonly borderRadius: string
  readonly width: string
  readonly height: string
}

interface DomElementLike {
  getAttribute(name: string): string | null
  getBoundingClientRect(): DomRectLike
  readonly clientWidth: number
  readonly clientHeight: number
  readonly parentElement: DomElementLike | null
}

/** A minimal `document`, used only inside page callbacks. */
declare const document: {
  querySelector(selector: string): DomElementLike | null
  querySelectorAll(selector: string): Iterable<DomElementLike>
}

/** A minimal `getComputedStyle`, used only inside page callbacks. */
declare function getComputedStyle(element: DomElementLike): DomStyleLike

/** The fake gamepad hook `installFakeGamepad` publishes on the page. */
interface FakeGamepad {
  set(index: number, pressed: boolean): void
  reset(): void
}

/** A minimal `window`, used only inside page callbacks. */
declare const window: { __reE2ePad?: FakeGamepad }

/** A minimal `navigator`, used only inside the gamepad init script. */
declare const navigator: { getGamepads?: unknown }

// ---------------------------------------------------------------------------
// node registry
// ---------------------------------------------------------------------------

/**
 * A box in the Figma export, and the selectors that can find its node.
 *
 * The screens and components that make up the launcher publish their design
 * identity as `data-figma-node` — `src/renderer/src/screens/MainMenu.tsx` is
 * explicit that those names exist for `tests/e2e/geometry.spec.ts` — and that
 * attribute is the first candidate everywhere. The further candidates are the
 * belt to its braces, in descending order of reliability:
 *
 *   `[data-name="…"]`   the Figma layer name, carried by the components
 *                       (`data-name="Helper"` in HelperBar.tsx, `data-name="hero"`
 *                       in VersionRow.tsx) — the same name the export writes.
 *   `[class*="…"]`      a substring of a transcribed Tailwind arbitrary value
 *                       (`625.021px`, `482px`). The components copy the export's
 *                       class strings verbatim, so these survive a rename of the
 *                       test hook. Brackets are deliberately left out of the
 *                       values to keep the selector trivially parseable.
 *
 * A node is resolved to the first candidate that matches anything, and a miss
 * reports every candidate it tried plus the hooks the DOM actually carries, so a
 * renamed node explains itself instead of failing as "element not found".
 */
export interface FigmaNode {
  readonly label: string
  readonly selectors: readonly string[]
}

function node(label: string, ...selectors: string[]): FigmaNode {
  return { label, selectors }
}

export const NODES = {
  /** The scaled 1920x1080 author-space layer. */
  stage: node('stage', '[data-figma-node="stage"]', '[class*="960px"]'),

  mainMenu: node('main menu', '[data-figma-node="main-menu"]', '[data-figma-node="game-select-row"]'),
  menuColumn: node('menu column', '[data-name="menu"]'),
  menuLogo: node('logo block', '[data-figma-node="logo"]', '[data-name="Logo"]', '[class*="625.021px"]'),
  menuCardRow: node('card row', '[data-figma-node="game-select-row"]', '[data-name="game select"]'),
  menuCard: node('game card', '[data-figma-node^="card-"]', '[role="button"][class*="380px"]'),
  /**
   * The cover inside its wrapper: the element that carries the design's selected
   * state (`components/GameCard.tsx` puts `aria-pressed` and the `scale(1.02)`
   * transform there), which the wrapper deliberately does not.
   */
  menuCardSurface: node(
    'game card surface',
    '[data-figma-node^="card-"] [role="button"]',
    '[role="button"][class*="380px"]'
  ),
  menuCopyright: node('copyright', '[data-figma-node="copyright"]', 'p:has-text("CAPCOM")'),

  versionScreen: node(
    'version screen',
    '[data-figma-node="version-screen"]',
    '[data-figma-node="game-version-panel"]'
  ),
  versionLeftPanel: node(
    'version left panel',
    '[data-figma-node="game-version-panel"]',
    '[data-name="game-version"]',
    '[class*="1060px"]'
  ),
  versionList: node('version list', '[data-figma-node="version-list"]', '[data-name="menu"]'),
  versionRow: node('version row', '[data-figma-node^="version-row-"]'),
  versionHero: node('version row hero', '[data-figma-node="version-row-hero"]', '[data-name="hero"]'),
  versionRightPanel: node(
    'version right panel',
    '[data-figma-node="info-panel"]',
    '[data-name="info-panel"]',
    '[class*="860px"]'
  ),
  infoBlock: node('info block', '[data-figma-node="info-block"]', '[class*="482px"]'),

  gameplayScreen: node(
    'gameplay screen',
    '[data-figma-node="gameplay-screen"]',
    '[data-figma-node="gameplay-card"]'
  ),
  gameplayCard: node('gameplay card', '[data-figma-node="gameplay-card"]', '[data-name="Gameplay 1"]'),
  gameplayLogoBox: node('gameplay logo box', '[data-figma-node="gameplay-logo"]'),
  gameplayLogoArtwork: node(
    'gameplay logo artwork',
    '[data-figma-node="gameplay-logo-artwork"]',
    '[data-name="logo"]'
  ),

  helperBar: node('helper bar', '[data-figma-node="helper-bar"]', '[data-name="Helper"]'),
  launchPanel: node('launch panel', '[data-figma-node="launch-panel"]', '[data-name="launch-panel"]'),
  installScreen: node('install status', '[data-name="install-status"]'),
  errorDialog: node('error dialog', '[data-name="error-dialog"]')
} as const

/** A `data-figma-node` value, or the node descriptor itself. */
export type NodeRef = FigmaNode | string

function asNode(reference: NodeRef): FigmaNode {
  return typeof reference === 'string'
    ? node(reference, `[data-figma-node="${reference}"]`)
    : reference
}

// ---------------------------------------------------------------------------
// measurements
// ---------------------------------------------------------------------------

/** A box in **author space**: design pixels on the fixed 1920x1080 canvas. */
export interface AuthorRect {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

/** The stage's fit: the uniform scale, and where author-space (0,0) landed. */
export interface StageMetrics {
  readonly scale: number
  readonly originX: number
  readonly originY: number
  /** The stage's own size in author units, i.e. CANVAS when it was found. */
  readonly width: number
  readonly height: number
}

/** The measured CSS of one element, in the units a browser reports. */
export interface ElementStyles {
  readonly fontSize: string
  readonly borderRadius: string
  readonly transform: string
  readonly rotate: string
  readonly scale: string
  readonly width: string
  readonly height: string
}

interface StageQuery {
  readonly selector: string | null
  readonly width: number
  readonly height: number
}

/**
 * The stage's scale and origin, read from the live DOM.
 *
 * The element is found by the `data-figma-node="stage"` hook when it is there,
 * then by the author-space classes the Stage carries, and finally by scanning
 * for a 1920x1080 box with a transform — which is what makes this work against
 * the Stage as it stands, where only the class-and-scan paths match.
 *
 * `transform` is parsed as a matrix, and the `scale` CSS property is read as a
 * fallback: Tailwind v4 implements utilities like `scale-*` as that individual
 * property rather than folding them into `transform` (`stage/Stage.tsx` notes
 * the same split for its own inline transform).
 */
export async function stageMetrics(page: Page): Promise<StageMetrics> {
  // The stage only exists once React has mounted, and a spec that measures
  // immediately after launch would otherwise race the first render and fail with
  // a misleading "stage layer was not found".
  await page
    .locator(NODES.stage.selectors.join(', '))
    .first()
    .waitFor({ state: 'attached', timeout: 30_000 })
    .catch(() => undefined)

  const selector = await firstSelector(page, NODES.stage)
  return await page.evaluate<StageMetrics, StageQuery>((query) => {
    const scaleOf = (style: DomStyleLike): number => {
      if (style.transform !== 'none' && style.transform !== '') {
        const match = /matrix\(([^)]+)\)/.exec(style.transform)
        if (match !== null && match[1] !== undefined) {
          const parts = match[1].split(',').map((value) => Number.parseFloat(value))
          const a = parts.at(0) ?? 1
          const b = parts.at(1) ?? 0
          const uniform = Math.hypot(a, b)
          if (Number.isFinite(uniform) && uniform > 0) return uniform
        }
      }
      if (style.scale !== 'none' && style.scale !== '') {
        const declared = Number.parseFloat(style.scale)
        if (Number.isFinite(declared) && declared > 0) return declared
      }
      return 1
    }

    /**
     * The author-space layer: the first candidate, then any element that is
     * exactly the canvas size *and* transformed (the untransformed letterbox
     * around it is the same size in the common case, so the transform is what
     * tells them apart).
     */
    const find = (): DomElementLike | null => {
      if (query.selector !== null) {
        const direct = document.querySelector(query.selector)
        if (direct !== null) return direct
      }
      for (const candidate of Array.from(document.querySelectorAll('div'))) {
        if (candidate.clientWidth !== query.width) continue
        if (candidate.clientHeight !== query.height) continue
        if (getComputedStyle(candidate).transform === 'none') continue
        return candidate
      }
      return null
    }

    const stage = find()
    if (stage === null) {
      throw new Error(
        `the stage layer was not found: no ${query.width}x${query.height} transformed element, and ` +
          `the selector ${query.selector ?? '(none)'} matched nothing`
      )
    }

    const scale = scaleOf(getComputedStyle(stage))
    const box = stage.getBoundingClientRect()
    return {
      scale,
      originX: box.left,
      originY: box.top,
      width: box.width / scale,
      height: box.height / scale
    }
  }, { selector, width: CANVAS.width, height: CANVAS.height })
}

/** The uniform scale the stage is drawn at. 1 means 1 design px = 1 CSS px. */
export async function stageScale(page: Page): Promise<number> {
  return (await stageMetrics(page)).scale
}

/**
 * The bounding box of a design node, in author space.
 *
 * The measured screen box is divided by the stage scale and rebased on the
 * stage's origin, so the result is resolution-independent: at a 1920x1080 window
 * it is the raw box, and at any other size it is the same design number. A node
 * that also carries a transform of its own (the selected game card's
 * `scale(1.02)`) reports its *painted* box, i.e. that transform included — the
 * interaction spec relies on it, and the wrappers the geometry spec measures
 * (`data-figma-node="card-N"`) carry no transform at all.
 */
export async function rect(page: Page, reference: NodeRef, index = 0): Promise<AuthorRect> {
  const locator = await locate(page, asNode(reference), index)
  const box = await locator.boundingBox()
  if (box === null) {
    throw new Error(
      `the node "${asNode(reference).label}" is present but has no bounding box ` +
        `(hidden, zero-sized or detached)`
    )
  }
  const stage = await stageMetrics(page)
  return {
    x: (box.x - stage.originX) / stage.scale,
    y: (box.y - stage.originY) / stage.scale,
    width: box.width / stage.scale,
    height: box.height / stage.scale
  }
}

/** Every match of a design node, in author space and in document order. */
export async function rects(page: Page, reference: NodeRef): Promise<AuthorRect[]> {
  const figmaNode = asNode(reference)
  const selector = await firstSelector(page, figmaNode)
  if (selector === null) {
    throw new Error(`no element matched "${figmaNode.label}": tried ${figmaNode.selectors.join(', ')}`)
  }
  const count = await page.locator(selector).count()
  const boxes: AuthorRect[] = []
  for (let index = 0; index < count; index += 1) {
    boxes.push(await rect(page, figmaNode, index))
  }
  return boxes
}

interface StyleQuery {
  readonly selector: string
  readonly index: number
  /** Read the element's parent instead, for chrome the child cannot carry. */
  readonly parent: boolean
}

/**
 * The computed style of a design node.
 *
 * Read through `page.evaluate` with the resolved selector as an argument, rather
 * than through `locator.evaluate`, so the callback only ever touches the shapes
 * declared at the top of this file — see the note on the DOM declarations.
 */
export async function styles(page: Page, reference: NodeRef, index = 0): Promise<ElementStyles> {
  return await readStyles(page, reference, index, false)
}

/**
 * The computed style of a design node's parent.
 *
 * Some chrome belongs to a wrapper rather than to the node the export names it
 * on — the gameplay logo lockup, for instance, is the design's `logo` node inside
 * a `-rotate-90` wrapper (`screens/Gameplay.tsx`, `RotatedLogo`) — so "is this
 * box turned a quarter turn?" has to ask the parent.
 */
export async function parentStyles(page: Page, reference: NodeRef, index = 0): Promise<ElementStyles> {
  return await readStyles(page, reference, index, true)
}

async function readStyles(
  page: Page,
  reference: NodeRef,
  index: number,
  parent: boolean
): Promise<ElementStyles> {
  const figmaNode = asNode(reference)
  const selector = await firstSelector(page, figmaNode)
  if (selector === null) {
    throw new Error(`no element matched "${figmaNode.label}": tried ${figmaNode.selectors.join(', ')}`)
  }
  return await page.evaluate<ElementStyles, StyleQuery>((query) => {
    const found = Array.from(document.querySelectorAll(query.selector)).at(query.index)
    const element = query.parent ? (found === undefined ? null : found.parentElement) : (found ?? null)
    if (element === null) {
      return {
        fontSize: '0px',
        borderRadius: '0px',
        transform: 'none',
        rotate: 'none',
        scale: 'none',
        width: '0px',
        height: '0px'
      }
    }
    const style = getComputedStyle(element)
    return {
      fontSize: style.fontSize,
      borderRadius: style.borderRadius,
      transform: style.transform,
      rotate: style.rotate,
      scale: style.scale,
      width: style.width,
      height: style.height
    }
  }, { selector, index, parent })
}

/**
 * The scale a box is painted at, from either channel a browser may use:
 * `transform: matrix(a, b, …)` or the individual `scale` property.
 */
export function scaleFactor(style: ElementStyles): number {
  if (style.transform !== 'none' && style.transform !== '') {
    const match = /matrix\(([^)]+)\)/.exec(style.transform)
    if (match !== null && match[1] !== undefined) {
      const parts = match[1].split(',').map((value) => Number.parseFloat(value))
      const uniform = Math.hypot(parts.at(0) ?? 1, parts.at(1) ?? 0)
      if (Number.isFinite(uniform) && uniform > 0) return uniform
    }
  }
  if (style.scale !== 'none' && style.scale !== '') {
    const declared = Number.parseFloat(style.scale)
    if (Number.isFinite(declared) && declared > 0) return declared
  }
  return 1
}

/**
 * The rotation a box is painted at, in degrees, from either channel.
 *
 * The gameplay logo lockup is turned a quarter turn inside its wrapper
 * (`Gameplay.tsx`, `RotatedLogo`), and whether that arrives as a matrix or as
 * the `rotate` property depends on which utility Tailwind v4 emits, so both are
 * read.
 */
export function rotationDegrees(style: ElementStyles): number {
  if (style.rotate !== 'none' && style.rotate !== '') {
    const declared = Number.parseFloat(style.rotate)
    if (Number.isFinite(declared)) return declared
  }
  if (style.transform !== 'none' && style.transform !== '') {
    const match = /matrix\(([^)]+)\)/.exec(style.transform)
    if (match !== null && match[1] !== undefined) {
      const parts = match[1].split(',').map((value) => Number.parseFloat(value))
      const a = parts.at(0) ?? 1
      const b = parts.at(1) ?? 0
      const degrees = (Math.atan2(b, a) * 180) / Math.PI
      if (Number.isFinite(degrees)) return degrees
    }
  }
  return 0
}

// ---------------------------------------------------------------------------
// fixture + environment
// ---------------------------------------------------------------------------

/** Contents of the stub executable the fixture plants. Never run, only probed. */
const STUB_EXE = 'e2e stub — the launcher only stat()s this file\n'

/**
 * The fixture `config.ini`, in the legacy spelling the README documents and
 * `src/main/config-store.ts` migrates from (`LEGACY_FIELDS`): section headers
 * qualify their keys, and the values are the legacy defaults.
 */
const FIXTURE_INI = [
  '[display]',
  'crt_enabled=0',
  'scanline_intensity=0.3',
  'curvature=0.08',
  '[audio]',
  'master_volume=1.0',
  '[game]',
  'last_selected=re1',
  ''
].join('\n')

/**
 * A throwaway directory shaped like a complete launcher install.
 *
 * `src/main/paths.ts` honours `RE_TEST_APP_DIR` / `RE_TEST_CONFIG_DIR` outside a
 * packaged build, so the suite never reads the developer's real `GOG Games/`,
 * never patches a real game's `config.ini` and starts from default settings. That
 * only works if the fixture can satisfy the catalog, so it mirrors the retail
 * layout for all three titles: every executable the catalog names, the per-title
 * data marker install validation probes (`USA/`, `LeonU.exe`, `ResidentEvil3.exe`),
 * and a non-empty folder for each RE-Enhance payload, so `hasMod` is true and the
 * launch panel shows the design's full row set.
 *
 * The stubs are intentionally not working executables: nothing in the suite is
 * allowed to start a game (the launch handler is replaced, and the gameplay test
 * skips if that replacement fails), and the only thing that ever touches these
 * files is a `stat` from install validation.
 */
const FIXTURE_FILES: readonly string[] = [
  // Resident Evil: retail exe, RE-Enhance exe, and the disc-data marker.
  'GOG Games/Resident Evil/ResidentEvil.exe',
  'GOG Games/Resident Evil/Biohazard.exe',
  'GOG Games/Resident Evil/USA/.keep',
  'GOG Games/Resident Evil/config.ini',
  // Resident Evil 2: both scenarios plus the RE-Enhance exe.
  'GOG Games/Resident Evil 2/LeonU.exe',
  'GOG Games/Resident Evil 2/ClaireU.exe',
  'GOG Games/Resident Evil 2/Resident Evil 2.exe',
  'GOG Games/Resident Evil 2/config.ini',
  // Resident Evil 3.
  'GOG Games/Resident Evil 3/ResidentEvil3.exe',
  'GOG Games/Resident Evil 3/BIOHAZARD(R) 3 PC.exe',
  'GOG Games/Resident Evil 3/config.ini',
  // RE-Enhance payloads, so every `hasMod` row resolves and RE1 JP can be installed.
  'reenhancemods/RE-ENHANCE_RE1_v1.1_GOG/ddraw.dll',
  'reenhancemods/RE-ENHANCE_RE2_v2.0.1_GOG/ddraw.dll',
  'reenhancemods/RE-ENHANCE_RE3_v2.2_GOG/ddraw.dll'
]

export async function createFixture(): Promise<string> {
  const fixtureDir = await mkdtemp(join(tmpdir(), 're-classic-e2e-'))
  await mkdir(join(fixtureDir, 'userdata'), { recursive: true })

  for (const relative of FIXTURE_FILES) {
    const target = join(fixtureDir, relative)
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, relative.endsWith('.exe') ? STUB_EXE : FIXTURE_INI, 'utf8')
  }

  // The launcher's own legacy config, migrated on first run by config-store.ts.
  await writeFile(join(fixtureDir, 'config.ini'), FIXTURE_INI, 'utf8')
  return fixtureDir
}

/** `process.env` as a plain string map, dropping the undefined entries. */
function stringEnv(extra: Readonly<Record<string, string>>): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === 'string') env[key] = value
  }
  return { ...env, ...extra }
}

/** The repository root Playwright is run from. */
function repositoryRoot(): string {
  const configured = process.env.RE_E2E_ROOT
  const root = configured !== undefined && configured.length > 0 ? configured : process.cwd()
  if (!existsSync(join(root, 'out', 'main', 'index.js'))) {
    throw new Error(
      `the compiled main process is not at ${join(root, 'out', 'main', 'index.js')}. ` +
        'Run `pnpm compile` (or `pnpm test:e2e`) from the repository root, or set RE_E2E_ROOT.'
    )
  }
  return root
}

// ---------------------------------------------------------------------------
// launching
// ---------------------------------------------------------------------------

/** The argv Playwright passes, relative to the repository root (the cwd). */
const MAIN_ENTRY = 'out/main/index.js'

/**
 * The read-only diagnostic launch. `--selftest` prints the catalog to stdout and
 * exits, and it deliberately skips the single-instance lock
 * (`src/main/index.ts`), so it is safe next to a running launcher.
 */
export const SELFTEST_ARGS: readonly string[] = [MAIN_ENTRY, '--selftest']

export interface LaunchOptions {
  /** Extra argv. */
  readonly args?: readonly string[]
  /**
   * Replace the `launch` IPC handler with an immediate success. On by default:
   * without it, walking the launch panel would spawn the real game executable.
   */
  readonly stubLaunch?: boolean
  readonly timeoutMs?: number
}

export interface AppHandle {
  readonly app: ElectronApplication
  readonly page: Page
  readonly repoRoot: string
  readonly fixtureDir: string
  /** True when `launch` was replaced, i.e. no game can be started by this run. */
  readonly launchStub: boolean
}

/**
 * Launches the launcher for a UI test.
 *
 * Order matters: the fixture exists before the process starts (its paths are
 * handed over through the environment), and the launch handler is replaced before
 * any test can reach the launch panel. Sizing the window is the caller's step
 * (`setDesignWindow`), because a test that only reads state does not need it.
 */
export async function launchApp(options: LaunchOptions = {}): Promise<AppHandle> {
  const repoRoot = repositoryRoot()
  const fixtureDir = await createFixture()
  const userDataDir = join(fixtureDir, 'userdata')

  const args = [
    MAIN_ENTRY,
    // Best effort: Electron honours the Chromium profile switch when it knows it,
    // and ignores it when it does not, so the real profile is either redirected
    // (and the config starts from defaults) or untouched. Both are fine — no test
    // asserts on config state, and the menu cursor is clamped explicitly.
    `--user-data-dir=${userDataDir}`,
    ...(options.args ?? [])
  ]

  const app = await _electron.launch({
    args,
    cwd: repoRoot,
    env: stringEnv({
      RE_TEST_APP_DIR: fixtureDir,
      RE_TEST_CONFIG_DIR: userDataDir
    })
  })

  const timeoutMs = options.timeoutMs ?? 30_000
  let page: Page
  try {
    page = await firstWindow(app, timeoutMs)
  } catch (error) {
    try {
      await app.close()
    } catch {
      // The process is already gone; nothing left to close.
    }
    throw new Error(
      `the launcher window did not appear within ${timeoutMs}ms: ${String(error)}\n` +
        'The launcher takes a single-instance lock (src/main/index.ts), so a second launch exits ' +
        'immediately while another one is running. Close any open launcher and re-run the suite.'
    )
  }

  const launchStub = options.stubLaunch === false ? false : await stubLaunchHandler(app)
  if (!launchStub && options.stubLaunch !== false) {
    console.warn(
      '[e2e] the launch IPC handler could not be replaced; the gameplay tests will be skipped ' +
        'rather than risk starting the real game executable.'
    )
  }

  return { app, page, repoRoot, fixtureDir, launchStub }
}

/** The launcher's only window. */
export async function firstWindow(app: ElectronApplication, timeoutMs = 30_000): Promise<Page> {
  return await app.firstWindow({ timeout: timeoutMs })
}

/** Closes the app, tolerating one that has already exited. */
export async function closeApp(handle: AppHandle): Promise<void> {
  try {
    await handle.app.close()
  } catch (error) {
    console.warn(`[e2e] the app was already gone: ${String(error)}`)
  }
}

/**
 * Replaces the `launch` IPC handler with an immediate success.
 *
 * `ipcMain.handle` refuses a channel that already has a handler, hence the
 * `removeHandler` first — the same order `src/main/ipc.ts` uses when it disposes
 * its own registrations. The reply is a valid `LaunchResult` success arm, which
 * is all the store needs to move to the gameplay screen.
 */
async function stubLaunchHandler(app: ElectronApplication): Promise<boolean> {
  try {
    return await app.evaluate<boolean>(({ ipcMain }) => {
      try {
        ipcMain.removeHandler('launch')
        ipcMain.handle('launch', () => ({
          ok: true,
          pid: 4242,
          executable: 'e2e-stub',
          injectedMod: false
        }))
        return true
      } catch {
        return false
      }
    })
  } catch (error) {
    console.warn(`[e2e] could not reach the main process to stub launch: ${String(error)}`)
    return false
  }
}

/**
 * The `--selftest` report: what the launcher's own detection found.
 *
 * Returns null on any failure — a missing build, a process that exits before
 * Playwright attaches, unparsable output — because this is a convenience for the
 * suite's log and its skip decisions, never a precondition.
 */
export interface SelfTestReport {
  readonly ok: boolean
  readonly needsInstallScreen: boolean
  readonly rows: readonly { readonly id: string; readonly state: string; readonly installPath: string }[]
}

/**
 * The shape check for the line `--selftest` prints.
 *
 * The output is the launcher's, but it arrives as JSON over a pipe, so it is
 * validated field by field instead of asserted: a report that does not match is
 * treated the same as no report at all, which is what keeps a preflight from ever
 * failing the suite.
 */
function isSelfTestReport(value: unknown): value is SelfTestReport {
  if (typeof value !== 'object' || value === null) return false
  if (!('ok' in value) || !('needsInstallScreen' in value) || !('rows' in value)) return false
  if (typeof value.ok !== 'boolean') return false
  if (typeof value.needsInstallScreen !== 'boolean') return false
  if (!Array.isArray(value.rows)) return false

  const rows: unknown[] = value.rows
  for (const row of rows) {
    if (typeof row !== 'object' || row === null) return false
    if (!('id' in row) || !('state' in row) || !('installPath' in row)) return false
    if (typeof row.id !== 'string' || typeof row.state !== 'string') return false
    if (typeof row.installPath !== 'string') return false
  }
  return true
}

export async function readSelfTestCatalog(timeoutMs = 30_000): Promise<SelfTestReport | null> {
  try {
    const repoRoot = repositoryRoot()
    const app = await _electron.launch({
      args: [...SELFTEST_ARGS],
      cwd: repoRoot,
      env: stringEnv({})
    })
    try {
      const child = app.process()
      const stdout = child.stdout
      if (stdout === null) return null
      stdout.setEncoding('utf8')

      const report = await new Promise<SelfTestReport | null>((resolve) => {
        const timer = setTimeout(() => {
          resolve(null)
        }, timeoutMs)
        let buffer = ''
        stdout.on('data', (chunk: string) => {
          buffer += chunk
          for (const line of buffer.split('\n')) {
            if (!line.trim().startsWith('{')) continue
            try {
              const parsed: unknown = JSON.parse(line)
              if (!isSelfTestReport(parsed)) continue
              clearTimeout(timer)
              resolve(parsed)
              return
            } catch {
              // A partial line: the rest of it is still on its way.
            }
          }
        })
      })
      return report
    } finally {
      try {
        await app.close()
      } catch {
        // The self-test exits itself; a failed close is expected.
      }
    }
  } catch (error) {
    console.warn(`[e2e] the --selftest preflight could not run: ${String(error)}`)
    return null
  }
}

/**
 * Puts the window at exactly the design canvas, then reports the resulting
 * stage metrics.
 *
 * Two mechanisms, because neither is guaranteed: `BrowserWindow.setContentSize`
 * asks the OS for a 1920x1080 *content* area (a display smaller than that may
 * still clamp the window), and `page.setViewportSize` is Playwright's own
 * emulation, which an Electron page may refuse. Nothing downstream depends on
 * which one wins: `rect()` divides by the measured stage scale.
 */
export async function setDesignWindow(
  app: ElectronApplication,
  page: Page
): Promise<StageMetrics> {
  try {
    await app.evaluate<{ width: number; height: number } | null, { width: number; height: number }>(
      ({ BrowserWindow }, size) => {
        const target = BrowserWindow.getAllWindows().at(0)
        if (target === undefined) return null
        target.setContentSize(size.width, size.height)
        const applied = target.getContentSize()
        return { width: applied[0], height: applied[1] }
      },
      { width: CANVAS.width, height: CANVAS.height }
    )
  } catch (error) {
    console.warn(`[e2e] could not resize the window: ${String(error)}`)
  }

  try {
    await page.setViewportSize({ width: CANVAS.width, height: CANVAS.height })
  } catch (error) {
    console.warn(`[e2e] the page refused a viewport: ${String(error)}`)
  }

  return await stageMetrics(page)
}

// ---------------------------------------------------------------------------
// screen state
// ---------------------------------------------------------------------------

export interface ScreenProbe {
  readonly screen: ScreenId | 'boot'
  readonly panelOpen: boolean
  readonly error: string | null
  readonly cards: number
  readonly rows: number
}

const SCREEN_ANCHORS: readonly { readonly screen: ScreenId; readonly selectors: readonly string[] }[] = [
  { screen: 'gameplay', selectors: ['[data-figma-node="gameplay-screen"]', '[data-figma-node="gameplay-card"]'] },
  {
    screen: 'version',
    selectors: ['[data-figma-node="version-screen"]', '[data-figma-node="game-version-panel"]']
  },
  { screen: 'menu', selectors: ['[data-figma-node="main-menu"]', '[data-figma-node="game-select-row"]'] },
  { screen: 'install', selectors: ['[data-name="install-status"]'] }
]

const PANEL_SELECTORS: readonly string[] = ['[data-name="launch-panel"]']
const ERROR_SELECTORS: readonly string[] = ['[data-name="error-dialog"]']

/** Which screen is on, and the two overlays it may be carrying. */
export async function probe(page: Page): Promise<ScreenProbe> {
  const panelOpen = (await count(page, PANEL_SELECTORS)) > 0
  const errorText = await firstText(page, ERROR_SELECTORS)
  const cards = await count(page, NODES.menuCard.selectors)
  const rows = await count(page, NODES.versionRow.selectors)
  for (const anchor of SCREEN_ANCHORS) {
    if ((await count(page, anchor.selectors)) > 0) {
      return { screen: anchor.screen, panelOpen, error: errorText, cards, rows }
    }
  }
  return { screen: 'boot', panelOpen, error: errorText, cards, rows }
}

/** A one-line state report, for assertion messages. */
export function describe(state: ScreenProbe): string {
  const dialog = state.error === null ? '' : ` dialog="${state.error}"`
  return `screen=${state.screen} panelOpen=${String(state.panelOpen)} cards=${String(state.cards)} rows=${String(state.rows)}${dialog}`
}

/**
 * Waits for a named screen.
 *
 * Every wait is bounded and every failure names the state that was found,
 * including the text of an error dialog: a renderer that cannot reach its bridge
 * shows that dialog instead of a screen, and the message is what tells the
 * difference between a bug and an empty environment.
 */
export async function waitForScreen(
  page: Page,
  expected: ScreenId | 'boot',
  options: { timeoutMs?: number } = {}
): Promise<ScreenProbe> {
  const deadline = Date.now() + (options.timeoutMs ?? DEFAULT_TIMEOUT_MS)
  let state = await probe(page)
  while (state.screen !== expected && Date.now() < deadline) {
    if (page.isClosed()) break
    await delay(POLL_MS)
    state = await probe(page)
  }
  if (state.screen !== expected) {
    throw new Error(`expected the ${expected} screen, found ${describe(state)}`)
  }
  return state
}

/** Waits for the main-menu screen, walking back through any screen in front of it. */
export async function ensureMenu(page: Page, options: { timeoutMs?: number } = {}): Promise<ScreenProbe> {
  const deadline = Date.now() + (options.timeoutMs ?? DEFAULT_TIMEOUT_MS)
  let state = await probe(page)
  while (state.screen !== 'menu' && Date.now() < deadline) {
    if (page.isClosed()) break
    if (state.error !== null) {
      // The error dialog owns every key while it is up (`resolveIntent`): Enter
      // and Escape both dismiss it, and nothing behind it can be driven first.
      await press(page, 'Escape')
    } else if (state.panelOpen) {
      await press(page, 'Escape')
    } else if (state.screen === 'install') {
      // HINTS_INSTALL: Enter is "Continue", and continuing is the main menu.
      await press(page, 'Enter')
    } else if (state.screen === 'version' || state.screen === 'gameplay') {
      await press(page, 'Escape')
    } else {
      // 'boot': nothing owns input until the first catalog answer lands.
      await delay(POLL_MS)
    }
    state = await probe(page)
  }
  if (state.screen !== 'menu') {
    throw new Error(`the main menu did not appear: ${describe(state)}`)
  }
  await settleInput(page)
  return state
}

/**
 * Waits until the app can actually receive a key.
 *
 * The window's `keydown` listener is attached in an effect (`input/useActions.ts`),
 * which React runs after the commit that put the first screen in the DOM. A spec
 * that presses a key as soon as the menu is *visible* can therefore have that press
 * land on a page with no listener yet and be dropped — which shows up as a slow
 * timeout several steps later rather than as a lost keystroke. Two animation frames
 * after the screen appears is past the commit and past the effect, and it costs a
 * few milliseconds.
 *
 * This was a genuine intermittent failure, not a theoretical one: the keyboard spec
 * failed once in two full-suite runs with a lost first Enter, and passed in
 * isolation every time.
 */
async function settleInput(page: Page): Promise<void> {
  await page
    .evaluate(
      () =>
        new Promise<void>((resolve) => {
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              resolve()
            })
          })
        })
    )
    .catch(() => undefined)
}

/** Waits for the launch panel to be mounted. */
export async function waitForPanel(page: Page, options: { timeoutMs?: number } = {}): Promise<void> {
  await waitUntil(() => count(page, PANEL_SELECTORS), (mounted) => mounted > 0, {
    label: 'the launch panel',
    timeoutMs: options.timeoutMs
  })
}

/** The `data-name` of every row in the first launch panel, in design order. */
export async function panelRowNames(page: Page): Promise<string[]> {
  const panel = page.locator('[data-name="launch-panel"]').first()
  const rows = panel.locator('[data-name^="row-"]')
  const total = await rows.count()
  const names: string[] = []
  for (let index = 0; index < total; index += 1) {
    const name = await rows.nth(index).getAttribute('data-name')
    if (name !== null) names.push(name)
  }
  return names
}

/** How many cards the menu is drawing (0 with an empty catalog). */
export async function cardCount(page: Page): Promise<number> {
  return await count(page, NODES.menuCard.selectors)
}

/**
 * Which card holds the selection.
 *
 * Read from `aria-pressed`, which `components/GameCard.tsx` sets from the store's
 * `menuIndex` — the one card-state marker in the DOM that is a real accessibility
 * fact rather than a class string.
 */
export async function selectedCardIndex(page: Page): Promise<number> {
  const cards = page.locator(await cardSelector(page))
  const total = await cards.count()
  for (let index = 0; index < total; index += 1) {
    const pressed = await cards.nth(index).locator('[aria-pressed="true"]').count()
    if (pressed > 0) return index
  }
  return -1
}

/**
 * Which version row holds the selection.
 *
 * `VersionRow` has no `aria-selected`, so the marker is the design's own selected
 * chrome: the 8.5px selection radius (`VERSION_SCREEN.rowSelectedRadius`) is
 * drawn only on the row under the cursor, and it lives inside that row's
 * `data-figma-node="version-row-N"` wrapper.
 */
export async function selectedVersionRowIndex(page: Page): Promise<number> {
  const rows = page.locator('[data-figma-node^="version-row-"]')
  const total = await rows.count()
  for (let index = 0; index < total; index += 1) {
    const marker = await rows.nth(index).locator('[class*="8.5px"]').count()
    if (marker > 0) return index
  }
  return -1
}

/** How many version rows the version screen is drawing. */
export async function versionRowCount(page: Page): Promise<number> {
  return await count(page, ['[data-figma-node^="version-row-"]'])
}

/** Moves the menu cursor to the leftmost card, which the design clamps. */
export async function clampMenuToFirstCard(page: Page, attempts = 4): Promise<number> {
  for (let index = 0; index < attempts; index += 1) {
    await press(page, 'ArrowLeft')
  }
  return await waitUntil(() => selectedCardIndex(page), (selected) => selected === 0, {
    label: 'the first card to hold the selection'
  })
}

async function cardSelector(page: Page): Promise<string> {
  const selector = await firstSelector(page, NODES.menuCard)
  if (selector === null) {
    throw new Error(`no game card matched: tried ${NODES.menuCard.selectors.join(', ')}`)
  }
  return selector
}

// ---------------------------------------------------------------------------
// input
// ---------------------------------------------------------------------------

/** Pad button indices, from the standard mapping (`input/actions.ts`). */
export const PAD = { confirm: 0, back: 1, up: 12, down: 13, left: 14, right: 15 } as const

/**
 * How long a synthetic pad button is held, and how long the test waits after it
 * is released.
 *
 * The hook samples the pad once per animation frame (`useGamepad.ts`), so a press
 * has to survive at least one frame (~17ms) to be seen at all; 140ms covers a
 * stalled frame on a busy machine. The settle is past the hook's own 220ms pad
 * throttle and past its 200ms keyboard device lock, so the next press is a fresh
 * edge rather than a suppressed one.
 */
export const PAD_HOLD_MS = 140
export const PAD_SETTLE_MS = 300

/** How long assertions and screen waits retry a DOM read before giving up. */
const DEFAULT_TIMEOUT_MS = 15_000
const POLL_MS = 120

/** A key press, plus a short settle so a following read sees the new frame. */
export async function press(page: Page, key: string, settleMs = 80): Promise<void> {
  await page.keyboard.press(key)
  if (settleMs > 0) await page.waitForTimeout(settleMs)
}

/**
 * Installs the fake gamepad and reloads the page onto it.
 *
 * `addInitScript` only applies to documents created after it is registered, and
 * the Electron window loads before Playwright can talk to it, so the reload is
 * what puts the shim in front of the app's own script. The pad reports itself as
 * a standard-mapping Xbox pad, which is the shape `useGamepad.ts` reads
 * (`connected`, `buttons[i].pressed`, `axes`).
 */
export async function installFakeGamepad(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const buttons: { pressed: boolean; touched: boolean; value: number }[] = []
    for (let index = 0; index < 17; index += 1) {
      buttons.push({ pressed: false, touched: false, value: 0 })
    }
    const pad = {
      axes: [0, 0, 0, 0],
      buttons,
      connected: true,
      id: 'Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 02fd)',
      index: 0,
      mapping: 'standard',
      timestamp: 0
    }

    Object.defineProperty(navigator, 'getGamepads', {
      configurable: true,
      value: () => [pad]
    })

    window.__reE2ePad = {
      set(index: number, pressed: boolean): void {
        buttons[index] = { pressed, touched: pressed, value: pressed ? 1 : 0 }
      },
      reset(): void {
        for (let index = 0; index < buttons.length; index += 1) {
          buttons[index] = { pressed: false, touched: false, value: 0 }
        }
      }
    }
  })
  await page.reload()
}

interface PadButtonArg {
  readonly index: number
  readonly pressed: boolean
}

/** Holds a pad button for one frame, then releases it. */
export async function padPress(
  page: Page,
  button: number,
  options: { holdMs?: number; settleMs?: number } = {}
): Promise<void> {
  await padSetButton(page, button, true)
  await page.waitForTimeout(options.holdMs ?? PAD_HOLD_MS)
  await padSetButton(page, button, false)
  await page.waitForTimeout(options.settleMs ?? PAD_SETTLE_MS)
}

async function padSetButton(page: Page, index: number, pressed: boolean): Promise<void> {
  await page.evaluate<void, PadButtonArg>((arg) => {
    const pad = window.__reE2ePad
    if (pad === undefined) {
      throw new Error('the fake gamepad is not installed in this document')
    }
    pad.set(arg.index, arg.pressed)
  }, { index, pressed })
}

// ---------------------------------------------------------------------------
// assertions support
// ---------------------------------------------------------------------------

export interface WaitOptions {
  readonly label: string
  readonly timeoutMs?: number
  readonly intervalMs?: number
}

/**
 * Retries a DOM read until it satisfies `isDone`.
 *
 * Assertions on state the app writes asynchronously (a store update, then a React
 * paint) need a retry; this keeps that retry explicit and, unlike a bare sleep,
 * fails with the value it actually read.
 */
export async function waitUntil<T>(
  read: () => Promise<T>,
  isDone: (value: T) => boolean,
  options: WaitOptions
): Promise<T> {
  const deadline = Date.now() + (options.timeoutMs ?? DEFAULT_TIMEOUT_MS)
  const interval = options.intervalMs ?? POLL_MS
  let value = await read()
  while (!isDone(value) && Date.now() < deadline) {
    await delay(interval)
    value = await read()
  }
  if (!isDone(value)) {
    throw new Error(`${options.label}: still ${JSON.stringify(value)} after waiting`)
  }
  return value
}

/**
 * Saves a per-screen screenshot under the run's output directory
 * (`test-results/…`) and attaches it to the report.
 *
 * Review material only: the suite asserts measured geometry, never pixels, so a
 * capture that fails is a warning rather than a failure.
 */
export async function captureScreenshot(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  try {
    const path = testInfo.outputPath(`${name}.png`)
    await mkdir(dirname(path), { recursive: true })
    await page.screenshot({ path })
    await testInfo.attach(name, { path, contentType: 'image/png' })
  } catch (error) {
    console.warn(`[e2e] could not capture the ${name} screenshot: ${String(error)}`)
  }
}

// ---------------------------------------------------------------------------
// small selector utilities
// ---------------------------------------------------------------------------

/** The first candidate selector that matches anything, or null. */
async function firstSelector(page: Page, reference: FigmaNode): Promise<string | null> {
  for (const selector of reference.selectors) {
    if ((await page.locator(selector).count()) > 0) return selector
  }
  return null
}

/** The `nth` match of a node, or a self-describing failure. */
async function locate(page: Page, reference: FigmaNode, index: number): Promise<Locator> {
  const selector = await firstSelector(page, reference)
  if (selector === null) {
    throw new Error(
      `no element matched "${reference.label}": tried ${reference.selectors.join(', ')}; ` +
        `the document carries ${JSON.stringify(await presentHooks(page))}`
    )
  }
  return page.locator(selector).nth(index)
}

/** The number of matches of the first candidate selector that matches. */
async function count(page: Page, selectors: readonly string[]): Promise<number> {
  for (const selector of selectors) {
    const total = await page.locator(selector).count()
    if (total > 0) return total
  }
  return 0
}

/** The trimmed text of the first match, or null. */
async function firstText(page: Page, selectors: readonly string[]): Promise<string | null> {
  for (const selector of selectors) {
    const element = page.locator(selector).first()
    if ((await element.count()) === 0) continue
    const text = await element.textContent()
    if (text !== null) return text.trim().slice(0, 200)
  }
  return null
}

/**
 * Every `data-figma-node` and `data-name` value the document carries, for the
 * failure message of a node that could not be found. Deduplicated and sorted so
 * the report is stable between runs.
 */
async function presentHooks(page: Page): Promise<{ figmaNodes: string[]; names: string[] }> {
  return await page.evaluate<{ figmaNodes: string[]; names: string[] }>(() => {
    const read = (attribute: string): string[] => {
      const values = new Set<string>()
      for (const element of Array.from(document.querySelectorAll(`[${attribute}]`))) {
        const value = element.getAttribute(attribute)
        if (value !== null && value !== '') values.add(value)
      }
      return Array.from(values).sort()
    }
    return { figmaNodes: read('data-figma-node'), names: read('data-name') }
  })
}
