/**
 * Filesystem layout of the launcher.
 *
 * The legacy launcher (removed `src/config/paths.cpp`) resolved everything from
 * `GetExeDirectory()`: `config.ini`, `achievements.sav` and `assets/` all sat
 * beside the binary, and `GetConfigDirectory()` was simply an alias for that
 * same folder. Two directories matter and they are genuinely different, so the
 * rewrite keeps them apart:
 *
 *  - `appDir`    sits beside the executable and holds game-facing data the user
 *                owns and may replace by hand: `GOG Games/`, `reenhancemods/`,
 *                the legacy `config.ini` and `achievements.sav`.
 *  - `configDir` is Electron's `userData` and holds the state the launcher owns.
 *
 * Config never lives beside the executable: an NSIS install lands in
 * `Program Files`, which is not writable for a standard user (and gets
 * virtualised into `VirtualStore` when it is), so a `config.json` written there
 * would silently disappear or fail. `userData` is per-user and always writable.
 * The legacy files are still *read* from `appDir` so an existing install keeps
 * its settings and unlocked achievements (see `legacyConfigPath` /
 * `legacyProgressPath`).
 *
 * Implements the frozen `MainPaths` / `getMainPaths` / `toAppPaths` declarations
 * from `src/main/contracts.ts`.
 */
import { existsSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
// Namespace import, not `import { app } from 'electron'`: importing `electron`
// from plain Node (the main-process unit tests in `src/main/*.test.ts` run under
// vitest in a Node environment) resolves to the path of the Electron binary, and
// a named import of `app` fails to *link* — `SyntaxError: Named export 'app' not
// found` — before any of the guards below can run. The namespace always exists,
// with `app === undefined` outside Electron, so every access is guarded instead.
import * as electron from 'electron'

import type { MainPaths } from './contracts'
import type { AppPaths } from '@shared/types'

/** Folder the user drops pre-modded overlays into, beside the executable. */
const MODS_DIR_NAME = 'reenhancemods'
/** Loose asset files shipped for the user to override (achievements, etc.). */
const ASSETS_DIR_NAME = 'assets'
/** New per-user config, in `configDir`. */
const CONFIG_FILE_NAME = 'config.json'
/** Legacy config the old launcher read from the executable folder. */
const LEGACY_CONFIG_FILE_NAME = 'config.ini'
/** Progress file name, used in both the legacy and the new location. */
const PROGRESS_FILE_NAME = 'achievements.sav'
/**
 * `name` in package.json. Electron appends it to `appData` to build `userData`,
 * so the plain-Node fallback below reproduces exactly that join.
 */
const APP_NAME = 're-classic-collection'

/**
 * `app.getAppPath()`, or null when this module is loaded outside Electron.
 *
 * The try/catch is the guard: with no Electron runtime `electron.app` is
 * `undefined`, so the property access throws a `TypeError` that lands here
 * rather than in the caller.
 */
function electronAppPath(): string | null {
  try {
    const value: string = electron.app.getAppPath()
    return value.length > 0 ? value : null
  } catch {
    return null
  }
}

/** `app.getPath('userData')`, or null when this module is loaded outside Electron. */
function electronUserDataPath(): string | null {
  try {
    const value: string = electron.app.getPath('userData')
    return value.length > 0 ? value : null
  } catch {
    return null
  }
}

/** `app.isPackaged`, false when this module is loaded outside Electron. */
function isPackaged(): boolean {
  try {
    return electron.app.isPackaged === true
  } catch {
    return false
  }
}

/**
 * Repository root in development: the folder that contains `package.json`.
 *
 * `app.getAppPath()` already points there when electron-vite runs the bundle
 * from `out/main`, and the walk up from `process.cwd()` covers runs where
 * `app` is unavailable (unit tests, tooling). The `package.json` check matters
 * because `app.getAppPath()` returns the `app.asar` path in a packaged build and
 * must never be mistaken for an app dir.
 */
function developmentAppDir(): string {
  const fromElectron = electronAppPath()
  if (fromElectron !== null && existsSync(join(fromElectron, 'package.json'))) {
    return fromElectron
  }

  let dir = process.cwd()
  for (;;) {
    if (existsSync(join(dir, 'package.json'))) {
      return dir
    }
    const parent = dirname(dir)
    if (parent === dir) {
      // Filesystem root without a package.json anywhere above: fall back to the
      // working directory, which is what the legacy launcher used implicitly.
      return process.cwd()
    }
    dir = parent
  }
}

/**
 * Per-user app data root, matching Electron's own algorithm (`appData` is
 * `%APPDATA%` on Windows, `~/Library/Application Support` on macOS and
 * `$XDG_CONFIG_HOME` / `~/.config` on Linux).
 */
function electronAppDataDir(): string {
  if (process.platform === 'win32') {
    const roaming = process.env.APPDATA
    if (roaming !== undefined && roaming.length > 0) {
      return roaming
    }
    return join(homedir(), 'AppData', 'Roaming')
  }
  if (process.platform === 'darwin') {
    return join(homedir(), 'Library', 'Application Support')
  }
  const xdgConfigHome = process.env.XDG_CONFIG_HOME
  if (xdgConfigHome !== undefined && xdgConfigHome.length > 0) {
    return xdgConfigHome
  }
  return join(homedir(), '.config')
}

/**
 * Writable state directory. Electron owns this in the real app; the fallback
 * exists so the module stays usable in a plain Node process (tests, tools) and
 * deliberately mirrors Electron's `appData + app.name` rule, so both paths agree
 * on where a config file would be.
 */
function userDataDir(): string {
  const fromElectron = electronUserDataPath()
  if (fromElectron !== null) {
    return fromElectron
  }
  try {
    return join(electronAppDataDir(), APP_NAME)
  } catch {
    // No usable home directory; a temp folder still beats throwing.
    return join(tmpdir(), APP_NAME)
  }
}

/**
 * Test-only directory redirection.
 *
 * The E2E suite needs a hermetic appDir (its own `GOG Games/` fixture) and a
 * throwaway configDir, because a spec must never read or patch the developer's
 * real installs. The redirect is deliberately ignored in a packaged build: an
 * environment variable that can repoint the launcher at an arbitrary `GOG Games/`
 * and `reenhancemods/` is a shipping risk, and only the tests ever need it.
 */
function testOverrides(packaged: boolean): { appDir: string | null; configDir: string | null } {
  if (packaged) return { appDir: null, configDir: null }
  const read = (name: string): string | null => {
    const value = process.env[name]
    return value === undefined || value === '' ? null : value
  }
  return { appDir: read('RE_TEST_APP_DIR'), configDir: read('RE_TEST_CONFIG_DIR') }
}

/**
 * Resolves the launcher's directories.
 *
 * Not memoised on purpose: the result depends on `process.execPath`,
 * `process.cwd()` and Electron's packaging state, and resolving it costs only a
 * couple of `existsSync` calls, so a stale cached value would be a worse trade
 * than the work it saves.
 */
export function getMainPaths(): MainPaths {
  const packaged = isPackaged()
  const overrides = testOverrides(packaged)

  // Packaged: beside the executable, NOT `process.resourcesPath`. The user drops
  // `GOG Games/` and `reenhancemods/` next to the `.exe` they double-clicked, and
  // `resourcesPath` is one level below that (`<install>/resources`), so using it
  // would hide both folders. This matches the legacy `GetExeDirectory()` rule.
  //
  // The portable target is the one exception: electron-builder's portable stub
  // unpacks to a temp directory and runs the exe from there, so `execPath` points
  // at the temp copy and not at the folder the user put beside the portable
  // launcher. It publishes the real location in `PORTABLE_EXECUTABLE_DIR`.
  const portableDir = process.env.PORTABLE_EXECUTABLE_DIR
  const packagedAppDir =
    portableDir !== undefined && portableDir !== '' ? portableDir : dirname(process.execPath)

  const appDir = overrides.appDir ?? (packaged ? packagedAppDir : developmentAppDir())
  const configDir = overrides.configDir ?? userDataDir()

  return {
    appDir,
    configDir,
    configPath: join(configDir, CONFIG_FILE_NAME),
    progressPath: join(configDir, PROGRESS_FILE_NAME),
    modsDir: join(appDir, MODS_DIR_NAME),
    assetsDir: join(appDir, ASSETS_DIR_NAME),
    legacyConfigPath: join(appDir, LEGACY_CONFIG_FILE_NAME),
    legacyProgressPath: join(appDir, PROGRESS_FILE_NAME),
    isPackaged: packaged
  }
}

/**
 * Narrows `MainPaths` to the subset the renderer receives over `app:paths`
 * (`AppPaths` in `src/shared/types.ts`). `configDir` and `assetsDir` are left
 * out: the renderer has no use for them (Install Status shows the two concrete
 * files, not the internal directory), and anything it does not receive cannot be
 * leaked into a UI string or an `openExternal` call.
 */
export function toAppPaths(paths: MainPaths): AppPaths {
  return {
    appDir: paths.appDir,
    configPath: paths.configPath,
    progressPath: paths.progressPath,
    modsDir: paths.modsDir,
    legacyConfigPath: paths.legacyConfigPath,
    legacyProgressPath: paths.legacyProgressPath,
    isPackaged: paths.isPackaged
  }
}
