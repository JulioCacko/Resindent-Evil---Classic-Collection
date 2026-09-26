/**
 * index.ts — the Electron entry point.
 *
 * Its whole job is window and process lifecycle: create the one window the
 * launcher has, load the renderer into it, hand the IPC surface to `ipc.ts`,
 * enforce a single instance, and stop a running game before the launcher exits.
 * Nothing here knows about the catalog, the config or the games.
 *
 * `__dirname` is `out/main` in every mode electron-vite produces (dev runs the
 * bundle from there too), so `../preload` and `../renderer` are the two sibling
 * outputs of the build.
 */
import { existsSync, writeSync } from 'node:fs'
import { join } from 'node:path'

import { BrowserWindow, app, screen } from 'electron'

import type { InstallState } from '@shared/types'

import { readCatalogSnapshot, registerIpcHandlers } from './ipc'
import { killGame } from './launch'
import { log } from './logger'

/**
 * The Figma frame is a fixed 1920x1080 canvas — `.ref/designref/src/imports/
 * MainMenu.tsx` gives `body` `w-[1920px]` and each screen `h-[1080px]` — so the
 * window asks for exactly that and scales down when the display cannot oblige.
 */
const DESIGN_WIDTH = 1920
const DESIGN_HEIGHT = 1080
/** The floor for the initial size, applied after the work-area clamp. */
const MIN_WIDTH = 1280
const MIN_HEIGHT = 720
/** The frame's own background, `bg-[#0f0f0f]` (MainMenu.tsx, `data-name="Main Menu"`). */
const BACKGROUND_COLOR = '#0F0F0F'
/** How long `--selftest` waits for the renderer to finish loading before reporting anyway. */
const SELFTEST_LOAD_TIMEOUT_MS = 15_000

/**
 * `--selftest` is the diagnostic entry point the E2E suite and manual checks use:
 * it prints the catalog to stdout and exits. It is argv-based rather than an env
 * var so the packaged executable can be driven exactly like the release build.
 */
const isSelfTest = process.argv.includes('--selftest')

let mainWindow: BrowserWindow | null = null
let disposeIpc: (() => void) | null = null
let selfTestTimer: NodeJS.Timeout | null = null
let selfTestReported = false

// ---------------------------------------------------------------------------
// window
// ---------------------------------------------------------------------------

/**
 * Initial window size: the design canvas, clamped down to the display's work area
 * (which already excludes the taskbar) and never below the design minimum.
 *
 * No `minWidth`/`minHeight` are set: the renderer letterboxes the fixed canvas, so
 * a deliberately small window stays usable, and the minimum here is about the
 * *starting* size, not about forbidding a resize.
 */
function resolveWindowSize(): { width: number; height: number } {
  const { workAreaSize } = screen.getPrimaryDisplay()
  return {
    width: Math.min(DESIGN_WIDTH, Math.max(MIN_WIDTH, Math.round(workAreaSize.width))),
    height: Math.min(DESIGN_HEIGHT, Math.max(MIN_HEIGHT, Math.round(workAreaSize.height)))
  }
}

/**
 * The bundled preload script.
 *
 * electron-vite's output name depends on module format: this package is
 * `"type": "module"`, so electron-vite v5 emits the preload entry as ESM
 * (`out/preload/index.mjs`, which Electron loads only with `sandbox: false`) and
 * falls back to `out/preload/index.js` for a CommonJS build. Both are accepted so
 * the launcher works whichever way the build resolves.
 */
function resolvePreloadPath(): string {
  const esm = join(__dirname, '../preload/index.mjs')
  const cjs = join(__dirname, '../preload/index.js')
  return existsSync(esm) ? esm : cjs
}

function createMainWindow(): BrowserWindow {
  const { width, height } = resolveWindowSize()

  const window = new BrowserWindow({
    width,
    height,
    // The design is a fixed canvas: the frame colour is set here as well so the
    // very first paint (before the renderer has styles) is already the right one.
    backgroundColor: BACKGROUND_COLOR,
    autoHideMenuBar: true,
    // Shown on `ready-to-show` so the user never sees an empty frame while the
    // renderer's fonts, artwork and videos are still being decoded.
    show: false,
    resizable: true,
    center: true,
    webPreferences: {
      preload: resolvePreloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      // `false` because the ESM preload above requires it; the preload only uses
      // `contextBridge`/`ipcRenderer`, so no other sandbox escape is needed.
      sandbox: false,
      // A game running in the foreground must not throttle the launcher's own
      // animations when the panel stays open.
      backgroundThrottling: false
    }
  })

  // The window's only privileged content is the local renderer. A navigation to
  // remote content would hand that content the same preload bridge, so it is
  // refused; `shell:open-external` is the intended way to leave the app.
  // Electron 44 passes the event details object (the trailing positional
  // arguments are deprecated).
  window.webContents.on('will-navigate', (details) => {
    if (!isOwnRendererUrl(details.url)) {
      details.preventDefault()
      log.warn(`blocked navigation to ${details.url}`)
    }
  })
  window.webContents.setWindowOpenHandler(({ url }) => {
    log.warn(`blocked a popup window for ${url}`)
    return { action: 'deny' }
  })

  window.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    log.error(`renderer failed to load (${errorCode} ${errorDescription}) from ${validatedURL}`)
  })

  window.once('ready-to-show', () => {
    window.show()
    log.info('launcher window shown')
  })

  window.on('closed', () => {
    if (mainWindow === window) mainWindow = null
  })

  return window
}

/** True for the renderer this process is meant to display. */
function isOwnRendererUrl(url: string): boolean {
  const devUrl = process.env.ELECTRON_RENDERER_URL
  if (!app.isPackaged && typeof devUrl === 'string' && devUrl.length > 0) {
    return url.startsWith(devUrl)
  }
  return url.startsWith('file://')
}

/**
 * Dev serves the renderer from the Vite dev server electron-vite started and
 * advertises in `ELECTRON_RENDERER_URL`; a packaged build reads the file Vite
 * wrote to `out/renderer`.
 */
async function loadRenderer(window: BrowserWindow): Promise<void> {
  const devUrl = process.env.ELECTRON_RENDERER_URL
  if (!app.isPackaged && typeof devUrl === 'string' && devUrl.length > 0) {
    await window.loadURL(devUrl)
    return
  }
  await window.loadFile(join(__dirname, '../renderer/index.html'))
}

// ---------------------------------------------------------------------------
// --selftest
// ---------------------------------------------------------------------------

interface SelfTestRow {
  id: string
  state: InstallState
  installPath: string
}

/**
 * Writes one line of JSON to stdout. `writeSync` rather than
 * `process.stdout.write` because the write has to survive the immediate
 * `app.exit()` that follows: on Windows a piped stdout is asynchronous, so an
 * async write would still be queued when the process ends.
 */
async function emitSelfTestLine(payload: unknown): Promise<void> {
  const line = `${JSON.stringify(payload)}\n`
  try {
    writeSync(1, line)
    return
  } catch (error) {
    // A non-blocking pipe can refuse a synchronous write; fall back to the async
    // path, with a short grace period so the line reaches the consumer before the
    // process exits.
    log.warn('selftest could not write synchronously to stdout', error)
  }
  process.stdout.write(line)
  await new Promise((resolve) => {
    setTimeout(resolve, 100)
  })
}

/**
 * Reports the catalog and quits with code 0.
 *
 * The per-row `installPath` is the *title's* detected root, repeated on each of
 * its rows, because every version of a title shares one install (the legacy
 * validator probed `title.installPath` for each row).
 */
async function reportSelfTest(reason: string): Promise<void> {
  if (selfTestReported) return
  selfTestReported = true
  if (selfTestTimer !== null) {
    clearTimeout(selfTestTimer)
    selfTestTimer = null
  }

  try {
    const snapshot = await readCatalogSnapshot()
    const rows: SelfTestRow[] = snapshot.titles.flatMap((title) =>
      title.versions.map((version) => ({
        id: version.id,
        state: version.state,
        installPath: title.installPath
      }))
    )
    await emitSelfTestLine({ ok: true, needsInstallScreen: snapshot.needsInstallScreen, rows })
    log.info(`selftest reported ${String(rows.length)} rows (${reason})`)

    // `app.exit` skips `before-quit`, which is correct here: a selftest never
    // starts a game, so there is nothing to stop.
    app.exit(0)
  } catch (error) {
    log.error('selftest could not read the catalog', error)
    await emitSelfTestLine({ ok: false, needsInstallScreen: true, rows: [] })
    app.exit(1)
  }
}

function armSelfTest(window: BrowserWindow): void {
  // Armed before the load starts: `did-finish-load` for the very first load can
  // fire before an `await` after it would have resumed.
  window.webContents.once('did-finish-load', () => {
    void reportSelfTest('renderer finished loading')
  })

  // The catalog does not depend on the renderer, so a load that never completes
  // (a missing `out/renderer`, a headless machine) must not hang the suite.
  selfTestTimer = setTimeout(() => {
    void reportSelfTest('renderer did not finish loading in time')
  }, SELFTEST_LOAD_TIMEOUT_MS)
}

// ---------------------------------------------------------------------------
// app lifecycle
// ---------------------------------------------------------------------------

async function openMainWindow(): Promise<BrowserWindow> {
  const window = createMainWindow()
  mainWindow = window

  if (isSelfTest) armSelfTest(window)

  try {
    await loadRenderer(window)
  } catch (error) {
    // A renderer that cannot be loaded is worth reporting, but it must not take
    // the process down: `--selftest` still has a catalog to print, and a human
    // gets the error in the log rather than a silent failure to start.
    log.error('could not load the launcher renderer', error)
  }

  return window
}

async function bootstrap(): Promise<void> {
  // Registered before the window exists so the renderer's first `invoke` always
  // finds a handler, and so the config migration happens before the renderer asks
  // for `app:paths`.
  disposeIpc = registerIpcHandlers()

  await openMainWindow()
  log.info('launcher started')
}

/** Brings the window of the already-running instance forward. */
function focusExistingWindow(): void {
  const window = mainWindow
  if (window === null || window.isDestroyed()) {
    log.warn('a second instance asked for the window, but there is none')
    return
  }
  if (window.isMinimized()) window.restore()
  if (!window.isVisible()) window.show()
  window.focus()
  log.info('focused the existing window for a second launch')
}

function onBeforeQuit(): void {
  // A game the launcher started must not outlive it: the legacy `App::Shutdown`
  // path left no child process behind, and the next launch injects the overlay
  // again anyway.
  log.info('shutting down')
  try {
    killGame()
  } catch (error) {
    log.warn('could not stop the game process while shutting down', error)
  }
  disposeIpc?.()
  disposeIpc = null
}

function onActivate(): void {
  // macOS only in practice: the app stays alive with no window, and the dock icon
  // reopens it. The IPC layer is not re-registered — only the window is gone.
  if (mainWindow === null) {
    void openMainWindow().catch((error: unknown) => {
      log.error('could not reopen the launcher window', error)
    })
  }
}

function start(): void {
  if (!isSelfTest) {
    app.on('second-instance', () => {
      focusExistingWindow()
    })
  }

  app.on('before-quit', onBeforeQuit)
  app.on('window-all-closed', () => {
    // On darwin the app keeps running with no window (see `onActivate`); everywhere
    // else a closed window ends the session.
    if (process.platform !== 'darwin') app.quit()
  })
  app.on('activate', onActivate)

  app
    .whenReady()
    .then(async () => {
      await bootstrap()
    })
    .catch((error: unknown) => {
      log.error('the launcher failed to start', error)
      app.exit(1)
    })
}

// ---------------------------------------------------------------------------
// entry
// ---------------------------------------------------------------------------

/**
 * One launcher per machine: a second launch focuses the window that is already
 * open instead of starting a rival instance that would fight over `config.json`,
 * the achievement save and the `.mod_backup/` folders of the same install.
 *
 * `--selftest` is the deliberate exception. It is a read-only diagnostic used by
 * the E2E suite, and it has to work while an interactive instance happens to be
 * open, so it neither takes the lock nor counts as "the" instance.
 */
if (isSelfTest || app.requestSingleInstanceLock()) {
  start()
} else {
  log.info('another launcher instance is already running; exiting in its favour')
  app.quit()
}
